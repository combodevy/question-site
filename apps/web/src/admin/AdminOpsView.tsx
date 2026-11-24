import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Archive,
  Cpu,
  Database,
  HardDrive,
  RefreshCw,
  RotateCw,
  Server,
  Terminal,
} from 'lucide-react';
import { adminApi, type ServerOpsMetrics } from '@/lib/api';
import { useUiStore } from '@/store/useUiStore';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

export const AdminOpsView: React.FC = () => {
  const { confirm, pushToast } = useUiStore();
  const [stats, setStats] = useState<{
    users: number;
    sets: number;
    questions: number;
    logs: number;
    activeToday: number;
  } | null>(null);
  const [metrics, setMetrics] = useState<ServerOpsMetrics | null>(null);
  const [logTab, setLogTab] = useState<'journal' | 'nginx'>('journal');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [sRes, mRes] = await Promise.all([adminApi.overviewStats(), adminApi.opsMetrics()]);
      setStats(sRes.stats);
      setMetrics(mRes.metrics);
    } catch (e) {
      pushToast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => void loadAll(), 5000);
    return () => clearInterval(t);
  }, [autoRefresh, loadAll]);

  const handleAction = async (action: 'backup' | 'restart-api') => {
    const ok = await confirm({
      title: action === 'backup' ? '执行热备份' : '重启 API 服务',
      message:
        action === 'backup'
          ? '立即将 SQLite 数据库热备份到 /opt/question-site/backups/？'
          : '确认重启 question-site-api 服务？通常 1–2 秒内恢复响应。',
      danger: action === 'restart-api',
    });
    if (!ok) return;
    setBusyAction(action);
    try {
      const res = await adminApi.opsAction(action);
      pushToast(res.message || '操作完成', 'success');
      setTimeout(() => void loadAll(), action === 'restart-api' ? 1800 : 300);
    } catch (e) {
      pushToast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">系统概览与运维监控</h1>
          <p className="text-xs text-ink-muted mt-0.5">
            平台核心指标 · 主机硬件遥测 · 备份与服务进程控制
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg border border-line bg-surface text-xs text-ink-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            <span>5s 自动刷新</span>
          </label>
          <Button size="sm" variant="outline" onClick={() => void loadAll()} loading={loading}>
            <RefreshCw className="w-3.5 h-3.5" />
            刷新
          </Button>
          <Button
            size="sm"
            variant="outline"
            loading={busyAction === 'backup'}
            onClick={() => void handleAction('backup')}
          >
            <Archive className="w-3.5 h-3.5" />
            热备份 DB
          </Button>
          <Button
            size="sm"
            variant="danger"
            loading={busyAction === 'restart-api'}
            onClick={() => void handleAction('restart-api')}
          >
            <RotateCw className="w-3.5 h-3.5" />
            重启 API
          </Button>
        </div>
      </div>

      {/* Platform KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: '注册用户', val: stats?.users ?? '—' },
          { label: '已建题库用户', val: stats?.sets ?? '—' },
          { label: '全站有效题数', val: stats?.questions ?? '—' },
          { label: '同步 / 错误日志', val: stats?.logs ?? '—' },
          { label: '24h 活跃用户', val: stats?.activeToday ?? '—' },
        ].map((k) => (
          <Card key={k.label} padding="sm">
            <div className="text-xs text-ink-muted">{k.label}</div>
            <div className="text-2xl font-semibold text-ink tabular-nums mt-1.5">{k.val}</div>
          </Card>
        ))}
      </div>

      {/* Hardware Telemetry */}
      {metrics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
          <Card padding="sm" className="space-y-2">
            <div className="flex items-center justify-between text-xs text-ink-muted">
              <span>CPU & 负载</span>
              <Cpu className="w-3.5 h-3.5" />
            </div>
            <div className="text-lg font-semibold text-ink tabular-nums">
              {metrics.cpu.cores} 核心 · Load {metrics.cpu.loadavg.join(' / ')}
            </div>
            <div className="text-[11px] text-ink-muted truncate">{metrics.os.hostname} · {metrics.os.nodeVersion}</div>
          </Card>

          <Card padding="sm" className="space-y-2">
            <div className="flex items-center justify-between text-xs text-ink-muted">
              <span>内存使用</span>
              <Activity className="w-3.5 h-3.5" />
            </div>
            <div className="text-lg font-semibold text-ink tabular-nums">
              {metrics.memory.usedMB} / {metrics.memory.totalMB} MB ({metrics.memory.percent}%)
            </div>
            <div className="h-1.5 w-full rounded-full bg-surface-muted overflow-hidden">
              <div
                className={`h-full rounded-full ${metrics.memory.percent > 85 ? 'bg-red-500' : 'bg-accent'}`}
                style={{ width: `${metrics.memory.percent}%` }}
              />
            </div>
          </Card>

          <Card padding="sm" className="space-y-2">
            <div className="flex items-center justify-between text-xs text-ink-muted">
              <span>磁盘 & 数据库</span>
              <HardDrive className="w-3.5 h-3.5" />
            </div>
            <div className="text-lg font-semibold text-ink tabular-nums">
              {metrics.disk.used} / {metrics.disk.total} ({metrics.disk.percent})
            </div>
            <div className="text-[11px] text-ink-muted tabular-nums flex items-center gap-2">
              <Database className="w-3 h-3" />
              app.db: {metrics.disk.d1DbSize} · 备份: {metrics.disk.backupSize}
            </div>
          </Card>

          <Card padding="sm" className="space-y-2">
            <div className="flex items-center justify-between text-xs text-ink-muted">
              <span>进程状态</span>
              <Server className="w-3.5 h-3.5" />
            </div>
            <div className="flex items-center gap-2 pt-0.5">
              <Badge tone={metrics.services.api === 'active' ? 'success' : 'danger'}>
                API: {metrics.services.api}
              </Badge>
              <Badge tone={metrics.services.nginx === 'active' ? 'success' : 'danger'}>
                Nginx: {metrics.services.nginx}
              </Badge>
            </div>
            <div className="text-[11px] text-ink-muted font-mono truncate">
              Ports: {metrics.services.openPorts.join(', ') || '—'}
            </div>
          </Card>
        </div>
      )}

      {/* Server Backups & Logs */}
      {metrics && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <Card className="lg:col-span-4 space-y-3">
            <h3 className="text-sm font-semibold text-ink">服务器冷/热备份目录</h3>
            {metrics.backups.length === 0 ? (
              <div className="text-xs text-ink-muted py-6 text-center">暂无备份快照</div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto custom-scroll">
                {metrics.backups.map((b) => (
                  <div
                    key={b.name}
                    className="p-2.5 rounded-xl border border-line bg-canvas/60 flex items-center justify-between text-xs"
                  >
                    <span className="font-mono font-medium text-ink truncate">{b.name}</span>
                    <Badge tone="neutral">{b.size}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="lg:col-span-8 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Terminal className="w-4 h-4 text-accent" />
                <span>实时服务日志</span>
              </div>
              <div className="inline-flex p-0.5 rounded-lg bg-surface-muted border border-line text-xs">
                <button
                  type="button"
                  onClick={() => setLogTab('journal')}
                  className={`px-2.5 py-1 rounded-md ${
                    logTab === 'journal' ? 'bg-surface text-ink font-medium shadow-sm' : 'text-ink-muted'
                  }`}
                >
                  API Journal
                </button>
                <button
                  type="button"
                  onClick={() => setLogTab('nginx')}
                  className={`px-2.5 py-1 rounded-md ${
                    logTab === 'nginx' ? 'bg-surface text-ink font-medium shadow-sm' : 'text-ink-muted'
                  }`}
                >
                  Nginx Access
                </button>
              </div>
            </div>
            <pre className="p-3 rounded-xl bg-canvas border border-line font-mono text-[11px] text-ink leading-relaxed max-h-72 overflow-auto custom-scroll whitespace-pre-wrap">
              {logTab === 'journal' ? metrics.logs.journal : metrics.logs.nginx}
            </pre>
          </Card>
        </div>
      )}
    </div>
  );
};
