import { z } from 'zod';
import { MediaItemSchema, QuestionTypeSchema } from './question.js';

export const HistoryEntrySchema = z.object({
    rid: z.string().min(1),
    id: z.string().min(1),
    r: z.boolean(),
    t: z.number().finite(),
    d: z.number().nonnegative().optional(),
    capped: z.boolean().optional(),
});
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

const UpsertQuestionDataSchema = z.object({
    id: z.string().min(1),
    type: QuestionTypeSchema,
    q: z.string().max(20000),
    o: z.array(z.string()).default([]),
    a: z.string().max(20000),
    sub: z.string().min(1).max(200),
    chap: z.string().min(1).max(200),
    d: z.string().default(''),
    media: z.array(MediaItemSchema).optional(),
    psg: z.string().optional(),
    _editedAt: z.number().finite().optional(),
    selfCheck: z.boolean().optional(),
});

export const SyncMutationSchema = z.discriminatedUnion('op', [
    z.object({
        opId: z.string().min(1),
        op: z.literal('upsert_question'),
        baseVersion: z.number().int().nonnegative().optional(),
        question: UpsertQuestionDataSchema,
    }),
    z.object({
        opId: z.string().min(1),
        op: z.literal('delete_question'),
        questionId: z.string().min(1),
        reason: z.string().max(100).optional(),
        deletedBy: z.string().max(50).optional(),
        deletedAt: z.number().finite().optional(),
    }),
    z.object({
        opId: z.string().min(1),
        op: z.literal('restore_question'),
        questionId: z.string().min(1),
        sub: z.string().min(1).max(200).optional(),
        chap: z.string().min(1).max(200).optional(),
    }),
    z.object({
        opId: z.string().min(1),
        op: z.literal('destroy_question'),
        questionId: z.string().min(1),
    }),
    z.object({
        opId: z.string().min(1),
        op: z.literal('empty_trash'),
    }),
    z.object({
        opId: z.string().min(1),
        op: z.literal('append_history'),
        entries: z.array(HistoryEntrySchema).max(2000),
        lastPracticeTime: z.number().finite().nullable().optional(),
    }),
    z.object({
        opId: z.string().min(1),
        op: z.literal('clear_history'),
    }),
    z.object({
        opId: z.string().min(1),
        op: z.literal('clear_bank'),
    }),
    z.object({
        opId: z.string().min(1),
        op: z.literal('set_flag'),
        questionId: z.string().min(1),
        starred: z.boolean().optional(),
        mistakeHidden: z.boolean().optional(),
        updatedAt: z.number().finite().optional(),
    }),
    z.object({
        opId: z.string().min(1),
        op: z.literal('restore_hidden_mistakes'),
    }),
    z.object({
        opId: z.string().min(1),
        op: z.literal('update_meta'),
        bankName: z.string().max(200).nullable().optional(),
        lastPracticeTime: z.number().finite().nullable().optional(),
    }),
    z.object({
        opId: z.string().min(1),
        op: z.literal('upsert_english_progress'),
        paperId: z.string().min(1).max(100),
        answers: z.record(z.string(), z.string()),
        graded: z.boolean(),
        result: z.record(z.string(), z.unknown()).nullable().optional(),
        updatedAt: z.number().finite().optional(),
    }),
]);
export type SyncMutation = z.infer<typeof SyncMutationSchema>;

export const SyncPushRequestSchema = z.object({
    mutations: z.array(SyncMutationSchema).max(2000),
});
export type SyncPushRequest = z.infer<typeof SyncPushRequestSchema>;
