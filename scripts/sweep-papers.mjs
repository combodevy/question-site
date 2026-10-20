/**
 * @file scripts/sweep-papers.mjs
 * @description 把全部试卷在真实浏览器里逐卷、逐节渲染并核对（CI 用）。
 *
 * 检查：题数与索引一致、文章渲染非空、题卡/空位条数量正确、选项非空、
 *       渲染文本无乱码（U+FFFD / 私有区 / GBK-UTF8 混码 / JS 占位值）、
 *       正文与选项没有「字母被空格拆散」（t r a i n e）。
 *
 * 用法：
 *   node scripts/sweep-papers.mjs [baseUrl]        # 默认 http://127.0.0.1:8899
 *   环境变量：
 *     CHROME_PATH             指定浏览器可执行文件（默认按平台推断，找不到则用 playwright 自带）
 *     PLAYWRIGHT_CORE_PATH    显式指定 playwright-core 的 index.mjs 路径（本地无 node_modules 时用）
 *
 * 有失败则退出码 1。
 */
import path from 'node:path';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:8899';

// ---- 解析 playwright-core（CI 用 npm 装的；本地可用环境变量指到已装位置）----
const candidates = [process.env.PLAYWRIGHT_CORE_PATH, 'playwright-core', 'playwright'].filter(Boolean);
let chromium = null;
let loadedFrom = null;
for (const c of candidates) {
    try {
        const spec = /^([A-Za-z]:[\\/]|\/)/.test(c) ? 'file://' + c.replace(/\\/g, '/') : c;
        ({ chromium } = await import(spec));
        loadedFrom = c;
        break;
    } catch (e) { /* 试下一个 */ }
}
if (!chromium) {
    console.error('找不到 playwright-core。请先 `npm i -D playwright-core`，或用 PLAYWRIGHT_CORE_PATH 指定 index.mjs 路径。');
    process.exit(2);
}

// ---- 解析浏览器可执行文件 ----
const platformDefault = {
    win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    linux: '/usr/bin/google-chrome',
}[process.platform];
const exe = process.env.CHROME_PATH || platformDefault;
const launchOpts = { headless: true };
if (exe && fs.existsSync(exe)) launchOpts.executablePath = exe;
else console.log(`(未找到 ${exe}，改用 playwright 自带浏览器)`);

console.log(`playwright: ${loadedFrom}\nchrome: ${launchOpts.executablePath || '(bundled)'}\nbase: ${BASE}\n`);

const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const pageErrs = [];
page.on('pageerror', (e) => pageErrs.push(String((e && e.message) || e)));
page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/favicon|404|Failed to load resource|net::ERR|ERR_/i.test(t)) return;
    pageErrs.push('[console] ' + t);
});

await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForTimeout(1200);
await page.evaluate(() => { if (window.App.router.currentView !== 'english') window.App.router.go('english'); });
await page.waitForTimeout(1200);

const papers = await page.evaluate(async () => {
    const E = window.App.views.english;
    const all = [];
    for (const cat of ['cet4', 'cet6', 'kaoyan']) {
        E._cat = cat;
        await E._loadIndex();
        for (const it of (E._indexCache[cat] || [])) all.push({ id: it.id, cat, title: it.title, qCount: it.qCount });
    }
    return all;
});
console.log(`索引共 ${papers.length} 套卷\n`);

const results = [];
for (const p of papers) {
    const r = await page.evaluate(async (item) => {
        const E = window.App.views.english;
        const out = { id: item.id, title: item.title, idxQCount: item.qCount, problems: [] };
        E._cat = item.cat;
        await E._loadIndex();
        E.render();
        await E.startSession(item.id);
        const s = E._sess;
        if (!s) { out.problems.push('会话未能建立（试卷加载失败）'); return out; }
        out.qTotal = s.questions.length;
        out.secs = [];
        if (out.qTotal !== item.qCount) out.problems.push(`题数 ${out.qTotal} 与索引 ${item.qCount} 不一致`);
        if (!out.qTotal) out.problems.push('题目为 0');

        for (const sec of s.secOrder) {
            s.curSec = sec;
            E._syncPassage();
            E.renderQuestions();
            E._syncTabs();
            const qList = document.getElementById('eng-q-list');
            const psgEl = document.getElementById('eng-psg-text');
            const psgText = psgEl ? psgEl.innerText : '';
            const listText = qList ? qList.innerText : '';
            const secQs = s.questions.filter((q) => q.sec === sec);
            const isCloze = s.clozeSecs.includes(sec);
            const cards = document.querySelectorAll('#eng-q-list .card').length;
            const rows = document.querySelectorAll('#eng-q-list .eng-strip-row').length;
            const opts = [...document.querySelectorAll('#eng-q-list .eng-opt, #eng-q-list .eng-chip')];
            const emptyOpts = opts.filter((b) => !b.innerText.trim()).length;
            const emptyCards = [...document.querySelectorAll('#eng-q-list .card')].filter((c) => !c.innerText.trim()).length;
            const hasPsgData = !!s.secPassages[sec];
            out.secs.push({ sec, label: E.secLabel(sec), isCloze, qs: secQs.length, cards, rows, psgLen: psgText.trim().length, opts: opts.length });

            const tag = `${item.id} §${sec}`;
            if (isCloze) {
                if (rows !== secQs.length) out.problems.push(`${tag} 空位条 ${rows} ≠ 题数 ${secQs.length}`);
            } else {
                if (cards !== secQs.length) out.problems.push(`${tag} 题卡 ${cards} ≠ 题数 ${secQs.length}`);
                if (emptyCards) out.problems.push(`${tag} 有 ${emptyCards} 张空白题卡`);
                if (emptyOpts) out.problems.push(`${tag} 有 ${emptyOpts} 个空选项`);
            }
            if (!hasPsgData) out.problems.push(`${tag} 数据里没有文章`);
            else if (psgText.trim().length < 60) out.problems.push(`${tag} 文章渲染几乎为空（${psgText.trim().length} 字）`);

            const all = psgText + '\n' + listText + '\n' + (E.secLabel(sec) || '');
            if (/[\uFFFD\uE000-\uF8FF]/.test(all)) out.problems.push(`${tag} 渲染文本含乱码字符`);
            if (/锟|斤拷|â€|ï¿½|Ã[\u0080-\u00bf]/.test(all)) out.problems.push(`${tag} 渲染文本含乱码模式`);
            // 字母被空格拆散：只查正文与选项文本——段落匹配的选项本身就是单字母，一起查会误报
            const SPACED = /(?:\b[A-Za-z]\s){3,}[A-Za-z]\b/;
            const sp1 = psgText.match(SPACED);
            if (sp1) out.problems.push(`${tag} 正文有字母拆散: ${sp1[0].slice(0, 40)}`);
            const spOpt = opts.filter((b) => SPACED.test(b.innerText.trim()));
            if (spOpt.length) out.problems.push(`${tag} 有 ${spOpt.length} 个选项文字被拆散`);
            const badOpt = opts.filter((b) => /^(undefined|null|NaN|\[object Object\])$/.test(b.innerText.trim())).length;
            if (badOpt) out.problems.push(`${tag} 有 ${badOpt} 个选项渲染成 JS 占位值`);
        }
        return out;
    }, p).catch((e) => ({ id: p.id, title: p.title, problems: ['执行异常：' + String(e.message).split('\n')[0]], secs: [] }));
    results.push(r);
    const flag = r.problems.length ? '❌' : '✅';
    console.log(`${flag} ${r.id.padEnd(18)} ${String(r.qTotal ?? '-').padStart(3)}题 ${String((r.secs || []).length).padStart(2)}节  ${r.problems.length ? r.problems.join(' | ') : ''}`);
}

await browser.close();

const bad = results.filter((r) => r.problems.length);
console.log('\n' + '='.repeat(70));
console.log(`试卷总数 ${results.length}，全部通过 ${results.length - bad.length}，有问题 ${bad.length}`);
console.log(`页面级异常：${pageErrs.length ? pageErrs.slice(0, 5).join(' | ') : '无'}`);
if (bad.length) {
    console.log('\n问题明细：');
    for (const r of bad) for (const x of r.problems) console.log(`  ${r.id}: ${x}`);
}
process.exit(bad.length || pageErrs.length ? 1 : 0);
