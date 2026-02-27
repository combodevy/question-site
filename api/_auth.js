/**
 * @file _auth.js
 * @description 身份验证中间件模块 (Authentication Middleware Module)
 * @author Engineer
 * @date 2026-02-27
 * 
 * 职责：
 * 1. 解析请求头中的 Bearer Token
 * 2. 验证 JWT 令牌的有效性
 * 3. 支持使用 JWT Secret 本地验证 (Legacy)
 * 4. 支持使用 JWKS (JSON Web Key Set) 远程公钥验证 (Recommended for Supabase)
 */

const jwt = require('jsonwebtoken');
const { createRemoteJWKSet, jwtVerify } = require('jose');

// 缓存 JWKS 实例以避免重复请求
const jwksCache = new Map();

/**
 * 获取 JWKS 验证函数
 * @param {string} url - JWKS 端点 URL
 */
function getJwks(url) {
    if (!jwksCache.has(url)) {
        jwksCache.set(url, createRemoteJWKSet(new URL(url)));
    }
    return jwksCache.get(url);
}

/**
 * 使用远程 JWKS 公钥验证 Token
 * @param {string} token - JWT 字符串
 */
async function verifyWithJwks(token) {
    const supabaseUrl = process.env.SUPABASE_URL || '';
    if (!supabaseUrl) return null;
    const jwksUrl = `${supabaseUrl.replace(/\/+$/, '')}/auth/v1/.well-known/jwks.json`;
    try {
        const { payload } = await jwtVerify(token, getJwks(jwksUrl));
        return payload || null;
    } catch (e) {
        return null;
    }
}

/**
 * 从请求中提取并验证用户身份
 * @param {Object} req - HTTP 请求对象
 * @returns {Promise<Object|null>} 解码后的用户信息或 null
 */
async function getUserFromRequest(req) {
    const authHeader = req.headers.authorization || req.headers.Authorization || '';
    if (!authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.slice(7).trim();
    if (!token) return null;
    
    // 优先尝试使用 JWT Secret 进行快速本地验证
    const secret = process.env.SUPABASE_JWT_SECRET || '';
    if (secret) {
        try {
            const decoded = jwt.verify(token, secret);
            if (decoded) return decoded;
        } catch (e) {}
    }
    
    // 如果 Secret 验证失败 (可能是密钥轮换或非对称加密)，尝试 JWKS 验证
    return await verifyWithJwks(token);
}

module.exports = { getUserFromRequest };
