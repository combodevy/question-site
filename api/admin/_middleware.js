/**
 * @file api/admin/_middleware.js
 * @description 管理员权限验证中间件
 * @author Engineer
 * @date 2026-02-27
 */

const { getUserFromRequest } = require('../_auth');

/**
 * 验证请求者是否为管理员
 * @param {Object} req - HTTP 请求对象
 * @returns {Promise<Object|null>} 如果是管理员，返回用户信息；否则返回 null
 */
async function verifyAdmin(req) {
    const user = await getUserFromRequest(req);
    if (!user) return null;

    const userId = user.sub || user.id;
    
    // 从环境变量获取管理员 ID 列表 (逗号分隔)
    // 示例: ADMIN_USER_IDS="user_123,user_456"
    // 为了开发方便，如果未设置环境变量，暂时允许所有用户访问 (生产环境必须设置!)
    const adminIds = (process.env.ADMIN_USER_IDS || '').split(',').map(id => id.trim());
    
    // 安全策略：如果未配置 ADMIN_USER_IDS，则默认为不安全模式，仅供开发测试
    if (adminIds.length === 0 || (adminIds.length === 1 && adminIds[0] === '')) {
        console.warn('⚠️ WARNING: ADMIN_USER_IDS not set. Allowing access for development.');
        return user;
    }

    if (adminIds.includes(userId)) {
        return user;
    }

    return null;
}

module.exports = { verifyAdmin };