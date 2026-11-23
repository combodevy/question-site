/**
 * @file worker/server.mjs
 * @description Standalone production Hono server for question-site API
 * Eliminates wrangler dev/miniflare overhead, running directly on Node.js + better-sqlite3 (WAL mode)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { createD1Database } from './d1-adapter.mjs';
import worker from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Resolve configuration
function loadEnv() {
    let vars = {
        ADMIN_USERNAMES: 'devy-admin,admin',
        JWT_SECRET: 'tfWnFgVlr5GUpKkiQqgg5UoXyBml3afxNhJBDOPvVa6Elt9A',
        CORS_ORIGINS: 'https://quiz.devy.cc.cd,https://question-site-front.pages.dev,http://localhost:8788,http://127.0.0.1:8788'
    };

    // Load from wrangler.json if present
    const wranglerPath = path.resolve(__dirname, 'wrangler.json');
    if (fs.existsSync(wranglerPath)) {
        try {
            const wranglerJson = JSON.parse(fs.readFileSync(wranglerPath, 'utf8'));
            if (wranglerJson.vars) {
                vars = { ...vars, ...wranglerJson.vars };
            }
        } catch (err) {
            console.warn('[Server] Could not parse wrangler.json:', err.message);
        }
    }

    // Process environment variables take highest priority
    if (process.env.ADMIN_USERNAMES) vars.ADMIN_USERNAMES = process.env.ADMIN_USERNAMES;
    if (process.env.JWT_SECRET) vars.JWT_SECRET = process.env.JWT_SECRET;
    if (process.env.CORS_ORIGINS) vars.CORS_ORIGINS = process.env.CORS_ORIGINS;
    if (process.env.CORS_ORIGIN) vars.CORS_ORIGIN = process.env.CORS_ORIGIN;

    return vars;
}

// 2. Resolve database path
function resolveDbPath() {
    if (process.env.DB_PATH && fs.existsSync(process.env.DB_PATH)) {
        return process.env.DB_PATH;
    }
    const standardProdPath = '/opt/question-site/data/app.db';
    if (fs.existsSync(standardProdPath)) {
        return standardProdPath;
    }
    const legacyMiniflarePath = '/opt/question-site/data/v3/d1/miniflare-D1DatabaseObject/93d7fc60452c6d106c5f56c0087ad2c71a3b2b22dd60c438593ff9a643a39250.sqlite';
    if (fs.existsSync(legacyMiniflarePath)) {
        return legacyMiniflarePath;
    }
    // Local development fallback
    const localWranglerDbDir = path.resolve(__dirname, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
    if (fs.existsSync(localWranglerDbDir)) {
        const files = fs.readdirSync(localWranglerDbDir).filter(f => f.endsWith('.sqlite'));
        if (files.length > 0) {
            return path.join(localWranglerDbDir, files[0]);
        }
    }
    return process.env.DB_PATH || standardProdPath;
}

const dbPath = resolveDbPath();
console.log(`[Server] Connecting SQLite database: ${dbPath}`);

// Ensure database directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

// 3. Initialize SQLite with WAL mode & optimizations
const db = new Database(dbPath, { timeout: 10000 });
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');
db.pragma('cache_size = -16000'); // 16MB cache
db.pragma('foreign_keys = ON');

console.log('[Server] SQLite PRAGMA journal_mode set to WAL, synchronous set to NORMAL');

const d1 = createD1Database(db);
const envVars = loadEnv();
const env = {
    ...envVars,
    DB: d1
};

// 4. Create Hono application
const app = new Hono();

// Response time & logging middleware
app.use('*', async (c, next) => {
    const start = performance.now();
    await next();
    const duration = (performance.now() - start).toFixed(1);
    c.header('X-Response-Time', `${duration}ms`);
});

// Delegate all requests to standard Worker fetch handler
app.all('*', async (c) => {
    const ctx = {
        waitUntil(promise) {
            Promise.resolve(promise).catch(err => {
                console.error('[Server Async Task Error]', err);
            });
        },
        passThroughOnException() {}
    };

    try {
        return await worker.fetch(c.req.raw, env, ctx);
    } catch (err) {
        console.error('[Server Worker Execution Error]', err);
        return c.json({ error: 'Internal Server Error' }, 500);
    }
});

// 5. Start HTTP server
const PORT = parseInt(process.env.PORT || '8787', 10);
const HOST = process.env.HOST || '127.0.0.1';

const serverInstance = serve({
    fetch: app.fetch,
    port: PORT,
    hostname: HOST
}, (info) => {
    console.log(`[Server] Question Site Hono API running at http://${info.address}:${info.port}`);
});

// Graceful shutdown
function shutdown(signal) {
    console.log(`[Server] Received ${signal}, closing server and database...`);
    try {
        db.close();
        console.log('[Server] Database closed cleanly.');
    } catch (e) {
        console.error('[Server] Error closing database:', e.message);
    }
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
