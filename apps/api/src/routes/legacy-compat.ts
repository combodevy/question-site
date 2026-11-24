import { Hono } from 'hono';
import {
    isSafeKey,
    normalizeQuestion,
    questionFingerprint,
    type Question,
} from '@qs/shared';
import { MAX_JSON_BYTES, readJsonBody } from '../lib/crypto.js';
import {
    buildLegacyStateFromV2,
    ensureUserSyncMeta,
    type V2QuestionRow,
} from '../lib/v2-helpers.js';
import { requireAuth } from '../middleware/auth.js';
import { checkRateLimit, clientIp } from '../middleware/rate-limit.js';
import type { AppEnv } from '../types.js';

export function createLegacyCompatRouter(): Hono<AppEnv> {
    const router = new Hono<AppEnv>();
    router.use('*', requireAuth);

    // 1. LOAD QUESTION SET (100% compatible with legacy frontend index.html)
    router.get('/load-question-set', async (c) => {
        const rawDb = c.get('rawDb');
        const authUser = c.get('authUser');

        const meta = rawDb
            .prepare('SELECT legacy_set_id, version FROM v2_user_sync_meta WHERE user_id = ?')
            .get(authUser.id) as { legacy_set_id: number | null; version: number } | undefined;

        if (!meta) {
            return c.json({ ok: true, setId: null, name: null, state: null, version: 0 }, 200);
        }

        const setId = meta.legacy_set_id ?? 1;
        const version = typeof meta.version === 'number' ? meta.version : 0;
        const historyAfter = parseInt(c.req.query('historyAfter') || '0', 10);
        const normAfter = Number.isFinite(historyAfter) && historyAfter > 0 ? historyAfter : 0;
        const fastEtag = `W/"s${setId}-v${version}-h${normAfter}"`;

        const ifNoneMatch = c.req.header('if-none-match');
        if (ifNoneMatch && ifNoneMatch === fastEtag) {
            c.header('ETag', fastEtag);
            return c.body(null, 304);
        }

        const payload = buildLegacyStateFromV2(rawDb, authUser.id, normAfter);
        c.header('ETag', fastEtag);
        c.header('Cache-Control', 'no-cache');
        return c.json({ ok: true, ...payload }, 200);
    });

    // 2. SAVE QUESTION SET (writes to normalized v2_* tables inside atomic SQLite transaction)
    router.post('/save-question-set', async (c) => {
        const rawDb = c.get('rawDb');
        const authUser = c.get('authUser');

        const body = await readJsonBody<Record<string, unknown>>(c.req.raw, MAX_JSON_BYTES);
        if (!body) return c.json({ error: '无效的 JSON 请求体或体积超过 10MB 上限' }, 400);

        const name = typeof body.name === 'string' ? body.name : '';
        if (!name) return c.json({ error: 'name 不能为空' }, 400);

        const questions = Array.isArray(body.questions) ? body.questions : [];
        const state =
            body.state && typeof body.state === 'object' && !Array.isArray(body.state)
                ? (body.state as Record<string, unknown>)
                : null;
        const delta =
            body.delta && typeof body.delta === 'object' && !Array.isArray(body.delta)
                ? (body.delta as Record<string, unknown>)
                : null;
        const clientVersion = typeof body.version === 'number' ? body.version : 0;
        const skipQuestionsUpdate = body.skipQuestionsUpdate === true;
        const historyAppend = Array.isArray(body.historyAppend)
            ? (body.historyAppend as Array<Record<string, unknown>>)
            : null;
        const statePartial = body.statePartial === true;
        const partialFields = Array.isArray(body.partialFields)
            ? (body.partialFields as string[])
            : [];
        const replaceFields = Array.isArray(body.replaceFields)
            ? (body.replaceFields as string[])
            : [];
        const partialValues =
            body.partialValues &&
            typeof body.partialValues === 'object' &&
            !Array.isArray(body.partialValues)
                ? (body.partialValues as Record<string, unknown>)
                : {};

        const ip = clientIp(c.req.raw);
        const ua = c.req.header('user-agent') || 'unknown';
        const logDelta = delta ? { ...delta, ip, ua } : { ip, ua };
        const now = Date.now();

        const result = rawDb.transaction((): {
            conflict?: { serverVersion: number };
            badRequest?: string;
            setId?: number;
            version?: number;
        } => {
            const prevMeta = rawDb
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

            const isFirstSave = !prevMeta;
            const existingMeta =
                prevMeta ||
                ensureUserSyncMeta(rawDb, authUser.id, name);
            const effectiveState: Record<string, unknown> | null =
                state ||
                (isFirstSave ? { history: [], trash: {}, starred: [], hiddenMistakeIds: [] } : null);

            {
                const currentVersion =
                    typeof existingMeta.version === 'number' ? existingMeta.version : 0;
                const isIncremental = statePartial && !effectiveState;
                const isMetadataOnly = skipQuestionsUpdate === true;

                if (
                    !isFirstSave &&
                    clientVersion !== currentVersion &&
                    !isIncremental &&
                    !isMetadataOnly
                ) {
                    rawDb
                        .prepare(
                            'INSERT INTO sync_logs (user_id, delta, status, error) VALUES (?, ?, ?, ?)'
                        )
                        .run(
                            authUser.id,
                            JSON.stringify({ clientVersion, currentVersion, ip, ua }),
                            'conflict',
                            'Version Mismatch'
                        );
                    return { conflict: { serverVersion: currentVersion } };
                }

                if (!statePartial && !effectiveState) {
                    return { badRequest: 'state is required' };
                }

                // 24 小时滚动安全快照（在覆盖前拍摄 v2 状态快照）
                if (!isFirstSave && effectiveState) {
                    let lastSnapAt: number | null = null;
                    try {
                        const snapRow = rawDb
                            .prepare('SELECT created_at FROM bank_snapshots WHERE user_id = ?')
                            .get(authUser.id) as { created_at?: string } | undefined;
                        if (snapRow?.created_at) {
                            lastSnapAt = new Date(
                                String(snapRow.created_at).replace(' ', 'T') + 'Z'
                            ).getTime();
                        }
                    } catch {
                        // ignore
                    }
                    const stale = lastSnapAt == null || now - lastSnapAt > 24 * 3600 * 1000;
                    if (stale) {
                        const snapPayload = buildLegacyStateFromV2(rawDb, authUser.id, 0);
                        if (snapPayload.state) {
                            rawDb
                                .prepare(
                                    `INSERT INTO bank_snapshots (user_id, set_id, version, state, created_at)
                                     VALUES (?, ?, ?, ?, datetime('now'))
                                     ON CONFLICT(user_id) DO UPDATE SET
                                        set_id = excluded.set_id,
                                        version = excluded.version,
                                        state = excluded.state,
                                        created_at = excluded.created_at`
                                )
                                .run(
                                    authUser.id,
                                    existingMeta.legacy_set_id,
                                    currentVersion,
                                    JSON.stringify(snapPayload.state)
                                );
                        }
                    }
                }

                const nextVersion = currentVersion + 1;
                const nextSeq = (existingMeta.sync_seq || 0) + 1;
                let historyResetSeq = existingMeta.history_reset_seq || 0;
                let bankName = name || existingMeta.bank_name || '默认题库';
                let lastPracticeTime = existingMeta.last_practice_time ?? null;

                // 先行原子 CAS 占位，保证并发事务必触发互斥
                const casInfo = rawDb
                    .prepare(
                        `UPDATE v2_user_sync_meta
                         SET version = ?, sync_seq = ?, updated_at = ?
                         WHERE user_id = ? AND version = ?`
                    )
                    .run(nextVersion, nextSeq, now, authUser.id, currentVersion);
                if (casInfo.changes === 0) {
                    const latest = rawDb
                        .prepare('SELECT version FROM v2_user_sync_meta WHERE user_id = ?')
                        .get(authUser.id) as { version: number } | undefined;
                    return { conflict: { serverVersion: latest?.version ?? currentVersion } };
                }

                const insertHist = rawDb.prepare(
                    `INSERT OR IGNORE INTO v2_answer_history
                        (user_id, rid, question_id, is_correct, answered_at, duration_ms, capped, sync_seq)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
                );
                const upsertFlagStar = rawDb.prepare(
                    `INSERT INTO v2_question_flags (user_id, question_id, starred, mistake_hidden, updated_at, sync_seq)
                     VALUES (?, ?, 1, 0, ?, ?)
                     ON CONFLICT(user_id, question_id) DO UPDATE SET
                        starred = 1, updated_at = excluded.updated_at, sync_seq = excluded.sync_seq`
                );
                const upsertFlagHidden = rawDb.prepare(
                    `INSERT INTO v2_question_flags (user_id, question_id, starred, mistake_hidden, updated_at, sync_seq)
                     VALUES (?, ?, 0, 1, ?, ?)
                     ON CONFLICT(user_id, question_id) DO UPDATE SET
                        mistake_hidden = 1, updated_at = excluded.updated_at, sync_seq = excluded.sync_seq`
                );

                if (statePartial && !effectiveState) {
                    // 增量保存模式
                    for (let idx = 0; idx < (historyAppend || []).length; idx += 1) {
                        const h = historyAppend![idx];
                        if (
                            !h ||
                            typeof h.id !== 'string' ||
                            typeof h.r !== 'boolean' ||
                            typeof h.t !== 'number' ||
                            !Number.isFinite(h.t)
                        ) {
                            continue;
                        }
                        const rid =
                            typeof h.rid === 'string' && h.rid
                                ? h.rid
                                : `inc:${h.id}:${h.t}:${idx}`;
                        insertHist.run(
                            authUser.id,
                            rid,
                            h.id,
                            h.r ? 1 : 0,
                            h.t,
                            typeof h.d === 'number' && h.d >= 0 ? Math.round(h.d) : null,
                            h.capped ? 1 : 0,
                            nextSeq
                        );
                    }

                    for (const field of partialFields) {
                        const val = partialValues[field];
                        if (val === undefined) continue;
                        if (field === 'lastPracticeTime') {
                            lastPracticeTime =
                                Math.max(Number(lastPracticeTime) || 0, Number(val) || 0) || null;
                        } else if (field === 'bankName' && typeof val === 'string' && val.trim()) {
                            bankName = val.trim();
                        } else if (field === 'starred' && Array.isArray(val)) {
                            const ids = val.filter(
                                (x): x is string => typeof x === 'string' && x.length > 0
                            );
                            if (replaceFields.includes('starred')) {
                                rawDb
                                    .prepare(
                                        'UPDATE v2_question_flags SET starred = 0, updated_at = ?, sync_seq = ? WHERE user_id = ? AND starred = 1'
                                    )
                                    .run(now, nextSeq, authUser.id);
                            }
                            for (const qid of ids) upsertFlagStar.run(authUser.id, qid, now, nextSeq);
                        } else if (field === 'hiddenMistakeIds' && Array.isArray(val)) {
                            const ids = val.filter(
                                (x): x is string => typeof x === 'string' && x.length > 0
                            );
                            if (replaceFields.includes('hiddenMistakeIds')) {
                                rawDb
                                    .prepare(
                                        'UPDATE v2_question_flags SET mistake_hidden = 0, updated_at = ?, sync_seq = ? WHERE user_id = ? AND mistake_hidden = 1'
                                    )
                                    .run(now, nextSeq, authUser.id);
                            }
                            for (const qid of ids) upsertFlagHidden.run(authUser.id, qid, now, nextSeq);
                        }
                    }
                } else if (effectiveState) {
                    const st = effectiveState;
                    // 全量 / metadata 保存模式
                    if (typeof st.bankName === 'string' && st.bankName.trim()) {
                        bankName = st.bankName.trim();
                    }
                    if (typeof st.lastPracticeTime === 'number' && Number.isFinite(st.lastPracticeTime)) {
                        lastPracticeTime = st.lastPracticeTime;
                    } else if (st.lastPracticeTime === null && !skipQuestionsUpdate) {
                        lastPracticeTime = null;
                    }

                    // 1) 题目表更新（仅 !skipQuestionsUpdate）
                    const keptIds = new Set<string>();
                    const upsertQ = rawDb.prepare(
                        `INSERT INTO v2_questions
                            (user_id, id, sub, chap, type, q, options_json, a, d, media_json, psg, self_check, edited_at,
                             version, deleted_at, deleted_by, delete_reason, original_sub, original_chap, was_starred, purged, updated_at, sync_seq)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 0, ?, ?)
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
                            version = v2_questions.version + 1,
                            deleted_at = excluded.deleted_at,
                            deleted_by = excluded.deleted_by,
                            delete_reason = excluded.delete_reason,
                            original_sub = excluded.original_sub,
                            original_chap = excluded.original_chap,
                            was_starred = excluded.was_starred,
                            purged = 0,
                            updated_at = excluded.updated_at,
                            sync_seq = excluded.sync_seq`
                    );

                    if (!skipQuestionsUpdate) {
                        const seenFingerprints = new Set<string>();
                        const uniqueActive: Question[] = [];
                        for (const rawQ of questions) {
                            const n = normalizeQuestion(rawQ);
                            if (!n) continue;
                            const fp = questionFingerprint(n);
                            if (seenFingerprints.has(fp)) continue;
                            seenFingerprints.add(fp);
                            uniqueActive.push(n);
                        }

                        for (const n of uniqueActive) {
                            let qid = n.id;
                            if (keptIds.has(qid)) {
                                qid = `${qid}::dup::${keptIds.size}`;
                            }
                            keptIds.add(qid);
                            upsertQ.run(
                                authUser.id,
                                qid,
                                n.sub,
                                n.chap,
                                n.type,
                                n.q,
                                JSON.stringify(n.o || []),
                                n.a,
                                n.d || '',
                                n.media ? JSON.stringify(n.media) : null,
                                n.psg ?? null,
                                typeof n.selfCheck === 'boolean' ? (n.selfCheck ? 1 : 0) : null,
                                typeof n._editedAt === 'number' ? n._editedAt : null,
                                null,
                                null,
                                null,
                                null,
                                null,
                                0,
                                now,
                                nextSeq
                            );
                        }
                    } else {
                        const existingActive = rawDb
                            .prepare(
                                'SELECT id FROM v2_questions WHERE user_id = ? AND deleted_at IS NULL AND purged = 0'
                            )
                            .all(authUser.id) as Array<{ id: string }>;
                        for (const row of existingActive) keptIds.add(row.id);
                    }

                    // 2) 回收站同步（全量态以客户端 state.trash 为准）
                    const keptTrashIds = new Set<string>();
                    if (
                        st.trash &&
                        typeof st.trash === 'object' &&
                        !Array.isArray(st.trash)
                    ) {
                        const trashObj = st.trash as Record<string, Record<string, unknown[]>>;
                        let trashIdx = 0;
                        for (const sub of Object.keys(trashObj)) {
                            const chaps = trashObj[sub];
                            if (!chaps || typeof chaps !== 'object') continue;
                            for (const chap of Object.keys(chaps)) {
                                const arr = chaps[chap];
                                if (!Array.isArray(arr)) continue;
                                for (const rawItem of arr) {
                                    if (!rawItem || typeof rawItem !== 'object') continue;
                                    const rawT = rawItem as Record<string, unknown>;
                                    const n = normalizeQuestion({
                                        ...rawT,
                                        sub: isSafeKey(rawT.sub) ? rawT.sub : sub,
                                        chap: isSafeKey(rawT.chap) ? rawT.chap : chap,
                                    });
                                    if (!n) continue;

                                    let tid = n.id;
                                    if (keptIds.has(tid) || keptTrashIds.has(tid)) {
                                        tid = `${tid}::trash::${trashIdx}`;
                                    }
                                    keptTrashIds.add(tid);
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
                                              : n.sub;
                                    const origChap =
                                        origPath && isSafeKey(origPath.chap)
                                            ? origPath.chap
                                            : isSafeKey(chap)
                                              ? chap
                                              : n.chap;

                                    upsertQ.run(
                                        authUser.id,
                                        tid,
                                        isSafeKey(sub) ? sub : n.sub,
                                        isSafeKey(chap) ? chap : n.chap,
                                        n.type,
                                        n.q,
                                        JSON.stringify(n.o || []),
                                        n.a,
                                        n.d || '',
                                        n.media ? JSON.stringify(n.media) : null,
                                        n.psg ?? null,
                                        typeof n.selfCheck === 'boolean'
                                            ? n.selfCheck
                                                ? 1
                                                : 0
                                            : null,
                                        typeof n._editedAt === 'number' ? n._editedAt : null,
                                        typeof rawT.deletedAt === 'number' ? rawT.deletedAt : now,
                                        typeof rawT.deletedBy === 'string' ? rawT.deletedBy : null,
                                        typeof rawT.reason === 'string'
                                            ? rawT.reason
                                            : 'manual-delete',
                                        origSub,
                                        origChap,
                                        rawT.wasStarred ? 1 : 0,
                                        now,
                                        nextSeq
                                    );
                                }
                            }
                        }
                    }

                    // 清理本次全量上传中已不在库的旧题与已清空的旧回收站条目（标记 purged=1 保留同步墓碑）
                    const existingNonPurged = rawDb
                        .prepare(
                            'SELECT id, deleted_at FROM v2_questions WHERE user_id = ? AND purged = 0'
                        )
                        .all(authUser.id) as Array<{ id: string; deleted_at: number | null }>;
                    const markPurged = rawDb.prepare(
                        `UPDATE v2_questions
                         SET purged = 1, deleted_at = COALESCE(deleted_at, ?), version = version + 1, updated_at = ?, sync_seq = ?
                         WHERE user_id = ? AND id = ?`
                    );
                    for (const row of existingNonPurged) {
                        if (row.deleted_at == null && !skipQuestionsUpdate) {
                            if (!keptIds.has(row.id) && !keptTrashIds.has(row.id)) {
                                markPurged.run(now, now, nextSeq, authUser.id, row.id);
                            }
                        } else if (row.deleted_at != null && !statePartial) {
                            if (!keptTrashIds.has(row.id) && !keptIds.has(row.id)) {
                                markPurged.run(now, now, nextSeq, authUser.id, row.id);
                            }
                        }
                    }

                    // 3) 作答历史同步
                    if (Array.isArray(st.history)) {
                        if (!skipQuestionsUpdate) {
                            // 全量保存（含 resetHistory 清空或备份恢复）以客户端为准
                            rawDb
                                .prepare('DELETE FROM v2_answer_history WHERE user_id = ?')
                                .run(authUser.id);
                            if (st.history.length === 0 && !(historyAppend && historyAppend.length)) {
                                historyResetSeq = nextSeq;
                            }
                        }
                        const combinedHist = [
                            ...(st.history as Array<Record<string, unknown>>),
                            ...(historyAppend || []),
                        ];
                        for (let idx = 0; idx < combinedHist.length; idx += 1) {
                            const h = combinedHist[idx];
                            if (
                                !h ||
                                typeof h.id !== 'string' ||
                                typeof h.r !== 'boolean' ||
                                typeof h.t !== 'number' ||
                                !Number.isFinite(h.t)
                            ) {
                                continue;
                            }
                            const rid =
                                typeof h.rid === 'string' && h.rid
                                    ? h.rid
                                    : `full:${h.id}:${h.t}:${idx}`;
                            insertHist.run(
                                authUser.id,
                                rid,
                                h.id,
                                h.r ? 1 : 0,
                                h.t,
                                typeof h.d === 'number' && h.d >= 0 ? Math.round(h.d) : null,
                                h.capped ? 1 : 0,
                                nextSeq
                            );
                        }
                    }

                    // 4) 收藏与隐藏错题标志
                    if (Array.isArray(st.starred)) {
                        if (!skipQuestionsUpdate || replaceFields.includes('starred')) {
                            rawDb
                                .prepare(
                                    'UPDATE v2_question_flags SET starred = 0, updated_at = ?, sync_seq = ? WHERE user_id = ? AND starred = 1'
                                )
                                .run(now, nextSeq, authUser.id);
                        }
                        for (const qid of st.starred) {
                            if (typeof qid === 'string' && qid) {
                                upsertFlagStar.run(authUser.id, qid, now, nextSeq);
                            }
                        }
                    }

                    if (Array.isArray(st.hiddenMistakeIds)) {
                        if (!skipQuestionsUpdate || replaceFields.includes('hiddenMistakeIds')) {
                            rawDb
                                .prepare(
                                    'UPDATE v2_question_flags SET mistake_hidden = 0, updated_at = ?, sync_seq = ? WHERE user_id = ? AND mistake_hidden = 1'
                                )
                                .run(now, nextSeq, authUser.id);
                        }
                        for (const qid of st.hiddenMistakeIds) {
                            if (typeof qid === 'string' && qid) {
                                upsertFlagHidden.run(authUser.id, qid, now, nextSeq);
                            }
                        }
                    }
                }

                rawDb
                    .prepare(
                        `UPDATE v2_user_sync_meta
                         SET bank_name = ?, history_reset_seq = ?, last_practice_time = ?, updated_at = ?
                         WHERE user_id = ?`
                    )
                    .run(bankName, historyResetSeq, lastPracticeTime, now, authUser.id);

                rawDb
                    .prepare(
                        'INSERT INTO sync_logs (user_id, delta, status, error) VALUES (?, ?, ?, ?)'
                    )
                    .run(authUser.id, JSON.stringify(logDelta), 'success', null);
                rawDb
                    .prepare(
                        "DELETE FROM sync_logs WHERE user_id = ? AND created_at < datetime('now', '-30 days')"
                    )
                    .run(authUser.id);

                return { setId: existingMeta.legacy_set_id ?? 1, version: nextVersion };
            }
        })();

        if (result.conflict) {
            return c.json(
                {
                    error: 'Version Conflict',
                    serverVersion: result.conflict.serverVersion,
                    yourVersion: clientVersion,
                },
                409
            );
        }
        if (result.badRequest) {
            return c.json({ error: result.badRequest }, 400);
        }

        return c.json({ ok: true, setId: result.setId, version: result.version }, 200);
    });

    // 3. USER BACKUPS (POST / GET)
    router.post('/user-backups', async (c) => {
        const rawDb = c.get('rawDb');
        const authUser = c.get('authUser');

        const body = await readJsonBody<Record<string, unknown>>(c.req.raw, MAX_JSON_BYTES);
        if (!body) return c.json({ error: '无效的 JSON 请求体或体积超过 10MB 上限' }, 400);

        const type =
            body.type === 'bank' ? 'bank' : body.type === 'history' ? 'history' : null;
        if (!type) return c.json({ error: 'type must be bank or history' }, 400);
        if (typeof body.payload !== 'object' || body.payload === null) {
            return c.json({ error: 'payload is required' }, 400);
        }

        const payload = JSON.stringify(body.payload);
        if (payload.length > MAX_JSON_BYTES) {
            return c.json({ error: 'payload too large' }, 413);
        }

        rawDb.transaction(() => {
            rawDb
                .prepare('INSERT INTO user_backups (user_id, type, payload) VALUES (?, ?, ?)')
                .run(authUser.id, type, payload);
            rawDb
                .prepare(
                    `DELETE FROM user_backups
                     WHERE user_id = ? AND type = ? AND id NOT IN (
                         SELECT id FROM user_backups WHERE user_id = ? AND type = ? ORDER BY id DESC LIMIT 5
                     )`
                )
                .run(authUser.id, type, authUser.id, type);
        })();

        return c.json({ ok: true }, 200);
    });

    router.get('/user-backups', async (c) => {
        const rawDb = c.get('rawDb');
        const authUser = c.get('authUser');

        const backupId = parseInt(c.req.query('id') || '', 10);
        if (Number.isFinite(backupId) && backupId > 0) {
            const row = rawDb
                .prepare(
                    'SELECT id, type, payload, created_at FROM user_backups WHERE user_id = ? AND id = ?'
                )
                .get(authUser.id, backupId) as
                | { id: number; type: string; payload: string; created_at: string }
                | undefined;
            if (!row) return c.json({ error: 'backup not found' }, 404);
            let parsed: unknown = null;
            try {
                parsed = JSON.parse(row.payload);
            } catch {
                parsed = null;
            }
            return c.json(
                { ok: true, id: row.id, type: row.type, createdAt: row.created_at, payload: parsed },
                200
            );
        }

        const typeFilter = c.req.query('type');
        const rows =
            typeFilter === 'bank' || typeFilter === 'history'
                ? rawDb
                      .prepare(
                          'SELECT id, type, created_at, LENGTH(payload) AS size FROM user_backups WHERE user_id = ? AND type = ? ORDER BY id DESC LIMIT 20'
                      )
                      .all(authUser.id, typeFilter)
                : rawDb
                      .prepare(
                          'SELECT id, type, created_at, LENGTH(payload) AS size FROM user_backups WHERE user_id = ? ORDER BY id DESC LIMIT 20'
                      )
                      .all(authUser.id);

        return c.json({ ok: true, backups: rows }, 200);
    });

    // 4. SYNC LOGS (user self)
    router.get('/sync-logs', async (c) => {
        const rawDb = c.get('rawDb');
        const authUser = c.get('authUser');

        const rows = rawDb
            .prepare(
                'SELECT id, delta, status, error, created_at FROM sync_logs WHERE user_id = ? ORDER BY id DESC LIMIT 50'
            )
            .all(authUser.id) as Array<{
            id: number;
            delta: string | null;
            status: string;
            error: string | null;
            created_at: string;
        }>;

        const logs = rows.map((row) => {
            let parsedDelta: unknown = null;
            if (row.delta) {
                try {
                    parsedDelta = JSON.parse(row.delta);
                } catch {
                    parsedDelta = null;
                }
            }
            return { ...row, delta: parsedDelta };
        });

        return c.json({ ok: true, logs }, 200);
    });

    // 5. CLIENT ERRORS
    router.post('/client-errors', async (c) => {
        const rawDb = c.get('rawDb');
        const authUser = c.get('authUser');

        if (!checkRateLimit('cerr:' + authUser.id, 30, 60 * 60 * 1000).ok) {
            return c.json({ error: 'Too Many Requests' }, 429);
        }

        const body = await readJsonBody<Record<string, unknown>>(c.req.raw, MAX_JSON_BYTES);
        if (!body) return c.json({ error: '无效的 JSON 请求体' }, 400);

        const msg = typeof body.message === 'string' ? body.message.slice(0, 300) : 'unknown';
        const stack = typeof body.stack === 'string' ? body.stack.slice(0, 500) : '';
        const page = typeof body.page === 'string' ? body.page.slice(0, 200) : '';
        const ip = clientIp(c.req.raw);

        rawDb
            .prepare(
                "INSERT INTO sync_logs (user_id, delta, status, error) VALUES (?, ?, 'client-error', ?)"
            )
            .run(
                authUser.id,
                JSON.stringify({ ip, page, stack, ua: c.req.header('user-agent') || '' }),
                msg
            );

        return c.json({ ok: true }, 200);
    });

    return router;
}
