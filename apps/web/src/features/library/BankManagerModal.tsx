import React, { useState } from 'react';
import { BookOpen, Edit2, ExternalLink, FolderPlus, Plus, Trash2 } from 'lucide-react';
import type { LiveStudySnapshot, StudyStats } from '@/sync/hooks';
import { getSyncEngine } from '@/sync/engine';
import { useUiStore } from '@/store/useUiStore';
import { useBi } from '@/i18n/useBi';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

interface BankManagerModalProps {
  open: boolean;
  data: LiveStudySnapshot;
  stats: StudyStats;
  onJumpFilter: (sub: string, chap?: string) => void;
  onCreateQuestionIn: (sub: string, chap: string) => void;
  onClose: () => void;
}

export const BankManagerModal: React.FC<BankManagerModalProps> = ({
  open,
  data,
  stats,
  onJumpFilter,
  onCreateQuestionIn,
  onClose,
}) => {
  const { bi } = useBi();
  const { confirm, prompt, pushToast } = useUiStore();
  const [selectedSub, setSelectedSub] = useState('');

  const currentSub =
    stats.subjectTree.find((s) => s.sub === selectedSub)?.sub || stats.subjectTree[0]?.sub || '';
  const currentChaps = stats.subjectTree.find((s) => s.sub === currentSub)?.chapters || [];

  const handleCreateSubject = async () => {
    const nextSub = await prompt({
      title: bi('新增科目', 'Create New Subject'),
      message: bi('请输入新科目名称（将打开录题面板创建该科目首道题）：', 'New subject name (opens question editor):'),
      placeholder: bi('例如：高等数学', 'e.g. Calculus'),
    });
    if (!nextSub || !nextSub.trim()) return;
    const cleanSub = nextSub.trim();
    const nextChap = await prompt({
      title: bi('初始章节名称', 'Initial Chapter Name'),
      message: bi(`为科目 "${cleanSub}" 设置首个章节名称：`, `First chapter under "${cleanSub}":`),
      defaultValue: bi('第一章', 'Chapter 1'),
    });
    if (!nextChap || !nextChap.trim()) return;
    onClose();
    onCreateQuestionIn(cleanSub, nextChap.trim());
  };

  const handleCreateChapter = async (sub: string) => {
    const nextChap = await prompt({
      title: bi('新增章节', 'Create New Chapter'),
      message: bi(`在科目 "${sub}" 下新增章节名称：`, `New chapter name under "${sub}":`),
      placeholder: bi('例如：第五章 综合测试', 'e.g. Chapter 5'),
    });
    if (!nextChap || !nextChap.trim()) return;
    onClose();
    onCreateQuestionIn(sub, nextChap.trim());
  };

  const handleRenameSub = async (sub: string) => {
    const next = await prompt({
      title: bi('重命名科目', 'Rename Subject'),
      message: bi(`将科目 "${sub}" 重命名为：`, `Rename "${sub}" to:`),
      defaultValue: sub,
    });
    if (!next || next.trim() === sub) return;
    await getSyncEngine()?.renameSubject(sub, next.trim());
    setSelectedSub(next.trim());
    pushToast(bi('科目名称已更新', 'Subject renamed'), 'success');
  };

  const handleDeleteSub = async (sub: string) => {
    const targets = data.questions.filter((q) => q.sub === sub);
    const ok = await confirm({
      title: bi('删除整个科目', 'Trash Subject'),
      message: bi(
        `确定将科目 "${sub}" 下的 ${targets.length} 道题全部移入回收站吗？`,
        `Move all ${targets.length} questions in "${sub}" to Trash?`,
      ),
      danger: true,
    });
    if (!ok) return;
    await getSyncEngine()?.softDeleteQuestions(
      targets.map((q) => q.id),
      'delete-subject',
    );
    pushToast(bi(`已将 ${targets.length} 题移入回收站`, 'Subject moved to Trash'), 'info');
  };

  const handleRenameChap = async (sub: string, chap: string) => {
    const next = await prompt({
      title: bi('重命名章节', 'Rename Chapter'),
      message: bi(`将章节 "${chap}" 重命名为：`, `Rename "${chap}" to:`),
      defaultValue: chap,
    });
    if (!next || next.trim() === chap) return;
    await getSyncEngine()?.renameChapter(sub, chap, next.trim());
    pushToast(bi('章节名称已更新', 'Chapter renamed'), 'success');
  };

  const handleDeleteChap = async (sub: string, chap: string) => {
    const targets = data.questions.filter((q) => q.sub === sub && q.chap === chap);
    const ok = await confirm({
      title: bi('删除章节', 'Trash Chapter'),
      message: bi(
        `确定将章节 "${chap}" 下的 ${targets.length} 道题移入回收站吗？`,
        `Move ${targets.length} questions in "${chap}" to Trash?`,
      ),
      danger: true,
    });
    if (!ok) return;
    await getSyncEngine()?.softDeleteQuestions(
      targets.map((q) => q.id),
      'delete-chapter',
    );
    pushToast(bi(`已将 ${targets.length} 题移入回收站`, 'Chapter moved to Trash'), 'info');
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={bi('科目与章节管理', 'Subjects & Chapters')}
      size="lg"
    >
      {stats.subjectTree.length === 0 ? (
        <div className="py-10 text-center space-y-3">
          <div className="text-xs text-ink-muted">{bi('当前题库为空', 'Bank is empty')}</div>
          <Button size="sm" variant="primary" onClick={() => void handleCreateSubject()}>
            <FolderPlus className="w-3.5 h-3.5" />
            {bi('新建首个科目', 'Create First Subject')}
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-ink-muted inline-flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5 text-accent" />
                {bi('科目列表', 'Subjects')}
              </div>
              <Button size="sm" variant="outline" onClick={() => void handleCreateSubject()}>
                <FolderPlus className="w-3.5 h-3.5" />
                {bi('新增科目', 'New Subject')}
              </Button>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto custom-scroll pr-1">
              {stats.subjectTree.map((s) => (
                <div
                  key={s.sub}
                  onClick={() => setSelectedSub(s.sub)}
                  className={`p-3 rounded-xl border cursor-pointer transition-colors flex items-center justify-between gap-2 ${
                    s.sub === currentSub
                      ? 'border-accent bg-accent-soft/50'
                      : 'border-line bg-canvas/50 hover:border-ink-muted/40'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink truncate">{s.sub}</div>
                    <div className="text-[11px] text-ink-muted tabular-nums">
                      {s.chapters.length} {bi('章', 'ch')} / {s.total} {bi('题', 'Q')}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        onJumpFilter(s.sub);
                        onClose();
                      }}
                      title={bi('查看题目', 'View in Library')}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void handleRenameSub(s.sub)}>
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-500"
                      onClick={() => void handleDeleteSub(s.sub)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-ink-muted truncate">
                {bi('章节列表：', 'Chapters: ')}
                <span className="text-ink">{currentSub}</span>
              </div>
              {currentSub && (
                <Button size="sm" variant="outline" onClick={() => void handleCreateChapter(currentSub)}>
                  <Plus className="w-3.5 h-3.5" />
                  {bi('新增章节', 'New Chapter')}
                </Button>
              )}
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto custom-scroll pr-1">
              {currentChaps.map((c) => (
                <div
                  key={c.chap}
                  className="p-3 rounded-xl border border-line bg-canvas/50 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink truncate">{c.chap}</div>
                    <div className="text-[11px] text-ink-muted tabular-nums">
                      {c.total} {bi('题', 'Q')}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        onJumpFilter(currentSub, c.chap);
                        onClose();
                      }}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void handleRenameChap(currentSub, c.chap)}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-500"
                      onClick={() => void handleDeleteChap(currentSub, c.chap)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};
