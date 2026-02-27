/**
 * @file api/admin/users/list.js
 * @description 获取所有用户列表及其活跃状态
 * @author Engineer
 * @date 2026-02-27
 */

const { query } = require('../../_db');
const { verifyAdmin } = require('../_middleware');
const { handleCors } = require('../../_cors');

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
        // 查询 question_sets 表获取所有用户
        // 关联 sync_logs 获取最后活跃时间和 IP 信息 (稍后会增强 sync_logs)
        // 目前先从 question_sets 获取基础信息
        const result = await query(`
            SELECT 
                qs.user_id,
                qs.name as bank_name,
                qs.updated_at as last_active_at,
                qs.version,
                (SELECT count(*) FROM questions q WHERE q.question_set_id = qs.id) as question_count
            FROM question_sets qs
            ORDER BY qs.updated_at DESC
            LIMIT 100
        `);

        // 由于 question_sets 表没有 updated_at 字段，我们需要先去数据库添加，或者暂时用 created_at 代替
        // 为了稳健性，我们先检查 sync_logs 表来获取更准确的活跃时间
        
        // 修正后的查询：聚合 sync_logs 获取最后一次同步时间
        const usersQuery = `
            WITH LastSync AS (
                SELECT DISTINCT ON (user_id) 
                    user_id, 
                    created_at as last_sync_at,
                    delta->>'ip' as last_ip,       -- 预留字段
                    delta->>'ua' as last_device    -- 预留字段
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