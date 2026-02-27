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

    if (!name) {
        res.status(400).json({ error: 'name 不能为空' });
        return;
    }

    try {
        // 3. 开启数据库事务 (Start Transaction)
        // 必须保证 Check -> Delete -> Insert 过程的原子性
        await query('BEGIN');

        // 查询该用户现有的题库记录
        const existing = await query(
            'select id, version from question_sets where user_id = $1 order by id desc',
            [userId]
        );
        let setId;
        let currentVersion = 0;
        let nextVersion = 1;

        if (existing.rows.length > 0) {
            // 取最新的一个题库 ID
            setId = existing.rows[0].id;
            currentVersion = typeof existing.rows[0].version === 'number' ? existing.rows[0].version : 0;
            
            // 4. 数据清理：暂时保留历史题库记录，避免误删多科目数据
            // if (existing.rows.length > 1) {
            //     const idsToDelete = existing.rows.slice(1).map(r => r.id);
            //     if (idsToDelete.length > 0) {
            //          await query('delete from question_sets where id = any($1)', [idsToDelete]);
            //     }
            // }

            // 5. 版本冲突检测 (Optimistic Locking)
            // 如果客户端提交的版本与数据库当前版本不一致，说明有其他设备已更新数据
            if (clientVersion !== currentVersion) {
                await query('ROLLBACK');
                try {
                    await query(
                        'insert into sync_logs (user_id, delta, status, error) values ($1, $2, $3, $4)',
                        [userId, delta, 'error', 'version_conflict']
                    );
                } catch (e) {}
                res.status(409).json({ error: 'Version conflict', currentVersion });
                return;
            }
            
            // 版本号自增
            nextVersion = currentVersion + 1;
            
            // 更新题库元数据
            await query(
                'update question_sets set name = $1, state = $2, version = $3 where id = $4',
                [name, state, nextVersion, setId]
            );

            // 如果需要更新题目列表，先清空该题库下的所有旧题
            if (!skipQuestionsUpdate) {
                await query('delete from questions where question_set_id = $1', [setId]);
            }
        } else {
            // 如果是首次创建
            nextVersion = 1;
            const inserted = await query(
                'insert into question_sets (user_id, name, state, version) values ($1, $2, $3, $4) returning id',
                [userId, name, state, nextVersion]
            );
            setId = inserted.rows[0].id;
        }

        // 6. 批量插入新题目 (Bulk Insert)
        if (!skipQuestionsUpdate || existing.rows.length === 0) {
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
