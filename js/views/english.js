/**
 * @file js/views/english.js
 * @description 英语专题：历年真题（四级/六级/考研）整卷练习。
 * 与主刷题引擎完全独立：不导入主题库、不写练习历史、不影响主页统计。
 * 数据全部存在 localStorage（qs_eng_* 前缀）：
 *   qs_eng_answers  每卷答案速录（判分依据）
 *   qs_eng_session_{id}  每卷作答进度 { answers, graded, result }
 *   qs_eng_results  每卷成绩汇总（英语专题自己的统计）
 * 题库 JSON 由构建管线从公开真题站生成，部署为静态资源。
 */
import { utils } from '../utils.js';

const CATS = [
    { key: 'cet4', label: '四级真题', labelEn: 'CET-4' },
    { key: 'cet6', label: '六级真题', labelEn: 'CET-6' },
    { key: 'kaoyan', label: '考研英语', labelEn: 'Graduate' }
];

export const english = {
    _cat: 'cet4',
    _indexCache: {},
    _keysCache: null,
    _loading: false,
    _sess: null,        // 当前练习会话
    _curSec: null,      // 当前 Section
    _psgFont: null,

    t(s) { return (window.App && App.t) ? App.t(s) : s; },
    esc(s) { return utils.escapeHTML(String(s == null ? '' : s)); },

    /* ---------- 存储 ---------- */

    /** 内置答案键（站点随包发布）+ 用户本地覆盖，合并出有效 key */
    effectiveKey(id) {
        const builtin = (this._keysCache || {})[id] || {};
        const mine = this.answers()[id] || {};
        const merged = Object.assign({}, builtin);
        for (const k of Object.keys(mine)) merged[k] = mine[k];
        return merged;
    },

    async _ensureKeys() {
        if (this._keysCache) return;
        try {
            const r = await fetch('english/keys.json?b=' + Date.now());
            this._keysCache = await r.json();
        } catch (e) {
            this._keysCache = {};
        }
    },

    answers() {
        try { return JSON.parse(localStorage.getItem('qs_eng_answers') || '{}'); } catch (e) { return {}; }
    },
    saveAnswers(all) {
        try { localStorage.setItem('qs_eng_answers', JSON.stringify(all)); } catch (e) { }
    },
    results() {
        try { return JSON.parse(localStorage.getItem('qs_eng_results') || '{}'); } catch (e) { return {}; }
    },
    saveResults(all) {
        try { localStorage.setItem('qs_eng_results', JSON.stringify(all)); } catch (e) { }
    },
    loadSession(id) {
        try { return JSON.parse(localStorage.getItem('qs_eng_session_' + id) || 'null'); } catch (e) { return null; }
    },
    saveSession() {
        if (!this._sess) return;
        try {
            localStorage.setItem('qs_eng_session_' + this._sess.id, JSON.stringify({
                answers: this._sess.answers, graded: this._sess.graded, result: this._sess.result
            }));
        } catch (e) { }
    },

    /** 解析答案速录文本：支持 "26-30 CADBE"（区间+顺序字母）与 "26. A"（单题）混排 */
    parseKeyText(text) {
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
        const single = /(\d{1,3})\s*[.、\)）]?\s*([A-O])(?![A-O])/g;
        while ((m = single.exec(text)) !== null) {
            const no = parseInt(m[1], 10);
            if (!(no in res) && no >= 1 && no <= 99) res[no] = m[2];
        }
        return res;
    },

    /** PDF 断行重排：单换行接回空格；段落边界按行短+句末标点 / 行首标记判定 */
    reflowPassage(text) {
        let t = (text || '').replace(/\r/g, '');
        t = t.replace(/^\s*Questions?\s+\d+\s+to\s+\d+[^\n]*$/gim, '');
        const lines = t.split('\n').map(function(l) { return l.trim(); }).filter(Boolean);
        // 保守分段：只在强标记（段落字母/题号/Section/Passage）处分段，
        // 其余行一律空格接回——绝不在句中截断（启发式猜段落误判率高，用户实测踩坑）
        const markerStart = new RegExp('^(\\[[A-O]\\]|[A-O][\\)\\.]\\s+\\S|\\d{1,2}[\\.\\s]\\s*[A-Z\u201c]|(Section|Part|Passage)\\b)', 'i');
        let out = '';
        let prevLine = null;
        for (let li = 0; li < lines.length; li++) {
            const line = lines[li];
            if (prevLine === null) {
                out = line;
            } else if (markerStart.test(line)) {
                out += '\n\n' + line;
            } else {
                out += ' ' + line;
            }
            prevLine = line;
        }
        return out;
    },

    /* ---------- 试卷列表 ---------- */

    render() {
        this._sess = null;
        const root = document.getElementById('english-root');
        if (!root) return;
        const results = this.results();
        const done = Object.keys(results).length;
        const graded = Object.values(results).filter(r => !r.selfCheck);
        const avg = graded.length ? Math.round(graded.reduce((s, r) => s + r.correct / r.total, 0) / graded.length * 100) : null;
        const tabs = CATS.map(c => {
            const on = c.key === this._cat;
            return '<button data-cat="' + c.key + '" class="px-3.5 py-1.5 rounded-full text-xs font-bold border transition-all ' +
                (on ? 'bg-primary-600 text-white border-primary-600 shadow-sm' : 'border-[var(--border)] text-[var(--sub)] hover:bg-[var(--bg)]') + '">' +
                this.t(c.label) + '</button>';
        }).join('');
        const statsHtml =
            '<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--sub)] px-1">' +
            '<span>' + this.t('已完成') + ' <b class="text-[var(--text)]">' + done + '</b> ' + this.t('套') + '</span>' +
            (avg !== null ? '<span>' + this.t('平均正确率') + ' <b class="text-emerald-500">' + avg + '%</b></span>' : '') +
            '<span class="opacity-70">' + this.t('英语数据独立保存，不计入主页统计') + '</span>' +
            '</div>';
        root.innerHTML =
            '<div class="flex flex-wrap items-center justify-between gap-2">' +
            '<div class="flex gap-2">' + tabs + '</div>' +
            '</div>' +
            statsHtml +
            '<div id="eng-list" class="flex flex-col gap-2"></div>' +
            '<div class="text-[10px] text-[var(--sub)] opacity-75 leading-relaxed px-1">' +
            this.t('题目来源：zhenti.burningvocabulary.cn（公开真题 PDF 解析生成）。点「答案」粘贴任意公开渠道的答案速查后可自动判分；未录入答案则以自测模式完成。') +
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
        if (!this._keysCache) this._ensureKeys();
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
        if (!list) return;
        const data = this._indexCache[this._cat] || [];
        if (!data.length) {
            list.innerHTML = '<div class="text-xs text-[var(--sub)] text-center py-8">' + this.t('暂无试卷。') + '</div>';
            return;
        }
        const answers = this.answers();
        const results = this.results();
        const groups = [];
        for (const p of data) {
            const y = p.id.split('-')[1];
            let g = groups.find(x => x.year === y);
            if (!g) { g = { year: y, items: [] }; groups.push(g); }
            g.items.push(p);
        }
        let html = '';
        for (const g of groups) {
            html += '<div class="text-[11px] font-bold text-[var(--sub)] uppercase tracking-wider px-1 pt-2">' + g.year + '</div>';
            for (const p of g.items) {
                const keyed = Object.keys(Object.assign({}, this._keysCache && this._keysCache[p.id] || {}, answers[p.id] || {})).length;
                const res = results[p.id];
                let badge;
                if (res) {
                    badge = res.selfCheck
                        ? '<span class="text-[10px] font-bold text-primary-600 bg-primary-50 dark:bg-primary-950/30 px-2 py-0.5 rounded-full">' + this.t('已自测') + '</span>'
                        : '<span class="text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 rounded-full">' + res.correct + '/' + res.total + '</span>';
                } else if (keyed >= p.qCount) {
                    badge = '<span class="text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 rounded-full">' + this.t('答案已录入') + '</span>';
                } else if (keyed > 0) {
                    badge = '<span class="text-[10px] font-bold text-amber-600 bg-amber-50 dark:bg-amber-950/30 px-2 py-0.5 rounded-full">' + keyed + '/' + p.qCount + '</span>';
                } else {
                    badge = '<span class="text-[10px] font-bold text-[var(--sub)] bg-[var(--bg)] px-2 py-0.5 rounded-full">' + this.t('未录入答案') + '</span>';
                }
                html +=
                    '<div class="card p-3 rounded-xl flex items-center justify-between gap-2">' +
                    '<div class="min-w-0">' +
                    '<div class="text-xs font-bold text-[var(--text)] truncate">' + this.esc(p.title) + '</div>' +
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
        list.querySelectorAll('[data-act="go"]').forEach(b => b.addEventListener('click', () => this.startSession(b.dataset.id)));
    },

    _paperMeta(id) {
        return (this._indexCache[this._cat] || []).find(p => p.id === id);
    },

    /* ---------- 答案速录 ---------- */

    openKeyModal(id) {
        const meta = this._paperMeta(id);
        if (!meta) return;
        const old = document.getElementById('modal-eng-key');
        if (old) old.remove();
        const cur = this.answers()[id] || {};
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
            '<div class="text-[11px] text-[var(--sub)] leading-relaxed">' + this.esc(meta.title) + '<br>' +
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
            const n = Object.keys(this.parseKeyText(input.value)).length;
            preview.textContent = n ? this.t('已识别 N 个答案').replace('N', n) + '（' + meta.qCount + ' ' + this.t('题') + '）' : '';
        };
        input.addEventListener('input', updatePreview);
        updatePreview();
        modal.addEventListener('click', (e) => {
            if (e.target === modal || e.target.closest('[data-close]')) modal.remove();
            if (e.target.closest('[data-clear]')) {
                const all = this.answers();
                delete all[id];
                this.saveAnswers(all);
                modal.remove();
                if (this._sess && this._sess.id === id) this._sess.key = {};
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
                if (this._sess && this._sess.id === id) this._sess.key = parsed;
                modal.remove();
                this._renderList();
            }
        });
    },

    /* ---------- 整卷练习会话 ---------- */

    async startSession(id) {
        if (this._loading) return;
        const meta = this._paperMeta(id);
        if (!meta) return;
        const root = document.getElementById('english-root');
        if (root) root.innerHTML = '<div class="text-xs text-[var(--sub)] text-center py-10">' + this.t('正在加载试卷…') + '</div>';
        let data;
        try {
            const r = await fetch('english/' + meta.file + '?b=' + Date.now());
            data = await r.json();
        } catch (e) {
            this.render();
            if (typeof showGlobalError === 'function') showGlobalError(this.t('试卷加载失败，请重试。'));
            return;
        }
        const sections = data.sections || {};
        const questions = (data.questions || []).slice().sort((a, b) => a.no - b.no).map(q => {
            const sec = sections[q.sec] || {};
            const parts = [];
            if (sec.label) parts.push('【' + sec.label + ' · Q' + q.no + '】');
            if (q.sec === 'A' && sec.words && sec.words.length) {
                parts.push(sec.words.map((w, i) => String.fromCharCode(65 + i) + '. ' + w).join('   '));
            }
            parts.push(q.q);
            return {
                no: q.no,
                sec: q.sec,
                stem: parts.join('\n\n'),
                o: (q.o && q.o.length ? q.o.map(x => String(x).replace(/^[A-O][\)\.]\s*/, '')) : (sec.words || []).slice()),
                psg: sec.passage ? this.reflowPassage(sec.passage) : null
            };
        });
        // Section 顺序按题目首次出现
        const secOrder = [];
        for (const q of questions) if (!secOrder.includes(q.sec)) secOrder.push(q.sec);
        // 每个 Section 自己的文章（完形节 = 带行内空号的完整文章）
        const secPassages = {};
        for (const sec of secOrder) {
            const secMeta = sections[sec] || {};
            if (secMeta.passage) secPassages[sec] = this.reflowPassage(secMeta.passage);
        }
        // 完形型 Section：文章内含空号，题干冗余 → 卡片只留选项
        const clozeSecs = secOrder.filter(sec => {
            if (!secPassages[sec]) return false;
            const nos = questions.filter(q => q.sec === sec).map(q => q.no);
            return nos.length > 0 && nos.every(no => new RegExp('(?<![\\d])' + no + '(?![\\d])').test(secPassages[sec]));
        });
        const saved = this.loadSession(id) || {};
        this._sess = {
            id,
            title: meta.title,
            questions,
            secOrder,
            sections,
            secPassages,
            clozeSecs,
            key: this.effectiveKey(id),
            answers: saved.answers || {},
            graded: !!saved.graded,
            result: saved.result || null,
            curSec: secOrder[0]
        };
        this.renderSession();
    },

    /** 完形空位槽：已填显示词，未填显示空号；点击弹选词面板 */
    _slotHtml(no) {
        const s = this._sess;
        const letter = s.answers[no];
        const q = s.questions.find(q => q.no === no);
        const word = letter && q ? (q.o['ABCDEFGHIJKLMNOPQRSTUVWXYZ'.indexOf(letter)] || '') : '';
        const gradedCls = s.graded && s.key[no] ? (letter === (s.key[no] || '').toUpperCase() ? ' ok' : ' bad') : '';
        return '<button class="eng-blank-slot' + (letter ? ' filled' : '') + gradedCls + '" data-no="' + no + '">' +
            (letter ? '<b>' + this.esc(word) + '</b><i>' + no + '</i>' : '<i>' + no + '</i>') +
            '</button>';
    },

    /** 底部选词面板：列出该空的所有选项 */
    openPicker(no) {
        const s = this._sess;
        if (!s || s.graded) return;
        const q = s.questions.find(q => q.no === no);
        if (!q) return;
        const pk = document.getElementById('eng-picker');
        if (!pk) return;
        pk.querySelector('#eng-pk-title').textContent = 'Q' + no;
        const cur = s.answers[no] || '';
        pk.querySelector('#eng-pk-opts').innerHTML = q.o.map((opt, i) => {
            const letter = String.fromCharCode(65 + i);
            return '<button data-letter="' + letter + '" class="eng-opt' + (cur === letter ? ' sel' : '') + '">' +
                '<span class="font-bold flex-shrink-0">' + letter + '</span>' +
                (opt === letter ? '' : '<span class="min-w-0">' + this.esc(opt) + '</span>') +
                '</button>';
        }).join('');
        pk.classList.remove('hidden');
        pk.dataset.no = String(no);
    },

    closePicker() {
        const pk = document.getElementById('eng-picker');
        if (pk) pk.classList.add('hidden');
    },

    secLabel(sec) {
        const s = (this._sess.sections || {})[sec] || {};
        return s.label || sec;
    },

    renderSession() {
        const root = document.getElementById('english-root');
        if (!root || !this._sess) return;
        const s = this._sess;
        const answered = Object.keys(s.answers).length;
        const tabs = s.secOrder.map(sec => {
            const on = sec === s.curSec;
            const done = s.questions.filter(q => q.sec === sec && s.answers[q.no]).length;
            const total = s.questions.filter(q => q.sec === sec).length;
            return '<button data-sec="' + sec + '" class="px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all ' +
                (on ? 'bg-primary-600 text-white border-primary-600' : 'border-[var(--border)] text-[var(--sub)] hover:bg-[var(--bg)]') + '">' +
                this.esc(this.secLabel(sec)) +
                (this._sess.key && Object.keys(this._sess.key).length >= s.questions.length
                    ? ''
                    : '') +
                ' <span class="opacity-75">' + done + '/' + total + '</span></button>';
        }).join('');
        const psgText = s.secPassages[s.curSec] || '';
        root.innerHTML =
            '<div class="flex items-center justify-between gap-2 flex-wrap">' +
            '<div class="flex items-center gap-2 min-w-0">' +
            '<button data-back class="w-8 h-8 rounded-full bg-[var(--card)] border border-[var(--border)] text-[var(--sub)] active:scale-95 transition-transform flex-shrink-0 flex items-center justify-center"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg></button>' +
            '<div class="text-xs font-bold text-[var(--text)] truncate">' + this.esc(s.title) + '</div>' +
            '</div>' +
            '<div class="flex items-center gap-2">' +
            '<span class="text-[11px] text-[var(--sub)]">' + this.t('已答') + ' <b class="text-[var(--text)]">' + answered + '</b>/' + s.questions.length + '</span>' +
            '<button data-submit class="px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-bold hover:bg-emerald-700 active:scale-95 transition-all shadow-sm">' + this.t('交卷') + '</button>' +
            '</div></div>' +
            '<div class="eng-session grid gap-3 md:gap-4">' +
            '<div class="eng-psg-col card p-4 md:p-5 rounded-2xl flex flex-col bg-[var(--card)] border border-[var(--border)]">' +
            '<div class="flex justify-between items-center mb-2 md:mb-3">' +
            '<span class="text-[11px] font-bold text-[var(--sub)] uppercase tracking-wider">' + this.t('文章 Passage') + '</span>' +
            '<div class="flex items-center gap-1.5">' +
            '<button onclick="App.views.english.psgFont(-1)" aria-label="缩小字体" class="psg-font-btn">A−</button>' +
            '<button onclick="App.views.english.psgFont(1)" aria-label="放大字体" class="psg-font-btn">A+</button>' +
            '<button data-psg-close class="md:hidden p-1 text-[var(--sub)] hover:text-[var(--text)] active:scale-90 transition-all"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button>' +
            '</div></div>' +
            '<div id="eng-psg-text" class="flex-1 min-h-0 overflow-y-auto custom-scroll whitespace-pre-line text-sm md:text-[15px] leading-relaxed text-[var(--text)]" style="font-family:\'Times New Roman\',\'Times\',\'Georgia\',serif;font-weight:400"></div>' +
            '<div id="eng-psg-bank" class="hidden mt-3 pt-2.5 border-t border-[var(--border)] text-[11px] leading-loose text-[var(--text)]"></div>' +
            '</div>' +
            '<div class="eng-q-col flex flex-col gap-3 min-w-0">' +
            '<button data-psg-open class="hidden md:hidden w-full px-3 py-2.5 rounded-xl border border-primary-200 dark:border-primary-900 bg-primary-50 dark:bg-primary-950/30 text-primary-600 dark:text-primary-400 text-xs font-bold items-center justify-center gap-2 active:scale-[0.99] transition-all"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg><span>' + this.t('阅读文章 (Passage)') + '</span></button>' +
            '<div class="flex gap-1.5 flex-wrap">' + tabs + '</div>' +
            '<div id="eng-q-list" class="flex flex-col gap-2.5"></div>' +
            '</div>' +
            '</div>' +
            '<div class="eng-psg-backdrop fixed inset-0 bg-black/40 z-[55] hidden md:hidden"></div>' +
            '<div id="eng-picker" class="fixed inset-0 z-[65] hidden">' +
            '<div class="absolute inset-0 bg-black/40" data-pk-close></div>' +
            '<div class="absolute bottom-0 left-0 right-0 card rounded-t-2xl p-4 max-h-[72vh] overflow-y-auto custom-scroll animate-slide-up">' +
            '<div class="flex justify-between items-center mb-2.5">' +
            '<b class="text-sm text-[var(--text)]" id="eng-pk-title">Q</b>' +
            '<button data-pk-close aria-label="关闭" class="text-[var(--sub)] hover:text-[var(--text)] p-1"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button>' +
            '</div>' +
            '<div id="eng-pk-opts" class="flex flex-col gap-1.5"></div>' +
            '<button data-pk-clear class="mt-3 w-full px-3 py-2 rounded-lg border border-red-200 dark:border-red-900 text-[11px] font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-all">' + this.t('清除该空') + '</button>' +
            '</div></div>';
        // 事件绑定
        root.querySelector('[data-back]').addEventListener('click', () => this.render());
        root.querySelector('[data-submit]').addEventListener('click', () => this.submitSession());
        root.querySelector('[data-psg-close]').addEventListener('click', () => this.togglePsg(false));
        const psgOpen = root.querySelector('[data-psg-open]');
        if (psgOpen) psgOpen.addEventListener('click', () => this.togglePsg(true));
        const bd = root.querySelector('.eng-psg-backdrop');
        bd.addEventListener('click', () => this.togglePsg(false));
        root.querySelectorAll('[data-sec]').forEach(b => b.addEventListener('click', () => { s.curSec = b.dataset.sec; this.renderQuestions(); this._syncTabs(); this._syncPassage(); }));
        this._syncPassage();
        // 完形槽位点击委托（_syncPassage 会重建 innerHTML，用委托保证一直有效）
        root.querySelector('#eng-psg-text').addEventListener('click', (e) => {
            const slot = e.target.closest('.eng-blank-slot');
            if (slot) this.openPicker(parseInt(slot.dataset.no, 10));
        });
        const picker = root.querySelector('#eng-picker');
        picker.addEventListener('click', (e) => {
            if (e.target.closest('[data-pk-close]') || e.target === picker) this.closePicker();
            if (e.target.closest('[data-pk-clear]')) {
                const no = parseInt(picker.dataset.no, 10);
                delete this._sess.answers[no];
                this.saveSession();
                this.closePicker();
                this._syncPassage();
                this.renderQuestions();
                this._updateCounter();
            }
            const opt = e.target.closest('#eng-pk-opts .eng-opt');
            if (opt) {
                this._assign(parseInt(picker.dataset.no, 10), opt.dataset.letter);
                this.closePicker();
            }
        });
        this.renderQuestions();
    },

    /** 完形赋值：写入答案 → 刷新槽位 + 作答条 + 计数 */
    _assign(no, letter) {
        const s = this._sess;
        if (!s || s.graded) return;
        if (s.answers[no] === letter) delete s.answers[no];
        else s.answers[no] = letter;
        this.saveSession();
        this._syncPassage();
        this.renderQuestions();
        this._updateCounter();
        this._syncTabs();
    },

    /** 文章栏跟随当前 Section：内容 + 词库 + 空号高亮 + 抽屉按钮可见性 */
    _syncPassage() {
        const s = this._sess;
        const root = document.getElementById('english-root');
        if (!root || !s) return;
        const session = root.querySelector('.eng-session');
        const txt = root.querySelector('#eng-psg-text');
        const bankEl = root.querySelector('#eng-psg-bank');
        const openBtn = root.querySelector('[data-psg-open]');
        if (!session || !txt || !bankEl) return;
        const psg = s.secPassages[s.curSec] || '';
        const isCloze = s.clozeSecs.includes(s.curSec);
        session.classList.toggle('has-psg', !!psg);
        if (this._psgFont == null) {
            let v = 15;
            try { v = parseInt(localStorage.getItem('qs_psg_fontsize'), 10) || 15; } catch (e) { }
            this._psgFont = Math.min(24, Math.max(12, v));
        }
        txt.style.fontSize = this._psgFont + 'px';
        const nos = s.questions.filter(q => q.sec === s.curSec).map(q => q.no).sort((a, b) => b - a);
        if (isCloze && psg && nos.length) {
            // 完形节：空号渲染成可点击槽位（已填的把词显示在空里）
            const re = new RegExp('(?<!\w)(' + nos.join('|') + ')(?!\w)(?!\.\d)', 'g');
            txt.innerHTML = this.esc(psg).replace(re, (m, no) => this._slotHtml(parseInt(no, 10)));
        } else {
            // 阅读节：段落标记醒目化（[A] / A. 行首），便于长篇阅读定位
            txt.innerHTML = this.esc(psg).replace(/(^|\n)(\[?[A-L]\]?[.\)])\s+/g, '$1<span class="eng-para-mark">$2</span> ');
        }
        // 选词填空：词库挂在文章下方（仅参考，作答点空位弹面板）
        const words = (s.sections[s.curSec] || {}).words || [];
        if (words.length) {
            bankEl.innerHTML = '<span class="text-[10px] font-bold text-[var(--sub)] uppercase tracking-wider mr-2">' + this.t('词库 Word Bank') + '</span>' +
                words.map((w, i) => '<span class="eng-bank-word">' + String.fromCharCode(65 + i) + '. ' + this.esc(w) + '</span>').join('');
            bankEl.classList.remove('hidden');
        } else {
            bankEl.classList.add('hidden');
            bankEl.innerHTML = '';
        }
        if (openBtn) openBtn.style.display = psg ? 'flex' : 'none';
        if (!psg) this.togglePsg(false);
    },

    _syncTabs() {
        const s = this._sess;
        const root = document.getElementById('english-root');
        if (!root || !s) return;
        root.querySelectorAll('[data-sec]').forEach(b => {
            const on = b.dataset.sec === s.curSec;
            b.className = 'px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all ' +
                (on ? 'bg-primary-600 text-white border-primary-600' : 'border-[var(--border)] text-[var(--sub)] hover:bg-[var(--bg)]');
        });
    },

    renderQuestions() {
        const s = this._sess;
        const wrap = document.getElementById('eng-q-list');
        if (!wrap || !s) return;
        const graded = s.graded;
        const isCloze = s.clozeSecs.includes(s.curSec);
        // 完形节：作答条（空位总览；作答在文章里点空位完成）
        if (isCloze) {
            const qs = s.questions.filter(q => q.sec === s.curSec).sort((a, b) => a.no - b.no);
            const rows = qs.map(q => {
                const letter = s.answers[q.no] || '';
                const keyAns = (s.key[q.no] || '').toUpperCase();
                const word = letter ? (q.o['ABCDEFGHIJKLMNOPQRSTUVWXYZ'.indexOf(letter)] || '') : '';
                let cls = 'eng-strip-row' + (letter ? ' has' : '');
                let mark = '';
                if (graded && keyAns) {
                    cls += letter === keyAns ? ' ok' : ' bad';
                    mark = '<span class="text-[10px] font-bold flex-shrink-0 ' + (letter === keyAns ? 'text-emerald-500' : 'text-red-500') + '">' +
                        (letter === keyAns ? '✓' : '✕ ' + keyAns) + '</span>';
                }
                return '<button data-no="' + q.no + '" class="' + cls.trim() + '">' +
                    '<span class="font-mono font-bold text-[11px] flex-shrink-0">Q' + q.no + '</span>' +
                    '<span class="min-w-0 flex-1 text-left truncate">' + (letter ? this.esc(word) : '<i class="opacity-40">____</i>') + '</span>' +
                    mark +
                    '</button>';
            }).join('');
            wrap.innerHTML =
                '<div class="card p-3.5 rounded-xl">' +
                '<div class="text-[11px] text-[var(--sub)] mb-2 leading-relaxed">' + this.t('在文章里点击空位作答；这里总览全部空的填写情况。') + '</div>' +
                '<div class="flex flex-col gap-1.5">' + rows + '</div>' +
                '</div>';
            wrap.querySelectorAll('.eng-strip-row').forEach(b => {
                b.addEventListener('click', () => this.openPicker(parseInt(b.dataset.no, 10)));
            });
            return;
        }
        const html = s.questions.filter(q => q.sec === s.curSec).map(q => {
            const picked = s.answers[q.no] || '';
            const keyAns = (s.key[q.no] || '').toUpperCase();
            let state = '';
            if (graded && keyAns) state = picked === keyAns ? 'ok' : 'bad';
            // 纯字母选项（长篇阅读选段落）：紧凑小 chips，一排多个，不占大卡
            const letterOnly = q.o.length > 4 && q.o.every(x => String(x).length <= 2);
            const opts = q.o.map((opt, i) => {
                const letter = String.fromCharCode(65 + i);
                const sel = picked === letter;
                let cls = (letterOnly ? 'eng-chip' : 'eng-opt') + (sel ? ' sel' : '') + (graded && keyAns ? (letter === keyAns ? ' ok' : (sel ? ' bad' : '')) : '');
                return '<button data-no="' + q.no + '" data-letter="' + letter + '" class="' + cls.trim() + '" ' +
                    (letterOnly ? 'aria-label="段落 ' + letter + '"' : '') + '>' +
                    '<span class="font-bold flex-shrink-0">' + letter + '</span>' +
                    (this.isLetterOnly(opt, letter) ? '' : '<span class="min-w-0">' + this.esc(opt) + '</span>') +
                    '</button>';
            }).join('');
            const gradeNote = (graded && keyAns && picked !== keyAns)
                ? '<div class="text-[11px] text-emerald-500 mt-1">' + this.t('正确答案') + '：<b>' + keyAns + '</b></div>'
                : '';
            const stemHtml = isCloze
                ? ''
                : '<div class="text-xs font-bold text-[var(--text)] leading-relaxed whitespace-pre-line min-w-0" style="text-wrap:pretty">' + this.esc(q.stem) + '</div>';
            const optsWrap = letterOnly
                ? '<div class="flex flex-wrap gap-1.5">' + opts + '</div>'
                : '<div class="eng-opts flex flex-col gap-1.5">' + opts + '</div>';
            return '<div class="card p-3.5 rounded-xl">' +
                '<div class="flex items-start justify-between gap-2 mb-2">' +
                stemHtml +
                '<span class="text-[10px] font-mono font-bold text-[var(--sub)] bg-[var(--bg)] px-1.5 py-0.5 rounded flex-shrink-0">Q' + q.no + '</span>' +
                '</div>' +
                optsWrap +
                gradeNote +
                '</div>';
        }).join('');
        wrap.innerHTML = html;
        wrap.querySelectorAll('.eng-opt, .eng-chip').forEach(b => {
            b.addEventListener('click', () => this.pick(b.dataset.no, b.dataset.letter));
        });
    },

    /** 选项文本与字母相同（长篇阅读段落字母）→ 只渲染字标 */
    isLetterOnly(opt, letter) {
        return String(opt) === String(letter);
    },

    pick(no, letter) {
        const s = this._sess;
        if (!s || s.graded) return;
        if (s.answers[no] === letter) delete s.answers[no];   // 再点一次取消选择
        else s.answers[no] = letter;
        this.saveSession();
        // 局部刷新该题选中态 + 顶部计数
        this.renderQuestions();
        const counter = document.querySelector('#english-root [data-submit]') ? document.querySelector('#english-root .text-\\[11px\\]') : null;
        this._updateCounter();
        this._syncTabs();
    },

    _updateCounter() {
        const s = this._sess;
        if (!s) return;
        const span = [...document.querySelectorAll('#english-root span')].find(x => x.textContent.indexOf(this.t('已答')) === 0);
        if (span) span.innerHTML = this.t('已答') + ' <b class="text-[var(--text)]">' + Object.keys(s.answers).length + '</b>/' + s.questions.length;
    },

    togglePsg(force) {
        const root = document.getElementById('english-root');
        if (!root) return;
        const col = root.querySelector('.eng-psg-col');
        const bd = root.querySelector('.eng-psg-backdrop');
        if (!col || !bd) return;
        const open = typeof force === 'boolean' ? force : !col.classList.contains('open');
        col.classList.toggle('open', open);
        bd.classList.toggle('hidden', !open);
    },

    psgFont(delta) {
        if (this._psgFont == null) {
            let v = 15;
            try { v = parseInt(localStorage.getItem('qs_psg_fontsize'), 10) || 15; } catch (e) { }
            this._psgFont = Math.min(24, Math.max(12, v));
        }
        this._psgFont = Math.min(24, Math.max(12, this._psgFont + delta));
        try { localStorage.setItem('qs_psg_fontsize', String(this._psgFont)); } catch (e) { }
        const txt = document.getElementById('eng-psg-text');
        if (txt) txt.style.fontSize = this._psgFont + 'px';
    },

    submitSession() {
        const s = this._sess;
        if (!s) return;
        const answered = Object.keys(s.answers).length;
        if (answered === 0) {
            if (typeof showGlobalError === 'function') showGlobalError(this.t('还没有作答任何题目。'));
            return;
        }
        const unanswered = s.questions.length - answered;
        if (unanswered > 0 && !confirm(this.t('还有 N 题未作答，确定交卷吗？').replace('N', unanswered))) return;
        const keyCount = Object.keys(s.key).length;
        if (keyCount < s.questions.length) {
            // 自测完成：不判分
            s.graded = false;
            s.result = { correct: 0, total: s.questions.length, ts: Date.now(), selfCheck: true };
            const results = this.results();
            results[s.id] = s.result;
            this.saveResults(results);
            this.saveSession();
            if (typeof showGlobalError === 'function') showGlobalError(this.t('自测完成（未录入答案，不判分）。点「答案」补录后可重做自动判分。'));
            this.render();
            return;
        }
        // 判分
        let correct = 0;
        for (const q of s.questions) {
            if ((s.answers[q.no] || '') === (s.key[q.no] || '').toUpperCase()) correct++;
        }
        s.graded = true;
        s.result = { correct, total: s.questions.length, ts: Date.now() };
        const results = this.results();
        results[s.id] = s.result;
        this.saveResults(results);
        this.saveSession();
        // 重渲染题目列表：正确/错误标记 + 正确答案提示（renderQuestions 读取 graded 态）
        this.renderQuestions();
        // 结果横幅 + 重做入口
        const root = document.getElementById('english-root');
        if (root) {
            const banner = document.createElement('div');
            banner.className = 'card p-4 rounded-xl text-center';
            banner.innerHTML =
                '<div class="text-2xl font-bold ' + (correct / s.questions.length >= 0.6 ? 'text-emerald-500' : 'text-red-500') + '">' +
                Math.round(correct / s.questions.length * 100) + '%</div>' +
                '<div class="text-xs text-[var(--sub)] mt-1">' + this.t('正确') + ' ' + correct + ' / ' + s.questions.length +
                ' · <button data-redo class="underline font-bold hover:text-[var(--text)]">' + this.t('重做本卷') + '</button></div>';
            root.prepend(banner);
            banner.querySelector('[data-redo]').addEventListener('click', () => this.redoSession());
        }
        this._syncTabs();
        if (typeof showGlobalError === 'function') showGlobalError(this.t('判分完成：正确 X/Y').replace('X', correct).replace('/Y', '/' + s.questions.length));
    },

    redoSession() {
        const s = this._sess;
        if (!s) return;
        if (!confirm(this.t('清空本卷作答并重做？（答案速录保留）'))) return;
        s.answers = {};
        s.graded = false;
        s.result = null;
        this.saveSession();
        const results = this.results();
        delete results[s.id];
        this.saveResults(results);
        this.renderSession();
    }
};
