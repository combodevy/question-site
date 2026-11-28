import { describe, expect, it } from 'vitest';
import {
  countStemBlanks,
  formatFillAnswerDisplay,
  gradeFillBlanks,
  normalizeQuestion,
  parseFillBlanks,
  serializeFillBlanks,
} from '@qs/shared';
import { parsePlainTextQuestions, sanitizeImportedBank } from '@/lib/parsers';

describe('Multi-blank fill-in-the-blank helpers', () => {
  it('parses, serializes, counts blanks, and grades single and multi-blank answers', () => {
    expect(parseFillBlanks('TCP|传输控制协议')).toEqual([['TCP', '传输控制协议']]);
    expect(parseFillBlanks('HTTP|超文本传输协议;;443|四四三')).toEqual([
      ['HTTP', '超文本传输协议'],
      ['443', '四四三'],
    ]);
    expect(serializeFillBlanks([' HTTP | 超文本传输协议 ', ' 443 '])).toBe(
      'HTTP|超文本传输协议;;443',
    );
    expect(countStemBlanks('协议是 __，端口为（）和【】。')).toBe(3);

    const okGrade = gradeFillBlanks(['http', '４４３'], 'HTTP|超文本传输协议;;443|四四三');
    expect(okGrade.allOk).toBe(true);
    expect(okGrade.results).toEqual([true, true]);

    const partialFail = gradeFillBlanks(['HTTP', '80'], 'HTTP|超文本传输协议;;443|四四三');
    expect(partialFail.allOk).toBe(false);
    expect(partialFail.results).toEqual([true, false]);

    expect(formatFillAnswerDisplay('HTTP|超文本;;443')).toBe('(1) HTTP / 超文本   (2) 443');
    expect(formatFillAnswerDisplay('TCP|传输控制协议')).toBe('TCP / 传输控制协议');
  });
});

describe('Q&A subjective type & multi-blank parsing', () => {
  it('sanitizes explicit qa type with long multiline answer and array-based multi-blank fill', () => {
    const longAnswer = '1. MCP 定义了标准接口；\n' + '详细要点内容；\n'.repeat(70);
    expect(longAnswer.length).toBeGreaterThan(500);

    const res = sanitizeImportedBank({
      AI工程: {
        第一章: [
          {
            id: 'qa-long',
            type: '问答题',
            q: '简述一下 MCP 协议。',
            a: longAnswer,
            d: '记忆核心概念即可',
          },
          {
            id: 'fill-multi',
            type: 'fill',
            q: 'Web 安全协议是 __，默认端口为 __。',
            a: [['HTTPS', '超文本安全传输'], '443'],
          },
        ],
      },
    });

    expect(res.stats.ignored).toBe(0);
    expect(res.questions).toHaveLength(2);
    expect(res.questions[0].type).toBe('qa');
    expect(res.questions[0].a).toBe(longAnswer.trim());
    expect(res.questions[1].type).toBe('fill');
    expect(res.questions[1].a).toBe('HTTPS|超文本安全传输;;443');
  });

  it('infers qa type from plain text and normalizes via normalizeQuestion', () => {
    const rawText = [
      '1. 简述一下 MCP 协议的核心组成。',
      '答案：Host、Client 与 Server 三部分组成，',
      '支持 Tools、Resources 和 Prompts 三类原语。',
      '解析：记忆三大原语即可。',
    ].join('\n');

    const parsed = parsePlainTextQuestions(rawText, 'AI', '基础');
    expect(parsed.questions).toHaveLength(1);
    expect(parsed.questions[0].type).toBe('qa');
    expect(parsed.questions[0].a).toContain('Tools、Resources 和 Prompts');

    const essayNorm = sanitizeImportedBank([{ type: 'essay', q: 'Explain MCP', a: 'Model Context Protocol' }]);
    expect(essayNorm.questions).toHaveLength(1);
    expect(essayNorm.questions[0].type).toBe('qa');

    const norm = normalizeQuestion({
      type: '简答',
      q: 'What is ACID?',
      a: 'Atomicity, Consistency, Isolation, Durability',
    });
    expect(norm?.type).toBe('qa');
    expect(norm?.a).toBe('Atomicity, Consistency, Isolation, Durability');
  });
});
