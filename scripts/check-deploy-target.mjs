/**
 * @file scripts/check-deploy-target.mjs
 * @description 部署目标防呆：校验 config.js（前端 API 地址）与 worker/wrangler.json
 * （后端 Worker 名 + D1 绑定）指向同一套环境。
 * 交叉污染是本项目最严重的潜在事故：把 mirror 前端配到生产 D1、
 * 或从仓库直接 deploy 覆盖生产 Worker，都不可逆。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const cfg = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
const wr = JSON.parse(fs.readFileSync(path.join(root, 'worker', 'wrangler.json'), 'utf8'));

const apiMatch = cfg.match(/window\.API_BASE\s*=\s*"([^"]*)"/);
const api = apiMatch ? apiMatch[1] : '';
const dbId = wr.d1_databases?.[0]?.database_id || '';
const workerName = wr.name || '';

const ENVS = [
    {
        name: 'mirror',
        apiIncludes: 'question-site-mirror-api',
        dbId: 'c1918ace-61ae-4667-890b-ed4d3b56a0bd',
        workerName: 'question-site-mirror-api'
    },
    {
        name: 'production',
        apiIncludes: 'question-site-api',
        dbId: '128acd54-531e-4eba-9943-56768d095c98',
        workerName: 'question-site-api'
    }
];

const apiEnv = ENVS.find(e => api.includes(e.apiIncludes));
const dbEnv = ENVS.find(e => e.dbId === dbId);
const workerEnv = ENVS.find(e => e.workerName === workerName);

if (!apiEnv || !dbEnv || !workerEnv || apiEnv.name !== dbEnv.name || dbEnv.name !== workerEnv.name) {
    console.error('✗ 部署目标不一致，中止：');
    console.error(`    config.js API   → ${apiEnv ? apiEnv.name : api || '(未识别)'}`);
    console.error(`    worker name     → ${workerEnv ? workerEnv.name : workerName || '(未识别)'}`);
    console.error(`    D1 database_id  → ${dbEnv ? dbEnv.name : dbId || '(未识别)'}`);
    console.error('  请修正 config.js 与 worker/wrangler.json 使三者指向同一环境。');
    process.exit(1);
}

console.log(`✓ 部署目标确认：${apiEnv.name}（worker=${workerName}，db=${dbId.slice(0, 8)}…）`);
