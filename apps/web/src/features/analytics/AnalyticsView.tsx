import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Award,
  BarChart3,
  BookOpen,
  Brain,
  CheckCircle2,
  Clock,
  Eye,
  Flame,
  Hourglass,
  Layers,
  Play,
  Target,
  TrendingUp,
} from 'lucide-react';
import { computeSrs, type HistoryEntry } from '@qs/shared';
import type { LocalQuestion } from '@/db';
import type { LiveStudySnapshot, StudyStats } from '@/sync/hooks';
import { useAuthStore } from '@/store/useAuthStore';
import { useQuizStore } from '@/store/useQuizStore';
import { useBi } from '@/i18n/useBi';
import { localDayKey, naturalCompare } from '@/lib/text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { QuestionPreviewBlock } from '@/components/ui/QuestionPreviewBlock';

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
  const user = useAuthStore((s) => s.user);
  const startSession = useQuizStore((s) => s.startSession);
  const scopePrefKey = `qs_v2_analytics_scope_${user?.id || 'anon'}`;

  const [subScope, setSubScope] = useState<string>(() => {
    try {
      return localStorage.getItem(scopePrefKey) || 'all';
    } catch {
      return 'all';
    }
  });
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const subjects = useMemo(() => stats.subjectTree.map((s) => s.sub), [stats.subjectTree]);

  useEffect(() => {
    if (subScope !== 'all' && subjects.length > 0 && !subjects.includes(subScope)) {
      setSubScope('all');
    }
  }, [subScope, subjects]);

  useEffect(() => {
    try {
      localStorage.setItem(scopePrefKey, subScope);
    } catch {
      // ignore
    }
  }, [scopePrefKey, subScope]);

  const qMap = useMemo(() => new Map(data.questions.map((q) => [q.id, q])), [data.questions]);

  const scopedQuestions = useMemo(
    () => (subScope === 'all' ? data.questions : data.questions.filter((q) => q.sub === subScope)),
    [data.questions, subScope],
  );

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
    const coveredSet = new Set(scopedHistory.map((h) => h.id));
    const coveragePct = scopedQuestions.length
      ? Math.round((coveredSet.size / scopedQuestions.length) * 100)
      : 0;
    const todayKey = localDayKey(Date.now());
    const todayCount = scopedHistory.filter((h) => localDayKey(h.t) === todayKey).length;
    return {
      total,
      correct,
      acc: total ? Math.round((correct / total) * 100) : 0,
      avgSec: durs.length ? Math.round((totalMs / durs.length / 1000) * 10) / 10 : null,
      totalMin: Math.round(totalMs / 60000),
      coveredCount: coveredSet.size,
      coveragePct,
      todayCount,
    };
  }, [scopedHistory, scopedQuestions.length]);

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

  // Duration Donut Distribution
  const durationBuckets = useMemo(() => {
    const buckets = [
      { key: '<5s', label: '< 5s', count: 0, color: '#0F766E' },
      { key: '5-15s', label: '5-15s', count: 0, color: '#0EA5E9' },
      { key: '15-30s', label: '15-30s', count: 0, color: '#6366F1' },
      { key: '30-60s', label: '30-60s', count: 0, color: '#F59E0B' },
      { key: '>60s', label: '> 60s', count: 0, color: '#EF4444' },
    ];
    let totalValid = 0;
    for (const h of scopedHistory) {
      if (typeof h.d !== 'number' || h.d <= 0) continue;
      const sec = h.d / 1000;
      totalValid++;
      if (sec < 5) buckets[0].count++;
      else if (sec < 15) buckets[1].count++;
      else if (sec < 30) buckets[2].count++;
      else if (sec < 60) buckets[3].count++;
      else buckets[4].count++;
    }
    return { buckets, totalValid };
  }, [scopedHistory]);

  // SM-2 Retention Horizon Buckets
  const retentionHorizon = useMemo(() => {
    const histByQ = new Map<string, HistoryEntry[]>();
    for (const h of scopedHistory) {
      const arr = histByQ.get(h.id) || [];
      arr.push(h);
      histByQ.set(h.id, arr);
    }
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const todayMs = endOfToday.getTime();
    const DAY = 86_400_000;

    const groups = [
      { key: 'due_today', label: bi('今日到期', 'Due Today'), count: 0, barCls: 'bg-red-500' },
      { key: '1_3d', label: bi('1-3 天内', '1-3 Days'), count: 0, barCls: 'bg-amber-500' },
      { key: '4_7d', label: bi('4-7 天内', '4-7 Days'), count: 0, barCls: 'bg-sky-500' },
      { key: '8_14d', label: bi('8-14 天内', '8-14 Days'), count: 0, barCls: 'bg-emerald-500/80' },
      { key: 'gt_14d', label: bi('14 天后稳固', '>14 Days Solid'), count: 0, barCls: 'bg-emerald-500' },
    ];
    let scheduledTotal = 0;
    for (const [, recs] of histByQ) {
      recs.sort((a, b) => a.t - b.t);
      const { dueAt } = computeSrs(recs);
      if (dueAt === null) continue;
      scheduledTotal++;
      if (dueAt <= todayMs) groups[0].count++;
      else if (dueAt <= todayMs + 3 * DAY) groups[1].count++;
      else if (dueAt <= todayMs + 7 * DAY) groups[2].count++;
      else if (dueAt <= todayMs + 14 * DAY) groups[3].count++;
      else groups[4].count++;
    }
    return { groups, scheduledTotal };
  }, [scopedHistory, bi]);

  // Subject Comparison (for Global View) & Diagnosis
  const subjectComparison = useMemo(() => {
    const agg = new Map<string, { sub: string; attempts: number; correct: number }>();
    for (const h of data.history) {
      const q = qMap.get(h.id);
      if (!q) continue;
      const cur = agg.get(q.sub) || { sub: q.sub, attempts: 0, correct: 0 };
      cur.attempts++;
      if (h.r) cur.correct++;
      agg.set(q.sub, cur);
    }
    const rows = Array.from(agg.values())
      .map((x) => ({
        ...x,
        acc: x.attempts ? Math.round((x.correct / x.attempts) * 100) : 0,
      }))
      .sort((a, b) => b.attempts - a.attempts);
    const qualified = rows.filter((r) => r.attempts >= 3);
    const sortedAcc = [...(qualified.length ? qualified : rows)].sort((a, b) => b.acc - a.acc);
    return {
      rows,
      best: sortedAcc[0] || null,
      weakest: sortedAcc.length > 1 ? sortedAcc[sortedAcc.length - 1] : null,
    };
  }, [data.history, qMap]);

  // Chapter Breakdown (for Single Subject Depth Mode)
  const chapterBreakdown = useMemo(() => {
    if (subScope === 'all') return [];
    const agg = new Map<string, { chap: string; totalQ: number; attempts: number; correct: number }>();
    for (const q of scopedQuestions) {
      const cur = agg.get(q.chap) || { chap: q.chap, totalQ: 0, attempts: 0, correct: 0 };
      cur.totalQ++;
      agg.set(q.chap, cur);
    }
    for (const h of scopedHistory) {
      const q = qMap.get(h.id);
      if (!q) continue;
      const cur = agg.get(q.chap);
      if (!cur) continue;
      cur.attempts++;
      if (h.r) cur.correct++;
    }
    return Array.from(agg.values())
      .map((x) => ({
        ...x,
        acc: x.attempts ? Math.round((x.correct / x.attempts) * 100) : null,
      }))
      .sort((a, b) => naturalCompare(a.chap, b.chap));
  }, [subScope, scopedQuestions, scopedHistory, qMap]);

  // Slowest Questions TOP 10
  const slowestTop = useMemo(() => {
    const durMap = new Map<string, { q: LocalQuestion; sum: number; n: number }>();
    for (const h of scopedHistory) {
      if (typeof h.d !== 'number' || h.d <= 0) continue;
      const q = qMap.get(h.id);
      if (!q) continue;
      const cur = durMap.get(h.id) || { q, sum: 0, n: 0 };
      cur.sum += h.d;
      cur.n++;
      durMap.set(h.id, cur);
    }
    return Array.from(durMap.values())
      .map((x) => ({ q: x.q, avgSec: Math.round((x.sum / x.n / 1000) * 10) / 10, count: x.n }))
      .sort((a, b) => b.avgSec - a.avgSec)
      .slice(0, 10);
  }, [scopedHistory, qMap]);

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
    return Array.from(agg.values())
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
  }, [scopedHistory, qMap]);

  if (data.history.length === 0) {
    return (
      <EmptyState
        icon={<BarChart3 className="w-5 h-5" />}
        title={bi('还没有练习数据', 'No analytics data yet')}
        description={bi('完成一组刷题后，这里会生成趋势图、分布洞察与高频错题报告。', 'Complete a quiz session to view trends, heatmaps, and mistake breakdowns.')}
      />
    );
  }

  const maxBar = Math.max(1, ...daily30.map((d) => d.total));

  // Polyline points for 30-day accuracy trend (over days with attempts)
  const accLinePoints = daily30
    .map((d, i) => {
      if (d.total === 0) return null;
      const x = i * 20 + 6.5;
      const y = 130 - Math.round((d.acc / 100) * 112);
      return `${x},${y}`;
    })
    .filter((p): p is string => Boolean(p))
    .join(' ');

  // SVG Donut calculation (circumference 2 * pi * 42 = 263.89)
  const C = 2 * Math.PI * 42;
  let donutAcc = 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-accent-soft text-accent inline-flex items-center justify-center">
            <BarChart3 className="w-4 h-4" />
          </span>
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-ink">
              {bi('学习分析', 'Learning Analytics')}
            </h1>
            <p className="text-xs sm:text-sm text-ink-muted mt-0.5">
              {bi('全维作答节律、用时分布、遗忘曲线与高频错题精析', 'Study cadence, duration profile, retention horizon, and mistake breakdown')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex p-0.5 rounded-xl bg-surface-muted border border-line text-xs">
            <button
              type="button"
              onClick={() => setSubScope('all')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                subScope === 'all' ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {bi('全科概览', 'All Subjects')}
            </button>
            <button
              type="button"
              onClick={() => setSubScope(subScope === 'all' && subjects[0] ? subjects[0] : subScope)}
              disabled={subjects.length === 0}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                subScope !== 'all' ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {bi('单科深度', 'Subject Depth')}
            </button>
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
      </div>

      {/* 6 KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card padding="sm" className="anim-stagger card-hover" style={{ '--stagger-i': 0 } as React.CSSProperties}>
          <div className="text-xs text-ink-muted flex items-center justify-between">
            <span>{bi('作答总次数', 'Attempts')}</span>
            <Target className="w-3.5 h-3.5 text-accent" />
          </div>
          <div className="text-2xl font-semibold text-ink tabular-nums mt-2">{summary.total}</div>
          <div className="text-[11px] text-ink-muted tabular-nums mt-0.5">
            {bi(`今日 +${summary.todayCount}`, `+${summary.todayCount} today`)}
          </div>
        </Card>

        <Card padding="sm" className="anim-stagger card-hover" style={{ '--stagger-i': 1 } as React.CSSProperties}>
          <div className="text-xs text-ink-muted flex items-center justify-between">
            <span>{bi('正确率', 'Accuracy')}</span>
            <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <div className="text-2xl font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums mt-2">
            {summary.acc}%
          </div>
          <div className="text-[11px] text-ink-muted tabular-nums mt-0.5">
            {bi(`答对 ${summary.correct} 次`, `${summary.correct} correct`)}
          </div>
        </Card>

        <Card padding="sm" className="anim-stagger card-hover" style={{ '--stagger-i': 2 } as React.CSSProperties}>
          <div className="text-xs text-ink-muted flex items-center justify-between">
            <span>{bi('连续打卡', 'Streak')}</span>
            <Flame className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <div className="text-2xl font-semibold text-ink tabular-nums mt-2">
            {stats.streakDays} {bi('天', 'd')}
          </div>
          <div className="text-[11px] text-ink-muted mt-0.5">{bi('持续保持节奏', 'Consistent habit')}</div>
        </Card>

        <Card padding="sm" className="anim-stagger card-hover" style={{ '--stagger-i': 3 } as React.CSSProperties}>
          <div className="text-xs text-ink-muted flex items-center justify-between">
            <span>{bi('单题均时', 'Avg Time')}</span>
            <Clock className="w-3.5 h-3.5 text-sky-500" />
          </div>
          <div className="text-2xl font-semibold text-ink tabular-nums mt-2">
            {summary.avgSec !== null ? `${summary.avgSec}s` : '—'}
          </div>
          <div className="text-[11px] text-ink-muted tabular-nums mt-0.5">
            {summary.totalMin > 0 ? bi(`累计 ${summary.totalMin} 分钟`, `${summary.totalMin}m total`) : '—'}
          </div>
        </Card>

        <Card padding="sm" className="anim-stagger card-hover" style={{ '--stagger-i': 4 } as React.CSSProperties}>
          <div className="text-xs text-ink-muted flex items-center justify-between">
            <span>{bi('题库覆盖率', 'Coverage')}</span>
            <Layers className="w-3.5 h-3.5 text-violet-500" />
          </div>
          <div className="text-2xl font-semibold text-ink tabular-nums mt-2">
            {summary.coveragePct}%
          </div>
          <div className="text-[11px] text-ink-muted tabular-nums mt-0.5">
            {summary.coveredCount}/{scopedQuestions.length} {bi('题已练', 'touched')}
          </div>
        </Card>

        <Card padding="sm" className="anim-stagger card-hover" style={{ '--stagger-i': 5 } as React.CSSProperties}>
          <div className="text-xs text-ink-muted flex items-center justify-between">
            <span>{bi('待巩固队列', 'Due Queue')}</span>
            <Brain className="w-3.5 h-3.5 text-rose-500" />
          </div>
          <div className="text-2xl font-semibold text-ink tabular-nums mt-2">
            {retentionHorizon.groups[0].count}
          </div>
          <div className="text-[11px] text-ink-muted tabular-nums mt-0.5">
            {bi(`共追踪 ${retentionHorizon.scheduledTotal} 题`, `${retentionHorizon.scheduledTotal} tracked`)}
          </div>
        </Card>
      </div>

      {/* 30-day SVG Bar + Accuracy Trend & 12-week Heatmap */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <Card className="lg:col-span-7 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-ink">{bi('近 30 日做题量与正确率曲线', '30-Day Activity & Accuracy Trend')}</h3>
              <p className="text-[11px] text-ink-muted">
                {hoveredIdx !== null
                  ? `${daily30[hoveredIdx].label} | ${daily30[hoveredIdx].total} ${bi('题', 'Q')} | ${daily30[hoveredIdx].acc}%`
                  : bi('柱状为每日做题量，折线为当日正确率变化', 'Bars show volume; overlaid line tracks daily accuracy')}
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
                        fillOpacity="0.24"
                        className="anim-bar-grow"
                      />
                      <rect
                        x={x}
                        y={130 - okH}
                        width={barW}
                        height={okH}
                        rx="3"
                        fill="var(--accent)"
                        className="anim-bar-grow"
                      />
                    </>
                  ) : (
                    <rect x={x} y={128} width={barW} height={2} rx="1" fill="var(--border)" />
                  )}
                </g>
              );
            })}
            {accLinePoints.includes(' ') && (
              <polyline
                fill="none"
                stroke="#f59e0b"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={accLinePoints}
                className="pointer-events-none"
              />
            )}
            {daily30.map((d, i) => {
              if (d.total === 0) return null;
              const x = i * 20 + 6.5;
              const y = 130 - Math.round((d.acc / 100) * 112);
              return (
                <circle
                  key={`pt-${d.key}`}
                  cx={x}
                  cy={y}
                  r={hoveredIdx === i ? 4 : 2.5}
                  fill="#f59e0b"
                  className="pointer-events-none"
                />
              );
            })}
          </svg>
        </Card>

        <Card className="lg:col-span-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">{bi('12 周学习热力与题型表现', '12-Week Consistency & Types')}</h3>
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

      {/* Duration Donut + SM-2 Retention Buckets */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <Card className="lg:col-span-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-400 inline-flex items-center justify-center">
              <Hourglass className="w-3.5 h-3.5" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-ink">{bi('作答耗时分布', 'Response Time Distribution')}</h3>
              <p className="text-[11px] text-ink-muted">{bi('识别秒杀熟练题与久思卡壳题', 'Spot quick recalls vs. slow struggles')}</p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-5">
            <div className="relative w-32 h-32 flex-shrink-0">
              <svg viewBox="0 0 110 110" className="w-full h-full -rotate-90">
                <circle cx="55" cy="55" r="42" fill="none" stroke="var(--surface-muted)" strokeWidth="14" />
                {durationBuckets.totalValid > 0 &&
                  durationBuckets.buckets.map((b) => {
                    if (b.count === 0) return null;
                    const len = (b.count / durationBuckets.totalValid) * C;
                    const offset = -donutAcc;
                    donutAcc += len;
                    return (
                      <circle
                        key={b.key}
                        cx="55"
                        cy="55"
                        r="42"
                        fill="none"
                        stroke={b.color}
                        strokeWidth="14"
                        strokeDasharray={`${len} ${C - len}`}
                        strokeDashoffset={offset}
                      />
                    );
                  })}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-base font-semibold text-ink tabular-nums">
                  {summary.avgSec !== null ? `${summary.avgSec}s` : '—'}
                </span>
                <span className="text-[10px] text-ink-muted">{bi('均时', 'Avg')}</span>
              </div>
            </div>

            <div className="flex-1 w-full space-y-2 text-xs">
              {durationBuckets.buckets.map((b) => {
                const pct = durationBuckets.totalValid
                  ? Math.round((b.count / durationBuckets.totalValid) * 100)
                  : 0;
                return (
                  <div key={b.key} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-ink">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: b.color }} />
                      <span className="font-mono">{b.label}</span>
                    </span>
                    <span className="text-ink-muted tabular-nums">
                      {b.count} ({pct}%)
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>

        <Card className="lg:col-span-7 space-y-4">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-400 inline-flex items-center justify-center">
              <Brain className="w-3.5 h-3.5" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-ink">{bi('SM-2 遗忘临界分布', 'SM-2 Retention Horizon')}</h3>
              <p className="text-[11px] text-ink-muted">{bi('已练题目按记忆到期区间分布，评估长期留存状态', 'Scheduled review dates grouped by urgency')}</p>
            </div>
          </div>

          <div className="space-y-2.5">
            {retentionHorizon.groups.map((g) => {
              const pct = retentionHorizon.scheduledTotal
                ? Math.round((g.count / retentionHorizon.scheduledTotal) * 100)
                : 0;
              return (
                <div key={g.key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-ink">{g.label}</span>
                    <span className="text-ink-muted tabular-nums">
                      {g.count} {bi('题', 'Q')} ({pct}%)
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-surface-muted overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-500 anim-bar-x ${g.barCls}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Subject Comparison (All Subjects) OR Chapter Mastery (Single Subject) */}
      {subScope === 'all' ? (
        subjectComparison.rows.length > 0 && (
          <Card className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-accent-soft text-accent inline-flex items-center justify-center">
                  <BookOpen className="w-3.5 h-3.5" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-ink">{bi('各科目正确率与诊断对比', 'Subject Accuracy & Diagnosis')}</h3>
                  <p className="text-[11px] text-ink-muted">{bi('点击任意科目条可切换为该科目的单科深度分析', 'Click any subject to inspect chapter breakdown')}</p>
                </div>
              </div>
            </div>

            {(subjectComparison.best || subjectComparison.weakest) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {subjectComparison.best && (
                  <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Award className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[11px] text-emerald-700 dark:text-emerald-300 font-medium">{bi('优势表现科目', 'Strongest Subject')}</div>
                        <div className="text-sm font-semibold text-ink truncate">{subjectComparison.best.sub}</div>
                      </div>
                    </div>
                    <Badge tone="success">{subjectComparison.best.acc}%</Badge>
                  </div>
                )}
                {subjectComparison.weakest && (
                  <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[11px] text-amber-700 dark:text-amber-300 font-medium">{bi('重点待强化科目', 'Needs Attention')}</div>
                        <div className="text-sm font-semibold text-ink truncate">{subjectComparison.weakest.sub}</div>
                      </div>
                    </div>
                    <Badge tone="warning">{subjectComparison.weakest.acc}%</Badge>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2.5">
              {subjectComparison.rows.map((r) => (
                <button
                  key={r.sub}
                  type="button"
                  onClick={() => setSubScope(r.sub)}
                  className="w-full text-left p-2.5 rounded-xl border border-line bg-canvas/50 hover:border-accent/40 card-hover space-y-1.5"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-ink truncate">{r.sub}</span>
                    <span className="tabular-nums text-ink-muted">
                      {r.acc}% ({r.correct}/{r.attempts})
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-surface-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 anim-bar-x ${r.acc >= 75 ? 'bg-emerald-500' : r.acc >= 55 ? 'bg-amber-500' : 'bg-red-500'}`}
                      style={{ width: `${r.acc}%` }}
                    />
                  </div>
                </button>
              ))}
            </div>
          </Card>
        )
      ) : (
        <Card className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-ink">
                {bi(`${subScope} 章节掌握透视`, `${subScope} Chapter Breakdown`)}
              </h3>
              <p className="text-[11px] text-ink-muted">{bi('按自然章节顺序展示正确率与作答量', 'Accuracy and attempts per chapter')}</p>
            </div>
          </div>
          <div className="space-y-2">
            {chapterBreakdown.map((c) => (
              <div
                key={c.chap}
                className="p-3 rounded-xl border border-line bg-canvas/50 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-ink truncate">{c.chap}</span>
                    <span className="text-ink-muted tabular-nums flex-shrink-0">
                      {c.acc !== null ? `${c.acc}% (${c.correct}/${c.attempts})` : bi('未练习', 'Unattempted')} | {c.totalQ} {bi('题', 'Q')}
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-surface-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-accent transition-all duration-500 anim-bar-x"
                      style={{ width: `${c.acc ?? 0}%` }}
                    />
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    startSession({
                      mode: 'custom',
                      questions: scopedQuestions.filter((q) => q.chap === c.chap),
                      title: c.chap,
                    })
                  }
                >
                  <Play className="w-3 h-3" />
                  {bi('刷本章', 'Drill')}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* High-Frequency Wrong List WITH Full Options & Standard Answer */}
      <Card className="space-y-3" data-testid="analytics-top-mistakes">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-red-500/15 text-red-600 dark:text-red-400 inline-flex items-center justify-center">
              <CheckCircle2 className="w-3.5 h-3.5" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-ink">{bi('高频错题 TOP 榜', 'Most Frequently Missed')}</h3>
              <p className="text-[11px] text-ink-muted">
                {bi('完整展示题目选项、参考答案与解析，点击条目或按钮查看作答轨迹', 'Full options & answers shown inline; click to inspect history')}
              </p>
            </div>
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
          <div className="space-y-3">
            {topMistakes.map((m, idx) => (
              <div
                key={m.q.id}
                data-testid={`top-mistake-card-${m.q.id}`}
                onClick={() => onInspectQuestion(m.q)}
                className="p-3.5 rounded-xl border border-line bg-canvas/55 hover:border-accent/45 card-hover cursor-pointer space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs text-ink-muted min-w-0">
                    <span className="font-mono font-semibold text-ink">#{idx + 1}</span>
                    <span className="truncate">{m.q.sub} / {m.q.chap}</span>
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
                    <span className="text-[11px] text-accent inline-flex items-center gap-1">
                      <Eye className="w-3 h-3" />
                      {bi('详情', 'Details')}
                    </span>
                  </div>
                </div>

                <QuestionPreviewBlock question={m.q} compact showExplanation />
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Slowest Questions TOP 10 */}
      {slowestTop.length > 0 && (
        <Card className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 inline-flex items-center justify-center">
              <Clock className="w-3.5 h-3.5" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-ink">{bi('耗时最久 TOP 10', 'Slowest Questions TOP 10')}</h3>
              <p className="text-[11px] text-ink-muted">{bi('点击任意题目查看完整作答记录与参考答案', 'Click to view full options and attempt log')}</p>
            </div>
          </div>

          <div className="divide-y divide-line">
            {slowestTop.map((s, idx) => (
              <div
                key={s.q.id}
                onClick={() => onInspectQuestion(s.q)}
                className="py-2.5 flex items-center justify-between gap-3 cursor-pointer hover:bg-surface-muted/40 px-2 rounded-lg transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-ink-muted truncate">
                    #{idx + 1} | {s.q.sub} / {s.q.chap}
                  </div>
                  <div className="text-sm text-ink truncate mt-0.5">{s.q.q}</div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge tone="warning">{s.avgSec}s</Badge>
                  <span className="text-[11px] text-ink-muted tabular-nums">
                    {s.count} {bi('次', 'x')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};
