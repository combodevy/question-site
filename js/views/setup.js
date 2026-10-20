export const setup = {

                    render() {
                        // 恢复上次选的题型 / 题数 / 顺序（记住选择，不用每次重选）
                        App.ui.restoreSelectChoice('setup-type', 'all');
                        App.ui.restoreSelectChoice('setup-limit', (window.App && App.prefs && App.prefs.getDefaultLimit) ? App.prefs.getDefaultLimit() : '20');
                        App.ui.restoreSelectChoice('setup-order', 'shuffle');

                        const c = App.dom.get('setup-options');
                        if (!c) return;
                        c.innerHTML = '';
                        const subs = App.data.getSubjects();
                        if (subs.length === 0) {
                            c.innerHTML = '<div class="text-center text-[var(--sub)] mt-10">' + App.t('未检测到题库，请点击右上角头像，通过「导入题库」导入 JSON 文件。') + '</div>';
                            this._updateSelectedInfo();
                            return;
                        }

                        // 记忆用户上次勾选状态：{ checked: [...], seen: [...] }
                        // 修复旧版「把某个科目全部取消勾选后，因 subjectInMemory=false 下次又被强制全勾回来」的 Bug。
                        // 现在只要章节在 seen 中出现过，就严格按用户的勾选记忆（哪怕整科取消勾选也忠实记住）；
                        // 只有全新导入、从未见过的章节才默认勾选。
                        const mem = this._loadChapterSelection();
                        const checkedSet = mem ? new Set(mem.checked) : null;
                        const seenSet = mem ? new Set(mem.seen) : null;

                        // 顶部全局快捷选择栏：全选 / 清空 / 反选 + 按科目一键单选
                        const quickBar = document.createElement('div');
                        quickBar.className = 'mb-4 pb-3 border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-2 text-xs';
                        const leftQuick = document.createElement('div');
                        leftQuick.className = 'flex flex-wrap items-center gap-1.5';
                        leftQuick.innerHTML = `
                            <span class="text-[11px] font-bold text-[var(--sub)] mr-1">${App.t('快捷选择:')}</span>
                            <button type="button" data-setup-global="all" class="px-2.5 py-1 rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--text)] hover:border-primary-400 hover:text-primary-600 text-[11px] font-bold active:scale-95 transition-all">${App.t('全选全部')}</button>
                            <button type="button" data-setup-global="none" class="px-2.5 py-1 rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--sub)] hover:border-primary-400 hover:text-[var(--text)] text-[11px] font-bold active:scale-95 transition-all">${App.t('清空全选')}</button>
                            <button type="button" data-setup-global="invert" class="px-2.5 py-1 rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--sub)] hover:border-primary-400 hover:text-[var(--text)] text-[11px] font-bold active:scale-95 transition-all">${App.t('反选')}</button>
                        `;
                        quickBar.appendChild(leftQuick);

                        if (subs.length > 1) {
                            const subPills = document.createElement('div');
                            subPills.className = 'flex flex-wrap items-center gap-1.5';
                            const labelSpan = document.createElement('span');
                            labelSpan.className = 'text-[11px] text-[var(--sub)]';
                            labelSpan.textContent = App.t('只练单科:');
                            subPills.appendChild(labelSpan);
                            subs.forEach(s => {
                                const b = document.createElement('button');
                                b.type = 'button';
                                b.dataset.setupGlobal = 'only-sub';
                                b.dataset.sub = s;
                                b.className = 'px-2.5 py-1 rounded-lg border border-primary-200 dark:border-primary-800 bg-primary-50/70 dark:bg-primary-950/30 text-primary-700 dark:text-primary-300 hover:bg-primary-100 text-[11px] font-bold truncate max-w-[180px] active:scale-95 transition-all';
                                b.textContent = s;
                                subPills.appendChild(b);
                            });
                            quickBar.appendChild(subPills);
                        }
                        c.appendChild(quickBar);

                        const sortSvg = '<svg class="w-3.5 h-3.5 inline-block mr-0.5 -mt-0.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"></path></svg>';
                        const warnSvg = '<svg class="w-3.5 h-3.5 inline-block mr-0.5 -mt-0.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"></path></svg>';

                        subs.forEach(sub => {
                            const safeSub = App.utils.escapeHTML(sub);
                            const chaps = App.data.getChapters(sub);
                            const w = document.createElement('div');
                            w.className = "mb-5 last:mb-0";
                            w.dataset.subGroup = sub;

                            const header = document.createElement('div');
                            header.className = "flex items-center justify-between mb-2 px-1 gap-2";
                            header.innerHTML = `<div class="font-bold text-primary-600 text-sm truncate">${safeSub}</div>`;
                            const rightBtns = document.createElement('div');
                            rightBtns.className = "flex items-center gap-3 flex-shrink-0";
                            if (chaps.length > 1) {
                                const sortBtn = document.createElement('button');
                                sortBtn.type = 'button';
                                const outOrder = App.utils && typeof App.utils.isChapterListOutOfOrder === 'function' && App.utils.isChapterListOutOfOrder(chaps);
                                sortBtn.className = outOrder
                                    ? "inline-flex items-center text-[11px] font-bold text-amber-600 dark:text-amber-400 hover:underline"
                                    : "inline-flex items-center text-[11px] text-[var(--sub)] hover:text-primary-600 hover:underline";
                                sortBtn.innerHTML = (outOrder ? warnSvg : sortSvg) + App.utils.escapeHTML(outOrder ? App.t('一键排好章节顺序') : App.t('章节排序'));
                                sortBtn.addEventListener('click', () => {
                                    this._persistChapterSelection(c);
                                    App.data.sortChaptersNaturally(sub);
                                    this.render();
                                });
                                rightBtns.appendChild(sortBtn);
                            }
                            const mgrBtn = document.createElement('button');
                            mgrBtn.type = 'button';
                            mgrBtn.className = "text-[11px] text-[var(--sub)] hover:text-primary-600 hover:underline";
                            mgrBtn.textContent = App.t('管理章节');
                            mgrBtn.addEventListener('click', () => {
                                if (window.App && App.ui) {
                                    App.ui._bankMgrCurrentSubject = sub;
                                    App.ui.openBankManager();
                                }
                            });
                            rightBtns.appendChild(mgrBtn);
                            // 每个科目一个「全选本科目 / 取消本科目」开关
                            const allBtn = document.createElement('button');
                            allBtn.type = 'button';
                            allBtn.dataset.subToggleBtn = '1';
                            allBtn.className = "text-[11px] font-bold text-primary-600 hover:underline";
                            allBtn.textContent = App.t('全选');
                            rightBtns.appendChild(allBtn);
                            header.appendChild(rightBtns);
                            w.appendChild(header);

                            const g = document.createElement('div');
                            g.className = "grid grid-cols-1 md:grid-cols-2 gap-2";
                            chaps.forEach(chap => {
                                const key = `${sub}\u0001${chap}`;
                                const count = (App.data.bank[sub] && Array.isArray(App.data.bank[sub][chap])) ? App.data.bank[sub][chap].length : 0;
                                const isChecked = seenSet ? (seenSet.has(key) ? checkedSet.has(key) : true) : true;

                                const row = document.createElement('div');
                                row.className = 'setup-chap-card flex items-center justify-between gap-2 p-2.5 border rounded-xl transition-all touch-manipulation '
                                    + (isChecked
                                        ? 'border-primary-500/60 bg-primary-50/30 dark:bg-primary-950/20'
                                        : 'border-[var(--border)] bg-[var(--card)] opacity-80');

                                const l = document.createElement('label');
                                l.className = "flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer select-none";
                                const chk = document.createElement('input');
                                chk.type = 'checkbox';
                                chk.className = "setup-chk accent-primary-600 w-4 h-4 flex-shrink-0";
                                chk.value = key;
                                chk.checked = isChecked;

                                const span = document.createElement('span');
                                span.className = "text-xs font-medium truncate text-[var(--text)]";
                                span.textContent = chap;
                                span.title = chap;

                                const countBadge = document.createElement('span');
                                countBadge.className = "text-[10px] font-mono text-[var(--sub)] bg-[var(--bg)] px-1.5 py-0.5 rounded flex-shrink-0";
                                countBadge.textContent = `${count} ${App.t('题')}`;

                                l.appendChild(chk);
                                l.appendChild(span);
                                l.appendChild(countBadge);

                                const actions = document.createElement('div');
                                actions.className = 'flex items-center gap-1 flex-shrink-0';

                                const onlyBtn = document.createElement('button');
                                onlyBtn.type = 'button';
                                onlyBtn.dataset.setupAct = 'only-chap';
                                onlyBtn.dataset.key = key;
                                onlyBtn.title = App.t('取消其他所有章节，只勾选此章节');
                                onlyBtn.className = 'px-1.5 py-0.5 rounded border border-[var(--border)] bg-[var(--bg)] text-[10px] font-bold text-[var(--sub)] hover:text-primary-600 hover:border-primary-400 active:scale-95 transition-all whitespace-nowrap';
                                onlyBtn.textContent = App.t('仅此章');

                                const runBtn = document.createElement('button');
                                runBtn.type = 'button';
                                runBtn.dataset.setupAct = 'run-chap';
                                runBtn.dataset.key = key;
                                runBtn.title = App.t('直接开始刷这一章的题目');
                                runBtn.className = 'px-2 py-0.5 rounded bg-primary-600/15 text-primary-600 dark:text-primary-400 hover:bg-primary-600 hover:text-white text-[10px] font-bold active:scale-95 transition-all whitespace-nowrap';
                                runBtn.textContent = App.t('直练');

                                actions.appendChild(onlyBtn);
                                actions.appendChild(runBtn);

                                row.appendChild(l);
                                row.appendChild(actions);
                                g.appendChild(row);
                            });
                            w.appendChild(g);
                            c.appendChild(w);

                            const toggleSubAll = () => {
                                const boxes = Array.from(g.querySelectorAll('.setup-chk'));
                                const anyUnchecked = boxes.some(b => !b.checked);
                                boxes.forEach(b => { b.checked = anyUnchecked; });
                                this._syncCardStyles(c);
                                this._persistChapterSelection(c);
                                this._updateSelectedInfo();
                            };
                            allBtn.addEventListener('click', toggleSubAll);
                        });

                        // 绑定容器级事件委托（仅绑一次）
                        if (!this._chapterPersistBound) {
                            this._chapterPersistBound = true;
                            c.addEventListener('change', (e) => {
                                if (!e.target.classList || !e.target.classList.contains('setup-chk')) return;
                                this._syncCardStyles(c);
                                this._persistChapterSelection(c);
                                this._updateSelectedInfo();
                            });
                            c.addEventListener('click', (e) => {
                                const gBtn = e.target.closest('button[data-setup-global]');
                                if (gBtn) {
                                    const mode = gBtn.dataset.setupGlobal;
                                    const allBoxes = Array.from(c.querySelectorAll('.setup-chk'));
                                    if (mode === 'all') {
                                        allBoxes.forEach(b => { b.checked = true; });
                                    } else if (mode === 'none') {
                                        allBoxes.forEach(b => { b.checked = false; });
                                    } else if (mode === 'invert') {
                                        allBoxes.forEach(b => { b.checked = !b.checked; });
                                    } else if (mode === 'only-sub') {
                                        const targetPrefix = (gBtn.dataset.sub || '') + '\u0001';
                                        allBoxes.forEach(b => { b.checked = b.value.startsWith(targetPrefix); });
                                    }
                                    this._syncCardStyles(c);
                                    this._persistChapterSelection(c);
                                    this._updateSelectedInfo();
                                    return;
                                }
                                const actBtn = e.target.closest('button[data-setup-act]');
                                if (actBtn) {
                                    const act = actBtn.dataset.setupAct;
                                    const key = actBtn.dataset.key;
                                    if (!key) return;
                                    if (act === 'only-chap') {
                                        c.querySelectorAll('.setup-chk').forEach(b => { b.checked = (b.value === key); });
                                        this._syncCardStyles(c);
                                        this._persistChapterSelection(c);
                                        this._updateSelectedInfo();
                                    } else if (act === 'run-chap') {
                                        c.querySelectorAll('.setup-chk').forEach(b => { b.checked = (b.value === key); });
                                        this._syncCardStyles(c);
                                        this._persistChapterSelection(c);
                                        this._updateSelectedInfo();
                                        const order = App.dom.getValue('setup-order', 'shuffle');
                                        App.quiz.init('custom', { customChapters: [key], order });
                                    }
                                }
                            });
                        }

                        this._syncCardStyles(c);
                        this._persistChapterSelection(c);
                        this._updateSelectedInfo();
                    },

                    _syncCardStyles(container) {
                        if (!container || !container.querySelectorAll) return;
                        container.querySelectorAll('.setup-chap-card').forEach(card => {
                            const chk = card.querySelector('.setup-chk');
                            if (!chk) return;
                            card.classList.toggle('border-primary-500/60', chk.checked);
                            card.classList.toggle('bg-primary-50/30', chk.checked);
                            card.classList.toggle('dark:bg-primary-950/20', chk.checked);
                            card.classList.toggle('border-[var(--border)]', !chk.checked);
                            card.classList.toggle('bg-[var(--card)]', !chk.checked);
                            card.classList.toggle('opacity-80', !chk.checked);
                        });
                        container.querySelectorAll('[data-sub-group]').forEach(group => {
                            const btn = group.querySelector('[data-sub-toggle-btn]');
                            const boxes = Array.from(group.querySelectorAll('.setup-chk'));
                            if (btn && boxes.length) {
                                btn.textContent = App.t(boxes.every(b => b.checked) ? '取消全选' : '全选');
                            }
                        });
                    },

                    // 章节选择持久化：同时保存 checked（已勾选项）和 seen（已知全量章节），
                    // 这样用户把某个科目全部取消勾选后，下次打开仍保持未勾选状态，绝不会丢失记忆。
                    _loadChapterSelection() {
                        try {
                            const v2 = JSON.parse(localStorage.getItem('qs_setup_state_v2') || 'null');
                            if (v2 && Array.isArray(v2.checked) && Array.isArray(v2.seen) && v2.seen.length > 0) {
                                // 若当前题库的所有章节都不在 seen 里（例如清空换了新题库），视为全新题库
                                const currentKeys = [];
                                for (const sub of App.data.getSubjects()) {
                                    for (const chap of App.data.getChapters(sub)) {
                                        currentKeys.push(`${sub}\u0001${chap}`);
                                    }
                                }
                                const seenSet = new Set(v2.seen);
                                if (currentKeys.some(k => seenSet.has(k))) {
                                    return v2;
                                }
                            }
                            const legacy = JSON.parse(localStorage.getItem('qs_setup_chapters') || 'null');
                            if (Array.isArray(legacy) && legacy.length > 0) {
                                return { checked: legacy, seen: legacy };
                            }
                            return null;
                        } catch (e) {
                            return null;
                        }
                    },

                    _persistChapterSelection(container) {
                        if (!container || !container.querySelectorAll) return;
                        const all = Array.from(container.querySelectorAll('.setup-chk')).map(x => x.value);
                        const checked = Array.from(container.querySelectorAll('.setup-chk:checked')).map(x => x.value);
                        try {
                            localStorage.setItem('qs_setup_state_v2', JSON.stringify({ checked, seen: all }));
                            localStorage.setItem('qs_setup_chapters', JSON.stringify(checked));
                        } catch (e) { }
                    },

                    _updateSelectedInfo() {
                        const info = App.dom.get('setup-selected-info');
                        if (!info) return;
                        const checkedEls = Array.from(document.querySelectorAll('#setup-options .setup-chk:checked'));
                        const checked = checkedEls.length;
                        const total = document.querySelectorAll('#setup-options .setup-chk').length;
                        let qCount = 0;
                        checkedEls.forEach(chk => {
                            const [sub, chap] = String(chk.value || '').split('\u0001');
                            const arr = App.data.bank && App.data.bank[sub] && App.data.bank[sub][chap];
                            if (Array.isArray(arr)) qCount += arr.length;
                        });
                        const isEn = window.App && App.i18n && App.i18n.lang === 'en';
                        info.textContent = total
                            ? (isEn ? `${checked} / ${total} ch (${qCount} q)` : `已选 ${checked} / ${total} 章（共 ${qCount} 题）`)
                            : '';
                    }
                
};