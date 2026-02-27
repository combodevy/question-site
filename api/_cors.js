/**
 * @file _cors.js
 * @description 跨域资源共享 (CORS) 处理模块 (CORS Handling Module)
 * @author Engineer
 * @date 2026-02-27
 * 
 * 职责：
 * 1. 设置 Access-Control-Allow-Origin 等响应头，允许前端跨域访问
 * 2. 处理 OPTIONS 预检请求 (Preflight Requests)
 * 3. 统一管理跨域策略，避免在每个 API 中重复编写
 */

function handleCors(req, res) {
    const origin = process.env.CORS_ORIGIN || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return true;
    }
    return false;
}

module.exports = { handleCors };
