import { create } from 'zustand';

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error' | 'auth_expired';

interface SyncStoreState {
  status: SyncStatus;
  pendingCount: number;
  lastSyncedAt: number | null;
  lastError: string | null;
  version: number;
  cursor: number;
  dataRevision: number;
  setStatus: (patch: Partial<Omit<SyncStoreState, 'setStatus' | 'bumpRevision' | 'reset'>>) => void;
  bumpRevision: () => void;
  reset: () => void;
}

export const useSyncStore = create<SyncStoreState>((set) => ({
  status: 'idle',
  pendingCount: 0,
  lastSyncedAt: null,
  lastError: null,
  version: 0,
  cursor: 0,
  dataRevision: 0,

  setStatus: (patch) => set(patch),
  bumpRevision: () => set((s) => ({ dataRevision: s.dataRevision + 1 })),
  reset: () =>
    set({
      status: 'idle',
      pendingCount: 0,
      lastSyncedAt: null,
      lastError: null,
      version: 0,
      cursor: 0,
      dataRevision: 0,
    }),
}));
