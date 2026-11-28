import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, reqJson } from './test-helper.js';

describe('Science Lab isolated sync protocol (/api/lab/sync)', () => {
    const cleanups: Array<() => void> = [];
    afterEach(() => {
        while (cleanups.length) cleanups.pop()?.();
    });

    it('shares users & v2_questions read-only while keeping history, flags, and resets completely isolated', async () => {
        const { db, app } = createTestContext();
        cleanups.push(() => db.close());

        const su = await reqJson(app, '/api/auth/signup', {
            method: 'POST',
            body: { username: 'labuser', password: 'Password123' },
        });
        expect(su.status).toBe(200);
        const token = su.json?.token as string;

        // 1. Seed shared question + classic history + classic flag via /api/sync/push
        const classicPush = await reqJson(app, '/api/sync/push', {
            method: 'POST',
            token,
            body: {
                mutations: [
                    {
                        opId: 'c-q1',
                        op: 'upsert_question',
                        question: {
                            id: 'shared-q1',
                            type: 'mcq',
                            q: 'Which theorem connects factor prices?',
                            o: ['Stolper-Samuelson', 'Rybczynski', 'Ricardian', 'Gravity'],
                            a: 'A',
                            sub: 'Intl Trade',
                            chap: 'Ch2',
                            d: 'Stolper-Samuelson links output price to factor returns.',
                        },
                    },
                    {
                        opId: 'c-hist1',
                        op: 'append_history',
                        entries: [{ rid: 'c-r1', id: 'shared-q1', r: false, t: 1700000001000, d: 4200 }],
                    },
                    {
                        opId: 'c-flag1',
                        op: 'set_flag',
                        questionId: 'shared-q1',
                        starred: true,
                    },
                ],
            },
        });
        expect(classicPush.status).toBe(200);

        // 2. Pull Lab: must see shared-q1, MUST NOT see classic history or classic flags
        const labPull1 = await reqJson(app, '/api/lab/sync/pull?cursor=0&bankCursor=0', { token });
        expect(labPull1.status).toBe(200);
        expect((labPull1.json?.questions as Array<{ id: string }>).map((q) => q.id)).toEqual([
            'shared-q1',
        ]);
        expect(labPull1.json?.history).toEqual([]);
        expect(labPull1.json?.flags).toEqual([]);
        const bankCursor1 = labPull1.json?.bankCursor as number;
        expect(bankCursor1).toBeGreaterThan(0);

        // 3. Push Lab history (with confidence/rating/blind/requeued), flag, and settings
        const labPush1 = await reqJson(app, '/api/lab/sync/push', {
            method: 'POST',
            token,
            body: {
                mutations: [
                    {
                        opId: 'l-hist1',
                        op: 'lab_append_history',
                        entries: [
                            {
                                rid: 'l-r1',
                                id: 'shared-q1',
                                r: false,
                                t: 1700000100000,
                                d: 8100,
                                conf: 3,
                                mode: 'smart_interleave',
                                blind: true,
                            },
                            {
                                rid: 'l-r2',
                                id: 'shared-q1',
                                r: true,
                                t: 1700000200000,
                                d: 5200,
                                conf: 1,
                                rating: 2,
                                requeued: true,
                            },
                        ],
                    },
                    {
                        opId: 'l-flag1',
                        op: 'lab_set_flag',
                        questionId: 'shared-q1',
                        starred: false,
                        mistakeHidden: true,
                    },
                    {
                        opId: 'l-set1',
                        op: 'lab_update_settings',
                        settings: {
                            desiredRetention: 0.88,
                            shuffleOptions: true,
                            blindRecall: true,
                            requeueWrong: true,
                            delayedFeedback: false,
                            confidenceMode: 'required',
                            hideTimer: true,
                            autoNextOnHighConf: false,
                        },
                    },
                ],
            },
        });
        expect(labPush1.status).toBe(200);
        expect(labPush1.json?.cursor).toBe(3);

        // 4. Verify Classic /api/sync/pull did NOT receive any Lab history or Lab flag overwrite
        const classicPull = await reqJson(app, '/api/sync/pull?cursor=0', { token });
        expect(classicPull.status).toBe(200);
        const classicHist = classicPull.json?.history as Array<{ rid: string }>;
        expect(classicHist.map((h) => h.rid)).toEqual(['c-r1']);
        const classicFlags = classicPull.json?.flags as Array<{
            questionId: string;
            starred: boolean;
            mistakeHidden: boolean;
        }>;
        expect(classicFlags).toEqual([
            {
                questionId: 'shared-q1',
                starred: true,
                mistakeHidden: false,
                updatedAt: expect.any(Number),
                syncSeq: expect.any(Number),
            },
        ]);

        // 5. Verify Lab pull persists metadata, settings, history fields, and incremental bankCursor
        const labPull2 = await reqJson(
            app,
            `/api/lab/sync/pull?cursor=0&bankCursor=${bankCursor1}`,
            { token }
        );
        expect(labPull2.status).toBe(200);
        expect(labPull2.json?.questions).toEqual([]);
        expect((labPull2.json?.settings as Record<string, unknown>).desiredRetention).toBe(0.88);
        expect((labPull2.json?.settings as Record<string, unknown>).confidenceMode).toBe('required');
        const labHist = labPull2.json?.history as Array<Record<string, unknown>>;
        expect(labHist).toHaveLength(2);
        expect(labHist[0]).toMatchObject({
            rid: 'l-r1',
            id: 'shared-q1',
            r: false,
            conf: 3,
            mode: 'smart_interleave',
            blind: true,
        });
        expect(labHist[1]).toMatchObject({
            rid: 'l-r2',
            r: true,
            conf: 1,
            rating: 2,
            requeued: true,
        });

        // 6. Idempotent replay of l-hist1
        const replay = await reqJson(app, '/api/lab/sync/push', {
            method: 'POST',
            token,
            body: {
                mutations: [
                    {
                        opId: 'l-hist1',
                        op: 'lab_append_history',
                        entries: [{ rid: 'l-r99', id: 'shared-q1', r: true, t: 1700000300000 }],
                    },
                ],
            },
        });
        expect(replay.status).toBe(200);
        expect((replay.json?.results as Array<{ status: string }>)[0].status).toBe('duplicate');

        // 7. Clear Lab history: Lab resets cleanly while Classic history and shared bank remain intact
        const labClear = await reqJson(app, '/api/lab/sync/push', {
            method: 'POST',
            token,
            body: {
                mutations: [{ opId: 'l-clear-1', op: 'lab_clear_history' }],
            },
        });
        expect(labClear.status).toBe(200);
        const labClearCursor = labClear.json?.cursor as number;

        const labPullAfterClear = await reqJson(
            app,
            `/api/lab/sync/pull?cursor=3&bankCursor=0`,
            { token }
        );
        expect(labPullAfterClear.status).toBe(200);
        expect(labPullAfterClear.json?.historyResetRequired).toBe(true);
        expect(labPullAfterClear.json?.cursor).toBe(labClearCursor);
        expect(
            (labPullAfterClear.json?.questions as Array<{ id: string }>).map((q) => q.id)
        ).toEqual(['shared-q1']);

        const classicPullAfterLabClear = await reqJson(app, '/api/sync/pull?cursor=0', { token });
        expect((classicPullAfterLabClear.json?.history as Array<{ rid: string }>).map((h) => h.rid)).toEqual([
            'c-r1',
        ]);
    });
});
