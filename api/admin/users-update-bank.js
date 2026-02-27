/**
 * @file api/admin/users/update-bank.js
 * @description 管理员强制更新用户题库接口
 * @author Engineer
 * @date 2026-02-27
 */

const Ably = require('ably');
const { query } = require('../../_db');
const { verifyAdmin } = require('../_middleware');
const { handleCors } = require('../../_cors');

const ablyApiKey = process.env.ABLY_API_KEY || '';
const ablyClient = ablyApiKey ? new Ably.Rest(ablyApiKey) : null;

module.exports = async (req, res) => {
    if (handleCors(req, res)) return;

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    // 1. 验证管理员权限
    const admin = await verifyAdmin(req);
    if (!admin) {
        res.status(403).json({ error: 'Forbidden: Admin access required' });
        return;
    }

    const { userId, bankData } = req.body;
    
    if (!userId || !bankData) {
        res.status(400).json({ error: 'Missing userId or bankData' });
        return;
    }

    try {
        await query('BEGIN');

        // 2. 检查用户是否存在题库
        const existing = await query(
            'select id, version from question_sets where user_id = $1 order by id desc limit 1',
            [userId]
        );

        if (existing.rows.length === 0) {
            await query('ROLLBACK');
            res.status(404).json({ error: 'User question bank not found' });
            return;
        }

        const setId = existing.rows[0].id;
        const currentVersion = existing.rows[0].version || 0;
        const nextVersion = currentVersion + 1;

        // 3. 解析 bankData
        // bankData 结构应为 { info: { state: ... }, questions: [...] }
        const newState = bankData.info ? bankData.info.state : null;
        const newName = bankData.info ? bankData.info.name : 'Admin Updated Bank';
        const newQuestions = Array.isArray(bankData.questions) ? bankData.questions : [];

        // 4. 更新元数据和版本号
        await query(
            'update question_sets set name = $1, state = $2, version = $3 where id = $4',
            [newName, newState, nextVersion, setId]
        );

        // 5. 覆盖题目数据 (Delete + Insert)
        await query('delete from questions where question_set_id = $1', [setId]);

        if (newQuestions.length > 0) {
            const values = [];
            const params = [setId];
            let paramIdx = 2;
            
            for (const q of newQuestions) {
                values.push(`($1, $${paramIdx}::jsonb)`);
                params.push(JSON.stringify(q));
                paramIdx++;
            }
            
            const insertQuery = `insert into questions (question_set_id, content) values ${values.join(',')}`;
            await query(insertQuery, params);
        }

        await query('COMMIT');

        // 6. 记录操作日志 (Admin Operation)
        try {
            const adminId = admin.sub || admin.id;
            await query(
                'insert into sync_logs (user_id, delta, status, error) values ($1, $2, $3, $4)',
                [userId, { action: 'admin_override', adminId }, 'admin_update', null]
            );
        } catch (e) {}

        // 7. 发送 Ably 通知，强制客户端更新
        if (ablyClient) {
            try {
                const channel = ablyClient.channels.get(`user:${userId}`);
                await channel.publish('question-set-updated', {
                    setId,
                    at: new Date().toISOString(),
                    version: nextVersion,
                    by: 'admin'
                });
            } catch (e) {}
        }

        res.status(200).json({ ok: true, version: nextVersion });

    } catch (err) {
        await query('ROLLBACK');
        const detail = (err && err.message) || (typeof err === 'string' ? err : JSON.stringify(err));
        console.error('Admin Update Error:', detail);
        res.status(500).json({ error: 'Database error', detail });
    }
};