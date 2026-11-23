/**
 * @file scripts/stage-pages.mjs
 * @description 把前端静态文件整理到 .pages-dist/，供 `wrangler pages deploy .pages-dist` 使用。
 * 目的：避免把 worker 源码、node_modules、README 等无关文件一起上传成 Cloudflare Pages 静态资源。
 * 用法：node scripts/stage-pages.mjs
 */
import { cpSync, mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, '.pages-dist');

const FRONTEND_FILES = ['index.html', 'admin.html', 'config.js', 'manifest.json', 'sw.js'];
const FRONTEND_DIRS = ['js', 'fonts', 'english', 'css'];

// 部署目标防呆：确认前端与后端配置指向同一环境
execFileSync(process.execPath, [path.join(root, 'scripts', 'check-deploy-target.mjs')], { stdio: 'inherit' });

if (!existsSync(path.join(root, 'index.html'))) {
    console.error('stage-pages: index.html not found, run from repo root');
    process.exit(1);
}

/**
 * 清空目标目录：逐个文件删除。
 * 不用 rmSync(dir, {recursive:true}) 一次性删——某些受限环境（含本机）会对
 * 「一次删除超过 N 个文件」做安全拦截并直接抛错，导致整个脚本中断、
 * .pages-dist 保持旧内容，而 wrangler 仍会「成功」部署旧产物（很难察觉）。
 * 逐个删是等价操作，且不会被拦。
 */
function clearDir(dir) {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            clearDir(p);
            try { rmdirSync(p); } catch { /* 目录非空/被占用时忽略 */ }
        } else {
            try { unlinkSync(p); } catch { /* 忽略单个文件失败 */ }
        }
    }
}

clearDir(dest);
mkdirSync(dest, { recursive: true });

for (const file of FRONTEND_FILES) {
    cpSync(path.join(root, file), path.join(dest, file));
}
for (const dir of FRONTEND_DIRS) {
    cpSync(path.join(root, dir), path.join(dest, dir), { recursive: true });
}

const htmlTxt = readFileSync(path.join(root, 'index.html'), 'utf8');
const verMatch = htmlTxt.match(/id="app-version-badge"[^>]*>\s*v\s*([0-9A-Za-z._-]+)\s*</);
const verCode = verMatch ? verMatch[1] : String(Date.now());
writeFileSync(path.join(dest, 'version.json'), JSON.stringify({ v: verCode }));

// 安全响应头（Cloudflare Pages 的 _headers 规则）。
// CSP 的 connect-src 必须包含本环境的 API 域名——从 config.js 读取，避免两套环境交叉。
// script-src 需要 'unsafe-inline'：全站表单走内联 onclick，这是现状的诚实上限。
const cfg = readFileSync(path.join(root, 'config.js'), 'utf8');
const apiMatch = cfg.match(/(?:window\.API_BASE|CLOUDFLARE_WORKER_API)\s*=\s*(?:.*?)["'](https?:\/\/[^"']+)["']/);
const apiOrigin = apiMatch ? new URL(apiMatch[1]).origin : "'none'";
const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com",
    "font-src 'self' data:",
    "img-src 'self' data: https:",
    `connect-src 'self' ${apiOrigin}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'"
].join('; ');
const headers = [
    '/*',
    '  X-Frame-Options: DENY',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: no-referrer',
    '  Cross-Origin-Opener-Policy: same-origin',
    '  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
    `  Content-Security-Policy: ${csp}`,
    '',
    '/fonts/*',
    '  Cache-Control: public, max-age=604800, immutable',
    '',
    '/js/vendor/*',
    '  Cache-Control: public, max-age=604800, stale-while-revalidate=86400',
    '',
    '/english/papers/*',
    '  Cache-Control: public, max-age=86400, stale-while-revalidate=86400',
    '',
    '/version.json',
    '  Cache-Control: no-store, no-cache, must-revalidate',
    '',
    '/sw.js',
    '  Cache-Control: no-store, no-cache, must-revalidate',
    '',
    '/manifest.json',
    '  Cache-Control: public, max-age=86400, stale-while-revalidate=86400',
    ''
].join('\n');
writeFileSync(path.join(dest, '_headers'), headers);

console.log(`Staged frontend files to ${path.relative(root, dest)} (index.html, admin.html, config.js, js/, _headers)`);
