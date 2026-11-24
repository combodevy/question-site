import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Brain,
  Check,
  CheckSquare,
  ListOrdered,
  Play,
  RefreshCw,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Square,
  Star,
} from 'lucide-react';
import type { QuestionType } from '@qs/shared';
import type { LiveStudySnapshot, StudyStats } from '@/sync/hooks';
import { useAuthStore } from '@/store/useAuthStore';
import { useQuizStore } from '@/store/useQuizStore';
import { useUiStore } from '@/store/useUiStore';
import { useBi } from '@/i18n/useBi';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';

interface PracticeSetupViewProps {
  data: LiveStudySnapshot;
  stats: StudyStats;
  onOpenImport: () => void;
}

type SetupMode = 'random' | 'natural' | 'review' | 'mistakes' | 'starred';
type SetupLimit = '10' | '20' | '50' | 'all';

interface StoredSetupPrefs {
  mode?: SetupMode;
  type?: 'all' | QuestionType;
  limit?: SetupLimit;
  checked?: string[];
  seen?: string[];
}

export const PracticeSetupView: React.FC<PracticeSetupViewProps> = ({
  data,
  stats,
  onOpenImport,
}) => {
  const { bi } = useBi();
  const user = useAuthStore((s) => s.user);
  const startSession = useQuizStore((s) => s.startSession);
  const { pushToast, defaultLimit } = useUiStore();

  const prefKey = `qs_v2_setup_prefs_${user?.id || 'anon'}`;

  const [mode, setMode] = useState<SetupMode>('random');
  const [typeFilter, setTypeFilter] = useState<'all' | QuestionType>('all');
  const [limit, setLimit] = useState<SetupLimit>(defaultLimit);
  const [selectedChaps, setSelectedChaps] = useState<Set<string>>(new Set());
  const [seenChaps, setSeenChaps] = useState<Set<string>>(new Set());
  const [initializedForUser, setInitializedForUser] = useState<string | null>(null);

  const persistPrefs = (
    nextSelected: Set<string>,
    nextSeen: Set<string>,
    nextMode: SetupMode = mode,
    nextType: 'all' | QuestionType = typeFilter,
    nextLimit: SetupLimit = limit,
  ) => {
    try {
      const payload: StoredSetupPrefs = {
        mode: nextMode,
        type: nextType,
        limit: nextLimit,
        checked: Array.from(nextSelected),
        seen: Array.from(nextSeen),
      };
      localStorage.setItem(prefKey, JSON.stringify(payload));
    } catch {
      // ignore
    }
  };

  // Restore saved preferences + track seen vs new chapters cleanly
  useEffect(() => {
    const allKeys = new Set<string>();
    for (const s of stats.subjectTree) {
      for (const c of s.chapters) allKeys.add(`${s.sub}\u0001${c.chap}`);
    }
    if (allKeys.size === 0) return;

    const uidTag = user?.id || 'anon';
    if (initializedForUser !== uidTag) {
      let nextMode: SetupMode = 'random';
      let nextType: 'all' | QuestionType = 'all';
      let nextLimit: SetupLimit = defaultLimit;
      let nextChecked = new Set<string>(allKeys);
      let nextSeen = new Set<string>(allKeys);

      try {
        const raw = JSON.parse(localStorage.getItem(prefKey) || 'null') as StoredSetupPrefs | null;
        if (raw) {
          if (raw.mode && ['random', 'natural', 'review', 'mistakes', 'starred'].includes(raw.mode)) {
            nextMode = raw.mode;
          }
          if (raw.type && ['all', 'mcq', 'multi', 'tf', 'fill'].includes(raw.type)) {
            nextType = raw.type;
          }
          if (raw.limit && ['10', '20', '50', 'all'].includes(raw.limit)) {
            nextLimit = raw.limit;
          }
          if (Array.isArray(raw.checked)) {
            const savedChecked = new Set(raw.checked);
            const savedSeen = new Set(Array.isArray(raw.seen) ? raw.seen : raw.checked);
            nextChecked = new Set<string>();
            for (const k of allKeys) {
              // Newly discovered chapter not previously seen -> default checked; otherwise honor saved state
              if (!savedSeen.has(k) || savedChecked.has(k)) {
                nextChecked.add(k);
              }
            }
            nextSeen = new Set([...savedSeen, ...allKeys]);
          }
        }
      } catch {
        // fallback defaults
      }

      setMode(nextMode);
      setTypeFilter(nextType);
      setLimit(nextLimit);
      setSelectedChaps(nextChecked);
      setSeenChaps(nextSeen);
      setInitializedForUser(uidTag);
      persistPrefs(nextChecked, nextSeen, nextMode, nextType, nextLimit);
      return;
    }

    // If new chapters appear live while mounted, auto-check newly unseen chapters
    const unseenNew: string[] = [];
    for (const k of allKeys) {
      if (!seenChaps.has(k)) unseenNew.push(k);
    }
    if (unseenNew.length > 0) {
      const nextChecked = new Set(selectedChaps);
      const nextSeen = new Set(seenChaps);
      for (const k of unseenNew) {
        nextChecked.add(k);
        nextSeen.add(k);
      }
      setSelectedChaps(nextChecked);
      setSeenChaps(nextSeen);
      persistPrefs(nextChecked, nextSeen);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats.subjectTree, user?.id, initializedForUser]);

  const updateChecked = (nextSelected: Set<string>) => {
    setSelectedChaps(nextSelected);
    persistPrefs(nextSelected, seenChaps);
  };

  const toggleChap = (key: string) => {
    const next = new Set(selectedChaps);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    updateChecked(next);
  };

  const toggleSubject = (sub: string, chaps: Array<{ chap: string }>) => {
    const keys = chaps.map((c) => `${sub}\u0001${c.chap}`);
    const allChecked = keys.every((k) => selectedChaps.has(k));
    const next = new Set(selectedChaps);
    for (const k of keys) {
      if (allChecked) next.delete(k);
      else next.add(k);
    }
    updateChecked(next);
  };

  const selectOnlySubject = (sub: string, chaps: Array<{ chap: string }>) => {
    const next = new Set(chaps.map((c) => `${sub}\u0001${c.chap}`));
    updateChecked(next);
    if (mode !== 'random' && mode !== 'natural') {
      setMode('random');
      persistPrefs(next, seenChaps, 'random', typeFilter, limit);
    }
    pushToast(bi(`已切换为仅练习 ${sub}`, `Scoped to ${sub}`), 'info');
  };

  const selectOnlyChapter = (key: string, chapName: string) => {
    const next = new Set([key]);
    updateChecked(next);
    if (mode !== 'random' && mode !== 'natural') {
      setMode('random');
      persistPrefs(next, seenChaps, 'random', typeFilter, limit);
    }
    pushToast(bi(`已选中：${chapName}`, `Selected: ${chapName}`), 'info');
  };

  const invertAllChapters = () => {
    const next = new Set<string>();
    for (const s of stats.subjectTree) {
      for (const c of s.chapters) {
        const k = `${s.sub}\u0001${c.chap}`;
        if (!selectedChaps.has(k)) next.add(k);
      }
    }
    updateChecked(next);
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

  const launch = (overrideChaps?: string[], overrideTitle?: string) => {
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
      pool = stats.dueQuestionIds
        .map((id) => byId.get(id))
        .filter((q): q is NonNullable<typeof q> => Boolean(q));
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
      title: overrideTitle || (overrideChaps ? overrideChaps[0].split('\u0001')[1] : undefined),
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

  const modeCards: Array<{
    key: SetupMode;
    label: string;
    hint: string;
    badge?: number | string;
    badgeTone?: 'accent' | 'warning' | 'danger' | 'neutral';
    icon: React.ReactNode;
    iconTone: string;
    spanFull?: boolean;
  }> = [
    {
      key: 'random',
      label: bi('随机抽题', 'Random Shuffle'),
      hint: bi('打乱所选章节题序', 'Shuffle selected scope'),
      icon: <Shuffle className="w-4 h-4" />,
      iconTone: 'bg-accent-soft text-accent',
      badge: bi('推荐', 'Pick'),
      badgeTone: 'accent',
    },
    {
      key: 'natural',
      label: bi('顺序通刷', 'Sequential Order'),
      hint: bi('按自然章节顺序作答', 'Original chapter order'),
      icon: <ListOrdered className="w-4 h-4" />,
      iconTone: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
    },
    {
      key: 'review',
      label: bi('SM-2 复习', 'SM-2 Review'),
      hint: bi('按遗忘曲线到期巩固', 'Due retention queue'),
      icon: <Brain className="w-4 h-4" />,
      iconTone: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
      badge: stats.dueCount,
      badgeTone: stats.dueCount > 0 ? 'warning' : 'neutral',
    },
    {
      key: 'mistakes',
      label: bi('错题攻坚', 'Mistakes'),
      hint: bi('重刷历史错题记录', 'Retry missed items'),
      icon: <AlertCircle className="w-4 h-4" />,
      iconTone: 'bg-red-500/15 text-red-600 dark:text-red-400',
      badge: stats.visibleMistakeIds.size,
      badgeTone: stats.visibleMistakeIds.size > 0 ? 'danger' : 'neutral',
    },
    {
      key: 'starred',
      label: bi('收藏专练', 'Starred Bookmarks'),
      hint: bi('集中巩固已加星标的重点题目', 'Practice all starred bookmarks'),
      icon: <Star className="w-4 h-4" />,
      iconTone: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
      badge: stats.starredIds.size,
      badgeTone: 'neutral',
      spanFull: true,
    },
  ];

  const isChapterScoped = mode === 'random' || mode === 'natural';

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-accent-soft text-accent inline-flex items-center justify-center">
            <SlidersHorizontal className="w-4 h-4" />
          </span>
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-ink">
              {bi('刷题配置', 'Configure Session')}
            </h1>
            <p className="text-xs sm:text-sm text-ink-muted mt-0.5">
              {bi('勾选条件自动记忆，下次打开自动延续上次配置', 'Your mode, filters, and chapter scope are remembered automatically')}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <Card className="lg:col-span-5 space-y-5 lg:sticky lg:top-6">
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <label className="text-xs font-semibold text-ink flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-accent" />
                {bi('选择练习模式', 'Practice Mode')}
              </label>
              <span className="text-[11px] text-ink-muted">{bi('点击切换卡片', 'Pick one')}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5" data-testid="setup-mode-grid">
              {modeCards.map((m) => {
                const selected = mode === m.key;
                return (
                  <button
                    key={m.key}
                    type="button"
                    data-mode={m.key}
                    data-selected={selected ? 'true' : 'false'}
                    onClick={() => {
                      setMode(m.key);
                      persistPrefs(selectedChaps, seenChaps, m.key, typeFilter, limit);
                    }}
                    className={`group relative text-left p-3 rounded-2xl border transition-all flex items-start gap-2.5 ${
                      m.spanFull ? 'sm:col-span-2' : ''
                    } ${
                      selected
                        ? 'border-accent bg-accent-soft/50 shadow-sm ring-1 ring-accent/25'
                        : 'border-line bg-canvas/70 hover:bg-canvas hover:border-ink-muted/35'
                    }`}
                  >
                    <span
                      className={`w-9 h-9 rounded-xl inline-flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-105 ${m.iconTone}`}
                    >
                      {m.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="text-xs sm:text-sm font-semibold text-ink truncate">
                          {m.label}
                        </span>
                        {m.badge !== undefined && (
                          <Badge tone={m.badgeTone || 'neutral'}>{m.badge}</Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-ink-muted mt-0.5 line-clamp-1">{m.hint}</div>
                    </div>
                    {selected && (
                      <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-accent text-accent-fg flex items-center justify-center shadow-sm">
                        <Check className="w-2.5 h-2.5 stroke-[3]" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1.5">
                {bi('题型过滤', 'Question Type')}
              </label>
              <select
                value={typeFilter}
                onChange={(e) => {
                  const v = e.target.value as 'all' | QuestionType;
                  setTypeFilter(v);
                  persistPrefs(selectedChaps, seenChaps, mode, v, limit);
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
                  const v = e.target.value as SetupLimit;
                  setLimit(v);
                  persistPrefs(selectedChaps, seenChaps, mode, typeFilter, v);
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

          <div className="pt-3 border-t border-line flex items-center justify-between gap-3">
            <div>
              <div className="text-xs text-ink-muted tabular-nums">
                {bi(`符合条件 ${candidateCount} 题`, `${candidateCount} matching`)}
              </div>
              {isChapterScoped && (
                <div className="text-[11px] text-ink-muted tabular-nums">
                  {bi(`已选 ${selectedChaps.size} 个章节`, `${selectedChaps.size} chapters checked`)}
                </div>
              )}
            </div>
            <Button
              variant="primary"
              size="lg"
              disabled={candidateCount === 0}
              onClick={() => launch()}
              data-testid="setup-start-btn"
            >
              <Play className="w-4 h-4" />
              {bi('开始练习', 'Start Session')}
            </Button>
          </div>
        </Card>

        <Card className="lg:col-span-7 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-start gap-2">
              <span className="w-7 h-7 rounded-lg bg-accent-soft text-accent inline-flex items-center justify-center mt-0.5">
                <BookOpen className="w-3.5 h-3.5" />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-ink">{bi('科目与章节范围', 'Subjects & Chapters')}</h3>
                <p className="text-[11px] text-ink-muted">
                  {isChapterScoped
                    ? bi('勾选状态会自动保存；可点击“仅此科/仅此章”或右侧“直练”', 'Selections auto-save; use Focus or Go for instant drill')
                    : bi('当前模式按复习/错题/收藏队列自动筛选', 'Scoped by the selected study mode')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const all = new Set<string>();
                  stats.subjectTree.forEach((s) =>
                    s.chapters.forEach((c) => all.add(`${s.sub}\u0001${c.chap}`)),
                  );
                  updateChecked(all);
                }}
              >
                <CheckSquare className="w-3.5 h-3.5" />
                {bi('全选', 'All')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => invertAllChapters()}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {bi('反选', 'Invert')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => updateChecked(new Set())}
              >
                <Square className="w-3.5 h-3.5" />
                {bi('清空', 'Clear')}
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            {stats.subjectTree.map((s) => {
              const keys = s.chapters.map((c) => `${s.sub}\u0001${c.chap}`);
              const checkedCount = keys.filter((k) => selectedChaps.has(k)).length;
              const allChecked = keys.length > 0 && checkedCount === keys.length;
              return (
                <div key={s.sub} className="rounded-xl border border-line bg-canvas/50 p-3.5 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => toggleSubject(s.sub, s.chapters)}
                      className="flex items-center gap-2 text-sm font-semibold text-ink hover:text-accent transition-colors text-left min-w-0"
                    >
                      {allChecked ? (
                        <CheckSquare className="w-4 h-4 text-accent flex-shrink-0" />
                      ) : (
                        <Square className="w-4 h-4 text-ink-muted flex-shrink-0" />
                      )}
                      <span className="truncate">{s.sub}</span>
                    </button>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[11px] text-ink-muted tabular-nums">
                        {checkedCount}/{s.chapters.length} {bi('章', 'ch')} ({s.total} {bi('题', 'Q')})
                      </span>
                      <button
                        type="button"
                        onClick={() => selectOnlySubject(s.sub, s.chapters)}
                        className="px-2 py-0.5 rounded-md border border-line bg-surface text-[11px] font-medium text-ink-muted hover:text-ink hover:border-accent/50 transition-colors"
                      >
                        {bi('仅此科', 'Only')}
                      </button>
                      <button
                        type="button"
                        onClick={() => launch(keys, s.sub)}
                        className="px-2 py-0.5 rounded-md bg-accent-soft text-accent text-[11px] font-medium hover:bg-accent hover:text-accent-fg transition-colors inline-flex items-center gap-1"
                      >
                        <Play className="w-2.5 h-2.5" />
                        {bi('直练', 'Go')}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pl-1">
                    {s.chapters.map((c) => {
                      const key = `${s.sub}\u0001${c.chap}`;
                      const checked = selectedChaps.has(key);
                      return (
                        <div
                          key={key}
                          className={`flex items-center justify-between gap-1.5 px-2.5 py-2 rounded-lg border text-xs transition-colors ${
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
                            onClick={() => selectOnlyChapter(key, c.chap)}
                            className="px-1.5 py-0.5 rounded text-[11px] text-ink-muted hover:text-ink hover:bg-surface-muted transition-colors flex-shrink-0"
                            title={bi('仅选中此章', 'Select only this chapter')}
                          >
                            {bi('仅此章', 'Only')}
                          </button>
                          <button
                            type="button"
                            onClick={() => launch([key], c.chap)}
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
