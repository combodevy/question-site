import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Brain,
  CalendarClock,
  Clock,
  Flame,
  Hourglass,
  Layers,
  ShieldAlert,
  Target,
  TrendingUp,
} from 'lucide-react';
import type { LiveLabSnapshot, LabStats } from '@/lab/hooks';
import { useLabQuizStore } from '@/lab/useLabQuizStore';
import { useBi } from '@/i18n/useBi';
import { localDayKey } from '@/lib/text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { QuestionPreviewBlock } from '@/components/ui/QuestionPreviewBlock';

interface LabAnalyticsViewProps {
  data: LiveLabSnapshot;
  stats: LabStats;
}

type TrendRange = '7d' | '30d' | '1y';

export const LabAnalyticsView: React.FC<LabAnalyticsViewProps> = ({ data, stats }) => {
  const { bi } = useBi();
  const startSession = useLabQuizStore((s) => s.startSession);
  const [trendRange, setTrendRange] = useState<TrendRange>('7d');

  const qMap = useMemo(() => new Map(data.questions.map((q) => [q.id, q])), [data.questions]);

  const trendSeries = useMemo(() => {
    if (trendRange === '1y') {
      const map = new Map<string, { total: number; correct: number }>();
      for (const h of data.history) {
        if (!qMap.has(h.id)) continue;
        const dt = new Date(h.t);
        const mk = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
        const b = map.get(mk) || { total: 0, correct: 0 };
        b.total += 1;
        if (h.r) b.correct += 1;
        map.set(mk, b);
      }
      const arr: Array<{ key: string; label: string; total: number; correct: number; acc: number }> = [];
      const base = new Date();
      base.setDate(1);
      for (let i = 11; i >= 0; i -= 1) {
        const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
        const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const v = map.get(mk) || { total: 0, correct: 0 };
        arr.push({
          key: mk,
          label: `${String(d.getFullYear()).slice(2)}/${d.getMonth() + 1}`,
          total: v.total,
          correct: v.correct,
          acc: v.total ? Math.round((v.correct / v.total) * 100) : 0,
        });
      }
      return arr;
    }

    const days = trendRange === '7d' ? 7 : 30;
    const map = new Map<string, { total: number; correct: number }>();
    for (const h of data.history) {
      if (!qMap.has(h.id)) continue;
      const k = localDayKey(h.t);
      const b = map.get(k) || { total: 0, correct: 0 };
      b.total += 1;
      if (h.r) b.correct += 1;
      map.set(k, b);
    }
    const arr: Array<{ key: string; label: string; total: number; correct: number; acc: number }> = [];
    for (let i = days - 1; i >= 0; i -= 1) {
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
  }, [data.history, qMap, trendRange]);

  const durationBuckets = useMemo(() => {
    const buckets = [
      { key: '<5s', label: '< 5s', count: 0, color: '#4F46E5' },
      { key: '5-15s', label: '5-15s', count: 0, color: '#0EA5E9' },
      { key: '15-30s', label: '15-30s', count: 0, color: '#10B981' },
      { key: '30-60s', label: '30-60s', count: 0, color: '#F59E0B' },
      { key: '>60s', label: '> 60s', count: 0, color: '#EF4444' },
    ];
    let totalValid = 0;
    for (const h of data.history) {
      if (!qMap.has(h.id) || typeof h.d !== 'number' || h.d <= 0) continue;
      const sec = h.d / 1000;
      totalValid += 1;
      if (sec < 5) buckets[0].count += 1;
      else if (sec < 15) buckets[1].count += 1;
      else if (sec < 30) buckets[2].count += 1;
      else if (sec < 60) buckets[3].count += 1;
      else buckets[4].count += 1;
    }
    return { buckets, totalValid };
  }, [data.history, qMap]);

  const topRiskQuestions = useMemo(() => {
    const list = data.questions
      .filter((q) => {
        const card = stats.cardMap.get(q.id);
        return card && (card.isHyperRisk || card.isLuckyGuess || card.wrongCount > 0);
      })
      .map((q) => ({ q, card: stats.cardMap.get(q.id)! }));
    list.sort((a, b) => {
      const ra = a.card.isHyperRisk ? 3 : a.card.isLuckyGuess ? 2 : 1;
      const rb = b.card.isHyperRisk ? 3 : b.card.isLuckyGuess ? 2 : 1;
      if (ra !== rb) return rb - ra;
      return b.card.wrongCount - a.card.wrongCount || a.card.retrievability - b.card.retrievability;
    });
    return list.slice(0, 8);
  }, [data.questions, stats.cardMap]);

  if (stats.totalAttempts === 0) {
    return (
      <EmptyState
        icon={<BarChart3 className="w-5 h-5" />}
        title={bi('暂无学习分析数据', 'No Analytics Data Yet')}
        description={bi('完成一次练习后，这里会自动生成正确率趋势、记忆度分布和待复习安排。', 'Complete a practice session to see accuracy trends and memory stats.')}
      />
    );
  }

  const maxBar = Math.max(1, ...trendSeries.map((d) => d.total));
  const barStep = 600 / Math.max(1, trendSeries.length);
  const barW = trendRange === '7d' ? 42 : trendRange === '1y' ? 28 : 13;
  const maxWork = Math.max(1, ...stats.workload14d.map((w) => w.count));

  const accLinePoints = trendSeries
    .map((d, i) => {
      if (d.total === 0) return null;
      const x = i * barStep + barStep / 2;
      const y = 130 - Math.round((d.acc / 100) * 112);
      return `${x},${y}`;
    })
    .filter((p): p is string => Boolean(p))
    .join(' ');

  const C = 2 * Math.PI * 42;
  let donutAcc = 0;

  const bucketLabels: Record<string, { zh: string; en: string }> = {
    critical: { zh: '< 70% 急需复习', en: '< 70% Review Now' },
    gold: { zh: '70% - 85% 建议复习', en: '70-85% Due Soon' },
    good: { zh: '85% - 92% 保持良好', en: '85-92% Good' },
    solid: { zh: '> 92% 记忆牢固', en: '> 92% Solid' },
  };

  return (
    <div className="space-y-6" data-testid="lab-analytics-view">
      <div className="flex flex-wrap items-center justify-between gap-3 anim-fade-in">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-accent-soft text-accent inline-flex items-center justify-center transition-transform duration-200 hover:scale-105">
            <BarChart3 className="w-4 h-4" />
          </span>
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-ink">
              {bi('学习分析', 'Learning Analytics')}
            </h1>
            <p className="text-xs text-ink-muted">
              {bi('本模式练习记录独立统计', 'Independent stats for this practice mode')}
            </p>
          </div>
        </div>
      </div>

      {/* 6 KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card padding="sm" className="anim-stagger card-hover" style={{ '--stagger-i': 0 } as React.CSSProperties}>
          <div className="text-xs text-ink-muted flex items-center justify-between">
            <span>{bi('作答次数', 'Attempts')}</span>
            <Target className="w-3.5 h-3.5 text-accent" />
          </div>
          <div className="text-2xl font-semibold text-ink tabular-nums mt-2">{stats.totalAttempts}</div>
          <div className="text-[11px] text-ink-muted tabular-nums mt-0.5">
            {bi(`今日 +${stats.todayAttempts}`, `+${stats.todayAttempts} today`)}
          </div>
        </Card>

        <Card padding="sm" className="anim-stagger card-hover" style={{ '--stagger-i': 1 } as React.CSSProperties}>
          <div className="text-xs text-ink-muted flex items-center justify-between">
            <span>{bi('近期正确率', 'Recent Accuracy')}</span>
            <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <div className="text-2xl font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums mt-2">
            {stats.recent50Accuracy !== null ? `${stats.recent50Accuracy}%` : `${stats.accuracyPercent}%`}
          </div>
          <div className="text-[11px] text-ink-muted mt-0.5">{bi('推荐 75%-85%', 'Target 75-85%')}</div>
        </Card>

        <Card padding="sm" className="anim-stagger card-hover" style={{ '--stagger-i': 2 } as React.CSSProperties}>
          <div className="text-xs text-ink-muted flex items-center justify-between">
            <span>{bi('连续练习', 'Streak')}</span>
            <Flame className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <div className="text-2xl font-semibold text-ink tabular-nums mt-2">
            {stats.streakDays} {bi('天', 'd')}
          </div>
        </Card>

        <Card padding="sm" className="anim-stagger card-hover" style={{ '--stagger-i': 3 } as React.CSSProperties}>
          <div className="text-xs text-ink-muted flex items-center justify-between">
            <span>{bi('单题均时', 'Avg Time')}</span>
            <Clock className="w-3.5 h-3.5 text-sky-500" />
          </div>
          <div className="text-2xl font-semibold text-ink tabular-nums mt-2">
            {stats.avgDurationSec !== null ? `${stats.avgDurationSec}s` : '—'}
          </div>
        </Card>

        <Card padding="sm" className="anim-stagger card-hover" style={{ '--stagger-i': 4 } as React.CSSProperties}>
          <div className="text-xs text-ink-muted flex items-center justify-between">
            <span>{bi('已练题数', 'Practiced')}</span>
            <Layers className="w-3.5 h-3.5 text-violet-500" />
          </div>
          <div className="text-2xl font-semibold text-ink tabular-nums mt-2">{stats.cardMap.size}</div>
          <div className="text-[11px] text-ink-muted tabular-nums mt-0.5">
            / {stats.totalQuestions}
          </div>
        </Card>

        <Card padding="sm" className="anim-stagger card-hover" style={{ '--stagger-i': 5 } as React.CSSProperties}>
          <div className="text-xs text-ink-muted flex items-center justify-between">
            <span>{bi('整体记忆度', 'Retention')}</span>
            <Brain className="w-3.5 h-3.5 text-indigo-500" />
          </div>
          <div className="text-2xl font-semibold text-accent tabular-nums mt-2">{stats.avgRetrievability}%</div>
        </Card>
      </div>

      {/* Trend + Retention Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <Card className="lg:col-span-7 space-y-3 anim-stagger" style={{ '--stagger-i': 6 } as React.CSSProperties}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink">
              {bi('做题量与正确率趋势', 'Activity & Accuracy')}
            </h3>
            <div className="inline-flex p-0.5 rounded-xl bg-surface-muted border border-line text-xs">
              {(
                [
                  { k: '7d', label: bi('近 7 日', '7D') },
                  { k: '30d', label: bi('近 1 月', '1M') },
                  { k: '1y', label: bi('近 1 年', '1Y') },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.k}
                  type="button"
                  onClick={() => setTrendRange(opt.k)}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-all duration-150 ${
                    trendRange === opt.k ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <svg key={trendRange} viewBox="0 0 600 156" className="w-full h-44 overflow-visible">
            <line x1="0" y1="130" x2="600" y2="130" stroke="var(--border)" strokeWidth="1" />
            {trendSeries.map((d, i) => {
              const x = i * barStep + (barStep - barW) / 2;
              const centerX = i * barStep + barStep / 2;
              const totalH = Math.round((d.total / maxBar) * 114);
              const okH = d.total > 0 ? Math.round((d.correct / d.total) * totalH) : 0;
              const showLabel = trendRange !== '30d' || i % 5 === 0 || i === trendSeries.length - 1;
              return (
                <g key={d.key}>
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
                  {showLabel && (
                    <text x={centerX} y={148} textAnchor="middle" fontSize="10" fill="var(--text-muted)">
                      {d.label}
                    </text>
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
              />
            )}
          </svg>
        </Card>

        <Card className="lg:col-span-5 space-y-4 anim-stagger" style={{ '--stagger-i': 7 } as React.CSSProperties}>
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-semibold text-ink">{bi('记忆牢固度分布', 'Memory Strength Distribution')}</h3>
          </div>
          <div className="space-y-3">
            {stats.retrievabilityBuckets.map((b) => {
              const pct = stats.cardMap.size ? Math.round((b.count / stats.cardMap.size) * 100) : 0;
              const lbl = bucketLabels[b.key] || { zh: b.labelZh, en: b.labelEn };
              return (
                <div key={b.key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-ink">{bi(lbl.zh, lbl.en)}</span>
                    <span className="text-ink-muted tabular-nums">
                      {b.count} {bi('题', 'Q')} ({pct}%)
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-surface-muted overflow-hidden">
                    <div className={`h-full rounded-full anim-bar-x ${b.cls}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Confidence Calibration + 14-day Forecast + Time Donut */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <Card className="lg:col-span-5 space-y-3.5 anim-stagger" style={{ '--stagger-i': 8 } as React.CSSProperties} data-testid="lab-calibration-matrix">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-amber-500" />
              {bi('把握度与正确率统计', 'Confidence & Accuracy')}
            </h3>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="p-2 rounded-lg bg-surface-muted font-medium text-ink-muted">{bi('把握度', 'Confidence')}</div>
            <div className="p-2 rounded-lg bg-emerald-500/10 font-semibold text-emerald-700 dark:text-emerald-300">{bi('答对次数', 'Correct')}</div>
            <div className="p-2 rounded-lg bg-red-500/10 font-semibold text-red-700 dark:text-red-300">{bi('答错次数', 'Wrong')}</div>

            <div className="p-2.5 rounded-lg bg-canvas border border-line font-medium text-ink">{bi('很确定', 'Certain')}</div>
            <div className="p-2.5 rounded-lg bg-canvas border border-line tabular-nums font-semibold text-ink">
              {stats.calibrationMatrix.highOk}
            </div>
            <div
              className={`p-2.5 rounded-lg border tabular-nums font-semibold transition-colors ${
                stats.calibrationMatrix.highWrong > 0
                  ? 'border-amber-500/50 bg-amber-500/15 text-amber-800 dark:text-amber-300'
                  : 'border-line bg-canvas text-ink'
              }`}
            >
              {stats.calibrationMatrix.highWrong}
            </div>

            <div className="p-2.5 rounded-lg bg-canvas border border-line font-medium text-ink">{bi('不确定', 'Unsure')}</div>
            <div className="p-2.5 rounded-lg bg-canvas border border-line tabular-nums font-semibold text-ink">
              {stats.calibrationMatrix.midOk}
            </div>
            <div className="p-2.5 rounded-lg bg-canvas border border-line tabular-nums font-semibold text-ink">
              {stats.calibrationMatrix.midWrong}
            </div>

            <div className="p-2.5 rounded-lg bg-canvas border border-line font-medium text-ink">{bi('蒙的', 'Guess')}</div>
            <div
              className={`p-2.5 rounded-lg border tabular-nums font-semibold transition-colors ${
                stats.calibrationMatrix.lowOk > 0
                  ? 'border-amber-500/50 bg-amber-500/15 text-amber-800 dark:text-amber-300'
                  : 'border-line bg-canvas text-ink'
              }`}
            >
              {stats.calibrationMatrix.lowOk}
            </div>
            <div className="p-2.5 rounded-lg bg-canvas border border-line tabular-nums font-semibold text-ink">
              {stats.calibrationMatrix.lowWrong}
            </div>
          </div>
          <p className="text-[11px] text-ink-muted leading-relaxed">
            {bi(
              '“很确定却答错”的题目会优先安排复测；“蒙对”的题目会缩短下次复习间隔。',
              'High-confidence errors are prioritized; lucky guesses get shorter review intervals.',
            )}
          </p>
        </Card>

        <Card className="lg:col-span-4 space-y-3 anim-stagger" style={{ '--stagger-i': 9 } as React.CSSProperties}>
          <div className="flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-semibold text-ink">{bi('未来 14 天待复习量', '14-Day Review Schedule')}</h3>
          </div>
          <div className="grid grid-cols-14 gap-1 items-end h-32 pt-3" style={{ gridTemplateColumns: 'repeat(14, minmax(0, 1fr))' }}>
            {stats.workload14d.map((w) => {
              const hPct = Math.round((w.count / maxWork) * 100);
              return (
                <div key={w.key} className="flex flex-col items-center justify-end h-full gap-1" title={`${w.label}: ${w.count}`}>
                  <span className="text-[9px] text-ink-muted tabular-nums">{w.count > 0 ? w.count : ''}</span>
                  <div className="w-full flex-1 flex items-end bg-surface-muted/60 rounded-t overflow-hidden">
                    <div
                      className="w-full rounded-t bg-accent/80 anim-bar-grow"
                      style={{ height: `${w.count > 0 ? Math.max(8, hPct) : 0}%` }}
                    />
                  </div>
                  <span className="text-[9px] text-ink-muted truncate max-w-full">{w.label}</span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="lg:col-span-3 space-y-3 anim-stagger" style={{ '--stagger-i': 10 } as React.CSSProperties}>
          <div className="flex items-center gap-2">
            <Hourglass className="w-4 h-4 text-sky-500" />
            <h3 className="text-sm font-semibold text-ink">{bi('单题耗时分布', 'Response Time')}</h3>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative w-24 h-24 flex-shrink-0">
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
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xs font-semibold text-ink tabular-nums">
                  {stats.avgDurationSec !== null ? `${stats.avgDurationSec}s` : '—'}
                </span>
              </div>
            </div>
            <div className="flex-1 space-y-1 text-[11px]">
              {durationBuckets.buckets.map((b) => (
                <div key={b.key} className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-ink">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: b.color }} />
                    {b.label}
                  </span>
                  <span className="text-ink-muted tabular-nums">{b.count}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* Top Mistakes & Guesses */}
      {topRiskQuestions.length > 0 && (
        <Card className="space-y-3 anim-stagger" style={{ '--stagger-i': 11 } as React.CSSProperties}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              {bi('高频错题与蒙对榜', 'Top Mistakes & Guesses')}
            </h3>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                startSession({
                  mode: 'dual_track',
                  questions: topRiskQuestions.map((x) => x.q),
                  title: bi('重点错题专练', 'Focused Review'),
                  settings: data.settings,
                })
              }
            >
              {bi('重练这几题', 'Practice These')}
            </Button>
          </div>
          <div className="space-y-3">
            {topRiskQuestions.map(({ q, card }) => (
              <div key={q.id} className="p-3.5 rounded-xl border border-line bg-canvas/55 space-y-2 card-hover">
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <Badge tone="neutral">{q.sub} / {q.chap}</Badge>
                  {card.isHyperRisk && <Badge tone="danger">{bi('易混错题', 'High-Conf Error')}</Badge>}
                  {card.isLuckyGuess && <Badge tone="warning">{bi('蒙对题目', 'Lucky Guess')}</Badge>}
                  <span className="text-[11px] font-mono text-ink-muted tabular-nums">
                    {bi(`记忆度 ${Math.round(card.retrievability * 100)}%`, `R ${Math.round(card.retrievability * 100)}%`)} | {bi(`错 ${card.wrongCount}/${card.attempts}`, `${card.wrongCount}/${card.attempts}`)}
                  </span>
                </div>
                <QuestionPreviewBlock question={q} compact showExplanation />
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};
