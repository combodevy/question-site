import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  BarChart3,
  BookOpenCheck,
  Cloud,
  CloudOff,
  FileText,
  Globe,
  LayoutDashboard,
  Library,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Shield,
  SlidersHorizontal,
  Sun,
  UserCircle2,
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { useSyncStore } from '@/store/useSyncStore';
import { resolveIsDark, useUiStore } from '@/store/useUiStore';
import { getSyncEngine } from '@/sync/engine';
import { useBi } from '@/i18n/useBi';
import { ReauthModal } from '@/features/auth/AuthGate';
import { Button } from '@/components/ui/Button';
import { BackToTop } from '@/components/ui/BackToTop';
import { AccountSwitcherModal } from '@/components/layout/AccountSwitcherModal';

export type NavTab = 'dashboard' | 'setup' | 'library' | 'analytics' | 'english' | 'profile';

interface ShellLayoutProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  focusMode?: boolean;
  pendingWrongCount?: number;
  children: React.ReactNode;
}

export const ShellLayout: React.FC<ShellLayoutProps> = ({
  activeTab,
  onSelectTab,
  focusMode = false,
  pendingWrongCount = 0,
  children,
}) => {
  const { bi, lang } = useBi();
  const { user, sessionExpired } = useAuthStore();
  const sync = useSyncStore();
  const { theme, setTheme, setLang, sidebarCollapsed, toggleSidebarCollapsed } = useUiStore();
  const [reauthOpen, setReauthOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const navItems: Array<{
    key: NavTab;
    label: string;
    shortLabel: string;
    icon: React.ReactNode;
    badge?: number;
  }> = [
    { key: 'dashboard', label: bi('概览', 'Overview'), shortLabel: bi('概览', 'Home'), icon: <LayoutDashboard className="w-4 h-4" /> },
    { key: 'setup', label: bi('练习配置', 'Practice'), shortLabel: bi('练习', 'Practice'), icon: <SlidersHorizontal className="w-4 h-4" /> },
    {
      key: 'library',
      label: bi('题库管理', 'Library'),
      shortLabel: bi('题库', 'Bank'),
      icon: <Library className="w-4 h-4" />,
      badge: pendingWrongCount > 0 ? pendingWrongCount : undefined,
    },
    { key: 'analytics', label: bi('学习分析', 'Analytics'), shortLabel: bi('分析', 'Stats'), icon: <BarChart3 className="w-4 h-4" /> },
    { key: 'english', label: bi('英语真题', 'English'), shortLabel: bi('真题', 'English'), icon: <FileText className="w-4 h-4" /> },
    { key: 'profile', label: bi('账户与同步', 'Profile'), shortLabel: bi('我的', 'Account'), icon: <UserCircle2 className="w-4 h-4" /> },
  ];

  const syncChip = () => {
    if (sync.status === 'syncing') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-accent font-medium">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          {bi('同步中…', 'Syncing…')}
        </span>
      );
    }
    if (sync.status === 'offline') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-medium">
          <CloudOff className="w-3.5 h-3.5" />
          {sync.pendingCount > 0
            ? bi(`离线 (${sync.pendingCount} 待传)`, `Offline (${sync.pendingCount})`)
            : bi('离线模式', 'Offline')}
        </span>
      );
    }
    if (sync.status === 'auth_expired' || sessionExpired) {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-medium">
          <AlertTriangle className="w-3.5 h-3.5" />
          {bi('登录已过期', 'Session expired')}
        </span>
      );
    }
    if (sync.status === 'error') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 font-medium">
          <AlertTriangle className="w-3.5 h-3.5" />
          {bi('同步失败', 'Sync error')}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
        <Cloud className="w-3.5 h-3.5" />
        {sync.pendingCount > 0
          ? bi(`待同步 ${sync.pendingCount}`, `${sync.pendingCount} pending`)
          : bi('云端已同步', 'Synced')}
      </span>
    );
  };

  const isDarkActive = resolveIsDark(theme);
  const toggleDark = () => {
    setTheme(isDarkActive ? 'light' : 'dark');
  };

  if (focusMode) {
    return (
      <div className="min-h-screen bg-canvas flex flex-col">
        {sessionExpired && (
          <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 text-xs text-amber-800 dark:text-amber-200 flex items-center justify-between gap-2">
            <span>{bi('登录已过期，答卷继续安全保存在本机，随时可重新登录同步。', 'Session expired; your answers remain safe locally.')}</span>
            <Button size="sm" variant="secondary" onClick={() => setReauthOpen(true)}>
              {bi('重新登录', 'Sign In')}
            </Button>
          </div>
        )}
        <main className="flex-1 w-full max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-6">{children}</main>
        <BackToTop />
        <ReauthModal open={reauthOpen} onClose={() => setReauthOpen(false)} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas flex flex-col md:flex-row">
      {/* Desktop Left Navigation Rail */}
      <aside
        data-collapsed={sidebarCollapsed ? 'true' : 'false'}
        className={`hidden md:flex md:flex-col md:fixed md:inset-y-0 bg-surface border-r border-line z-30 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          sidebarCollapsed ? 'md:w-[72px]' : 'md:w-60 lg:w-64'
        }`}
      >
        <div
          className={`border-b border-line flex ${
            sidebarCollapsed ? 'flex-col items-center gap-2 py-4 px-2' : 'items-center justify-between gap-2 px-3 py-3.5'
          }`}
        >
          <button
            type="button"
            data-testid="sidebar-account-btn"
            onClick={() => setSwitcherOpen(true)}
            title={bi('切换或添加账号', 'Switch account')}
            className={`group flex items-center gap-2.5 min-w-0 rounded-xl p-1.5 hover:bg-surface-muted transition-colors ${
              sidebarCollapsed ? 'justify-center' : 'flex-1 text-left'
            }`}
          >
            <div className="w-8 h-8 rounded-xl bg-accent text-accent-fg flex items-center justify-center shadow-sm flex-shrink-0 font-semibold text-sm transition-transform duration-200 group-hover:scale-105">
              {user?.username ? user.username[0].toUpperCase() : <BookOpenCheck className="w-4 h-4" />}
            </div>
            {!sidebarCollapsed && (
              <>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-ink truncate" data-testid="sidebar-username">
                    {user?.username || '—'}
                  </div>
                  {user?.isAdmin && (
                    <div className="text-[10px] text-accent font-medium truncate">
                      {bi('管理员', 'Admin')}
                    </div>
                  )}
                </div>
                <ArrowLeftRight className="w-3.5 h-3.5 text-ink-muted opacity-60 group-hover:opacity-100 group-hover:text-accent transition-all flex-shrink-0" />
              </>
            )}
          </button>
          <button
            type="button"
            data-testid="sidebar-collapse-btn"
            onClick={toggleSidebarCollapsed}
            title={sidebarCollapsed ? bi('展开侧边栏', 'Expand sidebar') : bi('收起侧边栏', 'Collapse sidebar')}
            aria-label={sidebarCollapsed ? bi('展开侧边栏', 'Expand sidebar') : bi('收起侧边栏', 'Collapse sidebar')}
            className="w-7 h-7 rounded-lg border border-line/80 bg-canvas/60 text-ink-muted hover:text-ink hover:bg-surface-muted flex items-center justify-center transition-colors flex-shrink-0"
          >
            {sidebarCollapsed ? <PanelLeftOpen className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
          </button>
        </div>

        <nav className={`flex-1 py-4 space-y-1 overflow-y-auto custom-scroll ${sidebarCollapsed ? 'px-2' : 'px-3'}`}>
          {navItems.map((item) => {
            const active = activeTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                title={sidebarCollapsed ? item.label : undefined}
                onClick={() => onSelectTab(item.key)}
                className={`group relative w-full flex items-center gap-2 ${
                  sidebarCollapsed ? 'justify-center px-2' : 'justify-between px-3'
                } py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                  active
                    ? 'bg-accent-soft text-accent'
                    : 'text-ink-muted hover:text-ink hover:bg-surface-muted'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <span className="inline-flex transition-transform duration-200 group-hover:scale-105">{item.icon}</span>
                  {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                </span>
                {item.badge !== undefined && !sidebarCollapsed && (
                  <span className="px-1.5 py-0.5 rounded-md bg-red-500/10 text-red-600 dark:text-red-400 text-[11px] font-semibold tabular-nums">
                    {item.badge}
                  </span>
                )}
                {item.badge !== undefined && sidebarCollapsed && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500" />
                )}
              </button>
            );
          })}

          {user?.isAdmin && (
            <div className="pt-3 mt-3 border-t border-line">
              <a
                href="/admin.html"
                title={sidebarCollapsed ? bi('管理控制台', 'Admin Console') : undefined}
                className={`w-full flex items-center ${
                  sidebarCollapsed ? 'justify-center px-2' : 'gap-2.5 px-3'
                } py-2.5 rounded-xl text-sm font-medium text-ink-muted hover:text-ink hover:bg-surface-muted transition-colors`}
              >
                <Shield className="w-4 h-4 text-accent" />
                {!sidebarCollapsed && <span>{bi('管理控制台', 'Admin Console')}</span>}
              </a>
            </div>
          )}
        </nav>

        <div className="p-2.5 border-t border-line space-y-2">
          <button
            type="button"
            title={bi('点击立即同步', 'Click to sync')}
            onClick={() => {
              if (sessionExpired) setReauthOpen(true);
              else void getSyncEngine()?.syncNow();
            }}
            className={`w-full flex items-center ${
              sidebarCollapsed ? 'justify-center px-2' : 'justify-between px-3'
            } py-2 rounded-xl bg-surface-muted/70 hover:bg-surface-muted transition-colors`}
          >
            {sidebarCollapsed ? (
              sync.status === 'syncing' ? (
                <RefreshCw className="w-3.5 h-3.5 text-accent animate-spin" />
              ) : sync.status === 'offline' ? (
                <CloudOff className="w-3.5 h-3.5 text-amber-500" />
              ) : sync.status === 'error' || sync.status === 'auth_expired' || sessionExpired ? (
                <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
              ) : (
                <Cloud className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              )
            ) : (
              <>
                {syncChip()}
                <span className="text-[11px] text-ink-muted tabular-nums">v{sync.version}</span>
              </>
            )}
          </button>

          <div className={`flex ${sidebarCollapsed ? 'flex-col items-center gap-1.5' : 'items-center gap-1.5'}`}>
            <button
              type="button"
              title={lang === 'zh' ? 'Switch to English' : '切换为简体中文'}
              onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
              className={`${
                sidebarCollapsed ? 'w-9 h-8' : 'flex-1 h-8'
              } rounded-lg border border-line bg-canvas text-xs font-medium text-ink-muted hover:text-ink inline-flex items-center justify-center gap-1.5`}
            >
              <Globe className="w-3.5 h-3.5" />
              {!sidebarCollapsed && (lang === 'zh' ? 'English' : '简体中文')}
            </button>
            <button
              type="button"
              onClick={toggleDark}
              className={`${sidebarCollapsed ? 'w-9 h-8' : 'w-8 h-8'} rounded-lg border border-line bg-canvas text-ink-muted hover:text-ink inline-flex items-center justify-center`}
              aria-label="Toggle theme"
              title={isDarkActive ? bi('切换浅色模式', 'Switch to light') : bi('切换深色模式', 'Switch to dark')}
            >
              {isDarkActive ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Top Header */}
      <header className="md:hidden sticky top-0 z-30 bg-surface/95 backdrop-blur border-b border-line px-4 py-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setSwitcherOpen(true)}
          className="flex items-center gap-2 min-w-0 rounded-lg px-1 py-0.5 hover:bg-surface-muted transition-colors"
          title={bi('切换或添加账号', 'Switch account')}
        >
          <div className="w-7 h-7 rounded-lg bg-accent text-accent-fg flex items-center justify-center font-semibold text-xs">
            {user?.username ? user.username[0].toUpperCase() : <BookOpenCheck className="w-4 h-4" />}
          </div>
          <span className="text-sm font-semibold text-ink truncate">{user?.username || '—'}</span>
          <ArrowLeftRight className="w-3 h-3 text-ink-muted flex-shrink-0" />
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => (sessionExpired ? setReauthOpen(true) : void getSyncEngine()?.syncNow())}
            className="px-2 py-1 rounded-lg bg-surface-muted"
          >
            {syncChip()}
          </button>
          <button
            type="button"
            onClick={toggleDark}
            className="w-8 h-8 rounded-lg border border-line text-ink-muted hover:text-ink flex items-center justify-center"
            aria-label="Toggle theme"
          >
            {isDarkActive ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div
        className={`flex-1 flex flex-col min-w-0 pb-20 md:pb-8 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          sidebarCollapsed ? 'md:pl-[72px]' : 'md:pl-60 lg:pl-64'
        }`}
      >
        {sessionExpired && (
          <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 sm:px-6 py-2.5 text-xs text-amber-800 dark:text-amber-200 flex flex-wrap items-center justify-between gap-2">
            <span>
              {bi(
                `登录凭证已过期。本地未同步的 ${sync.pendingCount} 条改动已安全保留，不会丢失。`,
                `Session expired. ${sync.pendingCount} local changes remain safe in IndexedDB.`,
              )}
            </span>
            <Button size="sm" variant="primary" onClick={() => setReauthOpen(true)}>
              {bi('重新登录并同步', 'Re-authenticate')}
            </Button>
          </div>
        )}

        <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-7">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Dock */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-surface border-t border-line shadow-[0_-2px_10px_rgba(0,0,0,0.06)] grid grid-cols-6 px-1 py-1.5">
        {navItems.map((item) => {
          const active = activeTab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onSelectTab(item.key)}
              className={`flex flex-col items-center justify-center py-1 rounded-lg text-[10px] font-medium transition-transform duration-150 active:scale-95 ${
                active ? 'text-accent scale-[1.03]' : 'text-ink-muted'
              }`}
            >
              {item.icon}
              <span className="mt-0.5 truncate max-w-full px-0.5">{item.shortLabel}</span>
            </button>
          );
        })}
      </nav>

      <BackToTop />
      <AccountSwitcherModal open={switcherOpen} onClose={() => setSwitcherOpen(false)} />
      <ReauthModal open={reauthOpen} onClose={() => setReauthOpen(false)} />
    </div>
  );
};
