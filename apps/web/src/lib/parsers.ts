import type { Question, QuestionType } from '@qs/shared';
import { escapeHtml, naturalCompare, normalizeQuestionText, sanitizeTableHTML, SAFE_IMG_URL_RE } from './text';

export interface JsonSyntaxDiag {
  rawError: string;
  line: number;
  col: number;
  hint: string;
  snippetLines: Array<{ num: number; text: string; isError: boolean }>;
  autoRepairedSyntax?: boolean;
}

export interface LooseJsonResult {
  data: unknown;
  autoRepaired: boolean;
  diag?: JsonSyntaxDiag;
}

function tryAutoRepairJson(raw: string): string {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1];
    if (inStr) {
      out += ch;
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < raw.length && raw[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < raw.length && !(raw[i] === '*' && raw[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += ch;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

function buildJsonSyntaxDiag(src: string, err: unknown): JsonSyntaxDiag {
  const msg = String((err instanceof Error ? err.message : err) || 'SyntaxError');
  let depthBrace = 0;
  let depthBracket = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depthBrace++;
    else if (ch === '}') depthBrace--;
    else if (ch === '[') depthBracket++;
    else if (ch === ']') depthBracket--;
  }

  const lines = src.split(/\r?\n/);
  let line = 0;
  let col = 0;
  const lcMatch = msg.match(/line\s+(\d+)\s+column\s+(\d+)/i);
  const posMatch = msg.match(/position\s+(\d+)/i);

  if (lcMatch) {
    line = parseInt(lcMatch[1], 10);
    col = parseInt(lcMatch[2], 10);
  } else if (posMatch) {
    const pos = parseInt(posMatch[1], 10);
    let acc = 0;
    for (let i = 0; i < lines.length; i++) {
      const len = lines[i].length + 1;
      if (acc + len > pos || i === lines.length - 1) {
        line = i + 1;
        col = Math.max(1, pos - acc + 1);
        break;
      }
      acc += len;
    }
  } else if (inStr || depthBrace > 0 || depthBracket > 0) {
    line = lines.length;
    col = (lines[lines.length - 1] || '').length + 1;
  }

  let hint: string;
  if (inStr || depthBrace > 0 || depthBracket > 0) {
    hint = `检测到 JSON 末尾未闭合（${depthBrace > 0 ? `缺 ${depthBrace} 个 "}" ` : ''}${depthBracket > 0 ? `缺 ${depthBracket} 个 "]" ` : ''}${inStr ? '双引号未闭合' : ''}），通常由长输出被截断引起。`;
  } else if (/Unexpected token/i.test(msg) || /Expected/i.test(msg)) {
    hint = '常见原因：题干或选项含未转义英文双引号 "、上行末尾漏写逗号 ,，或误用了中文全角符号（：，“”）。';
  } else {
    hint = '请对照高亮行与模板检查 JSON 结构。';
  }

  const snippetLines: JsonSyntaxDiag['snippetLines'] = [];
  if (line >= 1 && line <= lines.length) {
    const startL = Math.max(1, line - 1);
    const endL = Math.min(lines.length, line + 1);
    for (let l = startL; l <= endL; l++) {
      snippetLines.push({
        num: l,
        text: (lines[l - 1] || '').slice(0, 160),
        isError: l === line,
      });
    }
  }

  return { rawError: msg, line, col, hint, snippetLines };
}

export function parseLooseJson(text: string): LooseJsonResult {
  const s = String(text ?? '')
    .replace(/^[\uFEFF\u200B-\u200D]+/, '')
    .trim();
  if (!s) {
    return {
      data: null,
      autoRepaired: false,
      diag: {
        rawError: 'Empty input',
        line: 0,
        col: 0,
        hint: '文件内容为空，请确认输入了有效的 JSON 或文本。',
        snippetLines: [],
      },
    };
  }

  try {
    return { data: JSON.parse(s), autoRepaired: false };
  } catch {
    // try loose extraction
  }

  let candidate = s;
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    candidate = fence[1].trim();
    try {
      return { data: JSON.parse(candidate), autoRepaired: true };
    } catch {
      // fall through
    }
  } else {
    const firstBrace = s.indexOf('{');
    const firstBracket = s.indexOf('[');
    let startIdx = -1;
    let endIdx = -1;
    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      startIdx = firstBrace;
      endIdx = s.lastIndexOf('}');
    } else if (firstBracket !== -1) {
      startIdx = firstBracket;
      endIdx = s.lastIndexOf(']');
    }
    if (startIdx !== -1 && endIdx > startIdx) {
      candidate = s.slice(startIdx, endIdx + 1);
      try {
        return { data: JSON.parse(candidate), autoRepaired: true };
      } catch {
        // fall through
      }
    }
  }

  try {
    const repaired = tryAutoRepairJson(candidate);
    const data = JSON.parse(repaired);
    return { data, autoRepaired: true };
  } catch (err) {
    return { data: null, autoRepaired: false, diag: buildJsonSyntaxDiag(candidate, err) };
  }
}

export interface InvalidImportItem {
  loc: string;
  id: string;
  q: string;
  reason: string;
}

export interface SanitizeStats {
  fixedIds: number;
  ignored: number;
  autoFixed: number;
  invalidItems: InvalidImportItem[];
}

export interface SanitizedImportResult {
  questions: Question[];
  grouped: Record<string, Record<string, Question[]>>;
  stats: SanitizeStats;
}

const UNSAFE_KEYS = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'toString',
  'valueOf',
  'hasOwnProperty',
]);

function stripCtrl(s: unknown): string {
  return String(s ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
}

function hashId(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return 'auto-' + (h >>> 0).toString(36);
}

export function sanitizeImportedBank(
  obj: unknown,
  defaultSub = '导入题目',
  defaultChap = '未分类',
): SanitizedImportResult {
  const allowed = new Set<QuestionType>(['mcq', 'multi', 'tf', 'fill']);
  const grouped: Record<string, Record<string, Question[]>> = {};
  const flat: Question[] = [];
  const seenIds = new Set<string>();
  const invalidItems: InvalidImportItem[] = [];
  let fixedIds = 0;
  let ignored = 0;
  let autoFixed = 0;

  if (!obj || typeof obj !== 'object') {
    return { questions: [], grouped, stats: { fixedIds, ignored, autoFixed, invalidItems } };
  }

  const groupFlatList = (arr: unknown[]): Record<string, Record<string, unknown[]>> => {
    const out: Record<string, Record<string, unknown[]>> = {};
    for (const q of arr) {
      if (!q || typeof q !== 'object') {
        ignored++;
        continue;
      }
      const r = q as Record<string, unknown>;
      const sRaw = r.sub || r.subject || r.category || r.course || '';
      const cRaw = r.chap || r.chapter || r.section || r.unit || '';
      const sClean = stripCtrl(sRaw) || defaultSub;
      const cClean = stripCtrl(cRaw) || defaultChap;
      const s = UNSAFE_KEYS.has(sClean) ? defaultSub : sClean;
      const c = UNSAFE_KEYS.has(cClean) ? defaultChap : cClean;
      if (!out[s]) out[s] = {};
      if (!out[s][c]) out[s][c] = [];
      out[s][c].push(r);
    }
    return out;
  };

  let bank: Record<string, unknown>;
  const rawObj = obj as Record<string, unknown>;
  if (Array.isArray(obj)) {
    bank = groupFlatList(obj);
    autoFixed++;
  } else if (
    Array.isArray(rawObj.questions || rawObj.data || rawObj.items || rawObj.list)
  ) {
    const arr = (rawObj.questions || rawObj.data || rawObj.items || rawObj.list) as unknown[];
    bank = groupFlatList(arr);
    autoFixed++;
  } else if (
    typeof rawObj.q === 'string' ||
    typeof rawObj.question === 'string' ||
    typeof rawObj.stem === 'string'
  ) {
    bank = groupFlatList([rawObj]);
    autoFixed++;
  } else {
    bank = {};
    for (const [k, v] of Object.entries(rawObj)) {
      if (UNSAFE_KEYS.has(k)) {
        ignored++;
        continue;
      }
      if (Array.isArray(v)) {
        bank[k] = { [defaultChap]: v };
        autoFixed++;
      } else if (v && typeof v === 'object') {
        bank[k] = v;
      }
    }
  }

  const recordInvalid = (
    sub: string,
    chap: string,
    idx: number,
    copy: Record<string, unknown>,
    reason: string,
  ) => {
    ignored++;
    if (invalidItems.length < 50) {
      const qPreview = stripCtrl(copy.q || copy.question || copy.stem || '').slice(0, 60);
      invalidItems.push({
        loc: `${sub} / ${chap} #${idx + 1}`,
        id: typeof copy.id === 'string' && copy.id ? copy.id : `#${idx + 1}`,
        q: qPreview || '（无题干内容）',
        reason,
      });
    }
  };

  const TYPE_ALIAS: Record<string, QuestionType> = {
    mcq: 'mcq',
    single: 'mcq',
    singlechoice: 'mcq',
    单选: 'mcq',
    单选题: 'mcq',
    multi: 'multi',
    multiple: 'multi',
    multiplechoice: 'multi',
    多选: 'multi',
    多选题: 'multi',
    tf: 'tf',
    judge: 'tf',
    boolean: 'tf',
    truefalse: 'tf',
    判断: 'tf',
    判断题: 'tf',
    fill: 'fill',
    blank: 'fill',
    completion: 'fill',
    填空: 'fill',
    填空题: 'fill',
  };

  for (const [rawSub, chapDict] of Object.entries(bank)) {
    if (!chapDict || typeof chapDict !== 'object' || Array.isArray(chapDict)) continue;
    const sub = stripCtrl(rawSub);
    if (!sub || UNSAFE_KEYS.has(sub)) {
      ignored++;
      continue;
    }

    for (const [rawChap, arr] of Object.entries(chapDict as Record<string, unknown>)) {
      if (!Array.isArray(arr)) continue;
      const chap = stripCtrl(rawChap);
      if (!chap || UNSAFE_KEYS.has(chap)) {
        ignored += arr.length;
        continue;
      }

      const cleanedQs: Question[] = [];
      arr.forEach((rawItem, idx) => {
        if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
          recordInvalid(sub, chap, idx, {}, '题目条目不是合法对象');
          return;
        }
        const copy: Record<string, unknown> = { ...(rawItem as Record<string, unknown>) };

        if (copy.q == null && copy.question != null) {
          copy.q = copy.question;
          autoFixed++;
        }
        if (copy.q == null && copy.stem != null) {
          copy.q = copy.stem;
          autoFixed++;
        }
        if (copy.q == null && copy.title != null) {
          copy.q = copy.title;
          autoFixed++;
        }
        if (copy.a == null && copy.answer != null) {
          copy.a = copy.answer;
          autoFixed++;
        }
        if (copy.a == null && copy.correct != null) {
          copy.a = copy.correct;
          autoFixed++;
        }
        if (copy.a == null && copy.ans != null) {
          copy.a = copy.ans;
          autoFixed++;
        }
        if (!Array.isArray(copy.o)) {
          if (Array.isArray(copy.options)) {
            copy.o = copy.options;
            autoFixed++;
          } else if (Array.isArray(copy.choices)) {
            copy.o = copy.choices;
            autoFixed++;
          }
        }
        if (copy.d == null) {
          if (copy.desc != null) copy.d = copy.desc;
          else if (copy.analysis != null) copy.d = copy.analysis;
          else if (copy.explanation != null) copy.d = copy.explanation;
        }

        if (Array.isArray(copy.a)) {
          const isOpts = Array.isArray(copy.o) && copy.o.length >= 2;
          copy.a = copy.a
            .map((x) => String(x ?? '').trim())
            .filter(Boolean)
            .join(isOpts ? '' : '|');
          autoFixed++;
        } else if (typeof copy.a === 'boolean') {
          copy.a = copy.a ? 'T' : 'F';
          autoFixed++;
        } else if (typeof copy.a === 'number') {
          copy.a = String(copy.a);
        }

        if (typeof copy.type === 'string') {
          const tl = copy.type.trim().toLowerCase();
          if (TYPE_ALIAS[tl]) {
            if (copy.type !== TYPE_ALIAS[tl]) autoFixed++;
            copy.type = TYPE_ALIAS[tl];
          }
        } else if (!copy.type) {
          const ansRaw = String(copy.a ?? '').trim();
          if (Array.isArray(copy.o) && copy.o.length >= 2) {
            const lettersOnly = ansRaw.replace(/[^A-Za-z]/g, '');
            copy.type = lettersOnly.length > 1 ? 'multi' : 'mcq';
            autoFixed++;
          } else if (
            ['t', 'f', 'true', 'false', '对', '错', '正确', '错误', '√', '×', '是', '否'].includes(
              ansRaw.toLowerCase(),
            )
          ) {
            copy.type = 'tf';
            autoFixed++;
          } else if (ansRaw) {
            copy.type = 'fill';
            autoFixed++;
          }
        }

        const qType = copy.type as QuestionType;
        if (!allowed.has(qType)) {
          recordInvalid(
            sub,
            chap,
            idx,
            copy,
            `不支持的题型 "${String(copy.type || '空')}"（仅支持 mcq/multi/tf/fill）`,
          );
          return;
        }

        const qText = String(copy.q ?? '').trim();
        let aText = String(copy.a ?? '').trim();

        if (!qText) {
          recordInvalid(sub, chap, idx, copy, '缺少题干内容 (q)');
          return;
        }
        if (qText.length > 20000) {
          recordInvalid(sub, chap, idx, copy, '题干过长（超过 20000 字符）');
          return;
        }
        if (!aText) {
          recordInvalid(sub, chap, idx, copy, '缺少正确答案 (a)');
          return;
        }

        let opts: string[] = [];
        if (qType === 'mcq' || qType === 'multi') {
          if (!Array.isArray(copy.o)) {
            recordInvalid(sub, chap, idx, copy, '选择题缺少选项列表 (o)');
            return;
          }
          opts = copy.o
            .map((opt) =>
              opt == null
                ? ''
                : String(opt)
                    .replace(/^\s*[A-ZＡ-Ｚ][.．、，)\）]\s*/, '')
                    .trim(),
            )
            .filter((s) => s.length > 0);
          if (opts.length < 2) {
            recordInvalid(sub, chap, idx, copy, `有效选项不足 2 个（当前 ${opts.length} 个）`);
            return;
          }
          if (opts.length > 16) {
            recordInvalid(sub, chap, idx, copy, `选项过多（${opts.length} 个，上限 16 个）`);
            return;
          }
          const maxLetter = String.fromCharCode(64 + opts.length);
          if (qType === 'mcq') {
            let aUp = aText.toUpperCase();
            const leadMatch = aUp.match(
              /^(?:选项|ANSWER\s*[:：]?\s*)?([A-Z])(?:[.．、，)\）\s].*)?$/i,
            );
            if (leadMatch && leadMatch[1].toUpperCase() <= maxLetter && aUp.length > 1) {
              aUp = leadMatch[1].toUpperCase();
              autoFixed++;
            } else if (!/^[A-Z]$/.test(aUp)) {
              const matchIdx = opts.findIndex((o) => o.toLowerCase() === aText.toLowerCase());
              if (matchIdx >= 0) {
                aUp = String.fromCharCode(65 + matchIdx);
                autoFixed++;
              }
            }
            if (!/^[A-Z]$/.test(aUp) || aUp > maxLetter) {
              recordInvalid(
                sub,
                chap,
                idx,
                copy,
                `单选题答案 "${aText}" 不在有效选项范围 A–${maxLetter} 内`,
              );
              return;
            }
            aText = aUp;
          } else {
            const cleanedLetters = aText.toUpperCase().replace(/[,，、\s;/|]+/g, '');
            if (!/^[A-Z]+$/.test(cleanedLetters)) {
              recordInvalid(sub, chap, idx, copy, `多选题答案 "${aText}" 必须是字母组合（如 AB）`);
              return;
            }
            const uniqSorted = Array.from(new Set(cleanedLetters.split(''))).sort();
            if (uniqSorted.some((ch) => ch > maxLetter)) {
              recordInvalid(
                sub,
                chap,
                idx,
                copy,
                `多选题答案 "${aText}" 含有超出范围 A–${maxLetter} 的字母`,
              );
              return;
            }
            const joined = uniqSorted.join('');
            if (joined !== aText) autoFixed++;
            aText = joined;
          }
        } else if (qType === 'tf') {
          const low = aText.toLowerCase();
          const okInputs = ['t', 'true', 'y', 'yes', '对', '正确', '是', '1', '√', '✓', '✔'];
          const noInputs = ['f', 'false', 'n', 'no', '错', '错误', '否', '0', '×', '✕', '✖'];
          if (okInputs.includes(low)) {
            if (aText !== 'T') autoFixed++;
            aText = 'T';
          } else if (noInputs.includes(low)) {
            if (aText !== 'F') autoFixed++;
            aText = 'F';
          } else {
            recordInvalid(sub, chap, idx, copy, `判断题答案 "${aText}" 无法识别`);
            return;
          }
        } else if (qType === 'fill') {
          const variants = aText
            .split('|')
            .map((s) => s.trim())
            .filter(Boolean);
          if (!variants.length) {
            recordInvalid(sub, chap, idx, copy, '填空题答案为空');
            return;
          }
          aText = variants.join('|');
        }

        if (aText.length > 500) {
          recordInvalid(sub, chap, idx, copy, '答案过长（超过 500 字符）');
          return;
        }

        let qid = typeof copy.id === 'string' ? copy.id.trim() : '';
        if (!qid) {
          qid = hashId(JSON.stringify([sub, chap, qType, qText, aText, opts]));
          fixedIds++;
        } else if (seenIds.has(qid)) {
          const base = qid;
          let n = 2;
          while (seenIds.has(`${base}-d${n}`)) n++;
          qid = `${base}-d${n}`;
          fixedIds++;
        }
        seenIds.add(qid);

        const qObj: Question = {
          id: qid,
          type: qType,
          q: qText,
          o: opts,
          a: aText,
          sub,
          chap,
          d: String(copy.d ?? ''),
        };

        if (Array.isArray(copy.media)) {
          const validMedia = copy.media.filter((m) => {
            if (!m || typeof m !== 'object') return false;
            const mr = m as Record<string, unknown>;
            if (typeof mr.key !== 'string' || !mr.key.trim()) return false;
            const mt = mr.type || 'img';
            if (mt === 'table') {
              return typeof mr.html === 'string' && /<table[\s>]/i.test(mr.html) && mr.html.length <= 50000;
            }
            return typeof mr.src === 'string' && SAFE_IMG_URL_RE.test(mr.src) && mr.src.length <= 500000;
          });
          if (validMedia.length > 0) qObj.media = validMedia as Question['media'];
        }
        if (typeof copy.psg === 'string' && copy.psg) qObj.psg = copy.psg;
        if (typeof copy._editedAt === 'number' && Number.isFinite(copy._editedAt)) {
          qObj._editedAt = copy._editedAt;
        }
        if (typeof copy.selfCheck === 'boolean') qObj.selfCheck = copy.selfCheck;

        cleanedQs.push(qObj);
        flat.push(qObj);
      });

      if (cleanedQs.length > 0) {
        if (!grouped[sub]) grouped[sub] = {};
        grouped[sub][chap] = (grouped[sub][chap] || []).concat(cleanedQs);
      }
    }
  }

  return {
    questions: flat,
    grouped,
    stats: { fixedIds, ignored, autoFixed, invalidItems },
  };
}

/**
 * Pure text / DOCX / PDF question parser:
 * Supports numbered blocks ("1. ...", "1、...", "(1) ...") with options A./A、,
 * answer lines ("答案：A" / "Answer: AC" / "对" / "错"), and explanations ("解析：...").
 */
export function parsePlainTextQuestions(
  rawText: string,
  defaultSub = '导入题目',
  defaultChap = '文本解析',
): SanitizedImportResult {
  const normalized = String(rawText ?? '').replace(/\r/g, '');
  const lines = normalized.split('\n');
  const blocks: string[] = [];
  let cur: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (cur.length) cur.push('');
      continue;
    }
    if (/^(?:\d{1,4}[.、．)\）]|[(（]\d{1,4}[)）]|第\d{1,4}题)\s*\S/.test(trimmed) && cur.length > 0) {
      blocks.push(cur.join('\n').trim());
      cur = [trimmed];
    } else {
      cur.push(trimmed);
    }
  }
  if (cur.length) blocks.push(cur.join('\n').trim());

  const parsedItems: Array<Record<string, unknown>> = [];
  for (const block of blocks) {
    if (!block) continue;
    const bLines = block
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (!bLines.length) continue;

    // Extract answer and explanation lines from bottom/middle
    let answer = '';
    let explanation = '';
    const opts: string[] = [];
    const stemParts: string[] = [];

    for (const l of bLines) {
      const ansMatch = l.match(/^(?:【?答案】?|参考答案|正确答案|Answer)\s*[:：]?\s*(.+)$/i);
      if (ansMatch) {
        answer = ansMatch[1].trim();
        continue;
      }
      const expMatch = l.match(/^(?:【?解析】?|答案解析|详解|Explanation|Analysis)\s*[:：]?\s*(.+)$/i);
      if (expMatch) {
        explanation = expMatch[1].trim();
        continue;
      }
      const optMatch = l.match(/^([A-P])[.．、)\）\s]\s*(.+)$/);
      if (optMatch) {
        opts.push(optMatch[2].trim());
        continue;
      }
      if (!opts.length && !answer && !explanation) {
        stemParts.push(l);
      } else if (explanation) {
        explanation += '\n' + l;
      } else if (opts.length) {
        opts[opts.length - 1] += ' ' + l;
      }
    }

    let qText = stemParts.join('\n').replace(/^(?:\d{1,4}[.、．)\）]|[(（]\d{1,4}[)）]|第\d{1,4}题)\s*/, '').trim();
    // Inline answer in stem e.g. "( A )" or "（B）" if no explicit Answer: line found
    if (!answer) {
      const inlineMatch = qText.match(/[（(]\s*([A-Pa-p]+|[对错√×TFtf]{1,5})\s*[）)]\s*$/);
      if (inlineMatch) {
        answer = inlineMatch[1];
        qText = qText.slice(0, inlineMatch.index).trim() + ' ( )';
      }
    }

    if (!qText || !answer) continue;

    let type: QuestionType = 'mcq';
    if (opts.length >= 2) {
      const letters = answer.toUpperCase().replace(/[^A-P]/g, '');
      type = letters.length > 1 ? 'multi' : 'mcq';
    } else if (/^(t|f|true|false|对|错|正确|错误|√|×)$/i.test(answer)) {
      type = 'tf';
    } else {
      type = 'fill';
    }

    parsedItems.push({
      type,
      q: qText,
      o: opts,
      a: answer,
      d: explanation,
      sub: defaultSub,
      chap: defaultChap,
    });
  }

  return sanitizeImportedBank(parsedItems, defaultSub, defaultChap);
}

export async function extractTextFromFile(file: File): Promise<{ kind: 'json' | 'text'; text: string }> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.json')) {
    return { kind: 'json', text: await file.text() };
  }
  if (name.endsWith('.docx')) {
    const mammoth = await import('mammoth');
    const arrayBuffer = await file.arrayBuffer();
    const res = await mammoth.extractRawText({ arrayBuffer });
    return { kind: 'text', text: res.value || '' };
  }
  if (name.endsWith('.pdf')) {
    const pdfjs = await import('pdfjs-dist');
    const workerUrl = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url);
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.toString();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items
        .map((it) => ('str' in it ? it.str : ''))
        .filter(Boolean);
      pages.push(strings.join(' '));
    }
    return { kind: 'text', text: pages.join('\n\n') };
  }
  const text = await file.text();
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('```')) {
    return { kind: 'json', text };
  }
  return { kind: 'text', text };
}

export function findSimilarPairs(
  existing: Question[],
  incoming: Question[],
): Array<{ existing: Question; incoming: Question; score: number }> {
  const SIMILARITY_THRESHOLD = 0.85;
  const MIN_NORM_LEN = 6;
  const CAP = 100;
  const bySub = new Map<string, Array<{ q: Question; norm: string }>>();
  for (const q of existing) {
    const norm = normalizeQuestionText(q.q);
    if (norm.length < MIN_NORM_LEN) continue;
    const arr = bySub.get(q.sub) || [];
    arr.push({ q, norm });
    bySub.set(q.sub, arr);
  }

  const out: Array<{ existing: Question; incoming: Question; score: number }> = [];
  for (const inc of incoming) {
    if (out.length >= CAP) break;
    const normNew = normalizeQuestionText(inc.q);
    if (normNew.length < MIN_NORM_LEN) continue;
    const cands = bySub.get(inc.sub) || [];
    for (const c of cands) {
      if (c.q.id === inc.id) continue;
      if (c.norm === normNew) {
        out.push({ existing: c.q, incoming: inc, score: 1 });
        break;
      }
      const maxLen = Math.max(c.norm.length, normNew.length);
      if (Math.abs(c.norm.length - normNew.length) > maxLen * (1 - SIMILARITY_THRESHOLD)) continue;
      if (c.norm.includes(normNew) || normNew.includes(c.norm)) {
        const minLen = Math.min(c.norm.length, normNew.length);
        const ratio = minLen / maxLen;
        if (ratio >= SIMILARITY_THRESHOLD) {
          out.push({ existing: c.q, incoming: inc, score: ratio });
          break;
        }
      }
    }
  }
  return out;
}

export function exportBankJson(questions: Question[], filename?: string): void {
  const out: Record<string, Record<string, Array<Omit<Question, 'sub' | 'chap'>>>> = {};
  for (const q of questions) {
    if (!out[q.sub]) out[q.sub] = {};
    if (!out[q.sub][q.chap]) out[q.sub][q.chap] = [];
    const { sub: _s, chap: _c, ...rest } = q;
    out[q.sub][q.chap].push(rest);
  }
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `QuestionBank_${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function openPrintableSheet(
  questions: Question[],
  opts: { title?: string; showAnswers?: boolean; showExplanations?: boolean } = {},
): boolean {
  const win = window.open('', '_blank');
  if (!win) return false;

  const grouped: Record<string, Record<string, Question[]>> = {};
  for (const q of questions) {
    if (!grouped[q.sub]) grouped[q.sub] = {};
    if (!grouped[q.sub][q.chap]) grouped[q.sub][q.chap] = [];
    grouped[q.sub][q.chap].push(q);
  }

  const typeLabel: Record<string, string> = {
    mcq: '单选',
    multi: '多选',
    tf: '判断',
    fill: '填空',
  };

  let n = 0;
  const parts: string[] = [];
  for (const sub of Object.keys(grouped).sort(naturalCompare)) {
    const chaps = grouped[sub];
    const subCount = Object.values(chaps).reduce((acc, a) => acc + a.length, 0);
    parts.push(`<section><h2>${escapeHtml(sub)} <span>(${subCount})</span></h2>`);
    for (const chap of Object.keys(chaps).sort(naturalCompare)) {
      const arr = chaps[chap];
      parts.push(`<h3>${escapeHtml(chap)} <span>(${arr.length})</span></h3>`);
      for (const q of arr) {
        n++;
        const mediaHtml = Array.isArray(q.media)
          ? q.media
              .map((m) =>
                m.type === 'table'
                  ? `<div class="media-table">${sanitizeTableHTML(m.html)}</div>`
                  : SAFE_IMG_URL_RE.test(m.src)
                    ? `<img class="media-img" src="${escapeHtml(m.src)}" alt="${escapeHtml(m.alt || m.key)}">`
                    : '',
              )
              .join('')
          : '';
        const optsHtml =
          q.type === 'mcq' || q.type === 'multi'
            ? (q.o || [])
                .map((o, i) => `<div class="opt">${String.fromCharCode(65 + i)}. ${escapeHtml(o)}</div>`)
                .join('')
            : '';
        const ansText =
          q.type === 'tf'
            ? q.a === 'T'
              ? '√ 正确'
              : '× 错误'
            : q.type === 'fill'
              ? q.a.split('|').join(' / ')
              : q.a;
        const ansHtml = opts.showAnswers
          ? `<div class="ans"><b>答案：</b>${escapeHtml(ansText)}${
              opts.showExplanations && q.d ? `<div class="exp"><b>解析：</b>${escapeHtml(q.d)}</div>` : ''
            }</div>`
          : `<div class="myans">作答：________________________</div>`;
        parts.push(
          `<div class="q"><div class="stem"><b>${n}. [${typeLabel[q.type] || q.type}]</b> ${escapeHtml(
            q.q,
          )}</div>${mediaHtml}${optsHtml}${ansHtml}</div>`,
        );
      }
    }
    parts.push('</section>');
  }

  const title = escapeHtml(opts.title || '题库打印卷');
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  body { font: 10.5pt/1.65 "InterVar", "PingFang SC", "Microsoft YaHei", sans-serif; color: #18181b; margin: 0; background: #f7f6f2; }
  .bar { position: sticky; top: 0; display: flex; gap: 10px; align-items: center; padding: 10px 18px; background: #fff; border-bottom: 1px solid #e5e2da; }
  .bar button { padding: 6px 14px; border-radius: 8px; border: 1px solid #0f766e; background: #0f766e; color: #fff; font-weight: 600; cursor: pointer; }
  .bar button.ghost { background: #fff; color: #18181b; border-color: #d4d4d8; }
  .sheet { max-width: 185mm; margin: 14px auto; padding: 16px 20px; background: #fff; border-radius: 10px; }
  h1 { text-align: center; font-size: 18pt; margin: 0 0 6px; }
  .meta { text-align: center; font-size: 9.5pt; color: #64646e; margin-bottom: 16px; border-bottom: 2px solid #18181b; padding-bottom: 10px; }
  h2 { font-size: 13pt; border-bottom: 1.5px solid #18181b; padding-bottom: 3px; margin: 18px 0 6px; }
  h2 span, h3 span { font-size: 9pt; color: #64646e; font-weight: normal; }
  h3 { font-size: 11pt; margin: 12px 0 4px; color: #27272a; }
  .q { padding: 6px 0; border-top: 1px solid #ecebe5; break-inside: avoid; }
  .opt { margin-left: 16px; }
  .ans { margin: 4px 0 0 16px; font-size: 9.5pt; color: #0f766e; }
  .exp { color: #52525b; margin-top: 2px; }
  .myans { margin: 4px 0 0 16px; font-size: 9.5pt; color: #71717a; }
  .media-img { max-width: 55%; height: auto; margin: 6px 0; border-radius: 4px; border: 1px solid #e4e4e7; }
  .media-table table { border-collapse: collapse; margin: 6px 0; }
  .media-table th, .media-table td { border: 1px solid #a1a1aa; padding: 3px 8px; }
  @media print { .bar { display: none; } body { background: #fff; } .sheet { margin: 0; padding: 0; border-radius: 0; } }
</style>
</head>
<body>
  <div class="bar no-print">
    <button onclick="window.print()">打印 / 另存为 PDF</button>
    <button class="ghost" onclick="window.close()">关闭</button>
    <span style="font-size:12px;color:#64646e">共 ${n} 道题</span>
  </div>
  <div class="sheet">
    <h1>${title}</h1>
    <div class="meta">共 ${n} 题 | 生成于 ${new Date().toISOString().slice(0, 10)}</div>
    ${parts.join('\n')}
  </div>
</body>
</html>`;

  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
}

export const BANK_TEMPLATE_JSON = JSON.stringify(
  {
    计算机网络: {
      '第一章 概述': [
        {
          id: 'net-101',
          type: 'mcq',
          q: 'HTTP 协议默认使用的 TCP 端口号是？',
          o: ['21', '22', '80', '443'],
          a: 'C',
          d: 'HTTP 默认使用 80 端口，HTTPS 默认使用 443 端口。',
        },
        {
          id: 'net-102',
          type: 'multi',
          q: '以下哪些协议属于传输层协议？',
          o: ['TCP', 'IP', 'UDP', 'ICMP'],
          a: 'AC',
          d: 'TCP 与 UDP 位于 OSI/TCP-IP 传输层；IP 与 ICMP 位于网络层。',
        },
        {
          id: 'net-103',
          type: 'tf',
          q: 'TCP 提供面向连接的可靠字节流服务。',
          o: [],
          a: 'T',
          d: 'TCP 通过三次握手建立连接，并提供确认重传与流量控制。',
        },
        {
          id: 'net-104',
          type: 'fill',
          q: '传输控制协议的英文缩写是 __。',
          o: [],
          a: 'TCP|传输控制协议',
          d: 'TCP = Transmission Control Protocol。',
        },
      ],
    },
  },
  null,
  2,
);

export const AI_IMPORT_PROMPT = `请把下面的题目转换成标准 JSON 题库格式。要求：
1. 顶层结构为 { "科目名": { "章节名": [ 题目数组 ] } }
2. 每道题包含字段：
   - id: 唯一字符串（如 "subj-101"）
   - type: "mcq"（单选）| "multi"（多选）| "tf"（判断）| "fill"（填空）
   - q: 题干文本（如有图片或表格用 [图1]、[表1] 占位，配合 media 数组）
   - o: 选项字符串数组（mcq/multi 必填，不带 A./B. 前缀；tf/fill 填 []）
   - a: 标准答案（mcq 填单个大写字母 "A"；multi 填按字母序拼接如 "AC"；tf 填 "T" 或 "F"；fill 多答案用 "|" 分隔如 "TCP|传输控制协议"）
   - d: 详细解析（字符串，可空）
3. 只输出合法 JSON，不要多余解释。`;
