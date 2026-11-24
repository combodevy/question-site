import React, { useMemo, useState } from 'react';
import { BookOpenCheck, Eye, EyeOff, Globe, Moon, ShieldCheck, Sun } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { resolveIsDark, useUiStore } from '@/store/useUiStore';
import { useBi } from '@/i18n/useBi';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

function evaluatePwStrength(pw: string) {
  if (!pw) return { pct: 0, color: 'bg-line', labelZh: '至少 6 位，建议字母与数字组合', labelEn: 'Min 6 chars; mix letters & numbers' };
  if (pw.length < 6) return { pct: 25, color: 'bg-red-500', labelZh: '密码长度不足 6 位', labelEn: 'Too short (< 6 chars)' };
  let classes = 0;
  if (/[a-z]/.test(pw)) classes++;
  if (/[A-Z]/.test(pw)) classes++;
  if (/\d/.test(pw)) classes++;
  if (/[^a-zA-Z0-9]/.test(pw)) classes++;
  if (classes <= 1 || pw.length < 8) {
    return { pct: 60, color: 'bg-amber-500', labelZh: '强度：中等', labelEn: 'Strength: Fair' };
  }
  return { pct: 100, color: 'bg-emerald-500', labelZh: '强度：高', labelEn: 'Strength: Strong' };
}

export const AuthGate: React.FC = () => {
  const { bi, lang } = useBi();
  const { theme, setTheme, setLang, pushToast } = useUiStore();
  const { login, signup } = useAuthStore();

  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const strength = useMemo(() => evaluatePwStrength(password), [password]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    const u = username.trim();
    if (!u || !password) {
      setErr(bi('请输入用户名和密码', 'Username and password are required'));
      return;
    }
    if (mode === 'signup') {
      if (password.length < 6) {
        setErr(bi('密码至少需要 6 位', 'Password must be at least 6 characters'));
        return;
      }
      if (password !== confirmPw) {
        setErr(bi('两次输入的密码不一致', 'Passwords do not match'));
        return;
      }
    }
    setBusy(true);
    try {
      if (mode === 'login') await login(u, password);
      else await signup(u, password);
      pushToast(mode === 'login' ? bi('欢迎回来', 'Welcome back') : bi('注册成功', 'Account created'), 'success');
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const toggleDark = () => {
    setTheme(resolveIsDark(theme) ? 'light' : 'dark');
  };
  const isDarkActive = resolveIsDark(theme);

  return (
    <div className="min-h-screen bg-canvas flex flex-col justify-between p-4 sm:p-8">
      <div className="max-w-5xl w-full mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-accent text-accent-fg flex items-center justify-center shadow-sm">
            <BookOpenCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-ink">{bi('研习书桌', 'Study Atelier')}</div>
            <div className="text-[11px] text-ink-muted">{bi('个人题库 · SM-2 记忆 · 历年英语真题', 'Question Bank · SM-2 · Past Papers')}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
            className="h-8 px-2.5 rounded-lg border border-line bg-surface text-xs font-medium text-ink-muted hover:text-ink inline-flex items-center gap-1.5"
          >
            <Globe className="w-3.5 h-3.5" />
            {lang === 'zh' ? 'EN' : '中文'}
          </button>
          <button
            type="button"
            onClick={toggleDark}
            className="w-8 h-8 rounded-lg border border-line bg-surface text-ink-muted hover:text-ink inline-flex items-center justify-center"
            aria-label="Toggle theme"
          >
            {isDarkActive ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <main className="max-w-4xl w-full mx-auto my-8 grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
        <div className="md:col-span-6 space-y-5 px-1">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-ink leading-snug">
            {bi('安静、专注，把每道错题都变成把握。', 'Quiet focus for deliberate practice and lasting recall.')}
          </h1>
          <p className="text-sm text-ink-muted leading-relaxed">
            {bi(
              '离线优先写入本机 IndexedDB，支持细粒度增量云端同步、SM-2 遗忘曲线调度、四六级/考研真题在线作答，以及自定义题库导入。',
              'Local-first IndexedDB storage with fine-grained delta cloud sync, SM-2 spaced repetition, interactive CET-4/CET-6/Graduate past papers, and flexible bank import.',
            )}
          </p>
          <div className="grid grid-cols-3 gap-3 pt-1">
            <div className="p-3 rounded-xl bg-surface border border-line">
              <div className="text-xs font-semibold text-ink">{bi('SM-2 调度', 'SM-2 Queue')}</div>
              <div className="text-[11px] text-ink-muted mt-1">{bi('按日到期精准提醒', 'Daily due scheduling')}</div>
            </div>
            <div className="p-3 rounded-xl bg-surface border border-line">
              <div className="text-xs font-semibold text-ink">{bi('多端同步', 'Delta Sync')}</div>
              <div className="text-[11px] text-ink-muted mt-1">{bi('断网可刷题不丢进度', 'Outbox offline queue')}</div>
            </div>
            <div className="p-3 rounded-xl bg-surface border border-line">
              <div className="text-xs font-semibold text-ink">{bi('英语真题', 'Past Papers')}</div>
              <div className="text-[11px] text-ink-muted mt-1">{bi('选词 · 匹配 · 阅读联动', 'Synced split-pane reading')}</div>
            </div>
          </div>
        </div>

        <div className="md:col-span-6">
          <div className="bg-surface border border-line rounded-2xl p-6 shadow-sm">
            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-surface-muted mb-5">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setErr('');
                }}
                className={`py-2 text-xs font-semibold rounded-lg transition-all ${
                  mode === 'login' ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {bi('账号登录', 'Sign In')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('signup');
                  setErr('');
                }}
                className={`py-2 text-xs font-semibold rounded-lg transition-all ${
                  mode === 'signup' ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {bi('注册新账号', 'Create Account')}
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1.5">
                  {bi('用户名', 'Username')}
                </label>
                <input
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={bi('字母、数字、下划线或中文（2-32位）', 'Letters, digits, underscore (2-32 chars)')}
                  className="w-full h-10 px-3 rounded-xl bg-canvas border border-line text-sm text-ink outline-none focus:border-accent"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1.5">
                  {bi('密码', 'Password')}
                </label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={bi('至少 6 位字符', 'At least 6 characters')}
                    className="w-full h-10 pl-3 pr-10 rounded-xl bg-canvas border border-line text-sm text-ink outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink p-1"
                    aria-label={bi('切换密码显示', 'Toggle password visibility')}
                  >
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {mode === 'signup' && (
                  <div className="mt-2 space-y-1">
                    <div className="h-1.5 w-full rounded-full bg-surface-muted overflow-hidden">
                      <div
                        className={`h-full transition-all duration-200 ${strength.color}`}
                        style={{ width: `${strength.pct}%` }}
                      />
                    </div>
                    <div className="text-[11px] text-ink-muted">
                      {lang === 'en' ? strength.labelEn : strength.labelZh}
                    </div>
                  </div>
                )}
              </div>

              {mode === 'signup' && (
                <div>
                  <label className="block text-xs font-medium text-ink-muted mb-1.5">
                    {bi('确认密码', 'Confirm Password')}
                  </label>
                  <input
                    type={showPw ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirmPw}
                    onChange={(e) => setConfirmPw(e.target.value)}
                    placeholder={bi('再次输入密码', 'Re-enter password')}
                    className="w-full h-10 px-3 rounded-xl bg-canvas border border-line text-sm text-ink outline-none focus:border-accent"
                  />
                </div>
              )}

              {err && (
                <div className="px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-600 dark:text-red-400">
                  {err}
                </div>
              )}

              <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
                {mode === 'login' ? bi('登录并进入书桌', 'Sign In') : bi('创建账号并开始', 'Create Account')}
              </Button>
            </form>

            <div className="mt-4 pt-3.5 border-t border-line flex items-center justify-between text-[11px] text-ink-muted">
              <span className="inline-flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-accent" />
                {bi('加密传输 · 本地备份保护', 'Encrypted session · Local-first backup')}
              </span>
              <a href="/admin.html" className="hover:text-ink transition-colors">
                {bi('管理后台', 'Admin')}
              </a>
            </div>
          </div>
        </div>
      </main>

      <footer className="max-w-5xl w-full mx-auto text-center text-[11px] text-ink-muted">
        quiz.devy.cc.cd · Study Atelier
      </footer>
    </div>
  );
};

export const ReauthModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const { bi } = useBi();
  const { user, login, logout } = useAuthStore();
  const { pushToast } = useUiStore();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const handleReauth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.username || !password) return;
    setErr('');
    setBusy(true);
    try {
      await login(user.username, password);
      setPassword('');
      pushToast(bi('身份验证已恢复，正在同步本地变更…', 'Session restored, syncing…'), 'success');
      onClose();
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={bi('重新验证身份', 'Re-authenticate Session')}
      subtitle={bi('本地未同步的记录已完整保留，登录后自动继续上传。', 'Local changes are preserved safely and will sync once signed in.')}
      size="sm"
    >
      <form onSubmit={handleReauth} className="space-y-4">
        <div className="text-xs text-ink-muted">
          {bi('当前账号：', 'Account: ')}
          <span className="font-semibold text-ink">{user?.username}</span>
        </div>
        <input
          autoFocus
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={bi('输入登录密码', 'Enter password')}
          className="w-full h-10 px-3 rounded-xl bg-canvas border border-line text-sm text-ink outline-none focus:border-accent"
        />
        {err && <div className="text-xs text-red-600 dark:text-red-400">{err}</div>}
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onClose();
              void logout(true);
            }}
          >
            {bi('切换其他账号', 'Switch Account')}
          </Button>
          <Button type="submit" variant="primary" size="sm" loading={busy}>
            {bi('验证并恢复同步', 'Verify & Sync')}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
