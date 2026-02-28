/**
 * @file api/admin/system-logs.js
 * @description 获取系统同步日志 (System Logs)
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

    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    try {
        const result = await query(`
            SELECT 
                id,
                user_id,
                status,
                error,
                created_at,
                delta->>'ip' as ip,
                delta->>'ua' as ua
            FROM sync_logs
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2
        `, [limit, offset]);
        
        res.status(200).json({ 
            ok: true, 
            logs: result.rows,
            meta: {
                limit,
                offset
            }
        });

    } catch (err) {
        console.error('Logs Error:', err);
        res.status(500).json({ error: 'Database error', detail: err.message });
    }
};
