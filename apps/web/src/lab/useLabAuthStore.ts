import { create } from 'zustand';
import {
  authApi,
  getStoredToken,
  onSessionExpired,
  setStoredToken,
  type AuthUserSummary,
  type SavedAccountItem,
} from '@/lib/api';
import { deleteLabDb } from '@/lab/db';
import {
  getLabSyncEngine,
  startLabSyncEngine,
  stopLabSyncEngine,
} from '@/lab/syncEngine';
import { useLabQuizStore } from '@/lab/useLabQuizStore';

export type LabAuthStatus = 'booting' | 'authenticated' | 'unauthenticated';

interface LabAuthState {
  status: LabAuthStatus;
  user: AuthUserSummary | null;
  sessionExpired: boolean;
  savedAccounts: SavedAccountItem[];
  switchingAccount: boolean;
  bootstrap: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  signup: (username: string, password: string) => Promise<void>;
  logout: (clearLocalDb?: boolean, logoutAll?: boolean) => Promise<void>;
  refreshMe: () => Promise<void>;
  fetchSavedAccounts: () => Promise<SavedAccountItem[]>;
  switchAccount: (targetUserId: string) => Promise<void>;
  removeSavedAccount: (targetUserId: string) => Promise<void>;
}

function parseJwtSub(token: string): { id: string; username: string; isAdmin: boolean } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(b64)) as { sub?: string; username?: string; role?: string };
    if (!json.sub || !json.username) return null;
    return { id: json.sub, username: json.username, isAdmin: json.role === 'admin' };
  } catch {
    return null;
  }
}

export const useLabAuthStore = create<LabAuthState>((set, get) => ({
  status: 'booting',
  user: null,
  sessionExpired: false,
  savedAccounts: [],
  switchingAccount: false,

  bootstrap: async () => {
    const token = getStoredToken();
    const localClaims = token ? parseJwtSub(token) : null;

    if (localClaims) {
      set({
        status: 'authenticated',
        sessionExpired: false,
        user: { id: localClaims.id, username: localClaims.username, isAdmin: localClaims.isAdmin },
      });
      startLabSyncEngine(localClaims.id);
      try {
        const res = await authApi.me();
        set({ user: res.user, sessionExpired: false });
      } catch {
        // offline or handled by onSessionExpired
      }
      void get().fetchSavedAccounts();
      return;
    }

    const refreshed = await authApi.refresh();
    if (refreshed?.ok && refreshed.token) {
      setStoredToken(refreshed.token);
      const claims = parseJwtSub(refreshed.token);
      if (claims) {
        set({
          status: 'authenticated',
          sessionExpired: false,
          user: { id: claims.id, username: claims.username, isAdmin: claims.isAdmin },
        });
        startLabSyncEngine(claims.id);
        void get().refreshMe();
        void get().fetchSavedAccounts();
        return;
      }
    }

    set({ status: 'unauthenticated', user: null, sessionExpired: false });
    void get().fetchSavedAccounts();
  },

  login: async (username, password) => {
    const res = await authApi.login(username, password);
    try {
      await getLabSyncEngine()?.syncNow({ quiet: true });
    } catch {
      // ignore flush error
    }
    useLabQuizStore.getState().detachSession();
    stopLabSyncEngine();
    setStoredToken(res.token);
    const claims = parseJwtSub(res.token);
    const nextUser: AuthUserSummary = {
      id: res.user.id,
      username: res.user.username,
      isAdmin: claims?.isAdmin ?? Boolean(res.user.isAdmin),
    };
    set({ status: 'authenticated', user: nextUser, sessionExpired: false });
    startLabSyncEngine(res.user.id);
    void get().refreshMe();
    void get().fetchSavedAccounts();
  },

  signup: async (username, password) => {
    const res = await authApi.signup(username, password);
    try {
      await getLabSyncEngine()?.syncNow({ quiet: true });
    } catch {
      // ignore
    }
    useLabQuizStore.getState().detachSession();
    stopLabSyncEngine();
    setStoredToken(res.token);
    const claims = parseJwtSub(res.token);
    const nextUser: AuthUserSummary = {
      id: res.user.id,
      username: res.user.username,
      isAdmin: claims?.isAdmin ?? false,
    };
    set({ status: 'authenticated', user: nextUser, sessionExpired: false });
    startLabSyncEngine(res.user.id);
    void get().refreshMe();
    void get().fetchSavedAccounts();
  },

  logout: async (clearLocalDb = true, logoutAll = false) => {
    const uid = get().user?.id;
    useLabQuizStore.getState().detachSession();
    stopLabSyncEngine();
    setStoredToken(null);
    await authApi.logout(logoutAll);
    if (clearLocalDb && uid) {
      await deleteLabDb(uid).catch(() => undefined);
    }
    set({ status: 'unauthenticated', user: null, sessionExpired: false });
    void get().fetchSavedAccounts();
  },

  refreshMe: async () => {
    try {
      const res = await authApi.me();
      set({ user: res.user, sessionExpired: false });
    } catch {
      // ignore
    }
  },

  fetchSavedAccounts: async () => {
    try {
      const res = await authApi.accounts();
      const list = Array.isArray(res.accounts) ? res.accounts : [];
      set({ savedAccounts: list });
      return list;
    } catch {
      return get().savedAccounts;
    }
  },

  switchAccount: async (targetUserId) => {
    set({ switchingAccount: true });
    try {
      try {
        await getLabSyncEngine()?.syncNow({ quiet: true });
      } catch {
        // ignore
      }
      const res = await authApi.switchAccount(targetUserId);
      useLabQuizStore.getState().detachSession();
      stopLabSyncEngine();
      setStoredToken(res.token);
      const claims = parseJwtSub(res.token);
      const nextUser: AuthUserSummary = {
        id: res.user.id,
        username: res.user.username,
        isAdmin: claims?.isAdmin ?? Boolean(res.user.isAdmin),
      };
      set({ status: 'authenticated', user: nextUser, sessionExpired: false });
      startLabSyncEngine(res.user.id);
      void get().refreshMe();
      await get().fetchSavedAccounts();
    } finally {
      set({ switchingAccount: false });
    }
  },

  removeSavedAccount: async (targetUserId) => {
    await authApi.removeAccount(targetUserId);
    if (get().user?.id === targetUserId) {
      useLabQuizStore.getState().detachSession();
      stopLabSyncEngine();
      setStoredToken(null);
      set({ status: 'unauthenticated', user: null, sessionExpired: false });
    }
    await get().fetchSavedAccounts();
  },
}));

onSessionExpired(() => {
  const st = useLabAuthStore.getState();
  if (st.status === 'authenticated') {
    useLabAuthStore.setState({ sessionExpired: true });
  }
});
