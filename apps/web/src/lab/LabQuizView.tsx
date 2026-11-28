import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  Grid3X3,
  Highlighter,
  Lightbulb,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Star,
  X,
  XCircle,
} from 'lucide-react';
import {
  formatFillAnswerDisplay,
  gradeFillBlanks,
  parseFillBlanks,
  previewFsrsIntervals,
  type FsrsRating,
  type LabConfidence,
  type LabHistoryEntry,
} from '@qs/shared';
import type { LabQuestion } from '@/lab/db';
import type { LiveLabSnapshot, LabStats } from '@/lab/hooks';
import { useLabAuthStore } from '@/lab/useLabAuthStore';
import { useLabQuizStore } from '@/lab/useLabQuizStore';
import { getLabSyncEngine } from '@/lab/syncEngine';
import { useUiStore } from '@/store/useUiStore';
import { useBi } from '@/i18n/useBi';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { MediaContent } from '@/components/ui/MediaContent';
import { Modal } from '@/components/ui/Modal';

interface LabQuizViewProps {
  data: LiveLabSnapshot;
  stats: LabStats;
  anyModalOpen: boolean;
}

const MAX_QUESTION_MS = 300_000;

function parseFillDraftValues(raw: string | undefined, blankCount: number): string[] {
  const count = Math.max(1, blankCount);
  if (count === 1) return [raw || ''];
  if (raw && raw.startsWith('[')) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return Array.from({ length: count }, (_, i) => String(arr[i] ?? ''));
      }
    } catch {
      // fall through
    }
  }
  const parts = raw ? raw.split(';;') : [];
  return Array.from({ length: count }, (_, i) => parts[i] ?? '');
}

function serializeFillDraftValues(vals: string[], blankCount: number): string {
  return blankCount <= 1 ? vals[0] || '' : JSON.stringify(vals);
}

function formatUserFillDisplay(userAns: string | undefined, blankCount: number): string {
  if (!userAns) return '';
  if (blankCount <= 1) return userAns;
  return parseFillDraftValues(userAns, blankCount)
    .map((v, i) => `(${i + 1}) ${v}`)
    .join('   ');
}

function renderPassageWithHighlights(text: string, highlights: string[]) {
  if (!highlights.length) return text;
  let segments: Array<{ text: string; mark: boolean }> = [{ text, mark: false }];
  for (const snippet of highlights) {
    if (!snippet) continue;
    const next: Array<{ text: string; mark: boolean }> = [];
    for (const seg of segments) {
      if (seg.mark) {
        next.push(seg);
        continue;
      }
      const idx = seg.text.indexOf(snippet);
      if (idx === -1) {
        next.push(seg);
        continue;
      }
      if (idx > 0) next.push({ text: seg.text.slice(0, idx), mark: false });
      next.push({ text: snippet, mark: true });
      if (idx + snippet.length < seg.text.length) {
        next.push({ text: seg.text.slice(idx + snippet.length), mark: false });
      }
    }
    segments = next;
  }
  return segments.map((s, i) =>
    s.mark ? (
      <mark key={i} className="bg-amber-300/60 dark:bg-amber-500/35 text-ink rounded px-0.5">
        {s.text}
      </mark>
    ) : (
      <React.Fragment key={i}>{s.text}</React.Fragment>
    ),
  );
}

export const LabQuizView: React.FC<LabQuizViewProps> = ({ data, stats, anyModalOpen }) => {
  const { bi } = useBi();
  const user = useLabAuthStore((s) => s.user);
  const { confirm, pushToast } = useUiStore();
  const {
    queue,
    idx,
    answers,
    drafts,
    settings,
    mode,
    title,
    startedAt,
    qStartedAt,
    finished,
    setIndex,
    setDraft,
    recordAnswer,
    patchAnswerConfidence,
    requeueQuestionLater,
    submitDelayedExam,
    retryCurrentItem,
    finishSession,
    exitSession,
    retryWrong,
  } = useLabQuizStore();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [psgOpenMobile, setPsgOpenMobile] = useState(false);
  const [psgFontSize, setPsgFontSize] = useState(15);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [multiDraft, setMultiDraft] = useState<Set<string>>(new Set());
  const [confidence, setConfidence] = useState<LabConfidence | undefined>(undefined);
  const [confHighlight, setConfHighlight] = useState(false);
  const [optionsRevealed, setOptionsRevealed] = useState(false);
  const [qaRevealed, setQaRevealed] = useState(false);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [hintCooldownUntil, setHintCooldownUntil] = useState(0);
  const [requeueNotice, setRequeueNotice] = useState(false);
  const [highlightsMap, setHighlightsMap] = useState<Record<string, string[]>>(() => {
    try {
      const raw = localStorage.getItem(`qs_lab_highlights_${user?.id || 'anon'}`);
      return raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
    } catch {
      return {};
    }
  });

  const fillInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const passageContainerRef = useRef<HTMLDivElement | null>(null);

  const item = queue[idx];
  const q: LabQuestion | undefined = useMemo(() => {
    if (!item) return undefined;
    return data.questions.find((dq) => dq.id === item.questionId) || item.question;
  }, [item, data.questions]);

  const saved = item ? answers[item.instanceId] : undefined;
  const isAnswered = Boolean(saved?.answered);
  const isStarred = q ? Boolean(data.flagsMap.get(q.id)?.starred) : false;

  // Reset transient item state when current instance changes
  useEffect(() => {
    fillInputRefs.current = [];
    setQaRevealed(false);
    setHintsUsed(0);
    setRequeueNotice(false);
    setConfHighlight(false);
    setPsgOpenMobile(false);

    if (!item || !q) return;
    setConfidence(saved?.conf);
    const shouldHideOpts =
      settings.blindRecall &&
      (q.type === 'mcq' || q.type === 'multi') &&
      !saved?.answered;
    setOptionsRevealed(!shouldHideOpts);

    if (saved?.answered && q.type === 'multi') {
      setMultiDraft(new Set(saved.userAns.split('').filter(Boolean)));
    } else if (q.type === 'multi') {
      setMultiDraft(new Set((drafts[item.instanceId] || '').split('').filter(Boolean)));
    } else {
      setMultiDraft(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.instanceId]);

  useEffect(() => {
    if (finished || isAnswered || !qStartedAt || settings.hideTimer) {
      setElapsedSec(0);
      return;
    }
    const tick = () => setElapsedSec(Math.max(0, Math.floor((Date.now() - qStartedAt) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [qStartedAt, isAnswered, finished, settings.hideTimer]);

  const existingRecordsForQ = useMemo(() => {
    if (!q) return [];
    return data.history.filter((h) => h.id === q.id);
  }, [data.history, q]);

  const qaIntervalPreview = useMemo(() => {
    if (!q || q.type !== 'qa') return null;
    return previewFsrsIntervals(existingRecordsForQ, {
      desiredRetention: settings.desiredRetention,
      medianDurationMs: stats.medianDurationMs,
    });
  }, [q, existingRecordsForQ, settings.desiredRetention, stats.medianDurationMs]);

  const eliminatedOrigIndex = useMemo(() => {
    if (!q || hintsUsed < 1 || q.type !== 'mcq' || q.o.length < 3) return -1;
    const correctIdx = q.a.toUpperCase().charCodeAt(0) - 65;
    for (const origIdx of item?.optionOrder || []) {
      if (origIdx !== correctIdx) return origIdx;
    }
    return -1;
  }, [q, hintsUsed, item]);

  const savePassageHighlight = () => {
    if (!q || typeof window === 'undefined') return;
    const sel = window.getSelection()?.toString().trim() || '';
    if (!sel || sel.length < 2) {
      pushToast(bi('请先用鼠标选中短文中的关键句', 'Select key text in the passage first'), 'info');
      return;
    }
    setHighlightsMap((prev) => {
      const existing = prev[q.id] || [];
      if (existing.includes(sel)) return prev;
      const next = { ...prev, [q.id]: [...existing, sel.slice(0, 180)] };
      try {
        localStorage.setItem(`qs_lab_highlights_${user?.id || 'anon'}`, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
    window.getSelection()?.removeAllRanges();
    pushToast(bi('已标注关键依据句', 'Highlighted evidence sentence'), 'success');
  };

  const clearPassageHighlights = () => {
    if (!q) return;
    setHighlightsMap((prev) => {
      const next = { ...prev };
      delete next[q.id];
      try {
        localStorage.setItem(`qs_lab_highlights_${user?.id || 'anon'}`, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const handleRequestHint = () => {
    if (!q || isAnswered || hintsUsed >= 2) return;
    const now = Date.now();
    if (now < hintCooldownUntil) {
      pushToast(bi('请先独立思考几秒再看下一级提示', 'Wait a moment before next scaffold hint'), 'info');
      return;
    }
    setHintsUsed((v) => Math.min(2, v + 1));
    setHintCooldownUntil(now + 3000);
  };

  const commitAnswer = (
    userAnsRaw: string,
    ok: boolean,
    explicitRating?: FsrsRating,
  ) => {
    if (!item || !q || isAnswered) return;

    // Require confidence if enabled and not an explicit QA 4-tier rating
    if (settings.confidenceMode === 'required' && !explicitRating && !confidence) {
      setConfHighlight(true);
      pushToast(bi('请先选择本次把握度（Z / X / C）', 'Select confidence level first (Z / X / C)'), 'warning');
      return;
    }

    const rawDuration = Math.max(200, Date.now() - (qStartedAt || Date.now()));
    const capped = rawDuration > MAX_QUESTION_MS;
    const durationMs = Math.min(rawDuration, MAX_QUESTION_MS);
    const now = Date.now();
    const rid = `${q.id}::lab::${now}::${Math.random().toString(36).slice(2, 6)}`;
    const blindUsed = Boolean(settings.blindRecall && (q.type === 'mcq' || q.type === 'multi'));

    const chosenConf = confidence;
    recordAnswer(item.instanceId, {
      answered: true,
      userAns: userAnsRaw,
      ok,
      conf: chosenConf,
      rating: explicitRating,
      durationMs,
      blindUsed,
      hintsUsed,
      recordedAt: now,
      historyRid: rid,
    });

    if (!settings.delayedFeedback) {
      const entry: LabHistoryEntry = {
        rid,
        id: q.id,
        r: ok,
        t: now,
        d: durationMs,
        ...(capped ? { capped: true } : {}),
        ...(chosenConf ? { conf: chosenConf } : {}),
        ...(explicitRating ? { rating: explicitRating } : {}),
        mode,
        ...(blindUsed ? { blind: true } : {}),
        ...(item.isRequeued ? { requeued: true } : {}),
      };
      void getLabSyncEngine()?.appendHistory([entry]);

      if (!ok && settings.requeueWrong) {
        const queued = requeueQuestionLater(item.instanceId, 4);
        if (queued) setRequeueNotice(true);
      }
    }
  };

  const submitChoice = (origLetter: string) => {
    if (!item || !q || isAnswered) return;
    if (q.type === 'mcq' || q.type === 'tf') {
      const ok = origLetter.toUpperCase() === q.a.toUpperCase();
      commitAnswer(origLetter.toUpperCase(), ok);
    } else if (q.type === 'multi') {
      const next = new Set(multiDraft);
      if (next.has(origLetter)) next.delete(origLetter);
      else next.add(origLetter);
      setMultiDraft(next);
      setDraft(item.instanceId, Array.from(next).sort().join(''));
    }
  };

  const submitMulti = () => {
    if (!q || isAnswered || q.type !== 'multi') return;
    if (multiDraft.size === 0) {
      pushToast(bi('请先选择至少一个选项', 'Select at least one option'), 'warning');
      return;
    }
    const sorted = Array.from(multiDraft).sort().join('');
    const target = q.a.toUpperCase().split('').sort().join('');
    commitAnswer(sorted, sorted === target);
  };

  const submitFill = () => {
    if (!item || !q || isAnswered || q.type !== 'fill') return;
    const expectedBlanks = parseFillBlanks(q.a);
    const blankCount = Math.max(1, expectedBlanks.length);
    const inputs = parseFillDraftValues(drafts[item.instanceId], blankCount).map((s) => s.trim());
    if (inputs.some((v) => !v)) {
      pushToast(
        blankCount > 1
          ? bi('请填写全部空位后再提交', 'Fill in all blanks before submitting')
          : bi('请填写答案后再提交', 'Enter an answer first'),
        'warning',
      );
      return;
    }
    const { allOk } = gradeFillBlanks(inputs, q.a);
    commitAnswer(serializeFillDraftValues(inputs, blankCount), allOk);
  };

  const handleQaRate = (rating: FsrsRating) => {
    if (!item || !q || isAnswered) return;
    const ok = rating >= 2;
    const summaryText = (drafts[item.instanceId] || '').trim() || `FSRS-${rating}`;
    commitAnswer(summaryText, ok, rating);
  };

  const handleMarkAsLuckyGuess = () => {
    if (!item || !saved || !saved.answered || !saved.ok) return;
    patchAnswerConfidence(item.instanceId, 1);
    setConfidence(1);
    pushToast(
      bi('已标记为低自信蒙对，FSRS 将在 1-2 天内安排确认复测', 'Marked lucky guess; review scheduled in 1-2 days'),
      'info',
    );
  };

  const toggleStar = () => {
    if (!q) return;
    void getLabSyncEngine()?.setFlag(q.id, { starred: !isStarred });
  };

  const handleExit = async () => {
    const answeredCount = Object.values(answers).filter((a) => a.answered).length;
    if (!finished && answeredCount < queue.length && answeredCount > 0) {
      const msg = settings.delayedFeedback
        ? bi(
            `模拟考模式尚有未交卷的 ${answeredCount} 题未上传。确定放弃本次会话吗？`,
            `Delayed exam mode has ${answeredCount} unsubmitted items. Exit and discard?`,
          )
        : bi(
            `已完成 ${answeredCount} / ${queue.length} 题（已作答记录已保存）。确定提前退出吗？`,
            `Completed ${answeredCount}/${queue.length}. Answered records are saved. Exit now?`,
          );
      const ok = await confirm({
        title: bi('退出科学精练', 'Exit Lab Session'),
        message: msg,
      });
      if (!ok) return;
    }
    exitSession();
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (finished || sheetOpen || anyModalOpen || !item || !q) return;
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

      if (e.key === 'ArrowLeft' && idx > 0) {
        e.preventDefault();
        setIndex(idx - 1);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (idx < queue.length - 1) setIndex(idx + 1);
        else finishSession();
        return;
      }
      if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        toggleStar();
        return;
      }

      // Confidence hotkeys Z/X/C
      if (!isAnswered && settings.confidenceMode !== 'off') {
        const k = e.key.toLowerCase();
        if (k === 'z') {
          e.preventDefault();
          setConfidence(3);
          setConfHighlight(false);
          return;
        }
        if (k === 'x') {
          e.preventDefault();
          setConfidence(2);
          setConfHighlight(false);
          return;
        }
        if (k === 'c') {
          e.preventDefault();
          setConfidence(1);
          setConfHighlight(false);
          return;
        }
      }

      // G to flag lucky guess right after immediate correct answer
      if (isAnswered && !settings.delayedFeedback && saved?.ok && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        handleMarkAsLuckyGuess();
        return;
      }

      // Space reveals blind options or QA reference answer
      if (e.key === ' ') {
        if (!optionsRevealed && (q.type === 'mcq' || q.type === 'multi')) {
          e.preventDefault();
          setOptionsRevealed(true);
          return;
        }
        if (q.type === 'qa' && !qaRevealed && !isAnswered) {
          e.preventDefault();
          setQaRevealed(true);
          return;
        }
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        if (isAnswered) {
          if (idx < queue.length - 1) setIndex(idx + 1);
          else finishSession();
        } else if (q.type === 'multi' && optionsRevealed && multiDraft.size > 0) {
          submitMulti();
        }
        return;
      }

      if (!isAnswered && optionsRevealed && (q.type === 'mcq' || q.type === 'multi')) {
        let visIdx = -1;
        if (/^[1-9]$/.test(e.key)) visIdx = parseInt(e.key, 10) - 1;
        else if (/^[a-iA-I]$/.test(e.key)) visIdx = e.key.toUpperCase().charCodeAt(0) - 65;
        if (visIdx >= 0 && visIdx < item.optionOrder.length) {
          e.preventDefault();
          const origIdx = item.optionOrder[visIdx];
          submitChoice(String.fromCharCode(65 + origIdx));
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
    const answeredList = queue.map((it) => ({ it, state: answers[it.instanceId] }));
    const totalAnswered = answeredList.filter((x) => x.state?.answered).length;
    const correctCount = answeredList.filter((x) => x.state?.answered && x.state.ok).length;
    const wrongItems = answeredList.filter((x) => x.state?.answered && !x.state.ok);
    const hyperItems = wrongItems.filter((x) => x.state?.conf === 3);
    const guessOkItems = answeredList.filter((x) => x.state?.answered && x.state.ok && x.state.conf === 1);
    const acc = totalAnswered > 0 ? Math.round((correctCount / totalAnswered) * 100) : 0;
    const totalSec = Math.max(1, Math.round((Date.now() - (startedAt || Date.now())) / 1000));

    return (
      <div className="max-w-3xl mx-auto space-y-6 py-4 anim-page-in" data-testid="lab-session-summary">
        <Card padding="lg" className="text-center space-y-4 anim-modal-in">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full border-4 border-accent/25 bg-accent-soft text-accent text-2xl font-semibold tabular-nums">
            {acc}%
          </div>
          <div>
            <h2 className="text-xl font-semibold text-ink">
              {settings.delayedFeedback
                ? bi('模拟考延迟评估完成', 'Delayed Exam Graded')
                : bi('科学精练会话完成', 'Science Session Complete')}
            </h2>
            <p className="text-sm text-ink-muted mt-1 tabular-nums">
              {bi(
                `作答 ${totalAnswered} / ${queue.length} 题 | 答对 ${correctCount} 题 | 用时 ${totalSec} 秒`,
                `Answered ${totalAnswered}/${queue.length} | ${correctCount} correct | ${totalSec}s`,
              )}
            </p>
          </div>

          {(hyperItems.length > 0 || guessOkItems.length > 0) && (
            <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
              {hyperItems.length > 0 && (
                <Badge tone="danger">
                  {bi(`高自信误区 ${hyperItems.length} 题（已安排 4 天内强复测）`, `${hyperItems.length} Hypercorrection Risks (<=4d)`)}
                </Badge>
              )}
              {guessOkItems.length > 0 && (
                <Badge tone="warning">
                  {bi(`低自信蒙对 ${guessOkItems.length} 题（已缩短间隔至 1-2 天）`, `${guessOkItems.length} Lucky Guesses (1-2d)`)}
                </Badge>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
            {wrongItems.length > 0 && (
              <Button variant="primary" onClick={() => retryWrong()}>
                <RotateCcw className="w-4 h-4" />
                {bi(`错题巩固再练 (${wrongItems.length})`, `Retry Wrong (${wrongItems.length})`)}
              </Button>
            )}
            <Button variant="outline" onClick={exitSession}>
              {bi('返回精练概览', 'Back to Lab Overview')}
            </Button>
          </div>
        </Card>

        {wrongItems.length > 0 && (
          <Card className="space-y-3">
            <h3 className="text-sm font-semibold text-ink">
              {bi(`本场错题与精析 (${wrongItems.length})`, `Wrong Items & Explanations (${wrongItems.length})`)}
            </h3>
            <div className="divide-y divide-line">
              {wrongItems.map(({ it, state }) => (
                <div key={it.instanceId} className="py-3 first:pt-0 last:pb-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge tone="neutral">{it.question.sub} / {it.question.chap}</Badge>
                    {state?.conf === 3 && (
                      <Badge tone="danger">{bi('高自信误区', 'High-Conf Error')}</Badge>
                    )}
                  </div>
                  <div className="text-sm font-bold text-ink">
                    <MediaContent text={it.question.q} media={it.question.media} />
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <span className="text-red-600 dark:text-red-400">
                      {bi('你的作答：', 'Yours: ')}
                      <b>
                        {it.question.type === 'fill'
                          ? formatUserFillDisplay(state?.userAns, parseFillBlanks(it.question.a).length)
                          : state?.userAns}
                      </b>
                    </span>
                    <span className="text-emerald-600 dark:text-emerald-400">
                      {bi('正确答案：', 'Answer: ')}
                      <b className="whitespace-pre-wrap">
                        {it.question.type === 'fill'
                          ? formatFillAnswerDisplay(it.question.a)
                          : it.question.a}
                      </b>
                    </span>
                  </div>
                  {it.question.d && (
                    <p className="text-xs text-ink-muted leading-relaxed whitespace-pre-wrap">{it.question.d}</p>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    );
  }

  if (!item || !q) return null;

  const answeredCount = Object.values(answers).filter((a) => a.answered).length;
  const pct = queue.length > 0 ? Math.round(((idx + 1) / queue.length) * 100) : 0;
  const typeLabelMap: Record<string, string> = {
    mcq: bi('单选题', 'Single Choice'),
    multi: bi('多选题', 'Multiple Choice'),
    tf: bi('判断题', 'True / False'),
    fill: bi('填空题', 'Fill in Blank'),
    qa: bi('问答题', 'Q&A'),
  };
  const fillBlanks = q.type === 'fill' ? parseFillBlanks(q.a) : [];
  const fillBlankCount = Math.max(1, fillBlanks.length);
  const fillValues = q.type === 'fill'
    ? parseFillDraftValues(isAnswered ? saved?.userAns : drafts[item.instanceId], fillBlankCount)
    : [];
  const fillGrade = q.type === 'fill' && isAnswered ? gradeFillBlanks(fillValues, q.a) : null;
  const currentHighlights = highlightsMap[q.id] || [];

  const canShowFeedbackNow = isAnswered && !settings.delayedFeedback;

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
            <div className="text-xs font-medium text-ink truncate flex items-center gap-1.5">
              <span>{title || `${q.sub} / ${q.chap}`}</span>
              {item.isRequeued && (
                <Badge tone="warning">{bi('组内回炉重测', 'Requeued')}</Badge>
              )}
            </div>
            <div className="text-[11px] text-ink-muted tabular-nums">
              {bi(`第 ${idx + 1} / ${queue.length} 题 | 已答 ${answeredCount}`, `${idx + 1} / ${queue.length} | ${answeredCount} answered`)}
              {settings.delayedFeedback && ` | ${bi('延迟评估中', 'Delayed Exam')}`}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {!isAnswered && !settings.hideTimer && (
            <span className="hidden sm:inline-flex items-center gap-1 px-2.5 h-8 rounded-lg bg-surface border border-line text-xs font-mono text-ink-muted tabular-nums">
              <Clock className="w-3.5 h-3.5" />
              {elapsedSec}s
            </span>
          )}
          {!isAnswered && hintsUsed < 2 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRequestHint}
              data-testid="lab-hint-btn"
              title={bi('渐进支架提示（3秒防滥用冷却）', 'Scaffolded hint (3s cooldown)')}
            >
              <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
              <span className="hidden sm:inline">
                {hintsUsed === 0 ? bi('线索 1', 'Hint 1') : bi('线索 2', 'Hint 2')}
              </span>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={toggleStar}
            className={isStarred ? 'text-amber-600 border-amber-400/50 bg-amber-500/10' : ''}
            title={bi('科学精练收藏 (S)', 'Lab Star (S)')}
          >
            <Star className={`w-3.5 h-3.5 ${isStarred ? 'fill-current' : ''}`} />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSheetOpen(true)}>
            <Grid3X3 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{bi('答题卡', 'Map')}</span>
          </Button>
          {settings.delayedFeedback && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => submitDelayedExam()}
              data-testid="lab-delayed-submit-btn"
            >
              <Check className="w-3.5 h-3.5" />
              {bi('交卷看精析', 'Grade All')}
            </Button>
          )}
        </div>
      </div>

      {/* Slim progress hairline */}
      <div className="h-1.5 w-full rounded-full bg-surface-muted overflow-hidden">
        <div className="h-full bg-accent transition-all duration-500 ease-out" style={{ width: `${pct}%` }} />
      </div>

      <div
        key={item.instanceId}
        className={`${q.psg ? 'grid grid-cols-1 md:grid-cols-12 gap-5 items-start' : 'max-w-3xl mx-auto'} anim-question-in`}
      >
        {/* Reading Passage Split-Pane with Highlight Tools */}
        {q.psg && (
          <>
            <div className="md:hidden">
              <Button variant="secondary" className="w-full" onClick={() => setPsgOpenMobile(true)}>
                <BookOpen className="w-4 h-4" />
                {bi('展开阅读短文', 'Read Passage')}
              </Button>
            </div>
            <Card className="hidden md:flex md:col-span-6 flex-col max-h-[72vh] sticky top-6">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-line gap-2">
                <span className="text-xs font-semibold text-ink-muted">{bi('阅读材料', 'Passage')}</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={savePassageHighlight}
                    title={bi('高亮选中依据句', 'Highlight selection')}
                    className="px-2 py-0.5 rounded border border-line text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1"
                  >
                    <Highlighter className="w-3 h-3 text-amber-500" />
                    {bi('标亮', 'Mark')}
                  </button>
                  {currentHighlights.length > 0 && (
                    <button
                      type="button"
                      onClick={clearPassageHighlights}
                      className="px-2 py-0.5 rounded border border-line text-xs text-ink-muted hover:text-ink"
                    >
                      {bi('清除', 'Clear')}
                    </button>
                  )}
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
                ref={passageContainerRef}
                className="flex-1 overflow-y-auto custom-scroll font-serif leading-relaxed whitespace-pre-wrap text-ink pr-1"
                style={{ fontSize: `${psgFontSize}px` }}
              >
                {renderPassageWithHighlights(q.psg, currentHighlights)}
              </div>
            </Card>
          </>
        )}

        <div className={q.psg ? 'md:col-span-6 space-y-4' : 'space-y-4'}>
          <Card padding="lg" className="space-y-3.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <Badge tone="accent">{typeLabelMap[q.type] || q.type}</Badge>
                {settings.shuffleOptions && (q.type === 'mcq' || q.type === 'multi') && (
                  <Badge tone="neutral">{bi('选项已乱序', 'Shuffled')}</Badge>
                )}
              </div>
              <span className="text-xs text-ink-muted truncate">{q.sub} / {q.chap}</span>
            </div>

            <div className="text-base sm:text-[17px] font-bold text-ink leading-relaxed">
              <MediaContent text={q.q} media={q.media} />
            </div>

            {/* Scaffolded Hint Panel */}
            {hintsUsed > 0 && !canShowFeedbackNow && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-800 dark:text-amber-200 space-y-1 anim-slide-down">
                <div className="font-semibold flex items-center gap-1.5">
                  <Lightbulb className="w-3.5 h-3.5" />
                  {bi('支架提示', 'Scaffold Hint')}
                </div>
                {hintsUsed >= 1 && (
                  <div>
                    {q.type === 'mcq' && eliminatedOrigIndex >= 0
                      ? bi('线索 1：已帮你排除一个明显干扰项（已置灰）。', 'Hint 1: One distractor has been eliminated below.')
                      : q.type === 'fill'
                      ? bi(`线索 1：共有 ${fillBlankCount} 个空位，请留意核心专业术语。`, `Hint 1: Expecting ${fillBlankCount} blank(s).`)
                      : bi(`线索 1：本题所属知识模块为 ${q.sub} / ${q.chap}。`, `Hint 1: Focus on ${q.sub} / ${q.chap}.`)}
                  </div>
                )}
                {hintsUsed >= 2 && (
                  <div>
                    {q.d
                      ? bi(`线索 2：${q.d.slice(0, 80)}${q.d.length > 80 ? '...' : ''}`, `Hint 2: ${q.d.slice(0, 80)}`)
                      : q.type === 'fill'
                      ? bi(`线索 2：首空参考开头为 "${parseFillBlanks(q.a)[0]?.[0]?.slice(0, 2) || ''}..."`, `Hint 2: Starts with "${parseFillBlanks(q.a)[0]?.[0]?.slice(0, 2) || ''}..."`)
                      : bi('线索 2：对照题干限定条件再核验一次边界情况。', 'Hint 2: Double-check boundary conditions in the stem.')}
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* Confidence Selector Strip */}
          {settings.confidenceMode !== 'off' && q.type !== 'qa' && !isAnswered && (
            <div
              className={`p-2.5 rounded-2xl border transition-all flex flex-wrap items-center justify-between gap-2 ${
                confHighlight
                  ? 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/40 anim-shake'
                  : 'border-line bg-surface'
              }`}
              data-testid="lab-confidence-strip"
            >
              <span className="text-xs font-medium text-ink-muted">
                {settings.confidenceMode === 'required'
                  ? bi('作答前必选把握度：', 'Confidence (Required):')
                  : bi('可选把握度标注：', 'Confidence (Optional):')}
              </span>
              <div className="flex items-center gap-1.5">
                {(
                  [
                    { val: 3 as LabConfidence, label: bi('很确定 [Z]', 'Certain [Z]'), cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
                    { val: 2 as LabConfidence, label: bi('不确定 [X]', 'Unsure [X]'), cls: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300' },
                    { val: 1 as LabConfidence, label: bi('蒙的 [C]', 'Guess [C]'), cls: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300' },
                  ] as const
                ).map((c) => {
                  const active = confidence === c.val;
                  return (
                    <button
                      key={c.val}
                      type="button"
                      data-testid={`lab-conf-${c.val}`}
                      onClick={() => {
                        setConfidence(active ? undefined : c.val);
                        setConfHighlight(false);
                      }}
                      className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-all ${
                        active
                          ? `${c.cls} ring-1 ring-current font-semibold`
                          : 'border-line bg-canvas text-ink-muted hover:text-ink'
                      }`}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Answer Controls: MCQ / MULTI */}
          {(q.type === 'mcq' || q.type === 'multi') && (
            !optionsRevealed ? (
              <Card className="space-y-3 text-center py-6 anim-fade-in" data-testid="lab-blind-cover">
                <p className="text-xs text-ink-muted">
                  {bi(
                    '盲答保护已开启：请先尝试不看选项回忆答案，再点击展开对照。',
                    'Blind recall active: retrieve the answer mentally before revealing choices.',
                  )}
                </p>
                <div className="flex justify-center">
                  <Button
                    variant="primary"
                    onClick={() => setOptionsRevealed(true)}
                    data-testid="lab-blind-reveal-btn"
                  >
                    <Eye className="w-4 h-4" />
                    {bi('我想好了，展开选项 [Space]', 'Reveal Options [Space]')}
                  </Button>
                </div>
              </Card>
            ) : (
              <div className="space-y-2.5 anim-fade-in">
                {item.optionOrder.map((origIdx, visIdx) => {
                  const optText = q.o[origIdx] ?? '';
                  const origLetter = String.fromCharCode(65 + origIdx);
                  const displayLetter = String.fromCharCode(65 + visIdx);
                  const selected =
                    q.type === 'multi'
                      ? multiDraft.has(origLetter)
                      : saved?.userAns === origLetter;
                  const isCorrectOpt = q.a.toUpperCase().includes(origLetter);
                  const isEliminated = !canShowFeedbackNow && origIdx === eliminatedOrigIndex;

                  let boxCls = 'bg-surface border-line hover:border-accent/60';
                  let badgeCls = 'bg-surface-muted text-ink-muted border-transparent';

                  if (canShowFeedbackNow) {
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
                  } else if (isEliminated) {
                    boxCls = 'bg-surface/40 border-line opacity-40 line-through';
                  }

                  return (
                    <button
                      key={`${origIdx}-${visIdx}`}
                      type="button"
                      disabled={isAnswered || isEliminated}
                      data-testid={`lab-opt-${visIdx}`}
                      data-orig-letter={origLetter}
                      onClick={() => submitChoice(origLetter)}
                      className={`w-full text-left p-4 rounded-2xl border transition-all duration-200 ${
                        !isAnswered && !isEliminated ? 'hover:translate-x-0.5 active:scale-[0.99]' : ''
                      } flex items-start gap-3.5 ${boxCls}`}
                    >
                      <span
                        className={`w-7 h-7 rounded-lg border text-xs font-mono font-semibold flex items-center justify-center flex-shrink-0 transition-colors ${badgeCls}`}
                      >
                        {displayLetter}
                      </span>
                      <span className="text-sm text-ink leading-relaxed pt-0.5 flex-1">{optText}</span>
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
            )
          )}

          {/* TF */}
          {q.type === 'tf' && (
            <div className="grid grid-cols-2 gap-3">
              {(['T', 'F'] as const).map((v) => {
                const isSelected = saved?.userAns === v;
                const isCorrectOpt = q.a.toUpperCase() === v;
                let cls = 'bg-surface border-line hover:border-accent/60 text-ink';
                if (canShowFeedbackNow) {
                  if (isCorrectOpt) cls = 'bg-emerald-500/10 border-emerald-500 text-emerald-700 dark:text-emerald-300';
                  else if (isSelected) cls = 'bg-red-500/10 border-red-500 text-red-700 dark:text-red-300';
                  else cls = 'bg-surface/60 border-line text-ink-muted opacity-60';
                } else if (isSelected) {
                  cls = 'bg-accent-soft/60 border-accent text-accent';
                }
                return (
                  <button
                    key={v}
                    type="button"
                    disabled={isAnswered}
                    onClick={() => submitChoice(v)}
                    className={`h-14 rounded-2xl border font-semibold text-base transition-all duration-200 ${
                      !isAnswered ? 'hover:-translate-y-0.5 active:scale-[0.98]' : ''
                    } ${cls}`}
                  >
                    {v === 'T' ? bi('√ 正确', 'True') : bi('× 错误', 'False')}
                  </button>
                );
              })}
            </div>
          )}

          {/* FILL */}
          {q.type === 'fill' && (
            <Card className="space-y-3">
              <div className="space-y-2.5">
                {Array.from({ length: fillBlankCount }, (_, blankIdx) => {
                  const val = fillValues[blankIdx] || '';
                  const blankOk = fillGrade?.results[blankIdx];
                  let inputStateCls = 'border-line bg-canvas text-ink focus:border-accent';
                  if (canShowFeedbackNow) {
                    if (saved?.ok || blankOk) {
                      inputStateCls = 'border-emerald-500/60 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200';
                    } else {
                      inputStateCls = 'border-red-500/60 bg-red-500/10 text-red-800 dark:text-red-200';
                    }
                  }
                  return (
                    <div key={blankIdx} className="flex items-center gap-2">
                      {fillBlankCount > 1 && (
                        <span className="px-2.5 h-10 rounded-xl bg-surface-muted border border-line text-xs font-mono font-semibold text-ink-muted inline-flex items-center flex-shrink-0">
                          {bi(`第 ${blankIdx + 1} 空`, `#${blankIdx + 1}`)}
                        </span>
                      )}
                      <input
                        ref={(el) => {
                          fillInputRefs.current[blankIdx] = el;
                        }}
                        type="text"
                        disabled={isAnswered}
                        value={val}
                        onChange={(e) => {
                          const next = [...fillValues];
                          next[blankIdx] = e.target.value;
                          setDraft(item.instanceId, serializeFillDraftValues(next, fillBlankCount));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !isAnswered) {
                            e.preventDefault();
                            if (blankIdx < fillBlankCount - 1) {
                              fillInputRefs.current[blankIdx + 1]?.focus();
                            } else {
                              submitFill();
                            }
                          }
                        }}
                        placeholder={
                          fillBlankCount > 1
                            ? bi(`输入第 ${blankIdx + 1} 空答案…`, `Type blank #${blankIdx + 1}…`)
                            : bi('在此输入填空答案…', 'Type your answer…')
                        }
                        className={`flex-1 h-10 px-3.5 rounded-xl border text-sm outline-none transition-colors disabled:opacity-90 ${inputStateCls}`}
                      />
                    </div>
                  );
                })}
                {!isAnswered && (
                  <div className="flex justify-end pt-1">
                    <Button variant="primary" onClick={submitFill}>
                      {bi('提交答案', 'Submit')}
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* QA 4-Tier FSRS Self-Rating */}
          {q.type === 'qa' && (
            <Card className="space-y-4">
              {!isAnswered && (
                <div>
                  <label className="block text-xs font-medium text-ink-muted mb-1.5">
                    {bi('先主动写下或默想关键要点', 'Recall key points before checking')}
                  </label>
                  <textarea
                    rows={4}
                    value={drafts[item.instanceId] || ''}
                    onChange={(e) => setDraft(item.instanceId, e.target.value)}
                    placeholder={bi('写下核心关键词后再核对参考答案…', 'Jot down keywords before revealing…')}
                    className="w-full p-3 rounded-xl bg-canvas border border-line text-sm text-ink outline-none focus:border-accent resize-y leading-relaxed"
                  />
                </div>
              )}

              {!isAnswered && !qaRevealed ? (
                <div className="flex justify-end">
                  <Button variant="primary" onClick={() => setQaRevealed(true)} data-testid="lab-qa-reveal-btn">
                    {bi('查看参考答案 [Space]', 'Reveal Answer [Space]')}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3 anim-slide-down">
                  <div className="p-3.5 rounded-xl bg-surface-muted/70 border border-line space-y-1.5">
                    <div className="text-xs font-semibold text-accent">{bi('参考答案', 'Reference Answer')}</div>
                    <div className="text-[15px] font-medium text-ink leading-relaxed whitespace-pre-wrap">
                      {q.a}
                    </div>
                  </div>

                  {!isAnswered && (
                    <div className="space-y-2 pt-1">
                      <div className="text-xs text-ink-muted">
                        {bi('按 FSRS 提取流畅度自评（决定下次复习间隔）：', 'Rate recall fluency for FSRS scheduling:')}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {(
                          [
                            {
                              r: 1 as FsrsRating,
                              label: bi('完全不会', 'Again'),
                              cls: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300 hover:bg-red-500/20',
                            },
                            {
                              r: 2 as FsrsRating,
                              label: bi('有遗漏', 'Hard'),
                              cls: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20',
                            },
                            {
                              r: 3 as FsrsRating,
                              label: bi('基本掌握', 'Good'),
                              cls: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300 hover:bg-sky-500/20',
                            },
                            {
                              r: 4 as FsrsRating,
                              label: bi('秒杀熟练', 'Easy'),
                              cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20',
                            },
                          ] as const
                        ).map((opt) => {
                          const days = qaIntervalPreview?.[opt.r] ?? 1;
                          return (
                            <button
                              key={opt.r}
                              type="button"
                              data-testid={`lab-qa-rate-${opt.r}`}
                              onClick={() => handleQaRate(opt.r)}
                              className={`p-2.5 rounded-xl border text-center transition-all active:scale-95 ${opt.cls}`}
                            >
                              <div className="text-xs font-semibold">{opt.label}</div>
                              <div className="text-[10px] opacity-80 tabular-nums mt-0.5">
                                {opt.r === 1 ? bi('1 天内回炉', 'Soon / 1d') : bi(`${days} 天后`, `${days}d`)}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}

          {/* Delayed Mode Saved Notice (before grading) */}
          {isAnswered && settings.delayedFeedback && (
            <Card className="border-accent/40 bg-accent-soft/30 flex items-center justify-between gap-2 text-xs">
              <span className="text-ink font-medium">
                {bi('已记录本题作答（延迟反馈模式下交卷后统一查看对错与精析）。', 'Recorded silently. Full grading appears when you submit all.')}
              </span>
              {idx < queue.length - 1 ? (
                <Button size="sm" variant="primary" onClick={() => setIndex(idx + 1)}>
                  {bi('下一题', 'Next')}
                </Button>
              ) : (
                <Button size="sm" variant="primary" onClick={() => submitDelayedExam()}>
                  {bi('交卷看精析', 'Grade All')}
                </Button>
              )}
            </Card>
          )}

          {/* Immediate Feedback Card */}
          {canShowFeedbackNow && (
            <Card
              data-testid="lab-immediate-feedback"
              className={`space-y-2.5 ${
                saved?.ok
                  ? 'border-emerald-500/40 bg-emerald-500/5 anim-pop-in'
                  : saved?.conf === 3
                  ? 'border-amber-500/60 bg-amber-500/10 anim-shake'
                  : 'border-red-500/40 bg-red-500/5 anim-shake'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold text-sm flex-wrap">
                  {saved?.ok ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      <span className="text-emerald-700 dark:text-emerald-300">
                        {saved.conf === 1
                          ? bi('蒙对已确认（已缩短复现间隔）', 'Lucky Guess Recorded (Shortened Interval)')
                          : bi('回答正确', 'Correct')}
                      </span>
                    </>
                  ) : (
                    <>
                      {saved?.conf === 3 ? (
                        <ShieldAlert className="w-4 h-4 text-amber-500" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-500" />
                      )}
                      <span
                        className={
                          saved?.conf === 3
                            ? 'text-amber-800 dark:text-amber-300'
                            : 'text-red-700 dark:text-red-300'
                        }
                      >
                        {q.type === 'qa'
                          ? bi('已记为需要巩固，FSRS 已缩短间隔', 'Scheduled for soon reinforcement')
                          : bi(
                              `${saved?.conf === 3 ? '高自信误区 | ' : '回答有误 | '}正确答案：${
                                q.type === 'fill' ? formatFillAnswerDisplay(q.a) : q.a
                              }`,
                              `${saved?.conf === 3 ? 'High-Conf Error | ' : 'Incorrect | '}Answer: ${
                                q.type === 'fill' ? formatFillAnswerDisplay(q.a) : q.a
                              }`,
                            )}
                      </span>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  {saved?.ok && saved.conf !== 1 && q.type !== 'qa' && (
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid="lab-mark-lucky-guess-btn"
                      onClick={handleMarkAsLuckyGuess}
                    >
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                      {bi('我是蒙对的 [G]', 'Lucky Guess [G]')}
                    </Button>
                  )}
                  <span className="text-[11px] font-mono text-ink-muted tabular-nums">
                    {Math.round((saved?.durationMs || 0) / 100) / 10}s
                  </span>
                  <Button size="sm" variant="ghost" onClick={retryCurrentItem}>
                    <RotateCcw className="w-3.5 h-3.5" />
                    {bi('重做', 'Retry')}
                  </Button>
                </div>
              </div>

              {!saved?.ok && saved?.conf === 3 && (
                <div className="px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-xs text-amber-900 dark:text-amber-200">
                  {bi(
                    '超纠正警报：你很确定却答错了本题，FSRS 已将其锁定在 4 天内强制复测，防止顽固误区一周后返潮。',
                    'Hypercorrection alert: high-confidence error locked for mandatory review within 4 days.',
                  )}
                </div>
              )}

              {requeueNotice && (
                <div className="px-3 py-2 rounded-xl bg-accent-soft/60 border border-accent/25 text-xs text-accent flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>
                    {bi('已将该题安排到 4 题后进行组内延迟回炉重测（选项将重新乱序）。', 'Scheduled for in-session delayed re-test 4 items later.')}
                  </span>
                </div>
              )}

              {q.d && <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap pt-1">{q.d}</p>}
            </Card>
          )}

          {/* Bottom Nav */}
          <div className="flex items-center justify-between pt-2">
            <Button variant="outline" disabled={idx === 0} onClick={() => setIndex(idx - 1)}>
              <ArrowLeft className="w-4 h-4" />
              {bi('上一题', 'Previous')}
            </Button>

            <span className="hidden sm:inline text-[11px] text-ink-muted">
              {bi('快捷键：Z/X/C 把握度 | Space 展开 | Enter 下一题 | S 收藏', 'Keys: Z/X/C conf | Space reveal | Enter next | S star')}
            </span>

            {idx < queue.length - 1 ? (
              <Button variant="primary" onClick={() => setIndex(idx + 1)} data-testid="lab-next-btn">
                {bi('下一题', 'Next')}
                <ArrowRight className="w-4 h-4" />
              </Button>
            ) : (
              <Button variant="primary" onClick={finishSession} data-testid="lab-finish-btn">
                <Check className="w-4 h-4" />
                {settings.delayedFeedback ? bi('交卷并查看精析', 'Submit Exam') : bi('完成并结算', 'Finish Session')}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Passage Drawer */}
      {q.psg && psgOpenMobile && (
        <div className="fixed inset-0 z-50 md:hidden flex flex-col bg-surface">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-ink">{bi('阅读材料', 'Passage')}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={savePassageHighlight}
                className="px-2 py-1 rounded border border-line text-xs text-ink-muted inline-flex items-center gap-1"
              >
                <Highlighter className="w-3 h-3 text-amber-500" />
                {bi('标亮', 'Mark')}
              </button>
              <button type="button" onClick={() => setPsgOpenMobile(false)} className="p-1 text-ink-muted">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 font-serif text-sm leading-relaxed whitespace-pre-wrap text-ink">
            {renderPassageWithHighlights(q.psg, currentHighlights)}
          </div>
        </div>
      )}

      {/* Map Sheet */}
      <Modal
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={bi('科学精练答题卡', 'Lab Session Map')}
        subtitle={bi(`共 ${queue.length} 槽位，已答 ${answeredCount}`, `${answeredCount} / ${queue.length} answered`)}
        size="md"
        footer={
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setSheetOpen(false);
              finishSession();
            }}
          >
            {settings.delayedFeedback ? bi('交卷结算', 'Grade All') : bi('结束并结算', 'Finish')}
          </Button>
        }
      >
        <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
          {queue.map((it, i) => {
            const st = answers[it.instanceId];
            const isCurrent = i === idx;
            let cls = 'bg-canvas border-line text-ink-muted';
            if (st?.answered) {
              if (settings.delayedFeedback) {
                cls = 'bg-accent-soft border-accent/50 text-accent';
              } else {
                cls = st.ok
                  ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-700 dark:text-emerald-300'
                  : 'bg-red-500/15 border-red-500/50 text-red-700 dark:text-red-300';
              }
            }
            return (
              <button
                key={it.instanceId}
                type="button"
                onClick={() => {
                  setIndex(i);
                  setSheetOpen(false);
                }}
                className={`h-9 rounded-xl border text-xs font-mono font-semibold tabular-nums transition-all ${cls} ${
                  isCurrent ? 'ring-2 ring-accent ring-offset-1 ring-offset-surface' : ''
                }`}
              >
                {i + 1}{it.isRequeued ? '*' : ''}
              </button>
            );
          })}
        </div>
      </Modal>
    </div>
  );
};
