import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  KeyRound,
  RotateCcw,
  Send,
  X,
} from 'lucide-react';
import type { LiveStudySnapshot } from '@/sync/hooks';
import { getSyncEngine } from '@/sync/engine';
import { useUiStore } from '@/store/useUiStore';
import { useBi } from '@/i18n/useBi';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';

type EngCat = 'cet4' | 'cet6' | 'kaoyan';

interface PaperMeta {
  id: string;
  title: string;
  file: string;
  qCount: number;
}

interface RawPaperSection {
  label?: string;
  passage?: string;
  words?: string[];
}

interface RawPaperQuestion {
  no: number;
  sec: string;
  q: string;
  o?: string[];
}

interface RawPaperJson {
  sections?: Record<string, RawPaperSection>;
  questions?: RawPaperQuestion[];
}

interface ActiveSession {
  id: string;
  title: string;
  secOrder: string[];
  sections: Record<string, RawPaperSection>;
  secPassages: Record<string, string>;
  clozeSecs: string[];
  questions: Array<{
    no: number;
    sec: string;
    stem: string;
    o: string[];
  }>;
  answers: Record<string, string>;
  graded: boolean;
  result: { correct: number; total: number; selfCheck?: boolean; partial?: boolean; ts: number } | null;
  curSec: string;
}

const CATS: Array<{ key: EngCat; zh: string; en: string }> = [
  { key: 'cet4', zh: '四级真题', en: 'CET-4' },
  { key: 'cet6', zh: '六级真题', en: 'CET-6' },
  { key: 'kaoyan', zh: '考研英语', en: 'Graduate' },
];

const CUSTOM_KEYS_STORAGE = 'qs_eng_answers';

function cleanWord(s: unknown): string {
  return String(s ?? '')
    .split('\n')[0]
    .replace(/^[A-O][).]\s*/, '')
    .replace(/\s*[0-9A-O][).]\s*[A-Za-z].*$/, '')
    .trim();
}

function reflowPassage(text: string): string {
  let t = String(text || '').replace(/\r/g, '');
  t = t.replace(/^\s*Questions?\s+\d+\s+to\s+\d+[^\n]*$/gim, '');
  const markerStart = /^(\[[A-O]\]|[A-O][).]\s+\S|\d{1,2}[.\s]\s*[A-Z“]|(Section|Part|Passage)\b)/i;
  const paras = t.split(/\n{2,}/);
  const outParas: string[] = [];
  for (const para of paras) {
    const lines = para
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) continue;
    let out = '';
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      if (li === 0) out = line;
      else if (markerStart.test(line)) out += '\n\n' + line;
      else out += ' ' + line;
    }
    outParas.push(out);
  }
  return outParas.join('\n\n');
}

function parseKeyText(text: string): Record<string, string> {
  const res: Record<string, string> = {};
  const range = /(\d{1,3})\s*[-–—~]\s*(\d{1,3})\s*[,，:：]?\s*([A-Oa-o][A-Oa-o\s]*)/g;
  let m: RegExpExecArray | null;
  while ((m = range.exec(text)) !== null) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    const letters = m[3].replace(/\s+/g, '').toUpperCase().split('');
    if (b >= a && b - a + 1 === letters.length) {
      for (let i = 0; i < letters.length; i++) res[String(a + i)] = letters[i];
    }
  }
  const single = /(\d{1,3})\s*[.、)）:：]?\s*([A-Oa-o])(?![A-Za-z])/g;
  while ((m = single.exec(text)) !== null) {
    const no = parseInt(m[1], 10);
    if (!(String(no) in res) && no >= 1 && no <= 99) res[String(no)] = m[2].toUpperCase();
  }
  return res;
}

function readCustomKeys(): Record<string, Record<string, string>> {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_KEYS_STORAGE) || '{}') as Record<
      string,
      Record<string, string>
    >;
  } catch {
    return {};
  }
}

export const EnglishView: React.FC<{ data: LiveStudySnapshot }> = ({ data }) => {
  const { bi } = useBi();
  const { confirm, pushToast } = useUiStore();

  const [cat, setCat] = useState<EngCat>('cet4');
  const [builtinKeys, setBuiltinKeys] = useState<Record<string, Record<string, string>> | null>(null);
  const [indexCache, setIndexCache] = useState<Partial<Record<EngCat, PaperMeta[]>>>({});
  const [loadingList, setLoadingList] = useState(false);
  const [customKeys, setCustomKeys] = useState<Record<string, Record<string, string>>>(() => readCustomKeys());

  const [sess, setSess] = useState<ActiveSession | null>(null);
  const [psgFont, setPsgFont] = useState(15);
  const [psgMobileOpen, setPsgMobileOpen] = useState(false);
  const [pickerNo, setPickerNo] = useState<number | null>(null);
  const [keyModalPaper, setKeyModalPaper] = useState<PaperMeta | null>(null);
  const [keyInputText, setKeyInputText] = useState('');

  // Load keys.json (never cache `{}` on failure so retry stays possible)
  useEffect(() => {
    if (builtinKeys !== null) return;
    let cancelled = false;
    void fetch('/english/keys.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json: unknown) => {
        if (!cancelled && json && typeof json === 'object') {
          setBuiltinKeys(json as Record<string, Record<string, string>>);
        }
      })
      .catch(() => {
        if (!cancelled) {
          pushToast(bi('内置答案库加载失败，当前试卷可按自测模式作答', 'Failed to load answer keys'), 'warning');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [builtinKeys, bi, pushToast]);

  // Load index for selected category
  useEffect(() => {
    if (indexCache[cat]) return;
    let cancelled = false;
    setLoadingList(true);
    void fetch(`/english/index-${cat}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((list: PaperMeta[]) => {
        if (!cancelled) {
          setIndexCache((prev) => ({ ...prev, [cat]: Array.isArray(list) ? list : [] }));
        }
      })
      .catch(() => {
        if (!cancelled) pushToast(bi('试卷目录加载失败', 'Failed to load paper index'), 'error');
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cat, indexCache, bi, pushToast]);

  const effectiveKey = (paperId: string): Record<string, string> => {
    const b = builtinKeys?.[paperId] || {};
    const m = customKeys[paperId] || {};
    return { ...b, ...m };
  };

  const persistSession = (nextSess: ActiveSession) => {
    setSess(nextSess);
    void getSyncEngine()?.saveEnglishProgress(nextSess.id, {
      answers: nextSess.answers,
      graded: nextSess.graded,
      result: nextSess.result as Record<string, unknown> | null,
    });
  };

  const openPaper = async (meta: PaperMeta) => {
    try {
      const res = await fetch(`/english/${meta.file}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = (await res.json()) as RawPaperJson;
      const sections: Record<string, RawPaperSection> = {};
      for (const [k, s] of Object.entries(raw.sections || {})) {
        sections[k] = {
          ...s,
          words: Array.isArray(s.words) ? s.words.map(cleanWord) : undefined,
        };
      }

      const questions = (raw.questions || [])
        .slice()
        .sort((a, b) => a.no - b.no)
        .map((q) => {
          const sec = sections[q.sec] || {};
          const bank = sec.words && sec.words.length ? sec.words : null;
          const parts: string[] = [];
          if (sec.label) parts.push(`【${sec.label} / Q${q.no}】`);
          if (q.sec === 'A' && bank) {
            parts.push(bank.map((w, i) => `${String.fromCharCode(65 + i)}. ${w}`).join('   '));
          }
          parts.push(q.q);
          return {
            no: q.no,
            sec: q.sec,
            stem: parts.join('\n\n'),
            o: bank
              ? bank.slice()
              : (q.o || []).map((x) => String(x).replace(/^[A-O][).]\s*/, '')),
          };
        });

      const secOrder: string[] = [];
      for (const q of questions) if (!secOrder.includes(q.sec)) secOrder.push(q.sec);

      const secPassages: Record<string, string> = {};
      for (const sec of secOrder) {
        const p = sections[sec]?.passage;
        if (p) secPassages[sec] = reflowPassage(p);
      }

      const clozeSecs = secOrder.filter((sec) => {
        const sm = sections[sec] || {};
        if (!secPassages[sec]) return false;
        if (!questions.some((q) => q.sec === sec)) return false;
        const hasBank = Array.isArray(sm.words) && sm.words.length > 0;
        return hasBank || /选词填空|完形|cloze/i.test(String(sm.label || ''));
      });

      const saved = data.englishProgressMap.get(meta.id);
      setSess({
        id: meta.id,
        title: meta.title,
        secOrder,
        sections,
        secPassages,
        clozeSecs,
        questions,
        answers: saved?.answers ? { ...saved.answers } : {},
        graded: Boolean(saved?.graded),
        result: (saved?.result as ActiveSession['result']) || null,
        curSec: secOrder[0] || '',
      });
      setPickerNo(null);
      setPsgMobileOpen(false);
    } catch {
      pushToast(bi('试卷加载失败，请重试', 'Failed to open paper'), 'error');
    }
  };

  const assignAnswer = (no: number, letter: string) => {
    if (!sess || sess.graded) return;
    const nextAnswers = { ...sess.answers };
    const key = String(no);
    if (nextAnswers[key] === letter) delete nextAnswers[key];
    else nextAnswers[key] = letter;
    persistSession({ ...sess, answers: nextAnswers });
  };

  const clearBlank = (no: number) => {
    if (!sess || sess.graded) return;
    const nextAnswers = { ...sess.answers };
    delete nextAnswers[String(no)];
    persistSession({ ...sess, answers: nextAnswers });
  };

  const submitPaper = async () => {
    if (!sess || sess.graded) return;
    const answered = Object.keys(sess.answers).length;
    if (answered === 0) {
      pushToast(bi('尚未作答任何题目', 'No answers selected'), 'warning');
      return;
    }
    const remaining = sess.questions.length - answered;
    if (remaining > 0) {
      const ok = await confirm({
        title: bi('确认交卷', 'Submit Paper'),
        message: bi(`还有 ${remaining} 题未作答，确定交卷吗？`, `${remaining} questions unanswered. Submit anyway?`),
      });
      if (!ok) return;
    }

    const paperKey = effectiveKey(sess.id);
    const keyed = sess.questions.filter((q) => paperKey[String(q.no)]);
    if (!keyed.length) {
      persistSession({
        ...sess,
        graded: false,
        result: { correct: 0, total: sess.questions.length, selfCheck: true, ts: Date.now() },
      });
      pushToast(bi('当前试卷无标准答案，已记录为自测完成', 'Completed in self-check mode'), 'info');
      return;
    }

    let correct = 0;
    for (const q of keyed) {
      if ((sess.answers[String(q.no)] || '') === (paperKey[String(q.no)] || '').toUpperCase()) {
        correct++;
      }
    }
    const result = {
      correct,
      total: keyed.length,
      partial: keyed.length < sess.questions.length,
      ts: Date.now(),
    };
    persistSession({ ...sess, graded: true, result });
    pushToast(bi(`判分完成：正确 ${correct}/${keyed.length}`, `Score: ${correct}/${keyed.length}`), 'success');
  };

  const redoPaper = async () => {
    if (!sess) return;
    const ok = await confirm({
      title: bi('重做本卷', 'Reset Paper'),
      message: bi('确定清空本卷作答进度并重做吗？（答案速录保留）', 'Clear current answers and restart?'),
      danger: true,
    });
    if (!ok) return;
    persistSession({ ...sess, answers: {}, graded: false, result: null });
  };

  const groupedPapers = useMemo(() => {
    const list = indexCache[cat] || [];
    const groups: Array<{ year: string; items: PaperMeta[] }> = [];
    for (const p of list) {
      const year = p.id.split('-')[1] || 'Other';
      let g = groups.find((x) => x.year === year);
      if (!g) {
        g = { year, items: [] };
        groups.push(g);
      }
      g.items.push(p);
    }
    return groups;
  }, [indexCache, cat]);

  const engSummary = useMemo(() => {
    const entries = Array.from(data.englishProgressMap.values()).filter((x) => x.result);
    const graded = entries.filter((x) => {
      const r = x.result as { selfCheck?: boolean; correct?: number; total?: number } | null;
      return r && !r.selfCheck && (r.total || 0) > 0;
    });
    const avg = graded.length
      ? Math.round(
          (graded.reduce((acc, x) => {
            const r = x.result as { correct: number; total: number };
            return acc + r.correct / r.total;
          }, 0) /
            graded.length) *
            100,
        )
      : null;
    return { done: entries.length, avg };
  }, [data.englishProgressMap]);

  // Helper to render passage with interactive cloze slots OR A-O paragraph marks (pure React, no HTML string risk)
  const renderPassageContent = () => {
    if (!sess) return null;
    const psg = sess.secPassages[sess.curSec] || '';
    if (!psg) return null;
    const isCloze = sess.clozeSecs.includes(sess.curSec);
    const secQs = sess.questions.filter((q) => q.sec === sess.curSec);
    const keyMap = effectiveKey(sess.id);

    if (isCloze && secQs.length) {
      const nosDesc = secQs.map((q) => q.no).sort((a, b) => b - a);
      const re = new RegExp(`(?<!\\w)(${nosDesc.join('|')})(?!\\w)(?!\\.\\d)`, 'g');
      const parts: React.ReactNode[] = [];
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(psg)) !== null) {
        if (m.index > last) parts.push(psg.slice(last, m.index));
        const no = parseInt(m[1], 10);
        const letter = sess.answers[String(no)];
        const qItem = secQs.find((x) => x.no === no);
        const word = letter && qItem ? qItem.o[letter.charCodeAt(0) - 65] || '' : '';
        const target = (keyMap[String(no)] || '').toUpperCase();
        const gradeCls = sess.graded && target ? (letter === target ? ' ok' : ' bad') : '';
        parts.push(
          <button
            key={`${no}-${m.index}`}
            type="button"
            onClick={() => !sess.graded && setPickerNo(no)}
            className={`eng-blank-slot${letter ? ' filled' : ''}${gradeCls}`}
          >
            {letter ? (
              <>
                <b>{word}</b>
                <i>{no}</i>
              </>
            ) : (
              <i>{no}</i>
            )}
          </button>,
        );
        last = m.index + m[0].length;
      }
      if (last < psg.length) parts.push(psg.slice(last));
      return parts;
    }

    // Highlight [A] / A. marks cleanly
    const paraRe = /(^|\n)(\[?[A-O]\]?[.)])\s+/g;
    const parts: React.ReactNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = paraRe.exec(psg)) !== null) {
      if (m.index > last) parts.push(psg.slice(last, m.index));
      parts.push(m[1]);
      parts.push(
        <span
          key={`mark-${m.index}`}
          className="inline-block px-1.5 py-0.5 mr-1.5 rounded bg-accent-soft text-accent font-sans font-semibold text-xs"
        >
          {m[2]}
        </span>,
      );
      last = m.index + m[0].length;
    }
    if (last < psg.length) parts.push(psg.slice(last));
    return parts;
  };

  if (sess) {
    const keyMap = effectiveKey(sess.id);
    const curSecMeta = sess.sections[sess.curSec] || {};
    const curPsg = sess.secPassages[sess.curSec] || '';
    const isCloze = sess.clozeSecs.includes(sess.curSec);
    const secQs = sess.questions.filter((q) => q.sec === sess.curSec);
    const answeredTotal = Object.keys(sess.answers).length;
    const pickerQ = pickerNo !== null ? sess.questions.find((q) => q.no === pickerNo) : null;
    const pickerIdxInSec = pickerNo !== null ? secQs.findIndex((q) => q.no === pickerNo) : -1;

    return (
      <div className="space-y-4 anim-page-in">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Button variant="outline" size="sm" onClick={() => setSess(null)}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm font-semibold text-ink truncate">{sess.title}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-muted tabular-nums">
              {bi(`已答 ${answeredTotal}/${sess.questions.length}`, `${answeredTotal}/${sess.questions.length}`)}
            </span>
            {sess.graded ? (
              <>
                <Badge tone="success">{bi('已判分', 'Graded')}</Badge>
                <Button size="sm" variant="outline" onClick={() => void redoPaper()}>
                  <RotateCcw className="w-3.5 h-3.5" />
                  {bi('重做本卷', 'Reset')}
                </Button>
              </>
            ) : (
              <Button size="sm" variant="primary" onClick={() => void submitPaper()}>
                <Send className="w-3.5 h-3.5" />
                {bi('交卷', 'Submit')}
              </Button>
            )}
          </div>
        </div>

        {sess.graded && sess.result && (
          <Card padding="sm" className="border-emerald-500/30 bg-emerald-500/5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              <div className="text-sm font-semibold text-ink tabular-nums">
                {bi(
                  `正确率 ${sess.result.total ? Math.round((sess.result.correct / sess.result.total) * 100) : 0}%（${sess.result.correct} / ${sess.result.total}）`,
                  `${sess.result.total ? Math.round((sess.result.correct / sess.result.total) * 100) : 0}% (${sess.result.correct}/${sess.result.total})`,
                )}
              </div>
            </div>
            {sess.result.partial && (
              <Badge tone="warning">{bi('部分题无标准答案，未计入分母', 'Unkeyed items excluded')}</Badge>
            )}
          </Card>
        )}

        {/* Section Tabs */}
        <div className="flex flex-wrap gap-1.5">
          {sess.secOrder.map((sec) => {
            const totalS = sess.questions.filter((q) => q.sec === sec).length;
            const doneS = sess.questions.filter((q) => q.sec === sec && sess.answers[String(q.no)]).length;
            const on = sec === sess.curSec;
            return (
              <button
                key={sec}
                type="button"
                onClick={() => setSess({ ...sess, curSec: sec })}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                  on
                    ? 'bg-accent text-accent-fg border-accent'
                    : 'bg-surface border-line text-ink-muted hover:text-ink'
                }`}
              >
                {sess.sections[sec]?.label || sec}{' '}
                <span className="opacity-75 tabular-nums">
                  {doneS}/{totalS}
                </span>
              </button>
            );
          })}
        </div>

        {/* Split-pane Workspace */}
        <div className={curPsg ? 'grid grid-cols-1 md:grid-cols-12 gap-5 items-start' : ''}>
          {curPsg && (
            <>
              <div className="md:hidden">
                <Button variant="secondary" className="w-full" onClick={() => setPsgMobileOpen(true)}>
                  <BookOpen className="w-4 h-4" />
                  {bi('展开阅读文章 / 选词空位', 'Open Reading Passage')}
                </Button>
              </div>
              <Card className="hidden md:flex md:col-span-6 flex-col max-h-[75vh] sticky top-6">
                <div className="flex items-center justify-between pb-3 mb-3 border-b border-line">
                  <span className="text-xs font-semibold text-ink-muted">{bi('文章 Passage', 'Passage')}</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setPsgFont((v) => Math.max(12, v - 1))}
                      className="px-2 py-0.5 rounded border border-line text-xs text-ink-muted hover:text-ink"
                    >
                      A-
                    </button>
                    <button
                      type="button"
                      onClick={() => setPsgFont((v) => Math.min(22, v + 1))}
                      className="px-2 py-0.5 rounded border border-line text-xs text-ink-muted hover:text-ink"
                    >
                      A+
                    </button>
                  </div>
                </div>
                <div
                  className="flex-1 overflow-y-auto custom-scroll font-serif leading-relaxed whitespace-pre-line text-ink pr-1"
                  style={{ fontSize: `${psgFont}px` }}
                >
                  {renderPassageContent()}
                </div>
                {curSecMeta.words && curSecMeta.words.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-line flex flex-wrap gap-1.5 text-xs">
                    {curSecMeta.words.map((w, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 rounded bg-canvas border border-line text-ink font-mono"
                      >
                        {String.fromCharCode(65 + i)}. {w}
                      </span>
                    ))}
                  </div>
                )}
              </Card>
            </>
          )}

          <div className={curPsg ? 'md:col-span-6 space-y-3' : 'space-y-3'}>
            {isCloze ? (
              <Card className="space-y-2">
                <div className="text-xs text-ink-muted">
                  {bi('点击文章内的空号槽位或下方行选择单词：', 'Click a blank in passage or row below:')}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {secQs.map((q) => {
                    const letter = sess.answers[String(q.no)] || '';
                    const keyAns = (keyMap[String(q.no)] || '').toUpperCase();
                    const word = letter ? q.o[letter.charCodeAt(0) - 65] || '' : '';
                    let cls = 'border-line bg-canvas text-ink';
                    if (sess.graded && keyAns) {
                      cls =
                        letter === keyAns
                          ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          : 'border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300';
                    }
                    return (
                      <button
                        key={q.no}
                        type="button"
                        onClick={() => !sess.graded && setPickerNo(q.no)}
                        className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs transition-colors ${cls}`}
                      >
                        <span className="font-mono font-semibold">Q{q.no}</span>
                        <span className="truncate flex-1 text-left">
                          {letter ? `${letter}. ${word}` : '____'}
                        </span>
                        {sess.graded && keyAns && letter !== keyAns && (
                          <span className="font-mono font-semibold text-emerald-600">{keyAns}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </Card>
            ) : (
              secQs.map((q) => {
                const picked = sess.answers[String(q.no)] || '';
                const keyAns = (keyMap[String(q.no)] || '').toUpperCase();
                const letterOnly = q.o.length > 4 && q.o.every((x) => x.length <= 2);
                return (
                  <Card key={q.no} padding="md" className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-bold text-ink whitespace-pre-line leading-relaxed">
                        {q.stem}
                      </div>
                      <Badge tone="neutral">Q{q.no}</Badge>
                    </div>
                    <div className={letterOnly ? 'flex flex-wrap gap-1.5' : 'space-y-1.5'}>
                      {q.o.map((opt, idx) => {
                        const letter = String.fromCharCode(65 + idx);
                        const sel = picked === letter;
                        let cls = 'border-line bg-canvas text-ink hover:border-accent/60';
                        if (sess.graded && keyAns) {
                          if (letter === keyAns) {
                            cls = 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-medium';
                          } else if (sel) {
                            cls = 'border-red-500 bg-red-500/10 text-red-700 dark:text-red-300';
                          }
                        } else if (sel) {
                          cls = 'border-accent bg-accent-soft text-accent font-medium';
                        }
                        return (
                          <button
                            key={letter}
                            type="button"
                            disabled={sess.graded}
                            onClick={() => assignAnswer(q.no, letter)}
                            className={`${
                              letterOnly
                                ? 'px-3 py-1.5 rounded-lg border text-xs font-mono'
                                : 'w-full text-left px-3 py-2 rounded-xl border text-xs flex items-start gap-2'
                            } transition-colors ${cls}`}
                          >
                            <span className="font-mono font-semibold">{letter}</span>
                            {opt !== letter && <span>{opt}</span>}
                          </button>
                        );
                      })}
                    </div>
                    {sess.graded && keyAns && picked !== keyAns && (
                      <div className="text-xs text-emerald-600 dark:text-emerald-400">
                        {bi('正确答案：', 'Answer: ')}
                        <b>{keyAns}</b>
                      </div>
                    )}
                  </Card>
                );
              })
            )}
          </div>
        </div>

        {/* Mobile Passage Drawer */}
        {curPsg && psgMobileOpen && (
          <div className="fixed inset-0 z-50 md:hidden flex flex-col bg-surface">
            <div className="px-4 py-3 border-b border-line flex items-center justify-between">
              <span className="text-sm font-semibold text-ink">{bi('文章 Passage', 'Passage')}</span>
              <button type="button" onClick={() => setPsgMobileOpen(false)} className="p-1 text-ink-muted">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 font-serif text-sm leading-relaxed whitespace-pre-line text-ink">
              {renderPassageContent()}
            </div>
          </div>
        )}

        {/* Cloze Picker Modal */}
        <Modal
          open={pickerNo !== null && Boolean(pickerQ)}
          onClose={() => setPickerNo(null)}
          title={pickerNo !== null ? `Q${pickerNo}` : ''}
          size="md"
          footer={
            pickerQ && (
              <div className="w-full flex items-center justify-between">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-500"
                  onClick={() => {
                    clearBlank(pickerQ.no);
                    setPickerNo(null);
                  }}
                >
                  {bi('清空此空', 'Clear Blank')}
                </Button>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pickerIdxInSec <= 0}
                    onClick={() => setPickerNo(secQs[pickerIdxInSec - 1].no)}
                  >
                    ← {bi('上一空', 'Prev')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pickerIdxInSec < 0 || pickerIdxInSec >= secQs.length - 1}
                    onClick={() => setPickerNo(secQs[pickerIdxInSec + 1].no)}
                  >
                    {bi('下一空', 'Next')} →
                  </Button>
                </div>
              </div>
            )
          }
        >
          {pickerQ && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {pickerQ.o.map((word, idx) => {
                const letter = String.fromCharCode(65 + idx);
                const active = sess.answers[String(pickerQ.no)] === letter;
                return (
                  <button
                    key={letter}
                    type="button"
                    onClick={() => {
                      assignAnswer(pickerQ.no, letter);
                      setPickerNo(null);
                    }}
                    className={`px-3 py-2.5 rounded-xl border text-left text-xs transition-colors flex items-center gap-2 ${
                      active
                        ? 'border-accent bg-accent-soft text-accent font-semibold'
                        : 'border-line bg-canvas text-ink hover:border-accent/60'
                    }`}
                  >
                    <span className="font-mono font-semibold">{letter}</span>
                    <span className="truncate">{word}</span>
                  </button>
                );
              })}
            </div>
          )}
        </Modal>
      </div>
    );
  }

  return (
    <div className="space-y-6 anim-page-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-ink">
            {bi('英语历年真题', 'English Past Papers')}
          </h1>
        </div>

        <div className="flex items-center gap-4 text-xs text-ink-muted tabular-nums">
          <span>
            {bi('已完成', 'Completed')} <b className="text-ink">{engSummary.done}</b> {bi('套', '')}
          </span>
          {engSummary.avg !== null && (
            <span>
              {bi('平均正确率', 'Avg Accuracy')}{' '}
              <b className="text-emerald-600 dark:text-emerald-400">{engSummary.avg}%</b>
            </span>
          )}
        </div>
      </div>

      <div className="inline-flex p-1 rounded-xl bg-surface-muted border border-line">
        {CATS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setCat(c.key)}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              cat === c.key ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {bi(c.zh, c.en)}
          </button>
        ))}
      </div>

      {loadingList ? (
        <div className="text-xs text-ink-muted py-12 text-center">{bi('正在加载试卷目录…', 'Loading index…')}</div>
      ) : (
        <div className="space-y-5">
          {groupedPapers.map((g) => (
            <div key={g.year} className="space-y-2">
              <h3 className="text-xs font-semibold text-ink-muted px-1">{g.year}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {g.items.map((p) => {
                  const eff = effectiveKey(p.id);
                  const keyedCount = Object.keys(eff).length;
                  const prog = data.englishProgressMap.get(p.id);
                  const res = prog?.result as
                    | { selfCheck?: boolean; correct?: number; total?: number }
                    | undefined;
                  const answeredN = prog ? Object.keys(prog.answers || {}).length : 0;

                  return (
                    <Card key={p.id} padding="sm" className="flex items-center justify-between gap-3 card-hover">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-ink line-clamp-2 leading-snug">{p.title}</div>
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          {res ? (
                            res.selfCheck ? (
                              <Badge tone="accent">{bi('已自测', 'Self-checked')}</Badge>
                            ) : (
                              <Badge tone="success">
                                {res.correct}/{res.total}
                              </Badge>
                            )
                          ) : answeredN > 0 ? (
                            <Badge tone="warning">
                              {bi(`作答中 ${answeredN}/${p.qCount}`, `${answeredN}/${p.qCount}`)}
                            </Badge>
                          ) : keyedCount >= p.qCount ? (
                            <Badge tone="success">{bi('答案就绪', 'Keyed')}</Badge>
                          ) : (
                            <Badge tone="neutral">{bi('可自测', 'Self-check')}</Badge>
                          )}
                          <span className="text-[11px] text-ink-muted tabular-nums">
                            {p.qCount} {bi('题', 'Q')}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const cur = customKeys[p.id] || {};
                            setKeyInputText(
                              Object.keys(cur)
                                .sort((a, b) => Number(a) - Number(b))
                                .map((no) => `${no}. ${cur[no]}`)
                                .join('  '),
                            );
                            setKeyModalPaper(p);
                          }}
                          title={bi('自定义答案速录', 'Custom Answer Key')}
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="sm" variant="primary" onClick={() => void openPaper(p)}>
                          {answeredN > 0 && !prog?.graded ? bi('继续', 'Resume') : bi('开始', 'Open')}
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Custom Key Modal */}
      <Modal
        open={Boolean(keyModalPaper)}
        onClose={() => setKeyModalPaper(null)}
        title={bi('答案速录（本地覆盖层）', 'Custom Answer Key')}
        subtitle={keyModalPaper?.title}
        size="sm"
        footer={
          keyModalPaper && (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="text-red-500"
                onClick={() => {
                  const next = { ...customKeys };
                  delete next[keyModalPaper.id];
                  setCustomKeys(next);
                  try {
                    localStorage.setItem(CUSTOM_KEYS_STORAGE, JSON.stringify(next));
                  } catch {
                    // ignore
                  }
                  setKeyModalPaper(null);
                  pushToast(bi('已清除自定义答案', 'Cleared custom keys'), 'info');
                }}
              >
                {bi('清除', 'Clear')}
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  const parsed = parseKeyText(keyInputText);
                  if (!Object.keys(parsed).length) {
                    pushToast(bi('未识别到有效题号与字母（例如 26-30 CADBE 或 26. A）', 'No valid keys recognized'), 'warning');
                    return;
                  }
                  const next = { ...customKeys, [keyModalPaper.id]: parsed };
                  setCustomKeys(next);
                  try {
                    localStorage.setItem(CUSTOM_KEYS_STORAGE, JSON.stringify(next));
                  } catch {
                    // ignore
                  }
                  setKeyModalPaper(null);
                  pushToast(bi(`已保存 ${Object.keys(parsed).length} 条答案`, 'Saved custom keys'), 'success');
                }}
              >
                {bi('保存', 'Save')}
              </Button>
            </>
          )
        }
      >
        <div className="space-y-2">
          <p className="text-xs text-ink-muted">
            {bi('支持 "26-30 CADBE" 与 "26. A" 格式混排。', 'Supports "26-30 CADBE" and "26. A".')}
          </p>
          <textarea
            rows={5}
            value={keyInputText}
            onChange={(e) => setKeyInputText(e.target.value)}
            placeholder="26-30 CADBE&#10;31-35 DACBD"
            className="w-full p-3 rounded-xl bg-canvas border border-line font-mono text-xs text-ink outline-none focus:border-accent"
          />
        </div>
      </Modal>
    </div>
  );
};
