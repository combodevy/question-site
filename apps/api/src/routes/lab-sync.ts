import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import {
    DEFAULT_LAB_SETTINGS,
    LabSyncPushRequestSchema,
    parseLabSettings,
} from '@qs/shared';
import { MAX_JSON_BYTES, readJsonBody } from '../lib/crypto.js';
import { rowToCanonicalQuestion, type V2QuestionRow } from '../lib/v2-helpers.js';
import { requireAuth } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

interface LabMetaRow {
    user_id: string;
    version: number;
    sync_seq: number;
    history_reset_seq: number;
    last_practice_time: number | null;
    settings_json: string;
    updated_at: number;
}

function ensureLabUserSyncMeta(rawDb: Database.Database, userId: string): LabMetaRow {
    const existing = rawDb
        .prepare('SELECT * FROM lab_user_sync_meta WHERE user_id = ?')
        .get(userId) as LabMetaRow | undefined;
    if (existing) return existing;

    const now = Date.now();
    rawDb
        .prepare(
            `INSERT INTO lab_user_sync_meta
                (user_id, version, sync_seq, history_reset_seq, last_practice_time, settings_json, updated_at)
             VALUES (?, 0, 0, 0, NULL, ?, ?)`
        )
        .run(userId, JSON.stringify(DEFAULT_LAB_SETTINGS), now);

    return rawDb
        .prepare('SELECT * FROM lab_user_sync_meta WHERE user_id = ?')
        .get(userId) as LabMetaRow;
}

export function createLabSyncRouter(): Hono<AppEnv> {
    const router = new Hono<AppEnv>();
    router.use('*', requireAuth);

    router.post('/push', async (c) => {
        const rawDb = c.get('rawDb');
        const authUser = c.get('authUser');

        const body = await readJsonBody<Record<string, unknown>>(c.req.raw, MAX_JSON_BYTES);
        if (!body) return c.json({ error: '无效的 JSON 请求体或体积超限' }, 400);

        const parsed = LabSyncPushRequestSchema.safeParse(body);
        if (!parsed.success) {
            return c.json(
                { error: '科学精练同步载荷格式无效', detail: parsed.error.issues[0]?.message },
                400
            );
        }

        const { mutations } = parsed.data;
        const now = Date.now();

        const txResult = rawDb.transaction(() => {
            const meta = ensureLabUserSyncMeta(rawDb, authUser.id);
            let syncSeq = meta.sync_seq;
            let historyResetSeq = meta.history_reset_seq;
            let lastPracticeTime = meta.last_practice_time;
            let settingsJson = meta.settings_json || JSON.stringify(DEFAULT_LAB_SETTINGS);
            let appliedCount = 0;

            const checkApplied = rawDb.prepare(
                'SELECT 1 FROM lab_applied_ops WHERE user_id = ? AND op_id = ?'
            );
            const recordApplied = rawDb.prepare(
                'INSERT OR IGNORE INTO lab_applied_ops (user_id, op_id, applied_at) VALUES (?, ?, ?)'
            );

            const results: Array<Record<string, unknown>> = [];

            for (const m of mutations) {
                if (checkApplied.get(authUser.id, m.opId)) {
                    results.push({ opId: m.opId, op: m.op, status: 'duplicate' });
                    continue;
                }

                syncSeq += 1;
                const seq = syncSeq;

                if (m.op === 'lab_append_history') {
                    const insertHist = rawDb.prepare(
                        `INSERT OR IGNORE INTO lab_answer_history
                            (user_id, rid, question_id, is_correct, answered_at, duration_ms, capped,
                             confidence, rating, mode, blind_recall, requeued, sync_seq)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                    );
                    let maxEntryT = lastPracticeTime ?? 0;
                    for (const h of m.entries) {
                        insertHist.run(
                            authUser.id,
                            h.rid,
                            h.id,
                            h.r ? 1 : 0,
                            h.t,
                            typeof h.d === 'number' ? Math.round(h.d) : null,
                            h.capped ? 1 : 0,
                            h.conf ?? null,
                            h.rating ?? null,
                            h.mode ?? null,
                            h.blind ? 1 : 0,
                            h.requeued ? 1 : 0,
                            seq
                        );
                        if (h.t > maxEntryT) maxEntryT = h.t;
                    }
                    if (typeof m.lastPracticeTime === 'number' && m.lastPracticeTime > maxEntryT) {
                        maxEntryT = m.lastPracticeTime;
                    }
                    if (maxEntryT > 0) lastPracticeTime = maxEntryT;
                    results.push({ opId: m.opId, op: m.op, status: 'applied', syncSeq: seq });
                } else if (m.op === 'lab_clear_history') {
                    rawDb
                        .prepare('DELETE FROM lab_answer_history WHERE user_id = ?')
                        .run(authUser.id);
                    rawDb
                        .prepare(
                            `UPDATE lab_question_flags
                             SET mistake_hidden = 0, updated_at = ?, sync_seq = ?
                             WHERE user_id = ? AND mistake_hidden = 1`
                        )
                        .run(now, seq, authUser.id);
                    historyResetSeq = seq;
                    lastPracticeTime = null;
                    results.push({ opId: m.opId, op: m.op, status: 'applied', syncSeq: seq });
                } else if (m.op === 'lab_set_flag') {
                    const existingFlag = rawDb
                        .prepare(
                            'SELECT starred, mistake_hidden FROM lab_question_flags WHERE user_id = ? AND question_id = ?'
                        )
                        .get(authUser.id, m.questionId) as
                        | { starred: number; mistake_hidden: number }
                        | undefined;

                    const nextStarred =
                        typeof m.starred === 'boolean'
                            ? m.starred
                                ? 1
                                : 0
                            : (existingFlag?.starred ?? 0);
                    const nextHidden =
                        typeof m.mistakeHidden === 'boolean'
                            ? m.mistakeHidden
                                ? 1
                                : 0
                            : (existingFlag?.mistake_hidden ?? 0);

                    rawDb
                        .prepare(
                            `INSERT INTO lab_question_flags
                                (user_id, question_id, starred, mistake_hidden, updated_at, sync_seq)
                             VALUES (?, ?, ?, ?, ?, ?)
                             ON CONFLICT(user_id, question_id) DO UPDATE SET
                                starred = excluded.starred,
                                mistake_hidden = excluded.mistake_hidden,
                                updated_at = excluded.updated_at,
                                sync_seq = excluded.sync_seq`
                        )
                        .run(
                            authUser.id,
                            m.questionId,
                            nextStarred,
                            nextHidden,
                            m.updatedAt ?? now,
                            seq
                        );
                    results.push({ opId: m.opId, op: m.op, status: 'applied', syncSeq: seq });
                } else if (m.op === 'lab_restore_hidden_mistakes') {
                    rawDb
                        .prepare(
                            `UPDATE lab_question_flags
                             SET mistake_hidden = 0, updated_at = ?, sync_seq = ?
                             WHERE user_id = ? AND mistake_hidden = 1`
                        )
                        .run(now, seq, authUser.id);
                    results.push({ opId: m.opId, op: m.op, status: 'applied', syncSeq: seq });
                } else if (m.op === 'lab_update_settings') {
                    settingsJson = JSON.stringify(parseLabSettings(m.settings));
                    results.push({ opId: m.opId, op: m.op, status: 'applied', syncSeq: seq });
                }

                recordApplied.run(authUser.id, m.opId, now);
                appliedCount += 1;
            }

            const nextVersion = appliedCount > 0 ? meta.version + 1 : meta.version;
            if (appliedCount > 0) {
                rawDb
                    .prepare(
                        `UPDATE lab_user_sync_meta
                         SET version = ?, sync_seq = ?, history_reset_seq = ?, last_practice_time = ?, settings_json = ?, updated_at = ?
                         WHERE user_id = ?`
                    )
                    .run(
                        nextVersion,
                        syncSeq,
                        historyResetSeq,
                        lastPracticeTime,
                        settingsJson,
                        now,
                        authUser.id
                    );

                const cutoffMs = now - 30 * 86_400_000;
                rawDb
                    .prepare('DELETE FROM lab_applied_ops WHERE user_id = ? AND applied_at < ?')
                    .run(authUser.id, cutoffMs);
            }

            return { cursor: syncSeq, version: nextVersion, results };
        })();

        return c.json({ ok: true, ...txResult }, 200);
    });

    router.get('/pull', async (c) => {
        const rawDb = c.get('rawDb');
        const authUser = c.get('authUser');

        const cursorRaw = parseInt(c.req.query('cursor') || '0', 10);
        const cursor = Number.isFinite(cursorRaw) && cursorRaw > 0 ? cursorRaw : 0;

        const bankCursorRaw = parseInt(c.req.query('bankCursor') || '0', 10);
        const bankCursor = Number.isFinite(bankCursorRaw) && bankCursorRaw > 0 ? bankCursorRaw : 0;

        // Shared Question Bank: strictly read-only from v2_user_sync_meta + v2_questions
        const v2Meta = rawDb
            .prepare('SELECT bank_name, sync_seq FROM v2_user_sync_meta WHERE user_id = ?')
            .get(authUser.id) as { bank_name: string; sync_seq: number } | undefined;

        const qRows = (
            bankCursor === 0
                ? rawDb
                      .prepare(
                          'SELECT * FROM v2_questions WHERE user_id = ? AND purged = 0 ORDER BY sync_seq ASC'
                      )
                      .all(authUser.id)
                : rawDb
                      .prepare(
                          'SELECT * FROM v2_questions WHERE user_id = ? AND sync_seq > ? ORDER BY sync_seq ASC'
                      )
                      .all(authUser.id, bankCursor)
        ) as V2QuestionRow[];

        const questions = qRows.map((row) => ({
            ...rowToCanonicalQuestion(row),
            version: row.version,
            deletedAt: row.deleted_at,
            deleteReason: row.delete_reason,
            originalPath:
                row.original_sub || row.original_chap
                    ? { sub: row.original_sub, chap: row.original_chap }
                    : undefined,
            wasStarred: row.was_starred === 1,
            purged: row.purged === 1,
            updatedAt: row.updated_at,
            syncSeq: row.sync_seq,
        }));

        const labMeta = rawDb
            .prepare('SELECT * FROM lab_user_sync_meta WHERE user_id = ?')
            .get(authUser.id) as LabMetaRow | undefined;

        let parsedSettings = { ...DEFAULT_LAB_SETTINGS };
        if (labMeta?.settings_json) {
            try {
                parsedSettings = parseLabSettings(JSON.parse(labMeta.settings_json));
            } catch {
                parsedSettings = { ...DEFAULT_LAB_SETTINGS };
            }
        }

        if (!labMeta) {
            return c.json(
                {
                    ok: true,
                    cursor: 0,
                    version: 0,
                    bankCursor: v2Meta?.sync_seq ?? 0,
                    historyResetRequired: false,
                    meta: {
                        bankName: v2Meta?.bank_name ?? null,
                        lastPracticeTime: null,
                    },
                    settings: parsedSettings,
                    questions,
                    history: [],
                    flags: [],
                },
                200
            );
        }

        const hRows = rawDb
            .prepare(
                `SELECT rid, question_id, is_correct, answered_at, duration_ms, capped,
                        confidence, rating, mode, blind_recall, requeued, sync_seq
                 FROM lab_answer_history
                 WHERE user_id = ? AND sync_seq > ?
                 ORDER BY answered_at ASC`
            )
            .all(authUser.id, cursor) as Array<{
            rid: string;
            question_id: string;
            is_correct: number;
            answered_at: number;
            duration_ms: number | null;
            capped: number;
            confidence: number | null;
            rating: number | null;
            mode: string | null;
            blind_recall: number;
            requeued: number;
            sync_seq: number;
        }>;

        const history = hRows.map((h) => ({
            rid: h.rid,
            id: h.question_id,
            r: h.is_correct === 1,
            t: h.answered_at,
            ...(typeof h.duration_ms === 'number' ? { d: h.duration_ms } : {}),
            ...(h.capped === 1 ? { capped: true } : {}),
            ...(h.confidence === 1 || h.confidence === 2 || h.confidence === 3
                ? { conf: h.confidence }
                : {}),
            ...(h.rating === 1 || h.rating === 2 || h.rating === 3 || h.rating === 4
                ? { rating: h.rating }
                : {}),
            ...(h.mode ? { mode: h.mode } : {}),
            ...(h.blind_recall === 1 ? { blind: true } : {}),
            ...(h.requeued === 1 ? { requeued: true } : {}),
            syncSeq: h.sync_seq,
        }));

        const flagRows = rawDb
            .prepare(
                `SELECT question_id, starred, mistake_hidden, updated_at, sync_seq
                 FROM lab_question_flags
                 WHERE user_id = ? AND sync_seq > ?
                 ORDER BY sync_seq ASC`
            )
            .all(authUser.id, cursor) as Array<{
            question_id: string;
            starred: number;
            mistake_hidden: number;
            updated_at: number;
            sync_seq: number;
        }>;

        const flags = flagRows.map((f) => ({
            questionId: f.question_id,
            starred: f.starred === 1,
            mistakeHidden: f.mistake_hidden === 1,
            updatedAt: f.updated_at,
            syncSeq: f.sync_seq,
        }));

        return c.json(
            {
                ok: true,
                cursor: labMeta.sync_seq,
                version: labMeta.version,
                bankCursor: v2Meta?.sync_seq ?? 0,
                historyResetRequired: cursor > 0 && labMeta.history_reset_seq > cursor,
                meta: {
                    bankName: v2Meta?.bank_name ?? null,
                    lastPracticeTime: labMeta.last_practice_time ?? null,
                },
                settings: parsedSettings,
                questions,
                history,
                flags,
            },
            200
        );
    });

    return router;
}
