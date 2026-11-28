import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpDown,
  CheckSquare,
  ChevronDown,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FolderCog,
  FolderInput,
  FolderPlus,
  History,
  Library as LibraryIcon,
  MoreHorizontal,
  Play,
  Plus,
  RotateCcw,
  Search,
  Square,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { parseFillBlanks, type Question, type QuestionType } from '@qs/shared';
import type { LocalQuestion } from '@/db';
import type { LiveStudySnapshot, StudyStats } from '@/sync/hooks';
import { useAnimatedPresence } from '@/hooks/useAnimatedPresence';
import { getSyncEngine } from '@/sync/engine';
import { useAuthStore } from '@/store/useAuthStore';
import { useQuizStore } from '@/store/useQuizStore';
import { useUiStore } from '@/store/useUiStore';
import { useBi } from '@/i18n/useBi';
import { matchesSearchQuery, naturalCompare } from '@/lib/text';
import {
  computeQuestionPerfMap,
  isErrorRateSort,
  sortQuestions,
  type LibrarySortKey,
} from '@/lib/libraryUtils';
import { exportBankJson } from '@/lib/parsers';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { MediaContent } from '@/components/ui/MediaContent';
import { HighlightedText } from '@/components/ui/HighlightedText';
import { Modal } from '@/components/ui/Modal';

type LibraryTab = 'all' | 'mistakes' | 'starred' | 'trash';

interface LibraryViewProps {
  data: LiveStudySnapshot;
  stats: StudyStats;
  jumpFilter?: { sub: string; chap: string; nonce: number } | null;
  onEditQuestion: (q: LocalQuestion | null, presetSub?: string, presetChap?: string) => void;
  onInspectQuestion: (q: LocalQuestion) => void;
  onOpenImport: () => void;
  onOpenBankManager: () => void;
  onOpenPrintExport: () => void;
}

const INITIAL_BATCH = 30;
const BATCH_STEP = 30;

interface StoredLibraryPrefs {
  tab?: LibraryTab;
  sub?: string;
  chap?: string;
  type?: 'all' | QuestionType;
  sort?: LibrarySortKey;
  showAllAnswers?: boolean;
}

const VALID_SORTS: LibrarySortKey[] = [
  'default',
  'err_rate_desc',
  'err_rate_asc',
  'err_count_desc',
  'alpha_asc',
  'alpha_desc',
  'attempts_desc',
  'attempts_asc',
  'ans_asc',
  'updated_desc',
  'sm2_due',
];

function readLibraryPrefs(key: string): StoredLibraryPrefs {
  try {
    return (JSON.parse(localStorage.getItem(key) || 'null') as StoredLibraryPrefs | null) || {};
  } catch {
    return {};
  }
}

export const LibraryView: React.FC<LibraryViewProps> = ({
  data,
  stats,
  jumpFilter,
  onEditQuestion,
  onInspectQuestion,
  onOpenImport,
  onOpenBankManager,
  onOpenPrintExport,
}) => {
  const { bi } = useBi();
  const user = useAuthStore((s) => s.user);
  const { confirm, prompt, pushToast } = useUiStore();
  const startSession = useQuizStore((s) => s.startSession);

  const prefKey = `qs_v2_library_prefs_${user?.id || 'anon'}`;
  const initialPrefs = useMemo(() => readLibraryPrefs(prefKey), [prefKey]);

  const [tab, setTab] = useState<LibraryTab>(
    initialPrefs.tab && ['all', 'mistakes', 'starred', 'trash'].includes(initialPrefs.tab)
      ? initialPrefs.tab
      : 'all',
  );
  const [subFilter, setSubFilter] = useState(jumpFilter?.sub || initialPrefs.sub || 'all');
  const [chapFilter, setChapFilter] = useState(jumpFilter?.chap || initialPrefs.chap || 'all');
  const [typeFilter, setTypeFilter] = useState<'all' | QuestionType>(
    initialPrefs.type && ['all', 'mcq', 'multi', 'tf', 'fill', 'qa'].includes(initialPrefs.type)
      ? initialPrefs.type
      : 'all',
  );
  const [sortBy, setSortBy] = useState<LibrarySortKey>(
    initialPrefs.sort && VALID_SORTS.includes(initialPrefs.sort) ? initialPrefs.sort : 'default',
  );
  const [showAllAnswers, setShowAllAnswers] = useState<boolean>(
    typeof initialPrefs.showAllAnswers === 'boolean' ? initialPrefs.showAllAnswers : true,
  );
  const [cardAnswerOverrides, setCardAnswerOverrides] = useState<Map<string, boolean>>(new Map());

  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(INITIAL_BATCH);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const [moreOpen, setMoreOpen] = useState(false);
  const { mounted: moreMounted, phase: morePhase } = useAnimatedPresence(moreOpen, 150);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);

  // Multi-select & Batch move modal
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveSub, setMoveSub] = useState('');
  const [moveChap, setMoveChap] = useState('');
  const [keepOriginalChap, setKeepOriginalChap] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);

  // Close More dropdown on outside click or Escape
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

  // Sync external jumps from BankManagerModal
  useEffect(() => {
    if (!jumpFilter) return;
    setTab('all');
    setSubFilter(jumpFilter.sub || 'all');
    setChapFilter(jumpFilter.chap || 'all');
    setVisibleCount(INITIAL_BATCH);
    setSelectedIds(new Set());
  }, [jumpFilter?.nonce, jumpFilter]);

  // Reset rendered window whenever active filter criteria change
  useEffect(() => {
    setVisibleCount(INITIAL_BATCH);
  }, [tab, subFilter, chapFilter, typeFilter, query, sortBy]);

  // Persist library preferences whenever filter/sort/showAllAnswers changes
  useEffect(() => {
    try {
      const payload: StoredLibraryPrefs = {
        tab,
        sub: subFilter,
        chap: chapFilter,
        type: typeFilter,
        sort: sortBy,
        showAllAnswers,
      };
      localStorage.setItem(prefKey, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [prefKey, tab, subFilter, chapFilter, typeFilter, sortBy, showAllAnswers]);

  const subjects = useMemo(() => stats.subjectTree.map((s) => s.sub), [stats.subjectTree]);

  useEffect(() => {
    if (stats.subjectTree.length === 0) return;
    if (subFilter !== 'all' && !subjects.includes(subFilter)) {
      setSubFilter('all');
      setChapFilter('all');
    }
  }, [subjects, subFilter, stats.subjectTree.length]);

  const chapters = useMemo(() => {
    if (subFilter === 'all') {
      const set = new Set<string>();
      stats.subjectTree.forEach((s) => s.chapters.forEach((c) => set.add(c.chap)));
      return Array.from(set).sort(naturalCompare);
    }
    return stats.subjectTree.find((s) => s.sub === subFilter)?.chapters.map((c) => c.chap) || [];
  }, [stats.subjectTree, subFilter]);

  const perfMap = useMemo(() => computeQuestionPerfMap(data.history), [data.history]);

  const hiddenMistakeCount = useMemo(() => {
    let n = 0;
    for (const id of stats.wrongIds) {
      if (data.flagsMap.get(id)?.mistakeHidden) n++;
    }
    return n;
  }, [stats.wrongIds, data.flagsMap]);

  const baseList = useMemo(() => {
    if (tab === 'trash') return data.trashQuestions;
    if (tab === 'mistakes') return data.questions.filter((q) => stats.visibleMistakeIds.has(q.id));
    if (tab === 'starred') return data.questions.filter((q) => stats.starredIds.has(q.id));
    return data.questions;
  }, [tab, data.questions, data.trashQuestions, stats]);

  const filteredList = useMemo(() => {
    const qLower = query.trim();
    const matched = baseList.filter((item) => {
      if (subFilter !== 'all' && item.sub !== subFilter) return false;
      if (chapFilter !== 'all' && item.chap !== chapFilter) return false;
      if (typeFilter !== 'all' && item.type !== typeFilter) return false;
      if (qLower) {
        const hay = `${item.q}\n${item.o.join('\n')}\n${item.a}\n${item.d}\n${item.sub}\n${item.chap}`;
        if (!matchesSearchQuery(hay, qLower)) return false;
      }
      return true;
    });
    return sortQuestions(matched, sortBy, perfMap);
  }, [baseList, subFilter, chapFilter, typeFilter, query, sortBy, perfMap]);

  const visibleItems = useMemo(
    () => filteredList.slice(0, visibleCount),
    [filteredList, visibleCount],
  );

  // Infinite scroll observer on bottom sentinel
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || visibleCount >= filteredList.length) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((prev) => Math.min(filteredList.length, prev + BATCH_STEP));
        }
      },
      { rootMargin: '280px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visibleCount, filteredList.length]);

  // Drop stale selections whenever filtered set changes
  useEffect(() => {
    const validSet = new Set(filteredList.map((q) => q.id));
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (validSet.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [filteredList]);

  const isCardRevealed = (id: string) =>
    cardAnswerOverrides.has(id) ? Boolean(cardAnswerOverrides.get(id)) : showAllAnswers;

  const toggleCardReveal = (id: string) => {
    setCardAnswerOverrides((prev) => {
      const next = new Map(prev);
      const curr = next.has(id) ? Boolean(next.get(id)) : showAllAnswers;
      next.set(id, !curr);
      return next;
    });
  };

  const toggleShowAllAnswers = () => {
    setShowAllAnswers((v) => !v);
    setCardAnswerOverrides(new Map());
  };

  const handleCardSurfaceClick = (e: React.MouseEvent<HTMLDivElement>, id: string) => {
    const sel = window.getSelection?.()?.toString() || '';
    if (sel.length > 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, a, input, select, textarea, label, img, [data-no-card-toggle="true"]')) {
      return;
    }
    toggleCardReveal(id);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    if (filteredList.length === 0) return;
    const allSelected = selectedIds.size === filteredList.length;
    setSelectedIds(allSelected ? new Set() : new Set(filteredList.map((q) => q.id)));
  };

  const invertVisibleSelection = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const q of visibleItems) {
        if (next.has(q.id)) next.delete(q.id);
        else next.add(q.id);
      }
      return next;
    });
  };

  const hasActiveFilter =
    subFilter !== 'all' || chapFilter !== 'all' || typeFilter !== 'all' || query.trim() !== '';

  const resetFilters = () => {
    setQuery('');
    setSubFilter('all');
    setChapFilter('all');
    setTypeFilter('all');
    setVisibleCount(INITIAL_BATCH);
  };

  const selectedQuestions = useMemo(
    () => filteredList.filter((q) => selectedIds.has(q.id)),
    [filteredList, selectedIds],
  );

  const openBatchMoveModal = () => {
    if (selectedQuestions.length === 0) return;
    const first = selectedQuestions[0];
    setMoveSub(subFilter !== 'all' ? subFilter : first.sub || subjects[0] || '');
    setMoveChap(chapFilter !== 'all' ? chapFilter : first.chap || '');
    setKeepOriginalChap(false);
    setMoveOpen(true);
  };

  const handleConfirmBatchMove = async () => {
    const targetSub = moveSub.trim();
    const targetChap = moveChap.trim();
    if (!targetSub) {
      pushToast(bi('请填写或选择目标科目', 'Target subject is required'), 'warning');
      return;
    }
    if (!keepOriginalChap && !targetChap) {
      pushToast(bi('请填写目标章节（或勾选保留原章节名）', 'Target chapter is required'), 'warning');
      return;
    }
    const engine = getSyncEngine();
    if (!engine || selectedQuestions.length === 0) return;

    setBatchBusy(true);
    try {
      const now = Date.now();
      const updated: Question[] = selectedQuestions.map((q) => ({
        id: q.id,
        type: q.type,
        q: q.q,
        o: q.o,
        a: q.a,
        sub: targetSub,
        chap: keepOriginalChap ? q.chap : targetChap,
        d: q.d,
        ...(q.media ? { media: q.media } : {}),
        ...(q.psg ? { psg: q.psg } : {}),
        ...(typeof q.selfCheck === 'boolean' ? { selfCheck: q.selfCheck } : {}),
        _editedAt: now,
      }));
      await engine.upsertQuestions(updated, true);
      pushToast(
        bi(`已将 ${updated.length} 题移动至 ${targetSub}`, `Moved ${updated.length} items to ${targetSub}`),
        'success',
      );
      setMoveOpen(false);
      setSelectedIds(new Set());
    } finally {
      setBatchBusy(false);
    }
  };

  const handleBatchDelete = async () => {
    if (selectedQuestions.length === 0) return;
    const count = selectedQuestions.length;
    const ok = await confirm({
      title: bi('批量删除题目', 'Batch Trash Questions'),
      message: bi(
        `确定将选中的 ${count} 道题目移入回收站吗？`,
        `Move ${count} selected questions to Trash?`,
      ),
      danger: true,
    });
    if (!ok) return;
    await getSyncEngine()?.softDeleteQuestions(
      selectedQuestions.map((q) => q.id),
      'batch-delete',
    );
    setSelectedIds(new Set());
    pushToast(bi(`已将 ${count} 题移入回收站`, `Moved ${count} items to Trash`), 'info');
  };

  const handleBatchStar = async (starred: boolean) => {
    const engine = getSyncEngine();
    if (!engine || selectedQuestions.length === 0) return;
    for (const q of selectedQuestions) {
      await engine.setFlag(q.id, { starred });
    }
    pushToast(
      starred
        ? bi(`已收藏 ${selectedQuestions.length} 道题目`, `Starred ${selectedQuestions.length} questions`)
        : bi(`已取消收藏 ${selectedQuestions.length} 道题目`, `Unstarred ${selectedQuestions.length} questions`),
      'success',
    );
  };

  const handleBatchTrashRestore = async () => {
    const engine = getSyncEngine();
    if (!engine || selectedQuestions.length === 0) return;
    const count = selectedQuestions.length;
    for (const q of selectedQuestions) {
      await engine.restoreQuestion(q.id);
    }
    setSelectedIds(new Set());
    pushToast(bi(`已恢复 ${count} 道题目`, `Restored ${count} questions`), 'success');
  };

  const handleBatchTrashPurge = async () => {
    const engine = getSyncEngine();
    if (!engine || selectedQuestions.length === 0) return;
    const count = selectedQuestions.length;
    const ok = await confirm({
      title: bi('批量彻底删除', 'Batch Purge Permanently'),
      message: bi(
        `确认永久彻底删除选中的 ${count} 道回收站题目吗？此操作不可撤销！`,
        `Permanently destroy ${count} selected questions? Cannot be undone!`,
      ),
      danger: true,
    });
    if (!ok) return;
    for (const q of selectedQuestions) {
      await engine.destroyQuestion(q.id);
    }
    setSelectedIds(new Set());
    pushToast(bi(`已彻底删除 ${count} 道题目`, `Purged ${count} questions`), 'info');
  };

  const handleCreateNewSubject = async () => {
    const newSub = await prompt({
      title: bi('新增科目', 'Create New Subject'),
      message: bi('输入新科目名称后将打开录题窗以添加首题：', 'Enter new subject name (opens editor to add first question):'),
      placeholder: bi('例如：宏观经济学', 'e.g. Macroeconomics'),
    });
    if (!newSub || !newSub.trim()) return;
    const newChap = await prompt({
      title: bi('初始章节名称', 'Initial Chapter Name'),
      message: bi(`输入科目 "${newSub.trim()}" 的首个章节名称：`, `First chapter name for "${newSub.trim()}":`),
      defaultValue: bi('第一章', 'Chapter 1'),
    });
    if (!newChap || !newChap.trim()) return;
    onEditQuestion(null, newSub.trim(), newChap.trim());
  };

  const handleEmptyTrash = async () => {
    const ok = await confirm({
      title: bi('清空回收站', 'Empty Trash'),
      message: bi(
        `确定彻底删除回收站内的 ${data.trashQuestions.length} 道题目吗？此操作不可撤销。`,
        `Permanently purge ${data.trashQuestions.length} trashed questions? Cannot be undone.`,
      ),
      danger: true,
    });
    if (!ok) return;
    await getSyncEngine()?.emptyTrash();
    setSelectedIds(new Set());
    pushToast(bi('回收站已清空', 'Trash emptied'), 'info');
  };

  const showErrRate = isErrorRateSort(sortBy);

  const moveSubjectChapters = useMemo(() => {
    const s = stats.subjectTree.find((item) => item.sub === moveSub.trim());
    return s ? s.chapters.map((c) => c.chap) : [];
  }, [stats.subjectTree, moveSub]);

  const typeLabel: Record<string, string> = {
    mcq: bi('单选', 'MCQ'),
    multi: bi('多选', 'Multi'),
    tf: bi('判断', 'T/F'),
    fill: bi('填空', 'Fill'),
    qa: bi('问答', 'Q&A'),
  };

  const allFilteredSelected =
    filteredList.length > 0 && selectedIds.size === filteredList.length;

  return (
    <div className="space-y-4">
      {/* Clean 3-Action Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-accent-soft text-accent inline-flex items-center justify-center">
            <LibraryIcon className="w-4 h-4" />
          </span>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-ink">
            {bi('题库管理', 'Question Library')}
          </h1>
          <span className="px-2 py-0.5 rounded-full bg-surface-muted border border-line text-xs font-medium text-ink-muted tabular-nums">
            {bi(`${data.questions.length} 题`, `${data.questions.length}`)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative" ref={moreMenuRef}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMoreOpen((v) => !v)}
              data-testid="lib-more-menu-btn"
            >
              <MoreHorizontal className="w-4 h-4" />
              <span>{bi('更多', 'More')}</span>
              <ChevronDown className={`w-3.5 h-3.5 text-ink-muted transition-transform duration-150 ${moreOpen ? 'rotate-180' : ''}`} />
            </Button>

            {moreMounted && (
              <div
                data-testid="lib-more-menu"
                className={`absolute right-0 mt-1.5 w-44 rounded-xl bg-surface border border-line shadow-lg py-1 z-30 ${
                  morePhase === 'exit' ? 'anim-dropdown-out pointer-events-none' : 'anim-dropdown-in'
                }`}
              >
                <button
                  type="button"
                  data-testid="lib-new-subject-btn"
                  onClick={() => {
                    setMoreOpen(false);
                    void handleCreateNewSubject();
                  }}
                  className="w-full px-3 py-2 text-left text-xs font-medium text-ink hover:bg-surface-muted flex items-center gap-2 transition-colors"
                >
                  <FolderPlus className="w-3.5 h-3.5 text-accent" />
                  {bi('新增科目', 'New Subject')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    onOpenBankManager();
                  }}
                  className="w-full px-3 py-2 text-left text-xs font-medium text-ink hover:bg-surface-muted flex items-center gap-2 transition-colors"
                >
                  <FolderCog className="w-3.5 h-3.5 text-ink-muted" />
                  {bi('章节管理', 'Structure')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    onOpenPrintExport();
                  }}
                  className="w-full px-3 py-2 text-left text-xs font-medium text-ink hover:bg-surface-muted flex items-center gap-2 transition-colors"
                >
                  <Download className="w-3.5 h-3.5 text-ink-muted" />
                  {bi('导出 / 打印', 'Export & Print')}
                </button>
              </div>
            )}
          </div>

          <Button variant="outline" size="sm" onClick={onOpenImport}>
            <Upload className="w-3.5 h-3.5" />
            {bi('导入', 'Import')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              onEditQuestion(
                null,
                subFilter !== 'all' ? subFilter : '',
                chapFilter !== 'all' ? chapFilter : '',
              )
            }
          >
            <Plus className="w-3.5 h-3.5" />
            {bi('新增题目', 'New Question')}
          </Button>
        </div>
      </div>

      {/* Tabs & Secondary View Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="inline-flex p-1 rounded-xl bg-surface-muted/80 border border-line">
          {(
            [
              { key: 'all', label: bi('全部', 'All'), count: data.questions.length },
              { key: 'mistakes', label: bi('错题本', 'Mistakes'), count: stats.visibleMistakeIds.size },
              { key: 'starred', label: bi('收藏夹', 'Starred'), count: stats.starredIds.size },
              { key: 'trash', label: bi('回收站', 'Trash'), count: data.trashQuestions.length },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setTab(t.key);
                setSelectedIds(new Set());
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all inline-flex items-center gap-1.5 ${
                tab === t.key ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
              }`}
            >
              <span>{t.label}</span>
              <span className="text-[11px] opacity-75 tabular-nums">{t.count}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={toggleShowAllAnswers}
            data-testid="toggle-all-answers-btn"
            className={showAllAnswers ? 'border-accent/40 text-accent bg-accent-soft/40' : ''}
          >
            {showAllAnswers ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {showAllAnswers ? bi('隐藏答案', 'Hide Answers') : bi('显示答案', 'Show Answers')}
          </Button>

          {tab === 'mistakes' && hiddenMistakeCount > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void getSyncEngine()?.restoreHiddenMistakes();
                pushToast(bi(`已恢复 ${hiddenMistakeCount} 道已隐藏错题`, 'Restored hidden mistakes'), 'success');
              }}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {bi(`恢复已隐藏 (${hiddenMistakeCount})`, `Restore (${hiddenMistakeCount})`)}
            </Button>
          )}
          {tab === 'trash' && data.trashQuestions.length > 0 && (
            <Button size="sm" variant="danger" onClick={() => void handleEmptyTrash()}>
              <Trash2 className="w-3.5 h-3.5" />
              {bi('清空回收站', 'Empty Trash')}
            </Button>
          )}
          {tab !== 'trash' && filteredList.length > 0 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                startSession({
                  mode: 'filtered',
                  questions: filteredList,
                  title: bi(`筛选专练 (${filteredList.length} 题)`, `Filtered (${filteredList.length})`),
                })
              }
            >
              <Play className="w-3.5 h-3.5" />
              {bi(`练习筛选 (${filteredList.length})`, `Practice (${filteredList.length})`)}
            </Button>
          )}
        </div>
      </div>

      {/* Unified Big-Tech Filter & Selection Bar */}
      <div className="rounded-2xl border border-line bg-surface shadow-sm overflow-hidden">
        <div className="p-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-ink-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={bi('搜索题干、选项、答案或拼音简拼…', 'Search stems, options, answers, or pinyin…')}
              className="w-full h-9 pl-9 pr-8 rounded-xl bg-canvas border border-line text-sm text-ink outline-none focus:border-accent transition-colors"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={subFilter}
              onChange={(e) => {
                setSubFilter(e.target.value);
                setChapFilter('all');
              }}
              className={`h-9 px-2.5 rounded-xl border text-xs outline-none transition-colors ${
                subFilter !== 'all'
                  ? 'border-accent/60 bg-accent-soft/40 text-accent font-medium'
                  : 'border-line bg-canvas text-ink'
              }`}
            >
              <option value="all">{bi('全部科目', 'All Subjects')}</option>
              {subjects.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <select
              value={chapFilter}
              onChange={(e) => setChapFilter(e.target.value)}
              className={`h-9 px-2.5 rounded-xl border text-xs outline-none transition-colors max-w-[180px] ${
                chapFilter !== 'all'
                  ? 'border-accent/60 bg-accent-soft/40 text-accent font-medium'
                  : 'border-line bg-canvas text-ink'
              }`}
            >
              <option value="all">{bi('全部章节', 'All Chapters')}</option>
              {chapters.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as 'all' | QuestionType)}
              className={`h-9 px-2.5 rounded-xl border text-xs outline-none transition-colors ${
                typeFilter !== 'all'
                  ? 'border-accent/60 bg-accent-soft/40 text-accent font-medium'
                  : 'border-line bg-canvas text-ink'
              }`}
            >
              <option value="all">{bi('全部题型', 'All Types')}</option>
              <option value="mcq">{bi('单选题', 'MCQ')}</option>
              <option value="multi">{bi('多选题', 'Multi')}</option>
              <option value="tf">{bi('判断题', 'T/F')}</option>
              <option value="fill">{bi('填空题', 'Fill')}</option>
              <option value="qa">{bi('问答题', 'Q&A')}</option>
            </select>

            <div className="relative flex items-center">
              <ArrowUpDown className="w-3.5 h-3.5 text-ink-muted absolute left-2.5 pointer-events-none" />
              <select
                data-testid="library-sort-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as LibrarySortKey)}
                className="h-9 pl-8 pr-2.5 rounded-xl bg-canvas border border-line text-xs text-ink outline-none focus:border-accent"
              >
                <option value="default">{bi('默认排序', 'Sort: Default')}</option>
                <option value="err_rate_desc">{bi('错误率：高到低', 'Error Rate: High-Low')}</option>
                <option value="err_rate_asc">{bi('错误率：低到高', 'Error Rate: Low-High')}</option>
                <option value="err_count_desc">{bi('错题次数最多', 'Most Mistakes')}</option>
                <option value="alpha_asc">{bi('首字母 A 到 Z', 'Alpha A-Z')}</option>
                <option value="alpha_desc">{bi('首字母 Z 到 A', 'Alpha Z-A')}</option>
                <option value="attempts_desc">{bi('作答次数多到少', 'Attempts: High-Low')}</option>
                <option value="attempts_asc">{bi('作答次数少到多', 'Attempts: Low-High')}</option>
                <option value="ans_asc">{bi('按答案排序', 'By Answer')}</option>
                <option value="updated_desc">{bi('最近编辑', 'Recently Edited')}</option>
                <option value="sm2_due">{bi('SM-2 到期优先', 'SM-2 Due Soonest')}</option>
              </select>
            </div>

            {hasActiveFilter && (
              <button
                type="button"
                onClick={resetFilters}
                className="h-9 px-2.5 rounded-xl text-xs font-medium text-ink-muted hover:text-ink hover:bg-surface-muted transition-colors inline-flex items-center gap-1"
              >
                <X className="w-3.5 h-3.5" />
                {bi('重置', 'Reset')}
              </button>
            )}
          </div>
        </div>

        {/* Slim Selection & Status Footer */}
        {filteredList.length > 0 && (
          <div className="px-3 py-2 bg-surface-muted/40 border-t border-line/70 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={toggleSelectAllFiltered}
                data-testid="lib-select-all-btn"
                className={`px-2.5 py-1 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
                  allFilteredSelected
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-line bg-surface text-ink-muted hover:text-ink'
                }`}
              >
                {allFilteredSelected ? (
                  <CheckSquare className="w-3.5 h-3.5 text-accent" />
                ) : (
                  <Square className="w-3.5 h-3.5" />
                )}
                {bi(`全选 (${filteredList.length})`, `Select All (${filteredList.length})`)}
              </button>

              <button
                type="button"
                onClick={invertVisibleSelection}
                className="px-2.5 py-1 rounded-lg border border-line bg-surface text-ink-muted hover:text-ink transition-colors"
              >
                {bi('反选', 'Invert')}
              </button>

              {selectedIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="px-2.5 py-1 rounded-lg text-ink-muted hover:text-ink inline-flex items-center gap-1 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                  {bi(`取消已选 (${selectedIds.size})`, `Clear (${selectedIds.size})`)}
                </button>
              )}
            </div>

            <div className="text-[11px] text-ink-muted tabular-nums" data-testid="lib-count-status">
              {visibleItems.length < filteredList.length
                ? bi(`已加载 ${visibleItems.length} / ${filteredList.length} 题`, `Loaded ${visibleItems.length} / ${filteredList.length}`)
                : bi(`共 ${filteredList.length} 题`, `${filteredList.length} items`)}
            </div>
          </div>
        )}

        {/* Contextual Batch Action Bar */}
        {selectedIds.size > 0 && (
          <div
            data-testid="library-batch-bar"
            className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 bg-accent-soft/60 border-t border-accent/25 anim-slide-down"
          >
            <div className="text-xs font-semibold text-accent tabular-nums">
              {bi(`已选中 ${selectedIds.size} 道题目`, `${selectedIds.size} selected`)}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {tab !== 'trash' ? (
                <>
                  <Button size="sm" variant="primary" onClick={openBatchMoveModal} data-testid="batch-move-btn">
                    <FolderInput className="w-3.5 h-3.5" />
                    {bi('批量换科目/章节', 'Move Subject/Chapter')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void handleBatchStar(true)}>
                    <Star className="w-3.5 h-3.5 text-amber-500" />
                    {bi('批量收藏', 'Star')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      startSession({
                        mode: 'filtered',
                        questions: selectedQuestions,
                        title: bi(`已选 ${selectedQuestions.length} 题练习`, `Selected (${selectedQuestions.length})`),
                      })
                    }
                  >
                    <Play className="w-3.5 h-3.5" />
                    {bi('练习所选', 'Practice')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => exportBankJson(selectedQuestions)}>
                    <Download className="w-3.5 h-3.5" />
                    {bi('导出 JSON', 'Export')}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => void handleBatchDelete()}
                    data-testid="batch-delete-btn"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {bi('批量删除', 'Delete Selected')}
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="primary" onClick={() => void handleBatchTrashRestore()}>
                    <RotateCcw className="w-3.5 h-3.5" />
                    {bi('批量恢复', 'Restore Selected')}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => void handleBatchTrashPurge()}>
                    <Trash2 className="w-3.5 h-3.5" />
                    {bi('彻底删除选中', 'Purge Selected')}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Questions List (Infinite Scroll) */}
      {visibleItems.length === 0 ? (
        <EmptyState
          icon={<Search className="w-5 h-5" />}
          title={bi('当前条件无匹配题目', 'No matching questions')}
          description={
            tab === 'all' && data.questions.length === 0
              ? bi('点击右上方 "导入" 或 "新增题目" 开始建立你的题库。', 'Use Import or New Question to get started.')
              : bi('尝试更换关键词或清除筛选条件。', 'Try adjusting filters or search keywords.')
          }
        />
      ) : (
        <div className="space-y-3" data-testid="lib-question-list">
          {visibleItems.map((q) => {
            const isStar = Boolean(data.flagsMap.get(q.id)?.starred);
            const isRevealed = isCardRevealed(q.id);
            const isSelected = selectedIds.has(q.id);
            const perf = perfMap.get(q.id);
            const fillBlanks = q.type === 'fill' ? parseFillBlanks(q.a) : [];

            return (
              <Card
                key={q.id}
                padding="md"
                data-testid={`lib-card-${q.id}`}
                onClick={(e) => handleCardSurfaceClick(e, q.id)}
                className={`space-y-3 cursor-pointer transition-all duration-200 select-text ${
                  isSelected
                    ? 'border-accent ring-1 ring-accent/35 bg-accent-soft/20'
                    : 'hover:border-accent/40 hover:-translate-y-[1px] hover:shadow-sm'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <label
                      className="inline-flex items-center cursor-pointer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(q.id)}
                        data-testid={`lib-select-${q.id}`}
                        className="w-4 h-4 accent-[var(--accent)] rounded cursor-pointer"
                      />
                    </label>
                    <Badge tone="accent">{typeLabel[q.type] || q.type}</Badge>
                    <span className="text-xs text-ink-muted truncate">
                      {q.sub} / {q.chap}
                    </span>
                    {showErrRate && (
                      <Badge
                        data-testid="card-err-rate"
                        tone={
                          perf && perf.errRate !== null
                            ? perf.errRate >= 50
                              ? 'danger'
                              : perf.errRate >= 25
                              ? 'warning'
                              : 'success'
                            : 'neutral'
                        }
                      >
                        {perf && perf.errRate !== null
                          ? bi(
                              `错误率 ${perf.errRate}% (${perf.wrong}/${perf.attempts})`,
                              `Err ${perf.errRate}% (${perf.wrong}/${perf.attempts})`,
                            )
                          : bi('暂无作答', 'Unattempted')}
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    {tab !== 'trash' ? (
                      <>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCardReveal(q.id);
                          }}
                          className="h-7 px-2 rounded-lg text-xs text-ink-muted hover:text-ink hover:bg-surface-muted inline-flex items-center gap-1"
                        >
                          {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          {isRevealed ? bi('收起答案', 'Hide') : bi('看答案', 'Answer')}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void getSyncEngine()?.setFlag(q.id, { starred: !isStar });
                          }}
                          className={`w-7 h-7 rounded-lg inline-flex items-center justify-center hover:bg-surface-muted ${
                            isStar ? 'text-amber-500' : 'text-ink-muted'
                          }`}
                          title={bi('收藏', 'Star')}
                        >
                          <Star className={`w-3.5 h-3.5 ${isStar ? 'fill-current' : ''}`} />
                        </button>
                        {tab === 'mistakes' && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void getSyncEngine()?.setFlag(q.id, { mistakeHidden: true });
                              pushToast(bi('已从错题本移出（历史统计仍保留）', 'Hidden from mistakes'), 'info');
                            }}
                            className="h-7 px-2 rounded-lg text-xs text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10"
                          >
                            {bi('已掌握', 'Mastered')}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onInspectQuestion(q);
                          }}
                          className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-muted"
                          title={bi('作答记录', 'History')}
                        >
                          <History className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditQuestion(q);
                          }}
                          className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-muted"
                          title={bi('编辑', 'Edit')}
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void getSyncEngine()?.softDeleteQuestions([q.id]);
                            pushToast(bi('已移入回收站', 'Moved to Trash'), 'info');
                          }}
                          className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-red-500 hover:bg-red-500/10"
                          title={bi('移入回收站', 'Move to Trash')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            void getSyncEngine()?.restoreQuestion(q.id);
                            pushToast(bi('题目已恢复', 'Question restored'), 'success');
                          }}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          {bi('恢复', 'Restore')}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={async () => {
                            const ok = await confirm({
                              title: bi('彻底删除', 'Purge Permanently'),
                              message: bi('确认永久删除这道题目吗？不可撤销。', 'Purge permanently? Cannot be undone.'),
                              danger: true,
                            });
                            if (ok) void getSyncEngine()?.destroyQuestion(q.id);
                          }}
                        >
                          {bi('彻底删除', 'Purge')}
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* Question Stem */}
                <div className="text-[15px] font-bold text-ink leading-relaxed">
                  <MediaContent text={q.q} media={q.media} highlightQuery={query} />
                </div>

                {/* High-contrast Options */}
                {(q.type === 'mcq' || q.type === 'multi') && q.o.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[13px]">
                    {q.o.map((opt, idx) => {
                      const letter = String.fromCharCode(65 + idx);
                      const ok = isRevealed && q.a.toUpperCase().includes(letter);
                      return (
                        <div
                          key={letter}
                          data-testid={`lib-opt-${q.id}-${letter}`}
                          className={`px-3 py-2 rounded-xl border transition-colors ${
                            ok
                              ? 'border-emerald-500/45 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 font-semibold'
                              : 'border-line bg-canvas/70 text-ink font-medium'
                          }`}
                        >
                          <span className="font-mono font-bold mr-1.5">{letter}.</span>
                          <HighlightedText text={opt} query={query} />
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Answer & Explanation Block */}
                {isRevealed && (
                  <div
                    data-testid={`lib-answer-${q.id}`}
                    className="p-3.5 rounded-xl bg-surface-muted/65 border border-line/70 space-y-2 anim-slide-down"
                  >
                    {q.type === 'qa' ? (
                      <div className="space-y-1">
                        <div className="text-xs font-semibold text-accent">
                          {bi('参考答案', 'Reference Answer')}
                        </div>
                        <div className="text-[14.5px] font-medium text-ink leading-relaxed whitespace-pre-wrap">
                          {q.a}
                        </div>
                      </div>
                    ) : q.type === 'fill' && fillBlanks.length > 1 ? (
                      <div className="space-y-1.5">
                        <div className="text-sm font-medium text-ink-muted">
                          {bi('标准答案：', 'Answer: ')}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {fillBlanks.map((alts, bIdx) => (
                            <span
                              key={bIdx}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface border border-line text-sm"
                            >
                              <span className="text-xs text-ink-muted font-mono">
                                {bi(`第 ${bIdx + 1} 空`, `#${bIdx + 1}`)}
                              </span>
                              <span className="font-bold text-accent">{alts.join(' / ')}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-baseline gap-1.5">
                        <span className="text-sm font-medium text-ink-muted">
                          {bi('标准答案：', 'Answer: ')}
                        </span>
                        <span className="text-[15.5px] font-bold text-accent">
                          {q.type === 'tf'
                            ? q.a === 'T'
                              ? bi('√ 正确', 'True')
                              : bi('× 错误', 'False')
                            : q.type === 'fill'
                              ? (fillBlanks[0] ? fillBlanks[0].join(' / ') : q.a)
                              : q.a}
                        </span>
                      </div>
                    )}
                    {q.d && (
                      <div className="text-sm text-ink-muted leading-relaxed whitespace-pre-wrap pt-0.5">
                        {q.d}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}

          {/* Infinite Scroll Sentinel */}
          <div ref={sentinelRef} data-testid="lib-infinite-sentinel" className="pt-2 flex justify-center">
            {visibleCount < filteredList.length ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setVisibleCount((prev) => Math.min(filteredList.length, prev + BATCH_STEP))}
                data-testid="lib-load-more-btn"
              >
                {bi(
                  `已显示 ${visibleItems.length} / ${filteredList.length} 题，继续下滑或点击加载更多`,
                  `Showing ${visibleItems.length} / ${filteredList.length} — scroll or click to load more`,
                )}
              </Button>
            ) : (
              filteredList.length > INITIAL_BATCH && (
                <span className="text-xs text-ink-muted tabular-nums py-2" data-testid="lib-all-loaded">
                  {bi(`已全部加载（共 ${filteredList.length} 题）`, `All ${filteredList.length} items loaded`)}
                </span>
              )
            )}
          </div>
        </div>
      )}

      {/* Batch Move Modal */}
      <Modal
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        title={bi('批量调整科目与章节', 'Batch Move Subject & Chapter')}
        subtitle={bi(`已选 ${selectedQuestions.length} 道题目，可直接输入全新科目或章节名称`, `Moving ${selectedQuestions.length} questions — pick existing or type new names`)}
        size="sm"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setMoveOpen(false)}>
              {bi('取消', 'Cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={batchBusy}
              onClick={() => void handleConfirmBatchMove()}
              data-testid="confirm-batch-move-btn"
            >
              {bi(`确认移动 (${selectedQuestions.length})`, `Move (${selectedQuestions.length})`)}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">
              {bi('目标科目（可选或直接输入新科目名）', 'Target Subject (select or type new)')}
            </label>
            <input
              list="batch-move-sub-list"
              value={moveSub}
              onChange={(e) => setMoveSub(e.target.value)}
              data-testid="batch-move-sub-input"
              placeholder={bi('输入或选择科目名称', 'Subject name')}
              className="w-full h-9 px-3 rounded-xl bg-canvas border border-line text-sm text-ink outline-none focus:border-accent"
            />
            <datalist id="batch-move-sub-list">
              {subjects.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            {subjects.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {subjects.slice(0, 8).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setMoveSub(s)}
                    className={`px-2 py-0.5 rounded-md border text-[11px] transition-colors ${
                      moveSub === s
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-line bg-canvas text-ink-muted hover:text-ink'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-xs text-ink cursor-pointer select-none">
            <input
              type="checkbox"
              checked={keepOriginalChap}
              onChange={(e) => setKeepOriginalChap(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            <span>{bi('保留各题目原本的章节名称（仅跨科目归档）', 'Keep original chapter names (move subject only)')}</span>
          </label>

          {!keepOriginalChap && (
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">
                {bi('目标章节（可选或直接输入新章节名）', 'Target Chapter (select or type new)')}
              </label>
              <input
                list="batch-move-chap-list"
                value={moveChap}
                onChange={(e) => setMoveChap(e.target.value)}
                data-testid="batch-move-chap-input"
                placeholder={bi('输入或选择章节名称', 'Chapter name')}
                className="w-full h-9 px-3 rounded-xl bg-canvas border border-line text-sm text-ink outline-none focus:border-accent"
              />
              <datalist id="batch-move-chap-list">
                {moveSubjectChapters.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              {moveSubjectChapters.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2 max-h-24 overflow-y-auto custom-scroll">
                  {moveSubjectChapters.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setMoveChap(c)}
                      className={`px-2 py-0.5 rounded-md border text-[11px] transition-colors ${
                        moveChap === c
                          ? 'border-accent bg-accent-soft text-accent'
                          : 'border-line bg-canvas text-ink-muted hover:text-ink'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};
