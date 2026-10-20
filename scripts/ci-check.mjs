/**
 * @file scripts/ci-check.mjs
 * @description CI 语法检查：对所有前端 ES 模块、仓库脚本与 Worker 入口做 node 语法校验。
 * 不引入任何依赖，CI 环境零安装即可运行。
 *
 * ★ 不用 `execFileSync(..., { input })`（管道传 stdin）：在 Windows 上会抛 EBUSY，
 *   导致整个检查在本地永远失败。改成写临时 .mjs 文件再 `--check`——
 *   后缀必须是 .mjs，否则会被当成 CJS 解析，`import` 直接报语法错。
 */
import { readdirSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const files = [];
for (const dir of ['js', 'js/views', 'scripts']) {
    for (const f of readdirSync(path.join(root, dir))) {
        if (f.endsWith('.js') || f.endsWith('.mjs')) files.push(path.join(dir, f));
    }
}
files.push('worker/index.js');

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'ci-check-'));
let failed = 0;
try {
    for (const rel of files) {
        const tmp = path.join(tmpDir, rel.replace(/[\\/]/g, '__').replace(/\.m?js$/, '') + '.mjs');
        try {
            writeFileSync(tmp, readFileSync(path.join(root, rel), 'utf8'));
            execFileSync(process.execPath, ['--check', tmp], { stdio: ['ignore', 'ignore', 'pipe'] });
            console.log('  ✓', rel);
        } catch (e) {
            console.error('  ✗', rel);
            console.error(String(e.stderr || e.message).slice(0, 500));
            failed++;
        }
    }
} finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
}

if (failed) {
    console.error(`\n${failed} file(s) failed syntax check`);
    process.exit(1);
}
console.log(`\nAll ${files.length} files passed syntax check`);
