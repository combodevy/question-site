const Ably = require('ably');
const { getUserFromRequest } = require('./_auth');

module.exports = async (req, res) => {
    const user = getUserFromRequest(req);
    if (!user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    const apiKey = process.env.ABLY_API_KEY || '';
    if (!apiKey) {
        res.status(500).json({ error: 'Missing ABLY_API_KEY' });
        return;
    }
    const clientId = user.sub || user.id || 'anonymous';
    const rest = new Ably.Rest(apiKey);
    try {
        const tokenRequest = await rest.auth.createTokenRequest({ clientId });
        res.status(200).json(tokenRequest);
    } catch (e) {
        res.status(500).json({ error: 'Ably token error' });
    }
};
