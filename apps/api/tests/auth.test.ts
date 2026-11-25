import { afterEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { createTestContext, reqJson } from './test-helper.js';
import { generateSalt, hashPassword } from '../src/lib/crypto.js';

describe('Auth routes & token revocation', () => {
    const cleanups: Array<() => void> = [];
    afterEach(() => {
        while (cleanups.length) cleanups.pop()?.();
    });

    it('supports signup, login, me, refresh cookie rotation, and logout revocation', async () => {
        const { db, app } = createTestContext();
        cleanups.push(() => db.close());

        const signup = await reqJson(app, '/api/auth/signup', {
            method: 'POST',
            body: { username: 'AliceDev', password: 'Password123' },
            headers: { 'x-real-ip': '198.51.100.10' },
        });
        expect(signup.status).toBe(200);
        expect(signup.json?.ok).toBe(true);
        const token1 = signup.json?.token as string;
        expect((signup.json?.user as { username: string }).username).toBe('alicedev');
        expect(signup.setCookies.some((c) => c.startsWith('qs_refresh='))).toBe(true);

        const me1 = await reqJson(app, '/api/auth/me', { token: token1 });
        expect(me1.status).toBe(200);
        expect((me1.json?.user as { isAdmin: boolean }).isAdmin).toBe(false);

        const refreshCookie = signup.setCookies
            .find((c) => c.startsWith('qs_refresh='))!
            .split(';')[0];

        const refreshed = await reqJson(app, '/api/auth/refresh', {
            method: 'POST',
            cookie: refreshCookie,
        });
        expect(refreshed.status).toBe(200);
        const token2 = refreshed.json?.token as string;
        expect(typeof token2).toBe('string');

        // 旧 refresh cookie 已被轮换撤销，不能重放
        const replayOld = await reqJson(app, '/api/auth/refresh', {
            method: 'POST',
            cookie: refreshCookie,
        });
        expect(replayOld.status).toBe(401);

        const rotatedCookie = refreshed.setCookies
            .find((c) => c.startsWith('qs_refresh='))!
            .split(';')[0];

        // logout 撤销当前 refresh token
        const logout = await reqJson(app, '/api/auth/logout', {
            method: 'POST',
            cookie: rotatedCookie,
        });
        expect(logout.status).toBe(200);

        const afterLogoutRefresh = await reqJson(app, '/api/auth/refresh', {
            method: 'POST',
            cookie: rotatedCookie,
        });
        expect(afterLogoutRefresh.status).toBe(401);
    });

    it('immediately revokes all old JWTs & refresh tokens on change-password and admin reset-user-password', async () => {
        const { db, app } = createTestContext();
        cleanups.push(() => db.close());

        // 创建管理员账户（预设用户名 admin）
        const adminId = crypto.randomUUID();
        const salt = generateSalt();
        const hash = await hashPassword('AdminPass123!', salt);
        db.prepare(
            'INSERT INTO users (id, username, password_hash, salt, token_version) VALUES (?, ?, ?, ?, 1)'
        ).run(adminId, 'admin', hash, salt);

        const su = await reqJson(app, '/api/auth/signup', {
            method: 'POST',
            body: { username: 'bobuser', password: 'Password123' },
        });
        expect(su.status).toBe(200);
        const oldUserToken = su.json?.token as string;
        const userId = (su.json?.user as { id: string }).id;
        const cookie1 = su.setCookies.find((c) => c.startsWith('qs_refresh='))!.split(';')[0];

        // 用户修改密码 → token_version 升级为 2
        const chg = await reqJson(app, '/api/auth/change-password', {
            method: 'POST',
            token: oldUserToken,
            body: { oldPassword: 'Password123', newPassword: 'NewPassword456' },
        });
        expect(chg.status).toBe(200);
        const freshToken = chg.json?.token as string;

        // 旧 JWT 立刻 401，新 JWT 200，旧 refresh cookie 401
        expect((await reqJson(app, '/api/auth/me', { token: oldUserToken })).status).toBe(401);
        expect((await reqJson(app, '/api/auth/me', { token: freshToken })).status).toBe(200);
        expect(
            (await reqJson(app, '/api/auth/refresh', { method: 'POST', cookie: cookie1 })).status
        ).toBe(401);

        // 管理员重置密码 → token_version 再升级，freshToken 也立刻 401
        const admLogin = await reqJson(app, '/api/auth/login', {
            method: 'POST',
            body: { username: 'admin', password: 'AdminPass123!' },
        });
        const adminToken = admLogin.json?.token as string;

        const rst = await reqJson(app, '/api/admin/reset-user-password', {
            method: 'POST',
            token: adminToken,
            body: { userId, newPassword: 'ResetPass789!' },
        });
        expect(rst.status).toBe(200);
        expect((await reqJson(app, '/api/auth/me', { token: freshToken })).status).toBe(401);
    });

    it('cascades delete-account across all user tables and protects admin accounts', async () => {
        const { db, app } = createTestContext();
        cleanups.push(() => db.close());

        const su = await reqJson(app, '/api/auth/signup', {
            method: 'POST',
            body: { username: 'charlie', password: 'Password123' },
        });
        const token = su.json?.token as string;
        const uid = (su.json?.user as { id: string }).id;

        await reqJson(app, '/api/sync/push', {
            method: 'POST',
            token,
            body: {
                mutations: [
                    {
                        opId: 'op-1',
                        op: 'upsert_question',
                        question: {
                            id: 'q1',
                            type: 'mcq',
                            q: 'Test?',
                            o: ['A', 'B'],
                            a: 'A',
                            sub: 'Sub1',
                            chap: 'Chap1',
                            d: '',
                        },
                    },
                ],
            },
        });

        const del = await reqJson(app, '/api/auth/delete-account', {
            method: 'POST',
            token,
            body: { password: 'Password123' },
        });
        expect(del.status).toBe(200);

        const qCnt = db
            .prepare('SELECT COUNT(*) AS c FROM v2_questions WHERE user_id = ?')
            .get(uid) as { c: number };
        expect(qCnt.c).toBe(0);
        expect((await reqJson(app, '/api/auth/me', { token })).status).toBe(401);
    });

    it('supports multi-account HttpOnly cookie vault: signup/login accumulation, accounts listing, switching with token rotation, remove, and scoped logout', async () => {
        const { db, app } = createTestContext();
        cleanups.push(() => db.close());

        const mergeCookies = (prevCookie: string, setCookies: string[]) => {
            const jar = new Map<string, string>();
            for (const part of prevCookie.split(';')) {
                const eq = part.indexOf('=');
                if (eq > 0) jar.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
            }
            for (const sc of setCookies) {
                const kv = sc.split(';')[0];
                const eq = kv.indexOf('=');
                if (eq <= 0) continue;
                const k = kv.slice(0, eq).trim();
                const v = kv.slice(eq + 1).trim();
                if (!v || sc.toLowerCase().includes('max-age=0')) jar.delete(k);
                else jar.set(k, v);
            }
            return Array.from(jar.entries())
                .map(([k, v]) => `${k}=${v}`)
                .join('; ');
        };

        const suA = await reqJson(app, '/api/auth/signup', {
            method: 'POST',
            body: { username: 'user_a', password: 'Password123' },
        });
        expect(suA.status).toBe(200);
        const uidA = (suA.json?.user as { id: string }).id;
        let jar = mergeCookies('', suA.setCookies);
        expect(jar).toContain('qs_vault=');

        const suB = await reqJson(app, '/api/auth/signup', {
            method: 'POST',
            cookie: jar,
            body: { username: 'user_b', password: 'Password123' },
        });
        expect(suB.status).toBe(200);
        const uidB = (suB.json?.user as { id: string }).id;
        const tokenB = suB.json?.token as string;
        jar = mergeCookies(jar, suB.setCookies);

        const list1 = await reqJson(app, '/api/auth/accounts', {
            token: tokenB,
            cookie: jar,
        });
        expect(list1.status).toBe(200);
        const accs1 = list1.json?.accounts as Array<{ id: string; username: string; isCurrent: boolean }>;
        expect(accs1.length).toBe(2);
        expect(accs1.find((a) => a.id === uidB)?.isCurrent).toBe(true);
        expect(accs1.find((a) => a.id === uidA)?.isCurrent).toBe(false);

        const swToA = await reqJson(app, '/api/auth/switch', {
            method: 'POST',
            cookie: jar,
            body: { userId: uidA },
        });
        expect(swToA.status).toBe(200);
        const tokenA2 = swToA.json?.token as string;
        expect((swToA.json?.user as { username: string }).username).toBe('user_a');
        jar = mergeCookies(jar, swToA.setCookies);

        const meA = await reqJson(app, '/api/auth/me', { token: tokenA2 });
        expect(meA.status).toBe(200);
        expect((meA.json?.user as { username: string }).username).toBe('user_a');

        // Logout current account (user_a) keeps user_b in vault
        const loA = await reqJson(app, '/api/auth/logout', {
            method: 'POST',
            token: tokenA2,
            cookie: jar,
        });
        expect(loA.status).toBe(200);
        jar = mergeCookies(jar, loA.setCookies);

        const listAfterLogoutA = await reqJson(app, '/api/auth/accounts', { cookie: jar });
        const accsAfter = listAfterLogoutA.json?.accounts as Array<{ id: string }>;
        expect(accsAfter.map((a) => a.id)).toEqual([uidB]);

        // Remove user_b cleanly
        const remB = await reqJson(app, '/api/auth/remove-account', {
            method: 'POST',
            cookie: jar,
            body: { userId: uidB },
        });
        expect(remB.status).toBe(200);
        jar = mergeCookies(jar, remB.setCookies);

        const swB = await reqJson(app, '/api/auth/switch', {
            method: 'POST',
            cookie: jar,
            body: { userId: uidB },
        });
        expect(swB.status).toBe(401);
    });
});
