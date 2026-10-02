/**
 * @file scripts/ci-check.mjs
 * @description CI 语法检查：对所有前端 ES 模块与 Worker 入口做 node 语法校验。
 * 不引入任何依赖，CI 环境零安装即可运行。
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const files = [];
for (const dir of ['js', 'js/views']) {
    for (const f of readdirSync(path.join(root, dir))) {
        if (f.endsWith('.js')) files.push(path.join(dir, f));
    }
}
files.push('worker/index.js');

let failed = 0;
for (const rel of files) {
    try {
        execFileSync(process.execPath, ['--input-type=module', '--check'], {
            input: readFileSync(path.join(root, rel), 'utf8'),
            stdio: ['pipe', 'ignore', 'pipe']
        });
        console.log('  ✓', rel);
    } catch (e) {
        console.error('  ✗', rel);
        console.error(String(e.stderr || e.message).slice(0, 500));
        failed++;
    }
}

if (failed) {
    console.error(`\n${failed} file(s) failed syntax check`);
    process.exit(1);
}
console.log(`\nAll ${files.length} files passed syntax check`);
