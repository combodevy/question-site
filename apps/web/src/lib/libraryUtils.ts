import { computeSrs, type HistoryEntry } from '@qs/shared';
import type { LocalQuestion } from '@/db';
import { naturalCompare, toPinyinStr } from './text';

export type LibrarySortKey =
  | 'default'
  | 'err_rate_desc'
  | 'err_rate_asc'
  | 'err_count_desc'
  | 'attempts_desc'
  | 'attempts_asc'
  | 'alpha_asc'
  | 'alpha_desc'
  | 'ans_asc'
  | 'updated_desc'
  | 'sm2_due';

export interface QuestionPerfStat {
  attempts: number;
  correct: number;
  wrong: number;
  errRate: number | null;
  avgSec: number | null;
  dueAt: number;
}

export function isErrorRateSort(sortKey: LibrarySortKey): boolean {
  return sortKey === 'err_rate_desc' || sortKey === 'err_rate_asc';
}

export function computeQuestionPerfMap(history: HistoryEntry[]): Map<string, QuestionPerfStat> {
  const byQ = new Map<string, HistoryEntry[]>();
  for (const h of history) {
    const arr = byQ.get(h.id) || [];
    arr.push(h);
    byQ.set(h.id, arr);
  }

  const out = new Map<string, QuestionPerfStat>();
  for (const [qid, list] of byQ) {
    list.sort((a, b) => a.t - b.t);
    let correct = 0;
    let totalDur = 0;
    let durN = 0;
    for (const h of list) {
      if (h.r) correct++;
      if (typeof h.d === 'number' && h.d > 0) {
        totalDur += h.d;
        durN++;
      }
    }
    const attempts = list.length;
    const wrong = attempts - correct;
    const errRate = attempts > 0 ? Math.round((wrong / attempts) * 100) : null;
    const avgSec = durN > 0 ? Math.round((totalDur / durN / 1000) * 10) / 10 : null;
    const srs = computeSrs(list);
    out.set(qid, {
      attempts,
      correct,
      wrong,
      errRate,
      avgSec,
      dueAt: srs.dueAt ?? Number.MAX_SAFE_INTEGER,
    });
  }
  return out;
}

function getAlphaKey(text: string): string {
  const cleaned = String(text || '').trim().replace(/^[\d.\s、()（）[\]【】]+/, '');
  return toPinyinStr(cleaned).toLowerCase();
}

export function sortQuestions(
  list: LocalQuestion[],
  sortKey: LibrarySortKey,
  perfMap: Map<string, QuestionPerfStat>,
): LocalQuestion[] {
  if (sortKey === 'default') return list;
  const copy = [...list];

  if (sortKey === 'err_rate_desc') {
    copy.sort((a, b) => {
      const pa = perfMap.get(a.id);
      const pb = perfMap.get(b.id);
      const ra = pa?.errRate ?? -1;
      const rb = pb?.errRate ?? -1;
      if (rb !== ra) return rb - ra;
      return (pb?.wrong ?? -1) - (pa?.wrong ?? -1);
    });
    return copy;
  }

  if (sortKey === 'err_rate_asc') {
    copy.sort((a, b) => {
      const pa = perfMap.get(a.id);
      const pb = perfMap.get(b.id);
      const hasA = pa && pa.errRate !== null;
      const hasB = pb && pb.errRate !== null;
      if (hasA !== hasB) return hasA ? -1 : 1;
      const ra = pa?.errRate ?? 0;
      const rb = pb?.errRate ?? 0;
      if (ra !== rb) return ra - rb;
      return (pb?.attempts ?? 0) - (pa?.attempts ?? 0);
    });
    return copy;
  }

  if (sortKey === 'err_count_desc') {
    copy.sort((a, b) => {
      const pa = perfMap.get(a.id);
      const pb = perfMap.get(b.id);
      const wa = pa?.wrong ?? 0;
      const wb = pb?.wrong ?? 0;
      if (wb !== wa) return wb - wa;
      return (pb?.errRate ?? -1) - (pa?.errRate ?? -1);
    });
    return copy;
  }

  if (sortKey === 'attempts_desc') {
    copy.sort((a, b) => (perfMap.get(b.id)?.attempts ?? 0) - (perfMap.get(a.id)?.attempts ?? 0));
    return copy;
  }

  if (sortKey === 'attempts_asc') {
    copy.sort((a, b) => (perfMap.get(a.id)?.attempts ?? 0) - (perfMap.get(b.id)?.attempts ?? 0));
    return copy;
  }

  if (sortKey === 'alpha_asc' || sortKey === 'alpha_desc') {
    const dir = sortKey === 'alpha_asc' ? 1 : -1;
    copy.sort((a, b) => {
      const ka = getAlphaKey(a.q);
      const kb = getAlphaKey(b.q);
      const cmp = ka.localeCompare(kb, 'zh-CN');
      if (cmp !== 0) return cmp * dir;
      return naturalCompare(a.q, b.q) * dir;
    });
    return copy;
  }

  if (sortKey === 'ans_asc') {
    copy.sort((a, b) => naturalCompare((a.a || '').toUpperCase(), (b.a || '').toUpperCase()));
    return copy;
  }

  if (sortKey === 'updated_desc') {
    copy.sort((a, b) => {
      const ta = b._editedAt ?? b.updatedAt ?? 0;
      const tb = a._editedAt ?? a.updatedAt ?? 0;
      return ta - tb;
    });
    return copy;
  }

  if (sortKey === 'sm2_due') {
    copy.sort((a, b) => {
      const pa = perfMap.get(a.id);
      const pb = perfMap.get(b.id);
      const da = pa && pa.attempts > 0 ? pa.dueAt : Number.MAX_SAFE_INTEGER;
      const db = pb && pb.attempts > 0 ? pb.dueAt : Number.MAX_SAFE_INTEGER;
      return da - db;
    });
    return copy;
  }

  return copy;
}
