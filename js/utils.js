export const utils = {
    toPinyinStr(text) {
        if (!text || typeof pinyinPro === 'undefined') return text ? String(text).toLowerCase() : '';
        return pinyinPro.pinyin(text, { toneType: 'none', separator: '' }).toLowerCase();
    },

    // 将中文数字（如「十二」「二十三」「一百零五」）转为阿拉伯数字字符串，供章节自然排序使用
    _zhNumToInt(zh) {
        if (!zh) return null;
        const map = { '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
        const units = { '十': 10, '百': 100, '千': 1000 };
        let total = 0;
        let current = 0;
        for (let i = 0; i < zh.length; i++) {
            const ch = zh[i];
            if (ch in map) {
                current = map[ch];
            } else if (ch in units) {
                const u = units[ch];
                total += (current === 0 ? 1 : current) * u;
                current = 0;
            } else {
                return null;
            }
        }
        return total + current;
    },

    _normalizeForSort(str) {
        let s = String(str == null ? '' : str).trim();
        // 归一「第X章/节/课/单元/部分/篇/讲」或开头的「一、」「（一）」中的中文数字
        s = s.replace(/第([零〇一二两三四五六七八九十百千]+)\s*([章节课单元部分篇讲])/g, (m, zh, unit) => {
            const n = this._zhNumToInt(zh);
            return n !== null ? `第${n}${unit}` : m;
        });
        s = s.replace(/^([（(]?)\s*([零〇一二两三四五六七八九十百千]+)\s*([)）、.．\s])/, (m, pre, zh, suf) => {
            const n = this._zhNumToInt(zh);
            return n !== null ? `${pre}${n}${suf}` : m;
        });
        return s;
    },

    naturalCompare(a, b) {
        const na = this._normalizeForSort(a);
        const nb = this._normalizeForSort(b);
        return na.localeCompare(nb, undefined, { numeric: true, sensitivity: 'base' });
    },

    // 检测章节列表是否存在明显的章节编号乱序（如 Chapter 2, 3, 4, 1）
    isChapterListOutOfOrder(chapters) {
        if (!Array.isArray(chapters) || chapters.length < 2) return false;
        const numberedRe = /(?:^|\b)(?:chapter|chap|ch|unit|part|section|lesson|module|week|lecture)\s*\.?\s*\d+|第\s*[0-9零〇一二两三四五六七八九十百千]+\s*[章节课单元部分篇讲]|^\s*[（(]?[0-9零〇一二两三四五六七八九十]+[)）、.．\s-]/i;
        const numberedCount = chapters.filter(c => numberedRe.test(String(c || ''))).length;
        if (numberedCount < 2) return false;
        const sorted = [...chapters].sort((a, b) => this.naturalCompare(a, b));
        return chapters.some((c, i) => c !== sorted[i]);
    },
    // ===== 题目富媒体（图片/表格）渲染 =====
    // 设计：题干中用 [图N] / [表N] 占位，JSON 的 media 数组提供内容：
    //   { type: 'img', key: '图1', src: 'https://...' 或 'data:image/...;base64,...', alt?: '' }
    //   { type: 'table', key: '表1', html: '<table>...</table>', caption?: '' }
    // 渲染时只输出白名单生成的标签，题干其余部分照旧 escapeHTML——XSS 面不扩大。
    // 用途：quiz 题干 / 题库列表 / 详情抽屉共用。
    renderMedia(text, media, opts) {
        const opts2 = opts || {};
        const list = Array.isArray(media) ? media : [];
        const map = new Map();
        for (const m of list) {
            if (!m || typeof m.key !== 'string') continue;
            map.set(m.key, m);
        }
        const esc = this.escapeHTML;
        // 阶段1：占位符替换为带哨兵的占位 token（防止后续 escapeHTML 破坏生成的标签）
        const tokens = [];
        let out = esc(String(text == null ? '' : text));
        out = out.replace(/\[(图|表|fig|figure|table|image|img)\s*(\d+)\]/gi, (raw, kind, num) => {
            const kl = kind.toLowerCase();
            const kk = (kl === '图' || kl === 'image' || kl === 'img' || kl === 'fig' || kl === 'figure') ? '图' : ((kl === '表' || kl === 'table') ? '表' : kl);
            const key = kk + num;
            const m = map.get(key);
            if (!m) return raw;   // 无对应 media → 占位符原样保留（用户能看到缺图标记）
            const idx = tokens.length;
            let tag = '';
            if ((m.type || 'img') === 'table' && typeof m.html === 'string') {
                // 表格 HTML 做白名单过滤：只保留 table/thead/tbody/tr/th/td/caption + 无属性或极简属性
                const clean = this.sanitizeTableHTML(m.html);
                tag = `<div class="media-table">${clean}</div>`;
            } else if (typeof m.src === 'string' && /^(https:\/\/|data:image\/(?:png|jpe?g|gif|webp);base64,)/i.test(m.src)) {
                const alt = esc(m.alt || key);
                tag = `<img src="${esc(m.src)}" alt="${alt}" class="media-img ${opts2.imgClass || ''}" loading="lazy">`;
            } else {
                return raw;
            }
            tokens.push(tag);
            return `\u0000MEDIA${idx}\u0000`;
        });
        // 阶段2：escapeHTML 已经做过（out 一开始就 esc 了）——但占位符替换发生在 esc 之后，
        // 这里直接把 token 换回标签（token 本身含 \u0000 不会被 esc 破坏，因为我们是在 esc 后替换）
        out = out.replace(/\u0000MEDIA(\d+)\u0000/g, (_, i) => tokens[parseInt(i, 10)] || '');
        if (opts2.wrap) return `<div class="${opts2.wrapClass || 'question-media'}">${out}</div>`;
        return out;
    },

    // 表格 HTML 白名单过滤：只允许表格相关标签，剥掉一切属性（防 onerror/onclick/style 注入）
    sanitizeTableHTML(html) {
        // 不能包一层 div 再取 firstElementChild：root 会是 DIV 而非 TABLE，
        // 恒走 fallback 整串转义（回归 bug）。直接在 body 里找 table 元素。
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const root = doc.body.querySelector('table');
        if (!root) return this.escapeHTML(String(html)).slice(0, 500);
        const ALLOWED = new Set(['TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'CAPTION', 'COLGROUP', 'COL']);
        const clean = (node) => {
            const out = [];
            for (const child of node.childNodes) {
                if (child.nodeType === 3) { out.push(this.escapeHTML(child.textContent)); continue; }
                if (child.nodeType !== 1) continue;
                const tag = child.tagName;
                if (!ALLOWED.has(tag)) { out.push(this.escapeHTML(child.textContent)); continue; }
                let attrs = '';
                if (tag === 'TD' || tag === 'TH') {
                    if (child.hasAttribute('colspan')) {
                        attrs += ` colspan="${Math.max(1, parseInt(child.getAttribute('colspan'), 10) || 1)}"`;
                    }
                    if (child.hasAttribute('rowspan')) {
                        attrs += ` rowspan="${Math.max(1, parseInt(child.getAttribute('rowspan'), 10) || 1)}"`;
                    }
                }
                out.push(`<${tag.toLowerCase()}${attrs}>` + clean(child) + `</${tag.toLowerCase()}>`);
            }
            return out.join('');
        };
        // clean 只序列化子节点——根 <table> 自身的开闭标签必须在这里补上，
        // 否则输出裸 <tr>，浏览器按无效 HTML 丢弃（第二个回归点）
        return '<table>' + clean(root) + '</table>';
    },

    // 找到元素真正的滚动容器。
    // 不能想当然：#lib-list 自己也写了 overflow-y-auto，但它没有固定高度
    //（scrollHeight == clientHeight），实际并不滚动；真正滚动的是外层 <main>。
    // 以前各处直接对 #lib-list 调 scrollTo，结果「回到顶部」按钮点了没反应。
    getScrollParent(el) {
        let p = el ? el.parentElement : null;
        while (p && p !== document.documentElement) {
            const ov = getComputedStyle(p).overflowY;
            if (/auto|scroll/.test(ov) && p.scrollHeight > p.clientHeight) return p;
            p = p.parentElement;
        }
        return document.scrollingElement || document.documentElement;
    },
    shuffle(array) {
        const arr = [...array];
        let currentIndex = arr.length, randomIndex;
        while (currentIndex != 0) {
            randomIndex = Math.floor(Math.random() * currentIndex);
            currentIndex--;
            [arr[currentIndex], arr[randomIndex]] = [arr[randomIndex], arr[currentIndex]];
        }
        return arr;
    },
    escapeHTML(text) {
        if (text == null) return '';
        return String(text).replace(/[&<>"']/g, function (m) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m] || m;
        });
    },
    highlightByPinyin(text, pinyinQuery) {
        if (!pinyinQuery || typeof text !== 'string' || typeof pinyinPro === 'undefined') return text;

        const charPinyinPairs = [];
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (/[\u4e00-\u9fff]/.test(char)) {
                charPinyinPairs.push({
                    char,
                    py: pinyinPro.pinyin(char, { toneType: 'none', type: 'string' }).replace(/\s/g, '').toLowerCase()
                });
            } else {
                charPinyinPairs.push({ char, py: char.toLowerCase() });
            }
        }

        const markRanges = [];

        for (let i = 0; i < charPinyinPairs.length; i++) {
            let combined = '';
            for (let j = i; j < charPinyinPairs.length; j++) {
                combined += charPinyinPairs[j].py;

                if (combined === pinyinQuery) {
                    markRanges.push([i, j]);
                    break;
                }

                if (combined.length > pinyinQuery.length) {
                    const withoutLast = combined.slice(0, combined.length - charPinyinPairs[j].py.length);
                    const remaining = pinyinQuery.slice(withoutLast.length);

                    if (withoutLast === pinyinQuery.slice(0, withoutLast.length)
                        && charPinyinPairs[j].py.startsWith(remaining)) {
                        markRanges.push([i, j]);
                    }
                    break;
                }

                if (!pinyinQuery.startsWith(combined)) break;
            }
        }

        if (markRanges.length === 0) return text;
        markRanges.sort((a, b) => a[0] - b[0]);
        const mergedRanges = [];
        markRanges.forEach(r => {
            if (!mergedRanges.length || r[0] > mergedRanges[mergedRanges.length - 1][1] + 1) {
                mergedRanges.push([r[0], r[1]]);
            } else {
                mergedRanges[mergedRanges.length - 1][1] = Math.max(mergedRanges[mergedRanges.length - 1][1], r[1]);
            }
        });

        const markedIndices = new Set();
        mergedRanges.forEach(([s, e]) => {
            for (let i = s; i <= e; i++) markedIndices.add(i);
        });

        let result = '';
        let inMark = false;
        charPinyinPairs.forEach(({ char }, i) => {
            if (markedIndices.has(i) && !inMark) {
                result += '<mark class="bg-yellow-200 dark:bg-yellow-700/50 rounded px-0.5 text-inherit">';
                inMark = true;
            }
            if (!markedIndices.has(i) && inMark) {
                result += '</mark>';
                inMark = false;
            }
            result += char;
        });
        if (inMark) result += '</mark>';

        return result;
    },
    highlight(text, query) {
        if (typeof text !== 'string') return text;
        if (!query) return this.escapeHTML(text);

        const isPinyinQuery = /^[a-z0-9]+$/i.test(query);
        if (isPinyinQuery && typeof pinyinPro !== 'undefined') {
            const pinyinResult = this.highlightByPinyin(text, query.toLowerCase());
            if (pinyinResult !== text) {
                const placeholderOpen = '__MARK_OPEN__';
                const placeholderClose = '__MARK_CLOSE__';
                const tmp = pinyinResult
                    .replace(/<mark[^>]*>/g, placeholderOpen)
                    .replace(/<\/mark>/g, placeholderClose);
                const escaped = this.escapeHTML(tmp);
                return escaped
                    .replace(new RegExp(placeholderOpen, 'g'), '<mark class="bg-yellow-200 dark:bg-yellow-700/50 rounded px-0.5 text-inherit">')
                    .replace(new RegExp(placeholderClose, 'g'), '</mark>');
            }
        }

        const escapedText = this.escapeHTML(text);
        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const reg = new RegExp(`(${escapedQuery})`, 'gi');
        return escapedText.replace(reg, '<mark class="bg-yellow-200 dark:bg-yellow-700/50 rounded px-0.5 text-inherit">$1</mark>');
    },

    // 导入清洗：剥控制字符、规范 tf/mcq/multi 答案、自动推断缺失题型、改写重复/缺失 ID、
    // 逐题拦截并记录损坏题目（stats.invalidItems），避免单道坏题导致整份题库连坐失败。
    sanitizeImportedBank(obj, stats) {
        const allowed = new Set(['mcq', 'multi', 'tf', 'fill']);
        const result = {};
        const seenIds = new Set();
        let fixedIds = 0;
        let ignored = 0;
        let autoFixed = 0;
        const invalidItems = [];
        const isEn = window.App && App.i18n && App.i18n.lang === 'en';
        const hashId = (s) => {
            let h = 5381;
            for (let i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) | 0; }
            return 'auto-' + (h >>> 0).toString(36);
        };
        if (!obj || typeof obj !== 'object') {
            if (stats) { stats.fixedIds = 0; stats.ignored = 0; stats.autoFixed = 0; stats.invalidItems = invalidItems; }
            return result;
        }
        const stripCtrl = (s) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
        const defSub = (window.App && typeof App.t === 'function') ? App.t('导入题目') : '导入题目';
        const defChap = (window.App && typeof App.t === 'function') ? App.t('未分类') : '未分类';
        const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']);

        const groupFlatList = (arr) => {
            const grouped = {};
            for (const q of arr) {
                if (!q || typeof q !== 'object') { ignored++; continue; }
                const sRaw = q.sub || q.subject || q.category || q.course || '';
                const cRaw = q.chap || q.chapter || q.section || q.unit || '';
                const sClean = (typeof sRaw === 'string' && stripCtrl(sRaw)) ? stripCtrl(sRaw) : defSub;
                const cClean = (typeof cRaw === 'string' && stripCtrl(cRaw)) ? stripCtrl(cRaw) : defChap;
                const s = unsafeKeys.has(sClean) ? defSub : sClean;
                const c = unsafeKeys.has(cClean) ? defChap : cClean;
                if (!Object.prototype.hasOwnProperty.call(grouped, s)) grouped[s] = {};
                if (!Object.prototype.hasOwnProperty.call(grouped[s], c)) grouped[s][c] = [];
                grouped[s][c].push(q);
            }
            return grouped;
        };

        // 形状归一化：支持顶层数组 [...]、{ questions/data/items/list: [...] }、
        // 单题对象 { q, a, ... }、以及 { 科目: [题] }（缺省章节层级）
        let bank = obj;
        if (Array.isArray(bank)) {
            bank = groupFlatList(bank);
            autoFixed++;
        } else if (Array.isArray(bank.questions || bank.data || bank.items || bank.list)) {
            bank = groupFlatList(bank.questions || bank.data || bank.items || bank.list);
            autoFixed++;
        } else if (typeof bank.q === 'string' || typeof bank.question === 'string' || typeof bank.stem === 'string') {
            bank = groupFlatList([bank]);
            autoFixed++;
        } else {
            const normalizedBank = {};
            for (const [k, v] of Object.entries(bank)) {
                if (unsafeKeys.has(k)) { ignored++; continue; }
                if (Array.isArray(v)) {
                    normalizedBank[k] = { [defChap]: v };
                    autoFixed++;
                } else if (v && typeof v === 'object') {
                    normalizedBank[k] = v;
                }
            }
            bank = normalizedBank;
        }

        const recordInvalid = (sub, chap, idx, copy, zhReason, enReason) => {
            ignored++;
            if (invalidItems.length < 50) {
                const qPreview = stripCtrl(copy && (copy.q || copy.question || copy.stem || '')).slice(0, 60);
                invalidItems.push({
                    loc: `${sub} / ${chap} #${idx + 1}`,
                    id: (copy && typeof copy.id === 'string' && copy.id) ? copy.id : `#${idx + 1}`,
                    q: qPreview || (isEn ? '(empty question text)' : '（无题干内容）'),
                    reason: isEn ? enReason : zhReason
                });
            }
        };

        for (const [rawSub, chapDict] of Object.entries(bank)) {
            if (!chapDict || typeof chapDict !== 'object' || Array.isArray(chapDict)) continue;
            const sub = stripCtrl(rawSub);
            if (!sub || unsafeKeys.has(sub)) { ignored++; continue; }
            const cleanedChaps = {};
            for (const [rawChap, arr] of Object.entries(chapDict)) {
                if (!Array.isArray(arr)) continue;
                const chap = stripCtrl(rawChap);
                if (!chap || unsafeKeys.has(chap)) { ignored += arr.length; continue; }
                const cleanedQs = [];
                arr.forEach((q, idx) => {
                    if (!q || typeof q !== 'object' || Array.isArray(q)) {
                        recordInvalid(sub, chap, idx, {}, '题目条目不是合法对象', 'Item is not a valid object');
                        return;
                    }
                    const copy = { ...q };
                    // 字段别名归一：AI 输出常用 question/answer/options/stem/choices 等写法
                    if (copy.q == null && copy.question != null) { copy.q = copy.question; autoFixed++; }
                    if (copy.q == null && copy.stem != null) { copy.q = copy.stem; autoFixed++; }
                    if (copy.q == null && copy.title != null) { copy.q = copy.title; autoFixed++; }
                    if (copy.a == null && copy.answer != null) { copy.a = copy.answer; autoFixed++; }
                    if (copy.a == null && copy.correct != null) { copy.a = copy.correct; autoFixed++; }
                    if (copy.a == null && copy.ans != null) { copy.a = copy.ans; autoFixed++; }
                    if (!Array.isArray(copy.o)) {
                        if (Array.isArray(copy.options)) { copy.o = copy.options; autoFixed++; }
                        else if (Array.isArray(copy.choices)) { copy.o = copy.choices; autoFixed++; }
                    }

                    // 答案若是数组（如多选 ["A","C"] 或填空 ["TCP","传输控制协议"]），自动转字符串
                    if (Array.isArray(copy.a)) {
                        const isOpts = Array.isArray(copy.o) && copy.o.length >= 2;
                        copy.a = copy.a.map(x => String(x == null ? '' : x).trim()).filter(Boolean).join(isOpts ? '' : '|');
                        autoFixed++;
                    } else if (typeof copy.a === 'boolean') {
                        copy.a = copy.a ? 'T' : 'F';
                        autoFixed++;
                    } else if (typeof copy.a === 'number') {
                        copy.a = String(copy.a);
                    }

                    // 题型别名归一与缺省自动推断
                    if (typeof copy.type === 'string') {
                        const alias = {
                            mcq: 'mcq', single: 'mcq', singlechoice: 'mcq', '单选': 'mcq', '单选题': 'mcq',
                            multi: 'multi', multiple: 'multi', multiplechoice: 'multi', '多选': 'multi', '多选题': 'multi',
                            tf: 'tf', judge: 'tf', boolean: 'tf', truefalse: 'tf', '判断': 'tf', '判断题': 'tf',
                            fill: 'fill', blank: 'fill', completion: 'fill', '填空': 'fill', '填空题': 'fill'
                        };
                        const tl = copy.type.trim().toLowerCase();
                        if (alias[tl]) {
                            if (copy.type !== alias[tl]) autoFixed++;
                            copy.type = alias[tl];
                        }
                    } else if (!copy.type) {
                        const ansRaw = String(copy.a == null ? '' : copy.a).trim();
                        if (Array.isArray(copy.o) && copy.o.length >= 2) {
                            const lettersOnly = ansRaw.replace(/[^A-Za-z]/g, '');
                            copy.type = lettersOnly.length > 1 ? 'multi' : 'mcq';
                            autoFixed++;
                        } else if (['t', 'f', 'true', 'false', '对', '错', '正确', '错误', '√', '×', '是', '否'].includes(ansRaw.toLowerCase())) {
                            copy.type = 'tf';
                            autoFixed++;
                        } else if (ansRaw) {
                            copy.type = 'fill';
                            autoFixed++;
                        }
                    }

                    if (!allowed.has(copy.type)) {
                        recordInvalid(sub, chap, idx, copy, `不支持或无法识别的题型 "${copy.type || '空'}"（仅支持单选/多选/判断/填空，主观简答题已自动跳过）`, `Unsupported question type "${copy.type || 'empty'}" (only mcq/multi/tf/fill are supported)`);
                        return;
                    }

                    copy.q = typeof copy.q === 'string' ? copy.q.trim() : String(copy.q == null ? '' : copy.q).trim();
                    copy.a = typeof copy.a === 'string' ? copy.a.trim() : String(copy.a == null ? '' : copy.a).trim();

                    if (!copy.q) {
                        recordInvalid(sub, chap, idx, copy, '缺少题干内容 (q)', 'Missing question text (q)');
                        return;
                    }
                    if (copy.q.length > 20000) {
                        recordInvalid(sub, chap, idx, copy, '题干过长（超过 20000 字符）', 'Question text too long (>20000 chars)');
                        return;
                    }
                    if (!copy.a) {
                        recordInvalid(sub, chap, idx, copy, '缺少正确答案 (a)', 'Missing correct answer (a)');
                        return;
                    }

                    if (copy.type === 'mcq' || copy.type === 'multi') {
                        if (!Array.isArray(copy.o)) {
                            recordInvalid(sub, chap, idx, copy, '选择题缺少选项列表 (o)', 'Missing options array (o)');
                            return;
                        }
                        copy.o = copy.o
                            .map(opt => {
                                if (opt == null) return '';
                                const str = typeof opt === 'string' ? opt : String(opt);
                                return str.replace(/^\s*[A-ZＡ-Ｚ][\.．、，\)\）]\s*/, '').trim();
                            })
                            .filter(s => s.length > 0);
                        if (copy.o.length < 2) {
                            recordInvalid(sub, chap, idx, copy, `有效选项不足 2 个（当前 ${copy.o.length} 个）`, `Fewer than 2 non-empty options (found ${copy.o.length})`);
                            return;
                        }
                        if (copy.o.length > 16) {
                            recordInvalid(sub, chap, idx, copy, `选项过多（${copy.o.length} 个，上限 16 个）`, `Too many options (${copy.o.length}, max 16)`);
                            return;
                        }
                        const maxLetter = String.fromCharCode(64 + copy.o.length);
                        if (copy.type === 'mcq') {
                            let aUp = copy.a.toUpperCase();
                            // 兼容 "B. 80" 或 "选项B" 形式
                            const leadMatch = aUp.match(/^(?:选项|ANSWER\s*[:：]?\s*)?([A-Z])(?:[\.．、，\)\）\s].*)?$/i);
                            if (leadMatch && leadMatch[1] <= maxLetter && aUp.length > 1) {
                                aUp = leadMatch[1].toUpperCase();
                                autoFixed++;
                            } else if (!/^[A-Z]$/.test(aUp)) {
                                // 兼容答案直接写成某个选项的文本内容
                                const matchIdx = copy.o.findIndex(opt => opt.toLowerCase() === copy.a.toLowerCase());
                                if (matchIdx >= 0) {
                                    aUp = String.fromCharCode(65 + matchIdx);
                                    autoFixed++;
                                }
                            }
                            if (!/^[A-Z]$/.test(aUp) || aUp > maxLetter) {
                                recordInvalid(sub, chap, idx, copy, `单选题答案 "${copy.a}" 不在有效选项范围 A–${maxLetter} 内`, `MCQ answer "${copy.a}" is outside valid option range A–${maxLetter}`);
                                return;
                            }
                            copy.a = aUp;
                        } else {
                            // 多选题：剥除逗号、顿号、空格等分隔符，提取字母并排序去重
                            let cleanedLetters = copy.a.toUpperCase().replace(/[,，、\s;/|]+/g, '');
                            if (!/^[A-Z]+$/.test(cleanedLetters)) {
                                recordInvalid(sub, chap, idx, copy, `多选题答案 "${copy.a}" 必须是字母组合（如 AB、ACD）`, `Multi-select answer "${copy.a}" must be option letters (e.g. AB, ACD)`);
                                return;
                            }
                            const uniqSorted = Array.from(new Set(cleanedLetters.split(''))).sort();
                            if (uniqSorted.some(ch => ch > maxLetter)) {
                                recordInvalid(sub, chap, idx, copy, `多选题答案 "${copy.a}" 含有超出选项范围 A–${maxLetter} 的字母`, `Multi-select answer "${copy.a}" has letters outside range A–${maxLetter}`);
                                return;
                            }
                            if (uniqSorted.join('') !== copy.a) autoFixed++;
                            copy.a = uniqSorted.join('');
                        }
                    } else if (copy.type === 'tf') {
                        const raw = String(copy.a == null ? '' : copy.a).trim().toLowerCase();
                        const okInputs = ['t', 'true', 'y', 'yes', '对', '正确', '是', '1', '\u221a', '\u2713', '\u2714'];
                        const noInputs = ['f', 'false', 'n', 'no', '错', '错误', '否', '0', '\u00d7', '\u2715', '\u2716'];
                        if (okInputs.indexOf(raw) >= 0) {
                            if (copy.a !== 'T') autoFixed++;
                            copy.a = 'T';
                        } else if (noInputs.indexOf(raw) >= 0) {
                            if (copy.a !== 'F') autoFixed++;
                            copy.a = 'F';
                        } else {
                            recordInvalid(sub, chap, idx, copy, `判断题答案 "${copy.a}" 无法识别（请用 T/F 或 对/错）`, `True/False answer "${copy.a}" is invalid (expected T/F or True/False)`);
                            return;
                        }
                    } else if (copy.type === 'fill') {
                        const variants = copy.a.split('|').map(s => s.trim()).filter(Boolean);
                        if (!variants.length) {
                            recordInvalid(sub, chap, idx, copy, '填空题答案为空', 'Fill-in answer is empty');
                            return;
                        }
                        copy.a = variants.join('|');
                    }

                    if (copy.a.length > 500) {
                        recordInvalid(sub, chap, idx, copy, '答案过长（超过 500 字符）', 'Answer too long (>500 chars)');
                        return;
                    }

                    if (typeof copy.id !== 'string' || !copy.id.trim()) {
                        copy.id = hashId(JSON.stringify([sub, chap, copy.type, copy.q, copy.a, Array.isArray(copy.o) ? copy.o : []]));
                        fixedIds++;
                    } else if (seenIds.has(copy.id)) {
                        const base = copy.id;
                        let n = 2;
                        while (seenIds.has(base + '-d' + n)) n++;
                        copy.id = base + '-d' + n;
                        fixedIds++;
                    }
                    seenIds.add(copy.id);
                    cleanedQs.push(copy);
                });
                if (cleanedQs.length > 0) {
                    if (!cleanedChaps[chap]) cleanedChaps[chap] = [];
                    cleanedChaps[chap] = cleanedChaps[chap].concat(cleanedQs);
                }
            }
            if (Object.keys(cleanedChaps).length > 0) result[sub] = cleanedChaps;
        }
        if (stats) {
            stats.fixedIds = fixedIds;
            stats.ignored = ignored;
            stats.autoFixed = autoFixed;
            stats.invalidItems = invalidItems;
        }
        return result;
    },

    // 对【已含白名单标签】的 HTML（renderMedia 输出）做关键词高亮。
    // 不能走 highlight()：它会把整段 escapeHTML，把 <img>/<table> 变成可见文字；
    // 这里标签段原样保留，只在文本段插 <mark>。文本段已是转义后内容，不再二次转义。
    highlightHTML(html, query) {
        if (typeof html !== 'string' || !html || !query) return html;
        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (!escapedQuery) return html;
        let reg;
        try { reg = new RegExp(`(${escapedQuery})`, 'gi'); } catch (e) { return html; }
        return html.split(/(<[^>]*>)/).map(seg => {
            if (!seg || seg[0] === '<') return seg;
            return seg.replace(reg, '<mark class="bg-yellow-200 dark:bg-yellow-700/50 rounded px-0.5 text-inherit">$1</mark>');
        }).join('');
    },
    getDetailedOptionHTML(q, charStr, searchQuery = '') {
        if (!q.o || !Array.isArray(q.o)) return '<span class="text-red-500 text-xs">' + (window.App && App.t ? App.t('选项数据缺失') : '选项数据缺失') + '</span>';

        const texts = q.o.map((optText, idx) => {
            const char = String.fromCharCode(65 + idx);
            const isCorrect = (charStr || '').includes(char);
            const hlOptText = this.highlight(optText, searchQuery);

            if (isCorrect) {
                return `<div class="mt-1 py-1 px-2 rounded bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 font-bold flex items-start gap-1.5 text-xs transition-colors">
                            <svg class="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
                            <span class="leading-snug">${char}. ${hlOptText}</span>
                        </div>`;
            } else {
                return `<div class="mt-1 py-1 px-2 rounded text-[var(--sub)] flex items-start gap-1.5 text-xs opacity-75 transition-colors">
                            <svg class="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-rose-400 opacity-80" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                            <span class="leading-snug">${char}. ${hlOptText}</span>
                        </div>`;
            }
        });
        return `<div class="mt-1.5 flex flex-col">${texts.join('')}</div>`;
    },
    editDistance(a, b, cutoff = Infinity) {
        const m = a.length, n = b.length;
        if (m === 0) return n;
        if (n === 0) return m;
        // 滚动单行 DP（结果与全矩阵一致，内存 O(n)）。rowMin 超过 cutoff 时
        // 提前放弃——编辑距离单调不减到终点，后面不可能再降回 cutoff 以内。
        // 超界时返回 cutoff+1（调用方只做「是否 ≤ cutoff」判断）。
        let prev = new Array(n + 1);
        for (let j = 0; j <= n; j++) prev[j] = j;
        for (let i = 1; i <= m; i++) {
            const cur = new Array(n + 1);
            cur[0] = i;
            let rowMin = i;
            const ai = a.charCodeAt(i - 1);
            for (let j = 1; j <= n; j++) {
                cur[j] = ai === b.charCodeAt(j - 1)
                    ? prev[j - 1]
                    : 1 + Math.min(prev[j], cur[j - 1], prev[j - 1]);
                if (cur[j] < rowMin) rowMin = cur[j];
            }
            if (rowMin > cutoff) return cutoff + 1;
            prev = cur;
        }
        return prev[n];
    },
    // 字符袋距离：两串字符多重集的差异度。取「A 相对 B 的盈余」与「B 相对 A 的盈余」的
    // 较大者——每次编辑操作最多同时消掉一个盈余和一个亏空，所以
    // editDistance >= max(盈余A, 盈余B)，可作为 O(m*n) 动态规划的预筛下界。
    charCounts(s) {
        const m = new Map();
        for (let i = 0; i < s.length; i++) {
            const c = s[i];
            m.set(c, (m.get(c) || 0) + 1);
        }
        return m;
    },
    bagDistance(ca, cb) {
        let surplusA = 0, surplusB = 0;
        for (const [c, k] of ca) {
            const d = k - (cb.get(c) || 0);
            if (d > 0) surplusA += d;
        }
        for (const [c, k] of cb) {
            const d = k - (ca.get(c) || 0);
            if (d > 0) surplusB += d;
        }
        return Math.max(surplusA, surplusB);
    },
    fuzzyMatch(text, query) {
        // 短查询（1-2 字）只走精确子串匹配（调用方先做 includes），
        // 模糊容错对短查询几乎必然误命中
        if (!query || query.length < 3) return false;
        // 容错数收紧（原来 len/4+1 太宽松：「optimization」容错 4，几乎什么都能命中）。
        // len/6 至少 1：短词容忍 1 个错字，长词按比例但不失控。
        const tolerance = Math.max(1, Math.floor(query.length / 6));
        // 纯拉丁查询的模糊窗口必须落在「词边界」上：否则 went 会以距离 1
        // 命中 student 内部的 dent 这类误命中（实测踩过）。中文查询没有
        // 词边界概念，不做此限制。
        const latinQuery = /^[a-z0-9]+$/.test(query);
        const isAlnum = (c) => c !== undefined && /[a-z0-9]/.test(c);

        for (let i = 0; i <= text.length - query.length + tolerance; i++) {
            if (latinQuery && text[i] && /[a-z]/.test(text[i]) && i > 0 && isAlnum(text[i - 1])) {
                continue;   // 窗口起点嵌在更长拉丁词内部 → 跳过
            }
            const sub = text.substring(i, i + query.length);
            // 传入 cutoff：行最小值超界立即放弃，不再为注定失败的窗口跑完整 DP
            if (this.editDistance(sub, query, tolerance) <= tolerance) return true;
        }
        return false;
    },
    normalizeQuestionText(text) {
        if (!text) return '';
        return String(text)
            .toLowerCase()
            .replace(/[\s\u3000]/g, '')
            .replace(/[，。,\.、；;！!？?\(\)\[\]【】'"“”‘’]/g, '');
    },
    similarity(a, b) {
        if (!a && !b) return 1;
        if (!a || !b) return 0;
        const maxLen = Math.max(a.length, b.length);
        if (!maxLen) return 1;
        const dist = this.editDistance(a, b);
        return 1 - dist / maxLen;
    },
    // 按本地时区生成日历日键（YYYY-MM-DD）。
    // toISOString().slice(0,10) 是 UTC 日切——东八区早上 8 点前的作答会被算进「昨天」，
    // 日报曲线、连续天数全部错位一天。所有按天分桶的统计一律用这个函数。
    localDayKey(ts) {
        const d = ts instanceof Date ? ts : new Date(ts);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },
    // 解析后端返回的 "YYYY-MM-DD HH:MM:SS" 时间字符串。
    // D1 的 CURRENT_TIMESTAMP 存的是 UTC，直接 new Date() 会被当本地时间解析（差一个时区），
    // 这里显式补上 T 和 Z 让它按 UTC 解析，再交给 toLocaleString 转本地时区显示。
    parseUtcDate(s) {
        if (!s || typeof s !== 'string') return null;
        try {
            const d = new Date(s.trim().replace(' ', 'T') + (/[Zz]|[+-]\d{2}:?\d{2}$/.test(s) ? '' : 'Z'));
            return isNaN(d.getTime()) ? null : d;
        } catch (e) {
            return null;
        }
    },
};
