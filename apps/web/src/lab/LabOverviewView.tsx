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
      pushToast(bi('共享题库已变动，无法恢复该场精练', 'Shared questions no longer available'), 'warning');
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
          ? `${sub} / ${bi('智能穿插', 'Smart Mix')}`
          : bi('智能穿插推荐组卷', 'Smart Interleaved Session')
        : mode === 'fsrs_review'
        ? bi('FSRS 到期复习', 'FSRS Due Review')
        : bi('双轨错题攻坚', 'Dual-Track Mistakes');

    startSession({
      mode,
      questions: composed,
      title: modeTitle,
      settings: data.settings,
    });
  };

  const sweetBadge =
    stats.sweetSpotStatus === 'sweet_spot'
      ? { tone: 'success' as const, label: bi('处于 75-85% 最佳区', 'Optimal Zone') }
      : stats.sweetSpotStatus === 'too_hard'
      ? { tone: 'danger' as const, label: bi('偏难，建议加入例题/简单题', 'Too Hard') }
      : stats.sweetSpotStatus === 'too_easy'
      ? { tone: 'warning' as const, label: bi('偏易，建议提高穿插比例', 'Too Easy') }
      : { tone: 'neutral' as const, label: bi('样本积累中', 'Calibrating') };

  const dualRiskTotal = stats.hyperRiskIds.size + stats.luckyGuessIds.size;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-accent-soft text-accent inline-flex items-center justify-center">
            <FlaskConical className="w-4 h-4" />
          </span>
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-ink">
              {bi('科学精练概览', 'Science Lab Overview')}
            </h1>
            <p className="text-xs text-ink-muted">
              {bi(
                `共享题库 ${stats.totalQuestions} 题 | 精练记录与错误率独立核算`,
                `${stats.totalQuestions} shared questions | Isolated memory & calibration metrics`,
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <a
            href="/#library"
            className="h-9 px-3 rounded-xl border border-line bg-surface text-xs font-medium text-ink-muted hover:text-ink inline-flex items-center gap-1.5 transition-colors"
          >
            <Library className="w-3.5 h-3.5" />
            {bi('管理共享题库', 'Shared Bank')}
          </a>
          <Button variant="primary" size="sm" onClick={() => onNavigate('setup')}>
            <Sparkles className="w-3.5 h-3.5" />
            {bi('自定义科学组卷', 'Compose Session')}
          </Button>
        </div>
      </div>

      {/* 4 Core KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <Card padding="sm" className="anim-stagger card-hover" style={{ '--stagger-i': 0 } as React.CSSProperties}>
          <div className="text-xs text-ink-muted flex items-center justify-between">
            <span>{bi('FSRS 今日到期', 'FSRS Due Today')}</span>
            <Brain className="w-4 h-4 text-accent" />
          </div>
          <div className="text-2xl font-semibold text-ink tabular-nums mt-2">{stats.dueCount}</div>
          <div className="text-[11px] text-ink-muted mt-0.5">
            {bi(`目标保持率 ${Math.round(data.settings.desiredRetention * 100)}%`, `Target R ${Math.round(data.settings.desiredRetention * 100)}%`)}
          </div>
        </Card>

        <Card padding="sm" className="anim-stagger card-hover" style={{ '--stagger-i': 1 } as React.CSSProperties}>
          <div className="text-xs text-ink-muted flex items-center justify-between">
            <span>{bi('平均记忆提取率', 'Avg Retrievability')}</span>
            <Target className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums mt-2">
            {stats.cardMap.size > 0 ? `${stats.avgRetrievability}%` : '—'}
          </div>
          <div className="text-[11px] text-ink-muted mt-0.5 tabular-nums">
            {bi(`已建立记忆曲线 ${stats.cardMap.size} 题`, `${stats.cardMap.size} cards tracked`)}
          </div>
        </Card>

        <Card padding="sm" className="anim-stagger card-hover" style={{ '--stagger-i': 2 } as React.CSSProperties}>
          <div className="text-xs text-ink-muted flex items-center justify-between">
            <span>{bi('近期难度甜蜜点', 'Sweet Spot (Last 50)')}</span>
            <Gauge className="w-4 h-4 text-sky-500" />
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-semibold text-ink tabular-nums">
              {stats.recent50Accuracy !== null ? `${stats.recent50Accuracy}%` : '—'}
            </span>
            <Badge tone={sweetBadge.tone}>{sweetBadge.label}</Badge>
          </div>
          <div className="text-[11px] text-ink-muted mt-0.5">
            {bi(`科学最优区：75% - 85%`, 'Optimal learning zone: 75-85%')}
          </div>
        </Card>

        <Card
          padding="sm"
          onClick={() => onNavigate('mistakes')}
          className="anim-stagger card-hover cursor-pointer"
          style={{ '--stagger-i': 3 } as React.CSSProperties}
        >
          <div className="text-xs text-ink-muted flex items-center justify-between">
            <span>{bi('双轨隐患题目', 'Dual-Track Risks')}</span>
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-semibold text-amber-600 dark:text-amber-400 tabular-nums mt-2">
            {dualRiskTotal}
          </div>
          <div className="text-[11px] text-ink-muted mt-0.5 tabular-nums">
            {bi(
              `高自信误区 ${stats.hyperRiskIds.size} | 蒙对 ${stats.luckyGuessIds.size}`,
              `Hyper ${stats.hyperRiskIds.size} | Guess ${stats.luckyGuessIds.size}`,
            )}
          </div>
        </Card>
      </div>

      {data.questions.length === 0 ? (
        <EmptyState
          icon={<Library className="w-5 h-5" />}
          title={bi('共享题库暂无题目', 'Shared Question Bank Is Empty')}
          description={bi(
            '请先前往经典版的题库管理导入或创建题目，导入后即可在科学精练中直接组卷。',
            'Import or create questions in Classic Mode Library first; they appear here automatically.',
          )}
          action={
            <a
              href="/#library"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-accent-fg text-xs font-medium hover:bg-accent-hover transition-colors"
            >
              <Library className="w-4 h-4" />
              {bi('前往经典题库导入', 'Go to Shared Library')}
            </a>
          }
        />
      ) : (
        <>
          {/* 3 Smart Quick-Launch Mode Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="flex flex-col justify-between gap-4 border-accent/35 bg-accent-soft/20 card-hover">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Badge tone="accent">{bi('推荐首选', 'Recommended')}</Badge>
                  <Shuffle className="w-4 h-4 text-accent" />
                </div>
                <h2 className="text-base font-semibold text-ink">
                  {bi('智能穿插推荐组卷', 'Smart Interleaved Mix')}
                </h2>
                <p className="text-xs text-ink-muted leading-relaxed">
                  {bi(
                    '按 50% 临近遗忘 + 30% 双轨高危 + 20% 巩固新题混编，并强制跨章节穿插出题。',
                    'Blends due items, dual-track risks, and anchors targeting the 75-85% zone with anti-clumping chapter order.',
                  )}
                </p>
              </div>
              <Button variant="primary" onClick={() => launchMode('smart_interleave')} data-testid="lab-quick-smart-btn">
                <Play className="w-4 h-4" />
                {bi('立即开始 (20 题)', 'Start 20 Questions')}
              </Button>
            </Card>

            <Card className="flex flex-col justify-between gap-4 card-hover">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Badge tone={stats.dueCount > 0 ? 'warning' : 'neutral'}>
                    {bi(`${stats.dueCount} 题到期`, `${stats.dueCount} due`)}
                  </Badge>
                  <Brain className="w-4 h-4 text-violet-500" />
                </div>
                <h2 className="text-base font-semibold text-ink">
                  {bi('FSRS 遗忘临界巩固', 'FSRS Due Consolidation')}
                </h2>
                <p className="text-xs text-ink-muted leading-relaxed">
                  {bi(
                    '优先调度高自信误区（4天窗口）、蒙对确认题以及提取率跌破目标线的题目。',
                    'Prioritizes hypercorrection risks, lucky guesses, and cards below your retention threshold.',
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
                  ? bi(`巩固到期题 (${stats.dueCount})`, `Review ${stats.dueCount} Due`)
                  : bi('今日暂无到期题', 'All Caught Up')}
              </Button>
            </Card>

            <Card className="flex flex-col justify-between gap-4 card-hover">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Badge tone={stats.visibleMistakeIds.size > 0 ? 'danger' : 'neutral'}>
                    {bi(`${stats.visibleMistakeIds.size} 题待攻克`, `${stats.visibleMistakeIds.size} items`)}
                  </Badge>
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                </div>
                <h2 className="text-base font-semibold text-ink">
                  {bi('双轨错题攻坚', 'Dual-Track Error Drill')}
                </h2>
                <p className="text-xs text-ink-muted leading-relaxed">
                  {bi(
                    '重点拔除高自信却答错的顽固误区，同时把低自信蒙对的脆弱题拉回重测。',
                    'Targets high-confidence errors before hypercorrection fades alongside low-confidence lucky guesses.',
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
                  ? bi(`定向纠偏 (${stats.visibleMistakeIds.size})`, `Drill ${stats.visibleMistakeIds.size} Risks`)
                  : bi('暂无双轨错题', 'No Dual-Track Items')}
              </Button>
            </Card>
          </div>

          {/* Subject Mastery Grid (Isolated Lab Metrics) */}
          <Card className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">
                {bi('各科目精练掌握度（独立统计）', 'Subject Mastery (Lab Isolated)')}
              </h3>
              <button
                type="button"
                onClick={() => onNavigate('analytics')}
                className="text-xs font-medium text-accent hover:underline inline-flex items-center gap-1"
              >
                {bi('查看记忆曲线与校准矩阵', 'Memory Analytics')}
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {stats.subjectTree.map((s) => {
                const covPct = s.total ? Math.round((s.answered / s.total) * 100) : 0;
                return (
                  <div
                    key={s.sub}
                    className="p-3.5 rounded-xl border border-line bg-canvas/60 hover:border-accent/45 transition-colors space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-ink truncate">{s.sub}</span>
                      <span className="text-[11px] text-ink-muted tabular-nums flex-shrink-0">
                        {s.answered}/{s.total}
                      </span>
                    </div>

                    <div className="h-1.5 w-full rounded-full bg-surface-muted overflow-hidden">
                      <div
                        className="h-full bg-accent transition-all duration-500"
                        style={{ width: `${covPct}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between gap-2 text-[11px] text-ink-muted">
                      <span className="tabular-nums">
                        {bi(`提取率 ${s.answered ? `${s.avgRetrievability}%` : '—'}`, `R ${s.answered ? `${s.avgRetrievability}%` : '—'}`)}
                        {s.due > 0 && ` | ${bi(`到期 ${s.due}`, `Due ${s.due}`)}`}
                      </span>
                      <button
                        type="button"
                        onClick={() => launchMode('smart_interleave', s.sub)}
                        className="px-2 py-0.5 rounded-md bg-accent-soft text-accent font-medium hover:bg-accent hover:text-accent-fg transition-colors inline-flex items-center gap-1"
                      >
                        <Play className="w-2.5 h-2.5" />
                        {bi('穿插练', 'Drill')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </>
      )}

      {/* Unfinished Lab Session Modal */}
      <Modal
        open={Boolean(unfinishedSnap)}
        onClose={handleDismissUnfinished}
        title={bi('继续上次未完成的精练？', 'Resume Unfinished Lab Session?')}
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
                <span>{unfinishedSnap.title || bi('科学精练会话', 'Lab Session')}</span>
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
