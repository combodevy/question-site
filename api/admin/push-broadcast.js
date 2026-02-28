/**
 * @file api/admin/push-broadcast.js
 * @description 全局广播/推送题库 (Global Broadcast)
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

    const { target, userId, userIds, bankName, questions, type } = req.body;
    // target: 'all' | 'user' | 'multi'
    // type: 'notification' | 'bank' (目前仅支持 'bank')

    if (!questions || !Array.isArray(questions)) {
        res.status(400).json({ error: 'Invalid payload: questions array is required' });
        return;
    }

    const safeName = bankName || 'Global Broadcast Bank';

    try {
        let targetUserIds = [];

        if (target === 'user') {
            if (!userId) {
                res.status(400).json({ error: 'UserId is required for target=user' });
                return;
            }
            targetUserIds = [userId];
        } else if (target === 'multi') {
            if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
                res.status(400).json({ error: 'UserIds array is required for target=multi' });
                return;
            }
            targetUserIds = userIds;
        } else if (target === 'all') {
            // 获取所有活跃用户 ID
            // 这里我们只推送给已经在 question_sets 或 sync_logs 中出现过的用户
            const sql = `
                SELECT DISTINCT user_id FROM question_sets
                UNION
                SELECT DISTINCT user_id FROM sync_logs
            `;
            const result = await query(sql);
            targetUserIds = result.rows.map(r => r.user_id);
        } else {
            res.status(400).json({ error: 'Invalid target' });
            return;
        }

        if (targetUserIds.length === 0) {
            res.json({ ok: true, message: 'No users found to push to.' });
            return;
        }

        // 批量插入操作
        // 注意：为了性能，我们可以分批次插入，但这里假设用户量不大，直接循环插入
        // 或者使用 Postgres 的 INSERT INTO ... SELECT ... 语法更高效

        let successCount = 0;
        let failCount = 0;

        // 准备题目数据 (JSONB)
        // 实际上我们是在为每个用户创建一个新的 question_set

        for (const uid of targetUserIds) {
            try {
                // 1. 获取最新 question_set
                const latestSet = await query(
                    'SELECT id FROM question_sets WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
                    [uid]
                );

                let setId;
                if (latestSet.rows.length > 0) {
                    setId = latestSet.rows[0].id;
                } else {
                    const insertSet = await query(
                        'INSERT INTO question_sets (user_id, name, state, version) VALUES ($1, $2, $3, $4) RETURNING id',
                        [uid, safeName, { currentQuestionIndex: 0, answers: {} }, 1]
                    );
                    setId = insertSet.rows[0].id;
                }

                // 2. 插入题目
                if (questions.length > 0) {
                    const values = [];
                    const params = [setId];
                    let paramIdx = 2;

                    for (const q of questions) {
                        // 强制覆盖：如果没填、或者是默认占位符，都必须变成管理员填写的 bankName
                        if (!q.sub || q.sub.trim() === '' || q.sub.toLowerCase().includes('default') || q.sub.toLowerCase().includes('subject name')) {
                            q.sub = safeName;
                        }
                        // 覆盖默认章节名为 Imported
                        if (!q.chap || q.chap.trim() === '' || q.chap.toLowerCase().includes('chapter 1')) {
                            q.chap = 'Imported';
                        }
                        // 兜底补全必填题目标识：防止手工导入 JSON 缺失 id 导致前端错题本崩溃
                        if (!q.id) {
                            q.id = require('crypto').randomUUID();
                        }

                        values.push(`($1, $${paramIdx}::jsonb)`);
                        params.push(JSON.stringify(q));
                        paramIdx++;
                    }

                    const insertQ = `INSERT INTO questions (question_set_id, content) VALUES ${values.join(',')}`;
                    await query(insertQ, params);

                    // 强制更新 version 以打破 ETag/304 缓存，促使用户侧下拉最新题库
                    await query('UPDATE question_sets SET version = version + 1 WHERE id = $1', [setId]);
                }
                successCount++;
            } catch (e) {
                console.error(`Failed to push to user ${uid}:`, e);
                failCount++;
            }
        }

        res.json({
            ok: true,
            summary: {
                target,
                total: targetUserIds.length,
                success: successCount,
                failed: failCount
            }
        });

    } catch (err) {
        console.error('Broadcast Error:', err);
        res.status(500).json({ error: 'Internal Server Error', detail: err.message });
    }
};
