/**
 * @file config.js
 * @description 前端全局配置文件 (Frontend Global Configuration)
 * @date 2026-07-05
 * 
 * 职责：定义后端 API 连接地址
 */

/**
 * @file config.js
 * @description 前端全局配置文件 (Frontend Global Configuration)
 *
 * 自适应部署支持：
 *   1. 自托管 / 反向代理部署（如 quiz.devy.cc.cd 或本地反代）：API 与页面同源，Nginx 转发 /api 至本地 8787；
 *   2. Cloudflare Pages 静态部署：回退到对应环境的 Cloudflare Worker API。
 */

// 默认 Cloudflare Worker API Base URL
const CLOUDFLARE_WORKER_API = "https://question-site-api.combodevy-9b0.workers.dev";

const isSelfHostedOrigin = typeof window !== 'undefined' && (
    window.location.hostname.endsWith('devy.cc.cd') ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
);

window.API_BASE = isSelfHostedOrigin ? window.location.origin : "https://question-site-api.combodevy-9b0.workers.dev";
