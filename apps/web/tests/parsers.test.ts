import { describe, expect, it } from 'vitest';
import {
  parseLooseJson,
  parsePlainTextQuestions,
  sanitizeImportedBank,
} from '../src/lib/parsers';

describe('parsers', () => {
  it('repairs markdown-fenced JSON with comments and trailing commas', () => {
    const raw = `Here is the bank:
\`\`\`json
{
  // comment
  "计算机网络": {
    "第一章": [
      { "type": "单选", "q": "HTTP 默认端口?", "o": ["A. 21", "B. 80"], "a": "B. 80", },
    ],
  },
}
\`\`\``;
    const loose = parseLooseJson(raw);
    expect(loose.data).not.toBeNull();
    expect(loose.autoRepaired).toBe(true);

    const san = sanitizeImportedBank(loose.data);
    expect(san.questions).toHaveLength(1);
    expect(san.questions[0].type).toBe('mcq');
    expect(san.questions[0].o).toEqual(['21', '80']);
    expect(san.questions[0].a).toBe('B');
  });

  it('produces line/col syntax diagnostics for truncated JSON', () => {
    const broken = '{\n  "Sub": {\n    "Chap": [\n      {"q": "hi"';
    const res = parseLooseJson(broken);
    expect(res.data).toBeNull();
    expect(res.diag).toBeDefined();
    expect(res.diag?.hint).toContain('未闭合');
    expect(res.diag?.line).toBeGreaterThan(0);
  });

  it('sanitizes flat array and normalizes tf/multi/fill types', () => {
    const input = [
      { sub: 'Math', chap: 'Ch1', question: '2+2=4', answer: '对' },
      { sub: 'OS', chap: 'Ch1', q: 'Select valid', o: ['X', 'Y', 'Z'], a: ['C', 'A'] },
      { sub: 'Net', chap: 'Ch2', q: 'Protocol?', a: ['TCP', 'UDP'] },
      { sub: 'Bad', chap: 'Ch1', q: 'Bad Q', type: 'unknown_type', a: 'foo' },
    ];
    const san = sanitizeImportedBank(input);
    expect(san.questions).toHaveLength(3);
    expect(san.questions.map((q) => q.type)).toEqual(['tf', 'multi', 'fill']);
    expect(san.questions[0].a).toBe('T');
    expect(san.questions[1].a).toBe('AC');
    expect(san.questions[2].a).toBe('TCP|UDP');
    expect(san.stats.ignored).toBe(1);
  });

  it('parses plain text questions with numbered stems, options, answers and explanations', () => {
    const text = `
1. TCP 位于 OSI 的哪一层？
A. 应用层
B. 传输层
C. 网络层
答案：B
解析：TCP 和 UDP 工作在传输层。

2. HTTP 默认端口是 80。
答案：正确

3. 存储系统的英文缩写是 __。
答案：RAM|内存
`;
    const res = parsePlainTextQuestions(text, '计算机基础', '综合');
    expect(res.questions).toHaveLength(3);
    expect(res.questions[0].type).toBe('mcq');
    expect(res.questions[0].a).toBe('B');
    expect(res.questions[0].d).toContain('传输层');
    expect(res.questions[1].type).toBe('tf');
    expect(res.questions[1].a).toBe('T');
    expect(res.questions[2].type).toBe('fill');
    expect(res.questions[2].a).toBe('RAM|内存');
  });
});
