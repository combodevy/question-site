/**
 * @file scripts/check-dom-contract.mjs
 * @description 「UI 与代码的契约」检查（CI 用）——专治「点了没反应 / 样式静默失效」。
 *
 * 为什么需要它：下面这些问题都不会报错，只会静默失效，靠肉眼很难发现——
 *   · 账户菜单的动作项被整段删掉，而 handleAccountMenuAction 还在等这些 data-act
 *     （用户从此找不到「退出登录」）
 *   · JS 里 getElementById('am-trash-count')，HTML 里压根没有这个元素
 *   · CSS 用了 17 处 var(--bg-hover)，但 :root 里从没定义过 → 整条 background 声明失效
 *
 * 检查项：
 *   1. HTML 里每个 data-act 都必须在 js/ 里存在对应分支
 *   2. JS 引用的元素 id 必须能在 HTML 或 JS 模板里找到定义
 *   3. 用到的 CSS 变量必须有定义
 *   4. inline onclick 引用的 App.x.y 必须能在 js/ 里找到定义
 *
 * 用法：node scripts/check-dom-contract.mjs
 * 有违反则退出码 1。
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const HTMLS = ['index.html', 'admin.html'];
const JS_FILES = [];
for (const dir of ['js', 'js/views']) {
    for (const f of readdirSync(path.join(ROOT, dir))) {
        if (f.endsWith('.js')) JS_FILES.push(path.join(dir, f));
    }
}
const html = Object.fromEntries(HTMLS.map((f) => [f, read(f)]));
const js = Object.fromEntries(JS_FILES.map((f) => [f, read(f)]));
const jsAll = Object.values(js).join('\n');
const htmlAll = Object.values(html).join('\n');

const problems = [];

/* ---------- 1. data-act 契约 ---------- */
const acts = new Set();
for (const f of HTMLS) {
    for (const m of html[f].matchAll(/data-act="([^"]+)"/g)) acts.add(m[1]);
}
const actBranches = new Set();
for (const m of jsAll.matchAll(/act\s*===\s*'([^']+)'/g)) actBranches.add(m[1]);
// 也支持 data-act 通用分发（如题库管理的 data-action）
const genericDispatch = /dataset\.act|\.dataset\.act/.test(jsAll);
for (const a of acts) {
    if (!actBranches.has(a)) problems.push(`data-act="${a}" 在 js/ 里找不到对应分支（点了会没反应）`);
}

// ★ 反方向才是真正踩过的坑：handleAccountMenuAction 有 10 个分支，但菜单里只剩 1 个条目
//   （用户从此找不到「退出登录」）。所以「代码支持的动作」必须都能在 UI 上找到入口。
{
    const body = jsAll.slice(jsAll.indexOf('handleAccountMenuAction(act)'));
    const handled = new Set([...body.slice(0, 2000).matchAll(/act\s*===\s*'([^']+)'/g)].map((m) => m[1]));
    const inMenu = new Set();
    for (const m of htmlAll.matchAll(/data-act="([^"]+)"/g)) inMenu.add(m[1]);
    for (const a of handled) {
        if (!inMenu.has(a)) problems.push(`handleAccountMenuAction 支持 act="${a}"，但 HTML 里没有任何 data-act="${a}" 的入口（功能存在却点不到）`);
    }
    console.log(`[1b] 账户菜单：代码支持 ${handled.size} 个动作，HTML 提供 ${inMenu.size} 个入口`);
}
console.log(`[1] data-act：HTML 中 ${acts.size} 个，js 分支 ${actBranches.size} 个${genericDispatch ? '（另有通用分发）' : ''}`);

/* ---------- 2. 元素 id 契约 ---------- */
const definedIds = new Set();
for (const f of HTMLS) for (const m of html[f].matchAll(/\bid="([^"]+)"/g)) definedIds.add(m[1]);
for (const s of Object.values(js)) {
    for (const m of s.matchAll(/\bid=\\?["']([A-Za-z][\w-]*)\\?["']/g)) definedIds.add(m[1]);
    for (const m of s.matchAll(/\.id\s*=\s*\\?["']([A-Za-z][\w-]*)\\?["']/g)) definedIds.add(m[1]);
}
const referencedIds = new Set();
const ID_RX = [
    /getElementById\(\s*['"]([^'"]+)['"]/g,
    /App\.dom\.get\(\s*['"]([^'"]+)['"]/g,
    /\bdom\.get\(\s*['"]([^'"]+)['"]/g,
    /setText\(\s*['"]([^'"]+)['"]/g,
];
for (const s of [...Object.values(js), ...Object.values(html)]) {
    for (const rx of ID_RX) for (const m of s.matchAll(rx)) referencedIds.add(m[1]);
}
for (const id of referencedIds) {
    if (!definedIds.has(id)) problems.push(`代码引用了 #${id}，但 HTML/JS 里都没有定义（getElementById 恒为 null）`);
}
console.log(`[2] 元素 id：引用 ${referencedIds.size} 个，定义 ${definedIds.size} 个`);

/* ---------- 3. CSS 变量 ---------- */
// 只认真实 HTML <style> 与 src/tailwind.css 里的变量定义，防止 JS 弹窗/打印模板字符串里的定义掩盖主页面缺变量
const extractStyleVars = (text) => {
    const vars = new Set();
    for (const block of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
        for (const m of block[1].matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) vars.add(m[1]);
    }
    return vars;
};
const indexDefinedVars = extractStyleVars(html['index.html']);
const adminDefinedVars = extractStyleVars(html['admin.html']);
const definedVars = new Set([...indexDefinedVars, ...adminDefinedVars]);
try {
    const tw = read('src/tailwind.css');
    for (const m of tw.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) {
        indexDefinedVars.add(m[1]);
        definedVars.add(m[1]);
    }
} catch (_) { }

const usedVars = new Set();
for (const m of html['index.html'].matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
    usedVars.add(m[1]);
    if (!indexDefinedVars.has(m[1])) problems.push(`index.html 使用了 CSS 变量 ${m[1]} 但未在其 <style> 中定义`);
}
for (const m of html['admin.html'].matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
    usedVars.add(m[1]);
    if (!adminDefinedVars.has(m[1])) problems.push(`admin.html 使用了 CSS 变量 ${m[1]} 但未在其 <style> 中定义`);
}
for (const [f, s] of Object.entries(js)) {
    // JS 里自包含的打印文档 <style>...</style> 自检其内部使用与定义；其余 JS 引用的 var() 必须由 index.html 定义
    let stripped = s;
    for (const blk of s.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
        const localDef = new Set([...blk[1].matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map(m => m[1]));
        for (const m of blk[1].matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
            usedVars.add(m[1]);
            if (!localDef.has(m[1]) && !indexDefinedVars.has(m[1])) {
                problems.push(`${f} 的独立 <style> 使用了未定义的 CSS 变量 ${m[1]}`);
            }
        }
        stripped = stripped.replace(blk[0], '');
    }
    for (const m of stripped.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
        usedVars.add(m[1]);
        if (!indexDefinedVars.has(m[1])) {
            problems.push(`${f} 使用了 CSS 变量 ${m[1]} 但 index.html 中未定义`);
        }
    }
}
console.log(`[3] CSS 变量：使用 ${usedVars.size} 个，定义 ${definedVars.size} 个`);

/* ---------- 4. inline onclick 目标 ---------- */
const definedFns = new Set();
for (const s of [...Object.values(js), ...Object.values(html)]) {
    for (const m of s.matchAll(/(?:^|[\s,{;])([A-Za-z_$][\w$]*)\s*[\(:]/gm)) definedFns.add(m[1]);
}
let onclickChecked = 0;
const allSources = [...HTMLS.map(f => [f, html[f]]), ...Object.entries(js)];
for (const [f, srcText] of allSources) {
    for (const m of srcText.matchAll(/\bon(?:click|change|input|submit|keydown)="([^"]+)"/g)) {
        for (const c of m[1].matchAll(/\bApp(?:\.([A-Za-z_$][\w$]*))?(?:\.([A-Za-z_$][\w$]*))?(?:\.([A-Za-z_$][\w$]*))?\s*\(/g)) {
            const fn = c[3] || c[2] || c[1];
            if (!fn) continue;
            onclickChecked++;
            if (!definedFns.has(fn)) problems.push(`${f} 的 inline 事件引用了 ${fn}()，但 js/ 里找不到定义`);
        }
    }
}
console.log(`[4] inline 事件（HTML + JS 模板）：检查 ${onclickChecked} 处调用`);

/* ---------- 结果 ---------- */
console.log('');
if (problems.length) {
    console.error(`发现 ${problems.length} 处契约违反：`);
    for (const p of problems) console.error('  ✗ ' + p);
    process.exit(1);
}
console.log('✅ DOM 契约检查通过（没有「点了没反应」的悬空引用，也没有失效的 CSS 变量）');
