import type { HistoryEntry, Question, SyncMutation } from '@qs/shared';
import { ApiError, syncApi } from '@/lib/api';
import {
  closeUserDb,
  getUserDb,
  type LocalEnglishProgress,
  type LocalQuestion,
  type OutboxEntry,
  type QsDatabase,
} from '@/db';
import { useSyncStore } from '@/store/useSyncStore';
import { useUiStore } from '@/store/useUiStore';

const BROADCAST_CHANNEL = 'qs_v2_sync';
const PUSH_BATCH_SIZE = 400;

function makeOpId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class SyncEngine {
  readonly userId: string;
  readonly db: QsDatabase;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private inFlightSync: Promise<boolean> | null = null;
  private lastPullAt = 0;
  private destroyed = false;
  private channel: BroadcastChannel | null = null;
  private onOnlineBound = () => {
    void this.syncNow();
  };
  private onVisibleBound = () => {
    if (document.visibilityState === 'visible' && Date.now() - this.lastPullAt > 15_000) {
      void this.syncNow();
    }
  };

  constructor(userId: string) {
    this.userId = userId;
    this.db = getUserDb(userId);

    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onOnlineBound);
      document.addEventListener('visibilitychange', this.onVisibleBound);
      this.pollTimer = setInterval(() => {
        if (document.visibilityState === 'visible') {
          void this.syncNow({ quiet: true });
        }
      }, 60_000);

      if (typeof BroadcastChannel !== 'undefined') {
        try {
          this.channel = new BroadcastChannel(BROADCAST_CHANNEL);
          this.channel.onmessage = (ev) => {
            const msg = ev.data as { userId?: string } | null;
            if (msg?.userId === this.userId) {
              void this.refreshMetaAndNotify();
            }
          };
        } catch {
          this.channel = null;
        }
      }
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnlineBound);
      document.removeEventListener('visibilitychange', this.onVisibleBound);
    }
    try {
      this.channel?.close();
    } catch {
      // ignore
    }
    void closeUserDb(this.userId);
  }

  private broadcast(): void {
    try {
      this.channel?.postMessage({ userId: this.userId, ts: Date.now() });
    } catch {
      // ignore
    }
  }

  async refreshMetaAndNotify(): Promise<void> {
    if (this.destroyed) return;
    const [pendingCount, cursorMeta, versionMeta] = await Promise.all([
      this.db.outbox.count(),
      this.db.meta.get('cursor'),
      this.db.meta.get('version'),
    ]);
    useSyncStore.getState().setStatus({
      pendingCount,
      cursor: typeof cursorMeta?.value === 'number' ? cursorMeta.value : 0,
      version: typeof versionMeta?.value === 'number' ? versionMeta.value : 0,
    });
    useSyncStore.getState().bumpRevision();
  }

  private schedulePush(): void {
    if (this.destroyed) return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      void this.syncNow({ quiet: true });
    }, 400);
  }

  private async enqueueAndNotify(mutations: SyncMutation[]): Promise<void> {
    if (mutations.length > 0) {
      const now = Date.now();
      const rows: OutboxEntry[] = mutations.map((m) => ({
        opId: m.opId,
        op: m.op,
        mutation: m,
        createdAt: now,
      }));
      await this.db.outbox.bulkAdd(rows);
    }
    await this.refreshMetaAndNotify();
    this.broadcast();
    this.schedulePush();
  }

  /* ---------- Optimistic Mutations ---------- */

  async upsertQuestions(questions: Question[], useBaseVersion = false): Promise<void> {
    if (!questions.length) return;
    const now = Date.now();
    const mutations: SyncMutation[] = [];

    await this.db.transaction('rw', this.db.questions, this.db.outbox, async () => {
      for (const q of questions) {
        const existing = await this.db.questions.get(q.id);
        const baseVersion = useBaseVersion && existing ? existing.version : undefined;
        const nextLocal: LocalQuestion = {
          ...q,
          version: (existing?.version ?? 0) + 1,
          deletedAt: null,
          deleteReason: null,
          originalPath: undefined,
          wasStarred: false,
          updatedAt: now,
          _editedAt: q._editedAt ?? now,
        };
        await this.db.questions.put(nextLocal);
        mutations.push({
          opId: makeOpId(),
          op: 'upsert_question',
          ...(typeof baseVersion === 'number' ? { baseVersion } : {}),
          question: {
            id: q.id,
            type: q.type,
            q: q.q,
            o: q.o || [],
            a: q.a,
            sub: q.sub,
            chap: q.chap,
            d: q.d || '',
            ...(q.media ? { media: q.media } : {}),
            ...(q.psg ? { psg: q.psg } : {}),
            ...(typeof q.selfCheck === 'boolean' ? { selfCheck: q.selfCheck } : {}),
            _editedAt: nextLocal._editedAt,
          },
        });
      }
      await this.db.outbox.bulkAdd(
        mutations.map((m) => ({ opId: m.opId, op: m.op, mutation: m, createdAt: now })),
      );
    });

    await this.refreshMetaAndNotify();
    this.broadcast();
    this.schedulePush();
  }

  async softDeleteQuestions(ids: string[], reason = 'manual-delete'): Promise<void> {
    if (!ids.length) return;
    const now = Date.now();
    const mutations: SyncMutation[] = [];

    await this.db.transaction('rw', this.db.questions, this.db.flags, this.db.outbox, async () => {
      for (const id of ids) {
        const existing = await this.db.questions.get(id);
        if (!existing || existing.deletedAt !== null) continue;
        const flag = await this.db.flags.get(id);
        const wasStarred = Boolean(flag?.starred);
        await this.db.questions.put({
          ...existing,
          deletedAt: now,
          deleteReason: reason,
          originalPath: existing.originalPath ?? { sub: existing.sub, chap: existing.chap },
          wasStarred,
          version: existing.version + 1,
          updatedAt: now,
        });
        if (wasStarred && flag) {
          await this.db.flags.put({ ...flag, starred: false, updatedAt: now });
        }
        mutations.push({
          opId: makeOpId(),
          op: 'delete_question',
          questionId: id,
          reason,
          deletedBy: 'user',
          deletedAt: now,
        });
      }
      if (mutations.length) {
        await this.db.outbox.bulkAdd(
          mutations.map((m) => ({ opId: m.opId, op: m.op, mutation: m, createdAt: now })),
        );
      }
    });

    await this.refreshMetaAndNotify();
    this.broadcast();
    this.schedulePush();
  }

  async restoreQuestion(questionId: string, sub?: string, chap?: string): Promise<void> {
    const now = Date.now();
    let mutation: SyncMutation | null = null;

    await this.db.transaction('rw', this.db.questions, this.db.flags, this.db.outbox, async () => {
      const existing = await this.db.questions.get(questionId);
      if (!existing) return;
      const nextSub = sub?.trim() || existing.originalPath?.sub || existing.sub;
      const nextChap = chap?.trim() || existing.originalPath?.chap || existing.chap;
      await this.db.questions.put({
        ...existing,
        sub: nextSub,
        chap: nextChap,
        deletedAt: null,
        deleteReason: null,
        originalPath: undefined,
        wasStarred: false,
        version: existing.version + 1,
        updatedAt: now,
      });
      if (existing.wasStarred) {
        const flag = await this.db.flags.get(questionId);
        await this.db.flags.put({
          questionId,
          starred: true,
          mistakeHidden: flag?.mistakeHidden ?? false,
          updatedAt: now,
        });
      }
      mutation = {
        opId: makeOpId(),
        op: 'restore_question',
        questionId,
        sub: nextSub,
        chap: nextChap,
      };
      await this.db.outbox.add({ opId: mutation.opId, op: mutation.op, mutation, createdAt: now });
    });

    if (mutation) {
      await this.refreshMetaAndNotify();
      this.broadcast();
      this.schedulePush();
    }
  }

  async destroyQuestion(questionId: string): Promise<void> {
    const now = Date.now();
    await this.db.transaction('rw', this.db.questions, this.db.flags, this.db.outbox, async () => {
      await this.db.questions.delete(questionId);
      const flag = await this.db.flags.get(questionId);
      if (flag?.starred) {
        await this.db.flags.put({ ...flag, starred: false, updatedAt: now });
      }
      const m: SyncMutation = { opId: makeOpId(), op: 'destroy_question', questionId };
      await this.db.outbox.add({ opId: m.opId, op: m.op, mutation: m, createdAt: now });
    });
    await this.refreshMetaAndNotify();
    this.broadcast();
    this.schedulePush();
  }

  async emptyTrash(): Promise<void> {
    const now = Date.now();
    await this.db.transaction('rw', this.db.questions, this.db.outbox, async () => {
      const trashIds = await this.db.questions
        .filter((q) => q.deletedAt !== null)
        .primaryKeys();
      await this.db.questions.bulkDelete(trashIds);
      const m: SyncMutation = { opId: makeOpId(), op: 'empty_trash' };
      await this.db.outbox.add({ opId: m.opId, op: m.op, mutation: m, createdAt: now });
    });
    await this.refreshMetaAndNotify();
    this.broadcast();
    this.schedulePush();
  }

  async appendHistory(entries: HistoryEntry[]): Promise<void> {
    if (!entries.length) return;
    const now = Date.now();
    let maxT = 0;
    for (const e of entries) if (e.t > maxT) maxT = e.t;

    await this.db.transaction('rw', this.db.history, this.db.meta, this.db.outbox, async () => {
      await this.db.history.bulkPut(entries);
      const prevMeta = await this.db.meta.get('lastPracticeTime');
      const prevT = typeof prevMeta?.value === 'number' ? prevMeta.value : 0;
      const nextT = Math.max(prevT, maxT);
      await this.db.meta.put({ key: 'lastPracticeTime', value: nextT });
      const m: SyncMutation = {
        opId: makeOpId(),
        op: 'append_history',
        entries,
        lastPracticeTime: nextT,
      };
      await this.db.outbox.add({ opId: m.opId, op: m.op, mutation: m, createdAt: now });
    });

    await this.refreshMetaAndNotify();
    this.broadcast();
    this.schedulePush();
  }

  async clearHistory(): Promise<void> {
    const now = Date.now();
    await this.db.transaction(
      'rw',
      this.db.history,
      this.db.flags,
      this.db.meta,
      this.db.outbox,
      async () => {
        await this.db.history.clear();
        const hiddenFlags = await this.db.flags.filter((f) => f.mistakeHidden).toArray();
        for (const f of hiddenFlags) {
          await this.db.flags.put({ ...f, mistakeHidden: false, updatedAt: now });
        }
        await this.db.meta.put({ key: 'lastPracticeTime', value: null });
        const m: SyncMutation = { opId: makeOpId(), op: 'clear_history' };
        await this.db.outbox.add({ opId: m.opId, op: m.op, mutation: m, createdAt: now });
      },
    );
    await this.refreshMetaAndNotify();
    this.broadcast();
    this.schedulePush();
  }

  async clearBank(): Promise<void> {
    const now = Date.now();
    await this.db.transaction('rw', this.db.questions, this.db.flags, this.db.outbox, async () => {
      const activeIds = await this.db.questions
        .filter((q) => q.deletedAt === null)
        .primaryKeys();
      await this.db.questions.bulkDelete(activeIds);
      const starred = await this.db.flags.filter((f) => f.starred).toArray();
      for (const f of starred) {
        await this.db.flags.put({ ...f, starred: false, updatedAt: now });
      }
      const m: SyncMutation = { opId: makeOpId(), op: 'clear_bank' };
      await this.db.outbox.add({ opId: m.opId, op: m.op, mutation: m, createdAt: now });
    });
    await this.refreshMetaAndNotify();
    this.broadcast();
    this.schedulePush();
  }

  async setFlag(
    questionId: string,
    patch: { starred?: boolean; mistakeHidden?: boolean },
  ): Promise<void> {
    const now = Date.now();
    await this.db.transaction('rw', this.db.flags, this.db.outbox, async () => {
      const existing = await this.db.flags.get(questionId);
      const next = {
        questionId,
        starred: patch.starred !== undefined ? patch.starred : (existing?.starred ?? false),
        mistakeHidden:
          patch.mistakeHidden !== undefined ? patch.mistakeHidden : (existing?.mistakeHidden ?? false),
        updatedAt: now,
      };
      await this.db.flags.put(next);
      const m: SyncMutation = {
        opId: makeOpId(),
        op: 'set_flag',
        questionId,
        ...(patch.starred !== undefined ? { starred: patch.starred } : {}),
        ...(patch.mistakeHidden !== undefined ? { mistakeHidden: patch.mistakeHidden } : {}),
        updatedAt: now,
      };
      await this.db.outbox.add({ opId: m.opId, op: m.op, mutation: m, createdAt: now });
    });
    await this.refreshMetaAndNotify();
    this.broadcast();
    this.schedulePush();
  }

  async restoreHiddenMistakes(): Promise<void> {
    const now = Date.now();
    await this.db.transaction('rw', this.db.flags, this.db.outbox, async () => {
      const hidden = await this.db.flags.filter((f) => f.mistakeHidden).toArray();
      for (const f of hidden) {
        await this.db.flags.put({ ...f, mistakeHidden: false, updatedAt: now });
      }
      const m: SyncMutation = { opId: makeOpId(), op: 'restore_hidden_mistakes' };
      await this.db.outbox.add({ opId: m.opId, op: m.op, mutation: m, createdAt: now });
    });
    await this.refreshMetaAndNotify();
    this.broadcast();
    this.schedulePush();
  }

  async renameSubject(oldSub: string, newSub: string): Promise<void> {
    const clean = newSub.trim();
    if (!clean || clean === oldSub) return;
    const targets = await this.db.questions
      .filter((q) => q.deletedAt === null && q.sub === oldSub)
      .toArray();
    if (!targets.length) return;
    const updated = targets.map((q) => ({ ...q, sub: clean, _editedAt: Date.now() }));
    await this.upsertQuestions(updated, false);
  }

  async renameChapter(sub: string, oldChap: string, newChap: string): Promise<void> {
    const clean = newChap.trim();
    if (!clean || clean === oldChap) return;
    const targets = await this.db.questions
      .filter((q) => q.deletedAt === null && q.sub === sub && q.chap === oldChap)
      .toArray();
    if (!targets.length) return;
    const updated = targets.map((q) => ({ ...q, chap: clean, _editedAt: Date.now() }));
    await this.upsertQuestions(updated, false);
  }

  async updateMeta(patch: { bankName?: string | null; lastPracticeTime?: number | null }): Promise<void> {
    const now = Date.now();
    await this.db.transaction('rw', this.db.meta, this.db.outbox, async () => {
      if (patch.bankName !== undefined) {
        await this.db.meta.put({ key: 'bankName', value: patch.bankName });
      }
      if (patch.lastPracticeTime !== undefined) {
        await this.db.meta.put({ key: 'lastPracticeTime', value: patch.lastPracticeTime });
      }
      const m: SyncMutation = {
        opId: makeOpId(),
        op: 'update_meta',
        ...(patch.bankName !== undefined ? { bankName: patch.bankName } : {}),
        ...(patch.lastPracticeTime !== undefined ? { lastPracticeTime: patch.lastPracticeTime } : {}),
      };
      await this.db.outbox.add({ opId: m.opId, op: m.op, mutation: m, createdAt: now });
    });
    await this.refreshMetaAndNotify();
    this.broadcast();
    this.schedulePush();
  }

  async saveEnglishProgress(
    paperId: string,
    payload: { answers: Record<string, string>; graded: boolean; result: Record<string, unknown> | null },
  ): Promise<void> {
    const now = Date.now();
    const record: LocalEnglishProgress = {
      paperId,
      answers: payload.answers,
      graded: payload.graded,
      result: payload.result,
      updatedAt: now,
    };
    await this.db.transaction('rw', this.db.englishProgress, this.db.outbox, async () => {
      await this.db.englishProgress.put(record);
      const m: SyncMutation = {
        opId: makeOpId(),
        op: 'upsert_english_progress',
        paperId,
        answers: payload.answers,
        graded: payload.graded,
        result: payload.result,
        updatedAt: now,
      };
      await this.db.outbox.add({ opId: m.opId, op: m.op, mutation: m, createdAt: now });
    });
    await this.refreshMetaAndNotify();
    this.broadcast();
    this.schedulePush();
  }

  async restoreFromBackup(type: 'bank' | 'history', payload: unknown): Promise<void> {
    if (type === 'bank' && payload && typeof payload === 'object') {
      const { sanitizeImportedBank } = await import('@/lib/parsers');
      const { questions } = sanitizeImportedBank(payload);
      await this.clearBank();
      if (questions.length) {
        await this.upsertQuestions(questions, false);
      }
    } else if (type === 'history' && payload && typeof payload === 'object') {
      const p = payload as Record<string, unknown>;
      await this.clearHistory();
      const rawHist = Array.isArray(p.history) ? p.history : [];
      const validHist: HistoryEntry[] = [];
      for (const h of rawHist) {
        if (!h || typeof h !== 'object') continue;
        const r = h as Record<string, unknown>;
        if (typeof r.id !== 'string' || typeof r.r !== 'boolean' || typeof r.t !== 'number') continue;
        validHist.push({
          rid: typeof r.rid === 'string' && r.rid ? r.rid : `${r.id}::${r.t}`,
          id: r.id,
          r: r.r,
          t: r.t,
          ...(typeof r.d === 'number' && r.d >= 0 ? { d: r.d } : {}),
          ...(r.capped ? { capped: true } : {}),
        });
      }
      if (validHist.length) {
        await this.appendHistory(validHist);
      }
      if (Array.isArray(p.starred)) {
        for (const qid of p.starred) {
          if (typeof qid === 'string' && qid) {
            await this.setFlag(qid, { starred: true });
          }
        }
      }
      if (Array.isArray(p.hiddenMistakeIds)) {
        for (const qid of p.hiddenMistakeIds) {
          if (typeof qid === 'string' && qid) {
            await this.setFlag(qid, { mistakeHidden: true });
          }
        }
      }
    }
    await this.syncNow();
  }

  /* ---------- Core Two-Phase Sync ---------- */

  async migrateLegacyEnglishLocalStorage(): Promise<void> {
    const done = await this.db.meta.get('migratedLegacyEnglish');
    if (done?.value === true) return;

    const toMigrate: Array<{
      paperId: string;
      answers: Record<string, string>;
      graded: boolean;
      result: Record<string, unknown> | null;
    }> = [];

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith('qs_eng_session_')) continue;
        const paperId = key.slice('qs_eng_session_'.length);
        if (!paperId) continue;
        const existing = await this.db.englishProgress.get(paperId);
        if (existing) continue;
        const raw = JSON.parse(localStorage.getItem(key) || 'null') as {
          answers?: Record<string, string>;
          graded?: boolean;
          result?: Record<string, unknown> | null;
        } | null;
        if (raw && raw.answers && Object.keys(raw.answers).length > 0) {
          toMigrate.push({
            paperId,
            answers: raw.answers,
            graded: Boolean(raw.graded),
            result: raw.result || null,
          });
        }
      }
    } catch {
      // ignore localStorage access failures
    }

    for (const item of toMigrate) {
      await this.saveEnglishProgress(item.paperId, item);
    }
    await this.db.meta.put({ key: 'migratedLegacyEnglish', value: true });
  }

  syncNow(opts?: { quiet?: boolean }): Promise<boolean> {
    if (this.inFlightSync) return this.inFlightSync;
    this.inFlightSync = this._doSyncNow(opts).finally(() => {
      this.inFlightSync = null;
    });
    return this.inFlightSync;
  }

  private async _doSyncNow(opts?: { quiet?: boolean }): Promise<boolean> {
    if (this.destroyed) return false;
    const syncStore = useSyncStore.getState();

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      syncStore.setStatus({ status: 'offline' });
      return false;
    }

    syncStore.setStatus({ status: 'syncing', lastError: null });

    try {
      // 1. Push Outbox in batches
      while (!this.destroyed) {
        const batch = await this.db.outbox.orderBy('seq').limit(PUSH_BATCH_SIZE).toArray();
        if (!batch.length) break;

        const res = await syncApi.push(batch.map((b) => b.mutation));
        let conflictNotified = false;

        await this.db.transaction('rw', this.db.outbox, this.db.questions, async () => {
          const opsToRemove: string[] = [];
          for (const item of res.results) {
            if (item.status === 'conflict' && item.serverQuestion) {
              await this.db.questions.put({
                ...item.serverQuestion,
                version: item.serverQuestion.version ?? 1,
                deletedAt: item.serverQuestion.deletedAt ?? null,
                updatedAt: item.serverQuestion.updatedAt ?? Date.now(),
              });
              conflictNotified = true;
            }
            opsToRemove.push(item.opId);
          }
          if (opsToRemove.length) {
            await this.db.outbox.where('opId').anyOf(opsToRemove).delete();
          }
        });

        if (conflictNotified && !opts?.quiet) {
          useUiStore.getState().pushToast('检测到云端较新版本，已自动合并更新', 'warning');
        }
      }

      if (this.destroyed) return false;

      // 2. Pull incremental changes since cursor
      const cursorRow = await this.db.meta.get('cursor');
      const curCursor = typeof cursorRow?.value === 'number' ? cursorRow.value : 0;
      const pull = await syncApi.pull(curCursor);
      this.lastPullAt = Date.now();

      await this.db.transaction(
        'rw',
        [this.db.questions, this.db.history, this.db.flags, this.db.englishProgress, this.db.meta, this.db.outbox],
        async () => {
          // Guard against overwriting any items created/modified *while* pull was in flight
          const stillPending = await this.db.outbox.toArray();
          const pendingQuestionIds = new Set<string>();
          const pendingFlagIds = new Set<string>();
          const pendingEnglishIds = new Set<string>();
          for (const p of stillPending) {
            if (p.mutation.op === 'upsert_question') pendingQuestionIds.add(p.mutation.question.id);
            else if (
              p.mutation.op === 'delete_question' ||
              p.mutation.op === 'restore_question' ||
              p.mutation.op === 'destroy_question'
            ) {
              pendingQuestionIds.add(p.mutation.questionId);
            } else if (p.mutation.op === 'set_flag') {
              pendingFlagIds.add(p.mutation.questionId);
            } else if (p.mutation.op === 'upsert_english_progress') {
              pendingEnglishIds.add(p.mutation.paperId);
            }
          }

          if (pull.historyResetRequired) {
            await this.db.history.clear();
          }

          for (const q of pull.questions) {
            if (pendingQuestionIds.has(q.id)) continue;
            if (q.purged) {
              await this.db.questions.delete(q.id);
            } else {
              await this.db.questions.put({
                ...q,
                version: q.version ?? 1,
                deletedAt: q.deletedAt ?? null,
                updatedAt: q.updatedAt ?? Date.now(),
              });
            }
          }

          if (pull.history.length > 0) {
            await this.db.history.bulkPut(
              pull.history.map((h) => ({
                rid: h.rid,
                id: h.id,
                r: h.r,
                t: h.t,
                ...(typeof h.d === 'number' ? { d: h.d } : {}),
                ...(h.capped ? { capped: h.capped } : {}),
              })),
            );
          }

          for (const f of pull.flags) {
            if (pendingFlagIds.has(f.questionId)) continue;
            await this.db.flags.put({
              questionId: f.questionId,
              starred: f.starred,
              mistakeHidden: f.mistakeHidden,
              updatedAt: f.updatedAt,
            });
          }

          for (const ep of pull.englishProgress) {
            if (pendingEnglishIds.has(ep.paperId)) continue;
            await this.db.englishProgress.put({
              paperId: ep.paperId,
              answers: ep.answers || {},
              graded: Boolean(ep.graded),
              result: ep.result || null,
              updatedAt: ep.updatedAt,
            });
          }

          await this.db.meta.put({ key: 'cursor', value: pull.cursor });
          await this.db.meta.put({ key: 'version', value: pull.version });
          if (pull.meta.bankName !== undefined) {
            await this.db.meta.put({ key: 'bankName', value: pull.meta.bankName });
          }
          if (pull.meta.lastPracticeTime !== undefined) {
            await this.db.meta.put({ key: 'lastPracticeTime', value: pull.meta.lastPracticeTime });
          }
        },
      );

      await this.migrateLegacyEnglishLocalStorage();

      const pendingCount = await this.db.outbox.count();
      const cursorNow = (await this.db.meta.get('cursor'))?.value;
      const versionNow = (await this.db.meta.get('version'))?.value;

      useSyncStore.getState().setStatus({
        status: 'synced',
        pendingCount,
        lastSyncedAt: Date.now(),
        lastError: null,
        cursor: typeof cursorNow === 'number' ? cursorNow : 0,
        version: typeof versionNow === 'number' ? versionNow : 0,
      });
      useSyncStore.getState().bumpRevision();
      return true;
    } catch (err) {
      const pendingCount = await this.db.outbox.count().catch(() => 0);
      if (err instanceof ApiError && err.status === 401) {
        useSyncStore.getState().setStatus({
          status: 'auth_expired',
          pendingCount,
          lastError: '登录凭证已过期，请重新登录以同步变更',
        });
        return false;
      }
      const msg = err instanceof Error ? err.message : String(err);
      useSyncStore.getState().setStatus({
        status: typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error',
        pendingCount,
        lastError: msg,
      });
      return false;
    }
  }
}

let activeEngine: SyncEngine | null = null;

export function startSyncEngine(userId: string): SyncEngine {
  if (activeEngine && activeEngine.userId === userId) {
    return activeEngine;
  }
  if (activeEngine) {
    activeEngine.destroy();
  }
  activeEngine = new SyncEngine(userId);
  void activeEngine.refreshMetaAndNotify().then(() => activeEngine?.syncNow({ quiet: true }));
  return activeEngine;
}

export function getSyncEngine(): SyncEngine | null {
  return activeEngine;
}

export function stopSyncEngine(): void {
  if (activeEngine) {
    activeEngine.destroy();
    activeEngine = null;
  }
  useSyncStore.getState().reset();
}
