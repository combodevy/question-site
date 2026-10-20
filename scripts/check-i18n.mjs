/**
 * @file scripts/check-i18n.mjs
 * @description 英文模式下的中文残留检查（CI 用）。
 *
 * 三处来源：
 *   1. js/** 里的 t('…') / App.t('…') / this.t('…') 调用
 *   2. index.html 里带 data-i18n 的元素文案
 *   3. index.html 里 title / aria-label / placeholder 属性
 *
 * ★ 运行时有一套「剥 `中文 (English)` 尾括注」的兜底（见 js/i18n.js 的 walk/walkAttrs），
 *   所以这类形态不算缺失，检查里按同样规则放行——否则会大量误报。
 * ★ admin.html 不加载 js/i18n.js（管理后台本来就是中文界面），不参与检查。
 *
 * 用法：node scripts/check-i18n.mjs
 * 有缺失则退出码 1。
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CJK = /[\u4e00-\u9fff]/;
// 与运行时一致：整串为「中文 (English)」时会被自动剥成英文
const GLOSS = /^([\s\S]+?)\s*[(（]([\x20-\x7E]{2,})[)）]$/;

const dict = new Set();
{
    const src = readFileSync(path.join(ROOT, 'js/i18n.js'), 'utf8');
    for (const m of src.matchAll(/^\s*'((?:[^'\\]|\\.)*)'\s*:\s*\{\s*(?:en|zh)\s*:/gm)) dict.add(m[1].replace(/\\'/g, "'"));
    for (const m of src.matchAll(/^\s*"((?:[^"\\]|\\.)*)"\s*:\s*\{\s*(?:en|zh)\s*:/gm)) dict.add(m[1]);
}

const jsFiles = [];
for (const dir of ['js', 'js/views']) {
    for (const f of readdirSync(path.join(ROOT, dir))) {
        if (f.endsWith('.js') && f !== 'i18n.js') jsFiles.push(path.join(dir, f));
    }
}

const missing = [];
const handled = (s) => {
    if (dict.has(s)) return true;
    const m = s.replace(/\s+/g, ' ').trim().match(GLOSS);
    return !!(m && CJK.test(m[1]) && !CJK.test(m[2]));
};

// 1) t() 调用
let tCalls = 0;
for (const rel of jsFiles) {
    const src = readFileSync(path.join(ROOT, rel), 'utf8');
    for (const m of src.matchAll(/(?:this\.t|App\.t|\bt)\(\s*'((?:[^'\\]|\\.)*)'\s*\)/g)) {
        tCalls++;
        const s = m[1].replace(/\\'/g, "'");
        if (CJK.test(s) && !handled(s)) missing.push(`${rel}: t('${s}')`);
    }
    for (const m of src.matchAll(/(?:this\.t|App\.t|\bt)\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g)) {
        tCalls++;
        const s = m[1];
        if (CJK.test(s) && !handled(s)) missing.push(`${rel}: t("${s}")`);
    }
}

// 2) index.html 的 data-i18n 元素文案 + 3) 属性
{
    const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const body = html.replace(/<head[\s\S]*?<\/head>/i, '').replace(/<script[\s\S]*?<\/script>/g, '');
    let d18n = 0;
    for (const m of body.matchAll(/data-i18n[^>]*>\s*([^<]+?)\s*</g)) {
        const t = m[1].trim();
        if (!t) continue;
        d18n++;
        if (CJK.test(t) && !handled(t)) missing.push(`index.html [data-i18n]: ${JSON.stringify(t)}`);
    }
    let attrs = 0;
    for (const m of body.matchAll(/\b(title|aria-label|placeholder)="([^"]*)"/g)) {
        const v = m[2].trim();
        if (!v || !CJK.test(v)) continue;
        attrs++;
        if (!handled(v)) missing.push(`index.html ${m[1]}=${JSON.stringify(v)}`);
    }
    console.log(`index.html: data-i18n 文案 ${d18n} 条，中文属性 ${attrs} 条`);
}

console.log(`js/: t() 调用 ${tCalls} 处，字典键 ${dict.size} 个`);
if (missing.length) {
    console.error(`\n英文模式下会残留中文的文案 ${missing.length} 处：`);
    for (const x of missing.slice(0, 40)) console.error('  ✗ ' + x);
    if (missing.length > 40) console.error(`  … 其余 ${missing.length - 40} 处`);
    process.exit(1);
}
console.log('\n✅ i18n 覆盖检查通过（英文模式无残留中文）');
