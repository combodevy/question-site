import React, { useEffect, useState } from 'react';
import {
  Brain,
  Database,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type { LabSettings } from '@qs/shared';
import type { LiveLabSnapshot, LabStats } from '@/lab/hooks';
import { getLabSyncEngine } from '@/lab/syncEngine';
import { useLabSyncStore } from '@/lab/useLabSyncStore';
import { useUiStore } from '@/store/useUiStore';
import { useBi } from '@/i18n/useBi';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

interface LabSettingsViewProps {
  data: LiveLabSnapshot;
  stats: LabStats;
}

export const LabSettingsView: React.FC<LabSettingsViewProps> = ({ data, stats }) => {
  const { bi } = useBi();
  const sync = useLabSyncStore();
  const { confirm, pushToast } = useUiStore();
  const [settings, setSettings] = useState<LabSettings>(data.settings);
  const [syncingNow, setSyncingNow] = useState(false);

  useEffect(() => {
    setSettings(data.settings);
  }, [data.settings]);

  const commitSettings = (next: LabSettings) => {
    setSettings(next);
    void getLabSyncEngine()?.updateSettings(next);
  };

  const handleManualSync = async () => {
    setSyncingNow(true);
    try {
      const ok = await getLabSyncEngine()?.syncNow();
      pushToast(
        ok ? bi('科学精练数据同步完成', 'Lab data synced') : bi('同步失败，请稍后重试', 'Sync failed'),
        ok ? 'success' : 'error',
      );
    } finally {
      setSyncingNow(false);
    }
  };

  const handleClearLabHistory = async () => {
    const ok = await confirm({
      title: bi('清空科学精练记录', 'Clear Lab History'),
      message: bi(
        '仅清空科学精练入口下的做题历史、FSRS 记忆轨迹与双轨错题记录；共享题库题目与经典版所有刷题统计 100% 保留不受影响。确认继续吗？',
        'Clears ONLY Science Lab history, FSRS traces, and Lab flags. Classic records and the shared question bank remain 100% untouched.',
      ),
      danger: true,
      confirmText: bi('确认清空精练记录', 'Clear Lab Only'),
    });
    if (!ok) return;
    await getLabSyncEngine()?.clearHistory();
    await getLabSyncEngine()?.syncNow({ quiet: true });
    pushToast(bi('科学精练历史已清空（经典版记录完好）', 'Lab history cleared cleanly'), 'success');
  };

  const retentionPct = Math.round(settings.desiredRetention * 100);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-2.5">
        <span className="w-9 h-9 rounded-xl bg-accent-soft text-accent inline-flex items-center justify-center">
          <Settings2 className="w-4 h-4" />
        </span>
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-ink">
            {bi('认知策略与数据隔离', 'Lab Strategy & Isolated Data')}
          </h1>
          <p className="text-xs text-ink-muted">
            {bi('调整 FSRS 目标保持率，或管理独立的科学精练记录', 'Tune FSRS retention target and manage isolated Lab data')}
          </p>
        </div>
      </div>

      {/* FSRS Retention Target */}
      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-semibold text-ink">{bi('FSRS-5 目标记忆保持率', 'FSRS-5 Desired Retention')}</h2>
          </div>
          <Badge tone="accent">{retentionPct}%</Badge>
        </div>

        <input
          type="range"
          min={80}
          max={95}
          step={1}
          value={retentionPct}
          data-testid="lab-retention-slider"
          onChange={(e) => {
            const val = Math.max(0.8, Math.min(0.95, Number(e.target.value) / 100));
            commitSettings({ ...settings, desiredRetention: val });
          }}
          className="w-full accent-[var(--accent)]"
        />

        <div className="flex items-center justify-between text-[11px] text-ink-muted">
          <span>80% ({bi('轻量轻松', 'Lighter load')})</span>
          <span>90% ({bi('科学黄金默认', 'Recommended 90%')})</span>
          <span>95% ({bi('高压密集', 'Heavy workload')})</span>
        </div>

        {retentionPct >= 94 && (
          <div className="px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-xs text-amber-800 dark:text-amber-200">
            {bi(
              '提示：将目标保持率设在 94% 以上会导致间隔大幅缩短、每日复习题量倍增，通常 90% 是性价比最佳的平衡点。',
              'Caution: setting retention >= 94% sharply shortens intervals and can double daily workload. 90% is optimal.',
            )}
          </div>
        )}
      </Card>

      {/* Isolation Status & Sync */}
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-semibold text-ink">{bi('双系统数据隔离状态', 'Isolation & Sync Status')}</h2>
          </div>
          <Button variant="outline" size="sm" loading={syncingNow} onClick={handleManualSync}>
            <RefreshCw className="w-3.5 h-3.5" />
            {bi('立即同步精练记录', 'Sync Lab Now')}
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
          <div className="p-3 rounded-xl bg-canvas border border-line space-y-1">
            <div className="text-ink-muted">{bi('共用资源', 'Shared')}</div>
            <div className="font-semibold text-ink">{bi(`账号 + ${stats.totalQuestions} 道共享题库`, `Account + ${stats.totalQuestions} Qs`)}</div>
          </div>
          <div className="p-3 rounded-xl bg-canvas border border-line space-y-1">
            <div className="text-ink-muted">{bi('精练独立流水', 'Isolated History')}</div>
            <div className="font-semibold text-ink tabular-nums">
              {bi(`${stats.totalAttempts} 条作答 | ${stats.cardMap.size} 题已追踪`, `${stats.totalAttempts} attempts | ${stats.cardMap.size} cards`)}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-canvas border border-line space-y-1">
            <div className="text-ink-muted">{bi('待上传变更', 'Outbox Pending')}</div>
            <div className="font-semibold text-ink tabular-nums">
              {sync.pendingCount} ({sync.status})
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-ink-muted">
          <ShieldCheck className="w-4 h-4 text-emerald-500 flex-shrink-0" />
          <span>
            {bi(
              '科学精练写入独立的服务器表与本机库，绝不读写经典版的历史流水与正确率。',
              'Science Lab uses isolated DB tables and local storage without touching Classic history.',
            )}
          </span>
        </div>
      </Card>

      {/* Danger Zone */}
      <Card className="border-red-500/30 space-y-3">
        <h2 className="text-sm font-semibold text-red-600 dark:text-red-400">
          {bi('独立数据重置（不影响经典版与共享题库）', 'Reset Lab Data Only')}
        </h2>
        <div className="flex flex-wrap items-center gap-2.5">
          {stats.hiddenMistakeIds.size > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void getLabSyncEngine()?.restoreHiddenMistakes();
                pushToast(bi('已恢复全部已隐藏错题', 'Restored hidden mistakes'), 'info');
              }}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {bi('恢复隐藏错题', 'Restore Hidden Mistakes')}
            </Button>
          )}
          <Button
            variant="danger"
            size="sm"
            data-testid="lab-clear-history-btn"
            onClick={() => void handleClearLabHistory()}
          >
            <Trash2 className="w-3.5 h-3.5" />
            {bi('清空科学精练做题记录', 'Clear Lab History')}
          </Button>
        </div>
      </Card>
    </div>
  );
};
