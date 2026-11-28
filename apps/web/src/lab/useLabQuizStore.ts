import { create } from 'zustand';
import type {
  FsrsRating,
  LabConfidence,
  LabHistoryEntry,
  LabPracticeMode,
  LabSettings,
} from '@qs/shared';
import type { LabQuestion } from '@/lab/db';
import { getLabSyncEngine } from '@/lab/syncEngine';

export interface LabQueueItem {
  instanceId: string;
  questionId: string;
  question: LabQuestion;
  optionOrder: number[];
  isRequeued: boolean;
  requeueCount: number;
}

export interface LabAnswerState {
  answered: boolean;
  userAns: string;
  ok: boolean;
  conf?: LabConfidence;
  rating?: FsrsRating;
  durationMs: number;
  blindUsed: boolean;
  hintsUsed: number;
  recordedAt: number;
  historyRid?: string;
}

export interface LabSessionConfig {
  mode: LabPracticeMode;
  questions: LabQuestion[];
  title: string;
  settings: LabSettings;
}

export interface UnfinishedLabSnapshot {
  version: 1;
  mode: LabPracticeMode;
  title: string;
  settings: LabSettings;
  items: Array<{
    instanceId: string;
    questionId: string;
    optionOrder: number[];
    isRequeued: boolean;
    requeueCount: number;
  }>;
  idx: number;
  answers: Record<string, LabAnswerState>;
  drafts: Record<string, string>;
  startedAt: number;
  savedAt: number;
}

const UNFINISHED_KEY_PREFIX = 'qs_lab_unfinished_';

function snapshotKey(userId: string): string {
  return `${UNFINISHED_KEY_PREFIX}${userId || 'anon'}`;
}

export function buildOptionOrder(q: LabQuestion, shuffle: boolean): number[] {
  const len = Array.isArray(q.o) ? q.o.length : 0;
  const arr = Array.from({ length: len }, (_, i) => i);
  if (!shuffle || (q.type !== 'mcq' && q.type !== 'multi') || len <= 1) {
    return arr;
  }
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function readUnfinishedLabSnapshot(userId?: string): UnfinishedLabSnapshot | null {
  try {
    const raw = localStorage.getItem(snapshotKey(userId || ''));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UnfinishedLabSnapshot;
    if (
      !parsed ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.items) ||
      parsed.items.length === 0
    ) {
      return null;
    }
    const answeredCount = Object.keys(parsed.answers || {}).length;
    if (answeredCount === 0 && (parsed.idx || 0) === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearUnfinishedLabSnapshot(userId?: string): void {
  try {
    localStorage.removeItem(snapshotKey(userId || ''));
  } catch {
    // ignore
  }
}

function writeUnfinishedLabSnapshot(userId: string, state: LabQuizState): void {
  if (!state.active || state.finished || state.queue.length === 0) return;
  const answeredCount = Object.keys(state.answers).length;
  const hasDraft = Object.values(state.drafts).some((v) => Boolean(v));
  if (answeredCount === 0 && state.idx === 0 && !hasDraft) return;
  try {
    const snap: UnfinishedLabSnapshot = {
      version: 1,
      mode: state.mode,
      title: state.title,
      settings: state.settings,
      items: state.queue.map((it) => ({
        instanceId: it.instanceId,
        questionId: it.questionId,
        optionOrder: it.optionOrder,
        isRequeued: it.isRequeued,
        requeueCount: it.requeueCount,
      })),
      idx: state.idx,
      answers: state.answers,
      drafts: state.drafts,
      startedAt: state.startedAt,
      savedAt: Date.now(),
    };
    localStorage.setItem(snapshotKey(userId), JSON.stringify(snap));
  } catch {
    // ignore quota errors
  }
}

interface LabQuizState {
  userId: string;
  active: boolean;
  mode: LabPracticeMode;
  title: string;
  settings: LabSettings;
  queue: LabQueueItem[];
  idx: number;
  answers: Record<string, LabAnswerState>;
  drafts: Record<string, string>;
  delayedGraded: boolean;
  finished: boolean;
  startedAt: number;
  qStartedAt: number;
  setUserId: (uid: string) => void;
  startSession: (cfg: LabSessionConfig) => void;
  resumeFromSnapshot: (snap: UnfinishedLabSnapshot, availableQuestions: LabQuestion[]) => boolean;
  setIndex: (idx: number) => void;
  setDraft: (instanceId: string, val: string) => void;
  recordAnswer: (instanceId: string, state: LabAnswerState) => void;
  patchAnswerConfidence: (instanceId: string, conf: LabConfidence) => void;
  requeueQuestionLater: (instanceId: string, offset?: number) => boolean;
  submitDelayedExam: () => void;
  retryCurrentItem: () => void;
  finishSession: () => void;
  exitSession: () => void;
  detachSession: () => void;
  retryWrong: () => boolean;
}

export const useLabQuizStore = create<LabQuizState>((set, get) => ({
  userId: '',
  active: false,
  mode: 'smart_interleave',
  title: '',
  settings: {
    desiredRetention: 0.9,
    shuffleOptions: true,
    blindRecall: false,
    requeueWrong: true,
    delayedFeedback: false,
    confidenceMode: 'quick',
    hideTimer: true,
    autoNextOnHighConf: false,
  },
  queue: [],
  idx: 0,
  answers: {},
  drafts: {},
  delayedGraded: false,
  finished: false,
  startedAt: 0,
  qStartedAt: 0,

  setUserId: (uid) => set({ userId: uid }),

  startSession: ({ mode, questions, title, settings }) => {
    const now = Date.now();
    clearUnfinishedLabSnapshot(get().userId);
    const items: LabQueueItem[] = questions.map((q, i) => ({
      instanceId: `${q.id}::0::${i}`,
      questionId: q.id,
      question: q,
      optionOrder: buildOptionOrder(q, settings.shuffleOptions),
      isRequeued: false,
      requeueCount: 0,
    }));
    set({
      active: true,
      mode,
      title,
      settings,
      queue: items,
      idx: 0,
      answers: {},
      drafts: {},
      delayedGraded: false,
      finished: false,
      startedAt: now,
      qStartedAt: now,
    });
  },

  resumeFromSnapshot: (snap, availableQuestions) => {
    const byId = new Map(availableQuestions.map((q) => [q.id, q]));
    const resolved: LabQueueItem[] = [];
    for (const raw of snap.items) {
      const q = byId.get(raw.questionId);
      if (!q) continue;
      resolved.push({
        instanceId: raw.instanceId,
        questionId: q.id,
        question: q,
        optionOrder:
          Array.isArray(raw.optionOrder) && raw.optionOrder.length === (q.o?.length || 0)
            ? raw.optionOrder
            : buildOptionOrder(q, snap.settings.shuffleOptions),
        isRequeued: Boolean(raw.isRequeued),
        requeueCount: raw.requeueCount || 0,
      });
    }
    if (!resolved.length) {
      clearUnfinishedLabSnapshot(get().userId);
      return false;
    }

    const filteredAnswers: Record<string, LabAnswerState> = {};
    const filteredDrafts: Record<string, string> = {};
    for (const item of resolved) {
      if (snap.answers?.[item.instanceId]) filteredAnswers[item.instanceId] = snap.answers[item.instanceId];
      if (snap.drafts?.[item.instanceId]) filteredDrafts[item.instanceId] = snap.drafts[item.instanceId];
    }

    let nextIdx = Math.max(0, Math.min(snap.idx || 0, resolved.length - 1));
    if (filteredAnswers[resolved[nextIdx]?.instanceId]?.answered) {
      const firstUnanswered = resolved.findIndex((it) => !filteredAnswers[it.instanceId]?.answered);
      if (firstUnanswered !== -1) nextIdx = firstUnanswered;
    }

    set({
      active: true,
      mode: snap.mode,
      title: snap.title || '',
      settings: snap.settings,
      queue: resolved,
      idx: nextIdx,
      answers: filteredAnswers,
      drafts: filteredDrafts,
      delayedGraded: false,
      finished: false,
      startedAt: snap.startedAt || Date.now(),
      qStartedAt: Date.now(),
    });
    writeUnfinishedLabSnapshot(get().userId, get());
    return true;
  },

  setIndex: (nextIdx) => {
    const { queue, userId } = get();
    if (nextIdx < 0 || nextIdx >= queue.length) return;
    set({ idx: nextIdx, qStartedAt: Date.now() });
    writeUnfinishedLabSnapshot(userId, get());
  },

  setDraft: (instanceId, val) => {
    set((s) => ({ drafts: { ...s.drafts, [instanceId]: val } }));
    writeUnfinishedLabSnapshot(get().userId, get());
  },

  recordAnswer: (instanceId, state) => {
    set((s) => ({
      answers: { ...s.answers, [instanceId]: state },
    }));
    writeUnfinishedLabSnapshot(get().userId, get());
  },

  patchAnswerConfidence: (instanceId, conf) => {
    const st = get();
    const cur = st.answers[instanceId];
    const item = st.queue.find((it) => it.instanceId === instanceId);
    if (!cur || !item) return;
    const nextState: LabAnswerState = { ...cur, conf };
    set((s) => ({
      answers: { ...s.answers, [instanceId]: nextState },
    }));
    writeUnfinishedLabSnapshot(st.userId, get());

    if (!st.settings.delayedFeedback && cur.historyRid) {
      const entry: LabHistoryEntry = {
        rid: `${cur.historyRid}::conf`,
        id: item.questionId,
        r: cur.ok,
        t: Date.now(),
        d: cur.durationMs,
        conf,
        ...(cur.ok && conf === 1 ? { rating: 2 } : {}),
        mode: st.mode,
        blind: cur.blindUsed,
        requeued: item.isRequeued,
      };
      void getLabSyncEngine()?.appendHistory([entry]);
    }
  },

  requeueQuestionLater: (instanceId, offset = 4) => {
    const st = get();
    const curIdx = st.queue.findIndex((it) => it.instanceId === instanceId);
    if (curIdx === -1) return false;
    const target = st.queue[curIdx];
    const existingForQ = st.queue.filter((it) => it.questionId === target.questionId).length;
    // Cap at max 2 requeues (3 total instances) per session for a question
    if (existingForQ >= 3) return false;

    const nextCount = target.requeueCount + 1;
    const insertAt = Math.min(st.queue.length, curIdx + Math.max(2, offset));
    const newItem: LabQueueItem = {
      instanceId: `${target.questionId}::rq${nextCount}::${Date.now().toString(36)}`,
      questionId: target.questionId,
      question: target.question,
      optionOrder: buildOptionOrder(target.question, st.settings.shuffleOptions),
      isRequeued: true,
      requeueCount: nextCount,
    };

    const nextQueue = [...st.queue];
    nextQueue.splice(insertAt, 0, newItem);
    set({ queue: nextQueue });
    writeUnfinishedLabSnapshot(st.userId, get());
    return true;
  },

  submitDelayedExam: () => {
    const st = get();
    if (st.delayedGraded) return;
    const entries: LabHistoryEntry[] = [];
    for (const item of st.queue) {
      const ans = st.answers[item.instanceId];
      if (!ans || !ans.answered) continue;
      entries.push({
        rid: ans.historyRid || `${item.questionId}::${ans.recordedAt}::${Math.random().toString(36).slice(2, 6)}`,
        id: item.questionId,
        r: ans.ok,
        t: ans.recordedAt || Date.now(),
        d: ans.durationMs,
        ...(ans.conf ? { conf: ans.conf } : {}),
        ...(ans.rating ? { rating: ans.rating } : {}),
        mode: st.mode,
        ...(ans.blindUsed ? { blind: true } : {}),
        ...(item.isRequeued ? { requeued: true } : {}),
      });
    }
    if (entries.length > 0) {
      void getLabSyncEngine()?.appendHistory(entries);
    }
    clearUnfinishedLabSnapshot(st.userId);
    set({ delayedGraded: true, finished: true });
  },

  retryCurrentItem: () => {
    const { queue, idx, answers, drafts, userId } = get();
    const item = queue[idx];
    if (!item) return;
    const nextAnswers = { ...answers };
    delete nextAnswers[item.instanceId];
    const nextDrafts = { ...drafts };
    delete nextDrafts[item.instanceId];
    set({
      answers: nextAnswers,
      drafts: nextDrafts,
      qStartedAt: Date.now(),
    });
    writeUnfinishedLabSnapshot(userId, get());
  },

  finishSession: () => {
    const st = get();
    if (st.settings.delayedFeedback && !st.delayedGraded) {
      st.submitDelayedExam();
      return;
    }
    clearUnfinishedLabSnapshot(st.userId);
    set({ finished: true });
  },

  exitSession: () => {
    clearUnfinishedLabSnapshot(get().userId);
    set({
      active: false,
      queue: [],
      idx: 0,
      answers: {},
      drafts: {},
      delayedGraded: false,
      finished: false,
    });
  },

  detachSession: () => {
    set({
      active: false,
      queue: [],
      idx: 0,
      answers: {},
      drafts: {},
      delayedGraded: false,
      finished: false,
    });
  },

  retryWrong: () => {
    const { queue, answers, settings, startSession } = get();
    const seen = new Set<string>();
    const wrongQuestions: LabQuestion[] = [];
    for (const item of queue) {
      const a = answers[item.instanceId];
      if (a && a.answered && !a.ok && !seen.has(item.questionId)) {
        seen.add(item.questionId);
        wrongQuestions.push(item.question);
      }
    }
    if (!wrongQuestions.length) return false;
    startSession({
      mode: 'dual_track',
      questions: wrongQuestions,
      title: '错题巩固再练',
      settings: {
        ...settings,
        delayedFeedback: false,
      },
    });
    return true;
  },
}));
