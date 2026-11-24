import React, { useMemo, useState } from 'react';
import { BarChart3, Clock, Flame, Play, Target, TrendingUp } from 'lucide-react';
import type { LocalQuestion } from '@/db';
import type { LiveStudySnapshot, StudyStats } from '@/sync/hooks';
import { useQuizStore } from '@/store/useQuizStore';
import { useBi } from '@/i18n/useBi';
import { localDayKey } from '@/lib/text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';

interface AnalyticsViewProps {
  data: LiveStudySnapshot;
  stats: StudyStats;
  onInspectQuestion: (q: LocalQuestion) => void;
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({
  data,
  stats,
  onInspectQuestion,
}) => {
  const { bi } = useBi();
  const startSession = useQuizStore((s) => s.startSession);
  const [subScope, setSubScope] = useState('all');
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const qMap = useMemo(() => new Map(data.questions.map((q) => [q.id, q])), [data.questions]);

  const scopedHistory = useMemo(() => {
    return data.history.filter((h) => {
      const q = qMap.get(h.id);
      if (!q) return false;
      if (subScope !== 'all' && q.sub !== subScope) return false;
      return true;
    });
  }, [data.history, qMap, subScope]);

  const summary = useMemo(() => {
    const total = scopedHistory.length;
    const correct = scopedHistory.filter((h) => h.r).length;
    const durs = scopedHistory.filter((h) => typeof h.d === 'number' && h.d > 0);
    const totalMs = durs.reduce((acc, h) => acc + (h.d || 0), 0);
    return {
      total,
      correct,
      acc: total ? Math.round((correct / total) * 100) : 0,
      avgSec: durs.length ? Math.round((totalMs / durs.length / 1000) * 10) / 10 : null,
      totalMin: Math.round(totalMs / 60000),
    };
  }, [scopedHistory]);

  // 30-day series
  const daily30 = useMemo(() => {
    const map = new Map<string, { total: number; correct: number }>();
    for (const h of scopedHistory) {
      const k = localDayKey(h.t);
      const b = map.get(k) || { total: 0, correct: 0 };
      b.total++;
      if (h.r) b.correct++;
      map.set(k, b);
    }
    const arr: Array<{ key: string; label: string; total: number; correct: number; acc: number }> = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const k = localDayKey(d);
      const v = map.get(k) || { total: 0, correct: 0 };
      arr.push({
        key: k,
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        total: v.total,
        correct: v.correct,
        acc: v.total ? Math.round((v.correct / v.total) * 100) : 0,
      });
    }
    return arr;
  }, [scopedHistory]);

  // 84-day (12-week) heatmap
  const heatmap84 = useMemo(() => {
    const counts = new Map<string, number>();
    for (const h of scopedHistory) {
      const k = localDayKey(h.t);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    const cells: Array<{ key: string; count: number }> = [];
    for (let i = 83; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = localDayKey(d);
      cells.push({ key, count: counts.get(key) || 0 });
    }
    return cells;
  }, [scopedHistory]);

  // Question Type Breakdown
  const byType = useMemo(() => {
    const types = ['mcq', 'multi', 'tf', 'fill'] as const;
    const labels: Record<string, string> = {
      mcq: bi('单选题', 'Single'),
      multi: bi('多选题', 'Multi'),
      tf: bi('判断题', 'T/F'),
      fill: bi('填空题', 'Fill'),
    };
    return types.map((tp) => {
      const recs = scopedHistory.filter((h) => qMap.get(h.id)?.type === tp);
      const ok = recs.filter((h) => h.r).length;
      return {
        type: tp,
        label: labels[tp],
        total: recs.length,
        acc: recs.length ? Math.round((ok / recs.length) * 100) : null,
      };
    });
  }, [scopedHistory, qMap, bi]);

  // Top Mistakes
  const topMistakes = useMemo(() => {
    const agg = new Map<string, { q: LocalQuestion; total: number; wrong: number; avgSec: number }>();
    const durAcc = new Map<string, { sum: number; n: number }>();
    for (const h of scopedHistory) {
      const q = qMap.get(h.id);
      if (!q) continue;
      let item = agg.get(h.id);
      if (!item) {
        item = { q, total: 0, wrong: 0, avgSec: 0 };
        agg.set(h.id, item);
      }
      item.total++;
      if (!h.r) item.wrong++;
      if (typeof h.d === 'number' && h.d > 0) {
        const d = durAcc.get(h.id) || { sum: 0, n: 0 };
        d.sum += h.d;
        d.n++;
        durAcc.set(h.id, d);
      }
    }
    const list = Array.from(agg.values())
      .filter((x) => x.wrong > 0)
      .map((x) => {
        const d = durAcc.get(x.q.id);
        return {
          ...x,
          avgSec: d && d.n > 0 ? Math.round((d.sum / d.n / 1000) * 10) / 10 : 0,
        };
      })
      .sort((a, b) => b.wrong - a.wrong || b.total - a.total)
      .slice(0, 12);
    return list;
  }, [scopedHistory, qMap]);

  if (data.history.length === 0) {
    return (
      <EmptyState
        icon={<BarChart3 className="w-5 h-5" />}
        title={bi('还没有练习数据', 'No analytics data yet')}
        description={bi('完成一组刷题后，这里会生成趋势图、热力图与高频错题报告。', 'Complete a quiz session to view trends, heatmaps, and mistake breakdowns.')}
      />
    );
  }

  const maxBar = Math.max(1, ...daily30.map((d) => d.total));
  const subjects = stats.subjectTree.map((s) => s.sub);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-ink">
            {bi('学习分析', 'Learning Analytics')}
          </h1>
          <p className="text-xs sm:text-sm text-ink-muted mt-0.5">
            {bi('追踪练习节律、题型正确率与薄弱题目分布', 'Study cadence, accuracy breakdown, and high-frequency mistakes')}
          </p>
        </div>
        <select
          value={subScope}
          onChange={(e) => setSubScope(e.target.value)}
          className="h-9 px-3 rounded-xl bg-surface border border-line text-xs font-medium text-ink outline-none"
        >
          <option value="all">{bi('全部科目视角', 'All Subjects')}</option>
          {subjects.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <Card padding="sm">
          <div className="text-xs text-ink-muted flex items-center justify-between">
            <span>{bi('作答总次数', 'Attempts')}</span>
            <Target className="w-3.5 h-3.5" />
          </div>
          <div className="text-2xl font-semibold text-ink tabular-nums mt-2">{summary.total}</div>
        </Card>
        <Card padding="sm">
          <div className="text-xs text-ink-muted flex items-center justify-between">
            <span>{bi('正确率', 'Accuracy')}</span>
            <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <div className="text-2xl font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums mt-2">
            {summary.acc}%
          </div>
        </Card>
        <Card padding="sm">
          <div className="text-xs text-ink-muted flex items-center justify-between">
            <span>{bi('连续打卡', 'Streak')}</span>
            <Flame className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <div className="text-2xl font-semibold text-ink tabular-nums mt-2">
            {stats.streakDays} {bi('天', 'd')}
          </div>
        </Card>
        <Card padding="sm">
          <div className="text-xs text-ink-muted flex items-center justify-between">
            <span>{bi('单题均时 / 总时长', 'Avg / Total Time')}</span>
            <Clock className="w-3.5 h-3.5" />
          </div>
          <div className="text-2xl font-semibold text-ink tabular-nums mt-2">
            {summary.avgSec !== null ? `${summary.avgSec}s` : '—'}
          </div>
          <div className="text-[11px] text-ink-muted tabular-nums">
            {summary.totalMin > 0 ? bi(`累计 ${summary.totalMin} 分钟`, `${summary.totalMin} min total`) : ''}
          </div>
        </Card>
      </div>

      {/* 30-day SVG chart + 12-week heatmap */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <Card className="lg:col-span-7 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-ink">{bi('近 30 日做题量趋势', '30-Day Activity Trend')}</h3>
              <p className="text-[11px] text-ink-muted">
                {hoveredIdx !== null
                  ? `${daily30[hoveredIdx].label} · ${daily30[hoveredIdx].total} ${bi('题', 'Q')} · ${daily30[hoveredIdx].acc}%`
                  : bi('悬停柱状条查看单日正确率', 'Hover any bar for daily accuracy')}
              </p>
            </div>
          </div>

          <svg viewBox="0 0 600 150" className="w-full h-40 overflow-visible">
            <line x1="0" y1="130" x2="600" y2="130" stroke="var(--border)" strokeWidth="1" />
            {daily30.map((d, i) => {
              const barW = 13;
              const gap = 7;
              const x = i * (barW + gap);
              const totalH = Math.round((d.total / maxBar) * 114);
              const okH = d.total > 0 ? Math.round((d.correct / d.total) * totalH) : 0;
              return (
                <g
                  key={d.key}
                  onMouseEnter={() => setHoveredIdx(i)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  className="cursor-pointer"
                >
                  <rect x={x} y={16} width={barW} height={114} fill="transparent" />
                  {d.total > 0 ? (
                    <>
                      <rect
                        x={x}
                        y={130 - totalH}
                        width={barW}
                        height={totalH}
                        rx="3"
                        fill="var(--accent)"
                        fillOpacity="0.25"
                      />
                      <rect
                        x={x}
                        y={130 - okH}
                        width={barW}
                        height={okH}
                        rx="3"
                        fill="var(--accent)"
                      />
                    </>
                  ) : (
                    <rect x={x} y={128} width={barW} height={2} rx="1" fill="var(--border)" />
                  )}
                </g>
              );
            })}
          </svg>
        </Card>

        <Card className="lg:col-span-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">{bi('12 周学习热力与题型分布', '12-Week Consistency & Types')}</h3>
            <p className="text-[11px] text-ink-muted">{bi('每日刷题活跃度与四类题型正确率', 'Daily heatmap and per-type accuracy')}</p>
          </div>

          <div className="grid grid-cols-12 gap-1.5">
            {heatmap84.map((c) => {
              let bg = 'bg-surface-muted';
              if (c.count >= 25) bg = 'bg-accent';
              else if (c.count >= 10) bg = 'bg-accent/70';
              else if (c.count >= 1) bg = 'bg-accent/30';
              return (
                <div
                  key={c.key}
                  title={`${c.key}: ${c.count}`}
                  className={`aspect-square rounded-[3px] ${bg}`}
                />
              );
            })}
          </div>

          <div className="grid grid-cols-4 gap-2 pt-2 border-t border-line">
            {byType.map((t) => (
              <div key={t.type} className="text-center p-2 rounded-xl bg-canvas border border-line">
                <div className="text-[11px] text-ink-muted">{t.label}</div>
                <div className="text-sm font-semibold text-ink tabular-nums mt-0.5">
                  {t.acc !== null ? `${t.acc}%` : '—'}
                </div>
                <div className="text-[10px] text-ink-muted tabular-nums">{t.total}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* High-Frequency Wrong List */}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-ink">{bi('高频错题 TOP 榜', 'Most Frequently Missed')}</h3>
            <p className="text-[11px] text-ink-muted">{bi('点击单题查看作答轨迹，或一键重刷', 'Click an item to inspect attempt timeline')}</p>
          </div>
          {topMistakes.length > 0 && (
            <Button
              size="sm"
              variant="primary"
              onClick={() =>
                startSession({
                  mode: 'filtered',
                  questions: topMistakes.map((x) => x.q),
                  title: bi('高频错题专练', 'Top Mistakes'),
                })
              }
            >
              <Play className="w-3.5 h-3.5" />
              {bi(`练这 ${topMistakes.length} 题`, `Drill Top ${topMistakes.length}`)}
            </Button>
          )}
        </div>

        {topMistakes.length === 0 ? (
          <div className="text-xs text-ink-muted py-6 text-center">
            {bi('当前范围内尚无错题记录', 'No wrong answers in this scope')}
          </div>
        ) : (
          <div className="divide-y divide-line">
            {topMistakes.map((m, idx) => (
              <div
                key={m.q.id}
                onClick={() => onInspectQuestion(m.q)}
                className="py-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-surface-muted/40 px-2 rounded-lg transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs text-ink-muted">
                    <span className="font-mono font-semibold">#{idx + 1}</span>
                    <span className="truncate">{m.q.sub} · {m.q.chap}</span>
                  </div>
                  <div className="text-sm text-ink truncate mt-0.5">{m.q.q}</div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {m.avgSec > 0 && (
                    <span className="text-[11px] font-mono text-ink-muted tabular-nums">
                      {m.avgSec}s
                    </span>
                  )}
                  <Badge tone="danger">
                    {bi(`错 ${m.wrong}/${m.total}`, `${m.wrong}/${m.total} wrong`)}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};
