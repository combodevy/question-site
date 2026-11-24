import type Database from 'better-sqlite3';
import { isSafeKey, normalizeQuestion } from '@qs/shared';

export interface MigrationReport {
    dryRun: boolean;
    migratedUsers: number;
    skippedAlreadyMigrated: number;
    activeQuestions: number;
    trashQuestions: number;
    historyEntries: number;
    starredFlags: number;
    hiddenMistakeFlags: number;
    userDetails: Array<{
        userId: string;
        setId: number;
        version: number;
        activeQuestions: number;
        trashQuestions: number;
        historyEntries: number;
        starredFlags: number;
        hiddenMistakeFlags: number;
    }>;
}

const LEGACY_AND_V2_DDL = `
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    token_version INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS question_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    version INTEGER NOT NULL DEFAULT 0,
    state TEXT
);
CREATE INDEX IF NOT EXISTS idx_question_sets_user ON question_sets(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_question_sets_user_unique ON question_sets(user_id);

CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_set_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    FOREIGN KEY(question_set_id) REFERENCES question_sets(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_questions_set_id ON questions(question_set_id);

CREATE TABLE IF NOT EXISTS sync_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    delta TEXT,
    status TEXT NOT NULL,
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sync_logs_user ON sync_logs(user_id);

CREATE TABLE IF NOT EXISTS bank_snapshots (
    user_id TEXT PRIMARY KEY,
    set_id INTEGER,
    version INTEGER,
    state TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_user_backups_lookup ON user_backups(user_id, type, id DESC);

CREATE TABLE IF NOT EXISTS v2_refresh_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT UNIQUE NOT NULL,
    user_agent TEXT,
    ip TEXT,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_refresh_tokens_user ON v2_refresh_tokens(user_id);

CREATE TABLE IF NOT EXISTS v2_user_sync_meta (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    legacy_set_id INTEGER,
    bank_name TEXT NOT NULL DEFAULT '默认题库',
    version INTEGER NOT NULL DEFAULT 0,
    sync_seq INTEGER NOT NULL DEFAULT 0,
    history_reset_seq INTEGER NOT NULL DEFAULT 0,
    last_practice_time INTEGER,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS v2_questions (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    sub TEXT NOT NULL,
    chap TEXT NOT NULL,
    type TEXT NOT NULL,
    q TEXT NOT NULL,
    options_json TEXT NOT NULL DEFAULT '[]',
    a TEXT NOT NULL,
    d TEXT NOT NULL DEFAULT '',
    media_json TEXT,
    psg TEXT,
    self_check INTEGER,
    edited_at INTEGER,
    version INTEGER NOT NULL DEFAULT 1,
    deleted_at INTEGER,
    deleted_by TEXT,
    delete_reason TEXT,
    original_sub TEXT,
    original_chap TEXT,
    was_starred INTEGER NOT NULL DEFAULT 0,
    purged INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    sync_seq INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_v2_questions_sync_seq ON v2_questions(user_id, sync_seq);
CREATE INDEX IF NOT EXISTS idx_v2_questions_active ON v2_questions(user_id, deleted_at, purged);

CREATE TABLE IF NOT EXISTS v2_answer_history (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rid TEXT NOT NULL,
    question_id TEXT NOT NULL,
    is_correct INTEGER NOT NULL,
    answered_at INTEGER NOT NULL,
    duration_ms INTEGER,
    capped INTEGER NOT NULL DEFAULT 0,
    sync_seq INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, rid)
);
CREATE INDEX IF NOT EXISTS idx_v2_history_sync_seq ON v2_answer_history(user_id, sync_seq);
CREATE INDEX IF NOT EXISTS idx_v2_history_answered ON v2_answer_history(user_id, answered_at);

CREATE TABLE IF NOT EXISTS v2_question_flags (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL,
    starred INTEGER NOT NULL DEFAULT 0,
    mistake_hidden INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    sync_seq INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_v2_flags_sync_seq ON v2_question_flags(user_id, sync_seq);

CREATE TABLE IF NOT EXISTS v2_english_progress (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    paper_id TEXT NOT NULL,
    answers_json TEXT NOT NULL DEFAULT '{}',
    graded INTEGER NOT NULL DEFAULT 0,
    result_json TEXT,
    updated_at INTEGER NOT NULL,
    sync_seq INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, paper_id)
);
CREATE INDEX IF NOT EXISTS idx_v2_english_sync_seq ON v2_english_progress(user_id, sync_seq);

CREATE TABLE IF NOT EXISTS v2_applied_ops (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    op_id TEXT NOT NULL,
    applied_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, op_id)
);
`;

export function ensureV2Schema(rawDb: Database.Database): void {
    rawDb.pragma('foreign_keys = ON');
    rawDb.exec(LEGACY_AND_V2_DDL);

    // 兼容既有的 users 表（缺少 token_version 列时无损补列）
    const cols = rawDb.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'token_version')) {
        rawDb.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1');
    }
}

interface LegacySetRow {
    id: number;
    user_id: string;
    name: string;
    version: number;
    state: string | null;
}

export function migrateLegacyToV2(
    rawDb: Database.Database,
    options?: { dryRun?: boolean }
): MigrationReport {
    const dryRun = Boolean(options?.dryRun);
    if (!dryRun) {
        ensureV2Schema(rawDb);
    }

    const report: MigrationReport = {
        dryRun,
        migratedUsers: 0,
        skippedAlreadyMigrated: 0,
        activeQuestions: 0,
        trashQuestions: 0,
        historyEntries: 0,
        starredFlags: 0,
        hiddenMistakeFlags: 0,
        userDetails: [],
    };

    const runMigrationBody = () => {
        if (dryRun) {
            ensureV2Schema(rawDb);
        }

        const now = Date.now();
        const sets = rawDb
            .prepare(
                `SELECT qs.id, qs.user_id, qs.name, qs.version, qs.state
                 FROM question_sets qs
                 INNER JOIN users u ON u.id = qs.user_id
                 WHERE qs.id IN (SELECT MAX(id) FROM question_sets GROUP BY user_id)`
            )
            .all() as LegacySetRow[];

        const checkExistingMeta = rawDb.prepare(
            'SELECT 1 FROM v2_user_sync_meta WHERE user_id = ?'
        );
        const selectLegacyQuestions = rawDb.prepare(
            'SELECT content FROM questions WHERE question_set_id = ? ORDER BY id ASC'
        );

        const insertMeta = rawDb.prepare(
            `INSERT INTO v2_user_sync_meta
                (user_id, legacy_set_id, bank_name, version, sync_seq, history_reset_seq, last_practice_time, updated_at)
             VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
        );

        const insertQuestion = rawDb.prepare(
            `INSERT INTO v2_questions
                (user_id, id, sub, chap, type, q, options_json, a, d, media_json, psg, self_check, edited_at,
                 version, deleted_at, deleted_by, delete_reason, original_sub, original_chap, was_starred, purged, updated_at, sync_seq)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 1)`
        );

        const insertHistory = rawDb.prepare(
            `INSERT OR IGNORE INTO v2_answer_history
                (user_id, rid, question_id, is_correct, answered_at, duration_ms, capped, sync_seq)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
        );

        const upsertFlag = rawDb.prepare(
            `INSERT INTO v2_question_flags (user_id, question_id, starred, mistake_hidden, updated_at, sync_seq)
             VALUES (?, ?, ?, ?, ?, 1)
             ON CONFLICT(user_id, question_id) DO UPDATE SET
                starred = MAX(starred, excluded.starred),
                mistake_hidden = MAX(mistake_hidden, excluded.mistake_hidden),
                updated_at = excluded.updated_at`
        );

        for (const s of sets) {
            const already = checkExistingMeta.get(s.user_id);
            if (already) {
                report.skippedAlreadyMigrated += 1;
                continue;
            }

            let parsedState: Record<string, unknown> = {};
            if (s.state) {
                try {
                    const p = JSON.parse(s.state);
                    if (p && typeof p === 'object' && !Array.isArray(p)) {
                        parsedState = p as Record<string, unknown>;
                    }
                } catch {
                    parsedState = {};
                }
            }

            const qRows = selectLegacyQuestions.all(s.id) as Array<{ content: string }>;
            const rawQuestions: Array<Record<string, unknown>> = [];

            if (qRows.length > 0) {
                for (const row of qRows) {
                    try {
                        const q = JSON.parse(row.content);
                        if (q && typeof q === 'object') {
                            rawQuestions.push(q as Record<string, unknown>);
                        }
                    } catch {
                        // ignore corrupted JSON line
                    }
                }
            } else if (
                parsedState.bank &&
                typeof parsedState.bank === 'object' &&
                !Array.isArray(parsedState.bank)
            ) {
                const bankObj = parsedState.bank as Record<string, Record<string, unknown[]>>;
                for (const sub of Object.keys(bankObj)) {
                    const chaps = bankObj[sub];
                    if (!chaps || typeof chaps !== 'object') continue;
                    for (const chap of Object.keys(chaps)) {
                        const arr = chaps[chap];
                        if (!Array.isArray(arr)) continue;
                        for (const item of arr) {
                            if (item && typeof item === 'object') {
                                rawQuestions.push({
                                    ...(item as Record<string, unknown>),
                                    sub: (item as Record<string, unknown>).sub || sub,
                                    chap: (item as Record<string, unknown>).chap || chap,
                                });
                            }
                        }
                    }
                }
            }

            const seenQuestionIds = new Set<string>();
            let userActive = 0;
            let userTrash = 0;
            let userHistory = 0;
            let userStarred = 0;
            let userHidden = 0;

            for (let i = 0; i < rawQuestions.length; i += 1) {
                const rawQ = rawQuestions[i];
                const normalized = normalizeQuestion(rawQ);
                if (!normalized) continue;

                let qid = normalized.id;
                if (seenQuestionIds.has(qid)) {
                    qid = `${qid}::dup::${i}`;
                }
                seenQuestionIds.add(qid);

                insertQuestion.run(
                    s.user_id,
                    qid,
                    normalized.sub,
                    normalized.chap,
                    normalized.type,
                    normalized.q,
                    JSON.stringify(normalized.o || []),
                    normalized.a,
                    normalized.d || '',
                    normalized.media ? JSON.stringify(normalized.media) : null,
                    normalized.psg ?? null,
                    typeof normalized.selfCheck === 'boolean' ? (normalized.selfCheck ? 1 : 0) : null,
                    typeof normalized._editedAt === 'number' ? normalized._editedAt : null,
                    1,
                    null,
                    null,
                    null,
                    null,
                    null,
                    0,
                    now
                );
                userActive += 1;
            }

            if (
                parsedState.trash &&
                typeof parsedState.trash === 'object' &&
                !Array.isArray(parsedState.trash)
            ) {
                const trashObj = parsedState.trash as Record<string, Record<string, unknown[]>>;
                let trashIdx = 0;
                for (const sub of Object.keys(trashObj)) {
                    const chaps = trashObj[sub];
                    if (!chaps || typeof chaps !== 'object') continue;
                    for (const chap of Object.keys(chaps)) {
                        const arr = chaps[chap];
                        if (!Array.isArray(arr)) continue;
                        for (const item of arr) {
                            if (!item || typeof item !== 'object') continue;
                            const rawT = item as Record<string, unknown>;
                            const normalized = normalizeQuestion({
                                ...rawT,
                                sub: isSafeKey(rawT.sub) ? rawT.sub : sub,
                                chap: isSafeKey(rawT.chap) ? rawT.chap : chap,
                            });
                            if (!normalized) continue;

                            let tid = normalized.id;
                            if (seenQuestionIds.has(tid)) {
                                tid = `${tid}::trash::${trashIdx}`;
                            }
                            seenQuestionIds.add(tid);
                            trashIdx += 1;

                            const origPath =
                                rawT.originalPath && typeof rawT.originalPath === 'object'
                                    ? (rawT.originalPath as Record<string, unknown>)
                                    : null;
                            const origSub =
                                origPath && isSafeKey(origPath.sub)
                                    ? origPath.sub
                                    : isSafeKey(sub)
                                      ? sub
                                      : normalized.sub;
                            const origChap =
                                origPath && isSafeKey(origPath.chap)
                                    ? origPath.chap
                                    : isSafeKey(chap)
                                      ? chap
                                      : normalized.chap;

                            const deletedAt =
                                typeof rawT.deletedAt === 'number' && Number.isFinite(rawT.deletedAt)
                                    ? rawT.deletedAt
                                    : now;
                            const deletedBy =
                                typeof rawT.deletedBy === 'string' ? rawT.deletedBy : null;
                            const deleteReason =
                                typeof rawT.reason === 'string' ? rawT.reason : 'manual-delete';
                            const wasStarred = rawT.wasStarred ? 1 : 0;

                            insertQuestion.run(
                                s.user_id,
                                tid,
                                isSafeKey(sub) ? sub : normalized.sub,
                                isSafeKey(chap) ? chap : normalized.chap,
                                normalized.type,
                                normalized.q,
                                JSON.stringify(normalized.o || []),
                                normalized.a,
                                normalized.d || '',
                                normalized.media ? JSON.stringify(normalized.media) : null,
                                normalized.psg ?? null,
                                typeof normalized.selfCheck === 'boolean'
                                    ? normalized.selfCheck
                                        ? 1
                                        : 0
                                    : null,
                                typeof normalized._editedAt === 'number' ? normalized._editedAt : null,
                                1,
                                deletedAt,
                                deletedBy,
                                deleteReason,
                                origSub,
                                origChap,
                                wasStarred,
                                now
                            );
                            userTrash += 1;
                        }
                    }
                }
            }

            if (Array.isArray(parsedState.history)) {
                for (let idx = 0; idx < parsedState.history.length; idx += 1) {
                    const h = parsedState.history[idx] as Record<string, unknown> | null;
                    if (
                        !h ||
                        typeof h !== 'object' ||
                        typeof h.id !== 'string' ||
                        typeof h.r !== 'boolean' ||
                        typeof h.t !== 'number' ||
                        !Number.isFinite(h.t)
                    ) {
                        continue;
                    }
                    const rid =
                        typeof h.rid === 'string' && h.rid.trim()
                            ? h.rid
                            : `legacy:${h.id}:${h.t}:${idx}`;
                    const dur =
                        typeof h.d === 'number' && Number.isFinite(h.d) && h.d >= 0
                            ? Math.round(h.d)
                            : null;
                    const capped = h.capped ? 1 : 0;

                    insertHistory.run(
                        s.user_id,
                        rid,
                        h.id,
                        h.r ? 1 : 0,
                        h.t,
                        dur,
                        capped
                    );
                    userHistory += 1;
                }
            }

            if (Array.isArray(parsedState.starred)) {
                const uniqueStars = new Set(
                    parsedState.starred.filter((id): id is string => typeof id === 'string' && id.length > 0)
                );
                for (const qid of uniqueStars) {
                    upsertFlag.run(s.user_id, qid, 1, 0, now);
                    userStarred += 1;
                }
            }

            if (Array.isArray(parsedState.hiddenMistakeIds)) {
                const uniqueHidden = new Set(
                    parsedState.hiddenMistakeIds.filter(
                        (id): id is string => typeof id === 'string' && id.length > 0
                    )
                );
                for (const qid of uniqueHidden) {
                    upsertFlag.run(s.user_id, qid, 0, 1, now);
                    userHidden += 1;
                }
            }

            const bankName =
                (typeof parsedState.bankName === 'string' && parsedState.bankName) ||
                s.name ||
                '默认题库';
            const lastPracticeTime =
                typeof parsedState.lastPracticeTime === 'number' &&
                Number.isFinite(parsedState.lastPracticeTime)
                    ? parsedState.lastPracticeTime
                    : null;

            insertMeta.run(
                s.user_id,
                s.id,
                bankName,
                typeof s.version === 'number' ? s.version : 0,
                1,
                lastPracticeTime,
                now
            );

            report.migratedUsers += 1;
            report.activeQuestions += userActive;
            report.trashQuestions += userTrash;
            report.historyEntries += userHistory;
            report.starredFlags += userStarred;
            report.hiddenMistakeFlags += userHidden;
            report.userDetails.push({
                userId: s.user_id,
                setId: s.id,
                version: s.version,
                activeQuestions: userActive,
                trashQuestions: userTrash,
                historyEntries: userHistory,
                starredFlags: userStarred,
                hiddenMistakeFlags: userHidden,
            });
        }
    };

    rawDb.exec('BEGIN IMMEDIATE');
    try {
        runMigrationBody();
        if (dryRun) {
            rawDb.exec('ROLLBACK');
        } else {
            rawDb.exec('COMMIT');
        }
    } catch (err) {
        try {
            rawDb.exec('ROLLBACK');
        } catch {
            // ignore rollback error
        }
        throw err;
    }

    return report;
}
