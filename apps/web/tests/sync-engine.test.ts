import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Question } from '@qs/shared';
import { deleteUserDb } from '../src/db';
import { SyncEngine } from '../src/sync/engine';
import { syncApi } from '../src/lib/api';

describe('SyncEngine (Dexie + Outbox)', () => {
  const uid = 'test-user-sync';
  let engine: SyncEngine;

  beforeEach(async () => {
    await deleteUserDb(uid);
    engine = new SyncEngine(uid);
  });

  afterEach(async () => {
    engine.destroy();
    await deleteUserDb(uid);
    vi.restoreAllMocks();
  });

  it('writes optimistically, enqueues outbox, pushes & pulls increments cleanly', async () => {
    const q: Question = {
      id: 'q-1',
      type: 'mcq',
      q: 'What is 1+1?',
      o: ['1', '2', '3', '4'],
      a: 'B',
      sub: 'Math',
      chap: 'Ch1',
      d: '',
    };

    await engine.upsertQuestions([q]);

    expect(await engine.db.questions.get('q-1')).toBeDefined();
    expect(await engine.db.outbox.count()).toBe(1);

    const pushSpy = vi.spyOn(syncApi, 'push').mockResolvedValue({
      ok: true,
      cursor: 10,
      version: 2,
      results: [{ opId: (await engine.db.outbox.toArray())[0].opId, op: 'upsert_question', status: 'applied', version: 1, syncSeq: 10 }],
    });
    const pullSpy = vi.spyOn(syncApi, 'pull').mockResolvedValue({
      ok: true,
      cursor: 10,
      version: 2,
      historyResetRequired: false,
      meta: { bankName: 'Cloud Bank', lastPracticeTime: 12345 },
      questions: [],
      history: [],
      flags: [],
      englishProgress: [],
    });

    const ok = await engine.syncNow({ quiet: true });
    expect(ok).toBe(true);
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pullSpy).toHaveBeenCalledWith(0);
    expect(await engine.db.outbox.count()).toBe(0);
    expect((await engine.db.meta.get('cursor'))?.value).toBe(10);
    expect((await engine.db.meta.get('bankName'))?.value).toBe('Cloud Bank');
  });

  it('resolves server conflicts and respects historyResetRequired', async () => {
    await engine.appendHistory([{ rid: 'old-r', id: 'q-1', r: false, t: 100 }]);
    await engine.upsertQuestions([
      { id: 'q-1', type: 'tf', q: 'Old local', o: [], a: 'T', sub: 'S', chap: 'C', d: '' },
    ]);

    const ops = await engine.db.outbox.toArray();
    vi.spyOn(syncApi, 'push').mockResolvedValue({
      ok: true,
      cursor: 20,
      version: 5,
      results: [
        { opId: ops[0].opId, op: 'append_history', status: 'applied' },
        {
          opId: ops[1].opId,
          op: 'upsert_question',
          status: 'conflict',
          serverVersion: 4,
          serverQuestion: {
            id: 'q-1',
            type: 'tf',
            q: 'Server Winner',
            o: [],
            a: 'F',
            sub: 'S',
            chap: 'C',
            d: '',
            version: 4,
            deletedAt: null,
            updatedAt: 999,
            syncSeq: 20,
          },
        },
      ],
    });
    vi.spyOn(syncApi, 'pull').mockResolvedValue({
      ok: true,
      cursor: 20,
      version: 5,
      historyResetRequired: true,
      meta: { bankName: null, lastPracticeTime: null },
      questions: [],
      history: [{ rid: 'new-r', id: 'q-1', r: true, t: 500, syncSeq: 20 }],
      flags: [],
      englishProgress: [
        {
          paperId: 'cet4-2024-06-1',
          answers: { '1': 'A' },
          graded: true,
          result: { correct: 1, total: 1 },
          updatedAt: 500,
          syncSeq: 20,
        },
      ],
    });

    await engine.syncNow({ quiet: true });

    const qLocal = await engine.db.questions.get('q-1');
    expect(qLocal?.q).toBe('Server Winner');
    expect(await engine.db.history.count()).toBe(1);
    expect((await engine.db.history.toArray())[0].rid).toBe('new-r');
    const ep = await engine.db.englishProgress.get('cet4-2024-06-1');
    expect(ep?.answers['1']).toBe('A');
  });

  it('retains outbox entries when push throws network error', async () => {
    await engine.saveEnglishProgress('cet4-2023-12-1', {
      answers: { '26': 'C' },
      graded: false,
      result: null,
    });
    expect(await engine.db.outbox.count()).toBe(1);

    vi.spyOn(syncApi, 'push').mockRejectedValue(new Error('Network down'));
    const ok = await engine.syncNow({ quiet: true });
    expect(ok).toBe(false);
    expect(await engine.db.outbox.count()).toBe(1);
  });
});
