import React, { useEffect, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  BookOpen,
  FileSpreadsheet,
  Moon,
  Send,
  ShieldAlert,
  Sun,
  Users,
} from 'lucide-react';
import { authApi, getStoredToken, setStoredToken, type AuthUserSummary } from '@/lib/api';
import { resolveIsDark, useUiStore } from '@/store/useUiStore';
import { Button } from '@/components/ui/Button';
import { ToastHost } from '@/components/ui/ToastHost';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AdminOpsView } from './AdminOpsView';
import { AdminUsersView } from './AdminUsersView';
import { AdminBankEditorView } from './AdminBankEditorView';
import { AdminBroadcastView } from './AdminBroadcastView';
import { AdminLogsView } from './AdminLogsView';

type AdminTab = 'ops' | 'users' | 'bank' | 'broadcast' | 'logs';

export const AdminApp: React.FC = () => {
  const { theme, setTheme, pushToast } = useUiStore();

  const [state, setState] = useState<'loading' | 'unauth' | 'forbidden' | 'ready'>('loading');
  const [user, setUser] = useState<AuthUserSummary | null>(null);
  const [tab, setTab] = useState<AdminTab>('ops');
  const [bankTargetUid, setBankTargetUid] = useState<string | undefined>(undefined);

  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  const checkSession = async () => {
    setState('loading');
    try {
      if (!getStoredToken()) {
        const refreshed = await authApi.refresh();
        if (refreshed?.token) setStoredToken(refreshed.token);
      }
      const me = await authApi.me();
      setUser(me.user);
      setState(me.user.isAdmin ? 'ready' : 'forbidden');
    } catch {
      setState('unauth');
    }
  };

  useEffect(() => {
    void checkSession();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginBusy(true);
    try {
      const res = await authApi.login(username.trim(), password);
      setStoredToken(res.token);
      await checkSession();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setLoginBusy(false);
    }
  };

  const isDarkActive = resolveIsDark(theme);
  const toggleDark = () => {
    setTheme(isDarkActive ? 'light' : 'dark');
  };

  if (state === 'loading') {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center text-xs text-ink-muted">
        正在验证管理员身份…
      </div>
    );
  }

  if (state === 'unauth' || state === 'forbidden') {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
        <div className="max-w-sm w-full bg-surface border border-line rounded-2xl p-6 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h1 className="text-base font-semibold text-ink">管理控制台登录</h1>
            <button
              type="button"
              onClick={toggleDark}
              className="w-8 h-8 rounded-lg border border-line text-ink-muted hover:text-ink flex items-center justify-center"
            >
              {isDarkActive ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>

          {state === 'forbidden' && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>当前账号「{user?.username}」没有管理员权限，请使用管理员账号登录。</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-3">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="管理员用户名"
              className="w-full h-10 px-3 rounded-xl bg-canvas border border-line text-sm text-ink outline-none focus:border-accent"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="密码"
              className="w-full h-10 px-3 rounded-xl bg-canvas border border-line text-sm text-ink outline-none focus:border-accent"
            />
            <Button type="submit" variant="primary" className="w-full" loading={loginBusy}>
              登录控制台
            </Button>
          </form>

          <a href="/index.html" className="block text-center text-xs text-ink-muted hover:text-ink">
            ← 返回刷题前台
          </a>
        </div>
        <ToastHost />
        <ConfirmDialog />
      </div>
    );
  }

  const nav: Array<{ key: AdminTab; label: string; icon: React.ReactNode }> = [
    { key: 'ops', label: '概览与运维', icon: <Activity className="w-4 h-4" /> },
    { key: 'users', label: '用户档案', icon: <Users className="w-4 h-4" /> },
    { key: 'bank', label: '题库编辑', icon: <BookOpen className="w-4 h-4" /> },
    { key: 'broadcast', label: '广播下发', icon: <Send className="w-4 h-4" /> },
    { key: 'logs', label: '审计日志', icon: <FileSpreadsheet className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-canvas flex flex-col md:flex-row">
      <aside className="hidden md:flex md:w-60 md:flex-col md:fixed md:inset-y-0 bg-surface border-r border-line">
        <div className="px-5 py-5 border-b border-line">
          <div className="text-sm font-semibold text-ink">Question Site Admin</div>
          <div className="text-xs text-ink-muted mt-0.5">{user?.username}</div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {nav.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                tab === item.key
                  ? 'bg-accent-soft text-accent'
                  : 'text-ink-muted hover:text-ink hover:bg-surface-muted'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-line flex items-center justify-between gap-2">
          <a href="/index.html" className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1">
            <ArrowLeft className="w-3.5 h-3.5" />
            返回前台
          </a>
          <button
            type="button"
            onClick={toggleDark}
            className="w-8 h-8 rounded-lg border border-line text-ink-muted hover:text-ink flex items-center justify-center"
          >
            {isDarkActive ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </aside>

      <header className="md:hidden bg-surface border-b border-line px-4 py-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-ink">Admin Console</span>
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {nav.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`px-2.5 py-1 rounded-lg text-xs ${
                tab === item.key ? 'bg-accent text-accent-fg' : 'text-ink-muted'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <main className="flex-1 md:pl-60 p-4 sm:p-6 lg:p-8 max-w-6xl w-full mx-auto">
        {tab === 'ops' && <AdminOpsView />}
        {tab === 'users' && (
          <AdminUsersView
            onInspectBank={(uid) => {
              setBankTargetUid(uid);
              setTab('bank');
            }}
          />
        )}
        {tab === 'bank' && <AdminBankEditorView initialUserId={bankTargetUid} />}
        {tab === 'broadcast' && <AdminBroadcastView />}
        {tab === 'logs' && <AdminLogsView />}
      </main>

      <ToastHost />
      <ConfirmDialog />
    </div>
  );
};
