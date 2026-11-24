import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { adminApi, type SyncLogEntry } from '@/lib/api';
import { useUiStore } from '@/store/useUiStore';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

export const AdminLogsView: React.FC = () => {
  const pushToast = useUiStore((s) => s.pushToast);
  const [logs, setLogs] = useState<Array<SyncLogEntry & { username: string }>>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminApi.systemLogs();
      setLogs(res.logs);
    } catch (e) {
      pushToast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = filter === 'all' ? logs : logs.filter((l) => l.status === filter);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">系统同步与异常审计日志</h1>
          <p className="text-xs text-ink-muted mt-0.5">最近 100 条用户同步流与客户端异常上报</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8 px-2.5 rounded-lg bg-surface border border-line text-xs text-ink"
          >
            <option value="all">全部状态 ({logs.length})</option>
            <option value="success">success</option>
            <option value="conflict">conflict</option>
            <option value="client-error">client-error</option>
          </select>
          <Button size="sm" variant="outline" loading={loading} onClick={() => void load()}>
            <RefreshCw className="w-3.5 h-3.5" />
            刷新
          </Button>
        </div>
      </div>

      <Card padding="none" className="overflow-hidden">
        <div className="divide-y divide-line">
          {filtered.map((l) => (
            <div key={l.id} className="p-3.5 text-xs space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge
                    tone={
                      l.status === 'success'
                        ? 'success'
                        : l.status === 'conflict'
                          ? 'warning'
                          : 'danger'
                    }
                  >
                    {l.status}
                  </Badge>
                  <span className="font-semibold text-ink">{l.username}</span>
                </div>
                <span className="font-mono text-ink-muted">{l.created_at}</span>
              </div>
              {l.error && <div className="text-red-600 dark:text-red-400">{l.error}</div>}
              {l.delta && (
                <pre className="text-[11px] font-mono text-ink-muted overflow-x-auto">
                  {JSON.stringify(l.delta)}
                </pre>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};
