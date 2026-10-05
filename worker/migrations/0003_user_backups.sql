-- Migration: user_backups (2026-10)
-- 用户主动清空题库/记录时，自动在云端保留一份备份（每用户每类型最近 5 份），
-- 误删可从设置 → 数据管理 → 云端备份 查看并下载。
CREATE TABLE IF NOT EXISTS user_backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_user_backups_lookup ON user_backups(user_id, type, id DESC);
