/**
 * @file save-question-set.js
 * @description 题库保存接口 (Save Question Set API)
 * @author Engineer
 * @date 2026-02-27
 * 
 * 职责：
 * 1. 接收前端提交的题库数据、历史记录、错题本等状态
 * 2. 使用数据库事务 (Transaction) 确保数据一致性
 * 3. 处理版本冲突 (Optimistic Locking)
 * 4. 自动清理旧的重复题库记录
 * 5. 通过 Ably 推送实时更新通知
 */

const Ably = require('ably');
const { query } = require('./_db');
const { getUserFromRequest } = require('./_auth');
const { handleCors } = require('./_cors');

const ablyApiKey = process.env.ABLY_API_KEY || '';
const ablyClient = ablyApiKey ? new Ably.Rest(ablyApiKey) : null;

const realtimeNotifyUrl = process.env.REALTIME_NOTIFY_URL || '';
const realtimeNotifySecret = process.env.REALTIME_NOTIFY_SECRET || '';

async function notifyRealtimeGateway(userId, payload) {
    if (!realtimeNotifyUrl || !userId) return;
    try {
        await fetch(realtimeNotifyUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(realtimeNotifySecret ? { Authorization: `Bearer ${realtimeNotifySecret}` } : {})
            },
            body: JSON.stringify({ userId, ...payload })
        });
    } catch (e) {}
}

/**
 * 确保数据库表结构存在
 * 注意：在生产环境中，建议使用 Migration 工具管理表结构，此处为简化部署流程
 */
async function ensureTables() {
    await query(`
        create table if not exists question_sets (
            id serial primary key,
            user_id text not null,
            name text not null,
            created_at timestamptz default now(),
            version integer not null default 0,
            state jsonb
        )
    `);
    await query(`
        create table if not exists questions (
            id serial primary key,
            question_set_id integer not null references question_sets(id) on delete cascade,
            content jsonb not null
        )
    `);
    await query(`
        create table if not exists sync_logs (
            id serial primary key,
            user_id text not null,
            delta jsonb,
            status text not null,
            error text,
            created_at timestamptz default now()
        )
    `);
}

module.exports = async (req, res) => {
    // 1. 处理跨域请求
    if (handleCors(req, res)) return;

    // 2. 验证用户身份
    const user = await getUserFromRequest(req);
    if (!user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    await ensureTables();
    const userId = user.sub || user.id;
    const body = req.body || {};
    const name = body.name;
    const questions = Array.isArray(body.questions) ? body.questions : [];
    const state = body.state && typeof body.state === 'object' ? body.state : null;
    const delta = body.delta && typeof body.delta === 'object' ? body.delta : null;
    // 获取客户端当前版本号，用于乐观锁校验
    const clientVersion = typeof body.version === 'number' && Number.isFinite(body.version) ? body.version : 0;
    // 如果 skipQuestionsUpdate 为 true，则只更新元数据 (metadata)，不重新写入题目列表
    const skipQuestionsUpdate = body.skipQuestionsUpdate === true;

    // ========== 增量同步参数 (Incremental Sync) ==========
    // historyAppend: 自上次同步以来新增的 history 条目（增量追加）
    const historyAppend = Array.isArray(body.historyAppend) ? body.historyAppend : null;
    // statePartial: 如果为 true，仅更新 state 中的部分字段（增量模式）
    const statePartial = body.statePartial === true;
    // partialFields: 指定需要更新的字段列表
    const partialFields = Array.isArray(body.partialFields) ? body.partialFields : [];

    if (!name) {
        res.status(400).json({ error: 'name 不能为空' });
        return;
    }

    try {
        // 3. 开启数据库事务 (Start Transaction)
        // 必须保证 Check -> Delete -> Insert 过程的原子性
        await query('BEGIN');

        // 查询该用户现有的题库记录
        // 注意：这里我们查询所有题库，以便后续判断是更新特定 ID 还是插入新记录
        // 如果前端没有传 setId (或为 0)，则视为新建题库
        // 如果前端传了 setId，则尝试更新该 ID
        
        let setId = body.setId; // 前端需要显式传递 setId，如果想更新特定题库
        
        // 如果没有 setId，尝试根据 name 匹配现有题库 (兼容旧逻辑)
        if (!setId) {
            const existing = await query(
                'select id, version from question_sets where user_id = $1 and name = $2 order by id desc limit 1',
                [userId, name]
            );
            if (existing.rows.length > 0) {
                setId = existing.rows[0].id;
            }
        }
        
        // 获取当前版本号 (如果 setId 存在)
        let currentVersion = 0;
        if (setId) {
            const setRecord = await query('select version from question_sets where id = $1', [setId]);
            if (setRecord.rows.length > 0) {
                currentVersion = setRecord.rows[0].version || 0;
            } else {
                // ID 不存在，视为新建
                setId = null;
            }
        }
       
        let nextVersion = 1;

        if (setId) {
            // 更新现有题库
            
            // 5. 版本冲突检测 (Optimistic Locking)
            if (clientVersion !== currentVersion) {
                await query('ROLLBACK');
                try {
                    await query(
                        'insert into sync_logs (user_id, delta, status, error) values ($1, $2, $3, $4)',
                        [userId, { clientVersion, currentVersion }, 'conflict', 'Version Mismatch']
                    );
                } catch (e) {}
                res.status(409).json({ 
                    error: 'Version Conflict', 
                    serverVersion: currentVersion,
                    yourVersion: clientVersion
                });
                return;
            }

            nextVersion = currentVersion + 1;

            // ========== 增量同步模式 (Incremental Sync Mode) ==========
            if (statePartial && historyAppend && historyAppend.length > 0 && !state) {
                // 增量模式：仅追加 history 条目，不替换整个 state
                // 使用 PostgreSQL JSONB 操作符拼接数组：
                //   state->'history' 获取现有 history 数组
                //   || $2::jsonb     追加新条目
                //   jsonb_set(...)    写回 state
                let updateQuery = `
                    UPDATE question_sets SET
                        version = $1,
                        state = jsonb_set(
                            COALESCE(state, '{}')::jsonb,
                            '{history}',
                            COALESCE(state->'history', '[]'::jsonb) || $2::jsonb
                        )`;
                const updateParams = [nextVersion, JSON.stringify(historyAppend)];
                let paramIdx = 3;

                // 如果有其他部分字段需要更新（如 lastPracticeTime, hiddenMistakeIds）
                for (const field of partialFields) {
                    const allowed = ['lastPracticeTime', 'hiddenMistakeIds', 'trash', 'bankName'];
                    if (!allowed.includes(field)) continue;
                    const val = body.partialValues && body.partialValues[field];
                    if (val === undefined) continue;
                    updateQuery += `,\n                        state = jsonb_set(state, $${paramIdx}::text[], $${paramIdx + 1}::jsonb)`;
                    updateParams.push(`{${field}}`);
                    updateParams.push(JSON.stringify(val));
                    paramIdx += 2;
                }

                updateQuery += `\n                    WHERE id = $${paramIdx}`;
                updateParams.push(setId);
                await query(updateQuery, updateParams);

            } else {
                // 全量模式（原逻辑）：替换整个 state
                // 如果有 historyAppend 但也有完整 state，则将追加的 history 合并到 state 中
                let finalState = state;
                if (finalState && historyAppend && historyAppend.length > 0) {
                    if (Array.isArray(finalState.history)) {
                        // 确保追加的条目不重复（基于时间戳去重）
                        const existingTimestamps = new Set(finalState.history.map(h => h.t));
                        const newEntries = historyAppend.filter(h => !existingTimestamps.has(h.t));
                        finalState.history = finalState.history.concat(newEntries);
                    }
                }
                await query(
                    'update question_sets set name = $1, state = $2, version = $3 where id = $4',
                    [name, finalState, nextVersion, setId]
                );
            }
            
            // 删除旧题目 (全量覆盖模式)
            if (!skipQuestionsUpdate) {
                await query('delete from questions where question_set_id = $1', [setId]);
            }

        } else {
            // 创建新题库
            const inserted = await query(
                'insert into question_sets (user_id, name, state, version) values ($1, $2, $3, $4) returning id',
                [userId, name, state, 1]
            );
            setId = inserted.rows[0].id;
            nextVersion = 1;
        }

        // 6. 批量插入新题目 (Bulk Insert)
        if (!skipQuestionsUpdate) {
            if (questions.length > 0) {
                // 6.1 在内存中去重 (Deduplication)
                // 使用 Set 存储题目内容的字符串指纹，过滤掉完全重复的题目
                const uniqueQuestions = [];
                const seenFingerprints = new Set();
                
                for (const q of questions) {
                    try {
                        // 创建一个指纹：基于题目(q)、选项(o)、答案(a)、类型(type)
                        // 忽略 id 和其他元数据，确保仅仅是内容重复才过滤
                        const fingerprintObj = {
                            q: q.q,
                            o: q.o,
                            a: q.a,
                            type: q.type,
                            sub: q.sub,
                            chap: q.chap
                        };
                        const fingerprint = JSON.stringify(fingerprintObj);
                        
                        if (!seenFingerprints.has(fingerprint)) {
                            seenFingerprints.add(fingerprint);
                            uniqueQuestions.push(q);
                        }
                    } catch (err) {
                        // 如果序列化失败，保守起见保留该题目
                        uniqueQuestions.push(q);
                    }
                }

                if (uniqueQuestions.length > 0) {
                    const values = [];
                    const params = [setId];
                    let paramIdx = 2;
                    
                    // 构造批量插入语句: values ($1, $2), ($1, $3), ...
                    for (const q of uniqueQuestions) {
                        values.push(`($1, $${paramIdx}::jsonb)`);
                        params.push(JSON.stringify(q));
                        paramIdx++;
                    }
                    
                    const insertQuery = `insert into questions (question_set_id, content) values ${values.join(',')}`;
                    await query(insertQuery, params);
                }
            }
        }
        
        // 7. 提交事务 (Commit Transaction)
        await query('COMMIT');

        // 记录同步日志 (不影响主流程，忽略错误)
        try {
            // 获取客户端 IP 和 User-Agent (Vercel headers)
            const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
            const ua = req.headers['user-agent'] || 'unknown';
            
            // 将 IP 和 UA 合并到 delta 对象中，以便统一存储
            const logDelta = delta && typeof delta === 'object' ? { ...delta, ip, ua } : { ip, ua };
            
            await query(
                'insert into sync_logs (user_id, delta, status, error) values ($1, $2, $3, $4)',
                [userId, logDelta, 'success', null]
            );
        } catch (e) {}

        // 8. 发送 Ably 实时通知
        if (ablyClient) {
            try {
                const channel = ablyClient.channels.get(`user:${userId}`);
                await channel.publish('question-set-updated', {
                    setId,
                    at: new Date().toISOString(),
                    version: nextVersion
                });
            } catch (e) {}
        }
        
        // 9. 发送自建 Realtime Gateway 通知 (Cloudflare Workers)
        notifyRealtimeGateway(userId, { type: 'set-updated', setId, version: nextVersion });

        res.status(200).json({ ok: true, setId, version: nextVersion });
    } catch (err) {
        // 发生错误，回滚事务
        await query('ROLLBACK');
        const detail = (err && err.message) || (typeof err === 'string' ? err : JSON.stringify(err));
        try {
            await query(
                'insert into sync_logs (user_id, delta, status, error) values ($1, $2, $3, $4)',
                [userId, delta, 'error', detail]
            );
        } catch (e2) {}
        res.status(500).json({ error: '数据库错误', detail });
    }
};
