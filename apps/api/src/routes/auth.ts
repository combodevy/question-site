import crypto from 'node:crypto';
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import {
    ChangePasswordSchema,
    DeleteAccountSchema,
    LoginSchema,
    PasswordSchema,
    SignupSchema,
    UsernameSchema,
} from '@qs/shared';
import {
    MAX_AUTH_BYTES,
    generateSalt,
    hashPassword,
    randomTokenHex,
    readJsonBody,
    sha256Hex,
    signJwt,
    timingSafeEqualStr,
} from '../lib/crypto.js';
import {
    checkRateLimit,
    clientIp,
    deleteRateBucket,
    isRateBucketLocked,
} from '../middleware/rate-limit.js';
import { requireAuth } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

const REFRESH_COOKIE_NAME = 'qs_refresh';
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const JWT_TTL_SECONDS = 604800; // 7 days

function isHttpsRequest(req: Request): boolean {
    const proto = req.headers.get('x-forwarded-proto');
    if (proto) return proto.split(',')[0].trim().toLowerCase() === 'https';
    return req.url.startsWith('https://');
}

function issueRefreshToken(
    rawDb: AppEnv['Variables']['rawDb'],
    userId: string,
    request: Request
): string {
    const rawToken = randomTokenHex(32);
    const tokenHash = sha256Hex(rawToken);
    const now = Date.now();
    const expiresAt = now + REFRESH_TTL_MS;
    const ua = (request.headers.get('user-agent') || 'unknown').slice(0, 200);
    const ip = clientIp(request);

    rawDb
        .prepare(
            `INSERT INTO v2_refresh_tokens (id, user_id, token_hash, user_agent, ip, expires_at, revoked_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`
        )
        .run(crypto.randomUUID(), userId, tokenHash, ua, ip, expiresAt, now);

    // 清理该用户已过期或超过 15 个的旧 refresh token
    rawDb
        .prepare(
            `DELETE FROM v2_refresh_tokens
             WHERE user_id = ? AND (expires_at < ? OR id NOT IN (
                 SELECT id FROM v2_refresh_tokens WHERE user_id = ? ORDER BY created_at DESC LIMIT 15
             ))`
        )
        .run(userId, now, userId);

    return rawToken;
}

export function createAuthRouter(): Hono<AppEnv> {
    const router = new Hono<AppEnv>();

    // 1. SIGNUP
    router.post('/signup', async (c) => {
        const config = c.get('config');
        const rawDb = c.get('rawDb');
        const body = await readJsonBody<Record<string, unknown>>(c.req.raw, MAX_AUTH_BYTES);
        if (!body) return c.json({ error: '无效的 JSON 请求体或体积超限' }, 400);

        const parsedBody = SignupSchema.safeParse(body);
        if (!parsedBody.success) {
            return c.json({ error: '请输入用户名和密码' }, 400);
        }

        const rawUsername = String(parsedBody.data.username || parsedBody.data.email || '').trim();
        const password = parsedBody.data.password;
        if (!rawUsername || !password) {
            return c.json({ error: '请输入用户名和密码' }, 400);
        }

        const uCheck = UsernameSchema.safeParse(rawUsername);
        if (!uCheck.success) {
            return c.json({ error: uCheck.error.issues[0]?.message || '用户名格式不合法' }, 400);
        }

        const pCheck = PasswordSchema.safeParse(password);
        if (!pCheck.success) {
            return c.json({ error: pCheck.error.issues[0]?.message || '密码长度不合法' }, 400);
        }

        const normalizedName = rawUsername.toLowerCase();
        if (config.adminUsernames.includes(normalizedName)) {
            return c.json({ error: '该用户名被保留，请换一个' }, 400);
        }

        if (!checkRateLimit('signup:' + clientIp(c.req.raw), 5, 60 * 60 * 1000).ok) {
            return c.json({ error: '注册过于频繁，请稍后再试' }, 429);
        }

        const existing = rawDb
            .prepare('SELECT id FROM users WHERE username = ?')
            .get(normalizedName);
        if (existing) {
            return c.json({ error: '该用户名已被注册' }, 400);
        }

        const userId = crypto.randomUUID();
        const salt = generateSalt();
        const passwordHash = await hashPassword(password, salt);

        try {
            rawDb
                .prepare(
                    'INSERT INTO users (id, username, password_hash, salt, token_version) VALUES (?, ?, ?, ?, 1)'
                )
                .run(userId, normalizedName, passwordHash, salt);
        } catch (err) {
            if (String((err as Error)?.message || '').includes('UNIQUE')) {
                return c.json({ error: '该用户名已被注册' }, 400);
            }
            return c.json({ error: '注册失败，请稍后重试' }, 500);
        }

        const refreshRaw = issueRefreshToken(rawDb, userId, c.req.raw);
        setCookie(c, REFRESH_COOKIE_NAME, refreshRaw, {
            httpOnly: true,
            sameSite: 'Lax',
            path: '/api/auth',
            secure: isHttpsRequest(c.req.raw),
            maxAge: Math.floor(REFRESH_TTL_MS / 1000),
        });

        const token = signJwt(
            {
                sub: userId,
                username: normalizedName,
                role: normalizedName === 'admin' ? 'admin' : 'user',
                tv: 1,
                exp: Math.floor(Date.now() / 1000) + JWT_TTL_SECONDS,
            },
            config.jwtSecret
        );

        return c.json({ ok: true, token, user: { id: userId, username: normalizedName } }, 200);
    });

    // 2. LOGIN
    router.post('/login', async (c) => {
        const config = c.get('config');
        const rawDb = c.get('rawDb');
        const ip = clientIp(c.req.raw);

        if (!checkRateLimit('login:' + ip, 30, 15 * 60 * 1000).ok) {
            return c.json({ error: '尝试过于频繁，请 15 分钟后再试' }, 429);
        }

        const body = await readJsonBody<Record<string, unknown>>(c.req.raw, MAX_AUTH_BYTES);
        if (!body) return c.json({ error: '无效的 JSON 请求体或体积超限' }, 400);

        const parsedBody = LoginSchema.safeParse(body);
        if (!parsedBody.success) {
            return c.json({ error: '请输入用户名和密码' }, 400);
        }

        const rawUsername = String(parsedBody.data.username || parsedBody.data.email || '').trim();
        const password = parsedBody.data.password;
        if (!rawUsername || typeof password !== 'string' || !password) {
            return c.json({ error: '请输入用户名和密码' }, 400);
        }
        if (password.length > 128 || rawUsername.length > 64) {
            return c.json({ error: '用户不存在或密码错误' }, 400);
        }

        let queryName = rawUsername.toLowerCase();
        if (queryName.includes('@user.local')) {
            queryName = queryName.split('@')[0];
        }

        const failKey = 'fail:' + ip + ':' + queryName;
        if (isRateBucketLocked(failKey, 10)) {
            return c.json({ error: '失败次数过多，该账号已临时锁定，请 15 分钟后再试' }, 429);
        }

        const user = rawDb
            .prepare(
                'SELECT id, username, password_hash, salt, token_version FROM users WHERE username = ?'
            )
            .get(queryName) as
            | {
                  id: string;
                  username: string;
                  password_hash: string;
                  salt: string;
                  token_version: number;
              }
            | undefined;

        if (!user) {
            await hashPassword(password, '00000000000000000000000000000000');
            checkRateLimit(failKey, 10, 15 * 60 * 1000);
            return c.json({ error: '用户不存在或密码错误' }, 400);
        }

        const currentHash = await hashPassword(password, user.salt);
        if (!timingSafeEqualStr(currentHash, user.password_hash)) {
            checkRateLimit(failKey, 10, 15 * 60 * 1000);
            return c.json({ error: '用户不存在或密码错误' }, 400);
        }

        deleteRateBucket(failKey);

        const tv = typeof user.token_version === 'number' ? user.token_version : 1;
        const refreshRaw = issueRefreshToken(rawDb, user.id, c.req.raw);
        setCookie(c, REFRESH_COOKIE_NAME, refreshRaw, {
            httpOnly: true,
            sameSite: 'Lax',
            path: '/api/auth',
            secure: isHttpsRequest(c.req.raw),
            maxAge: Math.floor(REFRESH_TTL_MS / 1000),
        });

        const token = signJwt(
            {
                sub: user.id,
                username: user.username,
                role: config.adminUsernames.includes(user.username.toLowerCase()) ? 'admin' : 'user',
                tv,
                exp: Math.floor(Date.now() / 1000) + JWT_TTL_SECONDS,
            },
            config.jwtSecret
        );

        return c.json({ ok: true, token, user: { id: user.id, username: user.username } }, 200);
    });

    // 2.1 REFRESH SESSION (via HttpOnly Refresh Cookie with DB rotation)
    router.post('/refresh', async (c) => {
        const config = c.get('config');
        const rawDb = c.get('rawDb');
        const refreshRaw = getCookie(c, REFRESH_COOKIE_NAME);
        if (!refreshRaw) {
            return c.json({ error: 'Unauthorized' }, 401);
        }

        const tokenHash = sha256Hex(refreshRaw);
        const now = Date.now();
        const row = rawDb
            .prepare(
                `SELECT rt.id AS rt_id, rt.user_id, rt.expires_at, rt.revoked_at, u.username, u.token_version
                 FROM v2_refresh_tokens rt
                 JOIN users u ON u.id = rt.user_id
                 WHERE rt.token_hash = ?`
            )
            .get(tokenHash) as
            | {
                  rt_id: string;
                  user_id: string;
                  expires_at: number;
                  revoked_at: number | null;
                  username: string;
                  token_version: number;
              }
            | undefined;

        if (!row || row.revoked_at !== null || row.expires_at <= now) {
            deleteCookie(c, REFRESH_COOKIE_NAME, { path: '/api/auth' });
            return c.json({ error: 'Unauthorized' }, 401);
        }

        const rotateTx = rawDb.transaction(() => {
            rawDb
                .prepare('UPDATE v2_refresh_tokens SET revoked_at = ? WHERE id = ?')
                .run(now, row.rt_id);
            return issueRefreshToken(rawDb, row.user_id, c.req.raw);
        });
        const nextRefreshRaw = rotateTx();

        setCookie(c, REFRESH_COOKIE_NAME, nextRefreshRaw, {
            httpOnly: true,
            sameSite: 'Lax',
            path: '/api/auth',
            secure: isHttpsRequest(c.req.raw),
            maxAge: Math.floor(REFRESH_TTL_MS / 1000),
        });

        const tv = typeof row.token_version === 'number' ? row.token_version : 1;
        const token = signJwt(
            {
                sub: row.user_id,
                username: row.username,
                role: config.adminUsernames.includes(row.username.toLowerCase()) ? 'admin' : 'user',
                tv,
                exp: Math.floor(Date.now() / 1000) + JWT_TTL_SECONDS,
            },
            config.jwtSecret
        );

        return c.json({ ok: true, token, user: { id: row.user_id, username: row.username } }, 200);
    });

    // 2.2 LOGOUT (revokes current refresh cookie)
    router.post('/logout', async (c) => {
        const rawDb = c.get('rawDb');
        const refreshRaw = getCookie(c, REFRESH_COOKIE_NAME);
        if (refreshRaw) {
            const tokenHash = sha256Hex(refreshRaw);
            rawDb
                .prepare(
                    'UPDATE v2_refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL'
                )
                .run(Date.now(), tokenHash);
        }
        deleteCookie(c, REFRESH_COOKIE_NAME, { path: '/api/auth' });
        return c.json({ ok: true }, 200);
    });

    // 3. ME
    router.get('/me', requireAuth, async (c) => {
        const rawDb = c.get('rawDb');
        const authUser = c.get('authUser');

        const user = rawDb
            .prepare('SELECT id, username, created_at FROM users WHERE id = ?')
            .get(authUser.id) as { id: string; username: string; created_at: string } | undefined;
        if (!user) return c.json({ error: '账户不存在' }, 404);

        const meta = rawDb
            .prepare('SELECT version FROM v2_user_sync_meta WHERE user_id = ?')
            .get(authUser.id) as { version: number } | undefined;

        const qCountRow = rawDb
            .prepare(
                'SELECT COUNT(*) AS c FROM v2_questions WHERE user_id = ? AND deleted_at IS NULL AND purged = 0'
            )
            .get(authUser.id) as { c: number } | undefined;

        return c.json(
            {
                ok: true,
                user: {
                    id: user.id,
                    username: user.username,
                    createdAt: user.created_at,
                    isAdmin: authUser.isAdmin,
                    questionSets: meta ? 1 : 0,
                    questionCount: qCountRow?.c || 0,
                    lastVersion: meta ? meta.version : 0,
                },
            },
            200
        );
    });

    // 4. CHANGE PASSWORD (increments token_version + revokes all refresh tokens)
    router.post('/change-password', requireAuth, async (c) => {
        const config = c.get('config');
        const rawDb = c.get('rawDb');
        const authUser = c.get('authUser');

        const body = await readJsonBody<Record<string, unknown>>(c.req.raw, MAX_AUTH_BYTES);
        if (!body) return c.json({ error: '无效的 JSON 请求体或体积超限' }, 400);

        const parsed = ChangePasswordSchema.safeParse(body);
        if (!parsed.success) {
            return c.json(
                { error: parsed.error.issues[0]?.message || '请填写原密码和新密码' },
                400
            );
        }

        const { oldPassword, newPassword } = parsed.data;
        if (newPassword === oldPassword) {
            return c.json({ error: '新密码不能与原密码相同' }, 400);
        }

        const row = rawDb
            .prepare('SELECT password_hash, salt FROM users WHERE id = ?')
            .get(authUser.id) as { password_hash: string; salt: string } | undefined;
        if (!row) {
            return c.json({ error: '账户不存在或已被删除' }, 401);
        }

        const oldHash = await hashPassword(oldPassword, row.salt);
        if (!timingSafeEqualStr(oldHash, row.password_hash)) {
            return c.json({ error: '原密码不正确' }, 400);
        }

        const newSalt = generateSalt();
        const newHash = await hashPassword(newPassword, newSalt);
        const now = Date.now();

        const nextTv = rawDb.transaction(() => {
            const upd = rawDb
                .prepare(
                    'UPDATE users SET password_hash = ?, salt = ?, token_version = token_version + 1 WHERE id = ? RETURNING token_version'
                )
                .get(newHash, newSalt, authUser.id) as { token_version: number } | undefined;
            rawDb
                .prepare(
                    'UPDATE v2_refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL'
                )
                .run(now, authUser.id);
            return upd?.token_version ?? authUser.tokenVersion + 1;
        })();

        const freshRefresh = issueRefreshToken(rawDb, authUser.id, c.req.raw);
        setCookie(c, REFRESH_COOKIE_NAME, freshRefresh, {
            httpOnly: true,
            sameSite: 'Lax',
            path: '/api/auth',
            secure: isHttpsRequest(c.req.raw),
            maxAge: Math.floor(REFRESH_TTL_MS / 1000),
        });

        const freshToken = signJwt(
            {
                sub: authUser.id,
                username: authUser.username,
                role: authUser.isAdmin ? 'admin' : 'user',
                tv: nextTv,
                exp: Math.floor(Date.now() / 1000) + JWT_TTL_SECONDS,
            },
            config.jwtSecret
        );

        return c.json({ ok: true, token: freshToken }, 200);
    });

    // 5. DELETE ACCOUNT
    router.post('/delete-account', requireAuth, async (c) => {
        const rawDb = c.get('rawDb');
        const authUser = c.get('authUser');

        if (authUser.isAdmin) {
            return c.json({ error: '管理员账号不能自助注销，请联系其他管理员处理' }, 403);
        }

        const body = await readJsonBody<Record<string, unknown>>(c.req.raw, MAX_AUTH_BYTES);
        if (!body) return c.json({ error: '无效的 JSON 请求体或体积超限' }, 400);

        const parsed = DeleteAccountSchema.safeParse(body);
        if (!parsed.success) {
            return c.json({ error: '请输入密码确认注销' }, 400);
        }

        const delUser = rawDb
            .prepare('SELECT id, password_hash, salt FROM users WHERE id = ?')
            .get(authUser.id) as { id: string; password_hash: string; salt: string } | undefined;
        if (!delUser) {
            return c.json({ error: '账户不存在或已被删除' }, 404);
        }

        const delHash = await hashPassword(parsed.data.password, delUser.salt);
        if (!timingSafeEqualStr(delHash, delUser.password_hash)) {
            return c.json({ error: '密码不正确，注销已取消' }, 400);
        }

        rawDb.transaction(() => {
            const setRows = rawDb
                .prepare('SELECT id FROM question_sets WHERE user_id = ?')
                .all(delUser.id) as Array<{ id: number }>;
            for (const s of setRows) {
                rawDb.prepare('DELETE FROM questions WHERE question_set_id = ?').run(s.id);
            }
            rawDb.prepare('DELETE FROM question_sets WHERE user_id = ?').run(delUser.id);
            rawDb.prepare('DELETE FROM sync_logs WHERE user_id = ?').run(delUser.id);
            rawDb.prepare('DELETE FROM bank_snapshots WHERE user_id = ?').run(delUser.id);
            rawDb.prepare('DELETE FROM user_backups WHERE user_id = ?').run(delUser.id);
            rawDb.prepare('DELETE FROM users WHERE id = ?').run(delUser.id);
        })();

        deleteCookie(c, REFRESH_COOKIE_NAME, { path: '/api/auth' });
        return c.json({ ok: true }, 200);
    });

    return router;
}
