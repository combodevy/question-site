import { getEndOfDayUtc8Ms, type FsrsCardState } from './fsrs.js';

export type LabPracticeMode =
  | 'smart_interleave'
  | 'fsrs_review'
  | 'dual_track'
  | 'blocked_build'
  | 'blocked_to_interleaved'
  | 'starred';

export interface ComposeLabSessionInput<
  T extends { id: string; sub: string; chap: string; type: string },
> {
  questions: T[];
  cardStates: Map<string, FsrsCardState>;
  mode: LabPracticeMode;
  limit: number | 'all';
  desiredRetention?: number;
  nowMs?: number;
  starredIds?: Set<string>;
  hiddenMistakeIds?: Set<string>;
}

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function chapterKey(q: { sub: string; chap: string }): string {
  return `${q.sub}\u0001${q.chap}`;
}

/**
 * Re-orders items so adjacent questions avoid coming from the same (sub, chap) bucket whenever possible.
 */
export function interleaveByChapter<T extends { sub: string; chap: string }>(items: T[]): T[] {
  if (items.length <= 2) return [...items];

  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const key = chapterKey(item);
    const list = buckets.get(key);
    if (list) list.push(item);
    else buckets.set(key, [item]);
  }

  if (buckets.size <= 1) return [...items];

  const result: T[] = [];
  let prevKey = '';

  while (result.length < items.length) {
    const candidates = Array.from(buckets.entries())
      .filter(([, arr]) => arr.length > 0)
      .sort((a, b) => b[1].length - a[1].length);

    if (!candidates.length) break;

    let chosen = candidates.find(([k]) => k !== prevKey);
    if (!chosen) chosen = candidates[0];

    const [key, list] = chosen;
    const nextItem = list.shift();
    if (nextItem) {
      result.push(nextItem);
      prevKey = key;
    }
  }

  return result;
}

export function estimateSessionAccuracy<T extends { id: string }>(
  items: T[],
  cardStates: Map<string, FsrsCardState>,
): number {
  if (!items.length) return 0;
  let sum = 0;
  for (const item of items) {
    const st = cardStates.get(item.id);
    if (!st || st.attempts === 0) {
      sum += 0.75;
    } else {
      const emp = 1 - st.errorRate;
      const p = st.retrievability * 0.65 + emp * 0.35;
      sum += p;
    }
  }
  return Math.round((sum / items.length) * 100);
}

export function composeLabSession<
  T extends { id: string; sub: string; chap: string; type: string },
>(input: ComposeLabSessionInput<T>): T[] {
  const {
    questions,
    cardStates,
    mode,
    limit,
    desiredRetention = 0.9,
    nowMs = Date.now(),
    starredIds = new Set<string>(),
    hiddenMistakeIds = new Set<string>(),
  } = input;

  if (!questions.length) return [];

  const maxCount = limit === 'all' ? questions.length : Math.max(1, Math.min(questions.length, limit));
  const endOfDay = getEndOfDayUtc8Ms(nowMs);

  let ordered: T[] = [];

  if (mode === 'blocked_build') {
    const groups = new Map<string, T[]>();
    for (const q of questions) {
      const k = chapterKey(q);
      const arr = groups.get(k);
      if (arr) arr.push(q);
      else groups.set(k, [q]);
    }
    ordered = Array.from(groups.values()).flat();
    return ordered.slice(0, maxCount);
  }

  if (mode === 'blocked_to_interleaved') {
    const groups = new Map<string, T[]>();
    for (const q of questions) {
      const k = chapterKey(q);
      const arr = groups.get(k);
      if (arr) arr.push(q);
      else groups.set(k, [q]);
    }
    const target = questions.slice(0, maxCount);
    const blockCutoff = Math.max(2, Math.round(target.length * 0.4));
    const head: T[] = [];
    const tailPool: T[] = [];

    // Take mini-blocks of up to 3 items per chapter for the initial 40%, then interleave remaining
    const bucketList = Array.from(groups.values());
    const idxPerBucket = new Array<number>(bucketList.length).fill(0);
    while (head.length < blockCutoff) {
      let progressed = false;
      for (let b = 0; b < bucketList.length && head.length < blockCutoff; b += 1) {
        const list = bucketList[b];
        for (let k = 0; k < 3 && idxPerBucket[b] < list.length && head.length < blockCutoff; k += 1) {
          head.push(list[idxPerBucket[b]]);
          idxPerBucket[b] += 1;
          progressed = true;
        }
      }
      if (!progressed) break;
    }
    for (let b = 0; b < bucketList.length; b += 1) {
      const list = bucketList[b];
      for (let i = idxPerBucket[b]; i < list.length; i += 1) {
        tailPool.push(list[i]);
      }
    }
    const tail = interleaveByChapter(shuffleArray(tailPool));
    return [...head, ...tail].slice(0, maxCount);
  }

  if (mode === 'starred') {
    const pool = questions.filter((q) => starredIds.has(q.id));
    return interleaveByChapter(shuffleArray(pool)).slice(0, maxCount);
  }

  if (mode === 'dual_track') {
    const pool = questions.filter((q) => {
      if (hiddenMistakeIds.has(q.id)) return false;
      const st = cardStates.get(q.id);
      if (!st || st.attempts === 0) return false;
      return st.isHyperRisk || st.isLuckyGuess || st.wrongCount > 0;
    });
    pool.sort((a, b) => {
      const sa = cardStates.get(a.id)!;
      const sb = cardStates.get(b.id)!;
      const rankA = sa.isHyperRisk ? 3 : sa.isLuckyGuess ? 2 : 1;
      const rankB = sb.isHyperRisk ? 3 : sb.isLuckyGuess ? 2 : 1;
      if (rankA !== rankB) return rankB - rankA;
      return sb.errorRate - sa.errorRate || sa.retrievability - sb.retrievability;
    });
    return interleaveByChapter(pool.slice(0, maxCount));
  }

  if (mode === 'fsrs_review') {
    const duePool = questions.filter((q) => {
      const st = cardStates.get(q.id);
      if (!st || st.attempts === 0) return false;
      return (st.dueAt !== null && st.dueAt <= endOfDay) || st.retrievability <= desiredRetention;
    });
    duePool.sort((a, b) => {
      const sa = cardStates.get(a.id)!;
      const sb = cardStates.get(b.id)!;
      const rankA = sa.isHyperRisk ? 2 : sa.isLuckyGuess ? 1 : 0;
      const rankB = sb.isHyperRisk ? 2 : sb.isLuckyGuess ? 1 : 0;
      if (rankA !== rankB) return rankB - rankA;
      return sa.retrievability - sb.retrievability || (sa.dueAt ?? 0) - (sb.dueAt ?? 0);
    });
    return interleaveByChapter(duePool.slice(0, maxCount));
  }

  // smart_interleave: ~50% borderline/due, ~30% highRisk/error, ~20% anchor/new targeting 75%-85% sweet spot
  const dueOrBorderline: T[] = [];
  const highRisk: T[] = [];
  const anchor: T[] = [];

  for (const q of questions) {
    const st = cardStates.get(q.id);
    if (!st || st.attempts === 0) {
      anchor.push(q);
      continue;
    }
    if (st.isHyperRisk || st.isLuckyGuess || st.errorRate >= 0.4) {
      highRisk.push(q);
      continue;
    }
    if ((st.dueAt !== null && st.dueAt <= endOfDay) || st.retrievability <= desiredRetention) {
      dueOrBorderline.push(q);
      continue;
    }
    anchor.push(q);
  }

  const shDue = shuffleArray(dueOrBorderline);
  const shRisk = shuffleArray(highRisk);
  const shAnchor = shuffleArray(anchor);

  const wantDue = Math.round(maxCount * 0.5);
  const wantRisk = Math.round(maxCount * 0.3);
  const wantAnchor = Math.max(0, maxCount - wantDue - wantRisk);

  const picked: T[] = [];
  const usedIds = new Set<string>();

  const takeFrom = (src: T[], quota: number) => {
    let taken = 0;
    for (const item of src) {
      if (taken >= quota || picked.length >= maxCount) break;
      if (usedIds.has(item.id)) continue;
      usedIds.add(item.id);
      picked.push(item);
      taken += 1;
    }
  };

  takeFrom(shDue, wantDue);
  takeFrom(shRisk, wantRisk);
  takeFrom(shAnchor, wantAnchor);

  // Fill any remaining slots if some buckets had fewer items
  const fallbackPool = [...shDue, ...shRisk, ...shAnchor];
  for (const item of fallbackPool) {
    if (picked.length >= maxCount) break;
    if (usedIds.has(item.id)) continue;
    usedIds.add(item.id);
    picked.push(item);
  }

  return interleaveByChapter(picked);
}
