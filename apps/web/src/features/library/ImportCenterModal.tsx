import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCopy,
  Download,
  FileUp,
  Play,
  Sparkles,
} from 'lucide-react';
import type { Question } from '@qs/shared';
import type { LocalQuestion } from '@/db';
import {
  AI_IMPORT_PROMPT,
  BANK_TEMPLATE_JSON,
  extractTextFromFile,
  findSimilarPairs,
  parseLooseJson,
  parsePlainTextQuestions,
  sanitizeImportedBank,
  type JsonSyntaxDiag,
  type SanitizeStats,
} from '@/lib/parsers';
import { isChapterListOutOfOrder, naturalCompare } from '@/lib/text';
import { getSyncEngine } from '@/sync/engine';
import { useQuizStore } from '@/store/useQuizStore';
import { useUiStore } from '@/store/useUiStore';
import { useBi } from '@/i18n/useBi';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

interface ImportCenterModalProps {
  open: boolean;
  existingQuestions: LocalQuestion[];
  onClose: () => void;
}

export const ImportCenterModal: React.FC<ImportCenterModalProps> = ({
  open,
  existingQuestions,
  onClose,
}) => {
  const { bi } = useBi();
  const { pushToast } = useUiStore();
  const startSession = useQuizStore((s) => s.startSession);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [sourceLabel, setSourceLabel] = useState('');
  const [pasteMode, setPasteMode] = useState(false);
  const [rawText, setRawText] = useState('');
  const [defaultSub, setDefaultSub] = useState('导入题目');
  const [defaultChap, setDefaultChap] = useState('未分类');
  const [parseKind, setParseKind] = useState<'json' | 'text'>('json');

  const [previewQs, setPreviewQs] = useState<Question[] | null>(null);
  const [stats, setStats] = useState<SanitizeStats | null>(null);
  const [syntaxDiag, setSyntaxDiag] = useState<JsonSyntaxDiag | null>(null);
  const [autoRepairedSyntax, setAutoRepairedSyntax] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importedIds, setImportedIds] = useState<string[] | null>(null);

  const resetState = () => {
    setSourceLabel('');
    setPasteMode(false);
    setRawText('');
    setPreviewQs(null);
    setStats(null);
    setSyntaxDiag(null);
    setAutoRepairedSyntax(false);
    setImportedIds(null);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const processInput = (text: string, kind: 'json' | 'text', label: string) => {
    setRawText(text);
    setSourceLabel(label);
    setImportedIds(null);
    setSyntaxDiag(null);
    setAutoRepairedSyntax(false);

    if (kind === 'text') {
      const res = parsePlainTextQuestions(text, defaultSub.trim() || '导入题目', defaultChap.trim() || '文本解析');
      setPreviewQs(res.questions);
      setStats(res.stats);
      if (!res.questions.length) {
        pushToast(bi('未能从文本中识别出标准题目，请检查编号与 "答案：" 行格式。', 'No questions recognized in text.'), 'warning');
      }
      return;
    }

    const loose = parseLooseJson(text);
    if (loose.data === null) {
      setPreviewQs(null);
      setStats(null);
      setSyntaxDiag(loose.diag || null);
      return;
    }

    setAutoRepairedSyntax(loose.autoRepaired);
    const san = sanitizeImportedBank(loose.data, defaultSub.trim() || '导入题目', defaultChap.trim() || '未分类');
    setPreviewQs(san.questions);
    setStats(san.stats);
  };

  const handleFile = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      pushToast(bi('文件超过 10MB 上限', 'File exceeds 10MB limit'), 'error');
      return;
    }
    setBusy(true);
    try {
      const extracted = await extractTextFromFile(file);
      setParseKind(extracted.kind);
      processInput(extracted.text, extracted.kind, file.name);
    } catch (err) {
      pushToast(
        bi('文件解析失败：', 'Failed to read file: ') + (err instanceof Error ? err.message : String(err)),
        'error',
      );
    } finally {
      setBusy(false);
    }
  };

  const diffSummary = useMemo(() => {
    if (!previewQs) return null;
    const existingMap = new Map(existingQuestions.map((q) => [q.id, q]));
    let add = 0;
    let update = 0;
    let unchanged = 0;
    const subjects = new Set<string>();
    const chapters = new Map<string, Set<string>>();

    for (const q of previewQs) {
      subjects.add(q.sub);
      const set = chapters.get(q.sub) || new Set<string>();
      set.add(q.chap);
      chapters.set(q.sub, set);

      const ex = existingMap.get(q.id);
      if (!ex) add++;
      else if (
        ex.type === q.type &&
        ex.q === q.q &&
        ex.a === q.a &&
        ex.sub === q.sub &&
        ex.chap === q.chap &&
        JSON.stringify(ex.o) === JSON.stringify(q.o)
      ) {
        unchanged++;
      } else {
        update++;
      }
    }

    const outOfOrderSubs: string[] = [];
    for (const [s, cSet] of chapters) {
      if (isChapterListOutOfOrder(Array.from(cSet))) outOfOrderSubs.push(s);
    }

    const similar = findSimilarPairs(existingQuestions, previewQs);

    return { add, update, unchanged, subjectCount: subjects.size, outOfOrderSubs, similar };
  }, [previewQs, existingQuestions]);

  const handleAutoSortChapters = () => {
    if (!previewQs) return;
    const sorted = [...previewQs].sort(
      (a, b) => naturalCompare(a.sub, b.sub) || naturalCompare(a.chap, b.chap),
    );
    setPreviewQs(sorted);
    pushToast(bi('已按自然章节序号排好预览顺序', 'Sorted preview by chapter numbering'), 'success');
  };

  const handleImportCommit = async () => {
    if (!previewQs?.length) return;
    const engine = getSyncEngine();
    if (!engine) return;

    setBusy(true);
    try {
      await engine.upsertQuestions(previewQs, false);
      setImportedIds(previewQs.map((q) => q.id));
      pushToast(
        bi(`成功导入 ${previewQs.length} 道题目`, `Imported ${previewQs.length} questions`),
        'success',
      );
    } finally {
      setBusy(false);
    }
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(AI_IMPORT_PROMPT);
      pushToast(bi('AI 格式化提示词已复制到剪贴板', 'AI prompt copied'), 'success');
    } catch {
      pushToast(bi('复制失败，请检查剪贴板权限', 'Clipboard unavailable'), 'warning');
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([BANK_TEMPLATE_JSON], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'QuestionBank_Template.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      closeOnBackdrop={false}
      closeOnEsc={false}
      title={bi('题库导入中心', 'Import Center')}
      subtitle={bi('支持 JSON、纯文本、Word (.docx) 与 PDF 解析导入，写入本地并自动云同步', 'JSON, TXT, Word (.docx) and PDF parsing')}
      size="lg"
      footer={
        <div className="w-full flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={copyPrompt}>
              <ClipboardCopy className="w-3.5 h-3.5" />
              {bi('复制 AI 出题提示词', 'Copy AI Prompt')}
            </Button>
            <Button size="sm" variant="ghost" onClick={downloadTemplate}>
              <Download className="w-3.5 h-3.5" />
              {bi('下载标准模板', 'Template')}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={handleClose}>
              {bi('关闭', 'Close')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={busy}
              disabled={!previewQs?.length || Boolean(importedIds)}
              onClick={() => void handleImportCommit()}
            >
              {importedIds
                ? bi('已完成导入', 'Imported')
                : bi(`导入 ${previewQs?.length || 0} 道题`, `Import ${previewQs?.length || 0} Qs`)}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Post-import confirmation banner at top for immediate visibility */}
        {importedIds && (
          <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300 font-medium">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span>
                {bi(
                  `已将 ${importedIds.length} 道题写入本机并发起云端同步。`,
                  `Imported ${importedIds.length} questions and queued sync.`,
                )}
              </span>
            </div>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                if (!previewQs) return;
                const mapped = previewQs.map((q) => ({
                  ...q,
                  version: 1,
                  deletedAt: null,
                  updatedAt: Date.now(),
                }));
                handleClose();
                startSession({ mode: 'filtered', questions: mapped, title: sourceLabel || bi('新导入练习', 'Imported Set') });
              }}
            >
              <Play className="w-3.5 h-3.5" />
              {bi('立即刷这批题', 'Practice Now')}
            </Button>
          </div>
        )}

        {/* Dropzone & Controls */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) void handleFile(file);
          }}
          className={`p-5 rounded-2xl border-2 border-dashed text-center transition-colors ${
            dragging ? 'border-accent bg-accent-soft/50' : 'border-line bg-canvas/50'
          }`}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".json,.txt,.docx,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = '';
            }}
          />
          <div className="flex flex-col items-center gap-2">
            <FileUp className="w-7 h-7 text-accent" />
            <div className="text-sm font-medium text-ink">
              {sourceLabel
                ? bi(`已加载：${sourceLabel}`, `Loaded: ${sourceLabel}`)
                : bi('拖拽 .json / .txt / .docx / .pdf 到这里，或点击选择文件', 'Drop .json / .txt / .docx / .pdf here')}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              <Button size="sm" variant="outline" loading={busy} onClick={() => fileRef.current?.click()}>
                {bi('选择文件', 'Choose File')}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setPasteMode((v) => !v)}>
                {pasteMode ? bi('收起文本框', 'Hide Paste Box') : bi('粘贴 JSON / 文本', 'Paste Text / JSON')}
              </Button>
            </div>
          </div>
        </div>

        {/* Paste box */}
        {pasteMode && (
          <div className="p-4 rounded-xl border border-line bg-canvas/60 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <select
                value={parseKind}
                onChange={(e) => setParseKind(e.target.value as 'json' | 'text')}
                className="h-9 px-2.5 rounded-lg bg-surface border border-line text-xs text-ink outline-none"
              >
                <option value="json">{bi('JSON 题库（宽松容错）', 'JSON Format (Loose)')}</option>
                <option value="text">{bi('纯文本试卷（编号 + 答案：）', 'Plain Text Exam')}</option>
              </select>
              <input
                value={defaultSub}
                onChange={(e) => setDefaultSub(e.target.value)}
                placeholder={bi('默认科目', 'Default Subject')}
                className="h-9 px-2.5 rounded-lg bg-surface border border-line text-xs text-ink outline-none"
              />
              <input
                value={defaultChap}
                onChange={(e) => setDefaultChap(e.target.value)}
                placeholder={bi('默认章节', 'Default Chapter')}
                className="h-9 px-2.5 rounded-lg bg-surface border border-line text-xs text-ink outline-none"
              />
            </div>

            <textarea
              rows={6}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder={
                parseKind === 'json'
                  ? '{\n  "科目": { "章节": [ { "type": "mcq", "q": "...", "o": ["..."], "a": "A" } ] }\n}'
                  : '1. 下列协议属于传输层的是？\nA. TCP\nB. HTTP\n答案：A\n解析：TCP 属于传输层。'
              }
              className="w-full p-3 rounded-xl bg-surface border border-line font-mono text-xs text-ink outline-none focus:border-accent"
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="primary"
                onClick={() =>
                  processInput(rawText, parseKind, bi('粘贴内容', 'Pasted input'))
                }
              >
                {bi('解析并预览', 'Parse & Preview')}
              </Button>
            </div>
          </div>
        )}

        {/* JSON Syntax Error Diagnostics */}
        {syntaxDiag && (
          <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/5 space-y-2 text-xs">
            <div className="font-semibold text-red-600 dark:text-red-400">
              {bi('JSON 语法解析失败', 'JSON Syntax Error')}
              {syntaxDiag.line > 0 && ` (${bi(`第 ${syntaxDiag.line} 行 第 ${syntaxDiag.col} 列`, `Line ${syntaxDiag.line}, Col ${syntaxDiag.col}`)})`}
            </div>
            <div className="text-ink">{syntaxDiag.hint}</div>
            {syntaxDiag.snippetLines.length > 0 && (
              <div className="rounded-lg bg-surface border border-line p-2 font-mono text-[11px] overflow-x-auto">
                {syntaxDiag.snippetLines.map((l) => (
                  <div
                    key={l.num}
                    className={l.isError ? 'bg-red-500/15 text-red-600 dark:text-red-300 font-semibold px-1' : 'text-ink-muted px-1'}
                  >
                    {String(l.num).padStart(4, ' ')} | {l.text}
                  </div>
                ))}
              </div>
            )}
            <Button size="sm" variant="outline" onClick={() => setPasteMode(true)}>
              {bi('在文本框中修正', 'Edit in Paste Box')}
            </Button>
          </div>
        )}

        {/* Preview Summary & Diff */}
        {previewQs && diffSummary && !importedIds && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="accent">
                {bi(`有效题数 ${previewQs.length}`, `${previewQs.length} valid`)}
              </Badge>
              <Badge tone="success">+{diffSummary.add} {bi('新增', 'new')}</Badge>
              <Badge tone="warning">~{diffSummary.update} {bi('覆盖更新', 'update')}</Badge>
              <Badge tone="neutral">={diffSummary.unchanged} {bi('相同跳过', 'identical')}</Badge>
              {autoRepairedSyntax && (
                <Badge tone="warning">{bi('已自动修复尾随逗号/代码围栏', 'Repaired syntax')}</Badge>
              )}
              {(stats?.autoFixed || 0) > 0 && (
                <Badge tone="neutral">{bi(`规范化 ${stats?.autoFixed} 处字段`, `${stats?.autoFixed} normalized`)}</Badge>
              )}
              {(stats?.ignored || 0) > 0 && (
                <Badge tone="danger">{bi(`跳过 ${stats?.ignored} 条异常项`, `${stats?.ignored} invalid skipped`)}</Badge>
              )}
            </div>

            {diffSummary.outOfOrderSubs.length > 0 && (
              <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 flex items-center justify-between gap-2 text-xs text-amber-700 dark:text-amber-300">
                <span className="inline-flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  {bi('检测到部分章节未按编号顺序列出', 'Chapters appear out of numerical order')}
                </span>
                <Button size="sm" variant="outline" onClick={handleAutoSortChapters}>
                  <Sparkles className="w-3.5 h-3.5" />
                  {bi('自然顺序排好', 'Sort Naturally')}
                </Button>
              </div>
            )}

            {diffSummary.similar.length > 0 && (
              <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 text-xs text-amber-800 dark:text-amber-200">
                {bi(
                  `提示：检测到 ${diffSummary.similar.length} 道新题与现有同科题干相似度 ≥ 85%，导入后可在题库排查处理。`,
                  `${diffSummary.similar.length} incoming item(s) look ≥85% similar to existing questions.`,
                )}
              </div>
            )}

            {stats && stats.invalidItems.length > 0 && (
              <details className="text-xs rounded-xl border border-line bg-canvas p-3">
                <summary className="cursor-pointer font-medium text-ink">
                  {bi(`查看被跳过的 ${stats.invalidItems.length} 条异常记录`, `Inspect ${stats.invalidItems.length} skipped items`)}
                </summary>
                <div className="mt-2 space-y-1.5 max-h-36 overflow-y-auto custom-scroll">
                  {stats.invalidItems.map((it, i) => (
                    <div key={i} className="text-[11px] border-b border-line pb-1 last:border-b-0">
                      <span className="font-mono text-ink-muted">[{it.loc}]</span>{' '}
                      <span className="text-red-600 dark:text-red-400 font-medium">{it.reason}</span>
                      <div className="text-ink-muted truncate">{it.q}</div>
                    </div>
                  ))}
                </div>
              </details>
            )}

            <div className="rounded-xl border border-line bg-canvas/50 max-h-56 overflow-y-auto custom-scroll divide-y divide-line">
              {previewQs.slice(0, 40).map((q, idx) => (
                <div key={q.id} className="p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2 text-ink-muted">
                    <span className="font-mono">#{idx + 1} / {q.type}</span>
                    <span className="truncate">{q.sub} / {q.chap}</span>
                  </div>
                  <div className="text-ink font-bold line-clamp-2">{q.q}</div>
                </div>
              ))}
              {previewQs.length > 40 && (
                <div className="p-2.5 text-center text-[11px] text-ink-muted">
                  {bi(`仅展示前 40 题，共 ${previewQs.length} 题将全部导入`, `Showing 40 of ${previewQs.length}`)}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
