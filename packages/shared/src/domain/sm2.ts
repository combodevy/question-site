export interface SrsRecordInput {
    r: boolean;
    t: number;
    rid?: string;
}

export interface SrsState {
    ef: number;
    interval: number;
    rep: number;
    lastT: number | null;
    dueAt: number | null;
}

/**
 * 与前端 js/data.js::_srsFromRecords 完全对齐的 SM-2 间隔推演算法。
 */
export function computeSrs(records: SrsRecordInput[]): SrsState {
    const sorted = [...records].sort(
        (a, b) => a.t - b.t || String(a.rid || '').localeCompare(String(b.rid || ''))
    );
    let ef = 2.5;
    let interval = 0;
    let rep = 0;
    let lastT: number | null = null;

    for (const rec of sorted) {
        lastT = rec.t;
        if (rec.r) {
            rep += 1;
            interval =
                rep === 1
                    ? 1
                    : rep === 2
                      ? 6
                      : Math.max(1, Math.round(interval * ef));
            if (interval > 365) interval = 365;
            ef = Math.min(ef + 0.1, 2.8);
        } else {
            rep = 0;
            interval = 0;
            ef = Math.max(ef - 0.2, 1.3);
        }
    }

    const dueAt = lastT == null ? null : lastT + interval * 86_400_000;
    return { ef, interval, rep, lastT, dueAt };
}

export interface HistoryLike {
    id: string;
    r: boolean;
    t: number;
    rid?: string;
}

/**
 * 计算按 UTC+8 当日 23:59:59.999 口径到期的待复习题目数。
 */
export function countDueQuestions(
    history: HistoryLike[],
    activeIds?: Set<string> | null,
    nowMs = Date.now()
): number {
    const byId = new Map<string, SrsRecordInput[]>();
    for (const h of history) {
        if (!h || typeof h.id !== 'string' || typeof h.r !== 'boolean' || !Number.isFinite(h.t)) {
            continue;
        }
        if (activeIds && !activeIds.has(h.id)) continue;
        let arr = byId.get(h.id);
        if (!arr) {
            arr = [];
            byId.set(h.id, arr);
        }
        arr.push({ r: h.r, t: h.t, rid: h.rid });
    }

    const utc8Now = new Date(nowMs + 8 * 3_600_000);
    const endOfDayUtc8 =
        Date.UTC(
            utc8Now.getUTCFullYear(),
            utc8Now.getUTCMonth(),
            utc8Now.getUTCDate(),
            23,
            59,
            59,
            999
        ) -
        8 * 3_600_000;

    let due = 0;
    for (const recs of byId.values()) {
        if (recs.length === 0) continue;
        const srs = computeSrs(recs);
        if (srs.dueAt !== null && srs.dueAt <= endOfDayUtc8) {
            due += 1;
        }
    }
    return due;
}
