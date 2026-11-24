import { Hono } from 'hono';
import {
    SyncPushRequestSchema,
    isSafeKey,
    normalizeQuestion,
} from '@qs/shared';
import { MAX_JSON_BYTES, readJsonBody } from '../lib/crypto.js';
import {
    ensureUserSyncMeta,
    rowToCanonicalQuestion,
    type V2QuestionRow,
} from '../lib/v2-helpers.js';
import { requireAuth } from '../middleware/auth.js';
import { clientIp } from '../middleware/rate-limit.js';
import type { AppEnv } from '../types.js';

export function createSyncV2Router(): Hono<AppEnv> {
    const router = new Hono<AppEnv>();
    router.use('*', requireAuth);

    router.post('/push', async (c) => {
        const rawDb = c.get('rawDb');
        const authUser = c.get('authUser');

        const body = await readJsonBody<Record<string, unknown>>(c.req.raw, MAX_JSON_BYTES);
        if (!body) return c.json({ error: '无效的 JSON 请求体或体积超限' }, 400);

        const parsed = SyncPushRequestSchema.safeParse(body);
        if (!parsed.success) {
            return c.json(
                { error: '同步载荷格式无效', detail: parsed.error.issues[0]?.message },
                400
            );
        }

        const { mutations } = parsed.data;
        const ip = clientIp(c.req.raw);
        const ua = c.req.header('user-agent') || 'unknown';
        const now = Date.now();

        const txResult = rawDb.transaction(() => {
            const meta = ensureUserSyncMeta(rawDb, authUser.id);
            let syncSeq = meta.sync_seq;
            let historyResetSeq = meta.history_reset_seq;
            let bankName = meta.bank_name;
            let lastPracticeTime = meta.last_practice_time;
            let appliedCount = 0;

            const checkApplied = rawDb.prepare(
                'SELECT 1 FROM v2_applied_ops WHERE user_id = ? AND op_id = ?'
            );
            const recordApplied = rawDb.prepare(
                'INSERT OR IGNORE INTO v2_applied_ops (user_id, op_id, applied_at) VALUES (?, ?, ?)'
            );
            const getQuestion = rawDb.prepare(
                'SELECT * FROM v2_questions WHERE user_id = ? AND id = ?'
            );

            const results: Array<Record<string, unknown>> = [];

            for (const m of mutations) {
                if (checkApplied.get(authUser.id, m.opId)) {
                    results.push({ opId: m.opId, op: m.op, status: 'duplicate' });
                    continue;
                }

                syncSeq += 1;
                const seq = syncSeq;

                if (m.op === 'upsert_question') {
                    const existing = getQuestion.get(authUser.id, m.question.id) as
                        | V2QuestionRow
                        | undefined;

                    if (
                        typeof m.baseVersion === 'number' &&
                        existing &&
                        existing.purged === 0 &&
                        existing.version !== m.baseVersion
                    ) {
                        syncSeq -= 1;
                        results.push({
                            opId: m.opId,
                            op: m.op,
                            status: 'conflict',
                            serverVersion: existing.version,
                            serverDeleted: existing.deleted_at !== null,
                            serverQuestion: rowToCanonicalQuestion(existing),
                        });
                        continue;
                    }

                    const norm = normalizeQuestion(m.question);
                    if (!norm) {
                        syncSeq -= 1;
                        results.push({ opId: m.opId, op: m.op, status: 'invalid' });
                        continue;
                    }

                    const nextQVersion = existing ? existing.version + 1 : 1;
                    rawDb
                        .prepare(
                            `INSERT INTO v2_questions
                                (user_id, id, sub, chap, type, q, options_json, a, d, media_json, psg, self_check, edited_at,
                                 version, deleted_at, deleted_by, delete_reason, original_sub, original_chap, was_starred, purged, updated_at, sync_seq)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, 0, 0, ?, ?)
                             ON CONFLICT(user_id, id) DO UPDATE SET
                                sub = excluded.sub,
                                chap = excluded.chap,
                                type = excluded.type,
                                q = excluded.q,
                                options_json = excluded.options_json,
                                a = excluded.a,
                                d = excluded.d,
                                media_json = excluded.media_json,
                                psg = excluded.psg,
                                self_check = excluded.self_check,
                                edited_at = excluded.edited_at,
                                version = ?,
                                deleted_at = NULL,
                                deleted_by = NULL,
                                delete_reason = NULL,
                                original_sub = NULL,
                                original_chap = NULL,
                                was_starred = 0,
                                purged = 0,
                                updated_at = excluded.updated_at,
                                sync_seq = excluded.sync_seq`
                        )
                        .run(
                            authUser.id,
                            norm.id,
                            norm.sub,
                            norm.chap,
                            norm.type,
                            norm.q,
                            JSON.stringify(norm.o || []),
                            norm.a,
                            norm.d || '',
                            norm.media ? JSON.stringify(norm.media) : null,
                            norm.psg ?? null,
                            typeof norm.selfCheck === 'boolean' ? (norm.selfCheck ? 1 : 0) : null,
                            typeof norm._editedAt === 'number' ? norm._editedAt : now,
                            nextQVersion,
                            now,
                            seq,
                            nextQVersion
                        );

                    results.push({
                        opId: m.opId,
                        op: m.op,
                        status: 'applied',
                        version: nextQVersion,
                        syncSeq: seq,
                    });
                } else if (m.op === 'delete_question') {
                    const existing = getQuestion.get(authUser.id, m.questionId) as
                        | V2QuestionRow
                        | undefined;
                    if (!existing || existing.purged === 1) {
                        syncSeq -= 1;
                        results.push({ opId: m.opId, op: m.op, status: 'not_found' });
                        continue;
                    }

                    const flagRow = rawDb
                        .prepare(
                            'SELECT starred FROM v2_question_flags WHERE user_id = ? AND question_id = ?'
                        )
                        .get(authUser.id, m.questionId) as { starred: number } | undefined;
                    const wasStarred = flagRow?.starred === 1 ? 1 : 0;

                    rawDb
                        .prepare(
                            `UPDATE v2_questions
                             SET deleted_at = ?, deleted_by = ?, delete_reason = ?,
                                 original_sub = COALESCE(original_sub, sub),
                                 original_chap = COALESCE(original_chap, chap),
                                 was_starred = ?, version = version + 1, updated_at = ?, sync_seq = ?
                             WHERE user_id = ? AND id = ?`
                        )
                        .run(
                            m.deletedAt ?? now,
                            m.deletedBy || 'user',
                            m.reason || 'manual-delete',
                            wasStarred,
                            now,
                            seq,
                            authUser.id,
                            m.questionId
                        );

                    if (wasStarred) {
                        rawDb
                            .prepare(
                                `INSERT INTO v2_question_flags (user_id, question_id, starred, mistake_hidden, updated_at, sync_seq)
                                 VALUES (?, ?, 0, 0, ?, ?)
                                 ON CONFLICT(user_id, question_id) DO UPDATE SET
                                    starred = 0, updated_at = excluded.updated_at, sync_seq = excluded.sync_seq`
                            )
                            .run(authUser.id, m.questionId, now, seq);
                    }
                    results.push({ opId: m.opId, op: m.op, status: 'applied', syncSeq: seq });
                } else if (m.op === 'restore_question') {
                    const existing = getQuestion.get(authUser.id, m.questionId) as
                        | V2QuestionRow
                        | undefined;
                    if (!existing || existing.purged === 1) {
                        syncSeq -= 1;
                        results.push({ opId: m.opId, op: m.op, status: 'not_found' });
                        continue;
                    }
                    const nextSub =
                        m.sub && isSafeKey(m.sub)
                            ? m.sub
                            : existing.original_sub || existing.sub;
                    const nextChap =
                        m.chap && isSafeKey(m.chap)
                            ? m.chap
                            : existing.original_chap || existing.chap;

                    rawDb
                        .prepare(
                            `UPDATE v2_questions
                             SET sub = ?, chap = ?, deleted_at = NULL, deleted_by = NULL, delete_reason = NULL,
                                 original_sub = NULL, original_chap = NULL, version = version + 1, updated_at = ?, sync_seq = ?
                             WHERE user_id = ? AND id = ?`
                        )
                        .run(nextSub, nextChap, now, seq, authUser.id, m.questionId);

                    if (existing.was_starred === 1) {
                        rawDb
                            .prepare(
                                `INSERT INTO v2_question_flags (user_id, question_id, starred, mistake_hidden, updated_at, sync_seq)
                                 VALUES (?, ?, 1, 0, ?, ?)
                                 ON CONFLICT(user_id, question_id) DO UPDATE SET
                                    starred = 1, updated_at = excluded.updated_at, sync_seq = excluded.sync_seq`
                            )
                            .run(authUser.id, m.questionId, now, seq);
                        rawDb
                            .prepare(
                                'UPDATE v2_questions SET was_starred = 0 WHERE user_id = ? AND id = ?'
                            )
                            .run(authUser.id, m.questionId);
                    }
                    results.push({ opId: m.opId, op: m.op, status: 'applied', syncSeq: seq });
                } else if (m.op === 'destroy_question') {
                    rawDb
                        .prepare(
                            `UPDATE v2_questions
                             SET purged = 1, deleted_at = COALESCE(deleted_at, ?), version = version + 1, updated_at = ?, sync_seq = ?
                             WHERE user_id = ? AND id = ?`
                        )
                        .run(now, now, seq, authUser.id, m.questionId);
                    rawDb
                        .prepare(
                            `UPDATE v2_question_flags
                             SET starred = 0, updated_at = ?, sync_seq = ?
                             WHERE user_id = ? AND question_id = ? AND starred = 1`
                        )
                        .run(now, seq, authUser.id, m.questionId);
                    results.push({ opId: m.opId, op: m.op, status: 'applied', syncSeq: seq });
                } else if (m.op === 'empty_trash') {
                    rawDb
                        .prepare(
                            `UPDATE v2_questions
                             SET purged = 1, version = version + 1, updated_at = ?, sync_seq = ?
                             WHERE user_id = ? AND deleted_at IS NOT NULL AND purged = 0`
                        )
                        .run(now, seq, authUser.id);
                    results.push({ opId: m.opId, op: m.op, status: 'applied', syncSeq: seq });
                } else if (m.op === 'append_history') {
                    const insertHist = rawDb.prepare(
                        `INSERT OR IGNORE INTO v2_answer_history
                            (user_id, rid, question_id, is_correct, answered_at, duration_ms, capped, sync_seq)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
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
                            seq
                        );
                        if (h.t > maxEntryT) maxEntryT = h.t;
                    }
                    if (typeof m.lastPracticeTime === 'number' && m.lastPracticeTime > maxEntryT) {
                        maxEntryT = m.lastPracticeTime;
                    }
                    if (maxEntryT > 0) lastPracticeTime = maxEntryT;
                    results.push({ opId: m.opId, op: m.op, status: 'applied', syncSeq: seq });
                } else if (m.op === 'clear_history') {
                    rawDb.prepare('DELETE FROM v2_answer_history WHERE user_id = ?').run(authUser.id);
                    rawDb
                        .prepare(
                            'UPDATE v2_question_flags SET mistake_hidden = 0, updated_at = ?, sync_seq = ? WHERE user_id = ? AND mistake_hidden = 1'
                        )
                        .run(now, seq, authUser.id);
                    historyResetSeq = seq;
                    lastPracticeTime = null;
                    results.push({ opId: m.opId, op: m.op, status: 'applied', syncSeq: seq });
                } else if (m.op === 'clear_bank') {
                    rawDb
                        .prepare(
                            `UPDATE v2_questions
                             SET purged = 1, deleted_at = COALESCE(deleted_at, ?), version = version + 1, updated_at = ?, sync_seq = ?
                             WHERE user_id = ? AND deleted_at IS NULL AND purged = 0`
                        )
                        .run(now, now, seq, authUser.id);
                    rawDb
                        .prepare(
                            'UPDATE v2_question_flags SET starred = 0, updated_at = ?, sync_seq = ? WHERE user_id = ? AND starred = 1'
                        )
                        .run(now, seq, authUser.id);
                    results.push({ opId: m.opId, op: m.op, status: 'applied', syncSeq: seq });
                } else if (m.op === 'set_flag') {
                    const existingFlag = rawDb
                        .prepare(
                            'SELECT starred, mistake_hidden FROM v2_question_flags WHERE user_id = ? AND question_id = ?'
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
                            `INSERT INTO v2_question_flags (user_id, question_id, starred, mistake_hidden, updated_at, sync_seq)
                             VALUES (?, ?, ?, ?, ?, ?)
                             ON CONFLICT(user_id, question_id) DO UPDATE SET
                                starred = excluded.starred,
                                mistake_hidden = excluded.mistake_hidden,
                                updated_at = excluded.updated_at,
                                sync_seq = excluded.sync_seq`
                        )
                        .run(authUser.id, m.questionId, nextStarred, nextHidden, m.updatedAt ?? now, seq);
                    results.push({ opId: m.opId, op: m.op, status: 'applied', syncSeq: seq });
                } else if (m.op === 'restore_hidden_mistakes') {
                    rawDb
                        .prepare(
                            `UPDATE v2_question_flags
                             SET mistake_hidden = 0, updated_at = ?, sync_seq = ?
                             WHERE user_id = ? AND mistake_hidden = 1`
                        )
                        .run(now, seq, authUser.id);
                    results.push({ opId: m.opId, op: m.op, status: 'applied', syncSeq: seq });
                } else if (m.op === 'update_meta') {
                    if (typeof m.bankName === 'string' && m.bankName.trim()) {
                        bankName = m.bankName.trim();
                    }
                    if (m.lastPracticeTime !== undefined) {
                        lastPracticeTime =
                            m.lastPracticeTime === null
                                ? null
                                : Math.max(lastPracticeTime ?? 0, m.lastPracticeTime);
                    }
                    results.push({ opId: m.opId, op: m.op, status: 'applied', syncSeq: seq });
                } else if (m.op === 'upsert_english_progress') {
                    rawDb
                        .prepare(
                            `INSERT INTO v2_english_progress
                                (user_id, paper_id, answers_json, graded, result_json, updated_at, sync_seq)
                             VALUES (?, ?, ?, ?, ?, ?, ?)
                             ON CONFLICT(user_id, paper_id) DO UPDATE SET
                                answers_json = excluded.answers_json,
                                graded = excluded.graded,
                                result_json = excluded.result_json,
                                updated_at = excluded.updated_at,
                                sync_seq = excluded.sync_seq`
                        )
                        .run(
                            authUser.id,
                            m.paperId,
                            JSON.stringify(m.answers),
                            m.graded ? 1 : 0,
                            m.result ? JSON.stringify(m.result) : null,
                            m.updatedAt ?? now,
                            seq
                        );
                    results.push({ opId: m.opId, op: m.op, status: 'applied', syncSeq: seq });
                }

                recordApplied.run(authUser.id, m.opId, now);
                appliedCount += 1;
            }

            const nextVersion = appliedCount > 0 ? meta.version + 1 : meta.version;
            if (appliedCount > 0) {
                rawDb
                    .prepare(
                        `UPDATE v2_user_sync_meta
                         SET bank_name = ?, version = ?, sync_seq = ?, history_reset_seq = ?, last_practice_time = ?, updated_at = ?
                         WHERE user_id = ?`
                    )
                    .run(
                        bankName,
                        nextVersion,
                        syncSeq,
                        historyResetSeq,
                        lastPracticeTime,
                        now,
                        authUser.id
                    );

                rawDb
                    .prepare(
                        'INSERT INTO sync_logs (user_id, delta, status, error) VALUES (?, ?, ?, ?)'
                    )
                    .run(
                        authUser.id,
                        JSON.stringify({ v2Ops: appliedCount, ip, ua }),
                        'success',
                        null
                    );

                // 清理超过 30 天的幂等 opId 与旧同步日志
                const cutoffMs = now - 30 * 86_400_000;
                rawDb
                    .prepare('DELETE FROM v2_applied_ops WHERE user_id = ? AND applied_at < ?')
                    .run(authUser.id, cutoffMs);
                rawDb
                    .prepare(
                        "DELETE FROM sync_logs WHERE user_id = ? AND created_at < datetime('now', '-30 days')"
                    )
                    .run(authUser.id);
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

        const meta = rawDb
            .prepare('SELECT * FROM v2_user_sync_meta WHERE user_id = ?')
            .get(authUser.id) as
            | {
                  user_id: string;
                  legacy_set_id: number | null;
                  bank_name: string;
                  version: number;
                  sync_seq: number;
                  history_reset_seq: number;
                  last_practice_time: number | null;
              }
            | undefined;

        if (!meta) {
            return c.json(
                {
                    ok: true,
                    cursor: 0,
                    version: 0,
                    historyResetRequired: false,
                    meta: { bankName: null, lastPracticeTime: null },
                    questions: [],
                    history: [],
                    flags: [],
                    englishProgress: [],
                },
                200
            );
        }

        const qRows = (
            cursor === 0
                ? rawDb
                      .prepare(
                          'SELECT * FROM v2_questions WHERE user_id = ? AND purged = 0 ORDER BY sync_seq ASC'
                      )
                      .all(authUser.id)
                : rawDb
                      .prepare(
                          'SELECT * FROM v2_questions WHERE user_id = ? AND sync_seq > ? ORDER BY sync_seq ASC'
                      )
                      .all(authUser.id, cursor)
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

        const hRows = rawDb
            .prepare(
                'SELECT rid, question_id, is_correct, answered_at, duration_ms, capped, sync_seq FROM v2_answer_history WHERE user_id = ? AND sync_seq > ? ORDER BY answered_at ASC'
            )
            .all(authUser.id, cursor) as Array<{
            rid: string;
            question_id: string;
            is_correct: number;
            answered_at: number;
            duration_ms: number | null;
            capped: number;
            sync_seq: number;
        }>;

        const history = hRows.map((h) => ({
            rid: h.rid,
            id: h.question_id,
            r: h.is_correct === 1,
            t: h.answered_at,
            ...(typeof h.duration_ms === 'number' ? { d: h.duration_ms } : {}),
            ...(h.capped === 1 ? { capped: true } : {}),
            syncSeq: h.sync_seq,
        }));

        const flagRows = rawDb
            .prepare(
                'SELECT question_id, starred, mistake_hidden, updated_at, sync_seq FROM v2_question_flags WHERE user_id = ? AND sync_seq > ? ORDER BY sync_seq ASC'
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

        const engRows = rawDb
            .prepare(
                'SELECT paper_id, answers_json, graded, result_json, updated_at, sync_seq FROM v2_english_progress WHERE user_id = ? AND sync_seq > ? ORDER BY sync_seq ASC'
            )
            .all(authUser.id, cursor) as Array<{
            paper_id: string;
            answers_json: string;
            graded: number;
            result_json: string | null;
            updated_at: number;
            sync_seq: number;
        }>;

        const englishProgress = engRows.map((e) => {
            let answers: Record<string, string> = {};
            let result: unknown = null;
            try {
                answers = JSON.parse(e.answers_json || '{}');
            } catch {
                answers = {};
            }
            if (e.result_json) {
                try {
                    result = JSON.parse(e.result_json);
                } catch {
                    result = null;
                }
            }
            return {
                paperId: e.paper_id,
                answers,
                graded: e.graded === 1,
                result,
                updatedAt: e.updated_at,
                syncSeq: e.sync_seq,
            };
        });

        return c.json(
            {
                ok: true,
                cursor: meta.sync_seq,
                version: meta.version,
                historyResetRequired: cursor > 0 && meta.history_reset_seq > cursor,
                meta: {
                    bankName: meta.bank_name,
                    lastPracticeTime: meta.last_practice_time ?? null,
                },
                questions,
                history,
                flags,
                englishProgress,
            },
            200
        );
    });

    return router;
}
