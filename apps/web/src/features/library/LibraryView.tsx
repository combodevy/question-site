import React, { useMemo, useState } from 'react';
import {
  Download,
  Edit3,
  Eye,
  EyeOff,
  FolderCog,
  History,
  Play,
  Plus,
  RotateCcw,
  Search,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';
import type { QuestionType } from '@qs/shared';
import type { LocalQuestion } from '@/db';
import type { LiveStudySnapshot, StudyStats } from '@/sync/hooks';
import { getSyncEngine } from '@/sync/engine';
import { useQuizStore } from '@/store/useQuizStore';
import { useUiStore } from '@/store/useUiStore';
import { useBi } from '@/i18n/useBi';
import { matchesSearchQuery, naturalCompare } from '@/lib/text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { MediaContent } from '@/components/ui/MediaContent';
import { HighlightedText } from '@/components/ui/HighlightedText';

type LibraryTab = 'all' | 'mistakes' | 'starred' | 'trash';

interface LibraryViewProps {
  data: LiveStudySnapshot;
  stats: StudyStats;
  initialSub?: string;
  initialChap?: string;
  onEditQuestion: (q: LocalQuestion | null, presetSub?: string, presetChap?: string) => void;
  onInspectQuestion: (q: LocalQuestion) => void;
  onOpenImport: () => void;
  onOpenBankManager: () => void;
  onOpenPrintExport: () => void;
}

const PAGE_SIZE = 40;

export const LibraryView: React.FC<LibraryViewProps> = ({
  data,
  stats,
  initialSub = 'all',
  initialChap = 'all',
  onEditQuestion,
  onInspectQuestion,
  onOpenImport,
  onOpenBankManager,
  onOpenPrintExport,
}) => {
  const { bi } = useBi();
  const { confirm, pushToast } = useUiStore();
  const startSession = useQuizStore((s) => s.startSession);

  const [tab, setTab] = useState<LibraryTab>('all');
  const [subFilter, setSubFilter] = useState(initialSub);
  const [chapFilter, setChapFilter] = useState(initialChap);
  const [typeFilter, setTypeFilter] = useState<'all' | QuestionType>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());

  const subjects = useMemo(() => stats.subjectTree.map((s) => s.sub), [stats.subjectTree]);
  const chapters = useMemo(() => {
    if (subFilter === 'all') {
      const set = new Set<string>();
      stats.subjectTree.forEach((s) => s.chapters.forEach((c) => set.add(c.chap)));
      return Array.from(set).sort(naturalCompare);
    }
    return stats.subjectTree.find((s) => s.sub === subFilter)?.chapters.map((c) => c.chap) || [];
  }, [stats.subjectTree, subFilter]);

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
    return baseList.filter((item) => {
      if (subFilter !== 'all' && item.sub !== subFilter) return false;
      if (chapFilter !== 'all' && item.chap !== chapFilter) return false;
      if (typeFilter !== 'all' && item.type !== typeFilter) return false;
      if (qLower) {
        const hay = `${item.q}\n${item.o.join('\n')}\n${item.d}\n${item.sub}\n${item.chap}`;
        if (!matchesSearchQuery(hay, qLower)) return false;
      }
      return true;
    });
  }, [baseList, subFilter, chapFilter, typeFilter, query]);

  const totalPages = Math.max(1, Math.ceil(filteredList.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = useMemo(
    () => filteredList.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredList, safePage],
  );

  const toggleReveal = (id: string) => {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
    pushToast(bi('回收站已清空', 'Trash emptied'), 'info');
  };

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
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-ink">
            {bi('题库管理', 'Question Library')}
          </h1>
          <p className="text-xs sm:text-sm text-ink-muted mt-0.5">
            {bi('支持拼音检索、章节整理、单题勘误与错题归纳', 'Pinyin search, chapter editing, and mistake curation')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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

      {/* Tabs + Quick Action */}
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

        <div className="flex items-center gap-2">
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

      {/* Filters Bar */}
      <Card padding="sm" className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
        <div className="sm:col-span-5 relative">
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
          className="sm:col-span-3 h-9 px-2.5 rounded-xl bg-canvas border border-line text-xs text-ink outline-none"
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
      </Card>

      {/* Questions List */}
      {pageItems.length === 0 ? (
        <EmptyState
          icon={<Search className="w-5 h-5" />}
          title={bi('当前条件无匹配题目', 'No matching questions')}
          description={
            tab === 'all' && data.questions.length === 0
              ? bi('点击右上方「导入」或「新增题目」开始建立你的题库。', 'Use Import or New Question to get started.')
              : bi('尝试更换关键词或清除筛选条件。', 'Try adjusting filters or search keywords.')
          }
        />
      ) : (
        <div className="space-y-3">
          {pageItems.map((q) => {
            const isStar = Boolean(data.flagsMap.get(q.id)?.starred);
            const isRevealed = revealedIds.has(q.id);
            return (
              <Card key={q.id} padding="md" className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge tone="accent">{typeLabel[q.type] || q.type}</Badge>
                    <span className="text-xs text-ink-muted truncate">
                      {q.sub} · {q.chap}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    {tab !== 'trash' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => toggleReveal(q.id)}
                          className="h-7 px-2 rounded-lg text-xs text-ink-muted hover:text-ink hover:bg-surface-muted inline-flex items-center gap-1"
                        >
                          {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          {isRevealed ? bi('收起答案', 'Hide') : bi('看答案', 'Answer')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void getSyncEngine()?.setFlag(q.id, { starred: !isStar })}
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
                            onClick={() => {
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
                          onClick={() => onInspectQuestion(q)}
                          className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-muted"
                          title={bi('作答记录', 'History')}
                        >
                          <History className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onEditQuestion(q)}
                          className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-muted"
                          title={bi('编辑', 'Edit')}
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
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
                  <div className="p-3 rounded-xl bg-surface-muted/60 text-xs space-y-1">
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
    </div>
  );
};
