import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { ensureV2Schema, migrateLegacyToV2 } from '../src/db/migrate-v2.js';
import { generateSalt, hashPassword } from '../src/lib/crypto.js';
import { reqJson } from './test-helper.js';

describe('Lossless idempotent legacy -> v2 migration', () => {
    const cleanups: Array<() => void> = [];
    afterEach(() => {
        while (cleanups.length) cleanups.pop()?.();
    });

    it('supports dryRun rollback and losslessly migrates bank, trash, media, fill case, history, and flags', async () => {
        const db = new Database(':memory:');
        cleanups.push(() => db.close());

        // 模拟真实旧库表结构（不含 token_version 与 v2_* 表）
        db.exec(`
            CREATE TABLE users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE question_sets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                version INTEGER NOT NULL DEFAULT 0,
                state TEXT
            );
            CREATE TABLE questions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                question_set_id INTEGER NOT NULL,
                content TEXT NOT NULL,
                FOREIGN KEY(question_set_id) REFERENCES question_sets(id) ON DELETE CASCADE
            );
            CREATE TABLE sync_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                delta TEXT,
                status TEXT NOT NULL,
                error TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE bank_snapshots (
                user_id TEXT PRIMARY KEY,
                set_id INTEGER,
                version INTEGER,
                state TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE user_backups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                type TEXT NOT NULL,
                payload TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);

        const uid = crypto.randomUUID();
        const salt = generateSalt();
        const pwHash = await hashPassword('LegacyPass123!', salt);
        db.prepare('INSERT INTO users (id, username, password_hash, salt) VALUES (?, ?, ?, ?)').run(
            uid,
            'legacyuser',
            pwHash,
            salt
        );

        const qActive1 = {
            id: 'qa-1',
            type: 'mcq',
            q: '观察 [图1]',
            o: ['选项1', '选项2'],
            a: 'A',
            sub: '电路',
            chap: '第一章',
            d: '解析',
            media: [{ type: 'img', key: '图1', src: 'https://example.com/a.png' }],
            psg: '附带阅读材料',
            _editedAt: 1700000001000,
        };
        const qActive2 = {
            id: 'qa-2',
            type: 'fill',
            q: '写出化学式',
            o: [],
            a: 'NaCl',
            sub: '化学',
            chap: '第二章',
            d: '',
        };
        const qTrash = {
            id: 'qt-1',
            type: 'tf',
            q: '旧判断题',
            o: ['对', '错'],
            a: 'T',
            sub: '电路',
            chap: '第一章',
            d: '',
            deletedAt: 1700000005000,
            deletedBy: 'user',
            reason: 'manual-delete',
            wasStarred: true,
        };

        const legacyState = {
            bankName: '我的旧题库',
            bank: {
                电路: { 第一章: [qActive1] },
                化学: { 第二章: [qActive2] },
            },
            trash: {
                电路: { 第一章: [qTrash] },
            },
            history: [
                { rid: 'r1', id: 'qa-1', r: true, t: 1700000002000, d: 3500 },
                { id: 'qa-2', r: false, t: 1700000003000 }, // 缺 rid 的历史旧格式
            ],
            starred: ['qa-1'],
            hiddenMistakeIds: ['qa-2'],
            lastPracticeTime: 1700000003000,
        };

        const setRes = db
            .prepare('INSERT INTO question_sets (user_id, name, version, state) VALUES (?, ?, ?, ?)')
            .run(uid, '我的旧题库', 17, JSON.stringify(legacyState));
        const setId = Number(setRes.lastInsertRowid);

        db.prepare('INSERT INTO questions (question_set_id, content) VALUES (?, ?)').run(
            setId,
            JSON.stringify(qActive1)
        );
        db.prepare('INSERT INTO questions (question_set_id, content) VALUES (?, ?)').run(
            setId,
            JSON.stringify(qActive2)
        );

        // 1. Dry-run 不得持久化 v2 表
        const dryReport = migrateLegacyToV2(db, { dryRun: true });
        expect(dryReport.migratedUsers).toBe(1);
        expect(dryReport.activeQuestions).toBe(2);
        expect(dryReport.trashQuestions).toBe(1);
        expect(dryReport.historyEntries).toBe(2);
        expect(dryReport.starredFlags).toBe(1);
        expect(dryReport.hiddenMistakeFlags).toBe(1);

        const tablesAfterDry = db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='v2_questions'")
            .all();
        expect(tablesAfterDry.length).toBe(0);

        // 2. 真实迁移并二次重跑验证幂等
        ensureV2Schema(db);
        const real1 = migrateLegacyToV2(db);
        expect(real1.migratedUsers).toBe(1);
        const real2 = migrateLegacyToV2(db);
        expect(real2.migratedUsers).toBe(0);
        expect(real2.skippedAlreadyMigrated).toBe(1);

        // 3. 用原账号密码登录并通过旧接口拉取，确认无损还原
        const config = loadConfig({
            JWT_SECRET: 'vitest-super-secret-at-least-32-chars-0001',
            DB_PATH: ':memory:',
            ADMIN_USERNAMES: 'admin',
            NODE_ENV: 'test',
        });
        const app = createApp({ db, config });

        const login = await reqJson(app, '/api/auth/login', {
            method: 'POST',
            body: { username: 'legacyuser', password: 'LegacyPass123!' },
        });
        expect(login.status).toBe(200);
        const token = login.json?.token as string;

        const loaded = await reqJson(app, '/api/load-question-set', { token });
        expect(loaded.status).toBe(200);
        expect(loaded.json?.setId).toBe(setId);
        expect(loaded.json?.version).toBe(17);

        const st = loaded.json?.state as Record<string, unknown>;
        const bank = st.bank as Record<string, Record<string, Array<Record<string, unknown>>>>;
        expect(bank['电路']['第一章'][0].media).toEqual(qActive1.media);
        expect(bank['电路']['第一章'][0].psg).toBe('附带阅读材料');
        expect(bank['化学']['第二章'][0].a).toBe('NaCl');

        const trash = st.trash as Record<string, Record<string, Array<Record<string, unknown>>>>;
        expect(trash['电路']['第一章'].length).toBe(1);
        expect(trash['电路']['第一章'][0].wasStarred).toBe(true);

        expect((st.history as unknown[]).length).toBe(2);
        expect(st.starred).toEqual(['qa-1']);
        expect(st.hiddenMistakeIds).toEqual(['qa-2']);
        expect(st.lastPracticeTime).toBe(1700000003000);
    });
});
