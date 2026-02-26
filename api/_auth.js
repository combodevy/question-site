const jwt = require('jsonwebtoken');

function getUserFromRequest(req) {
    const authHeader = req.headers.authorization || req.headers.Authorization || '';
    if (!authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.slice(7).trim();
    if (!token) return null;
    const secret = process.env.SUPABASE_JWT_SECRET || '';
    if (!secret) return null;
    try {
        const decoded = jwt.verify(token, secret);
        return decoded || null;
    } catch (e) {
        return null;
    }
}

module.exports = { getUserFromRequest };
