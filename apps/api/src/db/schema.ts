import { sql } from 'drizzle-orm';
import {
    index,
    integer,
    primaryKey,
    sqliteTable,
    text,
    uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// ==========================================
// Legacy tables (kept intact for rollback safety & backups/logs)
// ==========================================

export const users = sqliteTable('users', {
    id: text('id').primaryKey(),
    username: text('username').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    salt: text('salt').notNull(),
    tokenVersion: integer('token_version').notNull().default(1),
    createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const questionSets = sqliteTable(
    'question_sets',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        userId: text('user_id').notNull(),
        name: text('name').notNull(),
        createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
        version: integer('version').notNull().default(0),
        state: text('state'),
    },
    (table) => ({
        userIdx: index('idx_question_sets_user').on(table.userId),
        userUniqueIdx: uniqueIndex('idx_question_sets_user_unique').on(table.userId),
    })
);

export const legacyQuestions = sqliteTable(
    'questions',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        questionSetId: integer('question_set_id').notNull(),
        content: text('content').notNull(),
    },
    (table) => ({
        setIdx: index('idx_questions_set_id').on(table.questionSetId),
    })
);

export const syncLogs = sqliteTable(
    'sync_logs',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        userId: text('user_id').notNull(),
        delta: text('delta'),
        status: text('status').notNull(),
        error: text('error'),
        createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
    },
    (table) => ({
        userIdx: index('idx_sync_logs_user').on(table.userId),
    })
);

export const bankSnapshots = sqliteTable('bank_snapshots', {
    userId: text('user_id').primaryKey(),
    setId: integer('set_id'),
    version: integer('version'),
    state: text('state'),
    createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const userBackups = sqliteTable(
    'user_backups',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        userId: text('user_id').notNull(),
        type: text('type').notNull(),
        payload: text('payload').notNull(),
        createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
    },
    (table) => ({
        lookupIdx: index('idx_user_backups_lookup').on(table.userId, table.type, table.id),
    })
);

// ==========================================
// Normalized v2 tables
// ==========================================

export const v2RefreshTokens = sqliteTable(
    'v2_refresh_tokens',
    {
        id: text('id').primaryKey(),
        userId: text('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        tokenHash: text('token_hash').notNull().unique(),
        userAgent: text('user_agent'),
        ip: text('ip'),
        expiresAt: integer('expires_at').notNull(),
        revokedAt: integer('revoked_at'),
        createdAt: integer('created_at').notNull(),
    },
    (table) => ({
        userIdx: index('idx_v2_refresh_tokens_user').on(table.userId),
    })
);

export const v2UserSyncMeta = sqliteTable('v2_user_sync_meta', {
    userId: text('user_id')
        .primaryKey()
        .references(() => users.id, { onDelete: 'cascade' }),
    legacySetId: integer('legacy_set_id'),
    bankName: text('bank_name').notNull().default('默认题库'),
    version: integer('version').notNull().default(0),
    syncSeq: integer('sync_seq').notNull().default(0),
    historyResetSeq: integer('history_reset_seq').notNull().default(0),
    lastPracticeTime: integer('last_practice_time'),
    updatedAt: integer('updated_at').notNull(),
});

export const v2Questions = sqliteTable(
    'v2_questions',
    {
        userId: text('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        id: text('id').notNull(),
        sub: text('sub').notNull(),
        chap: text('chap').notNull(),
        type: text('type').notNull(),
        q: text('q').notNull(),
        optionsJson: text('options_json').notNull().default('[]'),
        a: text('a').notNull(),
        d: text('d').notNull().default(''),
        mediaJson: text('media_json'),
        psg: text('psg'),
        selfCheck: integer('self_check'),
        editedAt: integer('edited_at'),
        version: integer('version').notNull().default(1),
        deletedAt: integer('deleted_at'),
        deletedBy: text('deleted_by'),
        deleteReason: text('delete_reason'),
        originalSub: text('original_sub'),
        originalChap: text('original_chap'),
        wasStarred: integer('was_starred').notNull().default(0),
        purged: integer('purged').notNull().default(0),
        updatedAt: integer('updated_at').notNull(),
        syncSeq: integer('sync_seq').notNull().default(1),
    },
    (table) => ({
        pk: primaryKey({ columns: [table.userId, table.id] }),
        syncSeqIdx: index('idx_v2_questions_sync_seq').on(table.userId, table.syncSeq),
        activeIdx: index('idx_v2_questions_active').on(
            table.userId,
            table.deletedAt,
            table.purged
        ),
    })
);

export const v2AnswerHistory = sqliteTable(
    'v2_answer_history',
    {
        userId: text('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        rid: text('rid').notNull(),
        questionId: text('question_id').notNull(),
        isCorrect: integer('is_correct').notNull(),
        answeredAt: integer('answered_at').notNull(),
        durationMs: integer('duration_ms'),
        capped: integer('capped').notNull().default(0),
        syncSeq: integer('sync_seq').notNull().default(1),
    },
    (table) => ({
        pk: primaryKey({ columns: [table.userId, table.rid] }),
        syncSeqIdx: index('idx_v2_history_sync_seq').on(table.userId, table.syncSeq),
        answeredIdx: index('idx_v2_history_answered').on(table.userId, table.answeredAt),
    })
);

export const v2QuestionFlags = sqliteTable(
    'v2_question_flags',
    {
        userId: text('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        questionId: text('question_id').notNull(),
        starred: integer('starred').notNull().default(0),
        mistakeHidden: integer('mistake_hidden').notNull().default(0),
        updatedAt: integer('updated_at').notNull(),
        syncSeq: integer('sync_seq').notNull().default(1),
    },
    (table) => ({
        pk: primaryKey({ columns: [table.userId, table.questionId] }),
        syncSeqIdx: index('idx_v2_flags_sync_seq').on(table.userId, table.syncSeq),
    })
);

export const v2EnglishProgress = sqliteTable(
    'v2_english_progress',
    {
        userId: text('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        paperId: text('paper_id').notNull(),
        answersJson: text('answers_json').notNull().default('{}'),
        graded: integer('graded').notNull().default(0),
        resultJson: text('result_json'),
        updatedAt: integer('updated_at').notNull(),
        syncSeq: integer('sync_seq').notNull().default(1),
    },
    (table) => ({
        pk: primaryKey({ columns: [table.userId, table.paperId] }),
        syncSeqIdx: index('idx_v2_english_sync_seq').on(table.userId, table.syncSeq),
    })
);

export const v2AppliedOps = sqliteTable(
    'v2_applied_ops',
    {
        userId: text('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        opId: text('op_id').notNull(),
        appliedAt: integer('applied_at').notNull(),
    },
    (table) => ({
        pk: primaryKey({ columns: [table.userId, table.opId] }),
    })
);
