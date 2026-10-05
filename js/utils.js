export const utils = {
    toPinyinStr(text) {
        if (!text || typeof pinyinPro === 'undefined') return text ? String(text).toLowerCase() : '';
        return pinyinPro.pinyin(text, { toneType: 'none', separator: '' }).toLowerCase();
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
            } else if (typeof m.src === 'string' && /^(https:\/\/|data:image\/)/.test(m.src)) {
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
                const attrs = (tag === 'TD' || tag === 'TH') && child.hasAttribute('colspan')
                    ? ` colspan="${parseInt(child.getAttribute('colspan'), 10) || 1}"`
                    : ((tag === 'TD' || tag === 'TH') && child.hasAttribute('rowspan')
                        ? ` rowspan="${parseInt(child.getAttribute('rowspan'), 10) || 1}"`
                        : '');
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

    // 导入清洗：剥控制字符、规范 tf 答案、改写重复/缺失 ID、剔除非法题型。
    // 返回与输入同构的 bank；stats 接收 { fixedIds, ignored }。
    sanitizeImportedBank(obj, stats) {
        const allowed = new Set(['mcq', 'multi', 'tf', 'fill']);
        const result = {};
        const seenIds = new Set();
        let fixedIds = 0;
        let ignored = 0;
        const hashId = (s) => {
            let h = 5381;
            for (let i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) | 0; }
            return 'auto-' + (h >>> 0).toString(36);
        };
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
            if (stats) { stats.fixedIds = 0; stats.ignored = 0; }
            return result;
        }
        const stripCtrl = (s) => String(s).replace(/[\u0000-\u001F\u007F]/g, '').trim();
        // 形状归一化：顶层数组与 { questions: [...] } 是常见的外部格式，
        // 归一成 { 科目: { 章节: [题] } } 后再统一清洗，避免被静默丢成空库
        let bank = obj;
        const defSub = (window.App && typeof App.t === 'function') ? App.t('导入题目') : '导入题目';
        const defChap = (window.App && typeof App.t === 'function') ? App.t('未分类') : '未分类';
        if (Array.isArray(bank)) {
            bank = { [defSub]: { [defChap]: bank } };
        } else if (bank && typeof bank === 'object' && Array.isArray(bank.questions)) {
            const grouped = {};
            for (const q of bank.questions) {
                if (!q || typeof q !== 'object') continue;
                const s = (typeof q.subject === 'string' && q.subject.trim()) ? q.subject.trim() : defSub;
                const c = (typeof q.chapter === 'string' && q.chapter.trim()) ? q.chapter.trim() : defChap;
                if (!grouped[s]) grouped[s] = {};
                if (!grouped[s][c]) grouped[s][c] = [];
                grouped[s][c].push(q);
            }
            bank = grouped;
        }
        for (const [rawSub, chapDict] of Object.entries(bank)) {
            if (!chapDict || typeof chapDict !== 'object' || Array.isArray(chapDict)) continue;
            const sub = stripCtrl(rawSub);
            if (!sub) { ignored++; continue; }
            const cleanedChaps = {};
            for (const [rawChap, arr] of Object.entries(chapDict)) {
                if (!Array.isArray(arr)) continue;
                const chap = stripCtrl(rawChap);
                if (!chap) { ignored += arr.length; continue; }
                const cleanedQs = arr
                    .map(q => {
                        if (!q || typeof q !== 'object') { ignored++; return null; }
                        const copy = { ...q };
                        // 字段别名归一：AI 输出常用 question/answer/options/stem/choices 等写法
                        if (copy.q == null && copy.question != null) copy.q = copy.question;
                        if (copy.q == null && copy.stem != null) copy.q = copy.stem;
                        if (copy.a == null && copy.answer != null) copy.a = copy.answer;
                        if (copy.a == null && copy.correct != null) copy.a = copy.correct;
                        if (!Array.isArray(copy.o)) {
                            if (Array.isArray(copy.options)) copy.o = copy.options;
                            else if (Array.isArray(copy.choices)) copy.o = copy.choices;
                        }
                        // 题型别名归一：single/multiple/judge/blank 等
                        if (typeof copy.type === 'string') {
                            const alias = { mcq: 'mcq', single: 'mcq', singlechoice: 'mcq', multi: 'multi', multiple: 'multi', multiplechoice: 'multi', tf: 'tf', judge: 'tf', boolean: 'tf', truefalse: 'tf', fill: 'fill', blank: 'fill', completion: 'fill' };
                            const tl = copy.type.trim().toLowerCase();
                            if (alias[tl]) copy.type = alias[tl];
                        }
                        if (!allowed.has(copy.type)) { ignored++; return null; }
                        return copy;
                    })
                    .filter(Boolean)
                    .map(copy => {
                        if ((copy.type === 'mcq' || copy.type === 'multi') && Array.isArray(copy.o)) {
                            copy.o = copy.o.map(opt => {
                                if (opt == null) return '';
                                const str = typeof opt === 'string' ? opt : String(opt);
                                return str.replace(/^\s*[A-ZＡ-Ｚ][\.．、，\)\）]\s*/, '');
                            });
                        }
                        if (copy.type === 'tf') {
                            // 宽容归一：true/false、对/错、√/×、是/否、y/n 等常见写法统一成 T/F
                            const raw = String(copy.a == null ? '' : copy.a).trim().toLowerCase();
                            if (['t', 'true', '√', '✓', '✔', 'y', 'yes', '对', '正确', '是'].indexOf(raw) >= 0) copy.a = 'T';
                            else if (['f', 'false', '×', '✕', '✖', 'n', 'no', '错', '错误', '否'].indexOf(raw) >= 0) copy.a = 'F';
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
                        return copy;
                    });
                if (cleanedQs.length > 0) {
                    if (!cleanedChaps[chap]) cleanedChaps[chap] = [];
                    cleanedChaps[chap] = cleanedChaps[chap].concat(cleanedQs);
                } else {
                    ignored += arr.filter(q => q && typeof q === 'object' && allowed.has(q.type)).length - cleanedQs.length;
                }
            }
            if (Object.keys(cleanedChaps).length > 0) result[sub] = cleanedChaps;
        }
        if (stats) { stats.fixedIds = fixedIds; stats.ignored = ignored; }
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
                            <span class="flex-shrink-0">✓</span>
                            <span class="leading-snug">${char}. ${hlOptText}</span>
                        </div>`;
            } else {
                return `<div class="mt-1 py-1 px-2 rounded text-[var(--sub)] flex items-start gap-1.5 text-xs opacity-75 transition-colors">
                            <span class="flex-shrink-0 text-rose-400 opacity-80">✕</span>
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
    // editDistance ≥ max(盈余A, 盈余B)，可作为 O(m·n) 动态规划的预筛下界。
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
