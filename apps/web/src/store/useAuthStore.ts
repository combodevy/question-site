import { create } from 'zustand';
import {
  authApi,
  getStoredToken,
  onSessionExpired,
  setStoredToken,
  type AuthUserSummary,
} from '@/lib/api';
import { deleteUserDb } from '@/db';
import { startSyncEngine, stopSyncEngine } from '@/sync/engine';

export type AuthStatus = 'booting' | 'authenticated' | 'unauthenticated';

interface AuthState {
  status: AuthStatus;
  user: AuthUserSummary | null;
  sessionExpired: boolean;
  bootstrap: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  signup: (username: string, password: string) => Promise<void>;
  logout: (clearLocalDb?: boolean) => Promise<void>;
  refreshMe: () => Promise<void>;
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

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'booting',
  user: null,
  sessionExpired: false,

  bootstrap: async () => {
    const token = getStoredToken();
    const localClaims = token ? parseJwtSub(token) : null;

    if (localClaims) {
      // Offline-first boot: immediately hydrate local IndexedDB + UI while validating in background
      set({
        status: 'authenticated',
        sessionExpired: false,
        user: { id: localClaims.id, username: localClaims.username, isAdmin: localClaims.isAdmin },
      });
      startSyncEngine(localClaims.id);
      try {
        const res = await authApi.me();
        set({ user: res.user, sessionExpired: false });
      } catch {
        // Offline or expired (onSessionExpired sets sessionExpired=true if refresh failed)
      }
      return;
    }

    // No stored access token — try HttpOnly refresh cookie silently
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
        startSyncEngine(claims.id);
        void get().refreshMe();
        return;
      }
    }

    set({ status: 'unauthenticated', user: null, sessionExpired: false });
  },

  login: async (username, password) => {
    const res = await authApi.login(username, password);
    setStoredToken(res.token);
    const claims = parseJwtSub(res.token);
    const nextUser: AuthUserSummary = {
      id: res.user.id,
      username: res.user.username,
      isAdmin: claims?.isAdmin ?? false,
    };
    set({ status: 'authenticated', user: nextUser, sessionExpired: false });
    startSyncEngine(res.user.id);
    void get().refreshMe();
  },

  signup: async (username, password) => {
    const res = await authApi.signup(username, password);
    setStoredToken(res.token);
    const nextUser: AuthUserSummary = {
      id: res.user.id,
      username: res.user.username,
      isAdmin: false,
    };
    set({ status: 'authenticated', user: nextUser, sessionExpired: false });
    startSyncEngine(res.user.id);
    void get().refreshMe();
  },

  logout: async (clearLocalDb = true) => {
    const uid = get().user?.id;
    stopSyncEngine();
    setStoredToken(null);
    await authApi.logout();
    if (clearLocalDb && uid) {
      await deleteUserDb(uid).catch(() => undefined);
    }
    set({ status: 'unauthenticated', user: null, sessionExpired: false });
  },

  refreshMe: async () => {
    try {
      const res = await authApi.me();
      set({ user: res.user, sessionExpired: false });
    } catch {
      // ignore
    }
  },
}));

onSessionExpired(() => {
  const st = useAuthStore.getState();
  if (st.status === 'authenticated') {
    useAuthStore.setState({ sessionExpired: true });
  }
});
