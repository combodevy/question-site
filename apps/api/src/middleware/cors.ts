import type { MiddlewareHandler } from 'hono';
import type { AppConfig } from '../config.js';
import type { AppEnv } from '../types.js';

const ALLOWED_ORIGIN_SUFFIXES = [
    '.question-site-front.pages.dev',
    '.question-site-mirror.pages.dev',
    '.question-site-mirror2.pages.dev',
];

export function isOriginAllowed(origin: string, config: AppConfig): boolean {
    if (!origin) return false;
    if (config.allowedOrigins.includes(origin)) return true;
    try {
        const u = new URL(origin);
        if (u.protocol !== 'https:') return false;
        const host = u.hostname.toLowerCase();
        for (const suffix of ALLOWED_ORIGIN_SUFFIXES) {
            if (host.endsWith(suffix)) {
                const sub = host.slice(0, host.length - suffix.length);
                if (sub && /^[a-z0-9-]+$/i.test(sub)) return true;
            }
        }
    } catch {
        return false;
    }
    return false;
}

export function securityAndCorsMiddleware(): MiddlewareHandler<AppEnv> {
    return async (c, next) => {
        const config = c.get('config');
        const requestOrigin = c.req.header('origin') || '';

        c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        c.header(
            'Access-Control-Allow-Headers',
            'Content-Type, Content-Encoding, Authorization, If-None-Match'
        );
        c.header('Access-Control-Expose-Headers', 'ETag');
        c.header('Access-Control-Allow-Credentials', 'true');
        c.header('Access-Control-Max-Age', '86400');
        c.header('Vary', 'Origin');
        c.header('X-Content-Type-Options', 'nosniff');
        c.header('Referrer-Policy', 'no-referrer');
        c.header('X-Frame-Options', 'DENY');

        if (isOriginAllowed(requestOrigin, config)) {
            c.header('Access-Control-Allow-Origin', requestOrigin);
        } else if (!requestOrigin) {
            c.header('Access-Control-Allow-Origin', '*');
        }

        if (c.req.method === 'OPTIONS') {
            return c.body(null, 204);
        }

        await next();
    };
}
