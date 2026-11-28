import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  ChevronsUpDown,
  FlaskConical,
  Globe,
  LayoutDashboard,
  Library,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  SlidersHorizontal,
  Sun,
} from 'lucide-react';
import { useLabAuthStore } from '@/lab/useLabAuthStore';
import { useLabSyncStore } from '@/lab/useLabSyncStore';
import { resolveIsDark, useUiStore } from '@/store/useUiStore';
import { useBi } from '@/i18n/useBi';
import { Button } from '@/components/ui/Button';
import { BackToTop } from '@/components/ui/BackToTop';
import { LabReauthModal } from '@/lab/LabAuthGate';
import { LabAccountSwitcherModal } from '@/lab/LabAccountSwitcherModal';

export type LabNavTab = 'overview' | 'setup' | 'mistakes' | 'analytics' | 'settings';

const LAB_SIDEBAR_KEY = 'qs_lab_sidebar_collapsed';

function readInitialLabSidebar(): boolean {
  try {
    return localStorage.getItem(LAB_SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
}

interface LabShellLayoutProps {
  activeTab: LabNavTab;
  onSelectTab: (tab: LabNavTab) => void;
  focusMode?: boolean;
  riskCount?: number;
  children: React.ReactNode;
}

export const LabShellLayout: React.FC<LabShellLayoutProps> = ({
  activeTab,
  onSelectTab,
  focusMode = false,
  riskCount = 0,
  children,
}) => {
  const { bi, lang } = useBi();
  const { user, sessionExpired } = useLabAuthStore();
  const sync = useLabSyncStore();
  const { theme, setTheme, setLang } = useUiStore();
  const [collapsed, setCollapsed] = useState<boolean>(readInitialLabSidebar);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(LAB_SIDEBAR_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  };

  const navItems: Array<{
    key: LabNavTab;
    label: string;
    shortLabel: string;
    icon: React.ReactNode;
    badge?: number;
  }> = [
    { key: 'overview', label: bi('精练概览', 'Overview'), shortLabel: bi('概览', 'Home'), icon: <LayoutDashboard className="w-4 h-4" /> },
    { key: 'setup', label: bi('科学组卷', 'Compose'), shortLabel: bi('组卷', 'Setup'), icon: <SlidersHorizontal className="w-4 h-4" /> },
    {
      key: 'mistakes',
      label: bi('双轨错题', 'Dual-Track'),
      shortLabel: bi('错题', 'Risks'),
      icon: <AlertTriangle className="w-4 h-4" />,
      badge: riskCount > 0 ? riskCount : undefined,
    },
    { key: 'analytics', label: bi('记忆分析', 'Memory Stats'), shortLabel: bi('分析', 'Stats'), icon: <BarChart3 className="w-4 h-4" /> },
    { key: 'settings', label: bi('策略与数据', 'Lab Settings'), shortLabel: bi('策略', 'Settings'), icon: <Settings2 className="w-4 h-4" /> },
  ];

  const isDarkActive = resolveIsDark(theme);
  const toggleDark = () => {
    setTheme(isDarkActive ? 'light' : 'dark');
  };

  if (focusMode) {
    return (
      <div className="lab-theme min-h-screen bg-canvas flex flex-col">
        {sessionExpired && (
          <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 text-xs text-amber-800 dark:text-amber-200 flex items-center justify-between gap-2">
            <span>{bi('登录已过期，精练记录继续安全保存在本机。', 'Session expired; lab records remain safe locally.')}</span>
            <Button size="sm" variant="secondary" onClick={() => setReauthOpen(true)}>
              {bi('重新登录', 'Sign In')}
            </Button>
          </div>
        )}
        <main className="flex-1 w-full max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-6">{children}</main>
        <BackToTop />
        <LabReauthModal open={reauthOpen} onClose={() => setReauthOpen(false)} />
      </div>
    );
  }

  return (
    <div className="lab-theme min-h-screen bg-canvas flex flex-col md:flex-row">
      {/* Desktop Left Sidebar */}
      <aside
        data-collapsed={collapsed ? 'true' : 'false'}
        className={`hidden md:flex md:flex-col md:fixed md:inset-y-0 bg-surface border-r border-line/90 z-30 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          collapsed ? 'md:w-[68px]' : 'md:w-[232px] lg:w-[244px]'
        }`}
      >
        <div
          className={`flex ${
            collapsed
              ? 'flex-col items-center gap-2 py-3 px-2 border-b border-line/70'
              : 'items-center justify-between gap-1.5 px-3 py-3 border-b border-line/70'
          }`}
        >
          <button
            type="button"
            data-testid="lab-sidebar-account-btn"
            onClick={() => setSwitcherOpen(true)}
            title={bi('切换或添加账号', 'Switch account')}
            className={`group flex items-center gap-2.5 min-w-0 rounded-lg p-1.5 hover:bg-surface-muted/80 transition-colors ${
              collapsed ? 'justify-center' : 'flex-1 text-left'
            }`}
          >
            <div className="w-8 h-8 rounded-lg bg-accent text-accent-fg flex items-center justify-center shadow-sm flex-shrink-0 font-semibold text-sm transition-transform duration-150 group-hover:scale-105">
              <FlaskConical className="w-4 h-4" />
            </div>
            {!collapsed && (
              <>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-ink truncate" data-testid="lab-sidebar-username">
                    {user?.username || '—'}
                  </div>
                  <div className="text-[10px] text-accent font-medium truncate">
                    {bi('科学精练', 'Science Lab')}
                  </div>
                </div>
                <ChevronsUpDown className="w-3.5 h-3.5 text-ink-muted opacity-60 group-hover:opacity-100 group-hover:text-accent transition-all flex-shrink-0" />
              </>
            )}
          </button>
          <button
            type="button"
            data-testid="lab-sidebar-collapse-btn"
            onClick={toggleCollapsed}
            title={collapsed ? bi('展开侧边栏', 'Expand sidebar') : bi('收起侧边栏', 'Collapse sidebar')}
            className="w-7 h-7 rounded-lg text-ink-muted hover:text-ink hover:bg-surface-muted/80 flex items-center justify-center transition-colors flex-shrink-0"
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        <nav className={`flex-1 py-3 overflow-y-auto custom-scroll ${collapsed ? 'px-2 space-y-4' : 'px-2.5 space-y-5'}`}>
          <div className="space-y-0.5">
            {!collapsed && (
              <div className="px-2.5 pb-1 text-[11px] font-medium text-ink-muted/75 tracking-wide">
                {bi('认知精练', 'Science Lab')}
              </div>
            )}
            {navItems.map((item) => {
              const active = activeTab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  data-testid={`lab-nav-${item.key}`}
                  title={collapsed ? item.label : undefined}
                  onClick={() => onSelectTab(item.key)}
                  className={`group relative w-full h-9 flex items-center gap-2 ${
                    collapsed ? 'justify-center px-2' : 'justify-between px-2.5'
                  } rounded-lg text-[13.5px] transition-all duration-150 ${
                    active
                      ? 'bg-accent-soft text-accent font-semibold'
                      : 'text-ink-muted font-medium hover:text-ink hover:bg-surface-muted/75'
                  }`}
                >
                  {active && !collapsed && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full bg-accent" />
                  )}
                  <span className="flex items-center gap-2.5 min-w-0">
                    <span className="inline-flex transition-transform duration-150 group-hover:scale-105">{item.icon}</span>
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </span>
                  {item.badge !== undefined && !collapsed && (
                    <span className="px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[11px] font-semibold tabular-nums">
                      {item.badge}
                    </span>
                  )}
                  {item.badge !== undefined && collapsed && (
                    <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-500" />
                  )}
                </button>
              );
            })}
          </div>

          <div className={`space-y-0.5 ${collapsed ? 'pt-3 border-t border-line/70' : 'pt-2 border-t border-line/70'}`}>
            {!collapsed && (
              <div className="px-2.5 pb-1 text-[11px] font-medium text-ink-muted/75 tracking-wide">
                {bi('双系统联动', 'Shared Links')}
              </div>
            )}
            <a
              href="/#library"
              title={collapsed ? bi('编辑共享题库', 'Manage Shared Bank') : undefined}
              className={`w-full h-9 flex items-center ${
                collapsed ? 'justify-center px-2' : 'gap-2.5 px-2.5'
              } rounded-lg text-[13.5px] font-medium text-ink-muted hover:text-ink hover:bg-surface-muted/75 transition-colors`}
            >
              <Library className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span className="truncate">{bi('管理共享题库', 'Manage Bank')}</span>}
            </a>
            <a
              href="/"
              data-testid="back-to-classic-link"
              title={collapsed ? bi('返回经典刷题', 'Classic Mode') : undefined}
              className={`w-full h-9 flex items-center ${
                collapsed ? 'justify-center px-2' : 'gap-2.5 px-2.5'
              } rounded-lg text-[13.5px] font-medium text-teal-700 dark:text-teal-400 hover:bg-teal-500/10 transition-colors`}
            >
              <ArrowLeft className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span className="truncate">{bi('返回经典刷题', 'Classic Mode')}</span>}
            </a>
          </div>
        </nav>

        <div className="p-2.5 border-t border-line/70">
          {collapsed ? (
            <div className="flex flex-col items-center gap-1.5">
              <button
                type="button"
                title={lang === 'zh' ? 'Switch to English' : '切换为简体中文'}
                onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
                className="w-9 h-8 rounded-lg bg-canvas border border-line/80 text-ink-muted hover:text-ink hover:bg-surface-muted inline-flex items-center justify-center transition-colors"
              >
                <Globe className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={toggleDark}
                className="w-9 h-8 rounded-lg bg-canvas border border-line/80 text-ink-muted hover:text-ink hover:bg-surface-muted inline-flex items-center justify-center transition-colors"
                aria-label="Toggle theme"
              >
                {isDarkActive ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1 p-1 rounded-xl bg-canvas border border-line/80">
              <button
                type="button"
                onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
                className="flex-1 h-7 rounded-lg text-xs font-medium text-ink-muted hover:text-ink hover:bg-surface inline-flex items-center justify-center gap-1.5 transition-colors"
              >
                <Globe className="w-3.5 h-3.5" />
                <span>{lang === 'zh' ? 'English' : '简体中文'}</span>
              </button>
              <button
                type="button"
                onClick={toggleDark}
                className="w-8 h-7 rounded-lg text-ink-muted hover:text-ink hover:bg-surface inline-flex items-center justify-center transition-colors"
                aria-label="Toggle theme"
              >
                {isDarkActive ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Mobile Top Header */}
      <header className="md:hidden sticky top-0 z-30 bg-surface/95 backdrop-blur border-b border-line px-4 py-2.5 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setSwitcherOpen(true)}
          className="flex items-center gap-2 min-w-0 rounded-lg px-1 py-0.5 hover:bg-surface-muted transition-colors"
        >
          <div className="w-7 h-7 rounded-lg bg-accent text-accent-fg flex items-center justify-center font-semibold text-xs">
            <FlaskConical className="w-3.5 h-3.5" />
          </div>
          <span className="text-sm font-semibold text-ink truncate">{user?.username || '—'}</span>
          <ChevronsUpDown className="w-3 h-3 text-ink-muted flex-shrink-0" />
        </button>
        <div className="flex items-center gap-1.5">
          <a
            href="/"
            className="h-8 px-2.5 rounded-lg border border-line text-xs font-medium text-ink-muted hover:text-ink inline-flex items-center gap-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {bi('经典', 'Classic')}
          </a>
          <button
            type="button"
            onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
            className="h-8 px-2.5 rounded-lg border border-line text-xs font-medium text-ink-muted hover:text-ink flex items-center justify-center"
          >
            {lang === 'zh' ? 'EN' : '中文'}
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

      {/* Main Workspace */}
      <div
        className={`flex-1 flex flex-col min-w-0 pb-20 md:pb-8 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          collapsed ? 'md:pl-[68px]' : 'md:pl-[232px] lg:pl-[244px]'
        }`}
      >
        {sessionExpired && (
          <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 sm:px-6 py-2.5 text-xs text-amber-800 dark:text-amber-200 flex flex-wrap items-center justify-between gap-2">
            <span>
              {bi(
                `登录凭证已过期。本地未同步的 ${sync.pendingCount} 条科学精练记录已安全保留。`,
                `Session expired. ${sync.pendingCount} local lab mutations remain safe in IndexedDB.`,
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
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-surface border-t border-line shadow-[0_-2px_10px_rgba(0,0,0,0.06)] grid grid-cols-5 px-1 py-1.5">
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
      <LabAccountSwitcherModal open={switcherOpen} onClose={() => setSwitcherOpen(false)} />
      <LabReauthModal open={reauthOpen} onClose={() => setReauthOpen(false)} />
    </div>
  );
};
