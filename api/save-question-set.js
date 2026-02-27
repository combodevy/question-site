const Ably = require('ably');
const { query } = require('./_db');
const { getUserFromRequest } = require('./_auth');
const { handleCors } = require('./_cors');

const ablyApiKey = process.env.ABLY_API_KEY || '';
const ablyClient = ablyApiKey ? new Ably.Rest(ablyApiKey) : null;

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
    if (handleCors(req, res)) return;
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
    const clientVersion = typeof body.version === 'number' && Number.isFinite(body.version) ? body.version : 0;
    const skipQuestionsUpdate = body.skipQuestionsUpdate === true;
    if (!name) {
        res.status(400).json({ error: 'name 不能为空' });
        return;
    }
    try {
        // Start transaction
        await query('BEGIN');

        const existing = await query(
            'select id, version from question_sets where user_id = $1 order by id desc',
            [userId]
        );
        let setId;
        let currentVersion = 0;
        let nextVersion = 1;

        if (existing.rows.length > 0) {
            // Pick the latest one (by ID desc)
            setId = existing.rows[0].id;
            currentVersion = typeof existing.rows[0].version === 'number' ? existing.rows[0].version : 0;
            
            // If there are multiple sets, delete the older ones to prevent ambiguity
            if (existing.rows.length > 1) {
                const idsToDelete = existing.rows.slice(1).map(r => r.id);
                if (idsToDelete.length > 0) {
                     await query('delete from question_sets where id = any($1)', [idsToDelete]);
                }
            }

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
            nextVersion = currentVersion + 1;
            await query(
                'update question_sets set name = $1, state = $2, version = $3 where id = $4',
                [name, state, nextVersion, setId]
            );
            if (!skipQuestionsUpdate) {
                await query('delete from questions where question_set_id = $1', [setId]);
            }
        } else {
            nextVersion = 1;
            const inserted = await query(
                'insert into question_sets (user_id, name, state, version) values ($1, $2, $3, $4) returning id',
                [userId, name, state, nextVersion]
            );
            setId = inserted.rows[0].id;
        }

        if (!skipQuestionsUpdate || existing.rows.length === 0) {
            if (questions.length > 0) {
                // Bulk insert for better performance and atomicity
                const values = [];
                const params = [setId];
                let paramIdx = 2;
                
                // Construct query: ($1, $2), ($1, $3), ...
                for (const q of questions) {
                    values.push(`($1, $${paramIdx}::jsonb)`);
                    params.push(JSON.stringify(q));
                    paramIdx++;
                }
                
                const insertQuery = `insert into questions (question_set_id, content) values ${values.join(',')}`;
                await query(insertQuery, params);
            }
        }
        
        await query('COMMIT');

        try {
            await query(
                'insert into sync_logs (user_id, delta, status, error) values ($1, $2, $3, $4)',
                [userId, delta, 'success', null]
            );
        } catch (e) {}

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
