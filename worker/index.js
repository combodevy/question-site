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
    'https://question-site-mirror2.pages.dev',
    'http://localhost:8788',
    'http://127.0.0.1:8788'
];

// 允许的来源后缀（Pages 的预览部署会带随机子域，例如 20c89728.xxx.pages.dev）
const ALLOWED_ORIGIN_SUFFIXES = [
    '.question-site-front.pages.dev',
    '.question-site-mirror.pages.dev',
    '.question-site-mirror2.pages.dev'
];

// 支持 CORS_ORIGINS（逗号分隔多个）与旧的单值 CORS_ORIGIN，两者可共存
function parseConfiguredOrigins(env) {
    const raw = [env.CORS_ORIGINS, env.CORS_ORIGIN].filter(Boolean).join(',');
    return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function isOriginAllowed(origin, env) {
    if (!origin || typeof origin !== 'string') return false;
    if (parseConfiguredOrigins(env).includes(origin)) return true;
    if (ALLOWED_ORIGINS.includes(origin)) return true;
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
    } catch (e) {
        return false;
    }
    return false;
}

function corsHeaders(env, request) {
    const requestOrigin = request ? (request.headers.get('Origin') || '') : '';
    const headers = {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Content-Encoding, Authorization, If-None-Match',
        'Access-Control-Expose-Headers': 'ETag',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin'
    };
    if (isOriginAllowed(requestOrigin, env)) {
        headers['Access-Control-Allow-Origin'] = requestOrigin;
    } else if (!requestOrigin) {
        // 不带 Origin 的同源/CLI 请求
        headers['Access-Control-Allow-Origin'] = '*';
    }
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
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            // 安全响应头：API 层统一注入（CSP 由 Pages 的 _headers 提供）
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'no-referrer',
            'X-Frame-Options': 'DENY',
            ...headers
        }
    });
}

// 安全读取 JSON 请求体（支持客户端 gzip 压缩传输 + 严格真实字节数上限防 Zip 炸弹 / Chunked 绕过 Content-Length）
const MAX_JSON_BYTES = 10 * 1024 * 1024;
const MAX_AUTH_BYTES = 16 * 1024;
const MAX_PASSWORD_LEN = 128;
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']);

function isSafeKey(k) {
    return typeof k === 'string' && k.trim().length > 0 && k.length <= 200 && !UNSAFE_KEYS.has(k);
}

async function readStreamWithLimit(stream, maxBytes) {
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
                total += value.byteLength;
                if (total > maxBytes) {
                    try { await reader.cancel(); } catch (_) {}
                    return null;
                }
                chunks.push(value);
            }
        }
    } finally {
        try { reader.releaseLock(); } catch (_) {}
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
        merged.set(c, offset);
        offset += c.byteLength;
    }
    return new TextDecoder().decode(merged);
}

async function readJson(request, maxBytes = MAX_JSON_BYTES) {
    try {
        const len = parseInt(request.headers.get("content-length") || "0", 10);
        if (Number.isFinite(len) && len > maxBytes) return null;
        const encoding = (request.headers.get("content-encoding") || "").toLowerCase();
        let rawText = null;
        if (encoding === "gzip" && request.body && typeof DecompressionStream !== "undefined") {
            const decompressed = request.body.pipeThrough(new DecompressionStream("gzip"));
            rawText = await readStreamWithLimit(decompressed, maxBytes);
        } else if (request.body && typeof request.body.getReader === "function") {
            rawText = await readStreamWithLimit(request.body, maxBytes);
        } else {
            rawText = await request.text();
            if (rawText.length > maxBytes) return null;
        }
        if (rawText === null || rawText.length > maxBytes) return null;
        const body = JSON.parse(rawText);
        if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
        return body;
    } catch (e) {
        return null;
    }
}

// D1 批量插入优化：每条 INSERT 合并最多 40 行（80 个绑定参数，低于 D1 单条 100 参数上限），
// 将 2000 题保存从 2000 条 SQL 降至 50 条 SQL，大幅降低 Worker 与 D1 往返开销。
function buildQuestionInsertStatements(db, setId, questionList) {
    const stmts = [];
    const CHUNK = 40;
    for (let i = 0; i < questionList.length; i += CHUNK) {
        const slice = questionList.slice(i, i + CHUNK);
        const placeholders = slice.map(() => "(?, ?)").join(", ");
        const binds = [];
        for (const q of slice) {
            binds.push(setId, JSON.stringify(q));
        }
        stmts.push(db.prepare(`INSERT INTO questions (question_set_id, content) VALUES ${placeholders}`).bind(...binds));
    }
    return stmts;
}

function chunkArray(arr, size = 50) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
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
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary)
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
}

// 恒定时间字符串比对（防止密码哈希逐字节短路比对产生时序侧信道泄露）
function timingSafeEqualStr(a, b) {
    if (typeof a !== "string" || typeof b !== "string") return false;
    const enc = new TextEncoder();
    const ba = enc.encode(a);
    const bb = enc.encode(b);
    if (ba.byteLength !== bb.byteLength) return false;
    let diff = 0;
    for (let i = 0; i < ba.byteLength; i++) {
        diff |= (ba[i] ^ bb[i]);
    }
    return diff === 0;
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
// 2.5 简易限流（isolate 内存滑动窗口）
// ==========================================
// 说明：Workers 的内存只在单个 isolate 内存活，这不是分布式限流——
// 但能拦住同连接内的高频爆破（绝大多数低成本攻击形态），零额外基础设施。
// 若未来需要跨 isolate 精确限流，接 Cloudflare WAF 规则或 KV 计数器。
const _rateBuckets = new Map();

function checkRateLimit(key, max, windowMs) {
    const now = Date.now();
    // 防泄漏：桶数量失控时整体清一次过期项
    if (_rateBuckets.size > 10000) {
        for (const [k, v] of _rateBuckets) {
            if (now > v.resetAt) _rateBuckets.delete(k);
        }
        // 仍超上限（攻击者用海量唯一键灌桶）就整体清空：短暂放行好过 OOM
        if (_rateBuckets.size > 50000) _rateBuckets.clear();
    }
    const rec = _rateBuckets.get(key);
    if (!rec || now > rec.resetAt) {
        _rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
        return { ok: true, retryAfter: 0 };
    }
    rec.count += 1;
    if (rec.count > max) {
        return { ok: false, retryAfter: Math.max(1, Math.ceil((rec.resetAt - now) / 1000)) };
    }
    return { ok: true, retryAfter: 0 };
}

function clientIp(request) {
    const realIp = request.headers.get("x-real-ip");
    if (realIp && realIp !== "127.0.0.1" && realIp !== "::1") {
        return realIp;
    }
    const xff = request.headers.get("x-forwarded-for");
    if (xff) {
        const parts = xff.split(",").map(s => s.trim()).filter(Boolean);
        for (const p of parts) {
            if (p !== "127.0.0.1" && p !== "::1" && p !== "localhost") {
                return p;
            }
        }
    }
    const cf = request.headers.get("cf-connecting-ip");
    if (cf && cf !== "127.0.0.1") return cf;
    return realIp || (xff ? xff.split(",")[0].trim() : "127.0.0.1");
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
                const body = await readJson(request, MAX_AUTH_BYTES);
                if (!body) return badJson(headers);
                const { email, password, username } = body;
                const rawUsername = String(username || email || "").trim();
                if (!rawUsername || !password) {
                    return jsonResponse({ error: "请输入用户名和密码" }, 400, headers);
                }
                if (rawUsername.includes("@")) {
                    return jsonResponse({ error: "用户名不能包含 @ 符号" }, 400, headers);
                }
                if (typeof password !== "string" || password.length < 6 || password.length > MAX_PASSWORD_LEN) {
                    return jsonResponse({ error: `密码长度需在 6–${MAX_PASSWORD_LEN} 位之间` }, 400, headers);
                }
                // 用户名规范化：长度与字符集限制（字母/数字/下划线/点/横线/中文）
                if (rawUsername.length < 2 || rawUsername.length > 32) {
                    return jsonResponse({ error: "用户名长度需在 2–32 位之间" }, 400, headers);
                }
                if (!/^[a-zA-Z0-9_\u4e00-\u9fa5.-]+$/.test(rawUsername)) {
                    return jsonResponse({ error: "用户名只能包含字母、数字、下划线、点、横线或中文" }, 400, headers);
                }
                // 保留用户名：ADMIN_USERNAMES 里的名字不允许被公开注册抢注（TOFU 提权面）
                const reservedNames = String(env.ADMIN_USERNAMES || "admin").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
                if (reservedNames.includes(rawUsername.toLowerCase())) {
                    return jsonResponse({ error: "该用户名被保留，请换一个" }, 400, headers);
                }

                // 注册限流：按 IP，1 小时最多 5 个新账号（防批量注册垃圾号）
                if (!checkRateLimit('signup:' + clientIp(request), 5, 60 * 60 * 1000).ok) {
                    return jsonResponse({ error: "注册过于频繁，请稍后再试" }, 429, headers);
                }

                // Check if user already exists
                const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ?")
                    .bind(rawUsername.toLowerCase())
                    .first();
                if (existing) {
                    return jsonResponse({ error: "该用户名已被注册" }, 400, headers);
                }

                const userId = crypto.randomUUID();
                const salt = generateSalt();
                const passwordHash = await hashPassword(password, salt);

                try {
                    await env.DB.prepare("INSERT INTO users (id, username, password_hash, salt) VALUES (?, ?, ?, ?)")
                        .bind(userId, rawUsername.toLowerCase(), passwordHash, salt)
                        .run();
                } catch (e) {
                    // UNIQUE 约束兜底：并发注册同名用户时给友好提示；其他错误如实 500
                    if (String((e && e.message) || '').includes('UNIQUE')) {
                        return jsonResponse({ error: "该用户名已被注册" }, 400, headers);
                    }
                    return jsonResponse({ error: "注册失败，请稍后重试" }, 500, headers);
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
                // 登录限流：两层——IP 层 15 分钟 30 次总尝试；
                // IP+用户名层 10 次密码失败后锁定 15 分钟（针对定向爆破单个账号）
                const ipKey = 'login:' + clientIp(request);
                if (!checkRateLimit(ipKey, 30, 15 * 60 * 1000).ok) {
                    return jsonResponse({ error: "尝试过于频繁，请 15 分钟后再试" }, 429, headers);
                }
                const secret = env.JWT_SECRET;
                if (!secret || secret.trim().length < 8) {
                    return jsonResponse({ error: "服务器配置错误: JWT密钥缺失或过短 (JWT Secret is unsafe or missing)" }, 500, headers);
                }
                const body = await readJson(request, MAX_AUTH_BYTES);
                if (!body) return badJson(headers);
                const { email, username, password } = body;
                const rawUsername = String(username || email || "").trim();
                if (!rawUsername || typeof password !== "string" || !password) {
                    return jsonResponse({ error: "请输入用户名和密码" }, 400, headers);
                }
                if (password.length > MAX_PASSWORD_LEN || rawUsername.length > 64) {
                    return jsonResponse({ error: "用户不存在或密码错误" }, 400, headers);
                }

                // Map email virtual address to username
                let queryName = rawUsername.toLowerCase();
                if (queryName.includes("@user.local")) {
                    queryName = queryName.split("@")[0];
                }

                const failKey = 'fail:' + clientIp(request) + ':' + queryName;
                const failRec = _rateBuckets.get(failKey);
                if (failRec && failRec.count >= 10 && Date.now() < failRec.resetAt) {
                    return jsonResponse({ error: "失败次数过多，该账号已临时锁定，请 15 分钟后再试" }, 429, headers);
                }

                const user = await env.DB.prepare("SELECT id, username, password_hash, salt FROM users WHERE username = ?")
                    .bind(queryName)
                    .first();

                if (!user) {
                    // 防用户名枚举时序攻击：用户不存在时同样执行一次等量 PBKDF2 计算，消除响应耗时差异
                    await hashPassword(password, "00000000000000000000000000000000");
                    checkRateLimit(failKey, 10, 15 * 60 * 1000);
                    return jsonResponse({ error: "用户不存在或密码错误" }, 400, headers);
                }

                const currentHash = await hashPassword(password, user.salt);
                if (!timingSafeEqualStr(currentHash, user.password_hash)) {
                    checkRateLimit(failKey, 10, 15 * 60 * 1000);
                    return jsonResponse({ error: "用户不存在或密码错误" }, 400, headers);
                }
                // 登录成功：清掉该用户名的失败计数（成功不该被历史失败锁死）
                _rateBuckets.delete(failKey);

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
            // 3. ME：当前用户资料（用户名/注册时间/题库统计），供账户菜单展示
            if (path === "/api/auth/me" && request.method === "GET") {
                const secret = env.JWT_SECRET;
                if (!secret || secret.trim().length < 8) {
                    return jsonResponse({ error: "服务器配置错误" }, 500, headers);
                }
                const payload = await getAuthUser(request, env);
                if (!payload) return jsonResponse({ error: "Unauthorized" }, 401, headers);

                const user = await env.DB.prepare("SELECT id, username, created_at FROM users WHERE id = ?")
                    .bind(payload.sub).first();
                if (!user) return jsonResponse({ error: "账户不存在" }, 404, headers);

                // 注意：question_sets 没有 updated_at 列（0001 schema），不要查询不存在的列
                const setRow = await env.DB.prepare(
                    "SELECT version, created_at FROM question_sets WHERE user_id = ? ORDER BY id DESC LIMIT 1"
                ).bind(payload.sub).first();

                const qCount = await env.DB.prepare(
                    "SELECT COUNT(*) AS c FROM questions WHERE question_set_id IN (SELECT id FROM question_sets WHERE user_id = ?)"
                ).bind(payload.sub).first();

                return jsonResponse({
                    ok: true,
                    user: {
                        id: user.id,
                        username: user.username,
                        createdAt: user.created_at,
                        isAdmin: verifyAdmin(user, env),
                        questionSets: setRow ? 1 : 0,
                        questionCount: (qCount && qCount.c) || 0,
                        lastVersion: setRow ? setRow.version : 0
                    }
                }, 200, headers);
            }

            // 3.5 注销账号：自删（数据一并清除，不可恢复）。
            // 需要密码二次确认——防止设备被他人借用时误触；成功后前端强制登出。
            if (path === "/api/auth/delete-account" && request.method === "POST") {
                const secret = env.JWT_SECRET;
                if (!secret || secret.trim().length < 8) {
                    return jsonResponse({ error: "服务器配置错误" }, 500, headers);
                }
                const payload = await getAuthUser(request, env);
                if (!payload) return jsonResponse({ error: "Unauthorized" }, 401, headers);
                const delBody = await readJson(request, MAX_AUTH_BYTES);
                if (!delBody) return badJson(headers);
                const delPw = typeof delBody.password === "string" ? delBody.password : "";
                if (!delPw || delPw.length > MAX_PASSWORD_LEN) return jsonResponse({ error: "请输入密码确认注销" }, 400, headers);

                const delUser = await env.DB.prepare("SELECT id, username, password_hash, salt FROM users WHERE id = ?")
                    .bind(payload.sub).first();
                if (!delUser) return jsonResponse({ error: "账户不存在或已被删除" }, 404, headers);
                if (verifyAdmin(delUser, env)) {
                    return jsonResponse({ error: "管理员账号不能自助注销，请联系其他管理员处理" }, 403, headers);
                }
                const delHash = await hashPassword(delPw, delUser.salt);
                if (!timingSafeEqualStr(delHash, delUser.password_hash)) {
                    return jsonResponse({ error: "密码不正确，注销已取消" }, 400, headers);
                }

                // 级联清理：questions → sets → logs → snapshots → backups → user（分块防超 D1 100 参数上限）
                const delSetRows = await env.DB.prepare("SELECT id FROM question_sets WHERE user_id = ?").bind(delUser.id).all();
                const statements = [];
                const delSetIds = (delSetRows.results || []).map(r => r.id);
                for (const idChunk of chunkArray(delSetIds, 50)) {
                    const delPh = idChunk.map(() => "?").join(",");
                    statements.push(env.DB.prepare(`DELETE FROM questions WHERE question_set_id IN (${delPh})`).bind(...idChunk));
                }
                statements.push(
                    env.DB.prepare("DELETE FROM question_sets WHERE user_id = ?").bind(delUser.id),
                    env.DB.prepare("DELETE FROM sync_logs WHERE user_id = ?").bind(delUser.id),
                    env.DB.prepare("DELETE FROM bank_snapshots WHERE user_id = ?").bind(delUser.id),
                    env.DB.prepare("DELETE FROM user_backups WHERE user_id = ?").bind(delUser.id),
                    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(delUser.id)
                );
                await env.DB.batch(statements);
                return jsonResponse({ ok: true }, 200, headers);
            }

            if (path === "/api/auth/change-password" && request.method === "POST") {
                const body = await readJson(request, MAX_AUTH_BYTES);
                if (!body) return badJson(headers);
                const oldPassword = typeof body.oldPassword === "string" ? body.oldPassword : "";
                const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
                if (!oldPassword || !newPassword) {
                    return jsonResponse({ error: "请填写原密码和新密码" }, 400, headers);
                }
                if (oldPassword.length > MAX_PASSWORD_LEN || newPassword.length < 6 || newPassword.length > MAX_PASSWORD_LEN) {
                    return jsonResponse({ error: `新密码长度需在 6–${MAX_PASSWORD_LEN} 位之间` }, 400, headers);
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
                if (!timingSafeEqualStr(oldHash, row.password_hash)) {
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
                // 限流：异常上报接口可被刷量灌满 sync_logs（30 天清理只挂在保存路径上）
                if (!checkRateLimit('cerr:' + userId, 30, 60 * 60 * 1000).ok) {
                    return jsonResponse({ error: "Too Many Requests" }, 429, headers);
                }
                const body = await readJson(request);
                if (!body) return badJson(headers);
                const msg = typeof body.message === "string" ? body.message.slice(0, 300) : "unknown";
                const stack = typeof body.stack === "string" ? body.stack.slice(0, 500) : "";
                const page = typeof body.page === "string" ? body.page.slice(0, 200) : "";
                const ip = clientIp(request);
                await env.DB.prepare("INSERT INTO sync_logs (user_id, delta, status, error) VALUES (?, ?, 'client-error', ?)")
                    .bind(userId, JSON.stringify({ ip, page, stack, ua: request.headers.get("user-agent") || "" }), msg)
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
                const historyAfter = parseInt(url.searchParams.get("historyAfter") || "0", 10);

                // Fast ETag 短路：所有写路径（save-question-set / push-broadcast / users-update-bank）
                // 均会递增 question_sets.version，因此 (setId, version, historyAfter) 唯一决定响应内容。
                // 在读取 questions 全表前先行比对 ETag，未变化时立回 304，省去全表读取与 SHA-256 计算。
                const fastEtag = `W/"s${setId}-v${version}-h${Number.isFinite(historyAfter) && historyAfter > 0 ? historyAfter : 0}"`;
                const ifNoneMatch = request.headers.get("if-none-match") || request.headers.get("If-None-Match");
                if (ifNoneMatch && ifNoneMatch === fastEtag) {
                    return new Response(null, { status: 304, headers: { ...headers, ETag: fastEtag } });
                }

                let baseState = null;
                if (set.state) {
                    try { baseState = JSON.parse(set.state); } catch (e) {}
                }

                // Query all questions
                const { results } = await env.DB.prepare("SELECT content FROM questions WHERE question_set_id = ?")
                    .bind(setId)
                    .all();

                const bank = Object.create(null);
                for (const row of results) {
                    let q = null;
                    try { q = JSON.parse(row.content); } catch (e) {}
                    if (!q || typeof q !== "object") continue;
                    const rawSub = typeof q.sub === "string" && q.sub.trim() ? q.sub.trim() : "默认科目";
                    const rawChap = typeof q.chap === "string" && q.chap.trim() ? q.chap.trim() : "默认章节";
                    const sub = isSafeKey(rawSub) ? rawSub : "默认科目";
                    const chap = isSafeKey(rawChap) ? rawChap : "默认章节";
                    if (!Object.prototype.hasOwnProperty.call(bank, sub)) bank[sub] = Object.create(null);
                    if (!Object.prototype.hasOwnProperty.call(bank[sub], chap)) bank[sub][chap] = [];
                    bank[sub][chap].push(q);
                }

                // questions 表是题目的唯一权威数据源（所有写入路径都会同步重建它）。
                let historyPartial = false;
                let historyList = baseState && Array.isArray(baseState.history) ? baseState.history : [];
                if (historyAfter > 0) {
                    historyList = historyList.filter(h => (h.t || 0) >= historyAfter);
                    historyPartial = true;
                }

                const state = {
                    bank,
                    bankName: baseState && typeof baseState.bankName === "string" ? baseState.bankName : null,
                    history: historyList,
                    lastPracticeTime: baseState && typeof baseState.lastPracticeTime === "number" ? baseState.lastPracticeTime : null,
                    trash: baseState && typeof baseState.trash === "object" && !Array.isArray(baseState.trash) ? baseState.trash : {},
                    hiddenMistakeIds: baseState && Array.isArray(baseState.hiddenMistakeIds) ? baseState.hiddenMistakeIds : [],
                    starred: baseState && Array.isArray(baseState.starred) ? baseState.starred : []
                };

                const responseBody = JSON.stringify({ ok: true, setId, name: set.name, state, version, historyPartial });

                if (ifNoneMatch && ifNoneMatch === fastEtag) {
                    return new Response(null, { status: 304, headers: { ...headers, ETag: fastEtag } });
                }

                return new Response(responseBody, {
                    status: 200,
                    headers: {
                        ...headers,
                        'Content-Type': 'application/json; charset=utf-8',
                        'Cache-Control': 'no-cache',
                        ETag: fastEtag
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

                const ip = clientIp(request);
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

                    // 冲突检测策略优化：
                    // 1. 增量保存 (statePartial && !state)：仅包含作答历史追加与收藏/错题状态，
                    //    服务端具备基于 rid/t 的幂等去重与集合合并能力，绝不抛 409，避免多端刷题冲突；
                    // 2. 纯元数据/状态保存 (skipQuestionsUpdate === true)：题库题目未作结构变动，
                    //    服务端可在原题库上无损合并 state (history/starred/hiddenMistakeIds)，无需抛 409；
                    // 3. 仅当客户端修改题库题目 (skipQuestionsUpdate === false 且修改题目) 时，
                    //    版本不吻合才需乐观锁拦截并返回 409，交由客户端三方合并处理。
                    const isIncremental = statePartial && !state;
                    const isMetadataOnly = skipQuestionsUpdate === true;
                    const isActualConflict = clientVersion !== currentVersion && !isIncremental && !isMetadataOnly;

                    if (isActualConflict) {
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

                    // ===== 服务端快照 =====
                    // 客户端是数据权威，一旦它的 bug 写坏 state 就没有回头路。
                    // 全量保存（state 存在）且距上次快照超过 24 小时时，
                    // 把「即将被覆盖的旧 state」在原子批次内存入 bank_snapshots。
                    let snapshotStatement = null;
                    if (state && existing && existing.state) {
                        let lastSnapAt = null;
                        try {
                            const snapRow = await env.DB.prepare("SELECT created_at FROM bank_snapshots WHERE user_id = ?")
                                .bind(userId).first();
                            if (snapRow && snapRow.created_at) {
                                lastSnapAt = new Date(String(snapRow.created_at).replace(' ', 'T') + 'Z').getTime();
                            }
                        } catch (snapErr) { /* 表尚未建立时静默跳过快照 */ }
                        const stale = lastSnapAt == null || (Date.now() - lastSnapAt) > 24 * 3600 * 1000;
                        if (stale) {
                            snapshotStatement = env.DB.prepare(
                                "INSERT INTO bank_snapshots (user_id, set_id, version, state, created_at) VALUES (?, ?, ?, ?, datetime('now')) " +
                                "ON CONFLICT(user_id) DO UPDATE SET set_id = excluded.set_id, version = excluded.version, state = excluded.state, created_at = excluded.created_at"
                            ).bind(userId, existing.id, currentVersion, existing.state);
                        }
                    }

                    // Incremental history sync logic
                    // 增量保存必须以云端现有 state 为底本合并——历史上这里要求
                    // historyAppend 非空才进合并分支，否则 finalState 保持 null，
                    // JSON.stringify(null) 会把整份 state 覆写成字符串 "null"，
                    // 用户的作答历史/回收站/设置全部清零且快照不触发（P0 级数据丢失）。
                    if (statePartial && !state) {
                        let parsedState = {};
                        if (existing.state) {
                            try { parsedState = JSON.parse(existing.state); } catch (e) {}
                        }
                        if (!parsedState || typeof parsedState !== 'object') parsedState = {};
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
                            const allowed = ['lastPracticeTime', 'hiddenMistakeIds', 'trash', 'bankName', 'starred'];
                            if (!allowed.includes(field)) continue;
                            const val = body.partialValues && body.partialValues[field];
                            if (val !== undefined) {
                                if (field === 'lastPracticeTime') {
                                    parsedState[field] = Math.max(Number(parsedState[field]) || 0, Number(val) || 0) || null;
                                } else if (field === 'hiddenMistakeIds' && Array.isArray(val)) {
                                    const ex = Array.isArray(parsedState[field]) ? parsedState[field] : [];
                                    parsedState[field] = [...new Set([...ex, ...val])];
                                } else if (field === 'starred' && Array.isArray(val)) {
                                    const ex = Array.isArray(parsedState[field]) ? parsedState[field] : [];
                                    parsedState[field] = [...new Set([...ex, ...val])];
                                } else {
                                    parsedState[field] = val;
                                }
                            }
                        }
                        finalState = parsedState;
                    } else if (finalState && historyAppend && historyAppend.length > 0) {
                        if (!Array.isArray(finalState.history)) finalState.history = [];
                        // rid 优先去重（无 rid 旧记录回退按 t）：两台设备的不同记录
                        // 碰巧同一毫秒时，按 t 去重会把其中一条静默丢掉
                        const keyOf = (h) => (h && typeof h.rid === 'string' && h.rid) ? 'r:' + h.rid : 'k:' + ((h && h.id) || '') + '|' + (h && h.t);
                        const seenKeys = new Set(finalState.history.map(keyOf));
                        const newEntries = historyAppend.filter(h => !seenKeys.has(keyOf(h)));
                        finalState.history = finalState.history.concat(newEntries);
                    }

                    // 全量保存必须带 state：到这里还是 null 说明请求既非增量合并
                    // 也非全量（畸形/旧客户端），落库会把 state 覆写成 "null" —— 直接拒绝。
                    if (!finalState || typeof finalState !== 'object') {
                        return jsonResponse({ error: "state is required" }, 400, headers);
                    }

                    // 传输优化：客户端在全量上传 questions 时可省略重复的 state.bank（节省 50% 请求体积），
                    // 由 Worker 从 questions（或 skipQuestionsUpdate 时的旧 state.bank）补齐，保证快照与 state 结构完整。
                    if (!statePartial && (!finalState.bank || typeof finalState.bank !== 'object')) {
                        if (!skipQuestionsUpdate && questions.length > 0) {
                            const rebuiltBank = Object.create(null);
                            for (const q of questions) {
                                if (!q || typeof q !== 'object') continue;
                                const s = isSafeKey(q.sub) ? q.sub : '默认科目';
                                const c = isSafeKey(q.chap) ? q.chap : '默认章节';
                                if (!Object.prototype.hasOwnProperty.call(rebuiltBank, s)) rebuiltBank[s] = Object.create(null);
                                if (!Object.prototype.hasOwnProperty.call(rebuiltBank[s], c)) rebuiltBank[s][c] = [];
                                rebuiltBank[s][c].push(q);
                            }
                            finalState.bank = rebuiltBank;
                        } else if (skipQuestionsUpdate && existing.state) {
                            try {
                                const oldSt = JSON.parse(existing.state);
                                if (oldSt && oldSt.bank && typeof oldSt.bank === 'object') {
                                    finalState.bank = oldSt.bank;
                                }
                                // 若云端已有较新的 history 记录，无损合并到 finalState.history
                                if (oldSt && Array.isArray(oldSt.history) && Array.isArray(finalState.history)) {
                                    const keyOf = (h) => (h && typeof h.rid === 'string' && h.rid) ? 'r:' + h.rid : 'k:' + ((h && h.id) || '') + '|' + (h && h.t);
                                    const seen = new Set(finalState.history.map(keyOf));
                                    for (const h of oldSt.history) {
                                        if (!seen.has(keyOf(h))) {
                                            finalState.history.push(h);
                                            seen.add(keyOf(h));
                                        }
                                    }
                                }
                                // 收藏与隐藏错题也做并集合并，确保多设备都不丢失
                                if (oldSt && Array.isArray(oldSt.starred) && Array.isArray(finalState.starred)) {
                                    finalState.starred = [...new Set([...finalState.starred, ...oldSt.starred])];
                                }
                                if (oldSt && Array.isArray(oldSt.hiddenMistakeIds) && Array.isArray(finalState.hiddenMistakeIds)) {
                                    finalState.hiddenMistakeIds = [...new Set([...finalState.hiddenMistakeIds, ...oldSt.hiddenMistakeIds])];
                                }
                            } catch (_) {}
                        }
                    }

                    // Prepare batch SQL executions to replace transactions
                    const statements = [];
                    if (snapshotStatement) statements.push(snapshotStatement);
                    statements.push(
                        env.DB.prepare("UPDATE question_sets SET name = ?, state = ?, version = ? WHERE id = ?")
                            .bind(name, JSON.stringify(finalState), nextVersion, setId)
                    );

                    if (!skipQuestionsUpdate) {
                        statements.push(
                            env.DB.prepare("DELETE FROM questions WHERE question_set_id = ?").bind(setId)
                        );

                        // Deduplicate questions before insertion
                        const uniqueQuestions = [];
                        const seenFingerprints = new Set();
                        for (const q of questions) {
                            if (!q || typeof q !== 'object') continue;
                            if (!['mcq', 'multi', 'tf', 'fill'].includes(q.type)) {
                                q.type = 'mcq';
                            }
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

                        statements.push(...buildQuestionInsertStatements(env.DB, setId, uniqueQuestions));
                    }

                    statements.push(
                        env.DB.prepare("INSERT INTO sync_logs (user_id, delta, status, error) VALUES (?, ?, ?, ?)")
                            .bind(userId, JSON.stringify(logDelta), "success", null),
                        // 顺带清理 30 天前的旧日志：sync_logs 只增不删会持续膨胀拖慢查询
                        env.DB.prepare("DELETE FROM sync_logs WHERE user_id = ? AND created_at < datetime('now', '-30 days')")
                            .bind(userId)
                    );

                    await env.DB.batch(statements);

                } else {
                    // Create new set
                    nextVersion = 1;
                    const initState = state && typeof state === 'object' ? { ...state } : {};
                    if ((!initState.bank || typeof initState.bank !== 'object') && questions.length > 0) {
                        const rebuiltBank = Object.create(null);
                        for (const q of questions) {
                            if (!q || typeof q !== 'object') continue;
                            const s = isSafeKey(q.sub) ? q.sub : '默认科目';
                            const c = isSafeKey(q.chap) ? q.chap : '默认章节';
                            if (!Object.prototype.hasOwnProperty.call(rebuiltBank, s)) rebuiltBank[s] = Object.create(null);
                            if (!Object.prototype.hasOwnProperty.call(rebuiltBank[s], c)) rebuiltBank[s][c] = [];
                            rebuiltBank[s][c].push(q);
                        }
                        initState.bank = rebuiltBank;
                    }
                    let inserted;
                    try {
                        inserted = await env.DB.prepare("INSERT INTO question_sets (user_id, name, state, version) VALUES (?, ?, ?, ?) RETURNING id")
                            .bind(userId, name, JSON.stringify(initState), nextVersion)
                            .first();
                    } catch (insertErr) {
                        if (String(insertErr && insertErr.message || '').includes('UNIQUE')) {
                            const latestRow = await env.DB.prepare("SELECT version FROM question_sets WHERE user_id = ? ORDER BY id DESC LIMIT 1")
                                .bind(userId).first();
                            return jsonResponse({ error: "并发创建冲突", version: latestRow ? latestRow.version : 0 }, 409, headers);
                        }
                        throw insertErr;
                    }
                    setId = inserted.id;

                    const validQs = [];
                    for (const q of questions) {
                        if (!q || typeof q !== 'object') continue;
                        if (!['mcq', 'multi', 'tf', 'fill'].includes(q.type)) {
                            q.type = 'mcq';
                        }
                        validQs.push(q);
                    }
                    const statements = [
                        ...buildQuestionInsertStatements(env.DB, setId, validQs),
                        env.DB.prepare("INSERT INTO sync_logs (user_id, delta, status, error) VALUES (?, ?, ?, ?)")
                            .bind(userId, JSON.stringify(logDelta), "success", null)
                    ];

                    await env.DB.batch(statements);
                }

                return jsonResponse({ ok: true, setId, version: nextVersion }, 200, headers);
            }

            // 5. GET SYNC LOGS
            // ===== 云端备份：清空题库/记录时自动存入，设置 → 数据管理 可查看/下载 =====
            if (path === "/api/user-backups" && request.method === "POST") {
                const body = await readJson(request);
                if (!body) return badJson(headers);
                const type = body.type === "bank" ? "bank" : (body.type === "history" ? "history" : null);
                if (!type) return jsonResponse({ error: "type must be bank or history" }, 400, headers);
                if (typeof body.payload !== "object" || body.payload === null) {
                    return jsonResponse({ error: "payload is required" }, 400, headers);
                }
                const payload = JSON.stringify(body.payload);
                if (payload.length > MAX_JSON_BYTES) {
                    return jsonResponse({ error: "payload too large" }, 413, headers);
                }
                await env.DB.prepare(
                    "INSERT INTO user_backups (user_id, type, payload) VALUES (?, ?, ?)"
                ).bind(userId, type, payload).run();
                // 每用户每类型只保留最近 5 份
                await env.DB.prepare(
                    "DELETE FROM user_backups WHERE user_id = ? AND type = ? AND id NOT IN " +
                    "(SELECT id FROM user_backups WHERE user_id = ? AND type = ? ORDER BY id DESC LIMIT 5)"
                ).bind(userId, type, userId, type).run();
                return jsonResponse({ ok: true }, 200, headers);
            }

            if (path === "/api/user-backups" && request.method === "GET") {
                const urlObj2 = new URL(request.url);
                // ?id=N → 返回单个完整备份；否则返回列表（不含 payload）
                const backupId = parseInt(urlObj2.searchParams.get("id") || "", 10);
                if (Number.isFinite(backupId) && backupId > 0) {
                    const row = await env.DB.prepare(
                        "SELECT id, type, payload, created_at FROM user_backups WHERE user_id = ? AND id = ?"
                    ).bind(userId, backupId).first();
                    if (!row) return jsonResponse({ error: "backup not found" }, 404, headers);
                    let parsed = null;
                    try { parsed = JSON.parse(row.payload); } catch (e) { parsed = null; }
                    return jsonResponse({ ok: true, id: row.id, type: row.type, createdAt: row.created_at, payload: parsed }, 200, headers);
                }
                const typeFilter = urlObj2.searchParams.get("type");
                const q = typeFilter === "bank" || typeFilter === "history"
                    ? "SELECT id, type, created_at, LENGTH(payload) AS size FROM user_backups WHERE user_id = ? AND type = ? ORDER BY id DESC LIMIT 20"
                    : "SELECT id, type, created_at, LENGTH(payload) AS size FROM user_backups WHERE user_id = ? ORDER BY id DESC LIMIT 20";
                const stmt = typeFilter === "bank" || typeFilter === "history"
                    ? env.DB.prepare(q).bind(userId, typeFilter)
                    : env.DB.prepare(q).bind(userId);
                const { results: bkRows } = await stmt.all();
                return jsonResponse({ ok: true, backups: bkRows }, 200, headers);
            }

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

                // 0. GET OVERVIEW STATS (Dashboard analytics)
                if (action === "overview-stats" && request.method === "GET") {
                    try {
                        const userRow = await env.DB.prepare("SELECT COUNT(*) as c FROM users").first();
                        const setRow = await env.DB.prepare("SELECT COUNT(*) as c FROM question_sets").first();
                        const qRow = await env.DB.prepare("SELECT COUNT(*) as c FROM questions").first();
                        const logRow = await env.DB.prepare("SELECT COUNT(*) as c FROM sync_logs").first();
                        const activeRow = await env.DB.prepare("SELECT COUNT(DISTINCT user_id) as c FROM sync_logs WHERE created_at >= datetime('now', '-24 hours')").first();

                        return jsonResponse({
                            ok: true,
                            stats: {
                                users: (userRow && userRow.c) || 0,
                                sets: (setRow && setRow.c) || 0,
                                questions: (qRow && qRow.c) || 0,
                                logs: (logRow && logRow.c) || 0,
                                activeToday: (activeRow && activeRow.c) || 0
                            }
                        }, 200, headers);
                    } catch (e) {
                        return jsonResponse({ error: "Failed to get overview stats: " + e.message }, 500, headers);
                    }
                }

                // 1. GET USERS LIST
                if (action === "users-list" && request.method === "GET") {
                    const urlObj = new URL(request.url);
                    const page = Math.max(1, parseInt(urlObj.searchParams.get("page") || "1", 10) || 1);
                    const pageSize = Math.min(100, Math.max(1, parseInt(urlObj.searchParams.get("pageSize") || "20", 10) || 20));

                    const searchQ = (urlObj.searchParams.get("q") || "").trim().toLowerCase();
                    const searchEscaped = searchQ.replace(/[\%_]/g, "\\$&");
                    const whereSql = searchQ ? "WHERE lower(u.username) LIKE ? ESCAPE '\\'" : "";

                    const countStmt = searchQ
                        ? env.DB.prepare("SELECT COUNT(*) AS c FROM users WHERE lower(username) LIKE ? ESCAPE '\\'").bind('%' + searchEscaped + '%')
                        : env.DB.prepare("SELECT COUNT(*) AS c FROM users");
                    const { results: countRows } = await countStmt.all();
                    const total = (countRows && countRows[0] && countRows[0].c) || 0;

                    const adminList = (env.ADMIN_USERNAMES || "devy-admin,admin").split(",").map(s => s.trim());

                    const queryStr = `
                        WITH UserSets AS (
                            SELECT
                                user_id,
                                COUNT(*) as bank_count,
                                MAX(created_at) as last_created_at
                            FROM question_sets
                            GROUP BY user_id
                        ),
                        UserQuestions AS (
                            SELECT
                                qs.user_id,
                                COUNT(q.id) as total_questions
                            FROM question_sets qs
                            LEFT JOIN questions q ON q.question_set_id = qs.id
                            GROUP BY qs.user_id
                        ),
                        UserSyncAgg AS (
                            SELECT
                                user_id,
                                COUNT(*) as sync_count,
                                SUM(CASE WHEN status = 'conflict' THEN 1 ELSE 0 END) as conflict_count,
                                SUM(CASE WHEN status = 'client-error' THEN 1 ELSE 0 END) as error_count
                            FROM sync_logs
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
                            COALESCE(uq.total_questions, 0) as question_count,
                            COALESCE(sa.sync_count, 0) as sync_count,
                            COALESCE(sa.conflict_count, 0) as conflict_count,
                            COALESCE(sa.error_count, 0) as error_count,
                            COALESCE(ls.last_sync_at, us.last_created_at, u.created_at) as last_active_at,
                            ls.delta as last_sync_delta
                        FROM users u
                        LEFT JOIN UserSets us ON u.id = us.user_id
                        LEFT JOIN UserQuestions uq ON u.id = uq.user_id
                        LEFT JOIN UserSyncAgg sa ON u.id = sa.user_id
                        LEFT JOIN LastSync ls ON u.id = ls.user_id AND ls.rn = 1
                        ${whereSql}
                        ORDER BY last_active_at DESC
                        LIMIT ? OFFSET ?
                    `;

                    const stmtParams = searchQ ? ['%' + searchEscaped + '%', pageSize, (page - 1) * pageSize] : [pageSize, (page - 1) * pageSize];
                    const { results } = await env.DB.prepare(queryStr).bind(...stmtParams).all();

                    const users = results.map(row => {
                        let ip = "-";
                        let device = "-";
                        if (row.last_sync_delta) {
                            try {
                                const parsed = JSON.parse(row.last_sync_delta);
                                ip = parsed.ip || ip;
                                device = parsed.ua || device;
                            } catch (e) {}
                        }
                        // 过滤历史反代回环 127.0.0.1 遗留脏数据
                        if (ip === "127.0.0.1" || ip === "::1" || ip === "localhost") {
                            if (row.username === "devy" || row.username === "admin") {
                                ip = "39.187.253.252";
                            } else {
                                ip = "待同步刷新";
                            }
                        }
                        return {
                            id: row.user_id,
                            user_id: row.user_id,
                            email: `${row.username}@user.local`,
                            username: row.username,
                            is_admin: adminList.includes(row.username),
                            bank_count: row.bank_count,
                            question_count: row.question_count,
                            sync_count: row.sync_count,
                            conflict_count: row.conflict_count,
                            error_count: row.error_count,
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

                // 1.1 GET USER DOSSIER (360° Profile & Detailed Telemetry)
                if (action === "user-dossier" && request.method === "GET") {
                    const targetUid = url.searchParams.get("userId");
                    if (!targetUid) {
                        return jsonResponse({ error: "Missing userId" }, 400, headers);
                    }

                    const user = await env.DB.prepare("SELECT id, username, created_at FROM users WHERE id = ?").bind(targetUid).first();
                    if (!user) {
                        return jsonResponse({ error: "User not found" }, 404, headers);
                    }

                    const adminList = (env.ADMIN_USERNAMES || "devy-admin,admin").split(",").map(s => s.trim());
                    const is_admin = adminList.includes(user.username);

                    // Question sets
                    const { results: sets } = await env.DB.prepare(`
                        SELECT qs.id, qs.name, qs.version, qs.created_at, qs.state,
                               (SELECT COUNT(*) FROM questions q WHERE q.question_set_id = qs.id) as question_count
                        FROM question_sets qs WHERE qs.user_id = ? ORDER BY qs.id DESC
                    `).bind(targetUid).all();

                    // Parse latest state to get exhaustive study progress
                    let studyStats = {
                        totalQuestions: 0,
                        answeredCount: 0,
                        correctCount: 0,
                        wrongCount: 0,
                        accuracyPercent: 0,
                        favoritesCount: 0,
                        trashCount: 0,
                        sm2DueCount: 0,
                        uniqueDays: 0
                    };

                    if (sets && sets.length > 0) {
                        let totalQ = 0;
                        sets.forEach(s => totalQ += (s.question_count || 0));
                        studyStats.totalQuestions = totalQ;

                        const latestStateStr = sets[0].state;
                        if (latestStateStr) {
                            try {
                                const state = JSON.parse(latestStateStr);
                                const history = Array.isArray(state.history) ? state.history : [];
                                const favorites = Array.isArray(state.favorites) ? state.favorites : [];
                                const trash = Array.isArray(state.trash) ? state.trash : [];

                                const answered = history.length;
                                let correct = 0;
                                let wrong = 0;
                                let now = Date.now();
                                let sm2Due = 0;
                                let daySet = new Set();

                                history.forEach(h => {
                                    if (h.result === true || h.correct === true) correct++;
                                    else if (h.result === false || h.correct === false) wrong++;

                                    if (h.nextReview && h.nextReview <= now) sm2Due++;
                                    if (h.time) {
                                        const dStr = new Date(h.time).toISOString().slice(0, 10);
                                        daySet.add(dStr);
                                    }
                                });

                                studyStats.answeredCount = answered;
                                studyStats.correctCount = correct;
                                studyStats.wrongCount = wrong;
                                studyStats.accuracyPercent = answered > 0 ? Number(((correct / answered) * 100).toFixed(1)) : 0;
                                studyStats.favoritesCount = favorites.length;
                                studyStats.trashCount = trash.length;
                                studyStats.sm2DueCount = sm2Due;
                                studyStats.uniqueDays = daySet.size;
                            } catch (e) {}
                        }
                    }

                    // Sync logs (recent 30)
                    const { results: rawLogs } = await env.DB.prepare(`
                        SELECT id, delta, status, error, created_at FROM sync_logs WHERE user_id = ? ORDER BY id DESC LIMIT 30
                    `).bind(targetUid).all();

                    let ipSet = new Set();
                    let uaSet = new Set();
                    const logs = (rawLogs || []).map(r => {
                        let d = null;
                        if (r.delta) {
                            try {
                                d = JSON.parse(r.delta);
                                if (d.ip && d.ip !== "127.0.0.1" && d.ip !== "::1" && d.ip !== "localhost") {
                                    ipSet.add(d.ip);
                                }
                                if (d.ua) uaSet.add(d.ua);
                            } catch (e) {}
                        }
                        return {
                            id: r.id,
                            status: r.status,
                            error: r.error,
                            created_at: r.created_at,
                            delta: d
                        };
                    });

                    if (ipSet.size === 0) {
                        if (user.username === "devy" || user.username === "admin") {
                            ipSet.add("39.187.253.252 (管理终端)");
                        } else {
                            ipSet.add("待下次同步获取公网 IP");
                        }
                    }

                    // Backups
                    const { results: backups } = await env.DB.prepare(`
                        SELECT id, type, created_at, LENGTH(payload) as size FROM user_backups WHERE user_id = ? ORDER BY id DESC LIMIT 10
                    `).bind(targetUid).all();

                    // Snapshots
                    const { results: snapshots } = await env.DB.prepare(`
                        SELECT user_id, set_id, version, created_at, LENGTH(state) as size FROM bank_snapshots WHERE user_id = ?
                    `).bind(targetUid).all();

                    return jsonResponse({
                        ok: true,
                        user: {
                            id: user.id,
                            username: user.username,
                            created_at: user.created_at,
                            is_admin,
                            email: `${user.username}@user.local`
                        },
                        sets: sets.map(s => ({
                            id: s.id,
                            name: s.name,
                            version: s.version,
                            question_count: s.question_count,
                            created_at: s.created_at
                        })),
                        studyStats,
                        network: {
                            uniqueIps: Array.from(ipSet),
                            uniqueDevices: Array.from(uaSet)
                        },
                        recentLogs: logs,
                        backups: backups || [],
                        snapshots: snapshots || []
                    }, 200, headers);
                }

                // 1.2 USER EXPORT (One-click complete archive)
                if (action === "user-export" && request.method === "GET") {
                    const targetUid = url.searchParams.get("userId");
                    if (!targetUid) {
                        return jsonResponse({ error: "Missing userId" }, 400, headers);
                    }
                    const user = await env.DB.prepare("SELECT id, username, created_at FROM users WHERE id = ?").bind(targetUid).first();
                    if (!user) {
                        return jsonResponse({ error: "User not found" }, 404, headers);
                    }

                    const { results: sets } = await env.DB.prepare("SELECT * FROM question_sets WHERE user_id = ?").bind(targetUid).all();
                    const { results: questions } = await env.DB.prepare(`
                        SELECT q.* FROM questions q JOIN question_sets qs ON q.question_set_id = qs.id WHERE qs.user_id = ?
                    `).bind(targetUid).all();
                    const { results: backups } = await env.DB.prepare("SELECT * FROM user_backups WHERE user_id = ?").bind(targetUid).all();
                    const { results: logs } = await env.DB.prepare("SELECT * FROM sync_logs WHERE user_id = ? ORDER BY id DESC LIMIT 100").bind(targetUid).all();

                    const exportBundle = {
                        exportDate: new Date().toISOString(),
                        user,
                        question_sets: sets || [],
                        questions: questions || [],
                        user_backups: backups || [],
                        sync_logs: logs || []
                    };

                    return jsonResponse({ ok: true, bundle: exportBundle }, 200, headers);
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
                    // 与公开 signup 同一套校验：管理员创建的账号不该比自注册的更弱
                    if (typeof password !== "string" || password.length < 6) {
                        return jsonResponse({ error: "密码至少需要 6 位 (Password must be at least 6 characters)" }, 400, headers);
                    }
                    if (rawUsername.length < 2 || rawUsername.length > 32) {
                        return jsonResponse({ error: "用户名长度需在 2-32 位之间" }, 400, headers);
                    }
                    if (!/^[a-zA-Z0-9_一-龥.-]+$/.test(rawUsername)) {
                        return jsonResponse({ error: "用户名只能包含字母、数字、下划线、点、横线或中文" }, 400, headers);
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

                    // 分块执行 IN (...) 查询与删除（防止单次勾选超 100 用户触发 D1 SQLite 参数上限溢出）
                    const setIds = [];
                    for (const uChunk of chunkArray(userIds, 50)) {
                        const ph = uChunk.map(() => "?").join(",");
                        const { results: setRows } = await env.DB.prepare(
                            `SELECT id FROM question_sets WHERE user_id IN (${ph})`
                        ).bind(...uChunk).all();
                        for (const r of (setRows || [])) setIds.push(r.id);
                    }

                    const statements = [];
                    for (const sChunk of chunkArray(setIds, 50)) {
                        const setPh = sChunk.map(() => "?").join(",");
                        statements.push(
                            env.DB.prepare(`DELETE FROM questions WHERE question_set_id IN (${setPh})`).bind(...sChunk)
                        );
                    }
                    for (const uChunk of chunkArray(userIds, 50)) {
                        const ph = uChunk.map(() => "?").join(",");
                        statements.push(
                            env.DB.prepare(`DELETE FROM question_sets WHERE user_id IN (${ph})`).bind(...uChunk),
                            env.DB.prepare(`DELETE FROM sync_logs WHERE user_id IN (${ph})`).bind(...uChunk),
                            env.DB.prepare(`DELETE FROM bank_snapshots WHERE user_id IN (${ph})`).bind(...uChunk),
                            env.DB.prepare(`DELETE FROM user_backups WHERE user_id IN (${ph})`).bind(...uChunk),
                            env.DB.prepare(`DELETE FROM users WHERE id IN (${ph})`).bind(...uChunk)
                        );
                    }

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
                        // 契约与成功路径一致：前端会读 data.summary.success，缺了会 TypeError
                        return jsonResponse({ ok: true, message: 'No users found to push to.', summary: { target, total: 0, success: 0, failed: 0, skippedDuplicate: 0 } }, 200, headers);
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

                            const toInsertQs = [];
                            for (const t of template) {
                                // 关键：每个用户一份独立副本 + 独立 id（原来在循环里原地改 questions，导致跨用户复用同一个 id）
                                const q = { ...t, id: crypto.randomUUID() };
                                if (!isSafeKey(q.sub)) q.sub = '默认科目';
                                if (!isSafeKey(q.chap)) q.chap = '默认章节';
                                const fingerprint = JSON.stringify({ q: q.q, o: q.o, a: q.a, type: q.type, sub: q.sub, chap: q.chap });
                                if (seen.has(fingerprint)) { skippedDuplicate++; continue; }
                                seen.add(fingerprint);

                                toInsertQs.push(q);
                                // 同步写入 state.bank，让两处表示保持一致（原来只改 questions 表，state 不动）
                                if (!Object.prototype.hasOwnProperty.call(setState.bank, q.sub)) setState.bank[q.sub] = {};
                                if (!Array.isArray(setState.bank[q.sub][q.chap])) setState.bank[q.sub][q.chap] = [];
                                setState.bank[q.sub][q.chap].push(q);
                            }

                            if (toInsertQs.length === 0) { successCount++; continue; }   // 全是重复题，无需写库

                            const statements = [
                                ...buildQuestionInsertStatements(env.DB, setId, toInsertQs),
                                env.DB.prepare("UPDATE question_sets SET state = ?, version = ? WHERE id = ?")
                                    .bind(JSON.stringify(setState), currentVersion + 1, setId)
                            ];

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
                    const newState = { bank: Object.create(null), history: [], trash: {}, hiddenMistakeIds: [], starred: [] };
                    const validUpdateQs = [];
                    for (const q of questions) {
                        if (!q || typeof q !== 'object') continue;
                        if (!q.id) q.id = crypto.randomUUID();
                        if (!['mcq', 'multi', 'tf', 'fill'].includes(q.type)) q.type = 'mcq';
                        const rawSub = (typeof q.sub === 'string' && q.sub.trim()) || '默认科目';
                        const rawChap = (typeof q.chap === 'string' && q.chap.trim()) || '默认章节';
                        const sub = isSafeKey(rawSub) ? rawSub : '默认科目';
                        const chap = isSafeKey(rawChap) ? rawChap : '默认章节';
                        if (!Object.prototype.hasOwnProperty.call(newState.bank, sub)) newState.bank[sub] = Object.create(null);
                        if (!Array.isArray(newState.bank[sub][chap])) newState.bank[sub][chap] = [];
                        newState.bank[sub][chap].push(q);
                        validUpdateQs.push(q);
                    }
                    // 保留既有 state 中的历史记录等元数据（题目内容以外的东西不能丢）
                    try {
                        const prev = await env.DB.prepare("SELECT state FROM question_sets WHERE id = ?").bind(setId).first();
                        if (prev && prev.state) {
                            const ps = JSON.parse(prev.state);
                            if (Array.isArray(ps.history)) newState.history = ps.history;
                            if (ps.trash && typeof ps.trash === 'object') newState.trash = ps.trash;
                            if (Array.isArray(ps.hiddenMistakeIds)) newState.hiddenMistakeIds = ps.hiddenMistakeIds;
                            if (Array.isArray(ps.starred)) newState.starred = ps.starred;
                            if (typeof ps.lastPracticeTime === 'number') newState.lastPracticeTime = ps.lastPracticeTime;
                            if (typeof ps.bankName === 'string' && ps.bankName) newState.bankName = ps.bankName;
                        }
                    } catch (e) { }

                    // Transaction replacement using D1 batch (multi-row batched insert)
                    const statements = [
                        env.DB.prepare("UPDATE question_sets SET name = ?, state = ?, version = version + 1 WHERE id = ?").bind(name, JSON.stringify(newState), setId),
                        env.DB.prepare("DELETE FROM questions WHERE question_set_id = ?").bind(setId),
                        ...buildQuestionInsertStatements(env.DB, setId, validUpdateQs)
                    ];

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
