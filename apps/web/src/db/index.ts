import Dexie, { type Table } from 'dexie';
import type { HistoryEntry, Question, SyncMutation } from '@qs/shared';

export interface LocalQuestion extends Question {
  version: number;
  deletedAt: number | null;
  deleteReason?: string | null;
  originalPath?: { sub?: string | null; chap?: string | null };
  wasStarred?: boolean;
  updatedAt: number;
}

export interface LocalFlag {
  questionId: string;
  starred: boolean;
  mistakeHidden: boolean;
  updatedAt: number;
}

export interface LocalEnglishProgress {
  paperId: string;
  answers: Record<string, string>;
  graded: boolean;
  result: Record<string, unknown> | null;
  updatedAt: number;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

export interface OutboxEntry {
  seq?: number;
  opId: string;
  op: SyncMutation['op'];
  mutation: SyncMutation;
  createdAt: number;
}

export class QsDatabase extends Dexie {
  questions!: Table<LocalQuestion, string>;
  history!: Table<HistoryEntry, string>;
  flags!: Table<LocalFlag, string>;
  englishProgress!: Table<LocalEnglishProgress, string>;
  meta!: Table<MetaEntry, string>;
  outbox!: Table<OutboxEntry, number>;

  constructor(userId: string) {
    super(`qs_v2_${userId}`);
    this.version(1).stores({
      questions: 'id, sub, chap, type, deletedAt, updatedAt',
      history: 'rid, id, t',
      flags: 'questionId, starred, mistakeHidden',
      englishProgress: 'paperId, graded, updatedAt',
      meta: 'key',
      outbox: '++seq, &opId, op, createdAt',
    });
  }
}

const dbPool = new Map<string, QsDatabase>();

export function getUserDb(userId: string): QsDatabase {
  let db = dbPool.get(userId);
  if (!db) {
    db = new QsDatabase(userId);
    dbPool.set(userId, db);
  }
  return db;
}

export async function closeUserDb(userId: string): Promise<void> {
  const db = dbPool.get(userId);
  if (db) {
    db.close();
    dbPool.delete(userId);
  }
}

export async function deleteUserDb(userId: string): Promise<void> {
  await closeUserDb(userId);
  await Dexie.delete(`qs_v2_${userId}`);
}
