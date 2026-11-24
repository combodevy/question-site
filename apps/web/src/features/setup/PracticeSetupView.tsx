import React, { useEffect, useMemo, useState } from 'react';
import { CheckSquare, Play, Shuffle, Square } from 'lucide-react';
import type { QuestionType } from '@qs/shared';
import type { LiveStudySnapshot, StudyStats } from '@/sync/hooks';
import { useQuizStore } from '@/store/useQuizStore';
import { useUiStore } from '@/store/useUiStore';
import { useBi } from '@/i18n/useBi';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

interface PracticeSetupViewProps {
  data: LiveStudySnapshot;
  stats: StudyStats;
  onOpenImport: () => void;
}

const SETUP_PREF_KEY = 'qs_v2_setup_prefs';

export const PracticeSetupView: React.FC<PracticeSetupViewProps> = ({
  data,
  stats,
  onOpenImport,
}) => {
  const { bi } = useBi();
  const startSession = useQuizStore((s) => s.startSession);
  const pushToast = useUiStore((s) => s.pushToast);

  const [mode, setMode] = useState<'random' | 'natural' | 'mistakes' | 'starred' | 'review'>('random');
  const [typeFilter, setTypeFilter] = useState<'all' | QuestionType>('all');
  const [limit, setLimit] = useState<'10' | '20' | '50' | 'all'>('20');
  const [selectedChaps, setSelectedChaps] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);

  // Restore saved preferences + initialize all chapters selected by default
  useEffect(() => {
    const allKeys = new Set<string>();
    for (const s of stats.subjectTree) {
      for (const c of s.chapters) allKeys.add(`${s.sub}\u0001${c.chap}`);
    }
    if (!initialized && allKeys.size > 0) {
      try {
        const raw = JSON.parse(localStorage.getItem(SETUP_PREF_KEY) || 'null') as {
          type?: string;
          limit?: string;
          selected?: string[];
        } | null;
        if (raw?.type && ['all', 'mcq', 'multi', 'tf', 'fill'].includes(raw.type)) {
          setTypeFilter(raw.type as 'all' | QuestionType);
        }
        if (raw?.limit && ['10', '20', '50', 'all'].includes(raw.limit)) {
          setLimit(raw.limit as '10' | '20' | '50' | 'all');
        }
        if (Array.isArray(raw?.selected) && raw.selected.length > 0) {
          const valid = new Set(raw.selected.filter((k) => allKeys.has(k)));
          setSelectedChaps(valid.size > 0 ? valid : allKeys);
        } else {
          setSelectedChaps(allKeys);
        }
      } catch {
        setSelectedChaps(allKeys);
      }
      setInitialized(true);
    }
  }, [stats.subjectTree, initialized]);

  const persistPrefs = (nextSelected: Set<string>, nextType = typeFilter, nextLimit = limit) => {
    try {
      localStorage.setItem(
        SETUP_PREF_KEY,
        JSON.stringify({
          type: nextType,
          limit: nextLimit,
          selected: Array.from(nextSelected),
        }),
      );
    } catch {
      // ignore
    }
  };

  const toggleChap = (key: string) => {
    const next = new Set(selectedChaps);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedChaps(next);
    persistPrefs(next);
  };

  const toggleSubject = (sub: string, chaps: Array<{ chap: string }>) => {
    const keys = chaps.map((c) => `${sub}\u0001${c.chap}`);
    const allChecked = keys.every((k) => selectedChaps.has(k));
    const next = new Set(selectedChaps);
    for (const k of keys) {
      if (allChecked) next.delete(k);
      else next.add(k);
    }
    setSelectedChaps(next);
    persistPrefs(next);
  };

  const candidateCount = useMemo(() => {
    let pool = data.questions;
    if (mode === 'mistakes') pool = pool.filter((q) => stats.visibleMistakeIds.has(q.id));
    else if (mode === 'starred') pool = pool.filter((q) => stats.starredIds.has(q.id));
    else if (mode === 'review') {
      const dueSet = new Set(stats.dueQuestionIds);
      pool = pool.filter((q) => dueSet.has(q.id));
    } else if (selectedChaps.size > 0) {
      pool = pool.filter((q) => selectedChaps.has(`${q.sub}\u0001${q.chap}`));
    } else {
      pool = [];
    }
    if (typeFilter !== 'all') pool = pool.filter((q) => q.type === typeFilter);
    return pool.length;
  }, [data.questions, mode, selectedChaps, typeFilter, stats]);

  const launch = (overrideChaps?: string[]) => {
    let pool = [...data.questions];
    if (overrideChaps) {
      const set = new Set(overrideChaps);
      pool = pool.filter((q) => set.has(`${q.sub}\u0001${q.chap}`));
    } else if (mode === 'mistakes') {
      pool = pool.filter((q) => stats.visibleMistakeIds.has(q.id));
    } else if (mode === 'starred') {
      pool = pool.filter((q) => stats.starredIds.has(q.id));
    } else if (mode === 'review') {
      const byId = new Map(pool.map((q) => [q.id, q]));
      pool = stats.dueQuestionIds.map((id) => byId.get(id)).filter((q): q is NonNullable<typeof q> => Boolean(q));
    } else {
      if (selectedChaps.size === 0) {
        pushToast(bi('请至少勾选一个章节', 'Select at least one chapter'), 'warning');
        return;
      }
      pool = pool.filter((q) => selectedChaps.has(`${q.sub}\u0001${q.chap}`));
    }

    if (typeFilter !== 'all') {
      pool = pool.filter((q) => q.type === typeFilter);
    }

    if (!pool.length) {
      pushToast(bi('当前筛选条件下没有符合的题目', 'No questions match the current filters'), 'warning');
      return;
    }

    if (mode !== 'natural' && mode !== 'review') {
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
    }

    const lim = limit === 'all' ? pool.length : Math.min(pool.length, parseInt(limit, 10));
    startSession({
      mode: mode === 'natural' ? 'custom' : mode,
      questions: pool.slice(0, lim),
      title: overrideChaps ? overrideChaps[0].split('\u0001')[1] : undefined,
    });
  };

  if (data.questions.length === 0) {
    return (
      <EmptyState
        icon={<Shuffle className="w-5 h-5" />}
        title={bi('暂无可练习的题目', 'No questions available')}
        description={bi('请先导入题库或手动新建题目后再开始组卷。', 'Import a question bank or add a question first.')}
        action={
          <Button variant="primary" onClick={onOpenImport}>
            {bi('打开导入中心', 'Open Import Center')}
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-ink">
          {bi('刷题配置', 'Configure Session')}
        </h1>
        <p className="text-xs sm:text-sm text-ink-muted mt-0.5">
          {bi('选择练习模式、题型过滤与目标章节', 'Choose mode, question types, and chapters')}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <Card className="lg:col-span-5 space-y-5 lg:sticky lg:top-6">
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-2">
              {bi('练习模式', 'Practice Mode')}
            </label>
            <div className="grid grid-cols-1 gap-1.5">
              {[
                { key: 'random', label: bi('随机抽题（推荐日常）', 'Random Shuffle'), hint: bi('从选中章节随机抽取', 'Shuffle across selected chapters') },
                { key: 'natural', label: bi('顺序通刷', 'Sequential Order'), hint: bi('按章节与题库顺序作答', 'Preserve chapter order') },
                { key: 'review', label: bi(`SM-2 到期复习 (${stats.dueCount})`, `SM-2 Due Review (${stats.dueCount})`), hint: bi('专注今日到期巩固题目', 'Due items ordered by memory curve') },
                { key: 'mistakes', label: bi(`错题攻坚 (${stats.visibleMistakeIds.size})`, `Mistakes Drill (${stats.visibleMistakeIds.size})`), hint: bi('重刷历史答错且未隐藏题目', 'Focus on unmastered wrong items') },
                { key: 'starred', label: bi(`收藏专练 (${stats.starredIds.size})`, `Starred Items (${stats.starredIds.size})`), hint: bi('巩固已加星标的重点题', 'Practice bookmarked items') },
              ].map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setMode(m.key as typeof mode)}
                  className={`text-left px-3.5 py-2.5 rounded-xl border transition-all ${
                    mode === m.key
                      ? 'border-accent bg-accent-soft/60 text-ink'
                      : 'border-line bg-canvas/50 text-ink-muted hover:text-ink'
                  }`}
                >
                  <div className="text-sm font-medium text-ink">{m.label}</div>
                  <div className="text-[11px] text-ink-muted mt-0.5">{m.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1.5">
                {bi('题型过滤', 'Question Type')}
              </label>
              <select
                value={typeFilter}
                onChange={(e) => {
                  const v = e.target.value as 'all' | QuestionType;
                  setTypeFilter(v);
                  persistPrefs(selectedChaps, v, limit);
                }}
                className="w-full h-9 px-2.5 rounded-xl bg-canvas border border-line text-sm text-ink outline-none focus:border-accent"
              >
                <option value="all">{bi('全部题型', 'All Types')}</option>
                <option value="mcq">{bi('单选题', 'Single Choice')}</option>
                <option value="multi">{bi('多选题', 'Multiple Choice')}</option>
                <option value="tf">{bi('判断题', 'True / False')}</option>
                <option value="fill">{bi('填空题', 'Fill in Blank')}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1.5">
                {bi('本组题数', 'Question Limit')}
              </label>
              <select
                value={limit}
                onChange={(e) => {
                  const v = e.target.value as '10' | '20' | '50' | 'all';
                  setLimit(v);
                  persistPrefs(selectedChaps, typeFilter, v);
                }}
                className="w-full h-9 px-2.5 rounded-xl bg-canvas border border-line text-sm text-ink outline-none focus:border-accent"
              >
                <option value="10">10 {bi('题', 'Q')}</option>
                <option value="20">20 {bi('题', 'Q')}</option>
                <option value="50">50 {bi('题', 'Q')}</option>
                <option value="all">{bi('全部', 'All')}</option>
              </select>
            </div>
          </div>

          <div className="pt-2 border-t border-line flex items-center justify-between gap-3">
            <div className="text-xs text-ink-muted tabular-nums">
              {bi(`符合条件 ${candidateCount} 题`, `${candidateCount} matching`)}
            </div>
            <Button
              variant="primary"
              size="lg"
              disabled={candidateCount === 0}
              onClick={() => launch()}
            >
              <Play className="w-4 h-4" />
              {bi('开始练习', 'Start Session')}
            </Button>
          </div>
        </Card>

        <Card className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-ink">{bi('科目与章节范围', 'Subjects & Chapters')}</h3>
              <p className="text-[11px] text-ink-muted">
                {mode === 'random' || mode === 'natural'
                  ? bi('勾选参与本次组卷的章节，也可点击右侧直练单章', 'Select chapters or practice one directly')
                  : bi('当前模式按复习/错题/收藏队列自动筛选', 'Scoped by the selected study mode')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const all = new Set<string>();
                  stats.subjectTree.forEach((s) =>
                    s.chapters.forEach((c) => all.add(`${s.sub}\u0001${c.chap}`)),
                  );
                  setSelectedChaps(all);
                  persistPrefs(all);
                }}
              >
                {bi('全选', 'Select All')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const empty = new Set<string>();
                  setSelectedChaps(empty);
                  persistPrefs(empty);
                }}
              >
                {bi('清空', 'Clear')}
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            {stats.subjectTree.map((s) => {
              const allChecked = s.chapters.every((c) => selectedChaps.has(`${s.sub}\u0001${c.chap}`));
              return (
                <div key={s.sub} className="rounded-xl border border-line bg-canvas/50 p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => toggleSubject(s.sub, s.chapters)}
                      className="flex items-center gap-2 text-sm font-semibold text-ink hover:text-accent transition-colors text-left"
                    >
                      {allChecked ? (
                        <CheckSquare className="w-4 h-4 text-accent flex-shrink-0" />
                      ) : (
                        <Square className="w-4 h-4 text-ink-muted flex-shrink-0" />
                      )}
                      <span className="truncate">{s.sub}</span>
                    </button>
                    <span className="text-xs text-ink-muted tabular-nums">
                      {s.total} {bi('题', 'Q')}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pl-1">
                    {s.chapters.map((c) => {
                      const key = `${s.sub}\u0001${c.chap}`;
                      const checked = selectedChaps.has(key);
                      return (
                        <div
                          key={key}
                          className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border text-xs transition-colors ${
                            checked
                              ? 'border-accent/40 bg-surface'
                              : 'border-line bg-surface/50 opacity-75'
                          }`}
                        >
                          <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleChap(key)}
                              className="accent-[var(--accent)] w-3.5 h-3.5 flex-shrink-0"
                            />
                            <span className="truncate text-ink">{c.chap}</span>
                          </label>
                          <span className="text-[11px] text-ink-muted tabular-nums flex-shrink-0">
                            {c.total}
                          </span>
                          <button
                            type="button"
                            onClick={() => launch([key])}
                            className="px-1.5 py-0.5 rounded bg-accent-soft text-accent text-[11px] font-medium hover:bg-accent hover:text-accent-fg transition-colors flex-shrink-0"
                          >
                            {bi('直练', 'Go')}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
};
