/**
 * @file worker/index.js
 * @description Cloudflare Worker API for question-site (D1 Database + Native JWT Auth)
 */

// ==========================================
// 1. CORS Helpers
// ==========================================
const ALLOWED_ORIGINS = [
    'https://question-site-front.pages.dev',
    'https://question-site-mirror.pages.dev',
    'http://localhost:8788',
    'http://127.0.0.1:8788'
];

// 允许的来源后缀（Pages 的预览部署会带随机子域，例如 20c89728.xxx.pages.dev）
const ALLOWED_ORIGIN_SUFFIXES = [
    '.question-site-front.pages.dev',
    '.question-site-mirror.pages.dev'
];

// 支持 CORS_ORIGINS（逗号分隔多个）与旧的单值 CORS_ORIGIN，两者可共存
function parseConfiguredOrigins(env) {
    const raw = [env.CORS_ORIGINS, env.CORS_ORIGIN].filter(Boolean).join(',');
    return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function isOriginAllowed(origin, env) {
    if (!origin) return false;
    if (parseConfiguredOrigins(env).includes(origin)) return true;
    if (ALLOWED_ORIGINS.includes(origin)) return true;
    return ALLOWED_ORIGIN_SUFFIXES.some(suffix => origin.endsWith(suffix));
}

function corsHeaders(env, request) {
    const requestOrigin = request ? (request.headers.get('Origin') || '') : '';
    const headers = {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, If-None-Match',
        'Access-Control-Expose-Headers': 'ETag',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin'
    };
    if (isOriginAllowed(requestOrigin, env)) {
        headers['Access-Control-Allow-Origin'] = requestOrigin;
    } else if (!requestOrigin) {
        // 不带 Origin 的请求（同源调用、curl、服务端调用）不涉及 CORS，回 * 无风险
        headers['Access-Control-Allow-Origin'] = '*';
    }
    // 带 Origin 但不在白名单 → 不回 Access-Control-Allow-Origin，浏览器会按 CORS 规则拦截
    return headers;
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

// 安全读取 JSON 请求体：畸形 JSON 返回 null，由调用方转成 400（而不是冒泡成 500）
async function readJson(request) {
    try {
        const body = await request.json();
        return (body && typeof body === 'object' && !Array.isArray(body)) ? body : null;
    } catch (e) {
        return null;
    }
}

function badJson(headers) {
    return jsonResponse({ error: "请求体不是合法的 JSON 对象" }, 400, headers);
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
    if (!secret || secret.trim().length < 8) {
        console.error("Unconfigured or weak JWT_SECRET in getAuthUser.");
        return null;
    }
    return await verifyJwt(token, secret);
}

function verifyAdmin(user, env) {
    if (!user || !user.username) return false;
    // 只认 ADMIN_USERNAMES 白名单，不再信任 JWT 里签发时写入的 role。
    // 否则改了 ADMIN_USERNAMES 也无法撤销已签发 token 的管理员身份（最长 7 天）。
    const adminUsernames = (env.ADMIN_USERNAMES || "admin").split(",").map(name => name.trim().toLowerCase()).filter(Boolean);
    return adminUsernames.includes(String(user.username).toLowerCase());
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
                const secret = env.JWT_SECRET;
                if (!secret || secret.trim().length < 8) {
                    return jsonResponse({ error: "服务器配置错误: JWT密钥缺失或过短 (JWT Secret is unsafe or missing)" }, 500, headers);
                }
                const body = await readJson(request);
                if (!body) return badJson(headers);
                const { email, password, username } = body;
                const rawUsername = (username || email || "").trim();
                if (!rawUsername || !password) {
                    return jsonResponse({ error: "Username and password are required" }, 400, headers);
                }
                if (rawUsername.includes("@")) {
                    return jsonResponse({ error: "Username cannot contain '@'" }, 400, headers);
                }
                if (typeof password !== "string" || password.length < 6) {
                    return jsonResponse({ error: "密码至少需要 6 位 (Password must be at least 6 characters)" }, 400, headers);
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

                try {
                    await env.DB.prepare("INSERT INTO users (id, username, password_hash, salt) VALUES (?, ?, ?, ?)")
                        .bind(userId, rawUsername.toLowerCase(), passwordHash, salt)
                        .run();
                } catch (e) {
                    // UNIQUE 约束兜底：并发注册同名用户时给友好提示而不是 500
                    return jsonResponse({ error: "用户名已被注册" }, 400, headers);
                }

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
                const secret = env.JWT_SECRET;
                if (!secret || secret.trim().length < 8) {
                    return jsonResponse({ error: "服务器配置错误: JWT密钥缺失或过短 (JWT Secret is unsafe or missing)" }, 500, headers);
                }
                const body = await readJson(request);
                if (!body) return badJson(headers);
                const { email, username, password } = body;
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

            // 2.5 CHANGE PASSWORD（需验证原密码；旧 JWT 在有效期内仍可用，属无状态令牌的已知取舍）
            if (path === "/api/auth/change-password" && request.method === "POST") {
                const body = await readJson(request);
                if (!body) return badJson(headers);
                const oldPassword = typeof body.oldPassword === "string" ? body.oldPassword : "";
                const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
                if (!oldPassword || !newPassword) {
                    return jsonResponse({ error: "请填写原密码和新密码" }, 400, headers);
                }
                if (newPassword.length < 6) {
                    return jsonResponse({ error: "新密码至少需要 6 位" }, 400, headers);
                }
                if (newPassword === oldPassword) {
                    return jsonResponse({ error: "新密码不能与原密码相同" }, 400, headers);
                }
                const row = await env.DB.prepare("SELECT password_hash, salt FROM users WHERE id = ?")
                    .bind(userId)
                    .first();
                if (!row) {
                    return jsonResponse({ error: "账户不存在或已被删除" }, 401, headers);
                }
                const oldHash = await hashPassword(oldPassword, row.salt);
                if (oldHash !== row.password_hash) {
                    return jsonResponse({ error: "原密码不正确" }, 400, headers);
                }
                const newSalt = generateSalt();
                const newHash = await hashPassword(newPassword, newSalt);
                await env.DB.prepare("UPDATE users SET password_hash = ?, salt = ? WHERE id = ?")
                    .bind(newHash, newSalt, userId)
                    .run();
                return jsonResponse({ ok: true }, 200, headers);
            }

            // 2.6 账户存在性校验：管理员删除用户后，旧令牌仍有效（无状态 JWT），
            // 但必须阻止幽灵用户继续写库重建题集
            if (path.startsWith("/api/save-question-set")) {
                const stillExists = await env.DB.prepare("SELECT id FROM users WHERE id = ?")
                    .bind(userId)
                    .first();
                if (!stillExists) {
                    return jsonResponse({ error: "账户已被管理员删除" }, 401, headers);
                }
            }

            // 2.7 客户端错误上报：前端全局异常处理把未捕获错误 POST 到这里，
            // 存入 sync_logs（status=client-error），管理后台「系统日志」页可见
            if (path === "/api/client-errors" && request.method === "POST") {
                const body = await readJson(request);
                if (!body) return badJson(headers);
                const msg = typeof body.message === "string" ? body.message.slice(0, 300) : "unknown";
                const stack = typeof body.stack === "string" ? body.stack.slice(0, 500) : "";
                const page = typeof body.page === "string" ? body.page.slice(0, 200) : "";
                await env.DB.prepare("INSERT INTO sync_logs (user_id, delta, status, error) VALUES (?, ?, 'client-error', ?)")
                    .bind(userId, JSON.stringify({ page, stack, ua: request.headers.get("user-agent") || "" }), msg)
                    .run();
                return jsonResponse({ ok: true }, 200, headers);
            }

            // 2.8 忘记密码的运营兜底：管理员可直接重置任意用户的密码（自己除外）
            if (path === "/api/admin/reset-user-password" && request.method === "POST") {
                if (!verifyAdmin(user, env)) {
                    return jsonResponse({ error: "Forbidden: Admin access required" }, 403, headers);
                }
                const body = await readJson(request);
                if (!body) return badJson(headers);
                const targetUid = typeof body.userId === "string" ? body.userId : "";
                const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
                if (!targetUid || newPassword.length < 6) {
                    return jsonResponse({ error: "userId 与至少 6 位的新密码是必填的" }, 400, headers);
                }
                if (targetUid === userId) {
                    return jsonResponse({ error: "请使用「修改密码」功能修改自己的密码" }, 400, headers);
                }
                const target = await env.DB.prepare("SELECT id FROM users WHERE id = ?")
                    .bind(targetUid)
                    .first();
                if (!target) {
                    return jsonResponse({ error: "用户不存在" }, 404, headers);
                }
                const salt = generateSalt();
                const hash = await hashPassword(newPassword, salt);
                await env.DB.prepare("UPDATE users SET password_hash = ?, salt = ? WHERE id = ?")
                    .bind(hash, salt, targetUid)
                    .run();
                return jsonResponse({ ok: true }, 200, headers);
            }


            // 3. LOAD QUESTION SET
            if (path === "/api/load-question-set" && request.method === "GET") {
                const set = await env.DB.prepare("SELECT id, name, state, version FROM question_sets WHERE user_id = ? ORDER BY id DESC LIMIT 1")
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

                // questions 表是题目的唯一权威数据源（所有写入路径都会同步重建它）。
                // 旧版按「state.bank 与表的数量谁大」猜测哪份较新——管理端删题后旧 JSON 数量更多，
                // 会把已删除的题目复活。现在一律以表重建的 bank 为准。
                const historyAfter = parseInt(url.searchParams.get("historyAfter") || "0", 10);
                let historyPartial = false;
                let historyList = baseState && Array.isArray(baseState.history) ? baseState.history : [];
                if (historyAfter > 0) {
                    // 只要客户端带了增量游标，就必须标记为「增量」——
                    // 否则服务端 history 恰好为空时 historyPartial 会是 false，
                    // 客户端会走「整体替换」分支，把本地尚未上传的作答记录清掉。
                    // 游标语义：t >= historyAfter 全部下发（而非严格大于），同毫秒记录不漏；
                    // 客户端按稳定 rid 幂等去重，重复下发无害。
                    historyList = historyList.filter(h => (h.t || 0) >= historyAfter);
                    historyPartial = true;
                }

                const state = {
                    bank,
                    bankName: baseState && typeof baseState.bankName === "string" ? baseState.bankName : null,
                    history: historyList,
                    lastPracticeTime: baseState && typeof baseState.lastPracticeTime === "number" ? baseState.lastPracticeTime : null,
                    trash: baseState && typeof baseState.trash === "object" && !Array.isArray(baseState.trash) ? baseState.trash : {},
                    hiddenMistakeIds: baseState && Array.isArray(baseState.hiddenMistakeIds) ? baseState.hiddenMistakeIds : []
                };

                const responseBody = JSON.stringify({ ok: true, setId, name: set.name, state, version, historyPartial });
                
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
                const body = await readJson(request);
                if (!body) return badJson(headers);
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

                const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";
                const ua = request.headers.get("user-agent") || "unknown";
                const logDelta = delta ? { ...delta, ip, ua } : { ip, ua };

                // Get existing set
                const existing = await env.DB.prepare("SELECT id, version, state FROM question_sets WHERE user_id = ? ORDER BY id DESC LIMIT 1")
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
                        // 按 rid 幂等去重：请求已提交但响应丢失时客户端会重试，
                        // 同一条记录不能因为直接 concat 被追加多次（无 rid 的旧记录回退按 t 兜底）
                        const keyOf = (h) => (h && typeof h.rid === 'string' && h.rid) ? 'r:' + h.rid : 'k:' + ((h && h.id) || '') + '|' + (h && h.t);
                        const seenKeys = new Set((parsedState.history || []).map(keyOf));
                        const fresh = [];
                        for (const h of historyAppend) {
                            const k = keyOf(h);
                            if (seenKeys.has(k)) continue;
                            seenKeys.add(k);
                            fresh.push(h);
                        }
                        parsedState.history = parsedState.history.concat(fresh);
                        
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
                            // rid 优先去重（无 rid 旧记录回退按 t）：两台设备的不同记录
                            // 碰巧同一毫秒时，按 t 去重会把其中一条静默丢掉
                            const keyOf = (h) => (h && typeof h.rid === 'string' && h.rid) ? 'r:' + h.rid : 'k:' + ((h && h.id) || '') + '|' + (h && h.t);
                            const seenKeys = new Set(finalState.history.map(keyOf));
                            const newEntries = historyAppend.filter(h => !seenKeys.has(keyOf(h)));
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
                    // 分页：?page=1&pageSize=20（pageSize 上限 100）。之前写死 LIMIT 50，
                    // 用户一多后面的人永远看不到。
                    const urlObj = new URL(request.url);
                    const page = Math.max(1, parseInt(urlObj.searchParams.get("page") || "1", 10) || 1);
                    const pageSize = Math.min(100, Math.max(1, parseInt(urlObj.searchParams.get("pageSize") || "20", 10) || 20));

                    const searchQ = (urlObj.searchParams.get("q") || "").trim().toLowerCase();
                    const whereSql = searchQ ? "WHERE lower(u.username) LIKE ?" : "";

                    const countStmt = searchQ
                        ? env.DB.prepare("SELECT COUNT(*) AS c FROM users WHERE lower(username) LIKE ?").bind('%' + searchQ + '%')
                        : env.DB.prepare("SELECT COUNT(*) AS c FROM users");
                    const { results: countRows } = await countStmt.all();
                    const total = (countRows && countRows[0] && countRows[0].c) || 0;

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
                        ${whereSql}
                        ORDER BY last_active_at DESC
                        LIMIT ? OFFSET ?
                    `;

                    const stmtParams = searchQ ? ['%' + searchQ + '%', pageSize, (page - 1) * pageSize] : [pageSize, (page - 1) * pageSize];
                    const { results } = await env.DB.prepare(queryStr).bind(...stmtParams).all();

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

                    return jsonResponse({
                        ok: true,
                        users,
                        meta: {
                            total,
                            page,
                            pageSize,
                            pages: Math.max(1, Math.ceil(total / pageSize)),
                            email_access: true
                        }
                    }, 200, headers);
                }

                // 2. CREATE USER
                if (action === "create-user" && request.method === "POST") {
                    const body = await readJson(request);
                    if (!body) return badJson(headers);
                    const { email, password, username } = body;
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
                    const body = await readJson(request);
                    if (!body) return badJson(headers);
                    const { userIds } = body;
                    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
                        return jsonResponse({ error: "userIds array is required" }, 400, headers);
                    }
                    // 防止管理员误删自己（删掉后可能再没人能进管理后台）
                    if (userIds.includes(userId)) {
                        return jsonResponse({ error: "不能删除当前登录的管理员账号" }, 400, headers);
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
                    const body = await readJson(request);
                    if (!body) return badJson(headers);
                    const { target, userId: targetUserId, userIds, bankName, questions } = body;
                    if (!questions || !Array.isArray(questions) || questions.length === 0) {
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

                    // 目标去重（同一用户重复出现只处理一次）
                    targetUserIds = [...new Set(targetUserIds.map(String).filter(Boolean))];

                    if (targetUserIds.length === 0) {
                        return jsonResponse({ ok: true, message: 'No users found to push to.' }, 200, headers);
                    }

                    // 校验目标用户确实存在，避免创建挂在不存在的 user_id 上的孤儿题集
                    const existingUsers = new Set();
                    {
                        const { results } = await env.DB.prepare("SELECT id FROM users").all();
                        for (const r of results) existingUsers.add(String(r.id));
                    }
                    const missing = targetUserIds.filter(uid => !existingUsers.has(uid));
                    if (missing.length > 0) {
                        return jsonResponse({
                            error: `以下用户不存在，已中止：${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` 等共 ${missing.length} 个` : ''}`,
                            missingUserIds: missing
                        }, 400, headers);
                    }

                    // 规范化模板（只做一次）；每个用户基于它深拷贝，互不干扰
                    const template = questions.map(q => {
                        const copy = { ...q };
                        const sub = copy.sub == null ? '' : String(copy.sub);
                        const chap = copy.chap == null ? '' : String(copy.chap);
                        copy.sub = (!sub.trim() || sub.toLowerCase().includes('default')) ? safeName : sub;
                        copy.chap = (!chap.trim() || chap.toLowerCase().includes('chapter 1')) ? 'Imported' : chap;
                        return copy;
                    });

                    let successCount = 0;
                    let failCount = 0;
                    let skippedDuplicate = 0;

                    for (const uid of targetUserIds) {
                        try {
                            const latestSet = await env.DB.prepare("SELECT id, state, version FROM question_sets WHERE user_id = ? ORDER BY id DESC LIMIT 1")
                                .bind(uid)
                                .first();

                            let setId;
                            let setState = null;
                            let currentVersion = 0;
                            if (latestSet) {
                                setId = latestSet.id;
                                currentVersion = typeof latestSet.version === 'number' ? latestSet.version : 0;
                                if (latestSet.state) {
                                    try { setState = JSON.parse(latestSet.state); } catch (e) { setState = null; }
                                }
                            } else {
                                const insertSet = await env.DB.prepare("INSERT INTO question_sets (user_id, name, state, version) VALUES (?, ?, ?, ?) RETURNING id")
                                    .bind(uid, safeName, JSON.stringify({ bank: {}, history: [], trash: {} }), 0)
                                    .first();
                                setId = insertSet.id;
                            }
                            if (!setState || typeof setState !== 'object') setState = {};
                            if (!setState.bank || typeof setState.bank !== 'object') setState.bank = {};

                            // 该题集已有题目的指纹（用于去重，避免重复推送累积重复题）
                            const seen = new Set();
                            {
                                const { results: existingRows } = await env.DB.prepare("SELECT content FROM questions WHERE question_set_id = ?")
                                    .bind(setId).all();
                                for (const row of existingRows) {
                                    try {
                                        const q = JSON.parse(row.content);
                                        seen.add(JSON.stringify({ q: q.q, o: q.o, a: q.a, type: q.type, sub: q.sub, chap: q.chap }));
                                    } catch (e) { }
                                }
                            }

                            const statements = [];
                            let added = 0;
                            for (const t of template) {
                                // 关键：每个用户一份独立副本 + 独立 id（原来在循环里原地改 questions，导致跨用户复用同一个 id）
                                const q = { ...t, id: crypto.randomUUID() };
                                const fingerprint = JSON.stringify({ q: q.q, o: q.o, a: q.a, type: q.type, sub: q.sub, chap: q.chap });
                                if (seen.has(fingerprint)) { skippedDuplicate++; continue; }
                                seen.add(fingerprint);

                                statements.push(
                                    env.DB.prepare("INSERT INTO questions (question_set_id, content) VALUES (?, ?)")
                                        .bind(setId, JSON.stringify(q))
                                );
                                // 同步写入 state.bank，让两处表示保持一致（原来只改 questions 表，state 不动）
                                if (!setState.bank[q.sub]) setState.bank[q.sub] = {};
                                if (!Array.isArray(setState.bank[q.sub][q.chap])) setState.bank[q.sub][q.chap] = [];
                                setState.bank[q.sub][q.chap].push(q);
                                added++;
                            }

                            if (added === 0) { successCount++; continue; }   // 全是重复题，无需写库

                            statements.push(
                                env.DB.prepare("UPDATE question_sets SET state = ?, version = ? WHERE id = ?")
                                    .bind(JSON.stringify(setState), currentVersion + 1, setId)
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
                        summary: { target, total: targetUserIds.length, success: successCount, failed: failCount, skippedDuplicate }
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

                // 6. GET USER BANK —— 已移除。
                // 该端点从未被任何前端调用（admin.html 用的是 set-details，它同时返回
                // bank_info 与 questions）。留着只是一处需要维护的鉴权面，故删除。

                // 7. USER SETS
                if (action === "users-sets" && request.method === "GET") {
                    const targetUid = url.searchParams.get("userId");
                    if (!targetUid) {
                        return jsonResponse({ error: "Missing userId parameter" }, 400, headers);
                    }

                    const { results } = await env.DB.prepare(`
                        SELECT id, name, version, created_at,
                            (SELECT COUNT(*) FROM questions q WHERE q.question_set_id = question_sets.id) AS question_count
                        FROM question_sets WHERE user_id = ? ORDER BY id DESC
                    `).bind(targetUid).all();

                    return jsonResponse({ ok: true, sets: results }, 200, headers);
                }

                // 7.5 SET DETAILS (bank info + questions by setId, used by admin.html)
                if (action === "set-details" && request.method === "GET") {
                    const setId = url.searchParams.get("setId");
                    if (!setId) {
                        return jsonResponse({ error: "Missing setId parameter" }, 400, headers);
                    }

                    const set = await env.DB.prepare("SELECT id, user_id, name, version, created_at FROM question_sets WHERE id = ?")
                        .bind(setId)
                        .first();
                    if (!set) {
                        return jsonResponse({ error: "Set not found" }, 404, headers);
                    }

                    const { results } = await env.DB.prepare("SELECT content FROM questions WHERE question_set_id = ?")
                        .bind(set.id)
                        .all();
                    const questions = results.map(row => {
                        try { return JSON.parse(row.content); } catch (e) { return null; }
                    }).filter(Boolean);

                    return jsonResponse({
                        ok: true,
                        bank_info: { id: set.id, name: set.name, version: set.version, created_at: set.created_at },
                        user_id: set.user_id,
                        questions
                    }, 200, headers);
                }

                // 8. UPDATE USER BANK
                if (action === "users-update-bank" && request.method === "POST") {
                    const body = await readJson(request);
                    if (!body) return badJson(headers);
                    const { userId: targetUid, setId, name, questions } = body;
                    if (!targetUid || !setId || !name || !Array.isArray(questions)) {
                        return jsonResponse({ error: "Missing required parameters" }, 400, headers);
                    }

                    // 校验该 setId 确实属于 targetUid，避免越权改到别人的题集
                    const owned = await env.DB.prepare("SELECT id FROM question_sets WHERE id = ? AND user_id = ?")
                        .bind(setId, targetUid)
                        .first();
                    if (!owned) {
                        return jsonResponse({ error: "setId 不属于该用户" }, 400, headers);
                    }

                    // questions 表与 state.bank 双写（两处表示保持一致）：
                    // load 时以 questions 表为权威源重建 bank，若不同步 state.bank，
                    // 管理端的删改可能被旧 JSON 里的题目数量回退逻辑"复活"。
                    const newState = { bank: {}, history: [], trash: {}, hiddenMistakeIds: [] };
                    for (const q of questions) {
                        if (!q || typeof q !== 'object') continue;
                        if (!q.id) q.id = crypto.randomUUID();
                        const sub = (typeof q.sub === 'string' && q.sub) || '默认科目';
                        const chap = (typeof q.chap === 'string' && q.chap) || '默认章节';
                        if (!newState.bank[sub]) newState.bank[sub] = {};
                        if (!Array.isArray(newState.bank[sub][chap])) newState.bank[sub][chap] = [];
                        newState.bank[sub][chap].push(q);
                    }
                    // 保留既有 state 中的历史记录等元数据（题目内容以外的东西不能丢）
                    try {
                        const prev = await env.DB.prepare("SELECT state FROM question_sets WHERE id = ?").bind(setId).first();
                        if (prev && prev.state) {
                            const ps = JSON.parse(prev.state);
                            if (Array.isArray(ps.history)) newState.history = ps.history;
                            if (ps.trash && typeof ps.trash === 'object') newState.trash = ps.trash;
                            if (Array.isArray(ps.hiddenMistakeIds)) newState.hiddenMistakeIds = ps.hiddenMistakeIds;
                            if (typeof ps.lastPracticeTime === 'number') newState.lastPracticeTime = ps.lastPracticeTime;
                            if (typeof ps.bankName === 'string' && ps.bankName) newState.bankName = ps.bankName;
                        }
                    } catch (e) { }

                    // Transaction replacement using D1 batch
                    const statements = [
                        env.DB.prepare("UPDATE question_sets SET name = ?, state = ?, version = version + 1 WHERE id = ?").bind(name, JSON.stringify(newState), setId),
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
            return jsonResponse({ error: "Internal Server Error" }, 500, headers);
        }
    }
};
