import {
  parseLabSettings,
  type LabHistoryEntry,
  type LabSettings,
  type LabSyncMutation,
} from '@qs/shared';
import { ApiError, labSyncApi } from '@/lib/api';
import {
  closeLabDb,
  getLabDb,
  type LabOutboxEntry,
  type QsLabDatabase,
} from '@/lab/db';
import { useLabSyncStore } from '@/lab/useLabSyncStore';

const LAB_BROADCAST_CHANNEL = 'qs_lab_sync';
const PUSH_BATCH_SIZE = 400;

function makeOpId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `lab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class LabSyncEngine {
  readonly userId: string;
  readonly db: QsLabDatabase;
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
      void this.syncNow({ quiet: true });
    }
  };

  constructor(userId: string) {
    this.userId = userId;
    this.db = getLabDb(userId);

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
          this.channel = new BroadcastChannel(LAB_BROADCAST_CHANNEL);
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
    void closeLabDb(this.userId);
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
    const [pendingCount, cursorMeta, bankCursorMeta, versionMeta] = await Promise.all([
      this.db.outbox.count(),
      this.db.meta.get('labCursor'),
      this.db.meta.get('bankCursor'),
      this.db.meta.get('version'),
    ]);
    useLabSyncStore.getState().setStatus({
      pendingCount,
      cursor: typeof cursorMeta?.value === 'number' ? cursorMeta.value : 0,
      bankCursor: typeof bankCursorMeta?.value === 'number' ? bankCursorMeta.value : 0,
      version: typeof versionMeta?.value === 'number' ? versionMeta.value : 0,
    });
    useLabSyncStore.getState().bumpRevision();
  }

  private schedulePush(): void {
    if (this.destroyed) return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      void this.syncNow({ quiet: true });
    }, 350);
  }

  private async enqueueAndNotify(mutations: LabSyncMutation[]): Promise<void> {
    if (mutations.length > 0) {
      const now = Date.now();
      const rows: LabOutboxEntry[] = mutations.map((m) => ({
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

  /* ---------- Isolated Lab Mutations ---------- */

  async appendHistory(entries: LabHistoryEntry[]): Promise<void> {
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
      const m: LabSyncMutation = {
        opId: makeOpId(),
        op: 'lab_append_history',
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
        const m: LabSyncMutation = { opId: makeOpId(), op: 'lab_clear_history' };
        await this.db.outbox.add({ opId: m.opId, op: m.op, mutation: m, createdAt: now });
      },
    );
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
      const m: LabSyncMutation = {
        opId: makeOpId(),
        op: 'lab_set_flag',
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
      const m: LabSyncMutation = { opId: makeOpId(), op: 'lab_restore_hidden_mistakes' };
      await this.db.outbox.add({ opId: m.opId, op: m.op, mutation: m, createdAt: now });
    });
    await this.refreshMetaAndNotify();
    this.broadcast();
    this.schedulePush();
  }

  async updateSettings(next: LabSettings): Promise<void> {
    const clean = parseLabSettings(next);
    await this.db.meta.put({ key: 'settings', value: clean });
    await this.enqueueAndNotify([
      {
        opId: makeOpId(),
        op: 'lab_update_settings',
        settings: clean,
      },
    ]);
  }

  syncNow(opts?: { quiet?: boolean }): Promise<boolean> {
    if (this.inFlightSync) return this.inFlightSync;
    this.inFlightSync = this._doSyncNow(opts).finally(() => {
      this.inFlightSync = null;
    });
    return this.inFlightSync;
  }

  private async _doSyncNow(_opts?: { quiet?: boolean }): Promise<boolean> {
    if (this.destroyed) return false;
    const syncStore = useLabSyncStore.getState();

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      syncStore.setStatus({ status: 'offline' });
      return false;
    }

    syncStore.setStatus({ status: 'syncing', lastError: null });

    try {
      while (!this.destroyed) {
        const batch = await this.db.outbox.orderBy('seq').limit(PUSH_BATCH_SIZE).toArray();
        if (!batch.length) break;

        const res = await labSyncApi.push(batch.map((b) => b.mutation));
        const opsToRemove = res.results.map((r) => r.opId);
        if (opsToRemove.length) {
          await this.db.outbox.where('opId').anyOf(opsToRemove).delete();
        }
      }

      if (this.destroyed) return false;

      const [cursorRow, bankCursorRow] = await Promise.all([
        this.db.meta.get('labCursor'),
        this.db.meta.get('bankCursor'),
      ]);
      const curCursor = typeof cursorRow?.value === 'number' ? cursorRow.value : 0;
      const curBankCursor = typeof bankCursorRow?.value === 'number' ? bankCursorRow.value : 0;

      const pull = await labSyncApi.pull(curCursor, curBankCursor);
      this.lastPullAt = Date.now();

      await this.db.transaction(
        'rw',
        [this.db.questions, this.db.history, this.db.flags, this.db.meta, this.db.outbox],
        async () => {
          const stillPending = await this.db.outbox.toArray();
          const pendingFlagIds = new Set<string>();
          let hasPendingSettings = false;
          for (const p of stillPending) {
            if (p.mutation.op === 'lab_set_flag') {
              pendingFlagIds.add(p.mutation.questionId);
            } else if (p.mutation.op === 'lab_update_settings') {
              hasPendingSettings = true;
            }
          }

          if (pull.historyResetRequired) {
            await this.db.history.clear();
          }

          for (const q of pull.questions) {
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
                ...(h.conf ? { conf: h.conf } : {}),
                ...(h.rating ? { rating: h.rating } : {}),
                ...(h.mode ? { mode: h.mode } : {}),
                ...(h.blind ? { blind: h.blind } : {}),
                ...(h.requeued ? { requeued: h.requeued } : {}),
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

          await this.db.meta.put({ key: 'labCursor', value: pull.cursor });
          await this.db.meta.put({ key: 'bankCursor', value: pull.bankCursor });
          await this.db.meta.put({ key: 'version', value: pull.version });
          if (pull.meta.bankName !== undefined) {
            await this.db.meta.put({ key: 'bankName', value: pull.meta.bankName });
          }
          if (pull.meta.lastPracticeTime !== undefined) {
            await this.db.meta.put({ key: 'lastPracticeTime', value: pull.meta.lastPracticeTime });
          }
          if (!hasPendingSettings && pull.settings) {
            await this.db.meta.put({ key: 'settings', value: parseLabSettings(pull.settings) });
          }
        },
      );

      const pendingCount = await this.db.outbox.count();
      const [cursorNow, bankCursorNow, versionNow] = await Promise.all([
        this.db.meta.get('labCursor'),
        this.db.meta.get('bankCursor'),
        this.db.meta.get('version'),
      ]);

      syncStore.setStatus({
        status: 'synced',
        pendingCount,
        lastSyncedAt: Date.now(),
        lastError: null,
        cursor: typeof cursorNow?.value === 'number' ? cursorNow.value : 0,
        bankCursor: typeof bankCursorNow?.value === 'number' ? bankCursorNow.value : 0,
        version: typeof versionNow?.value === 'number' ? versionNow.value : 0,
      });
      syncStore.bumpRevision();
      return true;
    } catch (err) {
      const pendingCount = await this.db.outbox.count().catch(() => 0);
      if (err instanceof ApiError && err.status === 401) {
        syncStore.setStatus({
          status: 'auth_expired',
          pendingCount,
          lastError: '登录凭证已过期，请重新登录后继续同步',
        });
        return false;
      }
      const msg = err instanceof Error ? err.message : String(err);
      syncStore.setStatus({
        status: typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error',
        pendingCount,
        lastError: msg,
      });
      return false;
    }
  }
}

let activeLabEngine: LabSyncEngine | null = null;

export function startLabSyncEngine(userId: string): LabSyncEngine {
  if (activeLabEngine && activeLabEngine.userId === userId) {
    return activeLabEngine;
  }
  if (activeLabEngine) {
    activeLabEngine.destroy();
  }
  activeLabEngine = new LabSyncEngine(userId);
  void activeLabEngine.refreshMetaAndNotify().then(() => activeLabEngine?.syncNow({ quiet: true }));
  return activeLabEngine;
}

export function getLabSyncEngine(): LabSyncEngine | null {
  return activeLabEngine;
}

export function stopLabSyncEngine(): void {
  if (activeLabEngine) {
    activeLabEngine.destroy();
    activeLabEngine = null;
  }
  useLabSyncStore.getState().reset();
}
