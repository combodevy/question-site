import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  FlaskConical,
  Gauge,
  History,
  Library,
  Play,
  RotateCcw,
  Shuffle,
  Sparkles,
  Target,
} from 'lucide-react';
import { composeLabSession } from '@qs/shared';
import type { LiveLabSnapshot, LabStats } from '@/lab/hooks';
import { useLabAuthStore } from '@/lab/useLabAuthStore';
import {
  clearUnfinishedLabSnapshot,
  readUnfinishedLabSnapshot,
  useLabQuizStore,
  type UnfinishedLabSnapshot,
} from '@/lab/useLabQuizStore';
import { useUiStore } from '@/store/useUiStore';
import { useBi } from '@/i18n/useBi';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import type { LabNavTab } from '@/lab/LabShellLayout';

interface LabOverviewViewProps {
  data: LiveLabSnapshot;
  stats: LabStats;
  onNavigate: (tab: LabNavTab) => void;
}

export const LabOverviewView: React.FC<LabOverviewViewProps> = ({
  data,
  stats,
  onNavigate,
}) => {
  const { bi } = useBi();
  const user = useLabAuthStore((s) => s.user);
  const { pushToast } = useUiStore();
  const { startSession, resumeFromSnapshot } = useLabQuizStore();

  const [unfinishedSnap, setUnfinishedSnap] = useState<UnfinishedLabSnapshot | null>(null);
  const [resumeDismissed, setResumeDismissed] = useState(false);

  useEffect(() => {
    if (resumeDismissed || data.loading || data.questions.length === 0) return;
    const snap = readUnfinishedLabSnapshot(user?.id);
    if (!snap) return;
    const activeIds = new Set(data.questions.map((q) => q.id));
    const validCount = snap.items.filter((it) => activeIds.has(it.questionId)).length;
    if (validCount === 0) {
      clearUnfinishedLabSnapshot(user?.id);
      return;
    }
    setUnfinishedSnap(snap);
  }, [user?.id, data.loading, data.questions, resumeDismissed]);

  const handleDismissUnfinished = () => {
    clearUnfinishedLabSnapshot(user?.id);
    setUnfinishedSnap(null);
    setResumeDismissed(true);
  };

  const handleResumeUnfinished = () => {
    if (!unfinishedSnap) return;
    const ok = resumeFromSnapshot(unfinishedSnap, data.questions);
    setUnfinishedSnap(null);
    setResumeDismissed(true);
    if (!ok) {
      pushToast(bi('共享题库已变动，无法恢复该场练习', 'Shared questions no longer available'), 'warning');
    }
  };

  const launchMode = (
    mode: 'smart_interleave' | 'fsrs_review' | 'dual_track',
    sub?: string,
  ) => {
    const pool = sub ? data.questions.filter((q) => q.sub === sub) : data.questions;
    const composed = composeLabSession({
      questions: pool,
      cardStates: stats.cardMap,
      mode,
      limit: mode === 'fsrs_review' ? 'all' : 20,
      desiredRetention: data.settings.desiredRetention,
      starredIds: stats.starredIds,
      hiddenMistakeIds: stats.hiddenMistakeIds,
    });
    if (!composed.length) {
      pushToast(bi('当前模式下暂无符合条件的题目', 'No matching questions for this mode'), 'info');
      return;
    }
    const modeTitle =
      mode === 'smart_interleave'
        ? sub
          ? `${sub} / ${bi('智能混合练习', 'Smart Mix')}`
          : bi('智能混合练习', 'Smart Mixed Practice')
        : mode === 'fsrs_review'
        ? bi('到期复习', 'Due Review')
        : bi('错题与蒙对专练', 'Mistakes & Guesses');

    startSession({
      mode,
      questions: composed,
      title: modeTitle,
      settings: data.settings,
    });
  };

  const sweetBadge =
    stats.sweetSpotStatus === 'sweet_spot'
      ? { tone: 'success' as const, label: bi('难度适中', 'Balanced') }
      : stats.sweetSpotStatus === 'too_hard'
      ? { tone: 'danger' as const, label: bi('偏难', 'Hard') }
      : stats.sweetSpotStatus === 'too_easy'
      ? { tone: 'warning' as const, label: bi('偏简单', 'Easy') }
      : { tone: 'neutral' as const, label: bi('统计中', 'Pending') };

  const focusRiskTotal = stats.hyperRiskIds.size + stats.luckyGuessIds.size;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 anim-fade-in">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-accent-soft text-accent inline-flex items-center justify-center transition-transform duration-200 hover:scale-105">
            <FlaskConical className="w-4 h-4" />
          </span>
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-ink">
              {bi('精练概览', 'Practice Overview')}
            </h1>
            <p className="text-xs text-ink-muted">
              {bi(
                `共享题库 ${stats.totalQuestions} 题 | 本模式练习记录独立统计`,
                `${stats.totalQuestions} shared questions | Independent progress`,
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <a
            href="/#library"
            className="h-9 px-3 rounded-xl border border-line bg-surface text-xs font-medium text-ink-muted hover:text-ink hover:border-ink-muted/40 inline-flex items-center gap-1.5 transition-all duration-200 active:scale-[0.97]"
          >
            <Library className="w-3.5 h-3.5" />
            {bi('管理共享题库', 'Shared Bank')}
          </a>
          <Button variant="primary" size="sm" onClick={() => onNavigate('setup')}>
            <Sparkles className="w-3.5 h-3.5" />
            {bi('自定义练习', 'Custom Practice')}
          </Button>
        </div>
      </div>

      {/* 4 Core KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <Card padding="sm" className="anim-stagger card-hover" style={{ '--stagger-i': 0 } as React.CSSProperties}>
          <div className="text-xs text-ink-muted flex items-center justify-between">
            <span>{bi('今日待复习', 'Due Today')}</span>
            <Brain className="w-4 h-4 text-accent" />
          </div>
          <div className="text-2xl font-semibold text-ink tabular-nums mt-2">{stats.dueCount}</div>
          <div className="text-[11px] text-ink-muted mt-0.5">
            {bi(`目标保持率 ${Math.round(data.settings.desiredRetention * 100)}%`, `Target ${Math.round(data.settings.desiredRetention * 100)}%`)}
          </div>
        </Card>

        <Card padding="sm" className="anim-stagger card-hover" style={{ '--stagger-i': 1 } as React.CSSProperties}>
          <div className="text-xs text-ink-muted flex items-center justify-between">
            <span>{bi('整体记忆度', 'Retention Level')}</span>
            <Target className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums mt-2">
            {stats.cardMap.size > 0 ? `${stats.avgRetrievability}%` : '—'}
          </div>
          <div className="text-[11px] text-ink-muted mt-0.5 tabular-nums">
            {bi(`已记录 ${stats.cardMap.size} 题`, `${stats.cardMap.size} tracked`)}
          </div>
        </Card>

        <Card padding="sm" className="anim-stagger card-hover" style={{ '--stagger-i': 2 } as React.CSSProperties}>
          <div className="text-xs text-ink-muted flex items-center justify-between">
            <span>{bi('近期正确率', 'Recent Accuracy')}</span>
            <Gauge className="w-4 h-4 text-sky-500" />
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-semibold text-ink tabular-nums">
              {stats.recent50Accuracy !== null ? `${stats.recent50Accuracy}%` : '—'}
            </span>
            <Badge tone={sweetBadge.tone}>{sweetBadge.label}</Badge>
          </div>
          <div className="text-[11px] text-ink-muted mt-0.5">
            {bi('推荐保持 75% - 85%', 'Recommended 75-85%')}
          </div>
        </Card>

        <Card
          padding="sm"
          onClick={() => onNavigate('mistakes')}
          className="anim-stagger card-hover cursor-pointer"
          style={{ '--stagger-i': 3 } as React.CSSProperties}
        >
          <div className="text-xs text-ink-muted flex items-center justify-between">
            <span>{bi('重点关注题', 'Focus Items')}</span>
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-semibold text-amber-600 dark:text-amber-400 tabular-nums mt-2">
            {focusRiskTotal}
          </div>
          <div className="text-[11px] text-ink-muted mt-0.5 tabular-nums">
            {bi(
              `易混错题 ${stats.hyperRiskIds.size} | 蒙对 ${stats.luckyGuessIds.size}`,
              `Mistakes ${stats.hyperRiskIds.size} | Guesses ${stats.luckyGuessIds.size}`,
            )}
          </div>
        </Card>
      </div>

      {data.questions.length === 0 ? (
        <EmptyState
          icon={<Library className="w-5 h-5" />}
          title={bi('共享题库暂无题目', 'Shared Question Bank Is Empty')}
          description={bi(
            '请先前往经典版题库管理导入或创建题目，即可在这里开始练习。',
            'Import or add questions in Classic Mode Library first.',
          )}
          action={
            <a
              href="/#library"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-accent-fg text-xs font-medium hover:bg-accent-hover transition-all duration-200 active:scale-[0.97]"
            >
              <Library className="w-4 h-4" />
              {bi('前往共享题库', 'Open Shared Library')}
            </a>
          }
        />
      ) : (
        <>
          {/* 3 Quick-Launch Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card
              className="flex flex-col justify-between gap-4 border-accent/35 bg-accent-soft/20 card-hover anim-stagger"
              style={{ '--stagger-i': 4 } as React.CSSProperties}
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Badge tone="accent">{bi('推荐', 'Recommended')}</Badge>
                  <Shuffle className="w-4 h-4 text-accent" />
                </div>
                <h2 className="text-base font-semibold text-ink">
                  {bi('智能混合练习', 'Smart Mixed Practice')}
                </h2>
                <p className="text-xs text-ink-muted leading-relaxed">
                  {bi(
                    '自动搭配待复习、错题与新题，跨章出题，提升辨别能力。',
                    'Blends due items, mistakes, and new questions across chapters.',
                  )}
                </p>
              </div>
              <Button variant="primary" onClick={() => launchMode('smart_interleave')} data-testid="lab-quick-smart-btn">
                <Play className="w-4 h-4" />
                {bi('开始练习 (20 题)', 'Start 20 Questions')}
              </Button>
            </Card>

            <Card
              className="flex flex-col justify-between gap-4 card-hover anim-stagger"
              style={{ '--stagger-i': 5 } as React.CSSProperties}
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Badge tone={stats.dueCount > 0 ? 'warning' : 'neutral'}>
                    {bi(`${stats.dueCount} 题待复习`, `${stats.dueCount} due`)}
                  </Badge>
                  <Brain className="w-4 h-4 text-violet-500" />
                </div>
                <h2 className="text-base font-semibold text-ink">
                  {bi('到期复习', 'Due Review')}
                </h2>
                <p className="text-xs text-ink-muted leading-relaxed">
                  {bi(
                    '按遗忘规律筛出今日到点题目，及时复习防遗忘。',
                    'Reviews questions scheduled by memory decay before forgetting.',
                  )}
                </p>
              </div>
              <Button
                variant="outline"
                disabled={stats.dueCount === 0}
                onClick={() => launchMode('fsrs_review')}
                data-testid="lab-quick-fsrs-btn"
              >
                <Play className="w-4 h-4" />
                {stats.dueCount > 0
                  ? bi(`开始复习 (${stats.dueCount})`, `Review ${stats.dueCount} Due`)
                  : bi('今日已全部复习', 'All Caught Up')}
              </Button>
            </Card>

            <Card
              className="flex flex-col justify-between gap-4 card-hover anim-stagger"
              style={{ '--stagger-i': 6 } as React.CSSProperties}
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Badge tone={stats.visibleMistakeIds.size > 0 ? 'danger' : 'neutral'}>
                    {bi(`${stats.visibleMistakeIds.size} 题`, `${stats.visibleMistakeIds.size} items`)}
                  </Badge>
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                </div>
                <h2 className="text-base font-semibold text-ink">
                  {bi('错题与蒙对专练', 'Mistakes & Guesses')}
                </h2>
                <p className="text-xs text-ink-muted leading-relaxed">
                  {bi(
                    '集中重练做错和蒙对的题目，消除知识盲区。',
                    'Focuses on missed questions and uncertain lucky guesses.',
                  )}
                </p>
              </div>
              <Button
                variant="outline"
                disabled={stats.visibleMistakeIds.size === 0}
                onClick={() => launchMode('dual_track')}
                data-testid="lab-quick-dual-btn"
              >
                <Play className="w-4 h-4" />
                {stats.visibleMistakeIds.size > 0
                  ? bi(`专项重练 (${stats.visibleMistakeIds.size})`, `Drill ${stats.visibleMistakeIds.size}`)
                  : bi('暂无错题记录', 'No Mistakes')}
              </Button>
            </Card>
          </div>

          {/* Subject Mastery Grid */}
          <Card className="space-y-4 anim-stagger" style={{ '--stagger-i': 7 } as React.CSSProperties}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">
                {bi('各科目掌握情况', 'Subject Mastery')}
              </h3>
              <button
                type="button"
                onClick={() => onNavigate('analytics')}
                className="text-xs font-medium text-accent hover:underline inline-flex items-center gap-1 transition-transform duration-150 hover:translate-x-0.5"
              >
                {bi('查看学习分析', 'View Analytics')}
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {stats.subjectTree.map((s, idx) => {
                const covPct = s.total ? Math.round((s.answered / s.total) * 100) : 0;
                return (
                  <div
                    key={s.sub}
                    style={{ '--stagger-i': idx } as React.CSSProperties}
                    className="anim-stagger p-3.5 rounded-xl border border-line bg-canvas/60 hover:border-accent/45 card-hover space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-ink truncate">{s.sub}</span>
                      <span className="text-[11px] text-ink-muted tabular-nums flex-shrink-0">
                        {s.answered}/{s.total}
                      </span>
                    </div>

                    <div className="h-1.5 w-full rounded-full bg-surface-muted overflow-hidden">
                      <div
                        className="h-full bg-accent transition-all duration-500 anim-bar-x"
                        style={{ width: `${covPct}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between gap-2 text-[11px] text-ink-muted">
                      <span className="tabular-nums">
                        {bi(`记忆度 ${s.answered ? `${s.avgRetrievability}%` : '—'}`, `Retention ${s.answered ? `${s.avgRetrievability}%` : '—'}`)}
                        {s.due > 0 && ` | ${bi(`待复习 ${s.due}`, `Due ${s.due}`)}`}
                      </span>
                      <button
                        type="button"
                        onClick={() => launchMode('smart_interleave', s.sub)}
                        className="px-2 py-0.5 rounded-md bg-accent-soft text-accent font-medium hover:bg-accent hover:text-accent-fg transition-all duration-150 active:scale-95 inline-flex items-center gap-1"
                      >
                        <Play className="w-2.5 h-2.5" />
                        {bi('开始练习', 'Practice')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </>
      )}

      {/* Unfinished Session Modal */}
      <Modal
        open={Boolean(unfinishedSnap)}
        onClose={handleDismissUnfinished}
        title={bi('继续上次未完成的练习？', 'Resume Unfinished Practice?')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={handleDismissUnfinished}>
              {bi('放弃并关闭', 'Discard')}
            </Button>
            <Button variant="primary" size="sm" onClick={handleResumeUnfinished}>
              <RotateCcw className="w-3.5 h-3.5" />
              {bi('继续作答', 'Resume')}
            </Button>
          </>
        }
      >
        {unfinishedSnap && (
          <div className="space-y-2 text-xs text-ink-muted">
            <div className="p-3 rounded-xl bg-canvas border border-line space-y-1 text-ink">
              <div className="font-semibold flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-accent" />
                <span>{unfinishedSnap.title || bi('精练会话', 'Practice Session')}</span>
              </div>
              <div className="text-[11px] text-ink-muted tabular-nums">
                {bi(
                  `已答 ${Object.keys(unfinishedSnap.answers || {}).length} / ${unfinishedSnap.items.length} 题`,
                  `Answered ${Object.keys(unfinishedSnap.answers || {}).length} / ${unfinishedSnap.items.length}`,
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
