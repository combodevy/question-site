import crypto from 'node:crypto';
import { Hono } from 'hono';
import {
    AdminCreateUserSchema,
    AdminResetPasswordSchema,
    UsernameSchema,
    countDueQuestions,
    normalizeQuestion,
    questionFingerprint,
} from '@qs/shared';
import {
    MAX_AUTH_BYTES,
    MAX_JSON_BYTES,
    generateSalt,
    hashPassword,
    readJsonBody,
} from '../lib/crypto.js';
import {
    ensureUserSyncMeta,
    rowToCanonicalQuestion,
    type V2QuestionRow,
} from '../lib/v2-helpers.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

export function createAdminRouter(): Hono<AppEnv> {
    const router = new Hono<AppEnv>();
    router.use('*', requireAuth, requireAdmin);

    // 0. OVERVIEW STATS
    router.get('/overview-stats', (c) => {
        const rawDb = c.get('rawDb');
        const row = rawDb
            .prepare(
                `SELECT
                    (SELECT COUNT(*) FROM users) AS users,
                    (SELECT COUNT(*) FROM v2_user_sync_meta) AS sets,
                    (SELECT COUNT(*) FROM v2_questions WHERE deleted_at IS NULL AND purged = 0) AS questions,
                    (SELECT COUNT(*) FROM sync_logs) AS logs,
                    (SELECT COUNT(DISTINCT user_id) FROM sync_logs WHERE created_at >= datetime('now', '-24 hours')) AS activeToday`
            )
            .get() as
            | {
                  users: number;
                  sets: number;
                  questions: number;
                  logs: number;
                  activeToday: number;
              }
            | undefined;

        return c.json(
            {
                ok: true,
                stats: {
                    users: row?.users || 0,
                    sets: row?.sets || 0,
                    questions: row?.questions || 0,
                    logs: row?.logs || 0,
                    activeToday: row?.activeToday || 0,
                },
            },
            200
        );
    });

    // 1. USERS LIST (paginated)
    router.get('/users-list', (c) => {
        const config = c.get('config');
        const rawDb = c.get('rawDb');

        const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
        const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '20', 10) || 20));
        const searchQ = (c.req.query('q') || '').trim().toLowerCase();
        const searchEscaped = searchQ.replace(/[%_]/g, '\\$&');
        const whereSql = searchQ ? "WHERE lower(u.username) LIKE ? ESCAPE '\\'" : '';

        const totalRow = (
            searchQ
                ? rawDb
                      .prepare("SELECT COUNT(*) AS c FROM users WHERE lower(username) LIKE ? ESCAPE '\\'")
                      .get('%' + searchEscaped + '%')
                : rawDb.prepare('SELECT COUNT(*) AS c FROM users').get()
        ) as { c: number } | undefined;
        const total = totalRow?.c || 0;

        const queryStr = `
            WITH UserSets AS (
                SELECT user_id, COUNT(*) AS bank_count,
                       datetime(MAX(updated_at) / 1000, 'unixepoch') AS last_updated_at
                FROM v2_user_sync_meta
                GROUP BY user_id
            ),
            UserQuestions AS (
                SELECT user_id, COUNT(*) AS total_questions
                FROM v2_questions
                WHERE deleted_at IS NULL AND purged = 0
                GROUP BY user_id
            ),
            UserSyncAgg AS (
                SELECT
                    user_id,
                    COUNT(*) AS sync_count,
                    SUM(CASE WHEN status = 'conflict' THEN 1 ELSE 0 END) AS conflict_count,
                    SUM(CASE WHEN status = 'client-error' THEN 1 ELSE 0 END) AS error_count
                FROM sync_logs
                GROUP BY user_id
            ),
            LastSync AS (
                SELECT s1.user_id, s1.created_at AS last_sync_at, s1.delta
                FROM sync_logs s1
                INNER JOIN (SELECT user_id, MAX(id) AS max_id FROM sync_logs GROUP BY user_id) s2
                    ON s1.id = s2.max_id
            )
            SELECT
                u.id AS user_id,
                u.username,
                u.created_at,
                COALESCE(us.bank_count, 0) AS bank_count,
                COALESCE(uq.total_questions, 0) AS question_count,
                COALESCE(sa.sync_count, 0) AS sync_count,
                COALESCE(sa.conflict_count, 0) AS conflict_count,
                COALESCE(sa.error_count, 0) AS error_count,
                COALESCE(ls.last_sync_at, us.last_updated_at, u.created_at) AS last_active_at,
                ls.delta AS last_sync_delta
            FROM users u
            LEFT JOIN UserSets us ON u.id = us.user_id
            LEFT JOIN UserQuestions uq ON u.id = uq.user_id
            LEFT JOIN UserSyncAgg sa ON u.id = sa.user_id
            LEFT JOIN LastSync ls ON u.id = ls.user_id
            ${whereSql}
            ORDER BY last_active_at DESC
            LIMIT ? OFFSET ?
        `;

        const params = searchQ
            ? ['%' + searchEscaped + '%', pageSize, (page - 1) * pageSize]
            : [pageSize, (page - 1) * pageSize];
        const rows = rawDb.prepare(queryStr).all(...params) as Array<{
            user_id: string;
            username: string;
            created_at: string;
            bank_count: number;
            question_count: number;
            sync_count: number;
            conflict_count: number;
            error_count: number;
            last_active_at: string;
            last_sync_delta: string | null;
        }>;

        const users = rows.map((row) => {
            let ip = '-';
            let device = '-';
            if (row.last_sync_delta) {
                try {
                    const parsed = JSON.parse(row.last_sync_delta);
                    ip = parsed.ip || ip;
                    device = parsed.ua || device;
                } catch {
                    // ignore
                }
            }
            if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') {
                ip = '待同步刷新';
            }
            return {
                id: row.user_id,
                user_id: row.user_id,
                email: `${row.username}@user.local`,
                username: row.username,
                is_admin: config.adminUsernames.includes(row.username.toLowerCase()),
                bank_count: row.bank_count,
                question_count: row.question_count,
                sync_count: row.sync_count,
                conflict_count: row.conflict_count,
                error_count: row.error_count,
                last_active_at: row.last_active_at,
                last_ip: ip,
                last_device: device,
            };
        });

        return c.json(
            {
                ok: true,
                users,
                meta: {
                    total,
                    page,
                    pageSize,
                    pages: Math.max(1, Math.ceil(total / pageSize)),
                    email_access: true,
                },
            },
            200
        );
    });

    // 1.1 USER DOSSIER (360° telemetry computed directly from normalized v2 tables)
    router.get('/user-dossier', (c) => {
        const config = c.get('config');
        const rawDb = c.get('rawDb');

        const targetUid = c.req.query('userId');
        if (!targetUid) return c.json({ error: 'Missing userId' }, 400);

        const user = rawDb
            .prepare('SELECT id, username, created_at FROM users WHERE id = ?')
            .get(targetUid) as { id: string; username: string; created_at: string } | undefined;
        if (!user) return c.json({ error: 'User not found' }, 404);

        const isAdmin = config.adminUsernames.includes(user.username.toLowerCase());

        const meta = rawDb
            .prepare('SELECT * FROM v2_user_sync_meta WHERE user_id = ?')
            .get(targetUid) as
            | {
                  legacy_set_id: number | null;
                  bank_name: string;
                  version: number;
                  updated_at: number;
              }
            | undefined;

        const activeRows = rawDb
            .prepare(
                'SELECT id FROM v2_questions WHERE user_id = ? AND deleted_at IS NULL AND purged = 0'
            )
            .all(targetUid) as Array<{ id: string }>;
        const activeIds = new Set(activeRows.map((r) => r.id));

        const trashCountRow = rawDb
            .prepare(
                'SELECT COUNT(*) AS c FROM v2_questions WHERE user_id = ? AND deleted_at IS NOT NULL AND purged = 0'
            )
            .get(targetUid) as { c: number } | undefined;

        const starCountRow = rawDb
            .prepare('SELECT COUNT(*) AS c FROM v2_question_flags WHERE user_id = ? AND starred = 1')
            .get(targetUid) as { c: number } | undefined;

        const hRows = rawDb
            .prepare(
                'SELECT rid, question_id, is_correct, answered_at FROM v2_answer_history WHERE user_id = ?'
            )
            .all(targetUid) as Array<{
            rid: string;
            question_id: string;
            is_correct: number;
            answered_at: number;
        }>;

        let correctCount = 0;
        let wrongCount = 0;
        const daySet = new Set<string>();
        const historyForSm2: Array<{ rid: string; id: string; r: boolean; t: number }> = [];

        for (const h of hRows) {
            const ok = h.is_correct === 1;
            if (ok) correctCount += 1;
            else wrongCount += 1;

            if (Number.isFinite(h.answered_at)) {
                const dStr = new Date(h.answered_at + 8 * 3_600_000).toISOString().slice(0, 10);
                daySet.add(dStr);
                historyForSm2.push({
                    rid: h.rid,
                    id: h.question_id,
                    r: ok,
                    t: h.answered_at,
                });
            }
        }

        const answeredCount = hRows.length;
        const studyStats = {
            totalQuestions: activeIds.size,
            answeredCount,
            correctCount,
            wrongCount,
            accuracyPercent:
                answeredCount > 0 ? Number(((correctCount / answeredCount) * 100).toFixed(1)) : 0,
            favoritesCount: starCountRow?.c || 0,
            trashCount: trashCountRow?.c || 0,
            sm2DueCount: countDueQuestions(historyForSm2, activeIds),
            uniqueDays: daySet.size,
        };

        const rawLogs = rawDb
            .prepare(
                'SELECT id, delta, status, error, created_at FROM sync_logs WHERE user_id = ? ORDER BY id DESC LIMIT 30'
            )
            .all(targetUid) as Array<{
            id: number;
            delta: string | null;
            status: string;
            error: string | null;
            created_at: string;
        }>;

        const ipSet = new Set<string>();
        const uaSet = new Set<string>();
        const recentLogs = rawLogs.map((r) => {
            let d: Record<string, unknown> | null = null;
            if (r.delta) {
                try {
                    d = JSON.parse(r.delta) as Record<string, unknown>;
                    if (
                        typeof d.ip === 'string' &&
                        d.ip &&
                        d.ip !== '127.0.0.1' &&
                        d.ip !== '::1' &&
                        d.ip !== 'localhost'
                    ) {
                        ipSet.add(d.ip);
                    }
                    if (typeof d.ua === 'string' && d.ua) uaSet.add(d.ua);
                } catch {
                    d = null;
                }
            }
            return {
                id: r.id,
                status: r.status,
                error: r.error,
                created_at: r.created_at,
                delta: d,
            };
        });

        if (ipSet.size === 0) {
            ipSet.add('待下次同步获取公网 IP');
        }

        const backups = rawDb
            .prepare(
                'SELECT id, type, created_at, LENGTH(payload) AS size FROM user_backups WHERE user_id = ? ORDER BY id DESC LIMIT 10'
            )
            .all(targetUid);
        const snapshots = rawDb
            .prepare(
                'SELECT user_id, set_id, version, created_at, LENGTH(state) AS size FROM bank_snapshots WHERE user_id = ?'
            )
            .all(targetUid);

        return c.json(
            {
                ok: true,
                user: {
                    id: user.id,
                    username: user.username,
                    created_at: user.created_at,
                    is_admin: isAdmin,
                    email: `${user.username}@user.local`,
                },
                sets: meta
                    ? [
                          {
                              id: meta.legacy_set_id ?? 1,
                              name: meta.bank_name,
                              version: meta.version,
                              question_count: activeIds.size,
                              created_at: new Date(meta.updated_at).toISOString(),
                          },
                      ]
                    : [],
                studyStats,
                network: {
                    uniqueIps: Array.from(ipSet),
                    uniqueDevices: Array.from(uaSet),
                },
                recentLogs,
                backups,
                snapshots,
            },
            200
        );
    });

    // 1.2 EXPORT FULL USER DATA
    router.get('/user-export', (c) => {
        const rawDb = c.get('rawDb');
        const targetUid = c.req.query('userId');
        if (!targetUid) return c.json({ error: 'Missing userId' }, 400);

        const user = rawDb
            .prepare('SELECT id, username, created_at FROM users WHERE id = ?')
            .get(targetUid);
        if (!user) return c.json({ error: 'User not found' }, 404);

        const meta = rawDb
            .prepare('SELECT * FROM v2_user_sync_meta WHERE user_id = ?')
            .all(targetUid);
        const questions = rawDb
            .prepare('SELECT * FROM v2_questions WHERE user_id = ? AND purged = 0')
            .all(targetUid);
        const history = rawDb
            .prepare('SELECT * FROM v2_answer_history WHERE user_id = ?')
            .all(targetUid);
        const flags = rawDb
            .prepare('SELECT * FROM v2_question_flags WHERE user_id = ?')
            .all(targetUid);
        const backups = rawDb
            .prepare('SELECT id, type, payload, created_at FROM user_backups WHERE user_id = ?')
            .all(targetUid);
        const logs = rawDb
            .prepare(
                'SELECT id, delta, status, error, created_at FROM sync_logs WHERE user_id = ? ORDER BY id DESC LIMIT 100'
            )
            .all(targetUid);

        return c.json(
            {
                ok: true,
                bundle: {
                    exportDate: new Date().toISOString(),
                    user,
                    question_sets: meta,
                    questions,
                    history,
                    flags,
                    user_backups: backups,
                    sync_logs: logs,
                },
            },
            200
        );
    });

    // 2. CREATE USER
    router.post('/create-user', async (c) => {
        const rawDb = c.get('rawDb');
        const body = await readJsonBody<Record<string, unknown>>(c.req.raw, MAX_AUTH_BYTES);
        if (!body) return c.json({ error: '无效的 JSON 请求体' }, 400);

        const parsed = AdminCreateUserSchema.safeParse(body);
        if (!parsed.success) {
            return c.json(
                { error: parsed.error.issues[0]?.message || 'Username and password are required' },
                400
            );
        }

        const rawUsername = String(parsed.data.username || parsed.data.email || '').trim();
        let queryName = rawUsername.toLowerCase();
        if (queryName.includes('@')) queryName = queryName.split('@')[0];

        const uCheck = UsernameSchema.safeParse(queryName);
        if (!uCheck.success) {
            return c.json({ error: uCheck.error.issues[0]?.message || '用户名格式不合法' }, 400);
        }

        const existing = rawDb
            .prepare('SELECT id FROM users WHERE username = ?')
            .get(queryName);
        if (existing) {
            return c.json({ error: 'Username already exists' }, 400);
        }

        const newUserId = crypto.randomUUID();
        const salt = generateSalt();
        const passwordHash = await hashPassword(parsed.data.password, salt);

        rawDb
            .prepare(
                'INSERT INTO users (id, username, password_hash, salt, token_version) VALUES (?, ?, ?, ?, 1)'
            )
            .run(newUserId, queryName, passwordHash, salt);

        return c.json(
            {
                ok: true,
                user: {
                    id: newUserId,
                    email: `${queryName}@user.local`,
                },
            },
            200
        );
    });

    // 3. DELETE USERS
    router.post('/delete-users', async (c) => {
        const rawDb = c.get('rawDb');
        const authUser = c.get('authUser');

        const body = await readJsonBody<{ userIds?: unknown }>(c.req.raw, MAX_JSON_BYTES);
        if (!body) return c.json({ error: '无效的 JSON 请求体' }, 400);

        const userIds = Array.isArray(body.userIds)
            ? body.userIds.filter((x): x is string => typeof x === 'string' && x.length > 0)
            : [];
        if (userIds.length === 0) {
            return c.json({ error: 'userIds array is required' }, 400);
        }
        if (userIds.includes(authUser.id)) {
            return c.json({ error: '不能删除当前登录的管理员账号' }, 400);
        }

        rawDb.transaction(() => {
            for (const uid of userIds) {
                const sets = rawDb
                    .prepare('SELECT id FROM question_sets WHERE user_id = ?')
                    .all(uid) as Array<{ id: number }>;
                for (const s of sets) {
                    rawDb.prepare('DELETE FROM questions WHERE question_set_id = ?').run(s.id);
                }
                rawDb.prepare('DELETE FROM question_sets WHERE user_id = ?').run(uid);
                rawDb.prepare('DELETE FROM sync_logs WHERE user_id = ?').run(uid);
                rawDb.prepare('DELETE FROM bank_snapshots WHERE user_id = ?').run(uid);
                rawDb.prepare('DELETE FROM user_backups WHERE user_id = ?').run(uid);
                rawDb.prepare('DELETE FROM users WHERE id = ?').run(uid);
            }
        })();

        return c.json({ ok: true, deletedCount: userIds.length }, 200);
    });

    // 3.5 RESET USER PASSWORD (increments token_version + revokes refresh tokens)
    router.post('/reset-user-password', async (c) => {
        const rawDb = c.get('rawDb');
        const authUser = c.get('authUser');

        const body = await readJsonBody<Record<string, unknown>>(c.req.raw, MAX_AUTH_BYTES);
        if (!body) return c.json({ error: '无效的 JSON 请求体' }, 400);

        const parsed = AdminResetPasswordSchema.safeParse(body);
        if (!parsed.success) {
            return c.json(
                { error: parsed.error.issues[0]?.message || 'userId 与 6–128 位的新密码是必填的' },
                400
            );
        }

        const { userId: targetUid, newPassword } = parsed.data;
        if (targetUid === authUser.id) {
            return c.json({ error: '请使用「修改密码」功能修改自己的密码' }, 400);
        }

        const target = rawDb
            .prepare('SELECT id FROM users WHERE id = ?')
            .get(targetUid);
        if (!target) return c.json({ error: '用户不存在' }, 404);

        const salt = generateSalt();
        const hash = await hashPassword(newPassword, salt);
        const now = Date.now();

        rawDb.transaction(() => {
            rawDb
                .prepare(
                    'UPDATE users SET password_hash = ?, salt = ?, token_version = token_version + 1 WHERE id = ?'
                )
                .run(hash, salt, targetUid);
            rawDb
                .prepare(
                    'UPDATE v2_refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL'
                )
                .run(now, targetUid);
        })();

        return c.json({ ok: true }, 200);
    });

    // 4. PUSH BROADCAST
    router.post('/push-broadcast', async (c) => {
        const rawDb = c.get('rawDb');
        const body = await readJsonBody<{
            target?: string;
            userId?: string;
            userIds?: unknown[];
            bankName?: string;
            questions?: unknown[];
        }>(c.req.raw, MAX_JSON_BYTES);
        if (!body) return c.json({ error: '无效的 JSON 请求体' }, 400);

        const { target, userId: targetUserId, userIds, bankName, questions } = body;
        if (!Array.isArray(questions) || questions.length === 0) {
            return c.json({ error: 'Invalid payload: questions array is required' }, 400);
        }

        const safeName = bankName || 'Global Broadcast Bank';
        let targetUserIds: string[] = [];

        if (target === 'user') {
            if (!targetUserId) return c.json({ error: 'UserId is required for target=user' }, 400);
            targetUserIds = [targetUserId];
        } else if (target === 'multi') {
            if (!Array.isArray(userIds) || userIds.length === 0) {
                return c.json({ error: 'UserIds array is required for target=multi' }, 400);
            }
            targetUserIds = userIds.map(String);
        } else if (target === 'all') {
            const rows = rawDb.prepare('SELECT id FROM users').all() as Array<{ id: string }>;
            targetUserIds = rows.map((r) => r.id);
        } else {
            return c.json({ error: 'Invalid target' }, 400);
        }

        targetUserIds = [...new Set(targetUserIds.map(String).filter(Boolean))];
        if (targetUserIds.length === 0) {
            return c.json(
                {
                    ok: true,
                    message: 'No users found to push to.',
                    summary: { target, total: 0, success: 0, failed: 0, skippedDuplicate: 0 },
                },
                200
            );
        }

        const existingUsers = new Set(
            (rawDb.prepare('SELECT id FROM users').all() as Array<{ id: string }>).map((r) =>
                String(r.id)
            )
        );
        const missing = targetUserIds.filter((uid) => !existingUsers.has(uid));
        if (missing.length > 0) {
            return c.json(
                {
                    error: `以下用户不存在，已中止：${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` 等共 ${missing.length} 个` : ''}`,
                    missingUserIds: missing,
                },
                400
            );
        }

        const template = questions
            .map((raw) => {
                if (!raw || typeof raw !== 'object') return null;
                const copy = { ...(raw as Record<string, unknown>) };
                const sub = copy.sub == null ? '' : String(copy.sub);
                const chap = copy.chap == null ? '' : String(copy.chap);
                copy.sub = !sub.trim() || sub.toLowerCase().includes('default') ? safeName : sub;
                copy.chap = !chap.trim() || chap.toLowerCase().includes('chapter 1') ? 'Imported' : chap;
                return normalizeQuestion(copy);
            })
            .filter((q): q is NonNullable<ReturnType<typeof normalizeQuestion>> => q !== null);

        let successCount = 0;
        let failCount = 0;
        let skippedDuplicate = 0;
        const now = Date.now();

        for (const uid of targetUserIds) {
            try {
                rawDb.transaction(() => {
                    const meta = ensureUserSyncMeta(rawDb, uid, safeName);
                    const existingRows = rawDb
                        .prepare(
                            'SELECT * FROM v2_questions WHERE user_id = ? AND deleted_at IS NULL AND purged = 0'
                        )
                        .all(uid) as V2QuestionRow[];

                    const seen = new Set<string>();
                    for (const row of existingRows) {
                        seen.add(questionFingerprint(rowToCanonicalQuestion(row)));
                    }

                    const toInsert = [];
                    for (const t of template) {
                        const fp = questionFingerprint(t);
                        if (seen.has(fp)) {
                            skippedDuplicate += 1;
                            continue;
                        }
                        seen.add(fp);
                        toInsert.push({ ...t, id: crypto.randomUUID() });
                    }

                    if (toInsert.length === 0) return;

                    const nextSeq = meta.sync_seq + 1;
                    const nextVersion = meta.version + 1;

                    const insertStmt = rawDb.prepare(
                        `INSERT INTO v2_questions
                            (user_id, id, sub, chap, type, q, options_json, a, d, media_json, psg, self_check, edited_at,
                             version, deleted_at, deleted_by, delete_reason, original_sub, original_chap, was_starred, purged, updated_at, sync_seq)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, NULL, NULL, NULL, NULL, 0, 0, ?, ?)`
                    );
                    for (const q of toInsert) {
                        insertStmt.run(
                            uid,
                            q.id,
                            q.sub,
                            q.chap,
                            q.type,
                            q.q,
                            JSON.stringify(q.o || []),
                            q.a,
                            q.d || '',
                            q.media ? JSON.stringify(q.media) : null,
                            q.psg ?? null,
                            typeof q.selfCheck === 'boolean' ? (q.selfCheck ? 1 : 0) : null,
                            typeof q._editedAt === 'number' ? q._editedAt : null,
                            now,
                            nextSeq
                        );
                    }

                    rawDb
                        .prepare(
                            'UPDATE v2_user_sync_meta SET version = ?, sync_seq = ?, updated_at = ? WHERE user_id = ?'
                        )
                        .run(nextVersion, nextSeq, now, uid);
                })();
                successCount += 1;
            } catch (err) {
                console.error(`Failed to push to user ${uid}:`, err);
                failCount += 1;
            }
        }

        return c.json(
            {
                ok: true,
                summary: {
                    target,
                    total: targetUserIds.length,
                    success: successCount,
                    failed: failCount,
                    skippedDuplicate,
                },
            },
            200
        );
    });

    // 5. SYSTEM LOGS
    router.get('/system-logs', (c) => {
        const rawDb = c.get('rawDb');
        const rows = rawDb
            .prepare(
                `SELECT s.id, u.username, s.delta, s.status, s.error, s.created_at
                 FROM sync_logs s
                 JOIN users u ON s.user_id = u.id
                 ORDER BY s.id DESC
                 LIMIT 100`
            )
            .all() as Array<{
            id: number;
            username: string;
            delta: string | null;
            status: string;
            error: string | null;
            created_at: string;
        }>;

        const logs = rows.map((row) => {
            let parsedDelta: unknown = null;
            if (row.delta) {
                try {
                    parsedDelta = JSON.parse(row.delta);
                } catch {
                    parsedDelta = null;
                }
            }
            return { ...row, delta: parsedDelta };
        });

        return c.json({ ok: true, logs }, 200);
    });

    // 6. USER SETS
    router.get('/users-sets', (c) => {
        const rawDb = c.get('rawDb');
        const targetUid = c.req.query('userId');
        if (!targetUid) return c.json({ error: 'Missing userId parameter' }, 400);

        const meta = rawDb
            .prepare('SELECT * FROM v2_user_sync_meta WHERE user_id = ?')
            .get(targetUid) as
            | {
                  legacy_set_id: number | null;
                  bank_name: string;
                  version: number;
                  updated_at: number;
              }
            | undefined;

        if (!meta) {
            return c.json({ ok: true, sets: [] }, 200);
        }

        const qCountRow = rawDb
            .prepare(
                'SELECT COUNT(*) AS c FROM v2_questions WHERE user_id = ? AND deleted_at IS NULL AND purged = 0'
            )
            .get(targetUid) as { c: number } | undefined;

        return c.json(
            {
                ok: true,
                sets: [
                    {
                        id: meta.legacy_set_id ?? 1,
                        name: meta.bank_name,
                        version: meta.version,
                        created_at: new Date(meta.updated_at).toISOString(),
                        question_count: qCountRow?.c || 0,
                    },
                ],
            },
            200
        );
    });

    // 7. SET DETAILS
    router.get('/set-details', (c) => {
        const rawDb = c.get('rawDb');
        const setIdRaw = c.req.query('setId');
        if (!setIdRaw) return c.json({ error: 'Missing setId parameter' }, 400);
        const setId = parseInt(setIdRaw, 10);

        const meta = rawDb
            .prepare('SELECT * FROM v2_user_sync_meta WHERE legacy_set_id = ?')
            .get(setId) as
            | {
                  user_id: string;
                  legacy_set_id: number;
                  bank_name: string;
                  version: number;
                  updated_at: number;
              }
            | undefined;
        if (!meta) return c.json({ error: 'Set not found' }, 404);

        const rows = rawDb
            .prepare(
                'SELECT * FROM v2_questions WHERE user_id = ? AND deleted_at IS NULL AND purged = 0 ORDER BY updated_at ASC'
            )
            .all(meta.user_id) as V2QuestionRow[];

        const questions = rows.map((row) => {
            const n = rowToCanonicalQuestion(row);
            return {
                ...n,
                stem: n.q,
                options: n.o,
                ans: n.a,
                analysis: n.d,
            };
        });

        return c.json(
            {
                ok: true,
                bank_info: {
                    id: meta.legacy_set_id,
                    name: meta.bank_name,
                    version: meta.version,
                    created_at: new Date(meta.updated_at).toISOString(),
                },
                user_id: meta.user_id,
                questions,
            },
            200
        );
    });

    // 8. UPDATE USER BANK
    router.post('/users-update-bank', async (c) => {
        const rawDb = c.get('rawDb');
        const body = await readJsonBody<{
            userId?: string;
            setId?: number;
            name?: string;
            questions?: unknown[];
        }>(c.req.raw, MAX_JSON_BYTES);
        if (!body) return c.json({ error: '无效的 JSON 请求体' }, 400);

        const { userId: targetUid, setId, name, questions } = body;
        if (!targetUid || !setId || !name || !Array.isArray(questions)) {
            return c.json({ error: 'Missing required parameters' }, 400);
        }

        const meta = rawDb
            .prepare('SELECT * FROM v2_user_sync_meta WHERE user_id = ? AND legacy_set_id = ?')
            .get(targetUid, Number(setId)) as
            | {
                  user_id: string;
                  version: number;
                  sync_seq: number;
              }
            | undefined;
        if (!meta) {
            return c.json({ error: 'setId 不属于该用户' }, 400);
        }

        const now = Date.now();
        rawDb.transaction(() => {
            const nextSeq = meta.sync_seq + 1;
            const nextVersion = meta.version + 1;

            const upsertQ = rawDb.prepare(
                `INSERT INTO v2_questions
                    (user_id, id, sub, chap, type, q, options_json, a, d, media_json, psg, self_check, edited_at,
                     version, deleted_at, deleted_by, delete_reason, original_sub, original_chap, was_starred, purged, updated_at, sync_seq)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, NULL, NULL, NULL, NULL, 0, 0, ?, ?)
                 ON CONFLICT(user_id, id) DO UPDATE SET
                    sub = excluded.sub,
                    chap = excluded.chap,
                    type = excluded.type,
                    q = excluded.q,
                    options_json = excluded.options_json,
                    a = excluded.a,
                    d = excluded.d,
                    media_json = excluded.media_json,
                    psg = excluded.psg,
                    self_check = excluded.self_check,
                    edited_at = excluded.edited_at,
                    version = v2_questions.version + 1,
                    deleted_at = NULL,
                    purged = 0,
                    updated_at = excluded.updated_at,
                    sync_seq = excluded.sync_seq`
            );

            const keptIds = new Set<string>();
            for (const raw of questions) {
                const q = normalizeQuestion(raw);
                if (!q) continue;
                let qid = q.id;
                if (keptIds.has(qid)) qid = `${qid}::dup::${keptIds.size}`;
                keptIds.add(qid);

                upsertQ.run(
                    targetUid,
                    qid,
                    q.sub,
                    q.chap,
                    q.type,
                    q.q,
                    JSON.stringify(q.o || []),
                    q.a,
                    q.d || '',
                    q.media ? JSON.stringify(q.media) : null,
                    q.psg ?? null,
                    typeof q.selfCheck === 'boolean' ? (q.selfCheck ? 1 : 0) : null,
                    typeof q._editedAt === 'number' ? q._editedAt : null,
                    now,
                    nextSeq
                );
            }

            // 将被管理员移除的题目标记 purged = 1（不影响回收站中 deleted_at IS NOT NULL 的题）
            const existingActive = rawDb
                .prepare(
                    'SELECT id FROM v2_questions WHERE user_id = ? AND deleted_at IS NULL AND purged = 0'
                )
                .all(targetUid) as Array<{ id: string }>;
            const markPurged = rawDb.prepare(
                `UPDATE v2_questions
                 SET purged = 1, deleted_at = ?, version = version + 1, updated_at = ?, sync_seq = ?
                 WHERE user_id = ? AND id = ?`
            );
            for (const row of existingActive) {
                if (!keptIds.has(row.id)) {
                    markPurged.run(now, now, nextSeq, targetUid, row.id);
                }
            }

            rawDb
                .prepare(
                    'UPDATE v2_user_sync_meta SET bank_name = ?, version = ?, sync_seq = ?, updated_at = ? WHERE user_id = ?'
                )
                .run(name, nextVersion, nextSeq, now, targetUid);
        })();

        return c.json({ ok: true }, 200);
    });

    return router;
}
