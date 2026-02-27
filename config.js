/**
 * @file config.js
 * @description 前端全局配置文件 (Frontend Global Configuration)
 * @author Engineer
 * @date 2026-02-27
 * 
 * 职责：
 * 1. 定义 Supabase 和后端 API 的连接地址
 * 2. 区分开发环境和生产环境配置
 */

window.SUPABASE_URL = "https://ypklipqkngswhyifuoyx.supabase.co";
// Supabase Anon Key (Public) - 用于前端直接调用 Supabase Auth
window.SUPABASE_ANON_KEY = "sb_publishable_u7SRFFezpCGOl9czulWkrg_pPrVnSyh";
// Vercel Serverless Function Base URL
window.API_BASE = "https://question-site-lac.vercel.app";
