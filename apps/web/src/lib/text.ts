import { pinyin } from 'pinyin-pro';
import type { MediaItem } from '@qs/shared';

const ZH_DIGIT_MAP: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};
const ZH_UNIT_MAP: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

export function zhNumToInt(zh: string): number | null {
  if (!zh) return null;
  let total = 0;
  let current = 0;
  for (let i = 0; i < zh.length; i++) {
    const ch = zh[i];
    if (ch in ZH_DIGIT_MAP) {
      current = ZH_DIGIT_MAP[ch];
    } else if (ch in ZH_UNIT_MAP) {
      const u = ZH_UNIT_MAP[ch];
      total += (current === 0 ? 1 : current) * u;
      current = 0;
    } else {
      return null;
    }
  }
  return total + current;
}

function normalizeForSort(str: string): string {
  let s = String(str ?? '').trim();
  s = s.replace(/第([零〇一二两三四五六七八九十百千]+)\s*([章节课单元部分篇讲])/g, (m, zh, unit) => {
    const n = zhNumToInt(zh);
    return n !== null ? `第${n}${unit}` : m;
  });
  s = s.replace(/^([（(]?)\s*([零〇一二两三四五六七八九十百千]+)\s*([)）、.．\s])/, (m, pre, zh, suf) => {
    const n = zhNumToInt(zh);
    return n !== null ? `${pre}${n}${suf}` : m;
  });
  return s;
}

export function naturalCompare(a: string, b: string): number {
  return normalizeForSort(a).localeCompare(normalizeForSort(b), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

export function isChapterListOutOfOrder(chapters: string[]): boolean {
  if (!Array.isArray(chapters) || chapters.length < 2) return false;
  const numberedRe =
    /(?:^|\b)(?:chapter|chap|ch|unit|part|section|lesson|module|week|lecture)\s*\.?\s*\d+|第\s*[0-9零〇一二两三四五六七八九十百千]+\s*[章节课单元部分篇讲]|^\s*[（(]?[0-9零〇一二两三四五六七八九十]+[)）、.．\s-]/i;
  const numberedCount = chapters.filter((c) => numberedRe.test(String(c || ''))).length;
  if (numberedCount < 2) return false;
  const sorted = [...chapters].sort(naturalCompare);
  return chapters.some((c, i) => c !== sorted[i]);
}

export function toPinyinStr(text: string): string {
  if (!text) return '';
  try {
    return pinyin(text, { toneType: 'none', separator: '' }).toLowerCase();
  } catch {
    return String(text).toLowerCase();
  }
}

export function escapeHtml(text: unknown): string {
  if (text == null) return '';
  return String(text).replace(/[&<>"']/g, (m) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[m] || m;
  });
}

export function editDistance(a: string, b: string, cutoff = Infinity): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = new Array<number>(n + 1);
    cur[0] = i;
    let rowMin = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      cur[j] =
        ai === b.charCodeAt(j - 1)
          ? prev[j - 1]
          : 1 + Math.min(prev[j], cur[j - 1], prev[j - 1]);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > cutoff) return cutoff + 1;
    prev = cur;
  }
  return prev[n];
}

export function fuzzyMatch(text: string, query: string): boolean {
  if (!query || query.length < 3) return false;
  const tolerance = Math.max(1, Math.floor(query.length / 6));
  const latinQuery = /^[a-z0-9]+$/.test(query);
  const isAlnum = (c: string | undefined) => c !== undefined && /[a-z0-9]/.test(c);
  const low = text.toLowerCase();

  for (let i = 0; i <= low.length - query.length + tolerance; i++) {
    if (latinQuery && low[i] && /[a-z]/.test(low[i]) && i > 0 && isAlnum(low[i - 1])) {
      continue;
    }
    const sub = low.substring(i, i + query.length);
    if (editDistance(sub, query, tolerance) <= tolerance) return true;
  }
  return false;
}

export function matchesSearchQuery(text: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (!text) return false;
  if (text.toLowerCase().includes(q)) return true;
  if (/^[a-z0-9]+$/i.test(q) && toPinyinStr(text).includes(q)) return true;
  return fuzzyMatch(text, q);
}

export interface TextSegment {
  text: string;
  hit: boolean;
}

export function highlightSegments(text: string, query: string): TextSegment[] {
  if (!text) return [];
  const q = query.trim();
  if (!q) return [{ text, hit: false }];

  const isPinyin = /^[a-z0-9]+$/i.test(q);
  if (isPinyin) {
    const pq = q.toLowerCase();
    const pairs: Array<{ char: string; py: string }> = [];
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (/[\u4e00-\u9fff]/.test(ch)) {
        const py = pinyin(ch, { toneType: 'none', type: 'string' }).replace(/\s/g, '').toLowerCase();
        pairs.push({ char: ch, py });
      } else {
        pairs.push({ char: ch, py: ch.toLowerCase() });
      }
    }

    const ranges: Array<[number, number]> = [];
    for (let i = 0; i < pairs.length; i++) {
      let combined = '';
      for (let j = i; j < pairs.length; j++) {
        combined += pairs[j].py;
        if (combined === pq) {
          ranges.push([i, j]);
          break;
        }
        if (combined.length > pq.length) {
          const withoutLast = combined.slice(0, combined.length - pairs[j].py.length);
          const remaining = pq.slice(withoutLast.length);
          if (withoutLast === pq.slice(0, withoutLast.length) && pairs[j].py.startsWith(remaining)) {
            ranges.push([i, j]);
          }
          break;
        }
        if (!pq.startsWith(combined)) break;
      }
    }

    if (ranges.length > 0) {
      const hitSet = new Set<number>();
      for (const [s, e] of ranges) {
        for (let k = s; k <= e; k++) hitSet.add(k);
      }
      const segs: TextSegment[] = [];
      let buf = '';
      let curHit = hitSet.has(0);
      for (let i = 0; i < text.length; i++) {
        const h = hitSet.has(i);
        if (h !== curHit && buf) {
          segs.push({ text: buf, hit: curHit });
          buf = '';
        }
        curHit = h;
        buf += text[i];
      }
      if (buf) segs.push({ text: buf, hit: curHit });
      return segs;
    }
  }

  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const reg = new RegExp(`(${escaped})`, 'gi');
  const segs: TextSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = reg.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segs.push({ text: text.slice(lastIndex, match.index), hit: false });
    }
    segs.push({ text: match[0], hit: true });
    lastIndex = match.index + match[0].length;
    if (match[0].length === 0) reg.lastIndex++;
  }
  if (lastIndex < text.length) {
    segs.push({ text: text.slice(lastIndex), hit: false });
  }
  return segs.length ? segs : [{ text, hit: false }];
}

const ALLOWED_TABLE_TAGS = new Set([
  'TABLE',
  'THEAD',
  'TBODY',
  'TFOOT',
  'TR',
  'TH',
  'TD',
  'CAPTION',
  'COLGROUP',
  'COL',
]);

export function sanitizeTableHTML(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.body.querySelector('table');
  if (!root) return escapeHtml(String(html)).slice(0, 500);

  const clean = (node: Node): string => {
    const out: string[] = [];
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        out.push(escapeHtml(child.textContent));
        continue;
      }
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      const tag = el.tagName;
      if (!ALLOWED_TABLE_TAGS.has(tag)) {
        out.push(escapeHtml(el.textContent));
        continue;
      }
      let attrs = '';
      if (tag === 'TD' || tag === 'TH') {
        const cs = el.getAttribute('colspan');
        if (cs) attrs += ` colspan="${Math.max(1, parseInt(cs, 10) || 1)}"`;
        const rs = el.getAttribute('rowspan');
        if (rs) attrs += ` rowspan="${Math.max(1, parseInt(rs, 10) || 1)}"`;
      }
      out.push(`<${tag.toLowerCase()}${attrs}>${clean(el)}</${tag.toLowerCase()}>`);
    }
    return out.join('');
  };

  return `<table>${clean(root)}</table>`;
}

export const SAFE_IMG_URL_RE = /^(https:\/\/|data:image\/(?:png|jpe?g|gif|webp);base64,)/i;

export type MediaSegment =
  | { kind: 'text'; text: string }
  | { kind: 'img'; key: string; src: string; alt: string }
  | { kind: 'table'; key: string; html: string; caption?: string };

export function parseMediaSegments(text: string, media?: MediaItem[]): MediaSegment[] {
  const str = String(text ?? '');
  if (!Array.isArray(media) || media.length === 0) {
    return str ? [{ kind: 'text', text: str }] : [];
  }

  const map = new Map<string, MediaItem>();
  for (const m of media) {
    if (m && typeof m.key === 'string') map.set(m.key, m);
  }

  const rx = /\[(图|表|fig|figure|table|image|img)\s*(\d+)\]/gi;
  const segments: MediaSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = rx.exec(str)) !== null) {
    const kl = match[1].toLowerCase();
    const kk =
      kl === '图' || kl === 'image' || kl === 'img' || kl === 'fig' || kl === 'figure'
        ? '图'
        : kl === '表' || kl === 'table'
          ? '表'
          : kl;
    const key = kk + match[2];
    const item = map.get(key);
    if (!item) continue;

    if (match.index > lastIndex) {
      segments.push({ kind: 'text', text: str.slice(lastIndex, match.index) });
    }

    if (item.type === 'table' && typeof item.html === 'string') {
      segments.push({
        kind: 'table',
        key,
        html: sanitizeTableHTML(item.html),
        caption: item.caption,
      });
      lastIndex = match.index + match[0].length;
    } else if ('src' in item && typeof item.src === 'string' && SAFE_IMG_URL_RE.test(item.src)) {
      segments.push({
        kind: 'img',
        key,
        src: item.src,
        alt: item.alt || key,
      });
      lastIndex = match.index + match[0].length;
    }
  }

  if (lastIndex < str.length) {
    segments.push({ kind: 'text', text: str.slice(lastIndex) });
  }
  return segments;
}

export function localDayKey(ts: number | Date): string {
  const d = ts instanceof Date ? ts : new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

export function normalizeQuestionText(text: string): string {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    .replace(/[\s\u3000]/g, '')
    .replace(/[，。,.、；;！!？?()[\]【】'"“”‘’]/g, '');
}
