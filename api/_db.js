/**
 * @file _db.js
 * @description 数据库连接池模块 (Database Connection Pool Module)
 * @author Engineer
 * @date 2026-02-27
 * 
 * 职责：
 * 1. 管理 PostgreSQL 数据库连接池
 * 2. 提供统一的查询接口
 * 3. 复用连接以提高 Serverless 环境下的性能
 */

const { Pool } = require('pg');

let pool;

/**
 * 获取或创建数据库连接池单例
 * @returns {Pool} pg 连接池实例
 */
function getPool() {
    if (!pool) {
        // 使用环境变量中的连接字符串 (Transaction Mode)
        pool = new Pool({
            connectionString: process.env.SUPABASE_DB_URL
        });
    }
    return pool;
}

/**
 * 执行 SQL 查询
 * @param {string} text - SQL 语句
 * @param {Array} params - 参数数组
 * @returns {Promise<Object>} 查询结果
 */
async function query(text, params) {
    const p = getPool();
    return p.query(text, params);
}

module.exports = { query };
