import { useEffect, useMemo, useState } from 'react';
import { computeSrs, countDueQuestions, type HistoryEntry } from '@qs/shared';
import type { LocalEnglishProgress, LocalFlag, LocalQuestion } from '@/db';
import { getSyncEngine } from '@/sync/engine';
import { useSyncStore } from '@/store/useSyncStore';
import { localDayKey, naturalCompare } from '@/lib/text';

export interface LiveStudySnapshot {
  loading: boolean;
  questions: LocalQuestion[];
  trashQuestions: LocalQuestion[];
  history: HistoryEntry[];
  flagsMap: Map<string, LocalFlag>;
  englishProgressMap: Map<string, LocalEnglishProgress>;
  bankName: string;
  lastPracticeTime: number | null;
}

export function useLiveStudyData(): LiveStudySnapshot {
  const revision = useSyncStore((s) => s.dataRevision);
  const [snap, setSnap] = useState<LiveStudySnapshot>({
    loading: true,
    questions: [],
    trashQuestions: [],
    history: [],
    flagsMap: new Map(),
    englishProgressMap: new Map(),
    bankName: '',
    lastPracticeTime: null,
  });

  useEffect(() => {
    let cancelled = false;
    const engine = getSyncEngine();
    if (!engine) {
      setSnap((prev) => ({ ...prev, loading: false }));
      return;
    }

    void (async () => {
      const [allQ, history, flags, engList, bankNameMeta, lastPracMeta] = await Promise.all([
        engine.db.questions.toArray(),
        engine.db.history.orderBy('t').toArray(),
        engine.db.flags.toArray(),
        engine.db.englishProgress.toArray(),
        engine.db.meta.get('bankName'),
        engine.db.meta.get('lastPracticeTime'),
      ]);
      if (cancelled) return;

      const activeQ: LocalQuestion[] = [];
      const trashQ: LocalQuestion[] = [];
      for (const q of allQ) {
        if (q.deletedAt === null || q.deletedAt === undefined) activeQ.push(q);
        else trashQ.push(q);
      }

      const flagsMap = new Map<string, LocalFlag>();
      for (const f of flags) flagsMap.set(f.questionId, f);

      const englishProgressMap = new Map<string, LocalEnglishProgress>();
      for (const ep of engList) englishProgressMap.set(ep.paperId, ep);

      setSnap({
        loading: false,
        questions: activeQ,
        trashQuestions: trashQ.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)),
        history,
        flagsMap,
        englishProgressMap,
        bankName: typeof bankNameMeta?.value === 'string' ? bankNameMeta.value : '',
        lastPracticeTime:
          typeof lastPracMeta?.value === 'number' ? lastPracMeta.value : null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [revision]);

  return snap;
}

export interface StudyStats {
  totalQuestions: number;
  dueCount: number;
  dueQuestionIds: string[];
  wrongIds: Set<string>;
  visibleMistakeIds: Set<string>;
  starredIds: Set<string>;
  todayAttempts: number;
  todayCorrect: number;
  streakDays: number;
  totalAttempts: number;
  accuracyPercent: number;
  avgDurationSec: number | null;
  subjectTree: Array<{
    sub: string;
    total: number;
    answered: number;
    correct: number;
    due: number;
    chapters: Array<{ chap: string; total: number }>;
  }>;
}

export function useStudyStats(data: LiveStudySnapshot): StudyStats {
  return useMemo(() => {
    const activeIds = new Set(data.questions.map((q) => q.id));
    const qMap = new Map<string, LocalQuestion>();
    for (const q of data.questions) qMap.set(q.id, q);

    const historyByQ = new Map<string, HistoryEntry[]>();
    const dayAttemptMap = new Map<string, { attempts: number; correct: number }>();
    const activeDays = new Set<string>();
    const todayKey = localDayKey(Date.now());

    let totalAttempts = 0;
    let totalCorrect = 0;
    let totalDurMs = 0;
    let durCount = 0;

    const wrongLatest = new Map<string, boolean>();

    for (const h of data.history) {
      if (!activeIds.has(h.id)) continue;
      totalAttempts++;
      if (h.r) totalCorrect++;
      if (typeof h.d === 'number' && h.d > 0) {
        totalDurMs += h.d;
        durCount++;
      }

      const dk = localDayKey(h.t);
      activeDays.add(dk);
      const bucket = dayAttemptMap.get(dk) || { attempts: 0, correct: 0 };
      bucket.attempts++;
      if (h.r) bucket.correct++;
      dayAttemptMap.set(dk, bucket);

      const arr = historyByQ.get(h.id) || [];
      arr.push(h);
      historyByQ.set(h.id, arr);

      wrongLatest.set(h.id, h.r);
    }

    // All-time wrong questions (any history with !r) not hidden from mistakes
    const wrongIds = new Set<string>();
    for (const h of data.history) {
      if (!activeIds.has(h.id)) continue;
      if (!h.r) wrongIds.add(h.id);
    }

    const starredIds = new Set<string>();
    const hiddenMistakeIds = new Set<string>();
    for (const [qid, flag] of data.flagsMap) {
      if (!activeIds.has(qid)) continue;
      if (flag.starred) starredIds.add(qid);
      if (flag.mistakeHidden) hiddenMistakeIds.add(qid);
    }

    const visibleMistakeIds = new Set<string>();
    for (const id of wrongIds) {
      if (!hiddenMistakeIds.has(id)) visibleMistakeIds.add(id);
    }

    // Due queue sorted by oldest dueAt
    const utc8Now = new Date(Date.now() + 8 * 3_600_000);
    const endOfDayUtc8 =
      Date.UTC(
        utc8Now.getUTCFullYear(),
        utc8Now.getUTCMonth(),
        utc8Now.getUTCDate(),
        23,
        59,
        59,
        999,
      ) -
      8 * 3_600_000;

    const duePairs: Array<{ id: string; dueAt: number }> = [];
    for (const [qid, recs] of historyByQ) {
      const srs = computeSrs(recs);
      if (srs.dueAt !== null && srs.dueAt <= endOfDayUtc8) {
        duePairs.push({ id: qid, dueAt: srs.dueAt });
      }
    }
    duePairs.sort((a, b) => a.dueAt - b.dueAt);
    const dueQuestionIds = duePairs.map((x) => x.id);
    const dueSet = new Set(dueQuestionIds);
    const dueCount = countDueQuestions(data.history, activeIds);

    // Streak calculation
    let streakDays = 0;
    const cursorDate = new Date();
    if (!activeDays.has(localDayKey(cursorDate))) {
      cursorDate.setDate(cursorDate.getDate() - 1);
    }
    while (activeDays.has(localDayKey(cursorDate))) {
      streakDays++;
      cursorDate.setDate(cursorDate.getDate() - 1);
    }

    const todayBucket = dayAttemptMap.get(todayKey) || { attempts: 0, correct: 0 };

    // Subject -> chapter tree
    const subMap = new Map<string, Map<string, LocalQuestion[]>>();
    for (const q of data.questions) {
      let chaps = subMap.get(q.sub);
      if (!chaps) {
        chaps = new Map();
        subMap.set(q.sub, chaps);
      }
      const list = chaps.get(q.chap) || [];
      list.push(q);
      chaps.set(q.chap, list);
    }

    const subjectTree = Array.from(subMap.entries())
      .sort(([a], [b]) => naturalCompare(a, b))
      .map(([sub, chapsMap]) => {
        const chapters = Array.from(chapsMap.entries())
          .sort(([a], [b]) => naturalCompare(a, b))
          .map(([chap, qs]) => ({ chap, total: qs.length }));
        const subQs = Array.from(chapsMap.values()).flat();
        let subAnswered = 0;
        let subCorrect = 0;
        let subDue = 0;
        for (const q of subQs) {
          if (dueSet.has(q.id)) subDue++;
          const recs = historyByQ.get(q.id);
          if (recs && recs.length) {
            subAnswered++;
            if (recs[recs.length - 1].r) subCorrect++;
          }
        }
        return {
          sub,
          total: subQs.length,
          answered: subAnswered,
          correct: subCorrect,
          due: subDue,
          chapters,
        };
      });

    return {
      totalQuestions: data.questions.length,
      dueCount,
      dueQuestionIds,
      wrongIds,
      visibleMistakeIds,
      starredIds,
      todayAttempts: todayBucket.attempts,
      todayCorrect: todayBucket.correct,
      streakDays,
      totalAttempts,
      accuracyPercent: totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0,
      avgDurationSec: durCount > 0 ? Math.round((totalDurMs / durCount / 1000) * 10) / 10 : null,
      subjectTree,
    };
  }, [data]);
}
