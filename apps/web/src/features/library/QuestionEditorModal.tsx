import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Question, QuestionType } from '@qs/shared';
import type { LocalQuestion } from '@/db';
import { getSyncEngine } from '@/sync/engine';
import { useUiStore } from '@/store/useUiStore';
import { useBi } from '@/i18n/useBi';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

interface QuestionEditorModalProps {
  open: boolean;
  question: LocalQuestion | null;
  defaultSub?: string;
  defaultChap?: string;
  existingSubjects: string[];
  chaptersBySubject: Map<string, string[]>;
  onClose: () => void;
}

export const QuestionEditorModal: React.FC<QuestionEditorModalProps> = ({
  open,
  question,
  defaultSub = '',
  defaultChap = '',
  existingSubjects,
  chaptersBySubject,
  onClose,
}) => {
  const { bi } = useBi();
  const { pushToast, confirm } = useUiStore();

  const [sub, setSub] = useState('');
  const [chap, setChap] = useState('');
  const [type, setType] = useState<QuestionType>('mcq');
  const [stem, setStem] = useState('');
  const [options, setOptions] = useState<string[]>(['', '', '', '']);
  const [ansSet, setAnsSet] = useState<Set<string>>(new Set());
  const [tfAns, setTfAns] = useState<'T' | 'F' | ''>('');
  const [fillAns, setFillAns] = useState('');
  const [explanation, setExplanation] = useState('');
  const [psg, setPsg] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const loadFromQuestion = (q: LocalQuestion | null) => {
    setErr('');
    if (!q) {
      setSub(defaultSub || existingSubjects[0] || '');
      const chaps = defaultSub ? chaptersBySubject.get(defaultSub) || [] : [];
      setChap(defaultChap || chaps[0] || '');
      setType('mcq');
      setStem('');
      setOptions(['', '', '', '']);
      setAnsSet(new Set());
      setTfAns('');
      setFillAns('');
      setExplanation('');
      setPsg('');
      return;
    }
    setSub(q.sub);
    setChap(q.chap);
    setType(q.type);
    setStem(q.q);
    setOptions(q.o.length ? [...q.o] : ['', '', '', '']);
    setAnsSet(new Set(q.type === 'mcq' || q.type === 'multi' ? q.a.toUpperCase().split('') : []));
    setTfAns(q.type === 'tf' ? (q.a.toUpperCase() === 'F' ? 'F' : 'T') : '');
    setFillAns(q.type === 'fill' ? q.a : '');
    setExplanation(q.d || '');
    setPsg(q.psg || '');
  };

  useEffect(() => {
    if (open) loadFromQuestion(question);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, question?.id]);

  const handleTypeSwitch = (nextType: QuestionType) => {
    setType(nextType);
    if (nextType === 'mcq' && ansSet.size > 1) {
      const first = Array.from(ansSet)[0];
      setAnsSet(first ? new Set([first]) : new Set());
    }
    if ((nextType === 'mcq' || nextType === 'multi') && options.length < 2) {
      setOptions(['', '', '', '']);
    }
  };

  const toggleLetter = (letter: string) => {
    if (type === 'mcq') {
      setAnsSet(new Set([letter]));
    } else {
      const next = new Set(ansSet);
      if (next.has(letter)) next.delete(letter);
      else next.add(letter);
      setAnsSet(next);
    }
  };

  const handleSave = async (keepOpenForNext: boolean) => {
    setErr('');
    const cleanSub = sub.trim();
    const cleanChap = chap.trim();
    const cleanStem = stem.trim();
    if (!cleanSub || !cleanChap || !cleanStem) {
      setErr(bi('科目、章节与题干不能为空。', 'Subject, chapter, and stem are required.'));
      return;
    }

    let finalOpts: string[] = [];
    let finalAns = '';

    if (type === 'tf') {
      if (!tfAns) {
        setErr(bi('请选择判断题的标准答案。', 'Select True or False answer.'));
        return;
      }
      finalAns = tfAns;
    } else if (type === 'fill') {
      const parts = fillAns
        .split('|')
        .map((x) => x.trim())
        .filter(Boolean);
      if (!parts.length) {
        setErr(bi('请填写填空题的标准答案（多个答案可用 | 分隔）。', 'Fill-in answer is required.'));
        return;
      }
      finalAns = parts.join('|');
    } else {
      const packed: Array<{ text: string; checked: boolean }> = [];
      options.forEach((raw, idx) => {
        const letter = String.fromCharCode(65 + idx);
        const text = raw.trim();
        if (text) packed.push({ text, checked: ansSet.has(letter) });
        else if (ansSet.has(letter)) {
          setErr(bi(`选项 ${letter} 为空但被勾选为正确答案。`, `Option ${letter} is empty.`));
        }
      });
      if (err) return;
      if (packed.length < 2) {
        setErr(bi('选择题至少需要 2 个非空选项。', 'At least 2 non-empty options required.'));
        return;
      }
      finalOpts = packed.map((x) => x.text);
      const selectedLetters = packed
        .map((x, idx) => (x.checked ? String.fromCharCode(65 + idx) : ''))
        .filter(Boolean);
      if (!selectedLetters.length) {
        setErr(bi('请至少勾选一个正确选项。', 'Select at least one correct option.'));
        return;
      }
      if (type === 'mcq' && selectedLetters.length > 1) {
        setErr(bi('单选题只能有一个正确答案。', 'Single choice allows only one answer.'));
        return;
      }
      finalAns = selectedLetters.sort().join('');
    }

    const engine = getSyncEngine();
    if (!engine) return;

    const nextQ: Question = {
      id: question?.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `q-${Date.now()}`),
      type,
      q: cleanStem,
      o: finalOpts,
      a: finalAns,
      sub: cleanSub,
      chap: cleanChap,
      d: explanation.trim(),
      ...(question?.media ? { media: question.media } : {}),
      ...(psg.trim() ? { psg: psg.trim() } : {}),
      _editedAt: Date.now(),
    };

    setSaving(true);
    try {
      await engine.upsertQuestions([nextQ], Boolean(question));
      pushToast(question ? bi('题目已更新', 'Question updated') : bi('题目已添加', 'Question added'), 'success');
      if (keepOpenForNext && !question) {
        setStem('');
        setOptions(['', '', '', '']);
        setAnsSet(new Set());
        setTfAns('');
        setFillAns('');
        setExplanation('');
      } else {
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSoftDelete = async () => {
    if (!question) return;
    const ok = await confirm({
      title: bi('移入回收站', 'Move to Trash'),
      message: bi('确定将这道题移入回收站吗？日后可在回收站恢复。', 'Move this question to Trash?'),
      danger: true,
    });
    if (!ok) return;
    await getSyncEngine()?.softDeleteQuestions([question.id]);
    pushToast(bi('已移入回收站', 'Moved to Trash'), 'info');
    onClose();
  };

  const availableChaps = chaptersBySubject.get(sub.trim()) || [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeOnBackdrop={false}
      closeOnEsc={false}
      title={question ? bi('编辑题目', 'Edit Question') : bi('新增题目', 'New Question')}
      size="lg"
      footer={
        <div className="w-full flex flex-wrap items-center justify-between gap-2">
          <div>
            {question && (
              <Button variant="ghost" size="sm" onClick={handleSoftDelete} className="text-red-600 hover:bg-red-500/10">
                <Trash2 className="w-3.5 h-3.5" />
                {bi('删除此题', 'Trash')}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              {bi('取消', 'Cancel')}
            </Button>
            {!question && (
              <Button variant="outline" size="sm" loading={saving} onClick={() => void handleSave(true)}>
                {bi('保存并继续新增', 'Save & Add Another')}
              </Button>
            )}
            <Button variant="primary" size="sm" loading={saving} onClick={() => void handleSave(false)}>
              {bi('保存题目', 'Save')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">{bi('科目', 'Subject')}</label>
            <input
              list="qe-sub-datalist"
              value={sub}
              onChange={(e) => setSub(e.target.value)}
              placeholder={bi('选择或输入新科目', 'Subject name')}
              className="w-full h-9 px-3 rounded-xl bg-canvas border border-line text-sm text-ink outline-none focus:border-accent"
            />
            <datalist id="qe-sub-datalist">
              {existingSubjects.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">{bi('章节', 'Chapter')}</label>
            <input
              list="qe-chap-datalist"
              value={chap}
              onChange={(e) => setChap(e.target.value)}
              placeholder={bi('选择或输入新章节', 'Chapter name')}
              className="w-full h-9 px-3 rounded-xl bg-canvas border border-line text-sm text-ink outline-none focus:border-accent"
            />
            <datalist id="qe-chap-datalist">
              {availableChaps.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">{bi('题型', 'Type')}</label>
            <select
              value={type}
              onChange={(e) => handleTypeSwitch(e.target.value as QuestionType)}
              className="w-full h-9 px-2.5 rounded-xl bg-canvas border border-line text-sm text-ink outline-none focus:border-accent"
            >
              <option value="mcq">{bi('单选题 (mcq)', 'Single Choice')}</option>
              <option value="multi">{bi('多选题 (multi)', 'Multiple Choice')}</option>
              <option value="tf">{bi('判断题 (tf)', 'True / False')}</option>
              <option value="fill">{bi('填空题 (fill)', 'Fill in Blank')}</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-ink-muted mb-1">{bi('题干', 'Question Stem')}</label>
          <textarea
            rows={3}
            value={stem}
            onChange={(e) => setStem(e.target.value)}
            placeholder={bi('输入题干文本…', 'Enter question stem…')}
            className="w-full p-3 rounded-xl bg-canvas border border-line text-sm text-ink outline-none focus:border-accent resize-y"
          />
          {question?.media && question.media.length > 0 && (
            <p className="text-[11px] text-accent mt-1">
              {bi(
                `此题包含 ${question.media.length} 个富媒体占位符（保存时将完整保留）。`,
                `Includes ${question.media.length} rich-media attachment(s) preserved on save.`,
              )}
            </p>
          )}
        </div>

        {(type === 'mcq' || type === 'multi') && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-ink-muted">
                {bi('选项与标准答案', 'Options & Answer')}
              </label>
              {options.length < 16 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setOptions((prev) => [...prev, ''])}
                >
                  <Plus className="w-3.5 h-3.5" />
                  {bi('增加选项', 'Add Option')}
                </Button>
              )}
            </div>
            <div className="space-y-2">
              {options.map((opt, idx) => {
                const letter = String.fromCharCode(65 + idx);
                const checked = ansSet.has(letter);
                return (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="w-6 text-xs font-mono font-semibold text-ink-muted text-center">
                      {letter}.
                    </span>
                    <input
                      value={opt}
                      onChange={(e) => {
                        const copy = [...options];
                        copy[idx] = e.target.value;
                        setOptions(copy);
                      }}
                      placeholder={`${bi('选项内容', 'Option')} ${letter}`}
                      className="flex-1 h-9 px-3 rounded-xl bg-canvas border border-line text-sm text-ink outline-none focus:border-accent"
                    />
                    <label className="flex items-center gap-1.5 px-2.5 h-9 rounded-xl border border-line bg-surface-muted/40 text-xs cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleLetter(letter)}
                        className="accent-[var(--accent)]"
                      />
                      <span>{bi('正确', 'Correct')}</span>
                    </label>
                    {options.length > 2 && (
                      <button
                        type="button"
                        onClick={() => setOptions((prev) => prev.filter((_, i) => i !== idx))}
                        className="p-1.5 text-ink-muted hover:text-red-500"
                        aria-label="Remove option"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {type === 'tf' && (
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1.5">{bi('标准答案', 'Correct Answer')}</label>
            <div className="grid grid-cols-2 gap-3">
              {(['T', 'F'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setTfAns(v)}
                  className={`h-10 rounded-xl border text-sm font-medium transition-colors ${
                    tfAns === v
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-line bg-canvas text-ink-muted hover:text-ink'
                  }`}
                >
                  {v === 'T' ? bi('√ 正确 (True)', 'True (T)') : bi('× 错误 (False)', 'False (F)')}
                </button>
              ))}
            </div>
          </div>
        )}

        {type === 'fill' && (
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">
              {bi('标准答案（多个同义答案用 | 分隔）', 'Answer (separate alternatives with |)')}
            </label>
            <input
              value={fillAns}
              onChange={(e) => setFillAns(e.target.value)}
              placeholder="TCP|传输控制协议"
              className="w-full h-9 px-3 rounded-xl bg-canvas border border-line text-sm text-ink outline-none focus:border-accent"
            />
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-ink-muted mb-1">
            {bi('解析（可选）', 'Explanation (optional)')}
          </label>
          <textarea
            rows={2}
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            placeholder={bi('解题思路或记忆要点…', 'Explanation or notes…')}
            className="w-full p-3 rounded-xl bg-canvas border border-line text-sm text-ink outline-none focus:border-accent resize-y"
          />
        </div>

        <details className="text-xs">
          <summary className="cursor-pointer text-ink-muted hover:text-ink select-none font-medium">
            {bi('附加阅读材料 Passage（可选）', 'Attach Reading Passage (optional)')}
          </summary>
          <textarea
            rows={3}
            value={psg}
            onChange={(e) => setPsg(e.target.value)}
            placeholder={bi('若有配套短文，作答时会自动开启左右分栏对照…', 'Shown in split pane alongside the question…')}
            className="mt-2 w-full p-3 rounded-xl bg-canvas border border-line text-sm text-ink outline-none focus:border-accent resize-y"
          />
        </details>

        {err && (
          <div className="px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-600 dark:text-red-400">
            {err}
          </div>
        )}
      </div>
    </Modal>
  );
};
