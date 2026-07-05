export const utils = {
    toPinyinStr(text) {
        if (!text || typeof pinyinPro === 'undefined') return text ? String(text).toLowerCase() : '';
        return pinyinPro.pinyin(text, { toneType: 'none', separator: '' }).toLowerCase();
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
    getDetailedOptionHTML(q, charStr, searchQuery = '') {
        if (!q.o || !Array.isArray(q.o)) return '<span class="text-red-500 text-xs">选项数据缺失</span>';

        const texts = q.o.map((optText, idx) => {
            const char = String.fromCharCode(65 + idx);
            const isCorrect = (charStr || '').includes(char);
            const hlOptText = this.highlight(optText, searchQuery);

            if (isCorrect) {
                return `<div class="mt-1 py-1 px-2 rounded bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 font-bold flex items-start gap-1.5 text-xs transition-colors">
                            <span class="flex-shrink-0">✅</span>
                            <span class="leading-snug">${char}. ${hlOptText}</span>
                        </div>`;
            } else {
                return `<div class="mt-1 py-1 px-2 rounded text-[var(--sub)] flex items-start gap-1.5 text-xs opacity-75 transition-colors">
                            <span class="flex-shrink-0 text-rose-400 opacity-80">❌</span>
                            <span class="leading-snug">${char}. ${hlOptText}</span>
                        </div>`;
            }
        });
        return `<div class="mt-1.5 flex flex-col">${texts.join('')}</div>`;
    },
    editDistance(a, b) {
        const m = a.length, n = b.length;
        const dp = Array.from({ length: m + 1 }, (_, i) =>
            Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
        );
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                dp[i][j] = a[i - 1] === b[j - 1]
                    ? dp[i - 1][j - 1]
                    : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
            }
        }
        return dp[m][n];
    },
    fuzzyMatch(text, query) {
        if (!query || query.length < 2) return false;
        const tolerance = Math.floor(query.length / 4) + 1;

        for (let i = 0; i <= text.length - query.length + tolerance; i++) {
            const sub = text.substring(i, i + query.length);
            if (this.editDistance(sub, query) <= tolerance) return true;
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
    }
};
