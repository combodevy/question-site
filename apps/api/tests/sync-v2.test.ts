import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, reqJson } from './test-helper.js';

describe('Normalized v2 incremental sync protocol (/api/sync/push & /api/sync/pull)', () => {
    const cleanups: Array<() => void> = [];
    afterEach(() => {
        while (cleanups.length) cleanups.pop()?.();
    });

    it('handles idempotent opIds, row conflicts, soft-delete/restore/destroy, non-resurrecting flags, history reset, and English progress', async () => {
        const { db, app } = createTestContext();
        cleanups.push(() => db.close());

        const su = await reqJson(app, '/api/auth/signup', {
            method: 'POST',
            body: { username: 'syncer', password: 'Password123' },
        });
        const token = su.json?.token as string;

        // 1. 推送建题 + 收藏 + 隐藏错题 + 做题记录 + 英语进度
        const push1 = await reqJson(app, '/api/sync/push', {
            method: 'POST',
            token,
            body: {
                mutations: [
                    {
                        opId: 'op-q1',
                        op: 'upsert_question',
                        question: {
                            id: 'q1',
                            type: 'fill',
                            q: 'Formula?',
                            o: [],
                            a: 'H2SO4',
                            sub: 'Chem',
                            chap: 'Ch1',
                            d: 'acid',
                        },
                    },
                    {
                        opId: 'op-flag1',
                        op: 'set_flag',
                        questionId: 'q1',
                        starred: true,
                        mistakeHidden: true,
                    },
                    {
                        opId: 'op-hist1',
                        op: 'append_history',
                        entries: [{ rid: 'r1', id: 'q1', r: false, t: 1700000010000 }],
                    },
                    {
                        opId: 'op-eng1',
                        op: 'upsert_english_progress',
                        paperId: 'cet4-2026-06-03',
                        answers: { '26': 'I', '27': 'L' },
                        graded: true,
                        result: { correct: 2, total: 2 },
                    },
                ],
            },
        });
        expect(push1.status).toBe(200);
        const cursor1 = push1.json?.cursor as number;
        expect(cursor1).toBe(4);

        // 2. 重放 op-q1 必须幂等跳过（不返回冲突）
        const replay = await reqJson(app, '/api/sync/push', {
            method: 'POST',
            token,
            body: {
                mutations: [
                    {
                        opId: 'op-q1',
                        op: 'upsert_question',
                        question: {
                            id: 'q1',
                            type: 'fill',
                            q: 'Should be ignored duplicate',
                            o: [],
                            a: 'X',
                            sub: 'Chem',
                            chap: 'Ch1',
                            d: '',
                        },
                    },
                ],
            },
        });
        expect(replay.status).toBe(200);
        expect((replay.json?.results as Array<{ status: string }>)[0].status).toBe('duplicate');
        expect(replay.json?.cursor).toBe(cursor1);

        // 3. 基于过期 baseVersion 修改 q1 返回行级 conflict
        const rowConflict = await reqJson(app, '/api/sync/push', {
            method: 'POST',
            token,
            body: {
                mutations: [
                    {
                        opId: 'op-q1-stale',
                        op: 'upsert_question',
                        baseVersion: 99,
                        question: {
                            id: 'q1',
                            type: 'fill',
                            q: 'Stale',
                            o: [],
                            a: 'X',
                            sub: 'Chem',
                            chap: 'Ch1',
                            d: '',
                        },
                    },
                ],
            },
        });
        expect((rowConflict.json?.results as Array<{ status: string }>)[0].status).toBe('conflict');

        // 4. 取消收藏 + 恢复隐藏错题（布尔覆盖，永不复活）
        const push2 = await reqJson(app, '/api/sync/push', {
            method: 'POST',
            token,
            body: {
                mutations: [
                    { opId: 'op-unstar', op: 'set_flag', questionId: 'q1', starred: false },
                    { opId: 'op-unhide', op: 'restore_hidden_mistakes' },
                ],
            },
        });
        expect(push2.status).toBe(200);
        const cursor2 = push2.json?.cursor as number;

        // 仅拉取 cursor1 之后的增量
        const pullDelta = await reqJson(app, `/api/sync/pull?cursor=${cursor1}`, { token });
        expect(pullDelta.status).toBe(200);
        expect(pullDelta.json?.cursor).toBe(cursor2);
        expect((pullDelta.json?.questions as unknown[]).length).toBe(0);
        const pulledFlags = pullDelta.json?.flags as Array<{
            questionId: string;
            starred: boolean;
            mistakeHidden: boolean;
        }>;
        expect(pulledFlags).toEqual([
            expect.objectContaining({ questionId: 'q1', starred: false, mistakeHidden: false }),
        ]);

        // 5. 软删除 → 恢复（含还原收藏）→ 彻底销毁墓碑 → 清空历史标记
        const push3 = await reqJson(app, '/api/sync/push', {
            method: 'POST',
            token,
            body: {
                mutations: [
                    { opId: 'op-re-star', op: 'set_flag', questionId: 'q1', starred: true },
                    { opId: 'op-del', op: 'delete_question', questionId: 'q1' },
                ],
            },
        });
        expect(push3.status).toBe(200);

        const push4 = await reqJson(app, '/api/sync/push', {
            method: 'POST',
            token,
            body: {
                mutations: [
                    { opId: 'op-rest', op: 'restore_question', questionId: 'q1' },
                ],
            },
        });
        expect(push4.status).toBe(200);

        // 确认还原后 was_starred 自动恢复为 starred=true
        const pullAll = await reqJson(app, '/api/sync/pull?cursor=0', { token });
        expect((pullAll.json?.questions as Array<{ deletedAt: number | null }>)[0].deletedAt).toBeNull();
        expect((pullAll.json?.flags as Array<{ starred: boolean }>)[0].starred).toBe(true);
        expect((pullAll.json?.englishProgress as Array<{ paperId: string }>)[0].paperId).toBe(
            'cet4-2026-06-03'
        );

        const push5 = await reqJson(app, '/api/sync/push', {
            method: 'POST',
            token,
            body: {
                mutations: [
                    { opId: 'op-destroy', op: 'destroy_question', questionId: 'q1' },
                    { opId: 'op-clr-hist', op: 'clear_history' },
                ],
            },
        });
        expect(push5.status).toBe(200);

        const pullAfterDestroy = await reqJson(app, `/api/sync/pull?cursor=${cursor2}`, { token });
        expect(pullAfterDestroy.json?.historyResetRequired).toBe(true);
        expect((pullAfterDestroy.json?.questions as Array<{ purged: boolean }>)[0].purged).toBe(
            true
        );
    });

    it('roundtrips Q&A questions with long multiline answers (>500 chars) and multi-blank fill questions', async () => {
        const { db, app } = createTestContext();
        cleanups.push(() => db.close());

        const su = await reqJson(app, '/api/auth/signup', {
            method: 'POST',
            body: { username: 'qa_syncer', password: 'Password123' },
        });
        const token = su.json?.token as string;
        const longQaAnswer = (
            'MCP (Model Context Protocol) 是一种开放协议：\n' + '1. 标准化模型与外部工具、数据源之间的上下文交互；\n'.repeat(25)
        ).trim();
        expect(longQaAnswer.length).toBeGreaterThan(600);

        const pushRes = await reqJson(app, '/api/sync/push', {
            method: 'POST',
            token,
            body: {
                mutations: [
                    {
                        opId: 'op-qa-1',
                        op: 'upsert_question',
                        question: {
                            id: 'qa-1',
                            type: 'qa',
                            q: '简述一下 MCP 协议的核心作用。',
                            o: [],
                            a: longQaAnswer,
                            sub: 'AI 工程',
                            chap: '第一章',
                            d: '关注 Client/Server/Host 架构与 Tools/Resources/Prompts 原语。',
                        },
                    },
                    {
                        opId: 'op-fill-multi-1',
                        op: 'upsert_question',
                        question: {
                            id: 'fill-multi-1',
                            type: 'fill',
                            q: '网页安全传输协议缩写是 __，默认端口为 __。',
                            o: [],
                            a: 'HTTPS|超文本传输安全协议;;443|四四三',
                            sub: '计算机网络',
                            chap: '应用层',
                            d: 'HTTPS 默认端口 443，HTTP 默认 80。',
                        },
                    },
                ],
            },
        });
        expect(pushRes.status).toBe(200);
        expect((pushRes.json?.results as Array<{ status: string }>).map((r) => r.status)).toEqual([
            'applied',
            'applied',
        ]);

        const pullRes = await reqJson(app, '/api/sync/pull?cursor=0', { token });
        expect(pullRes.status).toBe(200);
        const qs = pullRes.json?.questions as Array<{ id: string; type: string; a: string }>;
        const qa = qs.find((q) => q.id === 'qa-1');
        const fill = qs.find((q) => q.id === 'fill-multi-1');
        expect(qa?.type).toBe('qa');
        expect(qa?.a).toBe(longQaAnswer);
        expect(fill?.type).toBe('fill');
        expect(fill?.a).toBe('HTTPS|超文本传输安全协议;;443|四四三');
    });
});
