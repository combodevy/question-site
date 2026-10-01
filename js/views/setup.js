export const setup = {

                    render() {
                        // 恢复上次选的题型 / 题数（记住选择，不用每次重选）
                        App.ui.restoreSelectChoice('setup-type', 'all');
                        App.ui.restoreSelectChoice('setup-limit', '20');

                        const c = App.dom.get('setup-options');
                        if (!c) return;
                        c.innerHTML = '';
                        const subs = App.data.getSubjects();
                        if (subs.length === 0) {
                            c.innerHTML = '<div class="text-center text-[var(--sub)] mt-10">未检测到题库，请点击右上角头像，通过「导入题库」导入 JSON 文件。</div>';
                            this._updateSelectedInfo();
                            return;
                        }

                        // 记忆用户上次勾选的章节（跨会话持久化，按「科目|章节」匹配）。
                        // 语义：记忆中出现的章节按记忆勾选；记忆中没出现的章节（含新导入科目）默认勾选；
                        // 脏记忆（全部失效，如题库被清后重导）不影响——所有章节视为新出现而全选。
                        const savedSelection = this._loadChapterSelection();
                        const savedSet = savedSelection && savedSelection.length ? new Set(savedSelection) : null;

                        subs.forEach(sub => {
                            const safeSub = App.utils.escapeHTML(sub);
                            const w = document.createElement('div'); w.className = "mb-4";
                            const header = document.createElement('div');
                            header.className = "flex items-center justify-between mb-2 px-1";
                            header.innerHTML = `<div class="font-bold text-primary-600 text-sm">${safeSub}</div>`;
                            // 每个科目一个「全选 / 取消全选」开关，符合批量勾选的习惯
                            const allBtn = document.createElement('button');
                            allBtn.type = 'button';
                            allBtn.className = "text-[11px] font-bold text-primary-600 hover:underline";
                            allBtn.textContent = '全选';
                            header.appendChild(allBtn);
                            w.appendChild(header);

                            const g = document.createElement('div'); g.className = "grid grid-cols-2 gap-2";
                            // 分隔符用控制字符 \u0001：章节名本身可以包含「|」，
                            // 用竖线拼接会让不同「科目×章节」组合拼出同一个键（3.11）
                            const subPrefix = sub + '\u0001';
                            const subjectInMemory = savedSet && Array.from(savedSet).some((v) => v.startsWith(subPrefix));
                            App.data.getChapters(sub).forEach(chap => {
                                const safeChap = App.utils.escapeHTML(chap);
                                const l = document.createElement('label');
                                l.className = "flex items-center gap-2 p-3 border border-[var(--border)] rounded-xl cursor-pointer active:border-primary-500 transition-colors bg-[var(--card)] touch-manipulation";
                                // 用 DOM 属性赋值而不是字符串拼接，避免科目/章节名中的特殊字符破坏 HTML 结构
                                const chk = document.createElement('input');
                                chk.type = 'checkbox';
                                chk.className = "setup-chk accent-primary-600 w-4 h-4";
                                chk.value = `${sub}\u0001${chap}`;
                                // 该科目在记忆中出现过 → 按记忆勾选；否则（新科目）默认全选
                                chk.checked = subjectInMemory ? savedSet.has(chk.value) : true;
                                const span = document.createElement('span');
                                span.className = "text-xs font-medium truncate";
                                span.textContent = chap;
                                l.appendChild(chk);
                                l.appendChild(span);
                                g.appendChild(l);
                            });
                            w.appendChild(g); c.appendChild(w);

                            // 全选按钮行为：组内有未勾选 → 全勾；已全勾 → 全不勾
                            const toggleAll = () => {
                                const boxes = Array.from(g.querySelectorAll('.setup-chk'));
                                const anyUnchecked = boxes.some(b => !b.checked);
                                boxes.forEach(b => { b.checked = anyUnchecked; });
                                allBtn.textContent = anyUnchecked ? '全选' : '取消全选';
                                this._persistChapterSelection(c);
                                this._updateSelectedInfo();
                            };
                            allBtn.addEventListener('click', toggleAll);
                            // 初始按钮文案与当前状态一致
                            const boxes = Array.from(g.querySelectorAll('.setup-chk'));
                            if (boxes.length && boxes.every(b => b.checked)) allBtn.textContent = '取消全选';
                        });

                        // 勾选变化时持久化 + 更新底部计数（容器本身不重建，绑一次即可）
                        if (!this._chapterPersistBound) {
                            this._chapterPersistBound = true;
                            c.addEventListener('change', (e) => {
                                if (!e.target.classList || !e.target.classList.contains('setup-chk')) return;
                                this._persistChapterSelection(c);
                                this._updateSelectedInfo();
                            });
                        }
                        this._updateSelectedInfo();
                    },

                    // 章节选择持久化（数组元素为「科目\u0001章节」，控制字符不会与章节名冲突；
                    // 旧版竖线键在题库结构变化后自然失效，所有章节按新出现默认全选，无副作用）
                    _loadChapterSelection() {
                        try {
                            const v = JSON.parse(localStorage.getItem('qs_setup_chapters') || 'null');
                            return Array.isArray(v) ? v : null;
                        } catch (e) {
                            return null;
                        }
                    },

                    _persistChapterSelection(container) {
                        const sel = Array.from(container.querySelectorAll('.setup-chk:checked')).map(x => x.value);
                        try { localStorage.setItem('qs_setup_chapters', JSON.stringify(sel)); } catch (e) { }
                    },

                    _updateSelectedInfo() {
                        const info = App.dom.get('setup-selected-info');
                        if (!info) return;
                        const checked = document.querySelectorAll('#setup-options .setup-chk:checked').length;
                        const total = document.querySelectorAll('#setup-options .setup-chk').length;
                        info.textContent = total ? `已选 ${checked} / ${total} 章` : '';
                    }
                
};