import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function walkFiles(dir: string, exts: Set<string>, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, exts, acc);
    } else if (exts.has(path.extname(entry.name))) {
      acc.push(full);
    }
  }
  return acc;
}

describe('frontend forbidden symbols and legacy branding guard', () => {
  it('contains zero forbidden UI symbols (· 「 」 『 』) or removed phrases across frontend files', () => {
    const webRoot = path.resolve(__dirname, '..');
    const repoRoot = path.resolve(webRoot, '../..');
    const files = [
      path.join(webRoot, 'index.html'),
      path.join(webRoot, 'admin.html'),
      ...walkFiles(path.join(webRoot, 'src'), new Set(['.ts', '.tsx', '.json', '.css'])),
      ...walkFiles(path.join(repoRoot, 'packages/shared/src'), new Set(['.ts', '.tsx'])),
    ];

    const forbidden = /[·「」『』]|研习书桌|Study Atelier|按遗忘临界时间/;
    const hits: Array<{ file: string; line: number; text: string }> = [];

    for (const file of files) {
      if (!fs.existsSync(file)) continue;
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((lineText, idx) => {
        if (forbidden.test(lineText)) {
          hits.push({
            file: path.relative(repoRoot, file),
            line: idx + 1,
            text: lineText.trim(),
          });
        }
      });
    }

    expect(hits).toEqual([]);
  });
});
