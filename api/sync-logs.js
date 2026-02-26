const { query } = require('./_db');
const { getUserFromRequest } = require('./_auth');
const { handleCors } = require('./_cors');

async function ensureTables() {
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
    if (handleCors(req, res)) return;
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
        const rows = await query(
            'select id, delta, status, error, created_at from sync_logs where user_id = $1 order by created_at desc limit 50',
            [userId]
        );
        res.status(200).json({ ok: true, logs: rows.rows });
    } catch (err) {
        const detail = (err && err.message) || (typeof err === 'string' ? err : JSON.stringify(err));
        res.status(500).json({ error: '数据库错误', detail });
    }
};
