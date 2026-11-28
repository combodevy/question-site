import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowLeftRight,
  Cloud,
  Download,
  KeyRound,
  LogOut,
  Palette,
  RefreshCw,
  RotateCcw,
  Shield,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import type { LiveStudySnapshot, StudyStats } from '@/sync/hooks';
import { useAuthStore } from '@/store/useAuthStore';
import { useSyncStore } from '@/store/useSyncStore';
import { useUiStore, type DefaultLimitPref, type ThemeMode } from '@/store/useUiStore';
import { authApi, setStoredToken, syncApi, type BackupSummary, type SyncLogEntry } from '@/lib/api';
import { exportBankJson } from '@/lib/parsers';
import { getSyncEngine } from '@/sync/engine';
import { useBi } from '@/i18n/useBi';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { AccountSwitcherModal } from '@/components/layout/AccountSwitcherModal';

export const ProfileView: React.FC<{ data: LiveStudySnapshot; stats: StudyStats }> = ({
  data,
  stats,
}) => {
  const { bi, lang } = useBi();
  const { user, logout, refreshMe } = useAuthStore();
  const sync = useSyncStore();
  const {
    theme,
    setTheme,
    setLang,
    autoNextOnCorrect,
    setAutoNextOnCorrect,
    dailyGoal,
    setDailyGoal,
    defaultLimit,
    setDefaultLimit,
    confirm,
    prompt,
    pushToast,
  } = useUiStore();

  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [logs, setLogs] = useState<SyncLogEntry[]>([]);
  const [loadingCloud, setLoadingCloud] = useState(false);

  const [pwOpen, setPwOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  const loadCloudData = async () => {
    setLoadingCloud(true);
    try {
      const [bRes, lRes] = await Promise.all([syncApi.listBackups(), syncApi.listLogs()]);
      setBackups(bRes.backups || []);
      setLogs(lRes.logs || []);
    } catch {
      // ignore if offline
    } finally {
      setLoadingCloud(false);
    }
  };

  useEffect(() => {
    void loadCloudData();
  }, []);

  const buildBackupPayload = (type: 'bank' | 'history') => {
    if (type === 'bank') {
      const out: Record<string, Record<string, unknown[]>> = {};
      for (const q of data.questions) {
        if (!out[q.sub]) out[q.sub] = {};
        if (!out[q.sub][q.chap]) out[q.sub][q.chap] = [];
        const { version: _v, deletedAt: _d, updatedAt: _u, sub: _s, chap: _c, ...rest } = q;
        out[q.sub][q.chap].push(rest);
      }
      return out;
    }
    const starred: string[] = [];
    const hiddenMistakeIds: string[] = [];
    for (const [qid, f] of data.flagsMap) {
      if (f.starred) starred.push(qid);
      if (f.mistakeHidden) hiddenMistakeIds.push(qid);
    }
    return {
      exportedAt: new Date().toISOString(),
      history: data.history,
      lastPracticeTime: data.lastPracticeTime,
      starred,
      hiddenMistakeIds,
    };
  };

  const handleCreateBackup = async (type: 'bank' | 'history') => {
    try {
      await syncApi.createBackup(type, buildBackupPayload(type));
      pushToast(bi('云端快照创建成功', 'Backup created'), 'success');
      await loadCloudData();
    } catch (e) {
      pushToast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const handleRestoreBackup = async (b: BackupSummary) => {
    const ok = await confirm({
      title: bi('从云端备份恢复', 'Restore Snapshot'),
      message: bi(
        `恢复 ${b.type === 'bank' ? '题库' : '刷题记录'} 备份（#${b.id}）。系统会先为当前数据自动存一份云端备份，再执行覆盖。确定继续吗？`,
        `Restore ${b.type} snapshot #${b.id}? Current state will be backed up first.`,
      ),
    });
    if (!ok) return;
    try {
      await syncApi.createBackup(b.type, buildBackupPayload(b.type));
      const detail = await syncApi.getBackup(b.id);
      await getSyncEngine()?.restoreFromBackup(b.type, detail.payload);
      pushToast(bi('云端快照已恢复并同步', 'Snapshot restored'), 'success');
      await loadCloudData();
    } catch (e) {
      pushToast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const handleDownloadBackup = async (b: BackupSummary) => {
    try {
      const detail = await syncApi.getBackup(b.id);
      const blob = new Blob([JSON.stringify(detail.payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup_${b.type}_${b.id}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      pushToast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oldPw || !newPw || !newPw2) {
      pushToast(bi('请填写完整三个密码框', 'Fill in all password fields'), 'warning');
      return;
    }
    if (newPw.length < 6) {
      pushToast(bi('新密码至少需要 6 位', 'Minimum 6 characters'), 'warning');
      return;
    }
    if (newPw !== newPw2) {
      pushToast(bi('两次输入的新密码不一致', 'Passwords do not match'), 'warning');
      return;
    }
    setPwBusy(true);
    try {
      const res = await authApi.changePassword(oldPw, newPw);
      if (res.token) setStoredToken(res.token);
      setPwOpen(false);
      setOldPw('');
      setNewPw('');
      setNewPw2('');
      pushToast(bi('密码修改成功，当前会话已无缝切换新凭证', 'Password updated'), 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setPwBusy(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user) return;
    const ok = await confirm({
      title: bi('永久注销账号', 'Delete Account'),
      message: bi(
        `此操作将永久删除账号 "${user.username}" 下的全部 ${stats.totalQuestions} 道题、历史记录与云端备份，不可恢复！`,
        `Permanently delete account "${user.username}" and all data? Cannot be undone!`,
      ),
      danger: true,
    });
    if (!ok) return;

    const typed = await prompt({
      title: bi('确认用户名', 'Confirm Username'),
      message: bi(`请输入用户名 "${user.username}" 以继续：`, `Type "${user.username}" to confirm:`),
    });
    if (typed !== user.username) {
      pushToast(bi('用户名不匹配，已取消注销', 'Username mismatch, cancelled'), 'info');
      return;
    }

    const pw = await prompt({
      title: bi('密码验证', 'Verify Password'),
      message: bi('请输入登录密码确认永久注销：', 'Enter password to delete account:'),
      inputType: 'password',
    });
    if (!pw) return;

    try {
      await authApi.deleteAccount(pw);
      pushToast(bi('账号已永久注销', 'Account deleted'), 'info');
      await logout(true);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const handleClearBank = async () => {
    const ok = await confirm({
      title: bi('清空全部题库', 'Clear Entire Bank'),
      message: bi(
        '系统会先为你存一份云端备份，再清空当前全部题目。确定继续吗？',
        'A cloud backup will be created first before clearing all questions. Proceed?',
      ),
      danger: true,
    });
    if (!ok) return;
    try {
      await syncApi.createBackup('bank', buildBackupPayload('bank'));
      await getSyncEngine()?.clearBank();
      pushToast(bi('题库已清空（清空前已自动备份到云端）', 'Bank cleared (auto-backed up)'), 'info');
      await loadCloudData();
    } catch (e) {
      pushToast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const handleClearHistory = async () => {
    const ok = await confirm({
      title: bi('清空全部刷题记录', 'Clear History'),
      message: bi(
        '系统会先为你存一份云端历史备份，再清零所有统计与 SM-2 调度。确定继续吗？',
        'A cloud backup will be saved before clearing all attempt history. Proceed?',
      ),
      danger: true,
    });
    if (!ok) return;
    try {
      await syncApi.createBackup('history', buildBackupPayload('history'));
      await getSyncEngine()?.clearHistory();
      pushToast(bi('练习记录已清空（已自动备份）', 'History cleared (auto-backed up)'), 'info');
      await loadCloudData();
    } catch (e) {
      pushToast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-ink">
          {bi('账户与设置', 'Account & Settings')}
        </h1>
      </div>

      {/* Account Banner */}
      <Card className="p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-14 h-14 rounded-2xl bg-accent-soft text-accent font-bold text-xl flex items-center justify-center flex-shrink-0">
              {(user?.username?.[0] || '?').toUpperCase()}
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-semibold text-ink truncate">{user?.username}</span>
                {user?.isAdmin && <Badge tone="accent">{bi('管理员', 'Admin')}</Badge>}
              </div>
              <div className="text-xs text-ink-muted tabular-nums">
                {bi(
                  `共 ${stats.totalQuestions} 道题目 / ${stats.subjectTree.length} 个科目`,
                  `${stats.totalQuestions} questions / ${stats.subjectTree.length} subjects`,
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={() => setSwitcherOpen(true)}
              data-testid="profile-switch-account-btn"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              {bi('切换账号', 'Switch Account')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPwOpen(true)}>
              <KeyRound className="w-3.5 h-3.5" />
              {bi('修改密码', 'Change Password')}
            </Button>
            {user?.isAdmin && (
              <a href="/admin.html">
                <Button size="sm" variant="outline">
                  <Shield className="w-3.5 h-3.5" />
                  {bi('控制台', 'Admin')}
                </Button>
              </a>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="text-red-500 hover:bg-red-500/10"
              onClick={async () => {
                const ok = await confirm({
                  title: bi('退出登录', 'Sign Out'),
                  message: bi('退出后会清空本机缓存，云端数据保留。', 'Clears local cache; cloud data stays intact.'),
                });
                if (ok) void logout(true);
              }}
            >
              <LogOut className="w-3.5 h-3.5" />
              {bi('退出登录', 'Sign Out')}
            </Button>
          </div>
        </div>
      </Card>

      {/* Preferences (Clean Settings Rows) */}
      <Card className="p-5 sm:p-6">
        <div className="flex items-center gap-2.5 pb-4 border-b border-line">
          <span className="w-8 h-8 rounded-lg bg-accent-soft text-accent inline-flex items-center justify-center">
            <SlidersHorizontal className="w-4 h-4" />
          </span>
          <h2 className="text-base font-semibold text-ink">{bi('显示与刷题偏好', 'Preferences')}</h2>
        </div>

        <div className="divide-y divide-line">
          <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-ink">
              <Palette className="w-4 h-4 text-ink-muted" />
              <span>{bi('外观主题', 'Appearance')}</span>
            </div>
            <div className="inline-flex p-1 rounded-xl bg-surface-muted border border-line">
              {(
                [
                  { k: 'light', label: bi('浅色纸感', 'Light') },
                  { k: 'dark', label: bi('深邃夜间', 'Dark') },
                  { k: 'system', label: bi('跟随系统', 'System') },
                ] as Array<{ k: ThemeMode; label: string }>
              ).map((m) => (
                <button
                  key={m.k}
                  type="button"
                  onClick={() => setTheme(m.k)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    theme === m.k
                      ? 'bg-surface text-ink shadow-sm'
                      : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-sm font-medium text-ink">{bi('界面语言', 'Language')}</div>
            <div className="inline-flex p-1 rounded-xl bg-surface-muted border border-line">
              {(
                [
                  { k: 'zh', label: '简体中文' },
                  { k: 'en', label: 'English' },
                ] as const
              ).map((l) => (
                <button
                  key={l.k}
                  type="button"
                  onClick={() => setLang(l.k)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    lang === l.k
                      ? 'bg-surface text-ink shadow-sm'
                      : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <div className="py-4 flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-ink">{bi('答对后自动下一题', 'Auto-next on correct')}</div>
            <button
              type="button"
              role="switch"
              aria-checked={autoNextOnCorrect}
              data-testid="pref-auto-next"
              onClick={() => setAutoNextOnCorrect(!autoNextOnCorrect)}
              className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                autoNextOnCorrect ? 'bg-accent' : 'bg-surface-muted border border-line'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                  autoNextOnCorrect ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-sm font-medium text-ink">{bi('每日刷题目标', 'Daily Question Goal')}</div>
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                type="number"
                min={0}
                max={5000}
                value={dailyGoal}
                onChange={(e) => setDailyGoal(Number(e.target.value || 0))}
                className="w-20 h-8 px-2.5 rounded-lg border border-line bg-canvas text-xs text-ink tabular-nums outline-none focus:border-accent"
              />
              {([0, 20, 50, 100] as const).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setDailyGoal(preset)}
                  className={`px-2.5 h-8 rounded-lg border text-xs font-medium transition-colors ${
                    dailyGoal === preset
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-line bg-canvas text-ink-muted hover:text-ink'
                  }`}
                >
                  {preset === 0 ? bi('关', 'Off') : `${preset}`}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-sm font-medium text-ink">{bi('默认每次练习题数', 'Default Question Limit')}</div>
            <div className="inline-flex p-1 rounded-xl bg-surface-muted border border-line">
              {(
                [
                  { k: '10', label: '10' },
                  { k: '20', label: '20' },
                  { k: '50', label: '50' },
                  { k: 'all', label: bi('全部', 'All') },
                ] as Array<{ k: DefaultLimitPref; label: string }>
              ).map((opt) => (
                <button
                  key={opt.k}
                  type="button"
                  onClick={() => setDefaultLimit(opt.k)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    defaultLimit === opt.k
                      ? 'bg-surface text-ink shadow-sm'
                      : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* Cloud Data & Snapshots */}
      <Card className="p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-line">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-accent-soft text-accent inline-flex items-center justify-center">
              <Cloud className="w-4 h-4" />
            </span>
            <h2 className="text-base font-semibold text-ink">{bi('云端数据与备份', 'Cloud Data & Snapshots')}</h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void getSyncEngine()?.syncNow();
                void loadCloudData();
                void refreshMe();
              }}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${sync.status === 'syncing' ? 'animate-spin' : ''}`} />
              {bi('立即同步', 'Sync Now')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => exportBankJson(data.questions)}>
              <Download className="w-3.5 h-3.5" />
              {bi('导出 JSON', 'Export JSON')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void handleCreateBackup('bank')}>
              <Archive className="w-3.5 h-3.5" />
              {bi('备份题库', 'Backup Bank')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void handleCreateBackup('history')}>
              <Archive className="w-3.5 h-3.5" />
              {bi('备份记录', 'Backup History')}
            </Button>
          </div>
        </div>

        {sync.lastError && (
          <div className="px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/25 text-xs text-red-600 dark:text-red-400">
            {sync.lastError}
          </div>
        )}

        {loadingCloud ? (
          <div className="text-xs text-ink-muted py-6 text-center">{bi('加载中…', 'Loading…')}</div>
        ) : backups.length === 0 ? (
          <div className="text-xs text-ink-muted py-6 text-center rounded-xl border border-dashed border-line">
            {bi('暂无云端备份快照', 'No cloud backups yet')}
          </div>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto custom-scroll pr-1">
            {backups.map((b) => (
              <div
                key={b.id}
                className="p-3 rounded-xl border border-line bg-canvas/60 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge tone={b.type === 'bank' ? 'accent' : 'neutral'}>
                      {b.type === 'bank' ? bi('题库', 'Bank') : bi('刷题记录', 'History')}
                    </Badge>
                    <span className="text-xs font-mono text-ink-muted">
                      #{b.id} / {Math.round(b.size / 1024)} KB
                    </span>
                  </div>
                  <div className="text-[11px] text-ink-muted mt-1">{b.created_at}</div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => void handleDownloadBackup(b)}>
                    <Download className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void handleRestoreBackup(b)}>
                    <RotateCcw className="w-3.5 h-3.5" />
                    {bi('恢复', 'Restore')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {logs.length > 0 && (
          <details className="pt-2 border-t border-line text-xs">
            <summary className="cursor-pointer font-medium text-ink-muted hover:text-ink">
              {bi(`查看最近 ${logs.length} 条同步记录`, `Recent Sync Activity (${logs.length})`)}
            </summary>
            <div className="mt-2 max-h-40 overflow-y-auto custom-scroll space-y-1">
              {logs.slice(0, 20).map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-2 text-[11px] py-1 border-b border-line last:border-b-0">
                  <span className="font-mono text-ink-muted">{l.created_at}</span>
                  <Badge tone={l.status === 'success' ? 'success' : 'warning'}>{l.status}</Badge>
                </div>
              ))}
            </div>
          </details>
        )}
      </Card>

      {/* Danger Zone */}
      <Card className="p-5 sm:p-6 border-red-500/25">
        <div className="flex items-center gap-2 pb-4 border-b border-line text-sm font-semibold text-red-600 dark:text-red-400">
          <AlertTriangle className="w-4 h-4" />
          <span>{bi('危险操作区（执行前自动保存云端快照）', 'Danger Zone')}</span>
        </div>

        <div className="divide-y divide-line">
          <div className="py-3.5 flex items-center justify-between gap-3">
            <span className="text-sm text-ink">{bi('清空全部刷题记录', 'Clear all attempt history')}</span>
            <Button size="sm" variant="outline" onClick={() => void handleClearHistory()}>
              {bi('清空记录', 'Clear History')}
            </Button>
          </div>
          <div className="py-3.5 flex items-center justify-between gap-3">
            <span className="text-sm text-ink">{bi('清空全部题目', 'Clear entire question bank')}</span>
            <Button size="sm" variant="outline" onClick={() => void handleClearBank()}>
              {bi('清空题库', 'Clear Bank')}
            </Button>
          </div>
          {!user?.isAdmin && (
            <div className="pt-3.5 flex items-center justify-between gap-3">
              <span className="text-sm text-ink">{bi('永久注销账号及全部数据', 'Permanently delete account')}</span>
              <Button size="sm" variant="danger" onClick={() => void handleDeleteAccount()}>
                <Trash2 className="w-3.5 h-3.5" />
                {bi('注销账号', 'Delete Account')}
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* Password Modal */}
      <Modal
        open={pwOpen}
        onClose={() => setPwOpen(false)}
        title={bi('修改登录密码', 'Change Password')}
        size="sm"
      >
        <form onSubmit={handleChangePassword} className="space-y-3">
          <input
            type="password"
            value={oldPw}
            onChange={(e) => setOldPw(e.target.value)}
            placeholder={bi('原密码', 'Current password')}
            className="w-full h-10 px-3 rounded-xl bg-canvas border border-line text-sm text-ink outline-none"
          />
          <input
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder={bi('新密码（至少 6 位）', 'New password (min 6 chars)')}
            className="w-full h-10 px-3 rounded-xl bg-canvas border border-line text-sm text-ink outline-none"
          />
          <input
            type="password"
            value={newPw2}
            onChange={(e) => setNewPw2(e.target.value)}
            placeholder={bi('再次输入新密码', 'Confirm new password')}
            className="w-full h-10 px-3 rounded-xl bg-canvas border border-line text-sm text-ink outline-none"
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setPwOpen(false)}>
              {bi('取消', 'Cancel')}
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={pwBusy}>
              {bi('确认修改', 'Update Password')}
            </Button>
          </div>
        </form>
      </Modal>

      <AccountSwitcherModal open={switcherOpen} onClose={() => setSwitcherOpen(false)} />
    </div>
  );
};
