export type LabConfidence = 1 | 2 | 3; // 1 = low/guess, 2 = unsure, 3 = high/certain
export type FsrsRating = 1 | 2 | 3 | 4; // 1 = Again, 2 = Hard, 3 = Good, 4 = Easy

export interface LabHistoryEntry {
  rid: string;
  id: string;
  r: boolean;
  t: number;
  d?: number;
  capped?: boolean;
  conf?: LabConfidence;
  rating?: FsrsRating;
  mode?: string;
  blind?: boolean;
  requeued?: boolean;
}

export interface FsrsCardState {
  difficulty: number;
  stability: number;
  retrievability: number;
  reps: number;
  lapses: number;
  lastT: number | null;
  dueAt: number | null;
  intervalDays: number;
  isHyperRisk: boolean;
  isLuckyGuess: boolean;
  lastConf: LabConfidence | null;
  lastCorrect: boolean | null;
  attempts: number;
  wrongCount: number;
  errorRate: number;
  avgDurationMs: number | null;
}

export interface FsrsComputeOptions {
  desiredRetention?: number;
  nowMs?: number;
  medianDurationMs?: number;
}

const DAY_MS = 86_400_000;
const FSRS_FACTOR = 19 / 81;
const FSRS_DECAY = -0.5;

// Standard FSRS-5 19 default weights
export const FSRS_DEFAULT_W = [
  0.40255, 1.18385, 3.173, 15.69105,
  7.1949, 0.5345, 1.4604, 0.0046,
  1.54575, 0.1192, 1.01925, 1.9395,
  0.11, 0.29605, 2.2698, 0.2315,
  2.9898, 0.51655, 0.6621,
] as const;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function computeRetrievability(elapsedDays: number, stability: number): number {
  if (stability <= 0) return 0;
  const elapsed = Math.max(0, elapsedDays);
  return Math.pow(1 + (FSRS_FACTOR * elapsed) / stability, FSRS_DECAY);
}

export function computeIntervalDays(stability: number, desiredRetention: number): number {
  const r = clamp(desiredRetention, 0.75, 0.96);
  const raw = (stability / FSRS_FACTOR) * (Math.pow(r, 1 / FSRS_DECAY) - 1);
  return clamp(Math.round(raw), 1, 365);
}

function initStability(rating: FsrsRating): number {
  return Math.max(0.1, FSRS_DEFAULT_W[rating - 1]);
}

function initDifficulty(rating: FsrsRating): number {
  const w4 = FSRS_DEFAULT_W[4];
  const w5 = FSRS_DEFAULT_W[5];
  return clamp(w4 - Math.exp(w5 * (rating - 1)) + 1, 1, 10);
}

function nextDifficulty(d: number, rating: FsrsRating): number {
  const w6 = FSRS_DEFAULT_W[6];
  const w7 = FSRS_DEFAULT_W[7];
  const d0Easy = initDifficulty(4);
  const deltaD = -w6 * (rating - 3);
  const nextD = d + (deltaD * (10 - d)) / 9;
  const meanReverted = w7 * d0Easy + (1 - w7) * nextD;
  return clamp(meanReverted, 1, 10);
}

function nextRecallStability(
  d: number,
  s: number,
  r: number,
  rating: FsrsRating,
): number {
  const w8 = FSRS_DEFAULT_W[8];
  const w9 = FSRS_DEFAULT_W[9];
  const w10 = FSRS_DEFAULT_W[10];
  const w15 = FSRS_DEFAULT_W[15];
  const w16 = FSRS_DEFAULT_W[16];
  const hardPenalty = rating === 2 ? w15 : 1;
  const easyBonus = rating === 4 ? w16 : 1;
  const growth =
    Math.exp(w8) *
    (11 - d) *
    Math.pow(Math.max(0.1, s), -w9) *
    (Math.exp((1 - r) * w10) - 1) *
    hardPenalty *
    easyBonus;
  return clamp(s * (1 + Math.max(0, growth)), 0.1, 3650);
}

function nextForgetStability(d: number, s: number, r: number): number {
  const w11 = FSRS_DEFAULT_W[11];
  const w12 = FSRS_DEFAULT_W[12];
  const w13 = FSRS_DEFAULT_W[13];
  const w14 = FSRS_DEFAULT_W[14];
  const nextS =
    w11 *
    Math.pow(d, -w12) *
    (Math.pow(Math.max(0.1, s) + 1, w13) - 1) *
    Math.exp((1 - r) * w14);
  return clamp(Math.min(nextS, s), 0.1, 3650);
}

/**
 * Resolve effective FSRS rating using explicit rating, correctness, confidence, and ARTS latency.
 */
export function resolveEffectiveRating(
  entry: Pick<LabHistoryEntry, 'r' | 'd' | 'conf' | 'rating'>,
  medianDurationMs?: number,
): FsrsRating {
  if (entry.rating === 1 || entry.rating === 2 || entry.rating === 3 || entry.rating === 4) {
    return entry.rating;
  }
  if (!entry.r) return 1;
  if (entry.conf === 1) return 2;

  if (
    typeof entry.d === 'number' &&
    entry.d > 0 &&
    typeof medianDurationMs === 'number' &&
    medianDurationMs > 0
  ) {
    const ratio = entry.d / medianDurationMs;
    if (entry.conf !== 2 && ratio <= 0.65 && entry.d < 12_000) {
      return 4;
    }
    if (entry.conf === 2 || ratio >= 1.65) {
      return 2;
    }
  } else if (entry.conf === 2) {
    return 2;
  }

  return 3;
}

export function computeMedianDurationMs(history: Array<{ d?: number }>): number | undefined {
  const vals: number[] = [];
  for (const h of history) {
    if (typeof h.d === 'number' && Number.isFinite(h.d) && h.d > 0) {
      vals.push(h.d);
    }
  }
  if (!vals.length) return undefined;
  vals.sort((a, b) => a - b);
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 === 1 ? vals[mid] : Math.round((vals[mid - 1] + vals[mid]) / 2);
}

export function computeFsrsCard(
  records: LabHistoryEntry[],
  options?: FsrsComputeOptions,
): FsrsCardState {
  const desiredRetention = clamp(options?.desiredRetention ?? 0.9, 0.75, 0.96);
  const nowMs = options?.nowMs ?? Date.now();

  if (!records.length) {
    return {
      difficulty: FSRS_DEFAULT_W[4],
      stability: 0,
      retrievability: 1,
      reps: 0,
      lapses: 0,
      lastT: null,
      dueAt: null,
      intervalDays: 0,
      isHyperRisk: false,
      isLuckyGuess: false,
      lastConf: null,
      lastCorrect: null,
      attempts: 0,
      wrongCount: 0,
      errorRate: 0,
      avgDurationMs: null,
    };
  }

  const sorted = [...records].sort(
    (a, b) => a.t - b.t || String(a.rid || '').localeCompare(String(b.rid || '')),
  );

  let difficulty: number = FSRS_DEFAULT_W[4];
  let stability = 0;
  let reps = 0;
  let lapses = 0;
  let lastT: number | null = null;
  let wrongCount = 0;
  let durSum = 0;
  let durCount = 0;

  for (let i = 0; i < sorted.length; i += 1) {
    const rec = sorted[i];
    if (!rec.r) wrongCount += 1;
    if (typeof rec.d === 'number' && Number.isFinite(rec.d) && rec.d > 0) {
      durSum += rec.d;
      durCount += 1;
    }

    const rating = resolveEffectiveRating(rec, options?.medianDurationMs);

    if (i === 0) {
      stability = initStability(rating);
      difficulty = initDifficulty(rating);
      reps = 1;
      if (rating === 1) lapses += 1;
      lastT = rec.t;
      continue;
    }

    const elapsedDays = Math.max(0, (rec.t - (lastT ?? rec.t)) / DAY_MS);
    // Same-session immediate re-tests (< 12h) update difficulty & lapse counters gently without exploding stability
    if (elapsedDays < 0.5) {
      difficulty = nextDifficulty(difficulty, rating);
      if (rating === 1) {
        lapses += 1;
        stability = clamp(Math.min(stability * 0.7, initStability(1)), 0.1, 3650);
      } else {
        stability = clamp(Math.max(stability, initStability(rating) * 0.5), 0.1, 3650);
      }
      reps += 1;
      lastT = rec.t;
      continue;
    }

    const rAtReview = computeRetrievability(elapsedDays, stability);
    const nextD = nextDifficulty(difficulty, rating);

    if (rating === 1) {
      lapses += 1;
      stability = nextForgetStability(difficulty, stability, rAtReview);
    } else {
      stability = nextRecallStability(difficulty, stability, rAtReview, rating);
    }

    difficulty = nextD;
    reps += 1;
    lastT = rec.t;
  }

  const lastRec = sorted[sorted.length - 1];
  const lastConf =
    lastRec.conf === 1 || lastRec.conf === 2 || lastRec.conf === 3 ? lastRec.conf : null;
  const lastCorrect = Boolean(lastRec.r);
  const lastEffective = resolveEffectiveRating(lastRec, options?.medianDurationMs);

  let intervalDays =
    lastEffective === 1 ? 1 : computeIntervalDays(stability, desiredRetention);

  const isLuckyGuess = lastCorrect && lastConf === 1;
  const isHyperRisk = !lastCorrect && lastConf === 3;

  // Butler et al. (2008): low-confidence lucky guesses need quick confirmation within 1-2 days
  if (isLuckyGuess) {
    intervalDays = Math.min(intervalDays, 2);
  }

  // Butler et al. (2011): hypercorrection window fades after ~1 week, schedule <= 4 days
  if (isHyperRisk) {
    intervalDays = Math.min(intervalDays, 4);
  }

  const elapsedNowDays = lastT !== null ? Math.max(0, (nowMs - lastT) / DAY_MS) : 0;
  const retrievability = stability > 0 ? computeRetrievability(elapsedNowDays, stability) : 1;
  const dueAt = lastT !== null ? lastT + intervalDays * DAY_MS : null;

  return {
    difficulty: Math.round(difficulty * 100) / 100,
    stability: Math.round(stability * 100) / 100,
    retrievability: Math.round(retrievability * 1000) / 1000,
    reps,
    lapses,
    lastT,
    dueAt,
    intervalDays,
    isHyperRisk,
    isLuckyGuess,
    lastConf,
    lastCorrect,
    attempts: sorted.length,
    wrongCount,
    errorRate: Math.round((wrongCount / sorted.length) * 1000) / 1000,
    avgDurationMs: durCount > 0 ? Math.round(durSum / durCount) : null,
  };
}

export function previewFsrsIntervals(
  existingRecords: LabHistoryEntry[],
  options?: FsrsComputeOptions,
): Record<FsrsRating, number> {
  const nowMs = options?.nowMs ?? Date.now();
  const baseOpts: FsrsComputeOptions = { ...options, nowMs };
  const makeProbe = (rating: FsrsRating): LabHistoryEntry => ({
    rid: `probe::${rating}`,
    id: existingRecords[0]?.id || 'probe',
    r: rating !== 1,
    t: nowMs,
    rating,
  });

  return {
    1: computeFsrsCard([...existingRecords, makeProbe(1)], baseOpts).intervalDays,
    2: computeFsrsCard([...existingRecords, makeProbe(2)], baseOpts).intervalDays,
    3: computeFsrsCard([...existingRecords, makeProbe(3)], baseOpts).intervalDays,
    4: computeFsrsCard([...existingRecords, makeProbe(4)], baseOpts).intervalDays,
  };
}

export function getEndOfDayUtc8Ms(nowMs = Date.now()): number {
  const utc8Now = new Date(nowMs + 8 * 3_600_000);
  return (
    Date.UTC(
      utc8Now.getUTCFullYear(),
      utc8Now.getUTCMonth(),
      utc8Now.getUTCDate(),
      23,
      59,
      59,
      999,
    ) -
    8 * 3_600_000
  );
}
