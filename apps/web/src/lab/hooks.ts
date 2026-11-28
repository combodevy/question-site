import { useEffect, useMemo, useState } from 'react';
import {
  computeFsrsCard,
  computeMedianDurationMs,
  DEFAULT_LAB_SETTINGS,
  getEndOfDayUtc8Ms,
  parseLabSettings,
  type FsrsCardState,
  type LabHistoryEntry,
  type LabSettings,
} from '@qs/shared';
import type { LabFlag, LabQuestion } from '@/lab/db';
import { getLabSyncEngine } from '@/lab/syncEngine';
import { useLabSyncStore } from '@/lab/useLabSyncStore';
import { localDayKey, naturalCompare } from '@/lib/text';

export interface LiveLabSnapshot {
  loading: boolean;
  questions: LabQuestion[];
  history: LabHistoryEntry[];
  flagsMap: Map<string, LabFlag>;
  settings: LabSettings;
  bankName: string;
  lastPracticeTime: number | null;
}

export function useLiveLabData(): LiveLabSnapshot {
  const revision = useLabSyncStore((s) => s.dataRevision);
  const [snap, setSnap] = useState<LiveLabSnapshot>({
    loading: true,
    questions: [],
    history: [],
    flagsMap: new Map(),
    settings: { ...DEFAULT_LAB_SETTINGS },
    bankName: '',
    lastPracticeTime: null,
  });

  useEffect(() => {
    let cancelled = false;
    const engine = getLabSyncEngine();
    if (!engine) {
      setSnap((prev) => ({ ...prev, loading: false }));
      return;
    }

    void (async () => {
      const [allQ, history, flags, bankNameMeta, lastPracMeta, settingsMeta] = await Promise.all([
        engine.db.questions.toArray(),
        engine.db.history.orderBy('t').toArray(),
        engine.db.flags.toArray(),
        engine.db.meta.get('bankName'),
        engine.db.meta.get('lastPracticeTime'),
        engine.db.meta.get('settings'),
      ]);
      if (cancelled) return;

      const activeQ = allQ.filter((q) => q.deletedAt === null || q.deletedAt === undefined);
      const flagsMap = new Map<string, LabFlag>();
      for (const f of flags) flagsMap.set(f.questionId, f);

      setSnap({
        loading: false,
        questions: activeQ,
        history,
        flagsMap,
        settings: parseLabSettings(settingsMeta?.value),
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

export type SweetSpotStatus = 'insufficient' | 'too_hard' | 'sweet_spot' | 'too_easy';

export interface LabStats {
  totalQuestions: number;
  cardMap: Map<string, FsrsCardState>;
  medianDurationMs: number | undefined;
  dueIds: string[];
  dueCount: number;
  hyperRiskIds: Set<string>;
  luckyGuessIds: Set<string>;
  wrongIds: Set<string>;
  visibleMistakeIds: Set<string>;
  hiddenMistakeIds: Set<string>;
  starredIds: Set<string>;
  avgRetrievability: number;
  recent50Accuracy: number | null;
  recent50Count: number;
  sweetSpotStatus: SweetSpotStatus;
  todayAttempts: number;
  todayCorrect: number;
  streakDays: number;
  totalAttempts: number;
  accuracyPercent: number;
  avgDurationSec: number | null;
  calibrationMatrix: {
    highOk: number;
    highWrong: number;
    midOk: number;
    midWrong: number;
    lowOk: number;
    lowWrong: number;
  };
  retrievabilityBuckets: Array<{ key: string; labelZh: string; labelEn: string; count: number; cls: string }>;
  workload14d: Array<{ key: string; label: string; count: number }>;
  subjectTree: Array<{
    sub: string;
    total: number;
    answered: number;
    correct: number;
    due: number;
    hyperCount: number;
    avgRetrievability: number;
    chapters: Array<{ chap: string; total: number }>;
  }>;
}

export function useLabStats(data: LiveLabSnapshot): LabStats {
  return useMemo(() => {
    const nowMs = Date.now();
    const endOfToday = getEndOfDayUtc8Ms(nowMs);
    const desiredRetention = data.settings.desiredRetention ?? 0.9;
    const activeIds = new Set(data.questions.map((q) => q.id));

    const historyByQ = new Map<string, LabHistoryEntry[]>();
    const dayAttemptMap = new Map<string, { attempts: number; correct: number }>();
    const activeDays = new Set<string>();
    const todayKey = localDayKey(nowMs);

    let totalAttempts = 0;
    let totalCorrect = 0;
    let totalDurMs = 0;
    let durCount = 0;

    const calibrationMatrix = {
      highOk: 0,
      highWrong: 0,
      midOk: 0,
      midWrong: 0,
      lowOk: 0,
      lowWrong: 0,
    };

    const validHistory: LabHistoryEntry[] = [];
    for (const h of data.history) {
      if (!activeIds.has(h.id)) continue;
      validHistory.push(h);
      totalAttempts += 1;
      if (h.r) totalCorrect += 1;
      if (typeof h.d === 'number' && h.d > 0) {
        totalDurMs += h.d;
        durCount += 1;
      }

      if (h.conf === 3) {
        if (h.r) calibrationMatrix.highOk += 1;
        else calibrationMatrix.highWrong += 1;
      } else if (h.conf === 2) {
        if (h.r) calibrationMatrix.midOk += 1;
        else calibrationMatrix.midWrong += 1;
      } else if (h.conf === 1) {
        if (h.r) calibrationMatrix.lowOk += 1;
        else calibrationMatrix.lowWrong += 1;
      }

      const dk = localDayKey(h.t);
      activeDays.add(dk);
      const bucket = dayAttemptMap.get(dk) || { attempts: 0, correct: 0 };
      bucket.attempts += 1;
      if (h.r) bucket.correct += 1;
      dayAttemptMap.set(dk, bucket);

      const arr = historyByQ.get(h.id) || [];
      arr.push(h);
      historyByQ.set(h.id, arr);
    }

    const medianDurationMs = computeMedianDurationMs(validHistory);
    const cardMap = new Map<string, FsrsCardState>();

    const starredIds = new Set<string>();
    const hiddenMistakeIds = new Set<string>();
    for (const [qid, flag] of data.flagsMap) {
      if (!activeIds.has(qid)) continue;
      if (flag.starred) starredIds.add(qid);
      if (flag.mistakeHidden) hiddenMistakeIds.add(qid);
    }

    const duePairs: Array<{ id: string; score: number }> = [];
    const hyperRiskIds = new Set<string>();
    const luckyGuessIds = new Set<string>();
    const wrongIds = new Set<string>();
    const visibleMistakeIds = new Set<string>();

    let rSum = 0;
    let trackedCount = 0;

    const rBuckets = [
      { key: 'critical', labelZh: '< 70% 急需抢救', labelEn: '< 70% Critical', count: 0, cls: 'bg-red-500' },
      { key: 'gold', labelZh: '70% - 85% 黄金窗', labelEn: '70-85% Optimal', count: 0, cls: 'bg-amber-500' },
      { key: 'good', labelZh: '85% - 92% 保持期', labelEn: '85-92% Holding', count: 0, cls: 'bg-sky-500' },
      { key: 'solid', labelZh: '> 92% 记忆稳固', labelEn: '> 92% Solid', count: 0, cls: 'bg-emerald-500' },
    ];

    const workloadMap = new Map<string, number>();

    for (const [qid, recs] of historyByQ) {
      const state = computeFsrsCard(recs, {
        desiredRetention,
        nowMs,
        medianDurationMs,
      });
      cardMap.set(qid, state);
      trackedCount += 1;
      rSum += state.retrievability;

      if (state.retrievability < 0.7) rBuckets[0].count += 1;
      else if (state.retrievability < 0.85) rBuckets[1].count += 1;
      else if (state.retrievability <= 0.92) rBuckets[2].count += 1;
      else rBuckets[3].count += 1;

      if (state.isHyperRisk && !hiddenMistakeIds.has(qid)) hyperRiskIds.add(qid);
      if (state.isLuckyGuess && !hiddenMistakeIds.has(qid)) luckyGuessIds.add(qid);
      if (state.wrongCount > 0) {
        wrongIds.add(qid);
        if (!hiddenMistakeIds.has(qid)) visibleMistakeIds.add(qid);
      } else if (state.isLuckyGuess && !hiddenMistakeIds.has(qid)) {
        visibleMistakeIds.add(qid);
      }

      if ((state.dueAt !== null && state.dueAt <= endOfToday) || state.retrievability <= desiredRetention) {
        const urgency = (state.isHyperRisk ? -2 : 0) + state.retrievability;
        duePairs.push({ id: qid, score: urgency });
      }

      if (state.dueAt !== null) {
        const dueKey = state.dueAt <= endOfToday ? todayKey : localDayKey(state.dueAt);
        workloadMap.set(dueKey, (workloadMap.get(dueKey) || 0) + 1);
      }
    }

    duePairs.sort((a, b) => a.score - b.score);
    const dueIds = duePairs.map((x) => x.id);
    const dueSet = new Set(dueIds);

    const workload14d: Array<{ key: string; label: string; count: number }> = [];
    for (let i = 0; i < 14; i += 1) {
      const d = new Date(nowMs);
      d.setDate(d.getDate() + i);
      const k = localDayKey(d);
      workload14d.push({
        key: k,
        label: i === 0 ? '今日' : `${d.getMonth() + 1}/${d.getDate()}`,
        count: workloadMap.get(k) || 0,
      });
    }

    // Recent 50 attempts sweet spot (75-85% target)
    const recentSlice = validHistory.slice(-50);
    const recent50Count = recentSlice.length;
    const recent50Accuracy =
      recent50Count > 0
        ? Math.round((recentSlice.filter((h) => h.r).length / recent50Count) * 100)
        : null;

    let sweetSpotStatus: SweetSpotStatus = 'insufficient';
    if (recent50Count >= 5 && recent50Accuracy !== null) {
      if (recent50Accuracy < 68) sweetSpotStatus = 'too_hard';
      else if (recent50Accuracy <= 88) sweetSpotStatus = 'sweet_spot';
      else sweetSpotStatus = 'too_easy';
    }

    let streakDays = 0;
    const cursorDate = new Date(nowMs);
    if (!activeDays.has(localDayKey(cursorDate))) {
      cursorDate.setDate(cursorDate.getDate() - 1);
    }
    while (activeDays.has(localDayKey(cursorDate))) {
      streakDays += 1;
      cursorDate.setDate(cursorDate.getDate() - 1);
    }

    const todayBucket = dayAttemptMap.get(todayKey) || { attempts: 0, correct: 0 };

    // Subject tree computed strictly from Lab history & Lab FSRS
    const subMap = new Map<string, Map<string, LabQuestion[]>>();
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
        let subHyper = 0;
        let subRSum = 0;
        let subRCount = 0;
        for (const q of subQs) {
          if (dueSet.has(q.id)) subDue += 1;
          if (hyperRiskIds.has(q.id)) subHyper += 1;
          const card = cardMap.get(q.id);
          if (card && card.attempts > 0) {
            subAnswered += 1;
            subRSum += card.retrievability;
            subRCount += 1;
            if (card.lastCorrect) subCorrect += 1;
          }
        }
        return {
          sub,
          total: subQs.length,
          answered: subAnswered,
          correct: subCorrect,
          due: subDue,
          hyperCount: subHyper,
          avgRetrievability: subRCount > 0 ? Math.round((subRSum / subRCount) * 100) : 100,
          chapters,
        };
      });

    return {
      totalQuestions: data.questions.length,
      cardMap,
      medianDurationMs,
      dueIds,
      dueCount: dueIds.length,
      hyperRiskIds,
      luckyGuessIds,
      wrongIds,
      visibleMistakeIds,
      hiddenMistakeIds,
      starredIds,
      avgRetrievability: trackedCount > 0 ? Math.round((rSum / trackedCount) * 100) : 100,
      recent50Accuracy,
      recent50Count,
      sweetSpotStatus,
      todayAttempts: todayBucket.attempts,
      todayCorrect: todayBucket.correct,
      streakDays,
      totalAttempts,
      accuracyPercent: totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0,
      avgDurationSec: durCount > 0 ? Math.round((totalDurMs / durCount / 1000) * 10) / 10 : null,
      calibrationMatrix,
      retrievabilityBuckets: rBuckets,
      workload14d,
      subjectTree,
    };
  }, [data]);
}
