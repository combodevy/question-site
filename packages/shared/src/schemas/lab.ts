import { z } from 'zod';

export const LabConfidenceSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export const FsrsRatingSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

export const LabHistoryEntrySchema = z.object({
  rid: z.string().min(1),
  id: z.string().min(1),
  r: z.boolean(),
  t: z.number().finite(),
  d: z.number().nonnegative().optional(),
  capped: z.boolean().optional(),
  conf: LabConfidenceSchema.optional(),
  rating: FsrsRatingSchema.optional(),
  mode: z.string().max(40).optional(),
  blind: z.boolean().optional(),
  requeued: z.boolean().optional(),
});

export const LabSettingsSchema = z.object({
  desiredRetention: z.number().min(0.75).max(0.96).default(0.9),
  shuffleOptions: z.boolean().default(true),
  blindRecall: z.boolean().default(false),
  requeueWrong: z.boolean().default(true),
  delayedFeedback: z.boolean().default(false),
  confidenceMode: z.enum(['off', 'quick', 'required']).default('quick'),
  hideTimer: z.boolean().default(true),
  autoNextOnHighConf: z.boolean().default(false),
});
export type LabSettings = z.infer<typeof LabSettingsSchema>;

export const DEFAULT_LAB_SETTINGS: LabSettings = {
  desiredRetention: 0.9,
  shuffleOptions: true,
  blindRecall: false,
  requeueWrong: true,
  delayedFeedback: false,
  confidenceMode: 'quick',
  hideTimer: true,
  autoNextOnHighConf: false,
};

export function parseLabSettings(raw: unknown): LabSettings {
  const res = LabSettingsSchema.safeParse(raw);
  return res.success ? res.data : { ...DEFAULT_LAB_SETTINGS };
}

export const LabSyncMutationSchema = z.discriminatedUnion('op', [
  z.object({
    opId: z.string().min(1),
    op: z.literal('lab_append_history'),
    entries: z.array(LabHistoryEntrySchema).max(2000),
    lastPracticeTime: z.number().finite().nullable().optional(),
  }),
  z.object({
    opId: z.string().min(1),
    op: z.literal('lab_clear_history'),
  }),
  z.object({
    opId: z.string().min(1),
    op: z.literal('lab_set_flag'),
    questionId: z.string().min(1),
    starred: z.boolean().optional(),
    mistakeHidden: z.boolean().optional(),
    updatedAt: z.number().finite().optional(),
  }),
  z.object({
    opId: z.string().min(1),
    op: z.literal('lab_restore_hidden_mistakes'),
  }),
  z.object({
    opId: z.string().min(1),
    op: z.literal('lab_update_settings'),
    settings: LabSettingsSchema,
  }),
]);
export type LabSyncMutation = z.infer<typeof LabSyncMutationSchema>;

export const LabSyncPushRequestSchema = z.object({
  mutations: z.array(LabSyncMutationSchema).max(2000),
});
export type LabSyncPushRequest = z.infer<typeof LabSyncPushRequestSchema>;
