import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpDown,
  CheckSquare,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FolderCog,
  FolderInput,
  FolderPlus,
  History,
  Library as LibraryIcon,
  Play,
  Plus,
  RotateCcw,
  Search,
  Square,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';
import type { Question, QuestionType } from '@qs/shared';
import type { LocalQuestion } from '@/db';
import type { LiveStudySnapshot, StudyStats } from '@/sync/hooks';
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

const PAGE_SIZE = 40;

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
    initialPrefs.type && ['all', 'mcq', 'multi', 'tf', 'fill'].includes(initialPrefs.type)
      ? initialPrefs.type
      : 'all',
  );
  const [sortBy, setSortBy] = useState<LibrarySortKey>(
    initialPrefs.sort && VALID_SORTS.includes(initialPrefs.sort) ? initialPrefs.sort : 'default',
  );
  // Default is open/showing answers as requested
  const [showAllAnswers, setShowAllAnswers] = useState<boolean>(
    typeof initialPrefs.showAllAnswers === 'boolean' ? initialPrefs.showAllAnswers : true,
  );
  // Tracks per-card overrides relative to showAllAnswers
  const [cardAnswerOverrides, setCardAnswerOverrides] = useState<Map<string, boolean>>(new Map());

  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  // Multi-select & Batch move modal
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveSub, setMoveSub] = useState('');
  const [moveChap, setMoveChap] = useState('');
  const [keepOriginalChap, setKeepOriginalChap] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);

  // Sync external jumps from BankManagerModal
  useEffect(() => {
    if (!jumpFilter) return;
    setTab('all');
    setSubFilter(jumpFilter.sub || 'all');
    setChapFilter(jumpFilter.chap || 'all');
    setPage(1);
    setSelectedIds(new Set());
  }, [jumpFilter?.nonce, jumpFilter]);

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

  // Guard against stale saved sub/chap filter when that subject no longer exists
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
        const hay = `${item.q}\n${item.o.join('\n')}\n${item.d}\n${item.sub}\n${item.chap}`;
        if (!matchesSearchQuery(hay, qLower)) return false;
      }
      return true;
    });
    return sortQuestions(matched, sortBy, perfMap);
  }, [baseList, subFilter, chapFilter, typeFilter, query, sortBy, perfMap]);

  const totalPages = Math.max(1, Math.ceil(filteredList.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = useMemo(
    () => filteredList.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredList, safePage],
  );

  // Drop stale selections whenever active base set changes
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

  const selectPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allPageSelected = pageItems.length > 0 && pageItems.every((q) => next.has(q.id));
      for (const q of pageItems) {
        if (allPageSelected) next.delete(q.id);
        else next.add(q.id);
      }
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedIds(new Set(filteredList.map((q) => q.id)));
  };

  const invertPageSelection = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const q of pageItems) {
        if (next.has(q.id)) next.delete(q.id);
        else next.add(q.id);
      }
      return next;
    });
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
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-accent-soft text-accent inline-flex items-center justify-center">
            <LibraryIcon className="w-4 h-4" />
          </span>
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-ink">
              {bi('题库管理', 'Question Library')}
            </h1>
            <p className="text-xs sm:text-sm text-ink-muted mt-0.5">
              {bi('点击题目卡片切换答案显隐，支持多维排序与批量跨科整理', 'Click cards to toggle answers; sort cleanly or batch organize')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void handleCreateNewSubject()} data-testid="lib-new-subject-btn">
            <FolderPlus className="w-3.5 h-3.5" />
            {bi('新增科目', 'New Subject')}
          </Button>
          <Button variant="outline" size="sm" onClick={onOpenBankManager}>
            <FolderCog className="w-3.5 h-3.5" />
            {bi('章节管理', 'Structure')}
          </Button>
          <Button variant="outline" size="sm" onClick={onOpenPrintExport}>
            <Download className="w-3.5 h-3.5" />
            {bi('导出 / 打印', 'Export')}
          </Button>
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

      {/* Tabs + Global Answer Toggle + Quick Action */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex p-1 rounded-xl bg-surface-muted border border-line">
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
                setPage(1);
                setSelectedIds(new Set());
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors inline-flex items-center gap-1.5 ${
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
            {showAllAnswers ? bi('全部隐藏答案', 'Hide All Answers') : bi('全部显示答案', 'Show All Answers')}
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
              {bi(`恢复已隐藏 (${hiddenMistakeCount})`, `Restore Hidden (${hiddenMistakeCount})`)}
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
              {bi(`练习筛选结果 (${filteredList.length})`, `Practice (${filteredList.length})`)}
            </Button>
          )}
        </div>
      </div>

      {/* Filters + Sorting Bar */}
      <Card padding="sm" className="space-y-2.5">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
          <div className="sm:col-span-4 relative">
            <Search className="w-4 h-4 text-ink-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder={bi('搜索题干、选项或拼音简拼…', 'Search stems, options, or pinyin…')}
              className="w-full h-9 pl-9 pr-3 rounded-xl bg-canvas border border-line text-sm text-ink outline-none focus:border-accent"
            />
          </div>
          <select
            value={subFilter}
            onChange={(e) => {
              setSubFilter(e.target.value);
              setChapFilter('all');
              setPage(1);
            }}
            className="sm:col-span-2 h-9 px-2.5 rounded-xl bg-canvas border border-line text-xs text-ink outline-none"
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
            onChange={(e) => {
              setChapFilter(e.target.value);
              setPage(1);
            }}
            className="sm:col-span-2 h-9 px-2.5 rounded-xl bg-canvas border border-line text-xs text-ink outline-none"
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
            onChange={(e) => {
              setTypeFilter(e.target.value as 'all' | QuestionType);
              setPage(1);
            }}
            className="sm:col-span-2 h-9 px-2.5 rounded-xl bg-canvas border border-line text-xs text-ink outline-none"
          >
            <option value="all">{bi('全部题型', 'All Types')}</option>
            <option value="mcq">{bi('单选题', 'MCQ')}</option>
            <option value="multi">{bi('多选题', 'Multi')}</option>
            <option value="tf">{bi('判断题', 'T/F')}</option>
            <option value="fill">{bi('填空题', 'Fill')}</option>
          </select>
          <div className="sm:col-span-2 relative flex items-center">
            <ArrowUpDown className="w-3.5 h-3.5 text-ink-muted absolute left-2.5 pointer-events-none" />
            <select
              data-testid="library-sort-select"
              value={sortBy}
              onChange={(e) => {
                setSortBy(e.target.value as LibrarySortKey);
                setPage(1);
              }}
              className="w-full h-9 pl-8 pr-2 rounded-xl bg-canvas border border-line text-xs text-ink outline-none focus:border-accent"
            >
              <option value="default">{bi('排序：默认顺序', 'Sort: Default')}</option>
              <option value="err_rate_desc">{bi('错误率：从高到低', 'Error Rate: High-Low')}</option>
              <option value="err_rate_asc">{bi('错误率：从低到高', 'Error Rate: Low-High')}</option>
              <option value="err_count_desc">{bi('错题次数最多', 'Most Mistakes')}</option>
              <option value="alpha_asc">{bi('首字母 A 到 Z', 'Alpha A-Z')}</option>
              <option value="alpha_desc">{bi('首字母 Z 到 A', 'Alpha Z-A')}</option>
              <option value="attempts_desc">{bi('作答次数从多到少', 'Attempts: High-Low')}</option>
              <option value="attempts_asc">{bi('作答次数从少到多', 'Attempts: Low-High')}</option>
              <option value="ans_asc">{bi('按标准答案排序', 'By Answer')}</option>
              <option value="updated_desc">{bi('最近编辑优先', 'Recently Edited')}</option>
              <option value="sm2_due">{bi('SM-2 到期优先', 'SM-2 Due Soonest')}</option>
            </select>
          </div>
        </div>

        {/* Multi-select quick controls + active batch action strip */}
        {filteredList.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-line/70 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={selectPage}
                className="px-2.5 py-1 rounded-lg border border-line bg-canvas text-ink-muted hover:text-ink inline-flex items-center gap-1 transition-colors"
              >
                <CheckSquare className="w-3.5 h-3.5 text-accent" />
                {bi('全选本页', 'Select Page')}
              </button>
              <button
                type="button"
                onClick={invertPageSelection}
                className="px-2.5 py-1 rounded-lg border border-line bg-canvas text-ink-muted hover:text-ink transition-colors"
              >
                {bi('反选本页', 'Invert')}
              </button>
              {filteredList.length > pageItems.length && (
                <button
                  type="button"
                  onClick={selectAllFiltered}
                  className="px-2.5 py-1 rounded-lg border border-line bg-canvas text-ink-muted hover:text-ink transition-colors"
                >
                  {bi(`全选筛选 (${filteredList.length})`, `Select All (${filteredList.length})`)}
                </button>
              )}
              {selectedIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="px-2.5 py-1 rounded-lg border border-line bg-canvas text-ink-muted hover:text-ink inline-flex items-center gap-1"
                >
                  <Square className="w-3.5 h-3.5" />
                  {bi(`取消已选 (${selectedIds.size})`, `Clear (${selectedIds.size})`)}
                </button>
              )}
            </div>

            <div className="text-[11px] text-ink-muted tabular-nums">
              {bi(`共 ${filteredList.length} 题 | 点题面即可切换答案`, `${filteredList.length} items | Click card to toggle answer`)}
            </div>
          </div>
        )}

        {selectedIds.size > 0 && (
          <div
            data-testid="library-batch-bar"
            className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-accent-soft/60 border border-accent/30 anim-slide-down"
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
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleBatchStar(true)}
                  >
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
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => exportBankJson(selectedQuestions)}
                  >
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
      </Card>

      {/* Questions List */}
      {pageItems.length === 0 ? (
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
        <div className="space-y-3">
          {pageItems.map((q) => {
            const isStar = Boolean(data.flagsMap.get(q.id)?.starred);
            const isRevealed = isCardRevealed(q.id);
            const isSelected = selectedIds.has(q.id);
            const perf = perfMap.get(q.id);

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

                <div className="text-sm text-ink leading-relaxed">
                  <MediaContent text={q.q} media={q.media} highlightQuery={query} />
                </div>

                {(q.type === 'mcq' || q.type === 'multi') && q.o.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
                    {q.o.map((opt, idx) => {
                      const letter = String.fromCharCode(65 + idx);
                      const ok = isRevealed && q.a.toUpperCase().includes(letter);
                      return (
                        <div
                          key={letter}
                          className={`px-2.5 py-1.5 rounded-lg border ${
                            ok
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-medium'
                              : 'border-line bg-canvas/50 text-ink-muted'
                          }`}
                        >
                          <span className="font-mono font-semibold mr-1.5">{letter}.</span>
                          <HighlightedText text={opt} query={query} />
                        </div>
                      );
                    })}
                  </div>
                )}

                {isRevealed && (
                  <div
                    data-testid={`lib-answer-${q.id}`}
                    className="p-3 rounded-xl bg-surface-muted/60 text-xs space-y-1 anim-slide-down"
                  >
                    <div>
                      <span className="text-ink-muted">{bi('标准答案：', 'Answer: ')}</span>
                      <span className="font-semibold text-accent">
                        {q.type === 'tf'
                          ? q.a === 'T'
                            ? bi('√ 正确', 'True')
                            : bi('× 错误', 'False')
                          : q.a}
                      </span>
                    </div>
                    {q.d && <div className="text-ink-muted leading-relaxed">{q.d}</div>}
                  </div>
                )}
              </Card>
            );
          })}

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-ink-muted tabular-nums">
                {bi(`第 ${safePage} / ${totalPages} 页（共 ${filteredList.length} 题）`, `Page ${safePage}/${totalPages} (${filteredList.length} items)`)}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  {bi('上一页', 'Prev')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  {bi('下一页', 'Next')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Batch Move Modal (Supports existing or brand-new subject & chapter) */}
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
