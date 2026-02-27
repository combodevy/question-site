/**
 * @file api/admin/users/get-bank.js
 * @description 获取指定用户的完整题库详情
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

    const targetUserId = req.query.userId;
    if (!targetUserId) {
        res.status(400).json({ error: 'Missing userId parameter' });
        return;
    }

    try {
        // 1. 获取题库元数据
        const sets = await query(
            'select id, name, state, version, created_at from question_sets where user_id = $1 order by id desc limit 1',
            [targetUserId]
        );

        if (sets.rows.length === 0) {
            res.status(404).json({ error: 'User question bank not found' });
            return;
        }

        const set = sets.rows[0];
        const setId = set.id;

        // 2. 获取所有题目内容
        const rows = await query('select content from questions where question_set_id = $1', [setId]);
        
        // 3. 组装数据
        const questions = rows.rows.map(r => {
            let q = r.content;
            if (typeof q === 'string') {
                try { q = JSON.parse(q); } catch (e) { q = null; }
            }
            return q;
        }).filter(q => q);

        res.status(200).json({
            ok: true,
            user_id: targetUserId,
            bank_info: {
                id: set.id,
                name: set.name,
                version: set.version,
                created_at: set.created_at,
                state: set.state // 包含历史记录、错题本状态等
            },
            questions: questions,
            total_questions: questions.length
        });

    } catch (err) {
        const detail = (err && err.message) || (typeof err === 'string' ? err : JSON.stringify(err));
        console.error('Admin Get Bank Error:', detail);
        res.status(500).json({ error: 'Database error', detail });
    }
};