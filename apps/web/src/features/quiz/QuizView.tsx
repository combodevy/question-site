import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Clock,
  Edit3,
  Grid3X3,
  History,
  RotateCcw,
  Star,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import type { HistoryEntry } from '@qs/shared';
import type { LocalQuestion } from '@/db';
import type { LiveStudySnapshot } from '@/sync/hooks';
import { useQuizStore } from '@/store/useQuizStore';
import { useUiStore } from '@/store/useUiStore';
import { getSyncEngine } from '@/sync/engine';
import { useBi } from '@/i18n/useBi';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { MediaContent } from '@/components/ui/MediaContent';
import { Modal } from '@/components/ui/Modal';

interface QuizViewProps {
  data: LiveStudySnapshot;
  onEditQuestion: (q: LocalQuestion) => void;
  onInspectQuestion: (q: LocalQuestion) => void;
  anyModalOpen: boolean;
}

const MAX_QUESTION_MS = 300_000;

function normalizeFillAnswer(s: string): string {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

export const QuizView: React.FC<QuizViewProps> = ({
  data,
  onEditQuestion,
  onInspectQuestion,
  anyModalOpen,
}) => {
  const { bi } = useBi();
  const { confirm, pushToast, autoNextOnCorrect, setAutoNextOnCorrect } = useUiStore();
  const {
    queue,
    idx,
    answers,
    drafts,
    finished,
    startedAt,
    qStartedAt,
    title,
    setIndex,
    setDraft,
    recordAnswer,
    retryCurrentQuestion,
    finishSession,
    exitSession,
    retryWrong,
  } = useQuizStore();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [psgOpenMobile, setPsgOpenMobile] = useState(false);
  const [psgFontSize, setPsgFontSize] = useState(15);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [multiDraft, setMultiDraft] = useState<Set<string>>(new Set());
  const [autoAdvancing, setAutoAdvancing] = useState(false);
  const autoNextTimerRef = useRef<number | null>(null);

  const clearAutoNext = useCallback(() => {
    if (autoNextTimerRef.current !== null) {
      window.clearTimeout(autoNextTimerRef.current);
      autoNextTimerRef.current = null;
    }
    setAutoAdvancing(false);
  }, []);

  useEffect(() => {
    return () => clearAutoNext();
  }, [clearAutoNext]);

  // Always resolve latest live question record from Dexie snapshot (so live edits reflect immediately)
  const rawQ = queue[idx];
  const q = useMemo(() => {
    if (!rawQ) return undefined;
    return data.questions.find((item) => item.id === rawQ.id) || rawQ;
  }, [rawQ, data.questions]);

  const saved = q ? answers[q.id] : undefined;
  const isAnswered = Boolean(saved?.answered);
  const isStarred = q ? Boolean(data.flagsMap.get(q.id)?.starred) : false;

  // Sync multiDraft whenever question index changes
  useEffect(() => {
    clearAutoNext();
    if (!q) return;
    if (saved?.answered && q.type === 'multi') {
      setMultiDraft(new Set(saved.userAns.split('').filter(Boolean)));
    } else if (q.type === 'multi') {
      setMultiDraft(new Set((drafts[q.id] || '').split('').filter(Boolean)));
    } else {
      setMultiDraft(new Set());
    }
    setPsgOpenMobile(false);
  }, [q?.id, clearAutoNext]); // eslint-disable-line react-hooks/exhaustive-deps

  const goToIndex = useCallback(
    (nextIdx: number) => {
      clearAutoNext();
      setIndex(nextIdx);
    },
    [clearAutoNext, setIndex],
  );

  const handleFinishSession = useCallback(() => {
    clearAutoNext();
    finishSession();
  }, [clearAutoNext, finishSession]);

  const scheduleAutoNext = useCallback(
    (targetQ: LocalQuestion, expectedIdx: number) => {
      if (!useUiStore.getState().autoNextOnCorrect) return;
      clearAutoNext();
      setAutoAdvancing(true);
      const hasRichContext = Boolean((targetQ.media && targetQ.media.length > 0) || targetQ.psg);
      const delay = hasRichContext ? 1000 : 650;
      autoNextTimerRef.current = window.setTimeout(() => {
        autoNextTimerRef.current = null;
        setAutoAdvancing(false);
        const st = useQuizStore.getState();
        if (!st.active || st.finished || st.idx !== expectedIdx) return;
        if (st.idx < st.queue.length - 1) st.setIndex(st.idx + 1);
        else st.finishSession();
      }, delay);
    },
    [clearAutoNext],
  );

  // Elapsed timer per unanswered question
  useEffect(() => {
    if (finished || isAnswered || !qStartedAt) {
      setElapsedSec(0);
      return;
    }
    const tick = () => setElapsedSec(Math.max(0, Math.floor((Date.now() - qStartedAt) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [qStartedAt, isAnswered, finished]);

  const commitAnswer = (userAnsRaw: string, ok: boolean, selfCheck?: boolean) => {
    if (!q || isAnswered || autoAdvancing) return;
    const rawDuration = Math.max(200, Date.now() - (qStartedAt || Date.now()));
    const capped = rawDuration > MAX_QUESTION_MS;
    const durationMs = Math.min(rawDuration, MAX_QUESTION_MS);

    recordAnswer(q.id, {
      answered: true,
      userAns: userAnsRaw,
      ok,
      selfCheck,
      durationMs,
    });

    const now = Date.now();
    const entry: HistoryEntry = {
      rid: `${q.id}::${now}::${Math.random().toString(36).slice(2, 6)}`,
      id: q.id,
      r: ok,
      t: now,
      d: durationMs,
      ...(capped ? { capped: true } : {}),
    };
    void getSyncEngine()?.appendHistory([entry]);

    if (ok) {
      scheduleAutoNext(q, idx);
    }
  };

  const submitChoice = (val: string) => {
    if (!q || isAnswered || autoAdvancing) return;
    if (q.type === 'mcq' || q.type === 'tf') {
      const ok = val.toUpperCase() === q.a.toUpperCase();
      commitAnswer(val.toUpperCase(), ok);
    } else if (q.type === 'multi') {
      const next = new Set(multiDraft);
      if (next.has(val)) next.delete(val);
      else next.add(val);
      setMultiDraft(next);
      setDraft(q.id, Array.from(next).sort().join(''));
    }
  };

  const submitMulti = () => {
    if (!q || isAnswered || autoAdvancing || q.type !== 'multi') return;
    if (multiDraft.size === 0) {
      pushToast(bi('请先选择至少一个选项', 'Select at least one option'), 'warning');
      return;
    }
    const sorted = Array.from(multiDraft).sort().join('');
    const target = q.a.toUpperCase().split('').sort().join('');
    commitAnswer(sorted, sorted === target);
  };

  const submitFill = () => {
    if (!q || isAnswered || autoAdvancing || q.type !== 'fill') return;
    const val = (drafts[q.id] || '').trim();
    if (!val) {
      pushToast(bi('请填写答案后再提交', 'Enter an answer first'), 'warning');
      return;
    }
    const normInput = normalizeFillAnswer(val);
    const acceptable = q.a.split('|').map(normalizeFillAnswer).filter(Boolean);
    commitAnswer(val, acceptable.includes(normInput));
  };

  const handleSelfOverride = (markCorrect: boolean) => {
    if (!q || !saved) return;
    recordAnswer(q.id, { ...saved, ok: markCorrect, selfCheck: true });
    const now = Date.now();
    void getSyncEngine()?.appendHistory([
      {
        rid: `${q.id}::self::${now}`,
        id: q.id,
        r: markCorrect,
        t: now,
        d: 1000,
      },
    ]);
    pushToast(
      markCorrect ? bi('已按自测标记为答对', 'Marked correct via self-check') : bi('已标记为答错', 'Marked wrong'),
      markCorrect ? 'success' : 'info',
    );
    if (markCorrect) {
      scheduleAutoNext(q, idx);
    }
  };

  const handleRetryCurrent = () => {
    clearAutoNext();
    setMultiDraft(new Set());
    retryCurrentQuestion();
  };

  const toggleStar = () => {
    if (!q) return;
    void getSyncEngine()?.setFlag(q.id, { starred: !isStarred });
  };

  const handleExit = async () => {
    clearAutoNext();
    const answeredCount = Object.values(answers).filter((a) => a.answered).length;
    if (!finished && answeredCount < queue.length && answeredCount > 0) {
      const ok = await confirm({
        title: bi('退出本次练习', 'Exit Session'),
        message: bi(
          `已完成 ${answeredCount} / ${queue.length} 题（已作答记录已实时保存）。确定提前退出吗？`,
          `Completed ${answeredCount}/${queue.length}. Answered items are already saved. Exit now?`,
        ),
      });
      if (!ok) return;
    }
    exitSession();
  };

  // Keyboard shortcuts (strictly guarded against inputs/textareas and open modals)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (finished || sheetOpen || anyModalOpen) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (!q) return;

      if (e.key === 'ArrowLeft' && idx > 0) {
        e.preventDefault();
        goToIndex(idx - 1);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (idx < queue.length - 1) goToIndex(idx + 1);
        else handleFinishSession();
        return;
      }
      if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        toggleStar();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (isAnswered) {
          if (idx < queue.length - 1) goToIndex(idx + 1);
          else handleFinishSession();
        } else if (q.type === 'multi' && multiDraft.size > 0) {
          submitMulti();
        }
        return;
      }

      if (!isAnswered && (q.type === 'mcq' || q.type === 'multi')) {
        let optIdx = -1;
        if (/^[1-9]$/.test(e.key)) optIdx = parseInt(e.key, 10) - 1;
        else if (/^[a-iA-I]$/.test(e.key)) optIdx = e.key.toUpperCase().charCodeAt(0) - 65;
        if (optIdx >= 0 && optIdx < q.o.length) {
          e.preventDefault();
          submitChoice(String.fromCharCode(65 + optIdx));
        }
      } else if (!isAnswered && q.type === 'tf') {
        if (e.key === '1' || e.key.toLowerCase() === 't') {
          e.preventDefault();
          submitChoice('T');
        } else if (e.key === '2' || e.key.toLowerCase() === 'f') {
          e.preventDefault();
          submitChoice('F');
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (finished) {
    const answeredList = queue.map((item) => ({ item, state: answers[item.id] }));
    const totalAnswered = answeredList.filter((x) => x.state?.answered).length;
    const correctCount = answeredList.filter((x) => x.state?.answered && x.state.ok).length;
    const wrongItems = answeredList.filter((x) => x.state?.answered && !x.state.ok);
    const acc = totalAnswered > 0 ? Math.round((correctCount / totalAnswered) * 100) : 0;
    const totalSec = Math.max(1, Math.round((Date.now() - (startedAt || Date.now())) / 1000));

    return (
      <div className="max-w-3xl mx-auto space-y-6 py-4">
        <Card padding="lg" className="text-center space-y-4">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full border-4 border-accent/25 bg-accent-soft text-accent text-2xl font-semibold tabular-nums">
            {acc}%
          </div>
          <div>
            <h2 className="text-xl font-semibold text-ink">{bi('本组练习完成', 'Session Complete')}</h2>
            <p className="text-sm text-ink-muted mt-1 tabular-nums">
              {bi(
                `作答 ${totalAnswered} / ${queue.length} 题 | 答对 ${correctCount} 题 | 耗时 ${totalSec} 秒`,
                `Answered ${totalAnswered}/${queue.length} | ${correctCount} correct | ${totalSec}s`,
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
            {wrongItems.length > 0 && (
              <Button variant="primary" onClick={() => retryWrong()}>
                <RotateCcw className="w-4 h-4" />
                {bi(`错题再练 (${wrongItems.length})`, `Retry Wrong (${wrongItems.length})`)}
              </Button>
            )}
            <Button variant="outline" onClick={exitSession}>
              {bi('返回概览', 'Back to Overview')}
            </Button>
          </div>
        </Card>

        {wrongItems.length > 0 && (
          <Card className="space-y-3">
            <h3 className="text-sm font-semibold text-ink">
              {bi(`错题速览 (${wrongItems.length})`, `Wrong Questions (${wrongItems.length})`)}
            </h3>
            <div className="divide-y divide-line">
              {wrongItems.map(({ item, state }) => (
                <div key={item.id} className="py-3 first:pt-0 last:pb-0 space-y-1">
                  <div className="text-sm font-medium text-ink">
                    <MediaContent text={item.q} media={item.media} />
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <span className="text-red-600 dark:text-red-400">
                      {bi('你的作答：', 'Yours: ')}
                      <b>{state?.userAns}</b>
                    </span>
                    <span className="text-emerald-600 dark:text-emerald-400">
                      {bi('正确答案：', 'Answer: ')}
                      <b>{item.a}</b>
                    </span>
                  </div>
                  {item.d && <p className="text-xs text-ink-muted leading-relaxed">{item.d}</p>}
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    );
  }

  if (!q) return null;

  const answeredCount = Object.values(answers).filter((a) => a.answered).length;
  const pct = queue.length > 0 ? Math.round(((idx + 1) / queue.length) * 100) : 0;
  const typeLabelMap: Record<string, string> = {
    mcq: bi('单选题', 'Single Choice'),
    multi: bi('多选题', 'Multiple Choice'),
    tf: bi('判断题', 'True / False'),
    fill: bi('填空题', 'Fill in Blank'),
  };

  return (
    <div className="space-y-5">
      {/* Top Focus Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="sm" onClick={handleExit}>
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">{bi('退出', 'Exit')}</span>
          </Button>
          <div className="min-w-0">
            <div className="text-xs font-medium text-ink truncate">
              {title || `${q.sub} / ${q.chap}`}
            </div>
            <div className="text-[11px] text-ink-muted tabular-nums">
              {bi(`第 ${idx + 1} / ${queue.length} 题 | 已答 ${answeredCount}`, `${idx + 1} / ${queue.length} | ${answeredCount} answered`)}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {!isAnswered && (
            <span className="hidden sm:inline-flex items-center gap-1 px-2.5 h-8 rounded-lg bg-surface border border-line text-xs font-mono text-ink-muted tabular-nums">
              <Clock className="w-3.5 h-3.5" />
              {elapsedSec}s
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoNextOnCorrect(!autoNextOnCorrect)}
            className={autoNextOnCorrect ? 'text-accent border-accent/40 bg-accent-soft/50' : ''}
            title={bi('答对自动跳转下一题', 'Auto-next when correct')}
          >
            <Zap className="w-3.5 h-3.5" />
            <span className="hidden md:inline">
              {autoNextOnCorrect ? bi('自动下一题', 'Auto Next') : bi('手动切题', 'Manual')}
            </span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={toggleStar}
            className={isStarred ? 'text-amber-600 border-amber-400/50 bg-amber-500/10' : ''}
            title={bi('收藏 (快捷键 S)', 'Star (S)')}
          >
            <Star className={`w-3.5 h-3.5 ${isStarred ? 'fill-current' : ''}`} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onInspectQuestion(q)}
            title={bi('历史作答', 'Attempt history')}
          >
            <History className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onEditQuestion(q)}
            title={bi('快速勘误', 'Edit question')}
          >
            <Edit3 className="w-3.5 h-3.5" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSheetOpen(true)}>
            <Grid3X3 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{bi('答题卡', 'Map')}</span>
          </Button>
        </div>
      </div>

      {/* Slim progress hairline */}
      <div className="h-1.5 w-full rounded-full bg-surface-muted overflow-hidden">
        <div className="h-full bg-accent transition-all duration-200" style={{ width: `${pct}%` }} />
      </div>

      {/* Main Question Workspace (auto split-pane when psg exists) */}
      <div className={q.psg ? 'grid grid-cols-1 md:grid-cols-12 gap-5 items-start' : 'max-w-3xl mx-auto'}>
        {q.psg && (
          <>
            <div className="md:hidden">
              <Button variant="secondary" className="w-full" onClick={() => setPsgOpenMobile(true)}>
                <BookOpen className="w-4 h-4" />
                {bi('展开阅读短文', 'Read Passage')}
              </Button>
            </div>
            <Card className="hidden md:flex md:col-span-6 flex-col max-h-[72vh] sticky top-6">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-line">
                <span className="text-xs font-semibold text-ink-muted">{bi('阅读材料 Passage', 'Passage')}</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPsgFontSize((v) => Math.max(12, v - 1))}
                    className="px-2 py-0.5 rounded border border-line text-xs text-ink-muted hover:text-ink"
                  >
                    A-
                  </button>
                  <button
                    type="button"
                    onClick={() => setPsgFontSize((v) => Math.min(22, v + 1))}
                    className="px-2 py-0.5 rounded border border-line text-xs text-ink-muted hover:text-ink"
                  >
                    A+
                  </button>
                </div>
              </div>
              <div
                className="flex-1 overflow-y-auto custom-scroll font-serif leading-relaxed whitespace-pre-wrap text-ink pr-1"
                style={{ fontSize: `${psgFontSize}px` }}
              >
                {q.psg}
              </div>
            </Card>
          </>
        )}

        <div className={q.psg ? 'md:col-span-6 space-y-4' : 'space-y-4'}>
          <Card padding="lg" className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <Badge tone="accent">{typeLabelMap[q.type] || q.type}</Badge>
              <span className="text-xs text-ink-muted truncate">{q.sub} / {q.chap}</span>
            </div>

            <div className="text-base sm:text-[17px] font-medium text-ink leading-relaxed">
              <MediaContent text={q.q} media={q.media} />
            </div>
          </Card>

          {/* Answer Controls */}
          {(q.type === 'mcq' || q.type === 'multi') && (
            <div className="space-y-2.5">
              {q.o.map((opt, i) => {
                const letter = String.fromCharCode(65 + i);
                const selected =
                  q.type === 'multi' ? multiDraft.has(letter) : saved?.userAns === letter;
                const isCorrectOpt = q.a.toUpperCase().includes(letter);

                let boxCls = 'bg-surface border-line hover:border-accent/60';
                let badgeCls = 'bg-surface-muted text-ink-muted border-transparent';

                if (isAnswered) {
                  if (isCorrectOpt) {
                    boxCls = 'bg-emerald-500/10 border-emerald-500/60';
                    badgeCls = 'bg-emerald-600 text-white border-emerald-600';
                  } else if (selected) {
                    boxCls = 'bg-red-500/10 border-red-500/60';
                    badgeCls = 'bg-red-600 text-white border-red-600';
                  } else {
                    boxCls = 'bg-surface/60 border-line opacity-70';
                  }
                } else if (selected) {
                  boxCls = 'bg-accent-soft/60 border-accent';
                  badgeCls = 'bg-accent text-accent-fg border-accent';
                }

                return (
                  <button
                    key={letter}
                    type="button"
                    disabled={isAnswered}
                    onClick={() => submitChoice(letter)}
                    className={`w-full text-left p-4 rounded-2xl border transition-all flex items-start gap-3.5 ${boxCls}`}
                  >
                    <span
                      className={`w-7 h-7 rounded-lg border text-xs font-mono font-semibold flex items-center justify-center flex-shrink-0 transition-colors ${badgeCls}`}
                    >
                      {letter}
                    </span>
                    <span className="text-sm text-ink leading-relaxed pt-0.5 flex-1">{opt}</span>
                  </button>
                );
              })}

              {q.type === 'multi' && !isAnswered && (
                <div className="pt-1 flex items-center justify-between">
                  <span className="text-xs text-ink-muted">
                    {bi('可选择多项，完成后点击提交或按 Enter', 'Select multiple, then submit')}
                  </span>
                  <Button variant="primary" onClick={submitMulti}>
                    <Check className="w-4 h-4" />
                    {bi('确认多选答案', 'Submit Multi')}
                  </Button>
                </div>
              )}
            </div>
          )}

          {q.type === 'tf' && (
            <div className="grid grid-cols-2 gap-3">
              {(['T', 'F'] as const).map((v) => {
                const isSelected = saved?.userAns === v;
                const isCorrectOpt = q.a.toUpperCase() === v;
                let cls = 'bg-surface border-line hover:border-accent/60 text-ink';
                if (isAnswered) {
                  if (isCorrectOpt) cls = 'bg-emerald-500/10 border-emerald-500 text-emerald-700 dark:text-emerald-300';
                  else if (isSelected) cls = 'bg-red-500/10 border-red-500 text-red-700 dark:text-red-300';
                  else cls = 'bg-surface/60 border-line text-ink-muted opacity-60';
                }
                return (
                  <button
                    key={v}
                    type="button"
                    disabled={isAnswered}
                    onClick={() => submitChoice(v)}
                    className={`h-14 rounded-2xl border font-semibold text-base transition-all ${cls}`}
                  >
                    {v === 'T' ? bi('√ 正确', 'True') : bi('× 错误', 'False')}
                  </button>
                );
              })}
            </div>
          )}

          {q.type === 'fill' && (
            <Card className="space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  disabled={isAnswered}
                  value={isAnswered ? saved?.userAns || '' : drafts[q.id] || ''}
                  onChange={(e) => setDraft(q.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !isAnswered) {
                      e.preventDefault();
                      submitFill();
                    }
                  }}
                  placeholder={bi('在此输入填空答案…', 'Type your answer…')}
                  className="flex-1 h-10 px-3.5 rounded-xl bg-canvas border border-line text-sm text-ink outline-none focus:border-accent disabled:opacity-75"
                />
                {!isAnswered && (
                  <Button variant="primary" onClick={submitFill}>
                    {bi('提交', 'Submit')}
                  </Button>
                )}
              </div>
              {isAnswered && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-ink-muted">
                    {bi('参考答案：', 'Accepted: ')}
                    <b className="text-emerald-600 dark:text-emerald-400">
                      {q.a.split('|').join(' / ')}
                    </b>
                  </span>
                  {!saved?.ok && (
                    <Button size="sm" variant="outline" onClick={() => handleSelfOverride(true)}>
                      {bi('语义一致，算我答对', 'Override: Mark Correct')}
                    </Button>
                  )}
                </div>
              )}
            </Card>
          )}

          {/* Feedback & Explanation */}
          {isAnswered && (
            <Card
              className={`space-y-2 ${
                saved?.ok
                  ? 'border-emerald-500/40 bg-emerald-500/5'
                  : 'border-red-500/40 bg-red-500/5'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold text-sm">
                  {saved?.ok ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      <span className="text-emerald-700 dark:text-emerald-300">
                        {autoAdvancing
                          ? bi('回答正确，正在进入下一题…', 'Correct, advancing…')
                          : bi('回答正确', 'Correct')}
                      </span>
                    </>
                  ) : (
                    <>
                      <XCircle className="w-4 h-4 text-red-500" />
                      <span className="text-red-700 dark:text-red-300">
                        {bi(`回答有误 | 正确答案：${q.a}`, `Incorrect | Correct: ${q.a}`)}
                      </span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-ink-muted tabular-nums">
                    {Math.round((saved?.durationMs || 0) / 100) / 10}s
                  </span>
                  <Button size="sm" variant="ghost" onClick={handleRetryCurrent} data-testid="quiz-retry-current">
                    <RotateCcw className="w-3.5 h-3.5" />
                    {bi('重做本题', 'Retry')}
                  </Button>
                </div>
              </div>
              {q.d && <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap pt-1">{q.d}</p>}
            </Card>
          )}

          {/* Bottom Nav Controls */}
          <div className="flex items-center justify-between pt-2">
            <Button
              variant="outline"
              disabled={idx === 0}
              onClick={() => goToIndex(idx - 1)}
            >
              <ArrowLeft className="w-4 h-4" />
              {bi('上一题', 'Previous')}
            </Button>

            <span className="hidden sm:inline text-[11px] text-ink-muted">
              {bi('快捷键：1-4 / A-D 作答 | Enter 下一题 | S 收藏', 'Shortcuts: 1-4 / A-D | Enter next | S star')}
            </span>

            {idx < queue.length - 1 ? (
              <Button variant="primary" onClick={() => goToIndex(idx + 1)}>
                {bi('下一题', 'Next')}
                <ArrowRight className="w-4 h-4" />
              </Button>
            ) : (
              <Button variant="primary" onClick={handleFinishSession}>
                <Check className="w-4 h-4" />
                {bi('查看本次结算', 'Finish Session')}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Passage Drawer */}
      {q.psg && psgOpenMobile && (
        <div className="fixed inset-0 z-50 md:hidden flex flex-col bg-surface">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <span className="text-sm font-semibold text-ink">{bi('阅读材料', 'Passage')}</span>
            <button type="button" onClick={() => setPsgOpenMobile(false)} className="p-1 text-ink-muted">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 font-serif text-sm leading-relaxed whitespace-pre-wrap text-ink">
            {q.psg}
          </div>
        </div>
      )}

      {/* Question Card Sheet Modal */}
      <Modal
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={bi('答题卡导航', 'Question Map')}
        subtitle={bi(`共 ${queue.length} 题，已作答 ${answeredCount} 题`, `${answeredCount} / ${queue.length} answered`)}
        size="md"
        footer={
          <Button variant="primary" size="sm" onClick={() => { setSheetOpen(false); handleFinishSession(); }}>
            {bi('交卷结算', 'Finish Session')}
          </Button>
        }
      >
        <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
          {queue.map((item, i) => {
            const st = answers[item.id];
            const isCurrent = i === idx;
            let cls = 'bg-canvas border-line text-ink-muted';
            if (st?.answered) {
              cls = st.ok
                ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-700 dark:text-emerald-300'
                : 'bg-red-500/15 border-red-500/50 text-red-700 dark:text-red-300';
            }
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  goToIndex(i);
                  setSheetOpen(false);
                }}
                className={`h-9 rounded-xl border text-xs font-mono font-semibold tabular-nums transition-all ${cls} ${
                  isCurrent ? 'ring-2 ring-accent ring-offset-1 ring-offset-surface' : ''
                }`}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      </Modal>
    </div>
  );
};
