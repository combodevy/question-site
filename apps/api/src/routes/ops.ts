import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { Hono, type Context } from 'hono';
import { readJsonBody } from '../lib/crypto.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

const METRICS_TTL_MS = 3000;
const MAX_ACTION_BODY_BYTES = 64 * 1024;

let cachedMetrics: Record<string, unknown> | null = null;
let lastMetricsTime = 0;

function safeExecFile(cmd: string, args: string[], fallback = '', timeout = 5000): string {
    try {
        return execFileSync(cmd, args, { encoding: 'utf8', timeout }).trim();
    } catch {
        return fallback;
    }
}

function collectSystemMetrics(dbPath: string) {
    const cpus = os.cpus();
    const loadavg = os.loadavg();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    let disk = { total: '0G', used: '0G', avail: '0G', percent: '0%' };
    const dfOut = safeExecFile('df', ['-h', '/']);
    const dfLines = dfOut.split('\n');
    const lastLine = dfLines[dfLines.length - 1] || '';
    const parts = lastLine.trim().split(/\s+/);
    if (parts.length >= 5) {
        disk = { total: parts[1], used: parts[2], avail: parts[3], percent: parts[4] };
    }

    const dataDir = path.dirname(dbPath);
    const dataSize = safeExecFile('du', ['-sh', dataDir], '0M').split(/\s+/)[0] || '0M';
    const backupDir = '/opt/question-site/backups';
    const backupSize = fs.existsSync(backupDir)
        ? safeExecFile('du', ['-sh', backupDir], '0M').split(/\s+/)[0] || '0M'
        : '0M';

    let d1DbSize = '0.0M';
    try {
        if (fs.existsSync(dbPath)) {
            d1DbSize = (fs.statSync(dbPath).size / (1024 * 1024)).toFixed(1) + 'M';
        }
    } catch {
        // ignore stat failure
    }

    const apiStatus = safeExecFile('systemctl', ['is-active', 'question-site-api'], 'active');
    const nginxStatus = safeExecFile('systemctl', ['is-active', 'nginx'], 'inactive');

    const ssOut = safeExecFile('ss', ['-tln']);
    const openPorts = ssOut
        .split('\n')
        .map((line) => line.trim().split(/\s+/)[3] || '')
        .filter((addr) => /:(80|443|8080|8787)$/.test(addr));

    let backups: Array<{ name: string; mtime: Date; size: string }> = [];
    try {
        if (fs.existsSync(backupDir)) {
            const dirs = fs
                .readdirSync(backupDir)
                .filter((d) => !d.startsWith('.'))
                .sort()
                .reverse()
                .slice(0, 10);
            backups = dirs.map((d, idx) => {
                const p = path.join(backupDir, d);
                const stat = fs.statSync(p);
                const size =
                    idx < 6
                        ? safeExecFile('du', ['-sh', p], '约 8K').split(/\s+/)[0] || '约 8K'
                        : '已归档';
                return { name: d, mtime: stat.mtime, size };
            });
        }
    } catch {
        // ignore
    }

    const journalLogs = safeExecFile(
        'journalctl',
        ['-u', 'question-site-api', '-n', '40', '--no-pager'],
        '暂无日志'
    );
    const nginxLogs = fs.existsSync('/var/log/nginx/quiz.access.log')
        ? safeExecFile('tail', ['-n', '30', '/var/log/nginx/quiz.access.log'], '暂无日志')
        : '暂无日志';

    return {
        timestamp: new Date().toISOString(),
        os: {
            platform: os.platform(),
            release: os.release(),
            hostname: os.hostname(),
            arch: os.arch(),
            nodeVersion: process.version,
            uptimeSeconds: Math.floor(os.uptime()),
        },
        cpu: {
            cores: cpus.length,
            model: cpus[0]?.model || 'Generic CPU',
            loadavg: [
                Number(loadavg[0].toFixed(2)),
                Number(loadavg[1].toFixed(2)),
                Number(loadavg[2].toFixed(2)),
            ],
        },
        memory: {
            totalMB: Math.round(totalMem / (1024 * 1024)),
            usedMB: Math.round(usedMem / (1024 * 1024)),
            freeMB: Math.round(freeMem / (1024 * 1024)),
            percent: Math.round((usedMem / totalMem) * 100),
        },
        disk: {
            ...disk,
            dataSize,
            backupSize,
            d1DbSize,
        },
        services: {
            api: apiStatus,
            nginx: nginxStatus,
            openPorts,
        },
        backups,
        logs: {
            journal: journalLogs,
            nginx: nginxLogs,
        },
    };
}

export function createOpsRouter(): Hono<AppEnv> {
    const router = new Hono<AppEnv>();
    router.use('*', requireAuth, requireAdmin);

    const handleMetrics = (c: Context<AppEnv>) => {
        const config = c.get('config');
        const now = Date.now();
        if (cachedMetrics && now - lastMetricsTime < METRICS_TTL_MS) {
            return c.json({ ok: true, metrics: cachedMetrics, cached: true }, 200);
        }
        const metrics = collectSystemMetrics(config.dbPath);
        cachedMetrics = metrics;
        lastMetricsTime = now;
        return c.json({ ok: true, metrics }, 200);
    };

    router.get('/', handleMetrics);
    router.get('/metrics', handleMetrics);

    router.post('/action', async (c) => {
        const body = await readJsonBody<{ action?: unknown }>(c.req.raw, MAX_ACTION_BODY_BYTES);
        if (!body) {
            return c.json({ error: '无效的 JSON 请求体或体积超限' }, 400);
        }

        const action = typeof body.action === 'string' ? body.action : '';
        cachedMetrics = null;
        lastMetricsTime = 0;

        if (action === 'backup') {
            try {
                const out = execFileSync('/opt/question-site/manage.sh', ['backup'], {
                    encoding: 'utf8',
                    timeout: 15000,
                }).trim();
                return c.json({ ok: true, message: '备份执行成功', output: out }, 200);
            } catch (err) {
                return c.json(
                    { error: '备份执行失败: ' + String((err as Error)?.message || err) },
                    500
                );
            }
        }

        if (action === 'restart-api') {
            // 先返回 200 让 Nginx/前端收到确认，再延迟 200ms 脱离当前进程发起重启
            setTimeout(() => {
                try {
                    const child = spawn('/opt/question-site/manage.sh', ['restart'], {
                        detached: true,
                        stdio: 'ignore',
                    });
                    child.unref();
                } catch {
                    // ignore
                }
            }, 200);
            return c.json({ ok: true, message: 'API 服务已触发重启' }, 200);
        }

        return c.json({ error: `Unknown action: ${action}` }, 400);
    });

    return router;
}
