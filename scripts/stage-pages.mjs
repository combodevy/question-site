/**
 * @file scripts/stage-pages.mjs
 * @description 把前端静态文件整理到 .pages-dist/，供 `wrangler pages deploy .pages-dist` 使用。
 * 目的：避免把 worker 源码、node_modules、README 等无关文件一起上传成 Cloudflare Pages 静态资源。
 * 用法：node scripts/stage-pages.mjs
 */
import { cpSync, rmSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, '.pages-dist');

const FRONTEND_FILES = ['index.html', 'admin.html', 'config.js'];
const FRONTEND_DIRS = ['js'];

if (!existsSync(path.join(root, 'index.html'))) {
    console.error('stage-pages: index.html not found, run from repo root');
    process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

for (const file of FRONTEND_FILES) {
    cpSync(path.join(root, file), path.join(dest, file));
}
for (const dir of FRONTEND_DIRS) {
    cpSync(path.join(root, dir), path.join(dest, dir), { recursive: true });
}

writeFileSync(path.join(dest, 'version.json'), JSON.stringify({ v: Date.now() }));

console.log(`Staged frontend files to ${path.relative(root, dest)} (index.html, admin.html, config.js, js/)`);
