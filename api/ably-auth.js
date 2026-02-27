/**
 * @file ably-auth.js
 * @description Ably 实时通信鉴权接口 (Ably Auth API)
 * @author Engineer
 * @date 2026-02-27
 * 
 * 职责：
 * 1. 为前端客户端生成 Ably Token Request
 * 2. 确保只有经过身份验证的用户才能连接到 Ably 频道
 * 3. 绑定 User ID 到 Ably Client ID，实现点对点消息推送
 */

const Ably = require('ably');
const { getUserFromRequest } = require('./_auth');
const { handleCors } = require('./_cors');

module.exports = async (req, res) => {
    // 1. 处理跨域
    if (handleCors(req, res)) return;
    
    // 2. 身份验证
    const user = await getUserFromRequest(req);
    if (!user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    
    // 3. 检查环境变量配置
    const apiKey = process.env.ABLY_API_KEY || '';
    if (!apiKey) {
        console.error('Missing ABLY_API_KEY');
        res.status(500).json({ error: 'Missing ABLY_API_KEY' });
        return;
    }
    
    // 4. 生成 Token Request
    // 客户端使用此 Token 连接 Ably WebSocket，无需暴露 API Key
    const clientId = user.sub || user.id || 'anonymous';
    const rest = new Ably.Rest(apiKey);
    try {
        const tokenRequest = await rest.auth.createTokenRequest({ clientId });
        res.status(200).json(tokenRequest);
    } catch (e) {
        console.error('Ably token generation error:', e);
        res.status(500).json({ error: 'Ably token error' });
    }
};
