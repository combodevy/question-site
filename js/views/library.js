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

                    handleTypeChange() { this.render(); },
                    handleFilterChange() { this.render(); },

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
                        const listEl = App.dom.get('lib-list');
                        if (listEl) listEl.scrollTo({ top: 0, behavior: 'smooth' });
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
                            btn.classList.toggle('bg-primary-600', this._expandAll);
                            btn.classList.toggle('text-white', this._expandAll);
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
                            btn.classList.toggle('bg-primary-600', this._manageMode);
                            btn.classList.toggle('text-white', this._manageMode);
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

                    render(mode) {
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

                        if (filter) filter.classList.toggle('hidden', mode === 'mistakes');

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

                        if (mode === 'mistakes') {
                            const hidden = new Set(Array.isArray(App.data.hiddenMistakeIds) ? App.data.hiddenMistakeIds : []);
                            const errSet = new Set(App.data.history.filter(h => !h.r && !hidden.has(h.id)).map(h => h.id));
                            qs = qs.filter(q => errSet.has(q.id));
                        } else {
                            if (filter && filter.value !== 'all') qs = qs.filter(q => q.sub === filter.value);
                            if (typeFilter && typeFilter.value !== 'all') {
                                const t = typeFilter.value;
                                qs = qs.filter(q => q.type === t);
                            }
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
                        c.innerHTML = '';

                        if (qs.length === 0) {
                            if (this._searchQuery) {
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

                        const frag = document.createDocumentFragment();
                        qs.forEach((q, index) => {
                            const d = document.createElement('div');
                            d.className = "p-4 border-b border-[var(--border)] hover:bg-[var(--bg-hover)] transition-colors";
                            d.dataset.qid = q.id;

                            let mistakeBadge = '';
                            let delBtn = '';
                            if (mode === 'mistakes') {
                                const errCount = App.data.getMistakeCount(q.id);
                                mistakeBadge = `<span class="text-[10px] font-bold text-white bg-red-500 px-1.5 py-0.5 rounded-full ml-2">${errCount}</span>`;
                                delBtn = `<button class="ml-auto text-xs text-[var(--sub)] hover:text-red-500 p-2 border border-[var(--border)] rounded" onclick="event.stopPropagation(); App.data.clearMistakeHistory('${q.id}'); App.views.library.render()">✕ 移除</button>`;
                            }

                            let ansPreview = '';
                            let detailsHtml = '';

                            if (q.type === 'tf') {
                                const isTrue = q.a === 'T';
                                ansPreview = isTrue
                                    ? '<span class="status-true">√ (正确/True)</span>'
                                    : '<span class="status-false">× (错误/False)</span>';
                                detailsHtml = `<div class="mt-2 text-xs text-[var(--sub)] hidden details-panel">此题为判断题。</div>`;
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

                                ansPreview = `<span class="font-bold text-primary-600">✅ 答案：${inlineAns}</span>`;
                                detailsHtml = `<div class="mt-2 hidden details-panel bg-slate-50 dark:bg-slate-800 p-2 rounded-lg border border-[var(--border)]">` +
                                    App.utils.getDetailedOptionHTML(q, q.a, this._searchQuery) +
                                    `</div>`;
                            }

                            const typeLabel = q.type === 'mcq' ? '单选' : (q.type === 'multi' ? '多选' : '判断');
                            const highlightedQ = App.utils.highlight(q.q, this._searchQuery);

                            const safeSub = App.utils.escapeHTML(q.sub || '');
                            d.innerHTML = `
                                <div class="flex justify-between mb-1 items-center">
                                    <label class="flex items-center gap-2 cursor-pointer select-none">
                                        <input type="checkbox" class="lib-select-chk w-4 h-4 mr-1 hidden" data-id="${App.utils.escapeHTML(String(q.id || ''))}" onchange="App.views.library.handleSelectChange(this)">
                                        <span class="text-[10px] font-bold text-[var(--sub)] mr-1">#${index + 1}</span>
                                        <span class="text-[10px] font-bold text-primary-600 bg-primary-50 px-1 rounded border border-primary-100">${safeSub}</span>
                                        <span class="text-[10px] text-[var(--sub)] border border-[var(--border)] px-1 rounded">${typeLabel}</span>
                                        ${mistakeBadge}
                                    </label>
                                    <div class="flex items-center gap-1">
                                        ${delBtn}
                                        <button class="text-[10px] text-[var(--sub)] hover:text-primary-600 p-1 rounded prevent-drawer" onclick="event.stopPropagation(); App.ui.openQuestionEditor('${App.utils.escapeHTML(String(q.id || ''))}')">✎</button>
                                        <button class="text-[var(--sub)] hover:text-primary-600 p-1 rounded prevent-drawer" onclick="event.stopPropagation(); App.ui.openDrawer('${App.utils.escapeHTML(String(q.id || ''))}')">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-4.553a1 1 0 00-1.414-1.414L13.586 8.586A2 2 0 0112.172 9H7a2 2 0 00-2 2v6h6v-1a2 2 0 01.586-1.414l4.553-4.553z"/>
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 18h14"/>
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                                <div class="font-medium text-sm text-[var(--text)] leading-snug cursor-pointer hover:text-primary-600 transition-colors lib-toggle" onclick="App.views.library.toggleDetails(this)">${highlightedQ}</div>
                                <div class="mt-2 text-xs font-bold text-[var(--sub)] flex flex-col gap-1 cursor-pointer lib-toggle" onclick="App.views.library.toggleDetails(this)">
                                    <span>${ansPreview}</span>
                                </div>
                                ${detailsHtml}`;
                            frag.appendChild(d);
                        });
                        c.appendChild(frag);

                        if (!this._scrollListenerAttached) {
                            const listEl = App.dom.get('lib-list');
                            const btn = App.dom.get('lib-back-top');
                            if (listEl && btn) {
                                listEl.addEventListener('scroll', () => {
                                    btn.classList.toggle('opacity-0', listEl.scrollTop < 200);
                                    btn.classList.toggle('pointer-events-none', listEl.scrollTop < 200);
                                });
                                this._scrollListenerAttached = true;
                            }
                        }
                    }
                
};