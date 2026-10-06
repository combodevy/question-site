/**
 * @file js/views/english.js
 * @description 英语专题视图：历年真题（四级/六级/考研）浏览、答案速录、按套导入练习。
 * 题库 JSON 由构建管线从公开真题站（zhenti.burningvocabulary.cn）生成，部署为静态资源。
 * 答案不由本系统提供——用户通过「答案速录」粘贴一次，永久保存在本机并随题库判分。
 */
import { utils } from '../utils.js';

const CATS = [
    { key: 'cet4', label: '四级真题', labelEn: 'CET-4', subject: '四级真题' },
    { key: 'cet6', label: '六级真题', labelEn: 'CET-6', subject: '六级真题' },
    { key: 'kaoyan', label: '考研英语', labelEn: 'Graduate', subject: '考研英语' }
];

const STAR_SVG = '<svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';

export const english = {
    _cat: 'cet4',
    _indexCache: {},
    _loading: false,

    t(s) { return (window.App && App.t) ? App.t(s) : s; },

    answers() {
        try { return JSON.parse(localStorage.getItem('qs_eng_answers') || '{}'); } catch (e) { return {}; }
    },

    saveAnswers(all) {
        try { localStorage.setItem('qs_eng_answers', JSON.stringify(all)); } catch (e) { }
    },

    /** 解析答案速录文本：支持 "26-30 CADBE"、"26. A"、"26 A" 混排 */
    parseKeyText(text, fallbackStart) {
        const res = {};
        const range = /(\d{1,3})\s*[-–—~]\s*(\d{1,3})\s*[,，:：]?\s*([A-O][A-O\s]*)/g;
        let m;
        while ((m = range.exec(text)) !== null) {
            const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
            const letters = m[3].replace(/\s+/g, '').split('');
            if (b >= a && (b - a + 1) === letters.length) {
                for (let i = 0; i < letters.length; i++) res[a + i] = letters[i];
            }
        }
        // 单题：26. A / 26 A（跳过已被区间覆盖的）
        const single = /(\d{1,3})\s*[.、\)）]?\s*([A-O])(?![A-O])/g;
        while ((m = single.exec(text)) !== null) {
            const no = parseInt(m[1], 10);
            if (!(no in res) && no >= 1 && no <= 99) res[no] = m[2];
        }
        return res;
    },

    render() {
        const root = document.getElementById('english-root');
        if (!root) return;
        const tabs = CATS.map(c => {
            const on = c.key === this._cat;
            return '<button data-cat="' + c.key + '" class="px-3.5 py-1.5 rounded-full text-xs font-bold border transition-all ' +
                (on ? 'bg-primary-600 text-white border-primary-600 shadow-sm' : 'border-[var(--border)] text-[var(--sub)] hover:bg-[var(--bg)]') + '">' +
                this.t(c.label) + '</button>';
        }).join('');
        root.innerHTML =
            '<div class="flex flex-wrap items-center justify-between gap-2">' +
            '<div class="flex gap-2">' + tabs + '</div>' +
            '<div class="text-[11px] text-[var(--sub)] hidden sm:block">' + this.t('共 N 套 · 标注答案后开始练习') + '</div>' +
            '</div>' +
            '<div id="eng-list" class="flex flex-col gap-2"></div>' +
            '<div class="text-[10px] text-[var(--sub)] opacity-75 leading-relaxed px-1">' +
            this.t('题目来源：zhenti.burningvocabulary.cn（公开真题 PDF 解析生成）。答案请使用「答案」按钮粘贴任意公开渠道的答案速查，保存在本机后自动判分。') +
            '</div>';
        root.querySelectorAll('[data-cat]').forEach(b => {
            b.addEventListener('click', () => { this._cat = b.dataset.cat; this.render(); });
        });
        this._loadIndex();
    },

    async _loadIndex() {
        const list = document.getElementById('eng-list');
        if (!list) return;
        const cat = this._cat;
        if (!this._indexCache[cat]) {
            this._loading = true;
            list.innerHTML = '<div class="text-xs text-[var(--sub)] text-center py-8">' + this.t('正在加载题库索引…') + '</div>';
            try {
                const r = await fetch('english/index-' + cat + '.json?b=' + Date.now());
                this._indexCache[cat] = await r.json();
            } catch (e) {
                list.innerHTML = '<div class="text-xs text-red-500 text-center py-8">' + this.t('题库索引加载失败，请检查网络。') + '</div>';
                this._loading = false;
                return;
            }
            this._loading = false;
        }
        this._renderList();
    },

    _renderList() {
        const list = document.getElementById('eng-list');
        const data = this._indexCache[this._cat] || [];
        if (!data.length) {
            list.innerHTML = '<div class="text-xs text-[var(--sub)] text-center py-8">' + this.t('暂无试卷。') + '</div>';
            return;
        }
        const answers = this.answers();
        // 按年分组
        const groups = [];
        for (const p of data) {
            const y = p.id.split('-')[1];
            let g = groups.find(x => x.year === y);
            if (!g) { g = { year: y, items: [] }; groups.push(g); }
            g.items.push(p);
        }
        let html = '<div class="text-[11px] text-[var(--sub)] px-1">' + this.t('共 N 套 · 标注答案后开始练习').replace(/共 N 套/, this.t('共') + ' ' + data.length + ' ' + this.t('套')) + '</div>';
        for (const g of groups) {
            html += '<div class="text-[11px] font-bold text-[var(--sub)] uppercase tracking-wider px-1 pt-2">' + g.year + '</div>';
            for (const p of g.items) {
                const key = answers[p.id] || {};
                const keyed = Object.keys(key).length;
                const badge = keyed >= p.qCount
                    ? '<span class="text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 rounded-full">' + this.t('答案已录入') + '</span>'
                    : (keyed > 0
                        ? '<span class="text-[10px] font-bold text-amber-600 bg-amber-50 dark:bg-amber-950/30 px-2 py-0.5 rounded-full">' + keyed + '/' + p.qCount + '</span>'
                        : '<span class="text-[10px] font-bold text-[var(--sub)] bg-[var(--bg)] px-2 py-0.5 rounded-full">' + this.t('未录入答案') + '</span>');
                html +=
                    '<div class="card p-3 rounded-xl flex items-center justify-between gap-2">' +
                    '<div class="min-w-0">' +
                    '<div class="text-xs font-bold text-[var(--text)] truncate">' + utils.escapeHTML(p.title) + '</div>' +
                    '<div class="flex items-center gap-2 mt-1">' + badge +
                    '<span class="text-[10px] text-[var(--sub)]">' + p.qCount + ' ' + this.t('题') + '</span>' +
                    '</div></div>' +
                    '<div class="flex items-center gap-1.5 flex-shrink-0">' +
                    '<button data-act="key" data-id="' + p.id + '" class="px-2.5 py-1.5 rounded-lg border border-[var(--border)] text-[11px] font-bold text-[var(--text)] hover:bg-[var(--bg)] active:scale-95 transition-all">' + this.t('答案') + '</button>' +
                    '<button data-act="go" data-id="' + p.id + '" class="px-3 py-1.5 rounded-lg bg-primary-600 text-white text-[11px] font-bold hover:bg-primary-700 active:scale-95 transition-all shadow-sm">' + this.t('开始练习') + '</button>' +
                    '</div></div>';
            }
        }
        list.innerHTML = html;
        list.querySelectorAll('[data-act="key"]').forEach(b => b.addEventListener('click', () => this.openKeyModal(b.dataset.id)));
        list.querySelectorAll('[data-act="go"]').forEach(b => b.addEventListener('click', () => this.startPaper(b.dataset.id)));
    },

    _paperMeta(id) {
        return (this._indexCache[this._cat] || []).find(p => p.id === id);
    },

    openKeyModal(id) {
        const meta = this._paperMeta(id);
        if (!meta) return;
        const old = document.getElementById('modal-eng-key');
        if (old) old.remove();
        const answers = this.answers();
        const cur = answers[id] || {};
        const curText = Object.keys(cur).sort((a, b) => a - b).map(no => no + '. ' + cur[no]).join('  ');
        const modal = document.createElement('div');
        modal.id = 'modal-eng-key';
        modal.className = 'fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm';
        modal.innerHTML =
            '<div class="card w-full max-w-md rounded-2xl shadow-2xl p-5 flex flex-col gap-3 max-h-[85vh] overflow-y-auto custom-scroll">' +
            '<div class="flex justify-between items-center">' +
            '<h3 class="font-bold text-sm">' + this.t('答案速录') + '</h3>' +
            '<button data-close class="text-[var(--sub)] hover:text-[var(--text)] p-1"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button>' +
            '</div>' +
            '<div class="text-[11px] text-[var(--sub)] leading-relaxed">' + utils.escapeHTML(meta.title) + '<br>' +
            this.t('支持格式：26-30 CADBE（区间+顺序字母）、26. A（单题）。可整段粘贴答案速查文本，自动识别。') + '</div>' +
            '<textarea id="eng-key-input" rows="5" placeholder="26-30 CADBE&#10;31-35 DACBD" class="w-full text-xs bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 outline-none custom-scroll font-mono"></textarea>' +
            '<div id="eng-key-preview" class="text-[11px] text-[var(--sub)] min-h-[18px]"></div>' +
            '<div class="flex gap-2 justify-end">' +
            '<button data-clear class="px-3 py-2 rounded-lg border border-red-200 dark:border-red-900 text-[11px] font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-all">' + this.t('清除') + '</button>' +
            '<button data-close class="px-3 py-2 rounded-lg border border-[var(--border)] text-[11px] font-bold text-[var(--text)] hover:bg-[var(--bg)] transition-all">' + this.t('取消') + '</button>' +
            '<button data-save class="px-4 py-2 rounded-lg bg-primary-600 text-white text-[11px] font-bold hover:bg-primary-700 active:scale-95 transition-all shadow-sm">' + this.t('保存') + '</button>' +
            '</div></div>';
        document.body.appendChild(modal);
        const input = modal.querySelector('#eng-key-input');
        if (curText) input.value = curText;
        const preview = modal.querySelector('#eng-key-preview');
        const updatePreview = () => {
            const parsed = this.parseKeyText(input.value);
            const n = Object.keys(parsed).length;
            preview.textContent = n ? this.t('已识别 N 个答案').replace('N', n) + '（' + meta.qCount + ' ' + this.t('题') + '）' : '';
        };
        input.addEventListener('input', updatePreview);
        updatePreview();
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
            if (e.target.closest('[data-close]')) modal.remove();
            if (e.target.closest('[data-clear]')) {
                const all = this.answers();
                delete all[id];
                this.saveAnswers(all);
                modal.remove();
                this._renderList();
            }
            if (e.target.closest('[data-save]')) {
                const parsed = this.parseKeyText(input.value);
                if (!Object.keys(parsed).length) {
                    preview.textContent = this.t('未识别到答案，请检查格式。');
                    preview.className = 'text-[11px] text-red-500 min-h-[18px]';
                    return;
                }
                const all = this.answers();
                all[id] = parsed;
                this.saveAnswers(all);
                modal.remove();
                this._renderList();
            }
        });
    },

    chapterOf(meta) {
        if (meta.id.indexOf('kaoyan') === 0) {
            const eng = /英语一/.test(meta.title) ? '英语一' : (/英语二/.test(meta.title) ? '英语二' : '');
            return meta.id.split('-')[1] + (eng ? ' ' + eng : '');
        }
        const ym = meta.id.split('-').slice(1, 3).join('-');
        const set = /(\d+)/.exec(meta.id.split('-')[3] || '') ? meta.id.split('-')[3].replace('0', '') : '';
        return ym + ' 第' + set.replace(/^0+/, '') + '套';
    },

    async startPaper(id) {
        const meta = this._paperMeta(id);
        if (!meta || this._loading) return;
        const answers = this.answers();
        const key = answers[id] || {};
        const keyed = Object.keys(key).length;
        // 未录入答案也可练习：自测模式（可看题、可作答、不计分），录入答案后重新开始即自动判分
        let notice = null;
        if (keyed < meta.qCount) {
            notice = this.t('自测模式：本卷未录入答案，作答不计分；点「答案」补录后重新开始即自动判分。');
        }
        let data;
        try {
            const r = await fetch('english/' + meta.file + '?b=' + Date.now());
            data = await r.json();
        } catch (e) {
            if (typeof showGlobalError === 'function') showGlobalError(this.t('试卷加载失败，请重试。'));
            return;
        }
        const catDef = CATS.find(c => c.key === data.category) || CATS[0];
        const subject = catDef.subject;
        const chapter = this.chapterOf(meta);
        const sections = data.sections || {};
        const qs = [];
        for (const q of data.questions) {
            const sec = sections[q.sec] || {};
            const parts = [];
            if (sec.label) parts.push('【' + sec.label + '】');
            if (q.sec === 'A' && sec.words && sec.words.length) {
                parts.push(sec.words.map((w, i) => String.fromCharCode(65 + i) + '. ' + w).join('   '));
            }
            parts.push(q.q);
            const ans = (key[q.no] || '').trim().toUpperCase();
            const selfCheck = !ans;
            qs.push({
                id: 'eng-' + data.id + '-q' + q.no,
                type: 'mcq',
                // 文章独立字段（quiz 双栏/抽屉排版），不再内嵌进题干
                psg: sec.passage || null,
                q: parts.join('\n\n'),
                o: (q.o && q.o.length ? q.o : (sec.words || []).map((w, i) => String.fromCharCode(65 + i) + '. ' + w)),
                // 自测题需要占位答案才能通过 schema 校验；quiz 对 selfCheck 题跳过计分
                a: ans || (q.o && q.o.length ? String.fromCharCode(65 + Math.min(1, q.o.length - 1)) : 'A'),
                selfCheck
            });
        }
        if (!qs.length) {
            if (typeof showGlobalError === 'function') showGlobalError(this.t('该卷解析结果为空。'));
            return;
        }
        const bank = {};
        bank[subject] = {};
        bank[subject][chapter] = qs;
        const report = App.data.importBank(JSON.stringify(bank));
        if (!report) return;
        if (notice && typeof showGlobalError === 'function') showGlobalError(notice);
        // 导入成功 → 直接进入该套练习
        const chapterValue = subject + '\u0001' + chapter;
        App.router.go('quiz');
        App.quiz.init('custom', { type: 'all', limit: 'all', customChapters: [chapterValue] });
    }
};
