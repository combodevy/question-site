/**
 * @file load-question-set.js
 * @description 题库加载接口 (Load Question Set API)
 * @author Engineer
 * @date 2026-02-27
 * 
 * 职责：
 * 1. 根据用户 ID 获取最新的题库数据 (Question Set)
 * 2. 组装题目列表 (Questions) 和元数据 (State)
 * 3. 执行数据清洗和去重 (Data Deduplication)
 * 4. 返回完整的前端应用状态
 */

const { query } = require('./_db');
const { getUserFromRequest } = require('./_auth');
const { handleCors } = require('./_cors');

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

/**
 * 统计题库中的题目总数
 * @param {Object} bk - 题库对象结构 { subject: { chapter: [questions] } }
 */
function countBank(bk) {
    if (!bk || typeof bk !== 'object') return 0;
    let total = 0;
    for (const sub in bk) {
        const chaps = bk[sub];
        if (!chaps || typeof chaps !== 'object') continue;
        for (const chap in chaps) {
            const arr = chaps[chap];
            if (Array.isArray(arr)) total += arr.length;
        }
    }
    return total;
}

module.exports = async (req, res) => {
    // 1. 处理跨域
    if (handleCors(req, res)) return;

    // 2. 身份验证
    const user = await getUserFromRequest(req);
    if (!user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    await ensureTables();
    const userId = user.sub || user.id;

    try {
        // 3. 获取该用户最新的题库记录 (Limit 1)
        const sets = await query(
            'select id, name, state, version from question_sets where user_id = $1 order by id desc limit 1',
            [userId]
        );
        if (sets.rows.length === 0) {
            res.status(200).json({ ok: true, setId: null, name: null, state: null, version: 0 });
            return;
        }
        const set = sets.rows[0];
        const setId = set.id;
        const version = typeof set.version === 'number' && Number.isFinite(set.version) ? set.version : 0;

        // ========== ETag / 304 Not Modified ==========
        // 如果客户端发送了 If-None-Match 且版本号匹配，直接返回 304
        // 极大减少中国用户的下载流量
        const etag = `"v${version}"`;
        res.setHeader('ETag', etag);
        res.setHeader('Cache-Control', 'no-cache'); // 始终验证，但允许缓存
        const clientEtag = req.headers['if-none-match'];
        if (clientEtag && clientEtag === etag) {
            res.status(304).end();
            return;
        }

        let baseState = set.state || null;

        // 解析存储在 question_sets 表中的基础状态 (JSONB)
        if (typeof baseState === 'string') {
            try {
                baseState = JSON.parse(baseState);
            } catch (e) {
                baseState = null;
            }
        }

        // ========== 增量 history 加载 ==========
        // 如果客户端传了 ?historyAfter=<timestamp>，仅返回该时间戳之后的 history 条目
        const historyAfterParam = req.query && req.query.historyAfter;
        const historyAfter = historyAfterParam ? parseInt(historyAfterParam, 10) : 0;

        // 4. 获取题目详情列表
        const rows = await query('select content from questions where question_set_id = $1', [setId]);
        const bank = {};
        const seenIds = new Set();

        // 5. 组装题库结构并去重
        for (const row of rows.rows) {
            let q = row.content;
            if (typeof q === 'string') {
                try {
                    q = JSON.parse(q);
                } catch (e) {
                    q = null;
                }
            }
            if (!q || typeof q !== 'object') continue;

            // 去重逻辑：如果同一个 ID 出现多次，只保留第一个
            // 这可以修复历史数据中可能存在的重复问题
            if (q.id && typeof q.id === 'string') {
                if (seenIds.has(q.id)) continue;
                seenIds.add(q.id);
            }

            const sub = q.sub || '默认科目';
            const chap = q.chap || '默认章节';
            if (!bank[sub]) bank[sub] = {};
            if (!bank[sub][chap]) bank[sub][chap] = [];
            bank[sub][chap].push(q);
        }

        // 6. 兜底逻辑：如果数据库中 questions 表为空，但 state 中有 bank 数据，则使用 state 中的
        // 这种情况可能发生在迁移过程中
        const baseBank = baseState && typeof baseState === 'object' && baseState.bank ? baseState.bank : null;
        if (baseBank && countBank(baseBank) > countBank(bank)) {
            for (const sub in bank) delete bank[sub];
            Object.assign(bank, baseBank);
        }

        // 获取完整 history
        let fullHistory = baseState &&
            typeof baseState === 'object' &&
            Array.isArray(baseState.history)
            ? baseState.history
            : [];

        // 如果客户端请求了增量 history，只返回新条目
        let historySlice = fullHistory;
        let isHistoryPartial = false;
        if (historyAfter > 0 && fullHistory.length > 0) {
            historySlice = fullHistory.filter(h => h && h.t > historyAfter);
            isHistoryPartial = true;
        }

        // 7. 构造最终响应状态对象
        const state = {
            bank,
            bankName:
                baseState &&
                    typeof baseState === 'object' &&
                    typeof baseState.bankName === 'string'
                    ? baseState.bankName
                    : null,
            history: historySlice,
            lastPracticeTime:
                baseState &&
                    typeof baseState === 'object' &&
                    typeof baseState.lastPracticeTime === 'number'
                    ? baseState.lastPracticeTime
                    : null,
            trash:
                baseState &&
                    typeof baseState === 'object' &&
                    baseState.trash &&
                    typeof baseState.trash === 'object' &&
                    !Array.isArray(baseState.trash)
                    ? baseState.trash
                    : {},
            hiddenMistakeIds:
                baseState &&
                    typeof baseState === 'object' &&
                    Array.isArray(baseState.hiddenMistakeIds)
                    ? baseState.hiddenMistakeIds
                    : []
        };
        res.status(200).json({
            ok: true, setId, name: set.name, state, version,
            // 告知客户端本次返回的 history 是否为增量
            historyPartial: isHistoryPartial,
            historyTotal: fullHistory.length
        });
    } catch (err) {
        const detail = (err && err.message) || (typeof err === 'string' ? err : JSON.stringify(err));
        res.status(500).json({ error: '数据库错误', detail });
    }
};
