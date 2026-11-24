import type Database from 'better-sqlite3';
import { isSafeKey, type Question } from '@qs/shared';

export interface V2QuestionRow {
    user_id: string;
    id: string;
    sub: string;
    chap: string;
    type: string;
    q: string;
    options_json: string;
    a: string;
    d: string;
    media_json: string | null;
    psg: string | null;
    self_check: number | null;
    edited_at: number | null;
    version: number;
    deleted_at: number | null;
    deleted_by: string | null;
    delete_reason: string | null;
    original_sub: string | null;
    original_chap: string | null;
    was_starred: number;
    purged: number;
    updated_at: number;
    sync_seq: number;
}

export interface V2MetaRow {
    user_id: string;
    legacy_set_id: number | null;
    bank_name: string;
    version: number;
    sync_seq: number;
    history_reset_seq: number;
    last_practice_time: number | null;
    updated_at: number;
}

export function rowToCanonicalQuestion(row: V2QuestionRow): Question {
    let options: string[] = [];
    try {
        const parsed = JSON.parse(row.options_json || '[]');
        if (Array.isArray(parsed)) {
            options = parsed.map((o) => String(o == null ? '' : o));
        }
    } catch {
        options = [];
    }

    const qType =
        row.type === 'mcq' || row.type === 'multi' || row.type === 'tf' || row.type === 'fill'
            ? row.type
            : 'mcq';

    const out: Question = {
        id: row.id,
        type: qType,
        q: row.q,
        o: options,
        a: row.a,
        sub: isSafeKey(row.sub) ? row.sub : '默认科目',
        chap: isSafeKey(row.chap) ? row.chap : '默认章节',
        d: row.d || '',
    };

    if (row.media_json) {
        try {
            const media = JSON.parse(row.media_json);
            if (Array.isArray(media)) out.media = media;
        } catch {
            // ignore corrupted media
        }
    }
    if (typeof row.psg === 'string' && row.psg) out.psg = row.psg;
    if (typeof row.edited_at === 'number' && Number.isFinite(row.edited_at)) {
        out._editedAt = row.edited_at;
    }
    if (row.self_check === 1 || row.self_check === 0) {
        out.selfCheck = row.self_check === 1;
    }

    return out;
}

export function allocateNextLegacySetId(rawDb: Database.Database): number {
    const r = rawDb
        .prepare(
            `SELECT MAX(m) AS max_id FROM (
                SELECT COALESCE(MAX(legacy_set_id), 0) AS m FROM v2_user_sync_meta
                UNION ALL
                SELECT COALESCE(MAX(id), 0) AS m FROM question_sets
            )`
        )
        .get() as { max_id: number | null } | undefined;
    return (r?.max_id ?? 0) + 1;
}

export function ensureUserSyncMeta(
    rawDb: Database.Database,
    userId: string,
    defaultBankName = '默认题库'
): V2MetaRow {
    const existing = rawDb
        .prepare('SELECT * FROM v2_user_sync_meta WHERE user_id = ?')
        .get(userId) as V2MetaRow | undefined;
    if (existing) {
        if (existing.legacy_set_id == null) {
            const setId = allocateNextLegacySetId(rawDb);
            rawDb
                .prepare('UPDATE v2_user_sync_meta SET legacy_set_id = ? WHERE user_id = ?')
                .run(setId, userId);
            existing.legacy_set_id = setId;
        }
        return existing;
    }

    const now = Date.now();
    const setId = allocateNextLegacySetId(rawDb);
    const safeName = defaultBankName || '默认题库';
    rawDb
        .prepare(
            `INSERT INTO v2_user_sync_meta
                (user_id, legacy_set_id, bank_name, version, sync_seq, history_reset_seq, last_practice_time, updated_at)
             VALUES (?, ?, ?, 0, 0, 0, NULL, ?)`
        )
        .run(userId, setId, safeName, now);

    return rawDb
        .prepare('SELECT * FROM v2_user_sync_meta WHERE user_id = ?')
        .get(userId) as V2MetaRow;
}

export function buildLegacyStateFromV2(
    rawDb: Database.Database,
    userId: string,
    historyAfter = 0
): {
    setId: number | null;
    name: string | null;
    version: number;
    historyPartial: boolean;
    state: Record<string, unknown> | null;
} {
    const meta = rawDb
        .prepare('SELECT * FROM v2_user_sync_meta WHERE user_id = ?')
        .get(userId) as V2MetaRow | undefined;

    if (!meta) {
        return {
            setId: null,
            name: null,
            version: 0,
            historyPartial: false,
            state: null,
        };
    }

    const setId = meta.legacy_set_id ?? 1;
    const version = typeof meta.version === 'number' ? meta.version : 0;

    const qRows = rawDb
        .prepare('SELECT * FROM v2_questions WHERE user_id = ? AND purged = 0 ORDER BY updated_at ASC')
        .all(userId) as V2QuestionRow[];

    const bank: Record<string, Record<string, Question[]>> = Object.create(null);
    const trash: Record<string, Record<string, Record<string, unknown>[]>> = Object.create(null);

    for (const row of qRows) {
        const canonical = rowToCanonicalQuestion(row);
        if (row.deleted_at == null) {
            if (!Object.prototype.hasOwnProperty.call(bank, canonical.sub)) {
                bank[canonical.sub] = Object.create(null);
            }
            if (!Object.prototype.hasOwnProperty.call(bank[canonical.sub], canonical.chap)) {
                bank[canonical.sub][canonical.chap] = [];
            }
            bank[canonical.sub][canonical.chap].push(canonical);
        } else {
            const sub = isSafeKey(row.original_sub) ? row.original_sub : canonical.sub;
            const chap = isSafeKey(row.original_chap) ? row.original_chap : canonical.chap;
            if (!Object.prototype.hasOwnProperty.call(trash, sub)) {
                trash[sub] = Object.create(null);
            }
            if (!Object.prototype.hasOwnProperty.call(trash[sub], chap)) {
                trash[sub][chap] = [];
            }
            trash[sub][chap].push({
                ...canonical,
                deletedAt: row.deleted_at,
                deletedBy: row.deleted_by || undefined,
                reason: row.delete_reason || 'manual-delete',
                originalPath: { sub, chap },
                wasStarred: row.was_starred === 1,
            });
        }
    }

    const validAfter = Number.isFinite(historyAfter) && historyAfter > 0;
    const hRows = (
        validAfter
            ? rawDb
                  .prepare(
                      'SELECT rid, question_id, is_correct, answered_at, duration_ms, capped FROM v2_answer_history WHERE user_id = ? AND answered_at >= ? ORDER BY answered_at ASC'
                  )
                  .all(userId, historyAfter)
            : rawDb
                  .prepare(
                      'SELECT rid, question_id, is_correct, answered_at, duration_ms, capped FROM v2_answer_history WHERE user_id = ? ORDER BY answered_at ASC'
                  )
                  .all(userId)
    ) as Array<{
        rid: string;
        question_id: string;
        is_correct: number;
        answered_at: number;
        duration_ms: number | null;
        capped: number;
    }>;

    const history = hRows.map((h) => {
        const entry: Record<string, unknown> = {
            rid: h.rid,
            id: h.question_id,
            r: h.is_correct === 1,
            t: h.answered_at,
        };
        if (typeof h.duration_ms === 'number') entry.d = h.duration_ms;
        if (h.capped === 1) entry.capped = true;
        return entry;
    });

    const flagRows = rawDb
        .prepare(
            'SELECT question_id, starred, mistake_hidden FROM v2_question_flags WHERE user_id = ?'
        )
        .all(userId) as Array<{ question_id: string; starred: number; mistake_hidden: number }>;

    const starred: string[] = [];
    const hiddenMistakeIds: string[] = [];
    for (const f of flagRows) {
        if (f.starred === 1) starred.push(f.question_id);
        if (f.mistake_hidden === 1) hiddenMistakeIds.push(f.question_id);
    }

    return {
        setId,
        name: meta.bank_name,
        version,
        historyPartial: validAfter,
        state: {
            bank,
            bankName: meta.bank_name || null,
            history,
            lastPracticeTime: meta.last_practice_time ?? null,
            trash,
            hiddenMistakeIds,
            starred,
        },
    };
}
