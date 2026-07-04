-- Migration: Initial Schema for question-site

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Question Sets Table
CREATE TABLE IF NOT EXISTS question_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    version INTEGER NOT NULL DEFAULT 0,
    state TEXT -- JSON string in SQLite
);

-- Indexing for fast lookups
CREATE INDEX IF NOT EXISTS idx_question_sets_user ON question_sets(user_id);

-- 3. Questions Table
CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_set_id INTEGER NOT NULL,
    content TEXT NOT NULL, -- JSON string in SQLite
    FOREIGN KEY(question_set_id) REFERENCES question_sets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_questions_set_id ON questions(question_set_id);

-- 4. Sync Logs Table
CREATE TABLE IF NOT EXISTS sync_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    delta TEXT, -- JSON string in SQLite
    status TEXT NOT NULL,
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sync_logs_user ON sync_logs(user_id);
