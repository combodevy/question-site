import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = path.resolve(__dirname, '..');

describe('VitePWA foreign-IP compatibility', () => {
  it('excludes admin HTML and admin bundle chunks from Workbox precache in vite.config.ts', () => {
    const configSource = fs.readFileSync(path.join(WEB_ROOT, 'vite.config.ts'), 'utf8');
    expect(configSource).toContain('globIgnores:');
    expect(configSource).toContain('**/admin.html');
    expect(configSource).toContain('**/assets/admin-*.js');
  });

  it('does not include admin.html or assets/admin-* in built sw.js precacheAndRoute manifest', () => {
    const swPath = path.join(WEB_ROOT, 'dist', 'sw.js');
    if (!fs.existsSync(swPath)) {
      return;
    }
    const swContent = fs.readFileSync(swPath, 'utf8');
    const match = swContent.match(/precacheAndRoute\(\s*(\[[\s\S]*?\])\s*,\s*\{/);
    expect(match).not.toBeNull();
    const precacheManifest = match?.[1] ?? '';
    expect(precacheManifest).toContain('index.html');
    expect(precacheManifest).not.toContain('url:"admin.html"');
    expect(precacheManifest).not.toContain('assets/admin-');
  });
});
