import { describe, expect, it } from 'vitest';
import {
  composeLabSession,
  computeFsrsCard,
  estimateSessionAccuracy,
  interleaveByChapter,
  previewFsrsIntervals,
  resolveEffectiveRating,
  type FsrsCardState,
  type LabHistoryEntry,
} from '@qs/shared';

const DAY_MS = 86_400_000;

describe('FSRS-5 DSR engine with ARTS & Metacognitive Calibration', () => {
  it('grows stability without Ease Hell after a lapse and rewards overdue recall', () => {
    const t0 = 1_700_000_000_000;
    const h1: LabHistoryEntry[] = [
      { rid: 'r1', id: 'q1', r: true, t: t0, rating: 3 },
      { rid: 'r2', id: 'q1', r: true, t: t0 + 3 * DAY_MS, rating: 3 },
      { rid: 'r3', id: 'q1', r: false, t: t0 + 12 * DAY_MS, rating: 1 },
      { rid: 'r4', id: 'q1', r: true, t: t0 + 14 * DAY_MS, rating: 3 },
    ];
    const st = computeFsrsCard(h1, { desiredRetention: 0.9, nowMs: t0 + 14 * DAY_MS });
    expect(st.lapses).toBe(1);
    expect(st.reps).toBe(4);
    expect(st.stability).toBeGreaterThan(0.4);
    expect(st.intervalDays).toBeGreaterThanOrEqual(1);
    expect(st.isHyperRisk).toBe(false);

    // Overdue successful recall increases stability more than on-time recall
    const onTime = computeFsrsCard(
      [
        { rid: 'a1', id: 'q2', r: true, t: t0, rating: 3 },
        { rid: 'a2', id: 'q2', r: true, t: t0 + 3 * DAY_MS, rating: 3 },
      ],
      { nowMs: t0 + 3 * DAY_MS },
    );
    const overdue = computeFsrsCard(
      [
        { rid: 'b1', id: 'q3', r: true, t: t0, rating: 3 },
        { rid: 'b2', id: 'q3', r: true, t: t0 + 15 * DAY_MS, rating: 3 },
      ],
      { nowMs: t0 + 15 * DAY_MS },
    );
    expect(overdue.stability).toBeGreaterThan(onTime.stability);
  });

  it('caps hypercorrection errors (conf=3 & wrong) to <= 4 days and lucky guesses (conf=1 & right) to <= 2 days', () => {
    const t0 = 1_700_000_000_000;
    const hyper = computeFsrsCard(
      [
        { rid: 'h1', id: 'q1', r: true, t: t0, rating: 4 },
        { rid: 'h2', id: 'q1', r: true, t: t0 + 15 * DAY_MS, rating: 4 },
        { rid: 'h3', id: 'q1', r: false, t: t0 + 40 * DAY_MS, conf: 3 },
      ],
      { nowMs: t0 + 40 * DAY_MS },
    );
    expect(hyper.isHyperRisk).toBe(true);
    expect(hyper.intervalDays).toBeLessThanOrEqual(4);

    const guess = computeFsrsCard(
      [
        { rid: 'g1', id: 'q2', r: true, t: t0, rating: 4 },
        { rid: 'g2', id: 'q2', r: true, t: t0 + 20 * DAY_MS, conf: 1 },
      ],
      { nowMs: t0 + 20 * DAY_MS },
    );
    expect(guess.isLuckyGuess).toBe(true);
    expect(guess.intervalDays).toBeLessThanOrEqual(2);
  });

  it('modulates effective FSRS rating via ARTS latency relative to median duration', () => {
    expect(resolveEffectiveRating({ r: true, d: 3000, conf: 3 }, 10000)).toBe(4);
    expect(resolveEffectiveRating({ r: true, d: 18000, conf: 3 }, 10000)).toBe(2);
    expect(resolveEffectiveRating({ r: true, d: 9500 }, 10000)).toBe(3);
    expect(resolveEffectiveRating({ r: true, d: 4000, conf: 1 }, 10000)).toBe(2);
    expect(resolveEffectiveRating({ r: false, d: 2000, conf: 3 }, 10000)).toBe(1);

    const preview = previewFsrsIntervals([{ rid: 'p1', id: 'q1', r: true, t: 1_700_000_000_000 }]);
    expect(preview[4]).toBeGreaterThanOrEqual(preview[3]);
    expect(preview[3]).toBeGreaterThanOrEqual(preview[2]);
  });
});

describe('Lab session composer & chapter interleaver', () => {
  const sampleQs = [
    { id: '1', sub: 'Econ', chap: 'Ch1', type: 'mcq' },
    { id: '2', sub: 'Econ', chap: 'Ch1', type: 'mcq' },
    { id: '3', sub: 'Econ', chap: 'Ch1', type: 'mcq' },
    { id: '4', sub: 'Econ', chap: 'Ch2', type: 'mcq' },
    { id: '5', sub: 'Econ', chap: 'Ch2', type: 'mcq' },
    { id: '6', sub: 'Law', chap: 'Ch1', type: 'mcq' },
    { id: '7', sub: 'Law', chap: 'Ch2', type: 'mcq' },
    { id: '8', sub: 'Law', chap: 'Ch2', type: 'mcq' },
  ];

  it('interleaves items so no adjacent items share (sub, chap) when multi-chapter', () => {
    const mixed = interleaveByChapter(sampleQs);
    expect(mixed).toHaveLength(sampleQs.length);
    for (let i = 1; i < mixed.length; i += 1) {
      const prev = `${mixed[i - 1].sub}::${mixed[i - 1].chap}`;
      const cur = `${mixed[i].sub}::${mixed[i].chap}`;
      expect(cur).not.toBe(prev);
    }
  });

  it('composes all 6 modes cleanly and respects hypercorrection priority in dual_track', () => {
    const t0 = Date.now();
    const cardStates = new Map<string, FsrsCardState>();
    cardStates.set('1', computeFsrsCard([{ rid: '1', id: '1', r: false, t: t0 - DAY_MS, conf: 3 }], { nowMs: t0 }));
    cardStates.set('4', computeFsrsCard([{ rid: '4', id: '4', r: true, t: t0 - DAY_MS, conf: 1 }], { nowMs: t0 }));
    cardStates.set('6', computeFsrsCard([{ rid: '6', id: '6', r: false, t: t0 - DAY_MS, conf: 2 }], { nowMs: t0 }));

    const smart = composeLabSession({
      questions: sampleQs,
      cardStates,
      mode: 'smart_interleave',
      limit: 6,
      nowMs: t0,
    });
    expect(smart).toHaveLength(6);
    expect(estimateSessionAccuracy(smart, cardStates)).toBeGreaterThan(0);

    const dual = composeLabSession({
      questions: sampleQs,
      cardStates,
      mode: 'dual_track',
      limit: 'all',
      nowMs: t0,
    });
    expect(dual.map((q) => q.id).sort()).toEqual(['1', '4', '6']);

    const fsrsDue = composeLabSession({
      questions: sampleQs,
      cardStates,
      mode: 'fsrs_review',
      limit: 'all',
      nowMs: t0,
    });
    expect(fsrsDue.length).toBe(3);

    const blocked = composeLabSession({
      questions: sampleQs,
      cardStates,
      mode: 'blocked_build',
      limit: 'all',
      nowMs: t0,
    });
    expect(blocked.map((q) => q.id)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);

    const b2i = composeLabSession({
      questions: sampleQs,
      cardStates,
      mode: 'blocked_to_interleaved',
      limit: 'all',
      nowMs: t0,
    });
    expect(b2i).toHaveLength(8);

    const starred = composeLabSession({
      questions: sampleQs,
      cardStates,
      mode: 'starred',
      limit: 'all',
      starredIds: new Set(['2', '7']),
      nowMs: t0,
    });
    expect(starred.map((q) => q.id).sort()).toEqual(['2', '7']);
  });
});
