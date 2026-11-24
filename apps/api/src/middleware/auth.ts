import type { MiddlewareHandler } from 'hono';
import { eq } from 'drizzle-orm';
import { users } from '../db/schema.js';
import { verifyJwt } from '../lib/crypto.js';
import type { AppEnv, AuthUser } from '../types.js';

export async function authenticateRequest(
    request: Request,
    c: Parameters<MiddlewareHandler<AppEnv>>[0]
): Promise<AuthUser | null> {
    const authHeader =
        request.headers.get('authorization') || request.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.slice(7).trim();
    if (!token) return null;

    const config = c.get('config');
    const payload = verifyJwt(token, config.jwtSecret);
    if (!payload) return null;

    const db = c.get('db');
    const userRow = db
        .select({
            id: users.id,
            username: users.username,
            tokenVersion: users.tokenVersion,
        })
        .from(users)
        .where(eq(users.id, payload.sub))
        .get();

    if (!userRow) return null;

    // 令牌撤销校验：用户改密或被管理员重置密码后，tokenVersion 递增，所有旧令牌立即失效。
    // 兼容历史无 tv 字段的旧版 JWT（仅在 tokenVersion === 1 时有效）。
    const tokenTv = typeof payload.tv === 'number' ? payload.tv : undefined;
    if (tokenTv !== undefined) {
        if (tokenTv !== userRow.tokenVersion) return null;
    } else if (userRow.tokenVersion > 1) {
        return null;
    }

    return {
        id: userRow.id,
        username: userRow.username,
        tokenVersion: userRow.tokenVersion,
        isAdmin: config.adminUsernames.includes(userRow.username.toLowerCase()),
    };
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
    const user = await authenticateRequest(c.req.raw, c);
    if (!user) {
        return c.json({ error: 'Unauthorized' }, 401);
    }
    c.set('authUser', user);
    await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
    const user = c.get('authUser');
    if (!user || !user.isAdmin) {
        return c.json({ error: 'Forbidden: Admin access required' }, 403);
    }
    await next();
};
