import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import type { AppConfig } from './config.js';
import { createDrizzleDb } from './db/index.js';
import { securityAndCorsMiddleware } from './middleware/cors.js';
import { createAuthRouter } from './routes/auth.js';
import { createSyncV2Router } from './routes/sync-v2.js';
import { createLegacyCompatRouter } from './routes/legacy-compat.js';
import { createAdminRouter } from './routes/admin.js';
import { createOpsRouter } from './routes/ops.js';
import type { AppEnv } from './types.js';

export function createApp({ db, config }: { db: Database.Database; config: AppConfig }): Hono<AppEnv> {
    const app = new Hono<AppEnv>();
    const drizzleDb = createDrizzleDb(db);

    app.use('*', async (c, next) => {
        const start = performance.now();
        c.set('config', config);
        c.set('rawDb', db);
        c.set('db', drizzleDb);
        await next();
        const duration = (performance.now() - start).toFixed(1);
        c.header('X-Response-Time', `${duration}ms`);
    });

    app.use('*', securityAndCorsMiddleware());

    app.onError((err, c) => {
        console.error('[API Error]', err);
        return c.json({ error: 'Internal Server Error' }, 500);
    });

    app.route('/api/auth', createAuthRouter());
    app.route('/api/sync', createSyncV2Router());
    app.route('/api/admin/server-ops', createOpsRouter());
    app.route('/api/admin', createAdminRouter());
    app.route('/api', createLegacyCompatRouter());

    app.notFound((c) => c.json({ error: 'Not Found' }, 404));

    return app;
}
