export const library = {

                    currentMode: 'all',
                    _searchQuery: '',
                    _debounceTimer: null,
                    _scrollListenerAttached: false,
                    _searchKeydownAttached: false,
                    _expandAll: false,
                    // 管理模式与选中集合
                    _manageMode: false,
                    _selectedIds: new Set(),
                    // 增量渲染：一次最多渲染多少条，剩下的滚动到底部附近再追加。
                    // 题库可能有几千上万道，一次性全量生成 DOM 会卡顿
                    // （实测 6000 题约 490ms、6000 个节点）。
                    PAGE_SIZE: 100,
                    _fullList: [],
                    _renderedCount: 0,
                    _lazyAttached: false,
                    _lazyContainer: null,

                    handleTypeChange() { this.render(); },

                    handleSearch(val) {
                        clearTimeout(this._debounceTimer);
                        const clearBtn = App.dom.get('lib-search-clear');
                        if (clearBtn) clearBtn.classList.toggle('hidden', val.length === 0);

                        this._debounceTimer = setTimeout(() => {
                            this._searchQuery = val.trim().toLowerCase();
                            this.render();
                        }, 300);
                    },

                    clearSearch() {
                        const input = App.dom.get('lib-search');
                        if (input) input.value = '';
                        this.handleSearch('');
                    },

                    backToTop() {
                        // 不能对 #lib-list 调 scrollTo：它没有固定高度、本身不滚动，
                        // 真正滚动的是外层 <main>。要用 getScrollParent 找到它。
                        const el = App.dom.get('lib-list');
                        const scroller = App.utils.getScrollParent(el);
                        if (!scroller) return;
                        if (typeof scroller.scrollTo === 'function') {
                            scroller.scrollTo({ top: 0, behavior: 'smooth' });
                        } else {
                            scroller.scrollTop = 0;
                        }
                    },

                    toggleExpandAll() {
                        this._expandAll = !this._expandAll;
                        const listEl = App.dom.get('lib-list');
                        if (!listEl) return;
                        const panels = listEl.querySelectorAll('.details-panel');
                        panels.forEach(p => {
                            if (this._expandAll) p.classList.remove('hidden');
                            else p.classList.add('hidden');
                        });
                        const btn = App.dom.get('lib-toggle-expand');
                        if (btn) {
                            // 与多选按钮同一套激活语言：浅青 tint，不用实心大色块
                            btn.classList.toggle('border-primary-500', this._expandAll);
                            btn.classList.toggle('bg-primary-600/15', this._expandAll);
                            btn.classList.toggle('text-primary-600', this._expandAll);
                            btn.classList.toggle('dark:border-primary-500/60', this._expandAll);
                            btn.classList.toggle('dark:bg-primary-500/20', this._expandAll);
                            btn.classList.toggle('dark:text-primary-400', this._expandAll);
                            btn.setAttribute('aria-pressed', String(this._expandAll));
                        }
                    },

                    toggleDetails(el) {
                        const container = el.closest('.p-4');
                        if (!container) return;
                        const panel = container.querySelector('.details-panel');
                        if (!panel) return;
                        panel.classList.toggle('hidden');
                    },

                    // 切换管理模式：显示/隐藏多选框和管理工具条
                    toggleManageMode() {
                        this._manageMode = !this._manageMode;
                        this._selectedIds = new Set();

                        const listEl = App.dom.get('lib-list');
                        if (listEl) {
                            const chks = listEl.querySelectorAll('.lib-select-chk');
                            chks.forEach(chk => {
                                chk.classList.toggle('hidden', !this._manageMode);
                                chk.checked = false;
                            });
                        }

                        const bar = App.dom.get('lib-manage-bar');
                        if (bar) bar.classList.toggle('hidden', !this._manageMode);
                        App.dom.setText('lib-selected-count', '0');

                        const btn = App.dom.get('lib-manage-toggle');
                        if (btn) {
                            // 激活态用浅青 tint + 同色描边，与默认幽灵按钮保持同一形状语言。
                            // 之前是实心 primary-600 大色块，观感突兀（用户反馈「丑」）。
                            btn.classList.toggle('border-primary-500', this._manageMode);
                            btn.classList.toggle('bg-primary-600/15', this._manageMode);
                            btn.classList.toggle('text-primary-600', this._manageMode);
                            btn.classList.toggle('dark:border-primary-500/60', this._manageMode);
                            btn.classList.toggle('dark:bg-primary-500/20', this._manageMode);
                            btn.classList.toggle('dark:text-primary-400', this._manageMode);
                            btn.setAttribute('aria-pressed', String(this._manageMode));
                        }
                    },

                    // 多选框变化时更新选中集合
                    handleSelectChange(el) {
                        const id = el.dataset.id;
                        if (!id) return;
                        if (el.checked) this._selectedIds.add(id);
                        else this._selectedIds.delete(id);
                        App.dom.setText('lib-selected-count', String(this._selectedIds.size));
                    },

                    // 单题删除：软删除到回收站
                    deleteSingle(id) {
                        if (!confirm("确定删除这道题吗？此操作会将题目放入回收站，可在回收站中恢复。")) return;
                        App.data.softDeleteByIds(new Set([id]), 'manual-delete');
                        this.render(this.currentMode);
                    },

                    // 批量删除选中
                    bulkDeleteSelected() {
                        if (!this._selectedIds || this._selectedIds.size === 0) {
                            alert("请先勾选至少一题再执行批量删除。");
                            return;
                        }
                        if (!confirm(`确定删除选中的 ${this._selectedIds.size} 道题目吗？这些题将被移入回收站，可在回收站中恢复。`)) return;
                        App.data.softDeleteByIds(this._selectedIds, 'manual-delete-bulk');
                        this._selectedIds = new Set();
                        App.dom.setText('lib-selected-count', '0');
                        this.render(this.currentMode);
                    },

                    // 批量导出选中为 JSON
                    exportSelected() {
                        if (!this._selectedIds || this._selectedIds.size === 0) {
                            alert("请先勾选至少一题再导出。");
                            return;
                        }
                        if (this._selectedIds.size > 500) {
                            if (!confirm(`您选中了 ${this._selectedIds.size} 道题，导出可能需要较长时间，确认继续吗？`)) {
                                return;
                            }
                        }
                        const all = App.data.getQuestions();
                        const selected = all.filter(q => this._selectedIds.has(q.id));
                        if (!selected.length) {
                            alert("选中的题目在当前题库中已不存在。");
                            return;
                        }
                        const out = {};
                        selected.forEach(q => {
                            if (!out[q.sub]) out[q.sub] = {};
                            if (!out[q.sub][q.chap]) out[q.sub][q.chap] = [];
                            const { _pinyin, _aiAnalysis, sub, chap, ...rest } = q;
                            out[q.sub][q.chap].push(rest);
                        });

                        const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `LMS_Export_${Date.now()}.json`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                    },

                    // 构建列表中的一项（返回 DOM 节点，不负责插入容器）
                    _buildItem(q, index) {
                        const d = document.createElement('div');
                        // 错题本模式下加左侧红色标记条，与总题库在视觉上区分
                        d.className = "p-4 border-b border-[var(--border)] hover:bg-[var(--bg-hover)] transition-colors"
                            + (this.currentMode === 'mistakes' ? ' border-l-2 border-l-red-400 dark:border-l-red-600' : '');
                        d.dataset.qid = q.id;

                        let mistakeBadge = '';
                        let delBtn = '';
                        if (this.currentMode === 'mistakes') {
                            const errCount = App.data.getMistakeCount(q.id);
                            mistakeBadge = `<span class="text-[11px] font-bold text-red-600 bg-red-50 dark:bg-red-950/40 dark:text-red-400 border border-red-200 dark:border-red-900 px-1.5 py-0.5 rounded-full">错 ${errCount} 次</span>`;
                            delBtn = `<button class="text-[11px] font-bold text-red-500 border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-2 py-1 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 active:scale-95 transition-all" data-role="forget">移除</button>`;
                        }

                        let ansPreview = '';
                        let detailsHtml = '';

                        if (q.type === 'fill') {
                            ansPreview = `<span class="font-bold text-primary-600">答案：${App.utils.highlight(q.a || '', this._searchQuery)}</span>`;
                            detailsHtml = `<div class="mt-2 text-xs text-[var(--sub)] ${this._expandAll ? '' : 'hidden'} details-panel">此题为填空题，作答时输入答案。</div>`;
                        } else if (q.type === 'tf') {
                            const isTrue = q.a === 'T';
                            ansPreview = isTrue
                                ? '<span class="status-true">√ (正确/True)</span>'
                                : '<span class="status-false">× (错误/False)</span>';
                            detailsHtml = `<div class="mt-2 text-xs text-[var(--sub)] ${this._expandAll ? '' : 'hidden'} details-panel">此题为判断题。</div>`;
                        } else {
                            let inlineAns = q.a;
                            if (q.type === 'mcq') {
                                const idx = q.a.charCodeAt(0) - 65;
                                if (q.o && q.o[idx]) inlineAns = `${q.a}. ${App.utils.highlight(q.o[idx], this._searchQuery)}`;
                            } else if (q.type === 'multi') {
                                inlineAns = q.a.split('').map(c => {
                                    const idx = c.charCodeAt(0) - 65;
                                    return (q.o && q.o[idx]) ? `${c}. ${App.utils.highlight(q.o[idx], this._searchQuery)}` : c;
                                }).join(' , ');
                            }

                            ansPreview = `<span class="font-bold text-primary-600">答案：${inlineAns}</span>`;
                            detailsHtml = `<div class="mt-2 ${this._expandAll ? '' : 'hidden'} details-panel bg-slate-50 dark:bg-slate-800 p-2 rounded-lg border border-[var(--border)]">` +
                                App.utils.getDetailedOptionHTML(q, q.a, this._searchQuery) +
                                `</div>`;
                        }

                        const typeLabel = q.type === 'mcq' ? '单选' : (q.type === 'multi' ? '多选' : (q.type === 'fill' ? '填空' : '判断'));
                        const highlightedQ = App.utils.highlight(q.q, this._searchQuery);

                        const safeSub = App.utils.escapeHTML(q.sub || '');
                        d.innerHTML = `
                            <div class="flex justify-between mb-1 items-center gap-2">
                                <label class="flex items-center gap-2 cursor-pointer select-none min-w-0">
                                    <input type="checkbox" class="lib-select-chk w-4 h-4 mr-1 ${this._manageMode ? '' : 'hidden'}" data-id="${App.utils.escapeHTML(String(q.id || ''))}" onchange="App.views.library.handleSelectChange(this)">
                                    <span class="text-[11px] font-bold text-[var(--sub)] mr-1 flex-shrink-0">#${index + 1}</span>
                                    <span class="text-[11px] font-bold text-primary-600 bg-primary-50 dark:bg-primary-900/30 dark:text-primary-400 px-1 rounded border border-primary-100 dark:border-primary-900 truncate">${safeSub}</span>
                                    <span class="text-[11px] text-[var(--sub)] border border-[var(--border)] px-1 rounded flex-shrink-0">${typeLabel}</span>
                                    ${mistakeBadge}
                                </label>
                                <div class="flex items-center gap-0.5 flex-shrink-0">
                                    ${delBtn}
                                    <button class="w-7 h-7 rounded-lg text-[var(--sub)] hover:text-primary-600 hover:bg-[var(--bg)] active:scale-90 transition-all flex items-center justify-center" data-role="edit" title="编辑题目" aria-label="编辑题目">✎</button>
                                    <button class="w-7 h-7 rounded-lg text-[var(--sub)] hover:text-primary-600 hover:bg-[var(--bg)] active:scale-90 transition-all flex items-center justify-center" data-role="chat" title="详情与作答记录" aria-label="详情与作答记录">
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                            <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                            <div class="font-medium text-sm text-[var(--text)] leading-snug cursor-pointer hover:text-primary-600 transition-colors lib-toggle" onclick="App.views.library.toggleDetails(this)">${highlightedQ}</div>
                            <div class="mt-2 text-xs font-bold text-[var(--sub)] flex flex-col gap-1 cursor-pointer lib-toggle" onclick="App.views.library.toggleDetails(this)">
                                <span>${ansPreview}</span>
                            </div>
                            ${detailsHtml}`;
                        // 题目 ID 通过 dataset 赋值（不受 HTML 转义影响），点击事件统一由列表容器委托处理
                        d.querySelectorAll('[data-role]').forEach(el => { el.dataset.qid = q.id || ''; });
                        return d;
                    },

                    // 追加下一批题目到容器
                    _appendChunk(container, count) {
                        const list = this._fullList || [];
                        if (this._renderedCount >= list.length) return 0;
                        const end = Math.min(this._renderedCount + count, list.length);
                        const frag = document.createDocumentFragment();
                        for (let i = this._renderedCount; i < end; i++) {
                            const node = this._buildItem(list[i], i);
                            if (node) frag.appendChild(node);
                        }
                        container.appendChild(frag);
                        this._renderedCount = end;
                        this._updateLoadMore(container);
                        return end;
                    },

                    // 底部的「已显示 N / M，继续下滑加载更多」
                    _updateLoadMore(container) {
                        const total = (this._fullList || []).length;
                        let el = container.querySelector('.lib-load-more');
                        if (this._renderedCount >= total) {
                            if (el) el.remove();
                            return;
                        }
                        if (!el) {
                            el = document.createElement('div');
                            el.className = 'lib-load-more p-4 text-center text-[11px] text-[var(--sub)]';
                            container.appendChild(el);
                        }
                        el.textContent = `已显示 ${this._renderedCount} / ${total} 题，继续下滑加载更多…`;
                    },

                    // 滚动到底部附近时自动追加下一批（只绑一次，挂在 document 上捕获冒泡的 scroll）
                    _ensureLazyLoader(container) {
                        this._lazyContainer = container;
                        if (this._lazyAttached) return;
                        this._lazyAttached = true;
                        const tryLoad = () => {
                            const c = this._lazyContainer || App.dom.get('lib-list');
                            if (!c) return;
                            const scroller = App.utils.getScrollParent(c);
                            if (!scroller) return;
                            // 距底部不足 600px 时补一批
                            if (scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 600) return;
                            if (this._renderedCount >= (this._fullList || []).length) return;
                            this._appendChunk(c, this.PAGE_SIZE);
                            // 屏幕很高时一批可能填不满，继续补
                            setTimeout(tryLoad, 60);
                        };
                        document.addEventListener('scroll', tryLoad, true);
                        window.addEventListener('resize', tryLoad);
                    },

                    // 「回到顶部」按钮的显隐：必须监听真正的滚动容器
                    _bindScrollUI(container) {
                        if (this._scrollUIAttached) return;
                        const btn = App.dom.get('lib-back-top');
                        if (!btn) return;
                        const scroller = App.utils.getScrollParent(container);
                        if (!scroller) return;
                        const update = () => {
                            btn.classList.toggle('opacity-0', scroller.scrollTop < 200);
                            btn.classList.toggle('pointer-events-none', scroller.scrollTop < 200);
                        };
                        scroller.addEventListener('scroll', update);
                        update();
                        this._scrollUIAttached = true;
                    },

                    // 滚回顶部（滚的是真正会滚动的那个容器）
                    _scrollToTop(container) {
                        const scroller = App.utils.getScrollParent(container || App.dom.get('lib-list'));
                        if (scroller) scroller.scrollTop = 0;
                    },

                    render(mode, opts) {
                        const resetScroll = opts && typeof opts === 'object' ? opts.resetScroll : true;
                        const prevMode = this.currentMode;
                        // 切换模式时重置搜索关键字
                        if (mode && mode !== prevMode) {
                            this._searchQuery = '';
                            App.dom.setValue('lib-search', '');
                            const clearBtn = App.dom.get('lib-search-clear');
                            if (clearBtn) clearBtn.classList.add('hidden');
                        }
                        if (mode) this.currentMode = mode;
                        mode = this.currentMode;

                        // 任何一次重新渲染，都重置管理模式下的选中状态，避免状态遗留
                        if (this._manageMode) {
                            this._selectedIds = new Set();
                            App.dom.setText('lib-selected-count', '0');
                        }

                        App.dom.setText('lib-title', mode === 'mistakes' ? '错题本' : '总题库');

                        const filter = App.dom.get('lib-filter');
                        const typeFilter = App.dom.get('lib-type');
                        const sortSel = App.dom.get('lib-sort');

                        let currentSortValue = sortSel ? sortSel.value : 'default';

                        // 列表内容身份变了（模式/筛选/题型/搜索/数量）才播 160ms 淡入；
                        // 同步轮询触发的同状态重渲染不重播，避免列表每 15 秒眨一次眼
                        const listKey = [this.currentMode, filter && filter.value, typeFilter && typeFilter.value,
                            this._searchQuery, App.data.getQuestions().length].join('|');
                        const listChanged = listKey !== this._lastListKey;
                        this._lastListKey = listKey;

                        if (filter) {
                            const savedFilterValue = filter.value;
                            filter.innerHTML = '<option value="all">全科目</option>';
                            const subjects = App.data.getSubjects();
                            subjects.forEach(s => filter.add(new Option(s, s)));
                            if (savedFilterValue === 'all' || subjects.includes(savedFilterValue)) {
                                filter.value = savedFilterValue;
                            } else {
                                filter.value = 'all';
                            }
                        }

                        if (sortSel) {
                            const currentType = typeFilter ? typeFilter.value : 'all';
                            let html = `
                                <option value="default">默认</option>
                                <option value="err_desc">错率↓</option>
                                <option value="ans_asc">答案A-Z</option>
                            `;
                            if (currentType === 'tf') {
                                html += `<option value="tf_true">答案 (对->错)</option>`;
                                html += `<option value="tf_false">答案 (错->对)</option>`;
                            }
                            sortSel.innerHTML = html;

                            let hasOption = false;
                            for (let i = 0; i < sortSel.options.length; i++) {
                                if (sortSel.options[i].value === currentSortValue) {
                                    hasOption = true; break;
                                }
                            }
                            if (hasOption) sortSel.value = currentSortValue;
                            else { sortSel.value = 'default'; currentSortValue = 'default'; }
                        }

                        let qs = App.data.getQuestions();

                        // 科目筛选在错题本模式下同样生效（控件不再隐藏）
                        if (filter && filter.value !== 'all') qs = qs.filter(q => q.sub === filter.value);
                        if (mode === 'mistakes') {
                            const hidden = new Set(Array.isArray(App.data.hiddenMistakeIds) ? App.data.hiddenMistakeIds : []);
                            const errSet = new Set(App.data.getSafeHistory().filter(h => !h.r && !hidden.has(h.id)).map(h => h.id));
                            qs = qs.filter(q => errSet.has(q.id));
                        }
                        // 题型筛选在错题本模式下同样生效（筛选控件两种模式下都可见）
                        if (typeFilter && typeFilter.value !== 'all') {
                            const t = typeFilter.value;
                            qs = qs.filter(q => q.type === t);
                        }

                        if (this._searchQuery) {
                            const q_str = this._searchQuery;
                            qs = qs.filter(q => {
                                const haystack = [
                                    q.q,
                                    q.chap,
                                    q.a,
                                    ...(q.o || [])
                                ].join(' ').toLowerCase();

                                return haystack.includes(q_str)
                                    || (q._pinyin && q._pinyin.includes(q_str))
                                    || App.utils.fuzzyMatch(haystack, q_str);
                            });
                        }

                        const sType = currentSortValue;
                        let sortedQs = [...qs];

                        if (sType === 'err_desc') {
                            sortedQs.sort((a, b) => {
                                return (App.data.getMistakeCount(b.id) - App.data.getMistakeCount(a.id)) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
                            });
                        } else if (sType === 'ans_asc') {
                            sortedQs.sort((a, b) => {
                                const aAns = (a.a || '').split('').sort().join('');
                                const bAns = (b.a || '').split('').sort().join('');
                                return aAns.localeCompare(bAns, undefined, { numeric: true }) ||
                                    String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
                            });
                        } else if (sType === 'tf_true') {
                            sortedQs.sort((a, b) => {
                                if (a.a === b.a) return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
                                return a.a === 'T' ? -1 : 1;
                            });
                        } else if (sType === 'tf_false') {
                            sortedQs.sort((a, b) => {
                                if (a.a === b.a) return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
                                return a.a === 'F' ? -1 : 1;
                            });
                        }

                        qs = sortedQs;
                        App.dom.setText('lib-count', qs.length);

                        const c = App.dom.get('lib-list');
                        if (!c) return;
                        // rAF：等本帧同步渲染（含各空态分支）完成后，再给容器加淡入类
                        if (listChanged) {
                            requestAnimationFrame(() => {
                                c.classList.remove('anim-list-swap');
                                void c.offsetWidth;
                                c.classList.add('anim-list-swap');
                            });
                        }
                        c.innerHTML = '';

                        if (qs.length === 0) {
                            if (mode === 'mistakes' && Array.isArray(App.data.hiddenMistakeIds) && App.data.hiddenMistakeIds.length) {
                                // 错题本空但有被「移除」的错题：给一个恢复显示的入口，
                                // 否则被移除的题如果一直不再答错就永远找不回来
                                const hiddenCount = App.data.hiddenMistakeIds.length;
                                c.innerHTML = `<div class="p-8 text-center text-xs text-[var(--sub)] flex flex-col items-center gap-3">
                                    <div>错题本已清空。有 <span class="font-bold text-[var(--text)]">${hiddenCount}</span> 道题曾被移出错题本。</div>
                                    <button onclick="App.data.restoreHiddenMistakes()" class="px-4 py-1.5 rounded-full bg-primary-600 text-white text-[11px] font-bold active:scale-95 transition-transform">全部恢复显示</button>
                                </div>`;
                            } else if (this._searchQuery) {
                                const safeQuery = App.utils.escapeHTML(this._searchQuery);
                                c.innerHTML = `<div class="p-8 text-center text-xs text-[var(--sub)]">未找到与 "<span class="font-bold text-primary-600">${safeQuery}</span>" 相关的题目。(No results found)</div>`;
                            } else {
                                c.innerHTML = '<div class="p-8 text-center text-xs text-[var(--sub)]">尚未加载题目。请导入题库或更改筛选条件。</div>';
                            }
                            return;
                        }

                        if (!this._searchKeydownAttached) {
                            const input = App.dom.get('lib-search');
                            if (input) {
                                input.addEventListener('keydown', (e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        input.blur();
                                    }
                                });
                                this._searchKeydownAttached = true;
                            }
                        }

                        // ===== 增量渲染：只渲染首批，其余滚动时再追加 =====
                        this._fullList = qs;
                        this._renderedCount = 0;
                        this._lazyContainer = c;
                        this._appendChunk(c, this.PAGE_SIZE);
                        this._ensureLazyLoader(c);


                        // 列表内按钮点击委托（edit=编辑题目 / chat=AI 抽屉 / forget=移出错题本）
                        if (!this._listClickDelegated) {
                            c.addEventListener('click', (e) => {
                                const btn = e.target.closest('[data-role]');
                                if (!btn) return;
                                const qid = btn.dataset.qid;
                                if (!qid) return;
                                if (btn.dataset.role === 'edit') {
                                    App.ui.openQuestionEditor(qid);
                                } else if (btn.dataset.role === 'chat') {
                                    App.ui.openDrawer(qid);
                                } else if (btn.dataset.role === 'forget') {
                                    App.data.clearMistakeHistory(qid);
                                    // 只是去掉一行，保留当前滚动位置，别把用户甩回顶部
                                    App.views.library.render(App.views.library.currentMode, { resetScroll: false });
                                }
                            });
                            this._listClickDelegated = true;
                        }

                        this._bindScrollUI(c);

                        // 列表内容换了一批时回到顶部（改筛选 / 搜索 / 切换模式都走这里）。
                        // 调用方可以用 render(mode, { resetScroll: false }) 保留当前位置。
                        if (resetScroll !== false) this._scrollToTop(c);
                    }
                
};