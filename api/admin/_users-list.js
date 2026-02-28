/**
 * @file api/admin/users-list.js
 * @description 获取所有用户列表及其活跃状态 (Grouped by User)
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
        // 尝试获取 auth.users 表权限，如果失败则降级
        let useAuthTable = true;
        try {
            await query('SELECT 1 FROM auth.users LIMIT 1');
        } catch (e) {
            console.warn('Cannot access auth.users table, falling back to ID only:', e.message);
            useAuthTable = false;
        }

        // 聚合查询：按用户分组
        // 1. 获取每个用户最新的 sync_logs 记录 (IP, UA, Last Active)
        // 2. 统计每个用户的题库数量
        // 3. 关联 auth.users 获取邮箱 (如果有权限)
        
        let sql = '';
        if (useAuthTable) {
            sql = `
                WITH UserStats AS (
                    SELECT 
                        user_id,
                        COUNT(*) as bank_count,
                        MAX(created_at) as last_created_at
                    FROM question_sets
                    GROUP BY user_id
                ),
                LastSync AS (
                    SELECT DISTINCT ON (user_id)
                        user_id,
                        created_at as last_sync_at,
                        delta->>'ip' as last_ip,
                        delta->>'ua' as last_device
                    FROM sync_logs
                    ORDER BY user_id, created_at DESC
                )
                SELECT 
                    us.user_id,
                    au.email,
                    au.raw_user_meta_data->>'username' as username,
                    us.bank_count,
                    COALESCE(ls.last_sync_at, us.last_created_at) as last_active_at,
                    ls.last_ip,
                    ls.last_device
                FROM UserStats us
                LEFT JOIN LastSync ls ON us.user_id = ls.user_id
                LEFT JOIN auth.users au ON us.user_id::uuid = au.id
                ORDER BY last_active_at DESC NULLS LAST
                LIMIT 50
            `;
        } else {
            sql = `
                WITH UserStats AS (
                    SELECT 
                        user_id,
                        COUNT(*) as bank_count,
                        MAX(created_at) as last_created_at
                    FROM question_sets
                    GROUP BY user_id
                ),
                LastSync AS (
                    SELECT DISTINCT ON (user_id)
                        user_id,
                        created_at as last_sync_at,
                        delta->>'ip' as last_ip,
                        delta->>'ua' as last_device
                    FROM sync_logs
                    ORDER BY user_id, created_at DESC
                )
                SELECT 
                    us.user_id,
                    us.bank_count,
                    COALESCE(ls.last_sync_at, us.last_created_at) as last_active_at,
                    ls.last_ip,
                    ls.last_device
                FROM UserStats us
                LEFT JOIN LastSync ls ON us.user_id = ls.user_id
                ORDER BY last_active_at DESC NULLS LAST
                LIMIT 50
            `;
        }
        
        const result = await query(sql);
        
        res.status(200).json({ 
            ok: true, 
            users: result.rows,
            meta: {
                total: result.rowCount,
                email_access: useAuthTable
            }
        });

    } catch (err) {
        const detail = (err && err.message) || (typeof err === 'string' ? err : JSON.stringify(err));
        console.error('Admin List Error:', detail);
        res.status(500).json({ error: 'Database error', detail });
    }
};
