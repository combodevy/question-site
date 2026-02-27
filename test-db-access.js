
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.SUPABASE_DB_URL
});

async function test() {
    try {
        const res = await pool.query('SELECT id, email FROM auth.users LIMIT 1');
        console.log('Success:', res.rows);
    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        pool.end();
    }
}

test();
