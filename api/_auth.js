const jwt = require('jsonwebtoken');
const { createRemoteJWKSet, jwtVerify } = require('jose');

const jwksCache = new Map();

function getJwks(url) {
    if (!jwksCache.has(url)) {
        jwksCache.set(url, createRemoteJWKSet(new URL(url)));
    }
    return jwksCache.get(url);
}

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

async function getUserFromRequest(req) {
    const authHeader = req.headers.authorization || req.headers.Authorization || '';
    if (!authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.slice(7).trim();
    if (!token) return null;
    const secret = process.env.SUPABASE_JWT_SECRET || '';
    if (secret) {
        try {
            const decoded = jwt.verify(token, secret);
            if (decoded) return decoded;
        } catch (e) {}
    }
    return await verifyWithJwks(token);
}

module.exports = { getUserFromRequest };
