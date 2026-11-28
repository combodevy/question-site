import Dexie, { type Table } from 'dexie';
import type {
  LabHistoryEntry,
  LabSettings,
  LabSyncMutation,
  Question,
} from '@qs/shared';

export interface LabQuestion extends Question {
  version: number;
  deletedAt: number | null;
  deleteReason?: string | null;
  originalPath?: { sub?: string | null; chap?: string | null };
  wasStarred?: boolean;
  updatedAt: number;
}

export interface LabFlag {
  questionId: string;
  starred: boolean;
  mistakeHidden: boolean;
  updatedAt: number;
}

export interface LabMetaEntry {
  key: string;
  value: unknown;
}

export interface LabOutboxEntry {
  seq?: number;
  opId: string;
  op: LabSyncMutation['op'];
  mutation: LabSyncMutation;
  createdAt: number;
}

export type LabStoredSettings = LabSettings;

export class QsLabDatabase extends Dexie {
  questions!: Table<LabQuestion, string>;
  history!: Table<LabHistoryEntry, string>;
  flags!: Table<LabFlag, string>;
  meta!: Table<LabMetaEntry, string>;
  outbox!: Table<LabOutboxEntry, number>;

  constructor(userId: string) {
    super(`qs_lab_${userId}`);
    this.version(1).stores({
      questions: 'id, sub, chap, type, deletedAt, updatedAt',
      history: 'rid, id, t',
      flags: 'questionId, starred, mistakeHidden',
      meta: 'key',
      outbox: '++seq, &opId, op, createdAt',
    });
  }
}

const labDbPool = new Map<string, QsLabDatabase>();

export function getLabDb(userId: string): QsLabDatabase {
  let db = labDbPool.get(userId);
  if (!db) {
    db = new QsLabDatabase(userId);
    labDbPool.set(userId, db);
  }
  return db;
}

export async function closeLabDb(userId: string): Promise<void> {
  const db = labDbPool.get(userId);
  if (db) {
    db.close();
    labDbPool.delete(userId);
  }
}

export async function deleteLabDb(userId: string): Promise<void> {
  await closeLabDb(userId);
  await Dexie.delete(`qs_lab_${userId}`);
}
