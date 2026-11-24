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

interface QuizStoreState {
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
  startSession: (cfg: QuizSessionConfig) => void;
  setIndex: (idx: number) => void;
  setDraft: (qid: string, val: string) => void;
  recordAnswer: (qid: string, state: QuizAnswerState) => void;
  finishSession: () => void;
  exitSession: () => void;
  retryWrong: () => boolean;
}

export const useQuizStore = create<QuizStoreState>((set, get) => ({
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

  startSession: ({ mode, questions, title }) => {
    const now = Date.now();
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

  setIndex: (nextIdx) => {
    const { queue } = get();
    if (nextIdx < 0 || nextIdx >= queue.length) return;
    set({ idx: nextIdx, qStartedAt: Date.now() });
  },

  setDraft: (qid, val) => {
    set((s) => ({ drafts: { ...s.drafts, [qid]: val } }));
  },

  recordAnswer: (qid, state) => {
    set((s) => ({
      answers: { ...s.answers, [qid]: state },
    }));
  },

  finishSession: () => {
    set({ finished: true });
  },

  exitSession: () => {
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
