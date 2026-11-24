import React, { useMemo } from 'react';
import {
  ArrowRight,
  Bookmark,
  Brain,
  Flame,
  FolderPlus,
  Layers,
  Play,
  Sparkles,
  Target,
  Upload,
} from 'lucide-react';
import type { LiveStudySnapshot, StudyStats } from '@/sync/hooks';
import { useQuizStore } from '@/store/useQuizStore';
import { useBi } from '@/i18n/useBi';
import { localDayKey } from '@/lib/text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import type { NavTab } from '@/components/layout/ShellLayout';

interface DashboardViewProps {
  data: LiveStudySnapshot;
  stats: StudyStats;
  onNavigate: (tab: NavTab) => void;
  onOpenImport: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  data,
  stats,
  onNavigate,
  onOpenImport,
}) => {
  const { bi } = useBi();
  const startSession = useQuizStore((s) => s.startSession);

  const last7Days = useMemo(() => {
    const map = new Map<string, { total: number; correct: number }>();
    for (const h of data.history) {
      const k = localDayKey(h.t);
      const b = map.get(k) || { total: 0, correct: 0 };
      b.total++;
      if (h.r) b.correct++;
      map.set(k, b);
    }
    const out: Array<{ label: string; total: number; correct: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = localDayKey(d);
      const val = map.get(key) || { total: 0, correct: 0 };
      out.push({
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        total: val.total,
        correct: val.correct,
      });
    }
    return out;
  }, [data.history]);

  const maxDayTotal = Math.max(1, ...last7Days.map((d) => d.total));

  const launchDueReview = () => {
    const idSet = new Set(stats.dueQuestionIds);
    const ordered: typeof data.questions = [];
    const byId = new Map(data.questions.map((q) => [q.id, q]));
    for (const qid of stats.dueQuestionIds) {
      const q = byId.get(qid);
      if (q && idSet.has(q.id)) ordered.push(q);
    }
    if (!ordered.length) return;
    startSession({ mode: 'review', questions: ordered, title: bi('今日到期复习', 'SM-2 Due Review') });
  };

  const launchRandom = (sub?: string) => {
    const pool = sub ? data.questions.filter((q) => q.sub === sub) : [...data.questions];
    if (!pool.length) return;
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    startSession({
      mode: 'random',
      questions: pool.slice(0, 20),
      title: sub ? `${sub}` : bi('随机刷题', 'Quick Practice'),
    });
  };

  const launchMistakes = () => {
    const pool = data.questions.filter((q) => stats.visibleMistakeIds.has(q.id));
    if (!pool.length) return;
    startSession({ mode: 'mistakes', questions: pool, title: bi('错题攻坚', 'Mistakes Drill') });
  };

  const launchStarred = () => {
    const pool = data.questions.filter((q) => stats.starredIds.has(q.id));
    if (!pool.length) return;
    startSession({ mode: 'starred', questions: pool, title: bi('收藏专练', 'Starred Practice') });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-ink">
            {bi('学习概览', 'Study Overview')}
          </h1>
          <p className="text-xs sm:text-sm text-ink-muted mt-0.5">
            {data.bankName
              ? bi(`当前题库：${data.bankName}`, `Active bank: ${data.bankName}`)
              : bi('把重点留给最值得复习的题目', 'Focus on what matters most right now')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onOpenImport}>
            <Upload className="w-3.5 h-3.5" />
            {bi('导入题库', 'Import')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => onNavigate('setup')}>
            <Play className="w-3.5 h-3.5" />
            {bi('自选组卷', 'Custom Session')}
          </Button>
        </div>
      </div>

      {/* Focus Hero */}
      {stats.totalQuestions === 0 ? (
        <Card padding="lg" className="flex flex-col sm:flex-row sm:items-center justify-between gap-5">
          <div className="space-y-2 max-w-xl">
            <Badge tone="accent">{bi('第一步', 'Getting Started')}</Badge>
            <h2 className="text-lg font-semibold text-ink">
              {bi('导入你的第一份题库，或前往英语真题实战', 'Import your first question bank or open English Past Papers')}
            </h2>
            <p className="text-sm text-ink-muted leading-relaxed">
              {bi(
                '支持 JSON、TXT、Word (.docx) 与 PDF 解析导入，也可以复制内置 AI 提示词一键把笔记转为标准题库。',
                'Supports JSON, TXT, Word (.docx), and PDF parsing — or copy our AI prompt to convert notes into a bank.',
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 flex-shrink-0">
            <Button variant="primary" size="lg" onClick={onOpenImport}>
              <FolderPlus className="w-4 h-4" />
              {bi('导入题库', 'Import Bank')}
            </Button>
            <Button variant="outline" size="lg" onClick={() => onNavigate('english')}>
              {bi('浏览英语真题', 'English Papers')}
            </Button>
          </div>
        </Card>
      ) : (
        <Card padding="lg" className="border-accent/25">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-accent-soft text-accent inline-flex items-center justify-center">
                  <Brain className="w-4 h-4" />
                </span>
                <span className="text-xs font-medium text-ink-muted">
                  {bi('SM-2 间隔记忆调度', 'SM-2 Spaced Repetition')}
                </span>
                {stats.streakDays > 0 && (
                  <Badge tone="warning">
                    <Flame className="w-3 h-3" />
                    {bi(`连续 ${stats.streakDays} 天`, `${stats.streakDays}d streak`)}
                  </Badge>
                )}
              </div>

              {stats.dueCount > 0 ? (
                <>
                  <h2 className="text-xl sm:text-2xl font-semibold text-ink tabular-nums">
                    {bi(`今日有 ${stats.dueCount} 道题到达复习节点`, `${stats.dueCount} questions due for review today`)}
                  </h2>
                  <p className="text-sm text-ink-muted">
                    {bi('按遗忘临界时间从早到晚排序，优先巩固最容易淡忘的知识点。', 'Ordered by earliest scheduled due timestamp.')}
                  </p>
                </>
              ) : (
                <>
                  <h2 className="text-xl sm:text-2xl font-semibold text-ink">
                    {bi('今日到期复习已完成', 'All scheduled reviews cleared')}
                  </h2>
                  <p className="text-sm text-ink-muted">
                    {bi(
                      `当前题库共 ${stats.totalQuestions} 题，可以再来一组 20 题随机练习保持手感。`,
                      `${stats.totalQuestions} active questions ready for a fresh random set.`,
                    )}
                  </p>
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2.5 flex-shrink-0">
              {stats.dueCount > 0 ? (
                <Button variant="primary" size="lg" onClick={launchDueReview}>
                  <Sparkles className="w-4 h-4" />
                  {bi(`立即复习 (${stats.dueCount})`, `Start Review (${stats.dueCount})`)}
                </Button>
              ) : (
                <Button variant="primary" size="lg" onClick={() => launchRandom()}>
                  <Play className="w-4 h-4" />
                  {bi('随机来 20 题', 'Quick 20-Q Practice')}
                </Button>
              )}
              {stats.visibleMistakeIds.size > 0 && (
                <Button variant="outline" size="lg" onClick={launchMistakes}>
                  {bi(`攻克错题 (${stats.visibleMistakeIds.size})`, `Mistakes (${stats.visibleMistakeIds.size})`)}
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* 4 Crisp Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <Card padding="sm">
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>{bi('总题量', 'Total Bank')}</span>
            <Layers className="w-3.5 h-3.5" />
          </div>
          <div className="text-2xl font-semibold text-ink tabular-nums mt-2">
            {stats.totalQuestions}
          </div>
          <div className="text-[11px] text-ink-muted mt-1">
            {bi(`${stats.subjectTree.length} 个科目`, `${stats.subjectTree.length} subjects`)}
          </div>
        </Card>

        <Card padding="sm">
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>{bi('今日已刷', 'Today Answered')}</span>
            <Target className="w-3.5 h-3.5" />
          </div>
          <div className="text-2xl font-semibold text-ink tabular-nums mt-2">
            {stats.todayAttempts}
          </div>
          <div className="text-[11px] text-ink-muted mt-1">
            {stats.todayAttempts > 0
              ? bi(
                  `正确 ${Math.round((stats.todayCorrect / stats.todayAttempts) * 100)}%`,
                  `${Math.round((stats.todayCorrect / stats.todayAttempts) * 100)}% accurate`,
                )
              : bi('今日尚未作答', 'No attempts yet')}
          </div>
        </Card>

        <Card padding="sm">
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>{bi('累计正确率', 'Overall Accuracy')}</span>
            <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <div className="text-2xl font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums mt-2">
            {stats.accuracyPercent}%
          </div>
          <div className="text-[11px] text-ink-muted mt-1 tabular-nums">
            {bi(`总作答 ${stats.totalAttempts} 次`, `${stats.totalAttempts} total attempts`)}
          </div>
        </Card>

        <Card padding="sm" className="flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>{bi('错题与收藏', 'Mistakes & Stars')}</span>
            <Bookmark className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <div className="flex items-baseline gap-3 mt-2 tabular-nums">
            <span className="text-2xl font-semibold text-red-600 dark:text-red-400">
              {stats.visibleMistakeIds.size}
            </span>
            <span className="text-sm text-ink-muted">/</span>
            <span className="text-lg font-semibold text-amber-600 dark:text-amber-400">
              {stats.starredIds.size}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            {stats.starredIds.size > 0 && (
              <button
                type="button"
                onClick={launchStarred}
                className="text-[11px] text-accent hover:underline font-medium"
              >
                {bi('练收藏 →', 'Practice stars →')}
              </button>
            )}
          </div>
        </Card>
      </div>

      {/* Bottom 2-column: 7-day trend & Subjects */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <Card className="lg:col-span-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-ink">{bi('近 7 日练习节律', 'Last 7 Days')}</h3>
              <p className="text-[11px] text-ink-muted">{bi('浅色为作答总量，实色为答对题数', 'Total vs. correct daily volume')}</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('analytics')}
              className="text-xs font-medium text-accent hover:underline inline-flex items-center gap-0.5"
            >
              {bi('深度分析', 'Details')}
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-2 items-end h-36 pt-2">
            {last7Days.map((day) => {
              const totalH = Math.round((day.total / maxDayTotal) * 100);
              const okH = day.total > 0 ? Math.round((day.correct / day.total) * totalH) : 0;
              return (
                <div key={day.label} className="flex flex-col items-center gap-1.5 h-full justify-end">
                  <span className="text-[10px] text-ink-muted tabular-nums">
                    {day.total > 0 ? day.total : ''}
                  </span>
                  <div className="w-full max-w-[28px] h-24 rounded-md bg-surface-muted flex items-end overflow-hidden relative">
                    <div
                      className="w-full bg-accent/25 rounded-t-sm transition-all relative"
                      style={{ height: `${totalH}%` }}
                    >
                      <div
                        className="absolute bottom-0 inset-x-0 bg-accent rounded-t-sm transition-all"
                        style={{ height: totalH > 0 ? `${Math.round((okH / totalH) * 100)}%` : '0%' }}
                      />
                    </div>
                  </div>
                  <span className="text-[10px] text-ink-muted tabular-nums">{day.label}</span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="lg:col-span-7">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-ink">{bi('科目掌握度', 'Subjects')}</h3>
              <p className="text-[11px] text-ink-muted">
                {bi('按自然章节整理，可直接发起单科速练', 'Quick practice per subject')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('library')}
              className="text-xs font-medium text-accent hover:underline inline-flex items-center gap-0.5"
            >
              {bi('管理题库', 'Library')}
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          {stats.subjectTree.length === 0 ? (
            <div className="text-xs text-ink-muted py-8 text-center">
              {bi('暂无科目数据', 'No subjects yet')}
            </div>
          ) : (
            <div className="space-y-2.5 max-h-64 overflow-y-auto custom-scroll pr-1">
              {stats.subjectTree.map((s) => {
                const mastery = s.answered > 0 ? Math.round((s.correct / s.total) * 100) : 0;
                return (
                  <div
                    key={s.sub}
                    className="p-3 rounded-xl border border-line bg-canvas/60 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-ink truncate">{s.sub}</span>
                        {s.due > 0 && (
                          <Badge tone="warning">
                            {bi(`${s.due} 到期`, `${s.due} due`)}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1.5">
                        <div className="flex-1 h-1.5 rounded-full bg-surface-muted overflow-hidden">
                          <div
                            className="h-full bg-accent rounded-full transition-all"
                            style={{ width: `${mastery}%` }}
                          />
                        </div>
                        <span className="text-[11px] text-ink-muted tabular-nums flex-shrink-0">
                          {s.correct}/{s.total} {bi('题已掌握', 'mastered')}
                        </span>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => launchRandom(s.sub)}>
                      {bi('练习', 'Practice')}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
