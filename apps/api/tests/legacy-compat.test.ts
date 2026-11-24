import { afterEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { createTestContext, reqJson } from './test-helper.js';
import { generateSalt, hashPassword } from '../src/lib/crypto.js';

describe('Legacy API compatibility, admin console & merged server-ops', () => {
    const cleanups: Array<() => void> = [];
    afterEach(() => {
        while (cleanups.length) cleanups.pop()?.();
    });

    it('handles load-question-set ETag 304, gzipped save-question-set, replaceFields, clearBank, 409 conflicts, and admin dossier', async () => {
        const { db, app } = createTestContext();
        cleanups.push(() => db.close());

        const adminId = crypto.randomUUID();
        const salt = generateSalt();
        const hash = await hashPassword('AdminPass123!', salt);
        db.prepare(
            'INSERT INTO users (id, username, password_hash, salt, token_version) VALUES (?, ?, ?, ?, 1)'
        ).run(adminId, 'admin', hash, salt);

        const admLogin = await reqJson(app, '/api/auth/login', {
            method: 'POST',
            body: { username: 'admin', password: 'AdminPass123!' },
        });
        const adminToken = admLogin.json?.token as string;

        const su = await reqJson(app, '/api/auth/signup', {
            method: 'POST',
            body: { username: 'student1', password: 'Password123' },
        });
        const userToken = su.json?.token as string;
        const userId = (su.json?.user as { id: string }).id;

        const q1 = {
            id: 'q1',
            type: 'mcq',
            q: '看 [图1] 选答案',
            o: ['A', 'B'],
            a: 'A',
            sub: 'S1',
            chap: 'C1',
            d: '',
            media: [{ type: 'img', key: '图1', src: 'https://example.com/1.png' }],
        };
        const q2 = {
            id: 'q2',
            type: 'mcq',
            q: '看 [图1] 选答案',
            o: ['A', 'B'],
            a: 'B',
            sub: 'S1',
            chap: 'C1',
            d: '',
            media: [{ type: 'img', key: '图1', src: 'https://example.com/2.png' }],
        };
        const qFill = {
            id: 'q3',
            type: 'fill',
            q: '公式?',
            o: [],
            a: 'NaCl',
            sub: 'S1',
            chap: 'C1',
            d: '',
        };
        const nowTs = Date.now();
        const hist = [
            { rid: 'r1', id: 'q1', r: true, t: nowTs - 86_400_000 },
            { rid: 'r2', id: 'q3', r: false, t: nowTs - 1000 },
        ];

        // Gzip 压缩上传 save-question-set
        const gzipPayload = zlib.gzipSync(
            JSON.stringify({
                name: '主库',
                version: 0,
                questions: [q1, q2, qFill],
                state: {
                    bankName: '主库',
                    history: hist,
                    starred: ['q1', 'q2'],
                    hiddenMistakeIds: ['q3'],
                    trash: { S1: { C1: [{ id: 'qt1', q: 'old', o: ['x', 'y'], a: 'A' }] } },
                    lastPracticeTime: nowTs,
                },
            })
        );
        const gzipRes = await app.fetch(
            new Request('https://quiz.devy.cc.cd/api/save-question-set', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${userToken}`,
                    'Content-Type': 'application/json',
                    'Content-Encoding': 'gzip',
                },
                body: gzipPayload,
            })
        );
        expect(gzipRes.status).toBe(200);
        const saveJson = (await gzipRes.json()) as { setId: number; version: number };
        expect(saveJson.version).toBe(1);

        // ETag 命中 304
        const load1 = await reqJson(app, '/api/load-question-set', { token: userToken });
        expect(load1.status).toBe(200);
        const etag = load1.headers.get('etag')!;
        expect(etag).toBeTruthy();

        const load304 = await reqJson(app, '/api/load-question-set', {
            token: userToken,
            headers: { 'If-None-Match': etag },
        });
        expect(load304.status).toBe(304);

        // 版本不匹配返 409
        const conflict = await reqJson(app, '/api/save-question-set', {
            method: 'POST',
            token: userToken,
            body: {
                name: '主库',
                version: 0,
                skipQuestionsUpdate: false,
                questions: [q1],
                state: { history: hist, starred: [], trash: {} },
            },
        });
        expect(conflict.status).toBe(409);

        // replaceFields 取消收藏 & 恢复错题不复活
        const inc = await reqJson(app, '/api/save-question-set', {
            method: 'POST',
            token: userToken,
            body: {
                name: '主库',
                version: 1,
                statePartial: true,
                skipQuestionsUpdate: true,
                historyAppend: null,
                partialFields: ['lastPracticeTime', 'hiddenMistakeIds', 'starred'],
                replaceFields: ['starred', 'hiddenMistakeIds'],
                partialValues: {
                    lastPracticeTime: nowTs,
                    starred: ['q1'],
                    hiddenMistakeIds: [],
                },
            },
        });
        expect(inc.status).toBe(200);

        // 管理端用户 360° 档案统计准确
        const dossier = await reqJson(app, `/api/admin/user-dossier?userId=${encodeURIComponent(userId)}`, {
            token: adminToken,
        });
        expect(dossier.status).toBe(200);
        expect(dossier.json?.studyStats).toMatchObject({
            totalQuestions: 3,
            answeredCount: 2,
            correctCount: 1,
            wrongCount: 1,
            accuracyPercent: 50,
            favoritesCount: 1,
            trashCount: 1,
            sm2DueCount: 2,
        });

        // 管理员编辑保留 media 与 fill 大小写
        const admUpd = await reqJson(app, '/api/admin/users-update-bank', {
            method: 'POST',
            token: adminToken,
            body: {
                userId,
                setId: saveJson.setId,
                name: '主库',
                questions: [q1, q2, qFill],
            },
        });
        expect(admUpd.status).toBe(200);

        const afterAdm = await reqJson(app, '/api/load-question-set', { token: userToken });
        const bank = (afterAdm.json?.state as Record<string, unknown>).bank as Record<
            string,
            Record<string, Array<{ a: string; media?: unknown[] }>>
        >;
        expect(bank.S1.C1.length).toBe(3);
        expect(bank.S1.C1[0].media?.length).toBe(1);
        expect(bank.S1.C1[2].a).toBe('NaCl');

        // clearBank 后清空 active bank 并保持 {}
        const clr = await reqJson(app, '/api/save-question-set', {
            method: 'POST',
            token: userToken,
            body: {
                name: '主库',
                version: afterAdm.json?.version,
                questions: [],
                skipQuestionsUpdate: false,
                state: { history: hist, trash: {}, starred: [], hiddenMistakeIds: [] },
            },
        });
        expect(clr.status).toBe(200);

        const afterClr = await reqJson(app, '/api/load-question-set', { token: userToken });
        expect((afterClr.json?.state as Record<string, unknown>).bank).toEqual({});

        // user-backups 创建与列表/单条读取
        const bkCreate = await reqJson(app, '/api/user-backups', {
            method: 'POST',
            token: userToken,
            body: { type: 'bank', payload: { S1: { C1: [q1] } } },
        });
        expect(bkCreate.status).toBe(200);
        const bkList = await reqJson(app, '/api/user-backups', { token: userToken });
        expect((bkList.json?.backups as unknown[]).length).toBe(1);

        // overview-stats & push-broadcast（含去重跳过）
        const stats = await reqJson(app, '/api/admin/overview-stats', { token: adminToken });
        expect(stats.status).toBe(200);
        expect((stats.json?.stats as { users: number }).users).toBeGreaterThanOrEqual(2);

        const pushBc = await reqJson(app, '/api/admin/push-broadcast', {
            method: 'POST',
            token: adminToken,
            body: {
                target: 'user',
                userId,
                bankName: '广播库',
                questions: [q1, q1], // 第2题应被指纹去重跳过
            },
        });
        expect(pushBc.status).toBe(200);
        expect((pushBc.json?.summary as { skippedDuplicate: number }).skippedDuplicate).toBe(1);

        // server-ops 未登录 401，普通用户 403
        expect((await reqJson(app, '/api/admin/server-ops/metrics')).status).toBe(401);
        expect(
            (await reqJson(app, '/api/admin/server-ops/metrics', { token: userToken })).status
        ).toBe(403);
    });
});
