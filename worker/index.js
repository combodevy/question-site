/**
 * @file worker/index.js
 * @description Cloudflare Worker API for question-site (D1 Database + Native JWT Auth)
 */

// ==========================================
// 1. CORS Helpers
// ==========================================
const ALLOWED_ORIGINS = [
    'https://question-site-front.pages.dev',
    'http://localhost:8788',
    'http://127.0.0.1:8788'
];

function corsHeaders(env, request) {
    const requestOrigin = request ? (request.headers.get('Origin') || '') : '';
    const configuredOrigin = env.CORS_ORIGIN || '';
    let allowedOrigin = '*';
    if (configuredOrigin) {
        allowedOrigin = configuredOrigin;
    } else if (requestOrigin && (ALLOWED_ORIGINS.includes(requestOrigin) || requestOrigin.endsWith('.question-site-front.pages.dev'))) {
        allowedOrigin = requestOrigin;
    }
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, If-None-Match',
        'Access-Control-Expose-Headers': 'ETag',
        'Access-Control-Max-Age': '86400',
    };
}

function handleOptions(request, env) {
    return new Response(null, {
        status: 204,
        headers: corsHeaders(env, request)
    });
}

function jsonResponse(data, status = 200, headers = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            ...headers
        }
    });
}

// ==========================================
// 2. Crypto & JWT Utilities (Web Crypto API)
// ==========================================
function bufToHex(buf) {
    return Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
}

function generateSalt() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return bufToHex(arr);
}

async function hashPassword(password, salt) {
    const encoder = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
        "raw",
        encoder.encode(password),
        "PBKDF2",
        false,
        ["deriveBits", "deriveKey"]
    );
    const derivedKey = await crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: encoder.encode(salt),
            iterations: 100000,
            hash: "SHA-256"
        },
        baseKey,
        { name: "HMAC", hash: "SHA-256", length: 256 },
        true,
        ["sign", "verify"]
    );
    const exported = await crypto.subtle.exportKey("raw", derivedKey);
    return bufToHex(exported);
}

function bufToBase64Url(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)))
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
}

function base64UrlToBytes(base64url) {
    const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "===".slice((base64.length + 3) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

async function signJwt(payload, secret) {
    const header = { alg: "HS256", typ: "JWT" };
    const encoder = new TextEncoder();
    const encodedHeader = bufToBase64Url(encoder.encode(JSON.stringify(header)));
    const encodedPayload = bufToBase64Url(encoder.encode(JSON.stringify(payload)));
    const stringToSign = `${encodedHeader}.${encodedPayload}`;

    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(stringToSign)
    );
    const encodedSignature = bufToBase64Url(signature);
    return `${stringToSign}.${encodedSignature}`;
}

async function verifyJwt(token, secret) {
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const stringToVerify = `${encodedHeader}.${encodedPayload}`;
    const encoder = new TextEncoder();

    try {
        const key = await crypto.subtle.importKey(
            "raw",
            encoder.encode(secret),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["verify"]
        );
        const signatureBytes = base64UrlToBytes(encodedSignature);
        const isValid = await crypto.subtle.verify(
            "HMAC",
            key,
            signatureBytes,
            encoder.encode(stringToVerify)
        );
        if (!isValid) return null;
        const payloadJson = new TextDecoder().decode(base64UrlToBytes(encodedPayload));
        const payload = JSON.parse(payloadJson);
        // Check expiration
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
            return null;
        }
        return payload;
    } catch (e) {
        return null;
    }
}

// ==========================================
// 3. Authentication Middleware
// ==========================================
async function getAuthUser(request, env) {
    const authHeader = request.headers.get("authorization") || request.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return null;
    const token = authHeader.slice(7).trim();
    if (!token) return null;
    const secret = env.JWT_SECRET;
    return await verifyJwt(token, secret);
}

function verifyAdmin(user, env) {
    if (!user) return false;
    const adminUsernames = (env.ADMIN_USERNAMES || "admin").split(",").map(name => name.trim().toLowerCase());
    return adminUsernames.includes(user.username.toLowerCase()) || user.role === "admin";
}

// ==========================================
// 4. Request Router / Request Handler
// ==========================================
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;

        // 1. CORS Preflight
        if (request.method === 'OPTIONS') {
            return handleOptions(request, env);
        }

        const headers = corsHeaders(env, request);

        try {
            // ==========================================
            // AUTH ENDPOINTS
            // ==========================================

            // 1. SIGNUP
            if (path === "/api/auth/signup" && request.method === "POST") {
                const { email, password, username } = await request.json();
                const rawUsername = (username || email || "").trim();
                if (!rawUsername || !password) {
                    return jsonResponse({ error: "Username and password are required" }, 400, headers);
                }
                if (rawUsername.includes("@")) {
                    return jsonResponse({ error: "Username cannot contain '@'" }, 400, headers);
                }

                // Check if user already exists
                const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ?")
                    .bind(rawUsername.toLowerCase())
                    .first();
                if (existing) {
                    return jsonResponse({ error: "用户名已被注册" }, 400, headers);
                }

                const userId = crypto.randomUUID();
                const salt = generateSalt();
                const passwordHash = await hashPassword(password, salt);

                await env.DB.prepare("INSERT INTO users (id, username, password_hash, salt) VALUES (?, ?, ?, ?)")
                    .bind(userId, rawUsername.toLowerCase(), passwordHash, salt)
                    .run();

                const token = await signJwt({
                    sub: userId,
                    username: rawUsername,
                    role: rawUsername.toLowerCase() === "admin" ? "admin" : "user",
                    exp: Math.floor(Date.now() / 1000) + 604800 // 7 days
                }, env.JWT_SECRET);

                return jsonResponse({ ok: true, token, user: { id: userId, username: rawUsername } }, 200, headers);
            }

            // 2. LOGIN
            if (path === "/api/auth/login" && request.method === "POST") {
                const { email, username, password } = await request.json();
                const rawUsername = (username || email || "").trim();
                if (!rawUsername || !password) {
                    return jsonResponse({ error: "Username/Email and password are required" }, 400, headers);
                }

                // Map email virtual address to username
                let queryName = rawUsername.toLowerCase();
                if (queryName.includes("@user.local")) {
                    queryName = queryName.split("@")[0];
                }

                const user = await env.DB.prepare("SELECT id, username, password_hash, salt FROM users WHERE username = ?")
                    .bind(queryName)
                    .first();

                if (!user) {
                    return jsonResponse({ error: "用户不存在或密码错误" }, 400, headers);
                }

                const currentHash = await hashPassword(password, user.salt);
                if (currentHash !== user.password_hash) {
                    return jsonResponse({ error: "用户不存在或密码错误" }, 400, headers);
                }

                const token = await signJwt({
                    sub: user.id,
                    username: user.username,
                    role: user.username.toLowerCase() === "admin" ? "admin" : "user",
                    exp: Math.floor(Date.now() / 1000) + 604800 // 7 days
                }, env.JWT_SECRET);

                return jsonResponse({ ok: true, token, user: { id: user.id, username: user.username } }, 200, headers);
            }

            // ==========================================
            // USER FLOW ENDPOINTS
            // ==========================================
            const user = await getAuthUser(request, env);
            if (!user) {
                return jsonResponse({ error: "Unauthorized" }, 401, headers);
            }
            const userId = user.sub;


            // 3. LOAD QUESTION SET
            if (path === "/api/load-question-set" && request.method === "GET") {
                const set = await env.DB.prepare("SELECT id, name, state, version FROM question_sets WHERE user_id = ? LIMIT 1")
                    .bind(userId)
                    .first();

                if (!set) {
                    return jsonResponse({ ok: true, setId: null, name: null, state: null, version: 0 }, 200, headers);
                }

                const setId = set.id;
                const version = typeof set.version === "number" ? set.version : 0;
                let baseState = null;
                if (set.state) {
                    try { baseState = JSON.parse(set.state); } catch (e) {}
                }

                // Query all questions
                const { results } = await env.DB.prepare("SELECT content FROM questions WHERE question_set_id = ?")
                    .bind(setId)
                    .all();

                const bank = {};
                for (const row of results) {
                    let q = null;
                    try { q = JSON.parse(row.content); } catch (e) {}
                    if (!q || typeof q !== "object") continue;
                    const sub = q.sub || "默认科目";
                    const chap = q.chap || "默认章节";
                    if (!bank[sub]) bank[sub] = {};
                    if (!bank[sub][chap]) bank[sub][chap] = [];
                    bank[sub][chap].push(q);
                }

                const countBank = (bk) => {
                    if (!bk || typeof bk !== "object") return 0;
                    let total = 0;
                    for (const sub in bk) {
                        for (const chap in bk[sub]) {
                            if (Array.isArray(bk[sub][chap])) total += bk[sub][chap].length;
                        }
                    }
                    return total;
                };

                const baseBank = baseState && baseState.bank ? baseState.bank : null;
                if (baseBank && countBank(baseBank) > countBank(bank)) {
                    for (const sub in bank) delete bank[sub];
                    Object.assign(bank, baseBank);
                }

                const state = {
                    bank,
                    bankName: baseState && typeof baseState.bankName === "string" ? baseState.bankName : null,
                    history: baseState && Array.isArray(baseState.history) ? baseState.history : [],
                    lastPracticeTime: baseState && typeof baseState.lastPracticeTime === "number" ? baseState.lastPracticeTime : null,
                    trash: baseState && typeof baseState.trash === "object" && !Array.isArray(baseState.trash) ? baseState.trash : {},
                    hiddenMistakeIds: baseState && Array.isArray(baseState.hiddenMistakeIds) ? baseState.hiddenMistakeIds : []
                };

                const responseBody = JSON.stringify({ ok: true, setId, name: set.name, state, version });
                
                // ETag implementation
                const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(responseBody));
                const etag = `W/"${bufToHex(hashBuffer).slice(0, 16)}"`;

                const ifNoneMatch = request.headers.get("if-none-match") || request.headers.get("If-None-Match");
                if (ifNoneMatch && ifNoneMatch === etag) {
                    return new Response(null, { status: 304, headers: { ...headers, ETag: etag } });
                }

                return new Response(responseBody, {
                    status: 200,
                    headers: {
                        ...headers,
                        'Content-Type': 'application/json',
                        ETag: etag
                    }
                });
            }

            // 4. SAVE QUESTION SET
            if (path === "/api/save-question-set" && request.method === "POST") {
                const body = await request.json();
                const name = body.name;
                const questions = Array.isArray(body.questions) ? body.questions : [];
                const state = body.state && typeof body.state === "object" ? body.state : null;
                const delta = body.delta && typeof body.delta === "object" ? body.delta : null;
                const clientVersion = typeof body.version === "number" ? body.version : 0;
                const skipQuestionsUpdate = body.skipQuestionsUpdate === true;

                // Incremental Sync params
                const historyAppend = Array.isArray(body.historyAppend) ? body.historyAppend : null;
                const statePartial = body.statePartial === true;
                const partialFields = Array.isArray(body.partialFields) ? body.partialFields : [];

                if (!name) {
                    return jsonResponse({ error: "name 不能为空" }, 400, headers);
                }

                const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";
                const ua = request.headers.get("user-agent") || "unknown";
                const logDelta = delta ? { ...delta, ip, ua } : { ip, ua };

                // Get existing set
                const existing = await env.DB.prepare("SELECT id, version, state FROM question_sets WHERE user_id = ? LIMIT 1")
                    .bind(userId)
                    .first();

                let setId;
                let currentVersion = 0;
                let nextVersion = 1;

                if (existing) {
                    setId = existing.id;
                    currentVersion = typeof existing.version === "number" ? existing.version : 0;

                    if (clientVersion !== currentVersion) {
                        // Version conflict log
                        await env.DB.prepare("INSERT INTO sync_logs (user_id, delta, status, error) VALUES (?, ?, ?, ?)")
                            .bind(userId, JSON.stringify({ clientVersion, currentVersion, ip, ua }), "conflict", "Version Mismatch")
                            .run();

                        return jsonResponse({
                            error: "Version Conflict",
                            serverVersion: currentVersion,
                            yourVersion: clientVersion
                        }, 409, headers);
                    }

                    nextVersion = currentVersion + 1;
                    let finalState = state;

                    // Incremental history sync logic
                    if (statePartial && historyAppend && historyAppend.length > 0 && !state) {
                        let parsedState = {};
                        if (existing.state) {
                            try { parsedState = JSON.parse(existing.state); } catch (e) {}
                        }
                        if (!Array.isArray(parsedState.history)) {
                            parsedState.history = [];
                        }
                        parsedState.history = parsedState.history.concat(historyAppend);
                        
                        for (const field of partialFields) {
                            const allowed = ['lastPracticeTime', 'hiddenMistakeIds', 'trash', 'bankName'];
                            if (!allowed.includes(field)) continue;
                            const val = body.partialValues && body.partialValues[field];
                            if (val !== undefined) {
                                parsedState[field] = val;
                            }
                        }
                        finalState = parsedState;
                    } else if (finalState && historyAppend && historyAppend.length > 0) {
                        if (Array.isArray(finalState.history)) {
                            const existingTimestamps = new Set(finalState.history.map(h => h.t));
                            const newEntries = historyAppend.filter(h => !existingTimestamps.has(h.t));
                            finalState.history = finalState.history.concat(newEntries);
                        }
                    }

                    // Prepare batch SQL executions to replace transactions
                    const statements = [
                        env.DB.prepare("UPDATE question_sets SET name = ?, state = ?, version = ? WHERE id = ?")
                            .bind(name, JSON.stringify(finalState), nextVersion, setId)
                    ];

                    if (!skipQuestionsUpdate) {
                        statements.push(
                            env.DB.prepare("DELETE FROM questions WHERE question_set_id = ?").bind(setId)
                        );

                        // Deduplicate questions before insertion
                        const uniqueQuestions = [];
                        const seenFingerprints = new Set();
                        for (const q of questions) {
                            try {
                                const fingerprint = JSON.stringify({ q: q.q, o: q.o, a: q.a, type: q.type, sub: q.sub, chap: q.chap });
                                if (!seenFingerprints.has(fingerprint)) {
                                    seenFingerprints.add(fingerprint);
                                    uniqueQuestions.push(q);
                                }
                            } catch (e) {
                                uniqueQuestions.push(q);
                            }
                        }

                        for (const q of uniqueQuestions) {
                            statements.push(
                                env.DB.prepare("INSERT INTO questions (question_set_id, content) VALUES (?, ?)")
                                    .bind(setId, JSON.stringify(q))
                            );
                        }
                    }

                    statements.push(
                        env.DB.prepare("INSERT INTO sync_logs (user_id, delta, status, error) VALUES (?, ?, ?, ?)")
                            .bind(userId, JSON.stringify(logDelta), "success", null)
                    );

                    await env.DB.batch(statements);

                } else {
                    // Create new set
                    nextVersion = 1;
                    const inserted = await env.DB.prepare("INSERT INTO question_sets (user_id, name, state, version) VALUES (?, ?, ?, ?) RETURNING id")
                        .bind(userId, name, JSON.stringify(state), nextVersion)
                        .first();
                    setId = inserted.id;

                    const statements = [];
                    for (const q of questions) {
                        statements.push(
                            env.DB.prepare("INSERT INTO questions (question_set_id, content) VALUES (?, ?)")
                                .bind(setId, JSON.stringify(q))
                        );
                    }
                    statements.push(
                        env.DB.prepare("INSERT INTO sync_logs (user_id, delta, status, error) VALUES (?, ?, ?, ?)")
                            .bind(userId, JSON.stringify(logDelta), "success", null)
                    );

                    await env.DB.batch(statements);
                }

                return jsonResponse({ ok: true, setId, version: nextVersion }, 200, headers);
            }

            // 5. GET SYNC LOGS
            if (path === "/api/sync-logs" && request.method === "GET") {
                const { results } = await env.DB.prepare("SELECT id, delta, status, error, created_at FROM sync_logs WHERE user_id = ? ORDER BY id DESC LIMIT 50")
                    .bind(userId)
                    .all();

                const parsedResults = results.map(row => {
                    let parsedDelta = null;
                    if (row.delta) {
                        try { parsedDelta = JSON.parse(row.delta); } catch (e) {}
                    }
                    return {
                        ...row,
                        delta: parsedDelta
                    };
                });

                return jsonResponse({ ok: true, logs: parsedResults }, 200, headers);
            }

            // ==========================================
            // ADMIN ENDPOINTS (/api/admin/[action])
            // ==========================================
            if (path.startsWith("/api/admin/")) {
                const isAdmin = verifyAdmin(user, env);
                if (!isAdmin) {
                    return jsonResponse({ error: "Forbidden: Admin access required" }, 403, headers);
                }

                const action = path.slice("/api/admin/".length);

                // 1. GET USERS LIST
                if (action === "users-list" && request.method === "GET") {
                    const queryStr = `
                        WITH UserStats AS (
                            SELECT 
                                user_id,
                                COUNT(*) as bank_count,
                                MAX(created_at) as last_created_at
                            FROM question_sets
                            GROUP BY user_id
                        ),
                        LastSync AS (
                            SELECT 
                                user_id,
                                created_at as last_sync_at,
                                delta,
                                row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC) as rn
                            FROM sync_logs
                        )
                        SELECT 
                            u.id as user_id,
                            u.username,
                            u.created_at,
                            COALESCE(us.bank_count, 0) as bank_count,
                            COALESCE(ls.last_sync_at, us.last_created_at, u.created_at) as last_active_at,
                            ls.delta as last_sync_delta
                        FROM users u
                        LEFT JOIN UserStats us ON u.id = us.user_id
                        LEFT JOIN LastSync ls ON u.id = ls.user_id AND ls.rn = 1
                        ORDER BY last_active_at DESC
                        LIMIT 50
                    `;

                    const { results } = await env.DB.prepare(queryStr).all();

                    const users = results.map(row => {
                        let ip = "unknown";
                        let device = "unknown";
                        if (row.last_sync_delta) {
                            try {
                                const parsed = JSON.parse(row.last_sync_delta);
                                ip = parsed.ip || ip;
                                device = parsed.ua || device;
                            } catch (e) {}
                        }
                        return {
                            user_id: row.user_id,
                            email: `${row.username}@user.local`,
                            username: row.username,
                            bank_count: row.bank_count,
                            last_active_at: row.last_active_at,
                            last_ip: ip,
                            last_device: device
                        };
                    });

                    return jsonResponse({ ok: true, users, meta: { total: users.length, email_access: true } }, 200, headers);
                }

                // 2. CREATE USER
                if (action === "create-user" && request.method === "POST") {
                    const { email, password, username } = await request.json();
                    const rawUsername = (username || email || "").trim();
                    if (!rawUsername || !password) {
                        return jsonResponse({ error: "Username and password are required" }, 400, headers);
                    }

                    // Map email address
                    let queryName = rawUsername.toLowerCase();
                    if (queryName.includes("@")) {
                        queryName = queryName.split("@")[0];
                    }

                    const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ?")
                        .bind(queryName)
                        .first();
                    if (existing) {
                        return jsonResponse({ error: "Username already exists" }, 400, headers);
                    }

                    const newUserId = crypto.randomUUID();
                    const salt = generateSalt();
                    const passwordHash = await hashPassword(password, salt);

                    await env.DB.prepare("INSERT INTO users (id, username, password_hash, salt) VALUES (?, ?, ?, ?)")
                        .bind(newUserId, queryName, passwordHash, salt)
                        .run();

                    return jsonResponse({
                        ok: true,
                        user: {
                            id: newUserId,
                            email: `${queryName}@user.local`
                        }
                    }, 200, headers);
                }

                // 3. DELETE USERS
                if (action === "delete-users" && request.method === "POST") {
                    const { userIds } = await request.json();
                    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
                        return jsonResponse({ error: "userIds array is required" }, 400, headers);
                    }

                    const placeholders = userIds.map(() => "?").join(",");

                    // First, find all question_set IDs owned by these users
                    const { results: setRows } = await env.DB.prepare(
                        `SELECT id FROM question_sets WHERE user_id IN (${placeholders})`
                    ).bind(...userIds).all();
                    const setIds = setRows.map(r => r.id);

                    // D1 batch delete statements (cascade: questions → sets → logs → users)
                    const statements = [];
                    if (setIds.length > 0) {
                        const setPlaceholders = setIds.map(() => "?").join(",");
                        statements.push(
                            env.DB.prepare(`DELETE FROM questions WHERE question_set_id IN (${setPlaceholders})`).bind(...setIds)
                        );
                    }
                    statements.push(
                        env.DB.prepare(`DELETE FROM question_sets WHERE user_id IN (${placeholders})`).bind(...userIds),
                        env.DB.prepare(`DELETE FROM sync_logs WHERE user_id IN (${placeholders})`).bind(...userIds),
                        env.DB.prepare(`DELETE FROM users WHERE id IN (${placeholders})`).bind(...userIds)
                    );

                    await env.DB.batch(statements);

                    return jsonResponse({ ok: true, deletedCount: userIds.length }, 200, headers);
                }

                // 4. GLOBAL BROADCAST
                if (action === "push-broadcast" && request.method === "POST") {
                    const { target, userId: targetUserId, userIds, bankName, questions } = await request.json();
                    if (!questions || !Array.isArray(questions)) {
                        return jsonResponse({ error: "Invalid payload: questions array is required" }, 400, headers);
                    }

                    const safeName = bankName || 'Global Broadcast Bank';
                    let targetUserIds = [];

                    if (target === 'user') {
                        if (!targetUserId) return jsonResponse({ error: "UserId is required for target=user" }, 400, headers);
                        targetUserIds = [targetUserId];
                    } else if (target === 'multi') {
                        if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
                            return jsonResponse({ error: "UserIds array is required for target=multi" }, 400, headers);
                        }
                        targetUserIds = userIds;
                    } else if (target === 'all') {
                        const { results } = await env.DB.prepare("SELECT id FROM users").all();
                        targetUserIds = results.map(r => r.id);
                    } else {
                        return jsonResponse({ error: "Invalid target" }, 400, headers);
                    }

                    if (targetUserIds.length === 0) {
                        return jsonResponse({ ok: true, message: 'No users found to push to.' }, 200, headers);
                    }

                    let successCount = 0;
                    let failCount = 0;

                    for (const uid of targetUserIds) {
                        try {
                            const latestSet = await env.DB.prepare("SELECT id FROM question_sets WHERE user_id = ? ORDER BY id DESC LIMIT 1")
                                .bind(uid)
                                .first();

                            let setId;
                            if (latestSet) {
                                setId = latestSet.id;
                            } else {
                                const insertSet = await env.DB.prepare("INSERT INTO question_sets (user_id, name, state, version) VALUES (?, ?, ?, ?) RETURNING id")
                                    .bind(uid, safeName, JSON.stringify({ currentQuestionIndex: 0, answers: {} }), 1)
                                    .first();
                                setId = insertSet.id;
                            }

                            const statements = [];
                            for (const q of questions) {
                                if (!q.sub || q.sub.trim() === '' || q.sub.toLowerCase().includes('default')) {
                                    q.sub = safeName;
                                }
                                if (!q.chap || q.chap.trim() === '' || q.chap.toLowerCase().includes('chapter 1')) {
                                    q.chap = 'Imported';
                                }
                                if (!q.id) {
                                    q.id = crypto.randomUUID();
                                }
                                statements.push(
                                    env.DB.prepare("INSERT INTO questions (question_set_id, content) VALUES (?, ?)")
                                        .bind(setId, JSON.stringify(q))
                                );
                            }
                            statements.push(
                                env.DB.prepare("UPDATE question_sets SET version = version + 1 WHERE id = ?").bind(setId)
                            );

                            await env.DB.batch(statements);
                            successCount++;
                        } catch (e) {
                            console.error(`Failed to push to user ${uid}:`, e);
                            failCount++;
                        }
                    }

                    return jsonResponse({
                        ok: true,
                        summary: { target, total: targetUserIds.length, success: successCount, failed: failCount }
                    }, 200, headers);
                }

                // 5. SYSTEM LOGS
                if (action === "system-logs" && request.method === "GET") {
                    const { results } = await env.DB.prepare(`
                        SELECT 
                            s.id, 
                            u.username, 
                            s.delta, 
                            s.status, 
                            s.error, 
                            s.created_at 
                        FROM sync_logs s
                        JOIN users u ON s.user_id = u.id
                        ORDER BY s.id DESC 
                        LIMIT 100
                    `).all();

                    const logs = results.map(row => {
                        let parsedDelta = null;
                        if (row.delta) {
                            try { parsedDelta = JSON.parse(row.delta); } catch (e) {}
                        }
                        return {
                            ...row,
                            delta: parsedDelta
                        };
                    });

                    return jsonResponse({ ok: true, logs }, 200, headers);
                }

                // 6. GET USER BANK
                if (action === "users-get-bank" && request.method === "GET") {
                    const targetUid = url.searchParams.get("userId");
                    if (!targetUid) {
                        return jsonResponse({ error: "Missing userId parameter" }, 400, headers);
                    }

                    const set = await env.DB.prepare("SELECT id, name, version FROM question_sets WHERE user_id = ? LIMIT 1")
                        .bind(targetUid)
                        .first();

                    if (!set) {
                        return jsonResponse({ ok: true, name: "Empty Bank", questions: [] }, 200, headers);
                    }

                    const { results } = await env.DB.prepare("SELECT content FROM questions WHERE question_set_id = ?")
                        .bind(set.id)
                        .all();

                    const questions = results.map(row => {
                        try { return JSON.parse(row.content); } catch (e) { return null; }
                    }).filter(Boolean);

                    return jsonResponse({ ok: true, name: set.name, questions }, 200, headers);
                }

                // 7. USER SETS
                if (action === "users-sets" && request.method === "GET") {
                    const targetUid = url.searchParams.get("userId");
                    if (!targetUid) {
                        return jsonResponse({ error: "Missing userId parameter" }, 400, headers);
                    }

                    const { results } = await env.DB.prepare("SELECT id, name, version, created_at FROM question_sets WHERE user_id = ?")
                        .bind(targetUid)
                        .all();

                    return jsonResponse({ ok: true, sets: results }, 200, headers);
                }

                // 8. UPDATE USER BANK
                if (action === "users-update-bank" && request.method === "POST") {
                    const { userId: targetUid, setId, name, questions } = await request.json();
                    if (!targetUid || !setId || !name || !Array.isArray(questions)) {
                        return jsonResponse({ error: "Missing required parameters" }, 400, headers);
                    }

                    // Transaction replacement using D1 batch
                    const statements = [
                        env.DB.prepare("UPDATE question_sets SET name = ?, version = version + 1 WHERE id = ?").bind(name, setId),
                        env.DB.prepare("DELETE FROM questions WHERE question_set_id = ?").bind(setId)
                    ];

                    for (const q of questions) {
                        if (!q.id) q.id = crypto.randomUUID();
                        statements.push(
                            env.DB.prepare("INSERT INTO questions (question_set_id, content) VALUES (?, ?)")
                                .bind(setId, JSON.stringify(q))
                        );
                    }

                    await env.DB.batch(statements);

                    return jsonResponse({ ok: true }, 200, headers);
                }
            }

            return jsonResponse({ error: "Not Found" }, 404, headers);

        } catch (e) {
            console.error(e);
            return jsonResponse({ error: "Internal Server Error", detail: e.message }, 500, headers);
        }
    }
};
