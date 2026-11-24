import React, { useCallback, useEffect, useState } from 'react';
import { Download, Eye, KeyRound, Plus, Search, Trash2 } from 'lucide-react';
import { adminApi, type AdminUserRow } from '@/lib/api';
import { useUiStore } from '@/store/useUiStore';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';

export const AdminUsersView: React.FC<{ onInspectBank?: (userId: string) => void }> = ({
  onInspectBank,
}) => {
  const { confirm, prompt, pushToast } = useUiStore();

  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pageSize: 20, pages: 1 });
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [newUser, setNewUser] = useState('');
  const [newPw, setNewPw] = useState('');

  const [dossier, setDossier] = useState<Awaited<ReturnType<typeof adminApi.userDossier>> | null>(
    null,
  );

  const loadUsers = useCallback(
    async (page = meta.page, q = search) => {
      setLoading(true);
      try {
        const res = await adminApi.usersList(page, 20, q);
        setUsers(res.users);
        setMeta(res.meta);
      } catch (e) {
        pushToast(e instanceof Error ? e.message : String(e), 'error');
      } finally {
        setLoading(false);
      }
    },
    [meta.page, search, pushToast],
  );

  useEffect(() => {
    const t = setTimeout(() => void loadUsers(1, search), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.trim() || newPw.length < 6) {
      pushToast('请输入用户名与至少 6 位密码', 'warning');
      return;
    }
    try {
      await adminApi.createUser(newUser.trim(), newPw);
      pushToast('新用户已创建', 'success');
      setCreateOpen(false);
      setNewUser('');
      setNewPw('');
      await loadUsers(1, search);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const handleResetPw = async (u: AdminUserRow) => {
    const pw = await prompt({
      title: `重置密码 - ${u.username}`,
      message: '请输入新密码（6-128 位，修改后该用户旧 Token 立即失效）：',
      inputType: 'password',
    });
    if (!pw) return;
    try {
      await adminApi.resetUserPassword(u.id, pw);
      pushToast(`已重置 ${u.username} 的密码`, 'success');
    } catch (e) {
      pushToast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const handleExportUser = async (u: AdminUserRow) => {
    try {
      const res = await adminApi.userExport(u.id);
      const blob = new Blob([JSON.stringify(res.bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `user_bundle_${u.username}_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      pushToast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const handleDeleteSelected = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const ok = await confirm({
      title: '批量删除用户',
      message: `确定永久删除选中的 ${ids.length} 个用户及其所有题库、历史记录与备份吗？不可撤销！`,
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await adminApi.deleteUsers(ids);
      pushToast(`已删除 ${res.deletedCount} 名用户`, 'info');
      setSelectedIds(new Set());
      await loadUsers(1, search);
    } catch (e) {
      pushToast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const openDossier = async (uid: string) => {
    try {
      const res = await adminApi.userDossier(uid);
      setDossier(res);
    } catch (e) {
      pushToast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">用户资产与 360° 档案</h1>
          <p className="text-xs text-ink-muted mt-0.5">
            共 {meta.total} 名用户 | 支持档案透视、数据导出、密码重置与清理
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <Button size="sm" variant="danger" onClick={() => void handleDeleteSelected()}>
              <Trash2 className="w-3.5 h-3.5" />
              删除选中 ({selectedIds.size})
            </Button>
          )}
          <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus className="w-3.5 h-3.5" />
            新增用户
          </Button>
        </div>
      </div>

      <Card padding="sm" className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-ink-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="按用户名搜索…"
            className="w-full h-9 pl-9 pr-3 rounded-xl bg-canvas border border-line text-sm text-ink outline-none focus:border-accent"
          />
        </div>
        <Button size="sm" variant="outline" onClick={() => void loadUsers(meta.page, search)} loading={loading}>
          刷新列表
        </Button>
      </Card>

      <Card padding="none" className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-surface-muted/60 border-b border-line text-ink-muted">
              <tr>
                <th className="p-3 w-10">
                  <input
                    type="checkbox"
                    checked={
                      users.filter((u) => !u.is_admin).length > 0 &&
                      users.filter((u) => !u.is_admin).every((u) => selectedIds.has(u.id))
                    }
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(new Set(users.filter((u) => !u.is_admin).map((u) => u.id)));
                      } else {
                        setSelectedIds(new Set());
                      }
                    }}
                    className="accent-[var(--accent)]"
                  />
                </th>
                <th className="p-3">用户名</th>
                <th className="p-3">题量</th>
                <th className="p-3">同步次数</th>
                <th className="p-3">冲突 / 错误</th>
                <th className="p-3">最近 IP</th>
                <th className="p-3">最近活跃</th>
                <th className="p-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-surface-muted/30">
                  <td className="p-3">
                    {!u.is_admin && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(u.id)}
                        onChange={(e) => {
                          const next = new Set(selectedIds);
                          if (e.target.checked) next.add(u.id);
                          else next.delete(u.id);
                          setSelectedIds(next);
                        }}
                        className="accent-[var(--accent)]"
                      />
                    )}
                  </td>
                  <td className="p-3 font-medium text-ink">
                    <div className="flex items-center gap-1.5">
                      <span>{u.username}</span>
                      {u.is_admin && <Badge tone="accent">Admin</Badge>}
                    </div>
                  </td>
                  <td className="p-3 tabular-nums">{u.question_count}</td>
                  <td className="p-3 tabular-nums">{u.sync_count}</td>
                  <td className="p-3 tabular-nums">
                    {u.conflict_count > 0 || u.error_count > 0 ? (
                      <span className="text-amber-600 dark:text-amber-400">
                        {u.conflict_count} / {u.error_count}
                      </span>
                    ) : (
                      <span className="text-ink-muted">0 / 0</span>
                    )}
                  </td>
                  <td className="p-3 font-mono text-ink-muted">{u.last_ip}</td>
                  <td className="p-3 text-ink-muted">{u.last_active_at}</td>
                  <td className="p-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => void openDossier(u.id)} title="360 档案">
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                      {onInspectBank && (
                        <Button size="sm" variant="ghost" onClick={() => onInspectBank(u.id)}>
                          题库
                        </Button>
                      )}
                      {!u.is_admin && (
                        <Button size="sm" variant="ghost" onClick={() => void handleResetPw(u)} title="重置密码">
                          <KeyRound className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => void handleExportUser(u)} title="导出数据">
                        <Download className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {meta.pages > 1 && (
        <div className="flex items-center justify-between text-xs text-ink-muted">
          <span>
            第 {meta.page} / {meta.pages} 页
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={meta.page <= 1}
              onClick={() => void loadUsers(meta.page - 1, search)}
            >
              上一页
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={meta.page >= meta.pages}
              onClick={() => void loadUsers(meta.page + 1, search)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}

      {/* Create User Modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="创建新账号" size="sm">
        <form onSubmit={handleCreateUser} className="space-y-3">
          <input
            value={newUser}
            onChange={(e) => setNewUser(e.target.value)}
            placeholder="用户名（2-32位）"
            className="w-full h-10 px-3 rounded-xl bg-canvas border border-line text-sm text-ink outline-none"
          />
          <input
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder="初始密码（至少 6 位）"
            className="w-full h-10 px-3 rounded-xl bg-canvas border border-line text-sm text-ink outline-none"
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button type="submit" size="sm" variant="primary">
              确认创建
            </Button>
          </div>
        </form>
      </Modal>

      {/* 360 Dossier Modal */}
      <Modal
        open={Boolean(dossier)}
        onClose={() => setDossier(null)}
        title={dossier ? `用户档案 - ${dossier.user.username}` : ''}
        subtitle={dossier?.user.id}
        size="lg"
      >
        {dossier && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="p-3 rounded-xl bg-canvas border border-line">
                <div className="text-ink-muted">总题 / 回收站</div>
                <div className="text-base font-semibold text-ink tabular-nums mt-1">
                  {dossier.studyStats.totalQuestions} / {dossier.studyStats.trashCount}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-canvas border border-line">
                <div className="text-ink-muted">作答 / 正确率</div>
                <div className="text-base font-semibold text-ink tabular-nums mt-1">
                  {dossier.studyStats.answeredCount} / {dossier.studyStats.accuracyPercent}%
                </div>
              </div>
              <div className="p-3 rounded-xl bg-canvas border border-line">
                <div className="text-ink-muted">SM-2 到期 / 收藏</div>
                <div className="text-base font-semibold text-ink tabular-nums mt-1">
                  {dossier.studyStats.sm2DueCount} / {dossier.studyStats.favoritesCount}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-canvas border border-line">
                <div className="text-ink-muted">活跃天数</div>
                <div className="text-base font-semibold text-ink tabular-nums mt-1">
                  {dossier.studyStats.uniqueDays} 天
                </div>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-canvas border border-line space-y-1">
              <div className="font-semibold text-ink">网络与设备指纹</div>
              <div className="text-ink-muted">IP: {dossier.network.uniqueIps.join(', ')}</div>
              <div className="text-ink-muted truncate">
                Devices: {dossier.network.uniqueDevices.join(' | ') || '—'}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="font-semibold text-ink">最近同步记录 ({dossier.recentLogs.length})</div>
              <div className="max-h-48 overflow-y-auto custom-scroll border border-line rounded-xl divide-y divide-line">
                {dossier.recentLogs.map((l) => (
                  <div key={l.id} className="px-3 py-2 flex items-center justify-between">
                    <span className="font-mono text-ink-muted">{l.created_at}</span>
                    <Badge tone={l.status === 'success' ? 'success' : 'warning'}>{l.status}</Badge>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
