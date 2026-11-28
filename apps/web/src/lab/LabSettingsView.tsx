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
        ok ? bi('同步完成', 'Synced') : bi('同步失败，请稍后重试', 'Sync failed'),
        ok ? 'success' : 'error',
      );
    } finally {
      setSyncingNow(false);
    }
  };

  const handleClearLabHistory = async () => {
    const ok = await confirm({
      title: bi('清空练习记录', 'Clear Practice History'),
      message: bi(
        '仅清空精练模式下的做题记录、复习进度与重点错题；共享题库题目与经典版所有统计均保留不受影响。确认继续吗？',
        'Clears ONLY this mode’s practice history and mistakes. Classic stats and the shared question bank remain untouched.',
      ),
      danger: true,
      confirmText: bi('确认清空', 'Clear Now'),
    });
    if (!ok) return;
    await getLabSyncEngine()?.clearHistory();
    await getLabSyncEngine()?.syncNow({ quiet: true });
    pushToast(bi('练习记录已清空（经典版记录完好）', 'Practice history cleared'), 'success');
  };

  const retentionPct = Math.round(settings.desiredRetention * 100);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-2.5 anim-fade-in">
        <span className="w-9 h-9 rounded-xl bg-accent-soft text-accent inline-flex items-center justify-center transition-transform duration-200 hover:scale-105">
          <Settings2 className="w-4 h-4" />
        </span>
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-ink">
            {bi('设置与数据', 'Settings & Data')}
          </h1>
          <p className="text-xs text-ink-muted">
            {bi('调整复习记忆目标与管理本模式数据', 'Adjust review target and manage isolated practice data')}
          </p>
        </div>
      </div>

      {/* Retention Target */}
      <Card className="space-y-4 anim-stagger card-hover" style={{ '--stagger-i': 0 } as React.CSSProperties}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-semibold text-ink">{bi('目标记忆保持率', 'Target Memory Retention')}</h2>
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
          <span>80% ({bi('题量较少', 'Lighter load')})</span>
          <span>90% ({bi('推荐默认值', 'Recommended 90%')})</span>
          <span>95% ({bi('复习更密集', 'Intensive')})</span>
        </div>

        {retentionPct >= 94 && (
          <div className="px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-xs text-amber-800 dark:text-amber-200 anim-slide-down">
            {bi(
              '提示：设为 94% 以上会显著增加每日待复习题量，通常保持在 90% 左右更合适。',
              'Note: setting retention >= 94% sharply increases daily reviews; 90% is usually optimal.',
            )}
          </div>
        )}
      </Card>

      {/* Isolation Status & Sync */}
      <Card className="space-y-4 anim-stagger card-hover" style={{ '--stagger-i': 1 } as React.CSSProperties}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-semibold text-ink">{bi('同步与数据状态', 'Sync & Storage Status')}</h2>
          </div>
          <Button variant="outline" size="sm" loading={syncingNow} onClick={handleManualSync}>
            <RefreshCw className="w-3.5 h-3.5" />
            {bi('立即同步', 'Sync Now')}
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
          <div className="p-3 rounded-xl bg-canvas border border-line space-y-1 card-hover">
            <div className="text-ink-muted">{bi('共享题库', 'Shared Bank')}</div>
            <div className="font-semibold text-ink">{bi(`账号与 ${stats.totalQuestions} 道题库`, `Account + ${stats.totalQuestions} Qs`)}</div>
          </div>
          <div className="p-3 rounded-xl bg-canvas border border-line space-y-1 card-hover">
            <div className="text-ink-muted">{bi('独立记录', 'Practice History')}</div>
            <div className="font-semibold text-ink tabular-nums">
              {bi(`${stats.totalAttempts} 条作答 | ${stats.cardMap.size} 题`, `${stats.totalAttempts} attempts | ${stats.cardMap.size} tracked`)}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-canvas border border-line space-y-1 card-hover">
            <div className="text-ink-muted">{bi('待同步变更', 'Pending Sync')}</div>
            <div className="font-semibold text-ink tabular-nums">
              {sync.pendingCount} ({sync.status})
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-ink-muted">
          <ShieldCheck className="w-4 h-4 text-emerald-500 flex-shrink-0" />
          <span>
            {bi(
              '本模式的练习记录独立保存，绝不会影响经典版的历史数据与正确率。',
              'Practice history is stored separately and never alters Classic Mode stats.',
            )}
          </span>
        </div>
      </Card>

      {/* Danger Zone */}
      <Card className="border-red-500/30 space-y-3 anim-stagger" style={{ '--stagger-i': 2 } as React.CSSProperties}>
        <h2 className="text-sm font-semibold text-red-600 dark:text-red-400">
          {bi('重置精练记录（不影响经典版与共享题库）', 'Reset Practice Data')}
        </h2>
        <div className="flex flex-wrap items-center gap-2.5">
          {stats.hiddenMistakeIds.size > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void getLabSyncEngine()?.restoreHiddenMistakes();
                pushToast(bi('已恢复全部已移出错题', 'Restored hidden mistakes'), 'info');
              }}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {bi('恢复已移出错题', 'Restore Hidden')}
            </Button>
          )}
          <Button
            variant="danger"
            size="sm"
            data-testid="lab-clear-history-btn"
            onClick={() => void handleClearLabHistory()}
          >
            <Trash2 className="w-3.5 h-3.5" />
            {bi('清空精练做题记录', 'Clear Practice History')}
          </Button>
        </div>
      </Card>
    </div>
  );
};
