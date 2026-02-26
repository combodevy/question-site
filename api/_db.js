const { Pool } = require('pg');

let pool;

function getPool() {
    if (!pool) {
        pool = new Pool({
            connectionString: process.env.SUPABASE_DB_URL
        });
    }
    return pool;
}

async function query(text, params) {
    const p = getPool();
    return p.query(text, params);
}

module.exports = { query };
