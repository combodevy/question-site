import { describe, expect, it } from 'vitest';
import {
  highlightSegments,
  isChapterListOutOfOrder,
  naturalCompare,
  parseMediaSegments,
  sanitizeTableHTML,
} from '../src/lib/text';

describe('text utilities', () => {
  it('sorts Chinese and Arabic chapter titles naturally', () => {
    const unsorted = ['第十章 事务', '第二章 索引', '第一章 概述', '第11章 并发'];
    const sorted = [...unsorted].sort(naturalCompare);
    expect(sorted).toEqual(['第一章 概述', '第二章 索引', '第十章 事务', '第11章 并发']);
    expect(isChapterListOutOfOrder(unsorted)).toBe(true);
    expect(isChapterListOutOfOrder(sorted)).toBe(false);
  });

  it('highlights both Chinese characters via pinyin and plain substrings safely', () => {
    const pySegs = highlightSegments('计算机网络体系结构', 'wluo');
    expect(pySegs.length).toBeGreaterThan(0);

    const pyHit = highlightSegments('计算机网络', 'wangluo');
    expect(pyHit.some((s) => s.hit && s.text.includes('网'))).toBe(true);

    const subHit = highlightSegments('HTTP/2 & <script>', 'http');
    expect(subHit[0]).toEqual({ text: 'HTTP', hit: true });
    expect(subHit[1].text).toContain('<script>');
  });

  it('sanitizes HTML tables stripping dangerous scripts/events while keeping colspan/rowspan', () => {
    const dirty =
      '<table onclick="alert(1)"><tr><th colspan="2" style="color:red">Header<script>evil()</script></th></tr><tr><td onerror="x()">Cell</td></tr></table>';
    const clean = sanitizeTableHTML(dirty);
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('onerror');
    expect(clean).not.toContain('style=');
    expect(clean).not.toContain('<script');
    expect(clean).toContain('<th colspan="2">');
    expect(clean).toContain('<td>Cell</td>');
  });

  it('parses [图1] and [表1] placeholders into safe segments', () => {
    const segs = parseMediaSegments('看图 [图1] 与表 [表1]', [
      { type: 'img', key: '图1', src: 'https://example.com/a.png', alt: '图一' },
      { type: 'table', key: '表1', html: '<table><tr><td>A</td></tr></table>' },
    ]);
    expect(segs.some((s) => s.kind === 'img' && s.src === 'https://example.com/a.png')).toBe(true);
    expect(segs.some((s) => s.kind === 'table' && s.html.includes('<table>'))).toBe(true);
  });
});
