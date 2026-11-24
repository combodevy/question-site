import Database from 'better-sqlite3';
import type { Hono } from 'hono';
import type { AppConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { ensureV2Schema } from '../src/db/migrate-v2.js';
import { clearAllRateBuckets } from '../src/middleware/rate-limit.js';
import type { AppEnv } from '../src/types.js';

export function createTestContext(overrides?: Partial<AppConfig>): {
    db: Database.Database;
    app: Hono<AppEnv>;
    config: AppConfig;
} {
    clearAllRateBuckets();
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    ensureV2Schema(db);

    const config: AppConfig = {
        jwtSecret: 'vitest-super-secret-at-least-32-chars-0001',
        dbPath: ':memory:',
        port: 8787,
        host: '127.0.0.1',
        adminUsernames: ['devy-admin', 'admin'],
        allowedOrigins: ['https://quiz.devy.cc.cd', 'http://localhost:8788'],
        isProduction: false,
        ...overrides,
    };

    const app = createApp({ db, config });
    return { db, app, config };
}

export async function reqJson(
    app: Hono<AppEnv>,
    path: string,
    options?: {
        method?: string;
        body?: unknown;
        token?: string;
        cookie?: string;
        headers?: Record<string, string>;
    }
): Promise<{
    status: number;
    json: Record<string, unknown> | null;
    headers: Headers;
    setCookies: string[];
}> {
    const headers: Record<string, string> = { ...(options?.headers || {}) };
    if (options?.token) headers['Authorization'] = `Bearer ${options.token}`;
    if (options?.cookie) headers['Cookie'] = options.cookie;
    if (options?.body !== undefined && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }

    const req = new Request(`https://quiz.devy.cc.cd${path}`, {
        method: options?.method || 'GET',
        headers,
        body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const res = await app.fetch(req);
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
        json = JSON.parse(text) as Record<string, unknown>;
    } catch {
        json = null;
    }

    const setCookies: string[] =
        typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie ===
        'function'
            ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
            : [];

    return { status: res.status, json, headers: res.headers, setCookies };
}
