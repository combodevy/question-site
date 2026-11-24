import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { ensureV2Schema, migrateLegacyToV2 } from './db/migrate-v2.js';
import { createApp } from './app.js';

let config;
try {
    config = loadConfig(process.env);
} catch (err) {
    console.error('[Server] FATAL:', (err as Error).message);
    process.exit(1);
}

const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

console.log(`[Server] Connecting SQLite database: ${config.dbPath}`);
const db = new Database(config.dbPath, { timeout: 10000 });
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');
db.pragma('cache_size = -16000');
db.pragma('foreign_keys = ON');

ensureV2Schema(db);
const migrationReport = migrateLegacyToV2(db);
if (migrationReport.migratedUsers > 0) {
    console.log(
        `[Migration v2] Migrated ${migrationReport.migratedUsers} user(s): ` +
            `${migrationReport.activeQuestions} active, ${migrationReport.trashQuestions} trash, ` +
            `${migrationReport.historyEntries} history, ${migrationReport.starredFlags} starred.`
    );
} else {
    console.log(
        `[Migration v2] Schema ready (${migrationReport.skippedAlreadyMigrated} migrated user(s)).`
    );
}

const app = createApp({ db, config });

serve(
    {
        fetch: app.fetch,
        port: config.port,
        hostname: config.host,
    },
    (info) => {
        console.log(
            `[Server] Question Site TypeScript Hono API running at http://${info.address}:${info.port}`
        );
    }
);

function shutdown(signal: string) {
    console.log(`[Server] Received ${signal}, closing server and database...`);
    try {
        db.close();
        console.log('[Server] Database closed cleanly.');
    } catch (err) {
        console.error('[Server] Error closing database:', (err as Error).message);
    }
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
