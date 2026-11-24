import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '@qs/shared';
import type { LocalQuestion } from '../src/db';
import { computeQuestionPerfMap, isErrorRateSort, sortQuestions } from '../src/lib/libraryUtils';

function makeQ(id: string, q: string, a: string, updatedAt: number): LocalQuestion {
  return {
    id,
    type: 'mcq',
    q,
    o: ['Op1', 'Op2'],
    a,
    sub: 'S1',
    chap: 'C1',
    d: '',
    version: 1,
    deletedAt: null,
    updatedAt,
    _editedAt: updatedAt,
  };
}

describe('libraryUtils sorting & performance calculation', () => {
  const qs: LocalQuestion[] = [
    makeQ('q1', 'Beta topic', 'B', 100),
    makeQ('q2', 'Alpha topic', 'A', 300),
    makeQ('q3', 'Gamma topic', 'C', 200),
    makeQ('q4', 'Delta unattempted', 'D', 400),
  ];

  const history: HistoryEntry[] = [
    // q1: 3 attempts, 2 wrong -> 67% error
    { rid: 'r1', id: 'q1', r: false, t: 1_000, d: 2000 },
    { rid: 'r2', id: 'q1', r: false, t: 2_000, d: 3000 },
    { rid: 'r3', id: 'q1', r: true, t: 3_000, d: 1000 },
    // q2: 4 attempts, 1 wrong -> 25% error
    { rid: 'r4', id: 'q2', r: true, t: 1_000, d: 1000 },
    { rid: 'r5', id: 'q2', r: true, t: 2_000, d: 1000 },
    { rid: 'r6', id: 'q2', r: false, t: 3_000, d: 1000 },
    { rid: 'r7', id: 'q2', r: true, t: 4_000, d: 1000 },
    // q3: 2 attempts, 2 wrong -> 100% error
    { rid: 'r8', id: 'q3', r: false, t: 1_000, d: 5000 },
    { rid: 'r9', id: 'q3', r: false, t: 5_000, d: 5000 },
  ];

  const perfMap = computeQuestionPerfMap(history);

  it('flags only error-rate sort modes via isErrorRateSort', () => {
    expect(isErrorRateSort('err_rate_desc')).toBe(true);
    expect(isErrorRateSort('err_rate_asc')).toBe(true);
    expect(isErrorRateSort('default')).toBe(false);
    expect(isErrorRateSort('alpha_asc')).toBe(false);
    expect(isErrorRateSort('attempts_desc')).toBe(false);
    expect(isErrorRateSort('updated_desc')).toBe(false);
    expect(isErrorRateSort('sm2_due')).toBe(false);
  });

  it('sorts error rates high-to-low and low-to-high with unattempted items last', () => {
    expect(sortQuestions(qs, 'err_rate_desc', perfMap).map((q) => q.id)).toEqual([
      'q3', // 100%
      'q1', // 67%
      'q2', // 25%
      'q4', // unattempted
    ]);

    expect(sortQuestions(qs, 'err_rate_asc', perfMap).map((q) => q.id)).toEqual([
      'q2', // 25%
      'q1', // 67%
      'q3', // 100%
      'q4', // unattempted last
    ]);
  });

  it('sorts alphabetically ascending/descending, by attempts, answer, and updatedAt', () => {
    expect(sortQuestions(qs, 'alpha_asc', perfMap).map((q) => q.id)).toEqual(['q2', 'q1', 'q4', 'q3']);
    expect(sortQuestions(qs, 'alpha_desc', perfMap).map((q) => q.id)).toEqual(['q3', 'q4', 'q1', 'q2']);
    expect(sortQuestions(qs, 'attempts_desc', perfMap).map((q) => q.id)).toEqual(['q2', 'q1', 'q3', 'q4']);
    expect(sortQuestions(qs, 'ans_asc', perfMap).map((q) => q.id)).toEqual(['q2', 'q1', 'q3', 'q4']);
    expect(sortQuestions(qs, 'updated_desc', perfMap).map((q) => q.id)).toEqual(['q4', 'q2', 'q3', 'q1']);
  });
});
