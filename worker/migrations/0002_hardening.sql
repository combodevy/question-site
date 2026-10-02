-- Migration: Hardening (2026-10)
-- 1) 快照表：每用户保留最近一份「全量保存前的完整 state」，防客户端 bug 写坏数据（服务端最后的回滚手段）
CREATE TABLE IF NOT EXISTS bank_snapshots (
    user_id TEXT PRIMARY KEY,
    set_id INTEGER,
    version INTEGER,
    state TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2) 唯一不变量：每用户恰好一个题集。
--    先清理历史重复行（保留 id 最大的一行 = 现行语义 ORDER BY id DESC LIMIT 1），
--    再加唯一索引——此后并发首存的 INSERT 竞态会收到 UNIQUE 错误，由 Worker 转 409 走合并。
DELETE FROM questions WHERE question_set_id IN (
    SELECT id FROM question_sets
    WHERE user_id IN (SELECT user_id FROM question_sets GROUP BY user_id HAVING COUNT(*) > 1)
      AND id NOT IN (SELECT MAX(id) FROM question_sets GROUP BY user_id)
);
DELETE FROM question_sets WHERE id NOT IN (SELECT MAX(id) FROM question_sets GROUP BY user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_question_sets_user_unique ON question_sets(user_id);
