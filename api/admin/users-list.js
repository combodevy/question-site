/**
 * @file api/admin/users/list.js
 * @description 获取所有用户列表及其活跃状态
 * @author Engineer
 * @date 2026-02-27
 */

const { query } = require('../_db');
const { verifyAdmin } = require('./_middleware');
const { handleCors } = require('../_cors');

module.exports = async (req, res) => {
    if (handleCors(req, res)) return;

    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    const admin = await verifyAdmin(req);
    if (!admin) {
        res.status(403).json({ error: 'Forbidden: Admin access required' });
        return;
    }

    try {
        // Ensure sync_logs table exists to prevent errors on first run
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

        // 聚合 sync_logs 获取最后一次同步时间
        const usersQuery = `
            WITH LastSync AS (
                SELECT DISTINCT ON (user_id) 
                    user_id, 
                    created_at as last_sync_at,
                    delta->>'ip' as last_ip,
                    delta->>'ua' as last_device
                FROM sync_logs 
                ORDER BY user_id, created_at DESC
            )
            SELECT 
                qs.user_id,
                qs.name as bank_name,
                qs.version,
                COALESCE(ls.last_sync_at, qs.created_at) as last_active_at,
                ls.last_ip,
                ls.last_device
            FROM question_sets qs
            LEFT JOIN LastSync ls ON qs.user_id = ls.user_id
            ORDER BY last_active_at DESC NULLS LAST
            LIMIT 50
        `;
        
        const rows = await query(usersQuery);
        
        res.status(200).json({ 
            ok: true, 
            users: rows.rows,
            meta: {
                total: rows.rowCount,
                note: "IP and Device info will be available after sync_logs enhancement"
            }
        });

    } catch (err) {
        const detail = (err && err.message) || (typeof err === 'string' ? err : JSON.stringify(err));
        console.error('Admin List Error:', detail);
        res.status(500).json({ error: 'Database error', detail });
    }
};