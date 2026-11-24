import { create } from 'zustand';
import type { LocalQuestion } from '@/db';

export type QuizMode = 'review' | 'random' | 'custom' | 'mistakes' | 'starred' | 'session_wrong' | 'filtered';

export interface QuizAnswerState {
  answered: boolean;
  userAns: string;
  ok: boolean;
  selfCheck?: boolean;
  durationMs: number;
}

export interface QuizSessionConfig {
  mode: QuizMode;
  questions: LocalQuestion[];
  title?: string;
}

export interface UnfinishedQuizSnapshot {
  version: 1;
  mode: QuizMode;
  title: string;
  questionIds: string[];
  idx: number;
  answers: Record<string, QuizAnswerState>;
  drafts: Record<string, string>;
  startedAt: number;
  savedAt: number;
}

const UNFINISHED_KEY_PREFIX = 'qs_v2_unfinished_quiz_';

function snapshotKey(userId: string): string {
  return `${UNFINISHED_KEY_PREFIX}${userId || 'anon'}`;
}

export function readUnfinishedQuizSnapshot(userId?: string): UnfinishedQuizSnapshot | null {
  try {
    const raw = localStorage.getItem(snapshotKey(userId || ''));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UnfinishedQuizSnapshot;
    if (
      !parsed ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.questionIds) ||
      parsed.questionIds.length === 0
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

export function clearUnfinishedQuizSnapshot(userId?: string): void {
  try {
    localStorage.removeItem(snapshotKey(userId || ''));
  } catch {
    // ignore
  }
}

function writeUnfinishedQuizSnapshot(userId: string, state: QuizStoreState): void {
  if (!state.active || state.finished || state.queue.length === 0) return;
  const answeredCount = Object.keys(state.answers).length;
  const hasDraft = Object.values(state.drafts).some((v) => Boolean(v));
  if (answeredCount === 0 && state.idx === 0 && !hasDraft) return;
  try {
    const snap: UnfinishedQuizSnapshot = {
      version: 1,
      mode: state.mode,
      title: state.title,
      questionIds: state.queue.map((q) => q.id),
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

interface QuizStoreState {
  userId: string;
  active: boolean;
  mode: QuizMode;
  title: string;
  queue: LocalQuestion[];
  idx: number;
  answers: Record<string, QuizAnswerState>;
  drafts: Record<string, string>;
  finished: boolean;
  startedAt: number;
  qStartedAt: number;
  setUserId: (uid: string) => void;
  startSession: (cfg: QuizSessionConfig) => void;
  resumeFromSnapshot: (snap: UnfinishedQuizSnapshot, availableQuestions: LocalQuestion[]) => boolean;
  setIndex: (idx: number) => void;
  setDraft: (qid: string, val: string) => void;
  recordAnswer: (qid: string, state: QuizAnswerState) => void;
  retryCurrentQuestion: () => void;
  finishSession: () => void;
  exitSession: () => void;
  retryWrong: () => boolean;
}

export const useQuizStore = create<QuizStoreState>((set, get) => ({
  userId: '',
  active: false,
  mode: 'random',
  title: '',
  queue: [],
  idx: 0,
  answers: {},
  drafts: {},
  finished: false,
  startedAt: 0,
  qStartedAt: 0,

  setUserId: (uid) => set({ userId: uid }),

  startSession: ({ mode, questions, title }) => {
    const now = Date.now();
    clearUnfinishedQuizSnapshot(get().userId);
    set({
      active: true,
      mode,
      title: title || '',
      queue: questions,
      idx: 0,
      answers: {},
      drafts: {},
      finished: false,
      startedAt: now,
      qStartedAt: now,
    });
  },

  resumeFromSnapshot: (snap, availableQuestions) => {
    const byId = new Map(availableQuestions.map((q) => [q.id, q]));
    const resolvedQueue = snap.questionIds
      .map((id) => byId.get(id))
      .filter((q): q is LocalQuestion => Boolean(q));
    if (resolvedQueue.length === 0) {
      clearUnfinishedQuizSnapshot(get().userId);
      return false;
    }

    const filteredAnswers: Record<string, QuizAnswerState> = {};
    const filteredDrafts: Record<string, string> = {};
    for (const q of resolvedQueue) {
      if (snap.answers?.[q.id]) filteredAnswers[q.id] = snap.answers[q.id];
      if (snap.drafts?.[q.id]) filteredDrafts[q.id] = snap.drafts[q.id];
    }

    let nextIdx = Math.max(0, Math.min(snap.idx || 0, resolvedQueue.length - 1));
    if (filteredAnswers[resolvedQueue[nextIdx]?.id]?.answered) {
      const firstUnanswered = resolvedQueue.findIndex((q) => !filteredAnswers[q.id]?.answered);
      if (firstUnanswered !== -1) nextIdx = firstUnanswered;
    }

    const nextState: Partial<QuizStoreState> = {
      active: true,
      mode: snap.mode,
      title: snap.title || '',
      queue: resolvedQueue,
      idx: nextIdx,
      answers: filteredAnswers,
      drafts: filteredDrafts,
      finished: false,
      startedAt: snap.startedAt || Date.now(),
      qStartedAt: Date.now(),
    };
    set(nextState);
    writeUnfinishedQuizSnapshot(get().userId, get());
    return true;
  },

  setIndex: (nextIdx) => {
    const { queue, userId } = get();
    if (nextIdx < 0 || nextIdx >= queue.length) return;
    set({ idx: nextIdx, qStartedAt: Date.now() });
    writeUnfinishedQuizSnapshot(userId, get());
  },

  setDraft: (qid, val) => {
    set((s) => ({ drafts: { ...s.drafts, [qid]: val } }));
    writeUnfinishedQuizSnapshot(get().userId, get());
  },

  recordAnswer: (qid, state) => {
    set((s) => ({
      answers: { ...s.answers, [qid]: state },
    }));
    writeUnfinishedQuizSnapshot(get().userId, get());
  },

  retryCurrentQuestion: () => {
    const { queue, idx, answers, drafts, userId } = get();
    const q = queue[idx];
    if (!q) return;
    const nextAnswers = { ...answers };
    delete nextAnswers[q.id];
    const nextDrafts = { ...drafts };
    delete nextDrafts[q.id];
    set({
      answers: nextAnswers,
      drafts: nextDrafts,
      qStartedAt: Date.now(),
    });
    writeUnfinishedQuizSnapshot(userId, get());
  },

  finishSession: () => {
    clearUnfinishedQuizSnapshot(get().userId);
    set({ finished: true });
  },

  exitSession: () => {
    clearUnfinishedQuizSnapshot(get().userId);
    set({
      active: false,
      queue: [],
      idx: 0,
      answers: {},
      drafts: {},
      finished: false,
    });
  },

  retryWrong: () => {
    const { queue, answers, startSession } = get();
    const wrong = queue.filter((q) => {
      const a = answers[q.id];
      return a && a.answered && !a.ok;
    });
    if (!wrong.length) return false;
    startSession({ mode: 'session_wrong', questions: wrong, title: '错题再练' });
    return true;
  },
}));
