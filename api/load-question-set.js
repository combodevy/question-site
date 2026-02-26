const { query } = require('./_db');
const { getUserFromRequest } = require('./_auth');

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
    const user = getUserFromRequest(req);
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
        const sets = await query(
            'select id, name, state, version from question_sets where user_id = $1 limit 1',
            [userId]
        );
        if (sets.rows.length === 0) {
            res.status(200).json({ ok: true, setId: null, name: null, state: null, version: 0 });
            return;
        }
        const set = sets.rows[0];
        const setId = set.id;
        const version = typeof set.version === 'number' && Number.isFinite(set.version) ? set.version : 0;
        let baseState = set.state || null;
        if (typeof baseState === 'string') {
            try {
                baseState = JSON.parse(baseState);
            } catch (e) {
                baseState = null;
            }
        }
        const rows = await query('select content from questions where question_set_id = $1', [setId]);
        const bank = {};
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
            const sub = q.sub || '默认科目';
            const chap = q.chap || '默认章节';
            if (!bank[sub]) bank[sub] = {};
            if (!bank[sub][chap]) bank[sub][chap] = [];
            bank[sub][chap].push(q);
        }
        const baseBank = baseState && typeof baseState === 'object' && baseState.bank ? baseState.bank : null;
        if (baseBank && countBank(baseBank) > countBank(bank)) {
            for (const sub in bank) delete bank[sub];
            Object.assign(bank, baseBank);
        }
        const state = {
            bank,
            bankName:
                baseState &&
                typeof baseState === 'object' &&
                typeof baseState.bankName === 'string'
                    ? baseState.bankName
                    : null,
            history:
                baseState &&
                typeof baseState === 'object' &&
                Array.isArray(baseState.history)
                    ? baseState.history
                    : [],
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
        res.status(200).json({ ok: true, setId, name: set.name, state, version });
    } catch (err) {
        const detail = (err && err.message) || (typeof err === 'string' ? err : JSON.stringify(err));
        res.status(500).json({ error: '数据库错误', detail });
    }
};
