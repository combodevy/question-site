/**
 * @file api/admin/delete-users.js
 * @description 批量删除用户 (Soft delete or Hard delete based on policy)
 * @author Engineer
 * @date 2026-02-27
 */

const { query } = require('../_db');
const { verifyAdmin } = require('./_middleware');
const { handleCors } = require('../_cors');

module.exports = async (req, res) => {
    if (handleCors(req, res)) return;

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    const admin = await verifyAdmin(req);
    if (!admin) {
        res.status(403).json({ error: 'Forbidden: Admin access required' });
        return;
    }

    const { userIds } = req.body;
    
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
        res.status(400).json({ error: 'userIds array is required' });
        return;
    }

    try {
        // 1. 删除用户题库
        await query('DELETE FROM question_sets WHERE user_id = ANY($1)', [userIds]);
        
        // 2. 删除同步日志
        await query('DELETE FROM sync_logs WHERE user_id = ANY($1)', [userIds]);

        // 3. (可选) 如果有权限，删除 auth.users
        // 注意：Supabase postgres role 通常没有权限直接删除 auth.users
        // 这里我们只清除业务数据，实现 "逻辑删除" 效果
        
        res.json({ ok: true, deletedCount: userIds.length });

    } catch (err) {
        console.error('Delete Users Error:', err);
        res.status(500).json({ error: 'Internal Server Error', detail: err.message });
    }
};
