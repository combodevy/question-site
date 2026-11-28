import type {
  LabHistoryEntry,
  LabSettings,
  LabSyncMutation,
  Question,
  SyncMutation,
} from '@qs/shared';

const TOKEN_STORAGE_KEY = 'qs-auth-token';

export class ApiError extends Error {
  status: number;
  detail?: string;
  constructor(status: number, message: string, detail?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

type SessionExpiredListener = () => void;
const expiredListeners = new Set<SessionExpiredListener>();

export function onSessionExpired(cb: SessionExpiredListener): () => void {
  expiredListeners.add(cb);
  return () => {
    expiredListeners.delete(cb);
  };
}

function notifySessionExpired(): void {
  for (const cb of expiredListeners) {
    try {
      cb();
    } catch {
      // ignore listener errors
    }
  }
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) return null;
      const data = (await res.json().catch(() => null)) as { ok?: boolean; token?: string } | null;
      if (data?.ok && data.token) {
        setStoredToken(data.token);
        return data.token;
      }
      return null;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

const NO_REFRESH_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/refresh',
  '/api/auth/logout',
  '/api/auth/accounts',
  '/api/auth/switch',
  '/api/auth/remove-account',
]);

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  skipAuth?: boolean;
}

export async function apiFetch<T = unknown>(
  path: string,
  opts: ApiFetchOptions = {},
): Promise<T> {
  const { body, skipAuth, headers: customHeaders, ...rest } = opts;

  const exec = async (token: string | null): Promise<Response> => {
    const headers = new Headers(customHeaders);
    if (body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (!skipAuth && token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    return fetch(path, {
      ...rest,
      credentials: 'include',
      headers,
      body:
        body === undefined
          ? undefined
          : typeof body === 'string'
            ? body
            : JSON.stringify(body),
    });
  };

  let res = await exec(getStoredToken());

  if (res.status === 401 && !skipAuth && !NO_REFRESH_PATHS.has(path)) {
    const nextToken = await refreshAccessToken();
    if (nextToken) {
      res = await exec(nextToken);
    } else {
      setStoredToken(null);
      notifySessionExpired();
    }
  }

  const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message =
      (typeof parsed.error === 'string' && parsed.error) ||
      (typeof parsed.message === 'string' && parsed.message) ||
      `HTTP ${res.status}`;
    const detail = typeof parsed.detail === 'string' ? parsed.detail : undefined;
    throw new ApiError(res.status, message, detail);
  }

  return parsed as T;
}

/* ---------- Typed API Surfaces ---------- */

export interface AuthUserSummary {
  id: string;
  username: string;
  createdAt?: string;
  isAdmin?: boolean;
  questionSets?: number;
  questionCount?: number;
  lastVersion?: number;
}

export interface AuthLoginResponse {
  ok: true;
  token: string;
  user: { id: string; username: string; isAdmin?: boolean };
}

export interface SavedAccountItem {
  id: string;
  username: string;
  isAdmin: boolean;
  questionCount: number;
  isCurrent: boolean;
}

export interface AuthMeResponse {
  ok: true;
  user: AuthUserSummary & { isAdmin: boolean; createdAt: string };
}

export interface PulledQuestion extends Question {
  version: number;
  deletedAt: number | null;
  deleteReason?: string | null;
  originalPath?: { sub?: string | null; chap?: string | null };
  wasStarred?: boolean;
  purged?: boolean;
  updatedAt: number;
  syncSeq: number;
}

export interface SyncPushResultItem {
  opId: string;
  op: SyncMutation['op'];
  status: 'applied' | 'duplicate' | 'conflict' | 'invalid' | 'not_found';
  version?: number;
  syncSeq?: number;
  serverVersion?: number;
  serverDeleted?: boolean;
  serverQuestion?: PulledQuestion;
}

export interface SyncPushResponse {
  ok: true;
  cursor: number;
  version: number;
  results: SyncPushResultItem[];
}

export interface SyncPullResponse {
  ok: true;
  cursor: number;
  version: number;
  historyResetRequired: boolean;
  meta: {
    bankName: string | null;
    lastPracticeTime: number | null;
  };
  questions: PulledQuestion[];
  history: Array<{
    rid: string;
    id: string;
    r: boolean;
    t: number;
    d?: number;
    capped?: boolean;
    syncSeq: number;
  }>;
  flags: Array<{
    questionId: string;
    starred: boolean;
    mistakeHidden: boolean;
    updatedAt: number;
    syncSeq: number;
  }>;
  englishProgress: Array<{
    paperId: string;
    answers: Record<string, string>;
    graded: boolean;
    result: Record<string, unknown> | null;
    updatedAt: number;
    syncSeq: number;
  }>;
}

export interface BackupSummary {
  id: number;
  type: 'bank' | 'history';
  created_at: string;
  size: number;
}

export interface BackupDetail {
  ok: true;
  id: number;
  type: 'bank' | 'history';
  createdAt: string;
  payload: unknown;
}

export interface SyncLogEntry {
  id: number;
  delta: Record<string, unknown> | null;
  status: string;
  error: string | null;
  created_at: string;
  username?: string;
}

export const authApi = {
  login: (username: string, password: string) =>
    apiFetch<AuthLoginResponse>('/api/auth/login', {
      method: 'POST',
      body: { username, password },
      skipAuth: true,
    }),
  signup: (username: string, password: string) =>
    apiFetch<AuthLoginResponse>('/api/auth/signup', {
      method: 'POST',
      body: { username, password },
      skipAuth: true,
    }),
  refresh: async (): Promise<AuthLoginResponse | null> => {
    try {
      return await apiFetch<AuthLoginResponse>('/api/auth/refresh', {
        method: 'POST',
        skipAuth: true,
      });
    } catch {
      return null;
    }
  },
  logout: (all = false) =>
    apiFetch<{ ok: true }>('/api/auth/logout', {
      method: 'POST',
      body: all ? { all: true } : undefined,
      skipAuth: true,
    }).catch(() => ({
      ok: true as const,
    })),
  accounts: () =>
    apiFetch<{ ok: true; accounts: SavedAccountItem[] }>('/api/auth/accounts').catch(() => ({
      ok: true as const,
      accounts: [] as SavedAccountItem[],
    })),
  switchAccount: (userId: string) =>
    apiFetch<AuthLoginResponse>('/api/auth/switch', {
      method: 'POST',
      body: { userId },
      skipAuth: true,
    }),
  removeAccount: (userId: string) =>
    apiFetch<{ ok: true }>('/api/auth/remove-account', {
      method: 'POST',
      body: { userId },
      skipAuth: true,
    }),
  me: () => apiFetch<AuthMeResponse>('/api/auth/me'),
  changePassword: (oldPassword: string, newPassword: string) =>
    apiFetch<{ ok: true; token: string }>('/api/auth/change-password', {
      method: 'POST',
      body: { oldPassword, newPassword },
    }),
  deleteAccount: (password: string) =>
    apiFetch<{ ok: true }>('/api/auth/delete-account', {
      method: 'POST',
      body: { password },
    }),
};

export const syncApi = {
  push: (mutations: SyncMutation[]) =>
    apiFetch<SyncPushResponse>('/api/sync/push', {
      method: 'POST',
      body: { mutations },
    }),
  pull: (cursor: number) =>
    apiFetch<SyncPullResponse>(`/api/sync/pull?cursor=${Math.max(0, Math.floor(cursor))}`),
  listLogs: () => apiFetch<{ ok: true; logs: SyncLogEntry[] }>('/api/sync-logs'),
  listBackups: (type?: 'bank' | 'history') =>
    apiFetch<{ ok: true; backups: BackupSummary[] }>(
      type ? `/api/user-backups?type=${type}` : '/api/user-backups',
    ),
  getBackup: (id: number) => apiFetch<BackupDetail>(`/api/user-backups?id=${id}`),
  createBackup: (type: 'bank' | 'history', payload: unknown) =>
    apiFetch<{ ok: true }>('/api/user-backups', {
      method: 'POST',
      body: { type, payload },
    }),
  reportClientError: (message: string, stack: string, page: string) =>
    apiFetch<{ ok: true }>('/api/client-errors', {
      method: 'POST',
      body: { message, stack, page },
    }).catch(() => ({ ok: true as const })),
};

export interface LabSyncPullResponse {
  ok: true;
  cursor: number;
  version: number;
  bankCursor: number;
  historyResetRequired: boolean;
  meta: {
    bankName: string | null;
    lastPracticeTime: number | null;
  };
  settings: LabSettings;
  questions: PulledQuestion[];
  history: Array<LabHistoryEntry & { syncSeq: number }>;
  flags: Array<{
    questionId: string;
    starred: boolean;
    mistakeHidden: boolean;
    updatedAt: number;
    syncSeq: number;
  }>;
}

export const labSyncApi = {
  push: (mutations: LabSyncMutation[]) =>
    apiFetch<{
      ok: true;
      cursor: number;
      version: number;
      results: Array<{ opId: string; op: LabSyncMutation['op']; status: string; syncSeq?: number }>;
    }>('/api/lab/sync/push', {
      method: 'POST',
      body: { mutations },
    }),
  pull: (cursor: number, bankCursor: number) =>
    apiFetch<LabSyncPullResponse>(
      `/api/lab/sync/pull?cursor=${Math.max(0, Math.floor(cursor))}&bankCursor=${Math.max(0, Math.floor(bankCursor))}`,
    ),
};

/* ---------- Admin & Ops Types ---------- */

export interface AdminUserRow {
  id: string;
  user_id: string;
  email: string;
  username: string;
  is_admin: boolean;
  bank_count: number;
  question_count: number;
  sync_count: number;
  conflict_count: number;
  error_count: number;
  last_active_at: string;
  last_ip: string;
  last_device: string;
}

export interface ServerOpsMetrics {
  timestamp: string;
  os: {
    platform: string;
    release: string;
    hostname: string;
    arch: string;
    nodeVersion: string;
    uptimeSeconds: number;
  };
  cpu: { cores: number; model: string; loadavg: [number, number, number] };
  memory: { totalMB: number; usedMB: number; freeMB: number; percent: number };
  disk: {
    total: string;
    used: string;
    avail: string;
    percent: string;
    dataSize: string;
    backupSize: string;
    d1DbSize: string;
  };
  services: { api: string; nginx: string; openPorts: string[] };
  backups: Array<{ name: string; mtime: string; size: string }>;
  logs: { journal: string; nginx: string };
}

export const adminApi = {
  overviewStats: () =>
    apiFetch<{
      ok: true;
      stats: { users: number; sets: number; questions: number; logs: number; activeToday: number };
    }>('/api/admin/overview-stats'),
  usersList: (page = 1, pageSize = 20, q = '') =>
    apiFetch<{
      ok: true;
      users: AdminUserRow[];
      meta: { total: number; page: number; pageSize: number; pages: number; email_access: boolean };
    }>(
      `/api/admin/users-list?page=${page}&pageSize=${pageSize}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
    ),
  userDossier: (userId: string) =>
    apiFetch<{
      ok: true;
      user: { id: string; username: string; created_at: string; is_admin: boolean; email: string };
      sets: Array<{ id: number; name: string; version: number; question_count: number; created_at: string }>;
      studyStats: {
        totalQuestions: number;
        answeredCount: number;
        correctCount: number;
        wrongCount: number;
        accuracyPercent: number;
        favoritesCount: number;
        trashCount: number;
        sm2DueCount: number;
        uniqueDays: number;
      };
      network: { uniqueIps: string[]; uniqueDevices: string[] };
      recentLogs: SyncLogEntry[];
      backups: BackupSummary[];
      snapshots: Array<{ user_id: string; set_id: number; version: number; created_at: string; size: number }>;
    }>(`/api/admin/user-dossier?userId=${encodeURIComponent(userId)}`),
  userExport: (userId: string) =>
    apiFetch<{ ok: true; bundle: unknown }>(
      `/api/admin/user-export?userId=${encodeURIComponent(userId)}`,
    ),
  createUser: (username: string, password: string) =>
    apiFetch<{ ok: true; user: { id: string; email: string } }>('/api/admin/create-user', {
      method: 'POST',
      body: { username, password },
    }),
  deleteUsers: (userIds: string[]) =>
    apiFetch<{ ok: true; deletedCount: number }>('/api/admin/delete-users', {
      method: 'POST',
      body: { userIds },
    }),
  resetUserPassword: (userId: string, newPassword: string) =>
    apiFetch<{ ok: true }>('/api/admin/reset-user-password', {
      method: 'POST',
      body: { userId, newPassword },
    }),
  usersSets: (userId: string) =>
    apiFetch<{
      ok: true;
      sets: Array<{ id: number; name: string; version: number; created_at: string; question_count: number }>;
    }>(`/api/admin/users-sets?userId=${encodeURIComponent(userId)}`),
  setDetails: (setId: number) =>
    apiFetch<{
      ok: true;
      bank_info: { id: number; name: string; version: number; created_at: string };
      user_id: string;
      questions: Question[];
    }>(`/api/admin/set-details?setId=${setId}`),
  updateUserBank: (userId: string, setId: number, name: string, questions: Question[]) =>
    apiFetch<{ ok: true }>('/api/admin/users-update-bank', {
      method: 'POST',
      body: { userId, setId, name, questions },
    }),
  pushBroadcast: (payload: {
    target: 'all' | 'multi' | 'user';
    userId?: string;
    userIds?: string[];
    bankName: string;
    questions: Question[];
  }) =>
    apiFetch<{
      ok: true;
      summary: {
        target: string;
        total: number;
        success: number;
        failed: number;
        skippedDuplicate: number;
      };
    }>('/api/admin/push-broadcast', {
      method: 'POST',
      body: payload,
    }),
  systemLogs: () =>
    apiFetch<{ ok: true; logs: Array<SyncLogEntry & { username: string }> }>(
      '/api/admin/system-logs',
    ),
  opsMetrics: () =>
    apiFetch<{ ok: true; metrics: ServerOpsMetrics; cached?: boolean }>(
      '/api/admin/server-ops/metrics',
    ),
  opsAction: (action: 'backup' | 'restart-api') =>
    apiFetch<{ ok: true; message: string; output?: string }>('/api/admin/server-ops/action', {
      method: 'POST',
      body: { action },
    }),
};
