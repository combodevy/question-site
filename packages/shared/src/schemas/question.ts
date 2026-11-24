import { z } from 'zod';

export const UNSAFE_OBJECT_KEYS = new Set([
    '__proto__',
    'prototype',
    'constructor',
    'toString',
    'valueOf',
    'hasOwnProperty',
]);

export function isSafeKey(k: unknown): k is string {
    return (
        typeof k === 'string' &&
        k.trim().length > 0 &&
        k.length <= 200 &&
        !UNSAFE_OBJECT_KEYS.has(k)
    );
}

export const QuestionTypeSchema = z.enum(['mcq', 'multi', 'tf', 'fill']);
export type QuestionType = z.infer<typeof QuestionTypeSchema>;

export const MediaImgSchema = z.object({
    type: z.literal('img').optional().default('img'),
    key: z.string(),
    src: z.string(),
    alt: z.string().optional(),
});

export const MediaTableSchema = z.object({
    type: z.literal('table'),
    key: z.string(),
    html: z.string(),
    caption: z.string().optional(),
});

export const MediaItemSchema = z.union([MediaImgSchema, MediaTableSchema]);
export type MediaItem = z.infer<typeof MediaItemSchema>;

export const QuestionSchema = z.object({
    id: z.string().min(1),
    type: QuestionTypeSchema,
    q: z.string().max(20000),
    o: z.array(z.string()).default([]),
    a: z.string().max(500),
    sub: z.string().min(1).max(200),
    chap: z.string().min(1).max(200),
    d: z.string().default(''),
    media: z.array(MediaItemSchema).optional(),
    psg: z.string().optional(),
    _editedAt: z.number().finite().optional(),
    selfCheck: z.boolean().optional(),
});
export type Question = z.infer<typeof QuestionSchema>;

export function normalizeQuestion(
    raw: unknown,
    defaultSub = '默认科目',
    defaultChap = '默认章节'
): Question | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;

    const qText =
        (typeof r.q === 'string' && r.q) ||
        (typeof r.stem === 'string' && r.stem) ||
        (typeof r.question === 'string' && r.question) ||
        (typeof r.title === 'string' && r.title) ||
        '';

    let opts: unknown[] = [];
    if (Array.isArray(r.o)) opts = r.o;
    else if (Array.isArray(r.options)) opts = r.options;
    else if (typeof r.options === 'string') {
        try {
            const parsed = JSON.parse(r.options);
            if (Array.isArray(parsed)) opts = parsed;
        } catch {
            opts = [];
        }
    }
    const cleanOpts = opts
        .map((o) => String(o == null ? '' : o).trim())
        .filter(Boolean);

    const aText =
        (typeof r.a === 'string' && r.a) ||
        (typeof r.ans === 'string' && r.ans) ||
        (typeof r.answer === 'string' && r.answer) ||
        (typeof r.correct === 'string' && r.correct) ||
        '';

    let type: QuestionType;
    const rawType = r.type;
    if (rawType === '单选' || rawType === '单选题') type = 'mcq';
    else if (rawType === '多选' || rawType === '多选题') type = 'multi';
    else if (rawType === '判断' || rawType === '判断题') type = 'tf';
    else if (rawType === '填空' || rawType === '填空题') type = 'fill';
    else if (rawType === 'mcq' || rawType === 'multi' || rawType === 'tf' || rawType === 'fill') {
        type = rawType;
    } else {
        type =
            cleanOpts.length === 2 &&
            (cleanOpts.includes('正确') || cleanOpts.includes('对') || cleanOpts.includes('True'))
                ? 'tf'
                : aText.trim().length > 1
                  ? 'multi'
                  : 'mcq';
    }

    const rawSub =
        (typeof r.sub === 'string' && r.sub.trim()) ||
        (typeof r.subject === 'string' && r.subject.trim()) ||
        defaultSub;
    const rawChap =
        (typeof r.chap === 'string' && r.chap.trim()) ||
        (typeof r.chapter === 'string' && r.chapter.trim()) ||
        (type === 'multi' ? '多选题' : type === 'tf' ? '判断题' : '单选题');

    const sub = isSafeKey(rawSub) ? rawSub : '默认科目';
    const chap = isSafeKey(rawChap) ? rawChap : defaultChap;
    const id = typeof r.id === 'string' && r.id.trim() ? r.id : crypto.randomUUID();
    const d =
        (typeof r.d === 'string' && r.d) ||
        (typeof r.desc === 'string' && r.desc) ||
        (typeof r.analysis === 'string' && r.analysis) ||
        (typeof r.explanation === 'string' && r.explanation) ||
        '';

    const out: Question = {
        id,
        type,
        q: qText,
        o: cleanOpts,
        a: type === 'fill' ? aText.trim() : aText.toUpperCase().trim(),
        sub,
        chap,
        d,
    };

    if (Array.isArray(r.media)) out.media = r.media as MediaItem[];
    if (typeof r.psg === 'string' && r.psg) out.psg = r.psg;
    if (typeof r._editedAt === 'number' && Number.isFinite(r._editedAt)) {
        out._editedAt = r._editedAt;
    }
    if (typeof r.selfCheck === 'boolean') out.selfCheck = r.selfCheck;
    return out;
}

export function questionFingerprint(q: {
    q: string;
    o: string[];
    a: string;
    type: string;
    sub: string;
    chap: string;
    media?: unknown;
    psg?: string | null;
}): string {
    return JSON.stringify({
        q: q.q,
        o: q.o,
        a: q.a,
        type: q.type,
        sub: q.sub,
        chap: q.chap,
        media: q.media || null,
        psg: q.psg || null,
    });
}
