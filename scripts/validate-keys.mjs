/**
 * @file scripts/validate-keys.mjs
 * @description 校验 english/keys.json 与试卷数据的契约（CI 用）。
 *
 * 规则：
 *   1. keys 里的每套卷都必须存在对应 paper 文件
 *   2. 答案题号必须出现在该卷题目里
 *   3. 答案必须是单个字母 A–Z
 *   4. 字母必须落在该题选项数范围内（例：4 选 1 的题只能 A–D）
 *
 * 用法：node scripts/validate-keys.mjs
 * 有违反则退出码 1。
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENG = path.join(ROOT, 'english');
const PAPERS = path.join(ENG, 'papers');

const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));

const keys = readJSON(path.join(ENG, 'keys.json'));
const files = readdirSync(PAPERS).filter((f) => f.endsWith('.json'));
const paperIds = new Set(files.map((f) => f.slice(0, -5)));

const errors = [];
const warnings = [];
let totalQ = 0;
let keyedQ = 0;

for (const pid of Object.keys(keys)) {
    if (!paperIds.has(pid)) {
        errors.push(`${pid}: keys 里有但试卷文件不存在`);
        continue;
    }
    const paper = readJSON(path.join(PAPERS, pid + '.json'));
    const qmap = new Map((paper.questions || []).map((q) => [String(q.no), q]));
    totalQ += qmap.size;
    const missingNos = [];
    for (const qNo of qmap.keys()) {
        if (!Object.prototype.hasOwnProperty.call(keys[pid], qNo)) {
            missingNos.push(qNo);
        }
    }
    if (missingNos.length > 0) {
        warnings.push(`${pid}: 已收录答案库但缺少题号 ${missingNos.join(', ')}（共 ${Object.keys(keys[pid]).length}/${qmap.size} 题）`);
    }
    for (const [no, ans] of Object.entries(keys[pid])) {
        const q = qmap.get(no);
        if (!q) {
            errors.push(`${pid} Q${no}: 题号在试卷里不存在`);
            continue;
        }
        const L = String(ans).toUpperCase();
        if (!/^[A-Z]$/.test(L)) {
            errors.push(`${pid} Q${no}: 答案 ${JSON.stringify(ans)} 不是单个字母`);
            continue;
        }
        const nopt = (q.o || []).length;
        if (L.charCodeAt(0) - 64 > nopt) {
            errors.push(`${pid} Q${no}: 答案 ${L} 超出该题选项数 ${nopt}`);
            continue;
        }
        keyedQ++;
    }
}

const covered = Object.keys(keys).filter((p) => paperIds.has(p)).length;
console.log(`试卷 ${paperIds.size} 套，keys 覆盖 ${covered} 套，已录入答案 ${keyedQ} 题`);
console.log(`答案库自身题量合计 ${totalQ} 题（含未录入的卷）`);
if (warnings.length) {
    console.warn(`\n⚠️ 答案缺漏提示（${warnings.length} 套卷存在缺题）：`);
    for (const w of warnings) console.warn('  ! ' + w);
}
if (errors.length) {
    console.error(`\n发现 ${errors.length} 处问题：`);
    for (const e of errors.slice(0, 40)) console.error('  ✗ ' + e);
    if (errors.length > 40) console.error(`  … 其余 ${errors.length - 40} 处`);
    process.exit(1);
}
console.log('\n✅ 答案库校验通过');
