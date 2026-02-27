/**
 * @file api/admin/users-update-bank.js
 * @description 管理员强制更新用户题库接口
 * @author Engineer
 * @date 2026-02-27
 */

const { query } = require('../_db');
const { verifyAdmin } = require('./_middleware');
const { handleCors } = require('../_cors');
const Ably = require('ably');

const ablyApiKey = process.env.ABLY_API_KEY;
const realtimeNotifyUrl = process.env.REALTIME_NOTIFY_URL || '';
const realtimeNotifySecret = process.env.REALTIME_NOTIFY_SECRET || '';

async function notifyRealtimeGateway(userId, payload) {
    if (!realtimeNotifyUrl || !userId) return;
    try {
        await fetch(realtimeNotifyUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(realtimeNotifySecret ? { Authorization: `Bearer ${realtimeNotifySecret}` } : {})
            },
            body: JSON.stringify({ userId, ...payload })
        });
    } catch (e) {}
}

module.exports = async (req, res) => {
    if (handleCors(req, res)) return;

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    const admin = await verifyAdmin(req);
    if (!admin) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }

    const { userId, bankData } = req.body;
    
    if (!userId || !bankData) {
        res.status(400).json({ error: 'Missing userId or bankData' });
        return;
    }

    try {
        await query('BEGIN');

        // 1. 获取目标题库 ID (如果前端没传 setId，则默认找最新的一个)
        // 注意：这里需要支持多科目，前端应该传递明确的 setId
        let setId = bankData.info ? bankData.info.id : null;

        if (!setId) {
             // Fallback: 找该用户最新的一个题库
            const existing = await query(
                'select id from question_sets where user_id = $1 order by created_at desc limit 1',
                [userId]
            );
            if (existing.rows.length === 0) {
                await query('ROLLBACK');
                res.status(404).json({ error: 'User has no question sets' });
                return;
            }
            setId = existing.rows[0].id;
        }

        // 2. 准备更新数据
        const newName = bankData.info ? bankData.info.name : 'Untitled Bank';
        const newState = bankData.info ? bankData.info.state : {}; // 这是一个 JSON 对象
        const questions = Array.isArray(bankData.questions) ? bankData.questions : [];
        
        // 3. 更新元数据 (Metadata)
        // 增加版本号，触发前端同步
        const updateRes = await query(
            `UPDATE question_sets 
             SET name = $1, state = $2, version = COALESCE(version, 0) + 1 
             WHERE id = $3 AND user_id = $4
             RETURNING version`,
            [newName, newState, setId, userId]
        );
        
        const nextVersion = updateRes.rows[0]?.version;

        // 4. 全量替换题目 (Full Replacement)
        // 先删除旧题目
        await query('DELETE FROM questions WHERE question_set_id = $1', [setId]);

        // 再插入新题目
        if (questions.length > 0) {
            const values = [];
            const params = [setId];
            let paramIdx = 2;
            
            for (const q of questions) {
                values.push(`($1, $${paramIdx}::jsonb)`);
                params.push(JSON.stringify(q));
                paramIdx++;
            }
            
            const insertQuery = `INSERT INTO questions (question_set_id, content) VALUES ${values.join(',')}`;
            await query(insertQuery, params);
        }

        await query('COMMIT');

        // 5. 记录日志
        await query(
            'INSERT INTO sync_logs (user_id, delta, status, error) VALUES ($1, $2, $3, $4)',
            [userId, { action: 'admin_update', setId, questionCount: questions.length }, 'success', null]
        );

        // 6. 发送实时通知 (Ably)
        if (ablyApiKey) {
            try {
                const ably = new Ably.Rest(ablyApiKey);
                const channel = ably.channels.get(`sync:${userId}`);
                channel.publish('update', { 
                    type: 'admin_update',
                    setId: setId,
                    timestamp: Date.now() 
                });
            } catch (e) {
                console.error('Ably Publish Error:', e);
            }
        }

        // 7. 发送自建 Realtime Gateway 通知
        notifyRealtimeGateway(userId, { type: 'admin_update', setId, version: nextVersion });

        res.json({ ok: true, version: nextVersion });

    } catch (err) {
        await query('ROLLBACK');
        console.error('Update Bank Error:', err);
        res.status(500).json({ error: 'Database error', detail: err.message });
    }
};
