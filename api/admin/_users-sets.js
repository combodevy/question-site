/**
 * @file api/admin/users-sets.js
 * @description 获取指定用户的所有题库列表
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

    const userId = req.query.userId;
    if (!userId) {
        res.status(400).json({ error: 'Missing userId' });
        return;
    }

    try {
        const result = await query(`
            SELECT 
                id,
                name,
                version,
                state,
                created_at,
                (SELECT count(*) FROM questions q WHERE q.question_set_id = qs.id) as question_count
            FROM question_sets qs
            WHERE user_id = $1
            ORDER BY created_at DESC
        `, [userId]);

        res.status(200).json({
            ok: true,
            user_id: userId,
            sets: result.rows
        });

    } catch (err) {
        console.error('Admin Get Sets Error:', err);
        res.status(500).json({ error: 'Database error' });
    }
};
