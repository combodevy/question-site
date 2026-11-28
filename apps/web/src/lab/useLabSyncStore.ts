import { create } from 'zustand';

export type LabSyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error' | 'auth_expired';

interface LabSyncStoreState {
  status: LabSyncStatus;
  pendingCount: number;
  lastSyncedAt: number | null;
  lastError: string | null;
  version: number;
  cursor: number;
  bankCursor: number;
  dataRevision: number;
  setStatus: (
    patch: Partial<Omit<LabSyncStoreState, 'setStatus' | 'bumpRevision' | 'reset'>>,
  ) => void;
  bumpRevision: () => void;
  reset: () => void;
}

export const useLabSyncStore = create<LabSyncStoreState>((set) => ({
  status: 'idle',
  pendingCount: 0,
  lastSyncedAt: null,
  lastError: null,
  version: 0,
  cursor: 0,
  bankCursor: 0,
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
      bankCursor: 0,
      dataRevision: 0,
    }),
}));
