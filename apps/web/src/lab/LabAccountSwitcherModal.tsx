import React, { useEffect, useState } from 'react';
import { ArrowLeftRight, Check, Plus, Shield, Trash2, UserPlus } from 'lucide-react';
import { useLabAuthStore } from '@/lab/useLabAuthStore';
import { useUiStore } from '@/store/useUiStore';
import { useBi } from '@/i18n/useBi';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

interface LabAccountSwitcherModalProps {
  open: boolean;
  onClose: () => void;
}

export const LabAccountSwitcherModal: React.FC<LabAccountSwitcherModalProps> = ({ open, onClose }) => {
  const { bi } = useBi();
  const {
    user,
    savedAccounts,
    switchingAccount,
    fetchSavedAccounts,
    switchAccount,
    removeSavedAccount,
    login,
    signup,
  } = useLabAuthStore();
  const { pushToast } = useUiStore();

  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) {
      setAddOpen(false);
      setErr('');
      setUsername('');
      setPassword('');
      setConfirmPw('');
      return;
    }
    void fetchSavedAccounts();
  }, [open, fetchSavedAccounts]);

  const handleSwitch = async (targetId: string, targetName: string) => {
    if (targetId === user?.id) {
      onClose();
      return;
    }
    try {
      await switchAccount(targetId);
      pushToast(bi(`已切换至账号 ${targetName}`, `Switched to ${targetName}`), 'success');
      onClose();
    } catch (e) {
      pushToast(e instanceof Error ? e.message : String(e), 'error');
      void fetchSavedAccounts();
    }
  };

  const handleRemove = async (targetId: string, targetName: string) => {
    try {
      await removeSavedAccount(targetId);
      pushToast(bi(`已移除账号凭证 ${targetName}`, `Removed ${targetName}`), 'info');
    } catch (e) {
      pushToast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    const cleanName = username.trim();
    if (!cleanName || !password) {
      setErr(bi('请输入用户名和密码', 'Enter username and password'));
      return;
    }
    if (addMode === 'signup' && password !== confirmPw) {
      setErr(bi('两次输入的密码不一致', 'Passwords do not match'));
      return;
    }
    setBusy(true);
    try {
      if (addMode === 'login') {
        await login(cleanName, password);
        pushToast(bi(`已登录并切换至 ${cleanName}`, `Signed in as ${cleanName}`), 'success');
      } else {
        await signup(cleanName, password);
        pushToast(bi(`已注册并切换至 ${cleanName}`, `Registered & switched to ${cleanName}`), 'success');
      }
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={bi('切换或添加账号', 'Switch Account')} size="sm">
      <div className="space-y-4">
        <div className="space-y-2">
          {savedAccounts.map((acc) => {
            const active = acc.id === user?.id || acc.isCurrent;
            return (
              <div
                key={acc.id}
                className={`p-3 rounded-xl border transition-all duration-200 flex items-center justify-between gap-2.5 ${
                  active
                    ? 'border-accent bg-accent-soft/45'
                    : 'border-line bg-canvas/60 hover:border-accent/50 card-hover'
                }`}
              >
                <button
                  type="button"
                  disabled={switchingAccount}
                  onClick={() => void handleSwitch(acc.id, acc.username)}
                  className="flex items-center gap-2.5 min-w-0 flex-1 text-left"
                >
                  <div className="w-9 h-9 rounded-xl bg-accent text-accent-fg font-semibold text-sm flex items-center justify-center flex-shrink-0">
                    {acc.username[0]?.toUpperCase() || '?'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-semibold text-ink truncate">{acc.username}</span>
                      {acc.isAdmin && (
                        <Badge tone="accent">
                          <Shield className="w-2.5 h-2.5" />
                          {bi('管理员', 'Admin')}
                        </Badge>
                      )}
                      {active && <Badge tone="success">{bi('当前', 'Active')}</Badge>}
                    </div>
                    <div className="text-[11px] text-ink-muted tabular-nums mt-0.5">
                      {bi(`${acc.questionCount} 道共享题`, `${acc.questionCount} shared questions`)}
                    </div>
                  </div>
                </button>

                <div className="flex items-center gap-1 flex-shrink-0">
                  {active ? (
                    <span className="w-7 h-7 rounded-lg bg-accent-soft text-accent inline-flex items-center justify-center">
                      <Check className="w-3.5 h-3.5" />
                    </span>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={switchingAccount}
                        onClick={() => void handleSwitch(acc.id, acc.username)}
                      >
                        <ArrowLeftRight className="w-3 h-3" />
                        {bi('切换', 'Switch')}
                      </Button>
                      <button
                        type="button"
                        onClick={() => void handleRemove(acc.id, acc.username)}
                        title={bi('移除已保存凭证', 'Remove saved session')}
                        className="w-7 h-7 rounded-lg text-ink-muted hover:text-red-500 hover:bg-red-500/10 inline-flex items-center justify-center transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {!addOpen ? (
          <Button variant="outline" className="w-full" onClick={() => setAddOpen(true)}>
            <UserPlus className="w-4 h-4" />
            {bi('登录或注册其他账号', 'Add Another Account')}
          </Button>
        ) : (
          <form onSubmit={handleAddSubmit} className="p-3.5 rounded-xl border border-line bg-canvas/70 space-y-3 anim-slide-down">
            <div className="flex items-center justify-between gap-2">
              <div className="inline-flex p-0.5 rounded-lg bg-surface-muted text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setAddMode('login');
                    setErr('');
                  }}
                  className={`px-3 py-1 rounded-md font-medium transition-colors ${
                    addMode === 'login' ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {bi('登录已有账号', 'Sign In')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAddMode('signup');
                    setErr('');
                  }}
                  className={`px-3 py-1 rounded-md font-medium transition-colors ${
                    addMode === 'signup' ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {bi('注册新账号', 'Sign Up')}
                </button>
              </div>
              <button type="button" onClick={() => setAddOpen(false)} className="text-xs text-ink-muted hover:text-ink">
                {bi('收起', 'Cancel')}
              </button>
            </div>

            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={bi('用户名', 'Username')}
              className="w-full h-9 px-3 rounded-lg bg-surface border border-line text-sm text-ink outline-none focus:border-accent"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={bi('密码', 'Password')}
              className="w-full h-9 px-3 rounded-lg bg-surface border border-line text-sm text-ink outline-none focus:border-accent"
            />
            {addMode === 'signup' && (
              <input
                type="password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                placeholder={bi('确认密码', 'Confirm Password')}
                className="w-full h-9 px-3 rounded-lg bg-surface border border-line text-sm text-ink outline-none focus:border-accent"
              />
            )}

            {err && (
              <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-600 dark:text-red-400">
                {err}
              </div>
            )}

            <Button type="submit" variant="primary" size="sm" loading={busy} className="w-full">
              <Plus className="w-3.5 h-3.5" />
              {addMode === 'login' ? bi('登录并切换', 'Sign In & Switch') : bi('注册并切换', 'Create & Switch')}
            </Button>
          </form>
        )}
      </div>
    </Modal>
  );
};
