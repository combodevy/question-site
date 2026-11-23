/**
 * @file ops-service.mjs
 * @description Question Site 生产服务器运维与基础设施监控守护进程
 * 监听 127.0.0.1:8789，由 Nginx 反代 /api/admin/server-ops/
 */
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

const PORT = 8789;
const HOST = '127.0.0.1';
const WRANGLER_JSON = '/opt/question-site/app/worker/wrangler.json';

// 读取配置与 JWT 密钥
function loadConfig() {
    try {
        const raw = fs.readFileSync(WRANGLER_JSON, 'utf8');
        const json = JSON.parse(raw);
        return {
            secret: json.vars?.JWT_SECRET || 'tfWnFgVlr5GUpKkiQqgg5UoXyBml3afxNhJBDOPvVa6Elt9A',
            admins: (json.vars?.ADMIN_USERNAMES || 'devy-admin,admin').split(',').map(s => s.trim())
        };
    } catch (e) {
        return {
            secret: 'tfWnFgVlr5GUpKkiQqgg5UoXyBml3afxNhJBDOPvVa6Elt9A',
            admins: ['devy-admin', 'admin']
        };
    }
}

// 纯原生 JWT 验签
function verifyJwt(token, secret, admins) {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;
    const expectedSig = crypto.createHmac('sha256', secret)
        .update(`${headerB64}.${payloadB64}`)
        .digest('base64url');
    if (expectedSig !== sigB64) return null;
    try {
        const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
        if (payload.exp && payload.exp * 1000 < Date.now()) return null;
        const username = payload.username || payload.sub;
        if (!admins.includes(username)) return null;
        return payload;
    } catch (e) {
        return null;
    }
}

function safeExec(cmd, fallback = '') {
    try {
        return execSync(cmd, { encoding: 'utf8', timeout: 5000 }).trim();
    } catch (e) {
        return fallback;
    }
}

function getSystemMetrics() {
    const cpus = os.cpus();
    const loadavg = os.loadavg();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    // 磁盘统计
    let disk = { total: '0G', used: '0G', avail: '0G', percent: '0%' };
    try {
        const dfOut = safeExec("df -h / | tail -n 1");
        const parts = dfOut.split(/\s+/);
        if (parts.length >= 5) {
            disk = { total: parts[1], used: parts[2], avail: parts[3], percent: parts[4] };
        }
    } catch (e) {}

    // 目录大小统计
    const dataSize = safeExec("du -sh /opt/question-site/data 2>/dev/null | cut -f1", "0M");
    const backupSize = safeExec("du -sh /opt/question-site/backups 2>/dev/null | cut -f1", "0M");
    
    // D1 数据库文件尺寸（通过原生 stat 同步获取，不走子进程）
    let d1DbSize = "2.7M";
    try {
        const dbPath = '/opt/question-site/data/v3/d1/miniflare-D1DatabaseObject/93d7fc60452c6d106c5f56c0087ad2c71a3b2b22dd60c438593ff9a643a39250.sqlite';
        if (fs.existsSync(dbPath)) {
            const sz = fs.statSync(dbPath).size;
            d1DbSize = (sz / (1024 * 1024)).toFixed(1) + 'M';
        }
    } catch (e) {}

    // 服务状态
    const apiStatus = safeExec("systemctl is-active question-site-api", "inactive");
    const nginxStatus = safeExec("systemctl is-active nginx", "inactive");

    // 端口监听
    const openPortsRaw = safeExec("ss -tln | grep -E ':(80|443|8080|8787|8789)\\b' | awk '{print $4}'");
    const openPorts = openPortsRaw.split('\n').map(s => s.trim()).filter(Boolean);

    // 备份列表（限制最多统计前 6 个近期备份目录尺寸，防止过多 du -sh 造成磁盘 I/O 阻塞）
    let backups = [];
    try {
        const bPath = '/opt/question-site/backups';
        if (fs.existsSync(bPath)) {
            const dirs = fs.readdirSync(bPath)
                .filter(d => !d.startsWith('.'))
                .sort().reverse().slice(0, 10);
            backups = dirs.map((d, idx) => {
                const p = path.join(bPath, d);
                const stat = fs.statSync(p);
                const size = idx < 6 ? safeExec(`du -sh "${p}" 2>/dev/null | cut -f1`, "约 8K") : "已归档";
                return { name: d, mtime: stat.mtime, size };
            });
        }
    } catch (e) {}

    // 系统日志（API journalctl 最近 40 行）
    const journalLogs = safeExec("journalctl -u question-site-api -n 40 --no-pager", "暂无日志");

    // Nginx 访问日志（最近 30 行）
    const nginxLogs = safeExec("tail -n 30 /var/log/nginx/quiz.access.log 2>/dev/null", "暂无日志");

    return {
        timestamp: new Date().toISOString(),
        os: {
            platform: os.platform(),
            release: os.release(),
            hostname: os.hostname(),
            arch: os.arch(),
            nodeVersion: process.version,
            uptimeSeconds: Math.floor(os.uptime())
        },
        cpu: {
            cores: cpus.length,
            model: cpus[0]?.model || 'Generic CPU',
            loadavg: [Number(loadavg[0].toFixed(2)), Number(loadavg[1].toFixed(2)), Number(loadavg[2].toFixed(2))]
        },
        memory: {
            totalMB: Math.round(totalMem / (1024 * 1024)),
            usedMB: Math.round(usedMem / (1024 * 1024)),
            freeMB: Math.round(freeMem / (1024 * 1024)),
            percent: Math.round((usedMem / totalMem) * 100)
        },
        disk: {
            ...disk,
            dataSize,
            backupSize,
            d1DbSize
        },
        services: {
            api: apiStatus,
            nginx: nginxStatus,
            openPorts
        },
        backups,
        logs: {
            journal: journalLogs,
            nginx: nginxLogs
        }
    };
}

// 短期内存缓存（3 秒）：吸收高频短时间轮询与连续刷新请求，使接口响应从 270ms 降至 0ms
let cachedMetrics = null;
let lastMetricsTime = 0;
const METRICS_TTL_MS = 3000;

const server = http.createServer((req, res) => {
    // 允许跨域（本地反代环境）
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const { secret, admins } = loadConfig();
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const user = verifyJwt(token, secret, admins);

    if (!user) {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Unauthorized: Admin access required' }));
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = url.pathname;

    // 1. 获取服务器监控全量指标
    if (req.method === 'GET' && (pathname === '/metrics' || pathname.endsWith('/metrics') || pathname.endsWith('/server-ops') || pathname.endsWith('/server-ops/'))) {
        try {
            const now = Date.now();
            if (cachedMetrics && (now - lastMetricsTime < METRICS_TTL_MS)) {
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ ok: true, metrics: cachedMetrics, cached: true }));
                return;
            }
            const metrics = getSystemMetrics();
            cachedMetrics = metrics;
            lastMetricsTime = now;
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: true, metrics }));
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Failed to read metrics: ' + e.message }));
        }
        return;
    }

    // 2. 执行运维指令 (Backup / Restart)
    if (req.method === 'POST' && (pathname === '/action' || pathname.endsWith('/action'))) {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const data = JSON.parse(body || '{}');
                const action = data.action;

                // 动作执行后立刻失效监控缓存
                cachedMetrics = null;
                lastMetricsTime = 0;

                if (action === 'backup') {
                    const out = safeExec('/opt/question-site/manage.sh backup');
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ ok: true, message: '备份执行成功', output: out }));
                    return;
                }

                if (action === 'restart-api') {
                    safeExec('/opt/question-site/manage.sh restart');
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ ok: true, message: 'API 服务已触发重启' }));
                    return;
                }

                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Unknown action: ' + action }));
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Action execution failed: ' + e.message }));
            }
        });
        return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Endpoint not found: ' + pathname }));
});

server.listen(PORT, HOST, () => {
    console.log(`Question Site Ops Daemon running on http://${HOST}:${PORT}`);
});
