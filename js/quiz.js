export const quiz = {
                queue: [], idx: 0, stats: { c: 0, w: 0 }, currentMultiSelection: new Set(), lastConfig: null,
                sessionWrongIds: [],
                sessionAnswers: {},
                sessionDrafts: {},
                _answeredCurrent: false,
                _questionStartTime: null,
                _pendingNextTimer: null,
                _slideDir: 0,
                _navSheetOpen: false,

                init(mode, config = {}) {
                    if (this._pendingNextTimer) {
                        clearTimeout(this._pendingNextTimer);
                        this._pendingNextTimer = null;
                    }
                    let pool = App.data.getQuestions();
                    if (!pool.length) {
                        alert(App.t("当前题库为空，请先在设置中导入题库文件。"));
                        return false;
                    }

                    let typeConstraint = 'all';
                    let limit = 20;

                    if (mode === 'random') {
                        if (!config.type) typeConstraint = App.dom.getValue('smart-type', 'all');
                        else typeConstraint = config.type;

                        if (!config.limit) {
                            const l = App.dom.getValue('smart-limit', 'all');
                            const n = parseInt(l, 10);
                            limit = (l === 'all' || !Number.isFinite(n) || n <= 0) ? pool.length : n;
                        } else {
                            limit = config.limit === 'all' ? pool.length : config.limit;
                        }

                        if (Array.isArray(config.chapters) && config.chapters.length > 0) {
                            const chapSet = new Set(config.chapters);
                            pool = pool.filter(q => chapSet.has(`${q.sub}\u0001${q.chap}`));
                        } else if (Array.isArray(config.subjects) && config.subjects.length > 0) {
                            pool = pool.filter(q => config.subjects.includes(q.sub));
                        } else {
                            const allChapBoxes = document.querySelectorAll('.smart-chap-chk');
                            const checkedChapBoxes = document.querySelectorAll('.smart-chap-chk:checked');
                            if (allChapBoxes.length > 0) {
                                if (checkedChapBoxes.length === 0) {
                                    alert(App.t("请至少勾选一个章节再开始练习。"));
                                    return false;
                                }
                                const selectedChaps = new Set(Array.from(checkedChapBoxes).map(c => c.value));
                                pool = pool.filter(q => selectedChaps.has(`${q.sub}\u0001${q.chap}`));
                            } else {
                                const subChks = document.querySelectorAll('.smart-subject-chk:checked');
                                if (subChks.length > 0) {
                                    const selectedSubs = Array.from(subChks).map(c => c.value);
                                    pool = pool.filter(q => selectedSubs.includes(q.sub));
                                }
                            }
                        }
                    } else if (mode === 'custom') {
                        if (!config.type) typeConstraint = App.dom.getValue('setup-type', 'all');
                        else typeConstraint = config.type;
                    }

                    // 题型过滤：'all' 不过滤；其余按类型精确匹配（含 fill）
                    if (typeConstraint !== 'all') pool = pool.filter(q => q.type === typeConstraint);

                    if (pool.length === 0) {
                        alert(App.t("此筛选条件下没有符合的题目。"));
                        return false;
                    }

                    if (mode === 'filtered') {
                        const customList = Array.isArray(config.questions) ? config.questions : [];
                        if (!customList.length) {
                            alert(App.t("没有找到符合条件的题目！(No questions match your criteria)"));
                            return false;
                        }
                        this.queue = App.utils.shuffle([...customList]);
                    } else if (mode === 'session_wrong') {
                        const wrongSet = new Set(Array.isArray(config.ids) ? config.ids : this.sessionWrongIds);
                        pool = pool.filter(q => wrongSet.has(q.id));
                        if (!pool.length) {
                            alert(App.t("太棒了！您的题库中暂无错题。"));
                            return false;
                        }
                        this.queue = App.utils.shuffle(pool);
                    } else if (mode === 'mistakes') {
                        const errIds = new Set(App.data.getSafeHistory().filter(h => !h.r).map(h => h.id));
                        pool = pool.filter(q => errIds.has(q.id));
                        // 排除已被用户从错题本「移除」的题，否则移除后练错题还会抽到它
                        pool = pool.filter(q => !App.data.isMistakeHidden(q.id));
                        if (!pool.length) { alert(App.t("太棒了！您的题库中暂无错题。")); return false; }
                        this.queue = App.utils.shuffle(pool);
                    } else if (mode === 'starred') {
                        pool = pool.filter(q => App.data.isStarred(q.id));
                        if (!pool.length) {
                            alert(App.t("还没有收藏的题目。"));
                            return false;
                        }
                        this.queue = App.utils.shuffle(pool);
                    } else if (mode === 'review') {
                        // 间隔复习：只取今日到期（SM-2 计划）的题，按到期时间排序
                        const due = App.data.getReviewQueue();
                        if (!due.length) {
                            alert(App.t("今日没有到期的复习题目。"));
                            return false;
                        }
                        this.queue = due;
                    } else if (mode === 'random') {
                        this.queue = App.utils.shuffle(pool).slice(0, limit);
                    } else if (mode === 'custom') {
                        // restart 重放时 setup 页 DOM 可能已变化：优先用快照的章节集合
                        const snapChapters = (config && Array.isArray(config.customChapters)) ? config.customChapters : null;
                        let targets = null;
                        if (snapChapters) {
                            targets = snapChapters;
                        } else {
                        const chks = document.querySelectorAll('.setup-chk:checked');
                        // 零勾选 = 用户没选任何章节：提示而不是整库开练（旧逻辑把「全不选」当成「不过滤」）
                        if (chks.length === 0) { alert(App.t("请至少勾选一个章节再开始练习。")); return false; }
                            targets = Array.from(chks).map(c => c.value);
                        }
                        pool = pool.filter(q => targets.includes(`${q.sub}\u0001${q.chap}`));
                        if (!pool.length) { alert(App.t("选中的章节下没有符合的题目。")); return false; }

                        // 英语真题等外部入口或自定义顺序下拉框可指定 order:'natural' 保持题号顺序（不洗牌）
                        const orderPref = (config && config.order) ? config.order : App.dom.getValue('setup-order', 'shuffle');
                        if (orderPref !== 'natural') pool = App.utils.shuffle(pool);
                        // 英语专题等外部入口可通过 config.limit 指定题量（如 'all' 整卷）
                        const l = (config && config.limit) ? String(config.limit) : App.dom.getValue('setup-limit', '20');
                        const n = parseInt(l, 10);
                        this.queue = (l === 'all' || !Number.isFinite(n) || n <= 0) ? pool : pool.slice(0, n);
                    }

                    // 快照实际生效的配置（校验通过后），restart「再练一组」据此重放；
                    // custom 模式记录勾选的章节集合——不再读 setup 页遗留 DOM
                    if (mode !== 'session_wrong') {
                        this.lastConfig = {
                            mode,
                            options: { ...config },
                            customChapters: mode === 'custom' ? ((config && Array.isArray(config.customChapters)) ? config.customChapters : [...document.querySelectorAll('.setup-chk:checked')].map(c2 => c2.value)) : null
                        };
                    }

                    this.idx = 0; this.stats = { c: 0, w: 0 };
                    this.sessionWrongIds = [];
                    this.sessionAnswers = {};
                    this.sessionDrafts = {};
                    this._answeredCurrent = false;
                    this._slideDir = 0;
                    this._navSheetOpen = false;
                    const navSheet = document.getElementById('quiz-nav-sheet');
                    if (navSheet) navSheet.classList.add('hidden');
                    // 走到这里说明所有校验都通过了，才暂停云端同步（答题期间攒着，做完一次性上传）。
                    // 注意：不能放在函数开头——上面有多条提前 return 的失败路径
                    //（题库为空 / 筛选无结果 / 无错题 / 章节无题），一旦泄漏这个标志位，
                    // 本次会话内所有题库与记录的改动都不再上传云端，而界面仍显示「已同步」。
                    App.data._suppressCloudSync = true;
                    this._active = true;   // router 据此拦截练习中途的离开
                    this._ensureKeyboard();
                    App.router.go('quiz');
                    this.render();
                    return true;
                },

                restart() {
                    if (this.lastConfig) this.init(this.lastConfig.mode, Object.assign({}, this.lastConfig.options, { customChapters: this.lastConfig.customChapters }));
                    else this.init('random');
                },

                retryWrong() {
                    if (!this.sessionWrongIds || !this.sessionWrongIds.length) return;
                    this.init('session_wrong', { ids: [...this.sessionWrongIds] });
                },

                _recalcStats() {
                    let c = 0;
                    let w = 0;
                    const wrongSet = new Set();
                    for (const [k, ans] of Object.entries(this.sessionAnswers || {})) {
                        if (!ans || !ans.answered || ans.selfCheck) continue;
                        const q = this.queue[Number(k)];
                        if (ans.ok) {
                            c++;
                        } else {
                            w++;
                            if (q && q.id) wrongSet.add(q.id);
                        }
                    }
                    this.stats = { c, w };
                    this.sessionWrongIds = Array.from(wrongSet);
                },

                _getAnsweredCount() {
                    return Object.values(this.sessionAnswers || {}).filter(a => a && a.answered).length;
                },

                _getUnansweredCount() {
                    return Math.max(0, this.queue.length - this._getAnsweredCount());
                },

                _saveCurrentDraft() {
                    if (this.sessionAnswers && this.sessionAnswers[this.idx]) return;
                    const q = this.queue && this.queue[this.idx];
                    if (!q) return;
                    if (q.type === 'multi') {
                        this.sessionDrafts[this.idx] = new Set(this.currentMultiSelection || []);
                    } else if (q.type === 'fill') {
                        const fi = document.getElementById('fill-input');
                        if (fi) this.sessionDrafts[this.idx] = fi.value;
                    }
                },

                render() {
                    if (this._pendingNextTimer) {
                        clearTimeout(this._pendingNextTimer);
                        this._pendingNextTimer = null;
                    }
                    const q = this.queue[this.idx];
                    if (!q) return;
                    const saved = this.sessionAnswers ? this.sessionAnswers[this.idx] : null;
                    this._answeredCurrent = Boolean(saved && saved.answered);
                    const qb = document.getElementById('quiz-body');
                    if (qb) qb.scrollTop = 0;
                    const mainEl = document.querySelector && document.querySelector('main');
                    if (mainEl) mainEl.scrollTop = 0;

                    // 切题方向过渡动画（上一题向左轻滑入，下一题向右轻滑入）
                    const ansCol = document.getElementById('q-answer-col');
                    if (ansCol && this._slideDir !== 0) {
                        ansCol.classList.remove('anim-q-next', 'anim-q-prev');
                        void ansCol.offsetWidth;
                        ansCol.classList.add(this._slideDir > 0 ? 'anim-q-next' : 'anim-q-prev');
                    }
                    this._slideDir = 0;

                    App.dom.setText('q-type', App.t(q.type === 'mcq' ? '单选' : (q.type === 'multi' ? '多选' : (q.type === 'fill' ? '填空' : '判断'))));
                    App.dom.setText('q-sub', q.sub);
                    // 题干支持 [图N]/[表N] 占位符（media 白名单渲染），普通题干不受影响
                    const qTextEl = App.dom.get('q-text');
                    if (qTextEl) {
                        if (Array.isArray(q.media) && q.media.length) {
                            qTextEl.innerHTML = App.utils.renderMedia(q.q, q.media, { imgClass: 'max-w-full rounded-lg my-2 mx-auto' });
                        } else {
                            qTextEl.textContent = q.q;
                        }
                    }
                    App.dom.setText('quiz-progress', `${this.idx + 1} / ${this.queue.length}`);

                    // 阅读题双栏/抽屉：文章独立展示（psg 字段由英语专题展开写入）
                    this._renderPassage(q);

                    // 收藏按钮同步当前题状态
                    this._updateStarBtn(q);

                    this._questionStartTime = Date.now();

                    const c = App.dom.get('q-options');
                    if (c) { c.innerHTML = ''; c.style.pointerEvents = 'auto'; }
                    App.dom.hide('quiz-feedback');

                    const draftMulti = (!saved && this.sessionDrafts && this.sessionDrafts[this.idx] instanceof Set)
                        ? new Set(this.sessionDrafts[this.idx])
                        : new Set();
                    this.currentMultiSelection = saved && q.type === 'multi'
                        ? new Set(String(saved.userAns || '').split('').filter(Boolean))
                        : draftMulti;

                    // 填空题：显示输入框 + 提交按钮（隐藏多选/判断交互）
                    const fillActions = document.getElementById('fill-actions');
                    const fillInput = document.getElementById('fill-input');
                    if (fillActions && fillInput) {
                        if (q.type === 'fill') {
                            fillActions.classList.remove('hidden');
                            const draftFill = (!saved && this.sessionDrafts && typeof this.sessionDrafts[this.idx] === 'string')
                                ? this.sessionDrafts[this.idx]
                                : '';
                            fillInput.value = saved ? String(saved.userAns || '') : draftFill;
                            fillInput.disabled = Boolean(saved && saved.answered);
                            if (!saved) {
                                setTimeout(() => { try { fillInput.focus(); } catch (e) { } }, 80);
                            }
                        } else {
                            fillActions.classList.add('hidden');
                        }
                    }

                    if (q.type === 'multi') {
                        App.dom.show('multi-actions');
                        App.dom.show('multi-hint');

                        (q.o || []).forEach((opt, i) => {
                            const char = String.fromCharCode(65 + i);
                            const safeOpt = App.utils.escapeHTML(opt);
                            const b = document.createElement('div');
                            b.className = "opt-btn card p-4 cursor-pointer hover:border-primary-500 transition-all flex gap-3 items-center group mb-3 rounded-xl touch-manipulation"
                                + (this.currentMultiSelection.has(char) ? ' selected' : '');
                            b.dataset.val = char;
                            b.innerHTML = `<span class="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-[var(--sub)] font-bold flex items-center justify-center transition-colors border border-transparent">${char}</span><span class="text-sm font-medium">${safeOpt}</span>`;
                            b.onclick = () => this.toggle(char, b);
                            if (c) c.appendChild(b);
                        });
                    } else {
                        App.dom.hide('multi-actions');
                        App.dom.hide('multi-hint');

                        if (q.type === 'fill') {
                            // 填空题：选项区留空，答案输入框在下方 fill-actions 中
                        } else if (q.type === 'mcq') {
                            (q.o || []).forEach((opt, i) => {
                                const char = String.fromCharCode(65 + i);
                                const safeOpt = App.utils.escapeHTML(opt);
                                const b = document.createElement('div');
                                b.className = "opt-btn card p-4 cursor-pointer hover:border-primary-500 transition-all flex gap-3 items-center group mb-3 rounded-xl touch-manipulation";
                                b.dataset.val = char;
                                b.innerHTML = `<span class="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-[var(--sub)] font-bold flex items-center justify-center group-hover:text-primary-600 group-hover:bg-primary-50 transition-colors">${char}</span><span class="text-sm font-medium">${safeOpt}</span>`;
                                b.onclick = () => this.sub(char, b);
                                if (c) c.appendChild(b);
                            });
                        } else {
                            ['T', 'F'].forEach(v => {
                                const b = document.createElement('div');
                                b.className = "opt-btn card p-4 cursor-pointer hover:border-primary-500 transition-all text-center font-bold mb-3 rounded-xl text-lg touch-manipulation";
                                b.dataset.val = v;
                                b.innerText = v === 'T' ? App.t('正确 (True)') : App.t('错误 (False)');
                                b.onclick = () => this.sub(v, b);
                                if (c) c.appendChild(b);
                            });
                        }
                    }

                    if (saved && saved.answered) {
                        this._applyAnsweredView(q, saved, false);
                    }
                    this._updateNavUI();
                },

                _setFbIcon(ok) {
                    const el = App.dom.get('fb-icon');
                    if (!el) return;
                    el.innerHTML = ok
                        ? '<svg class="w-6 h-6 text-emerald-500" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>'
                        : '<svg class="w-6 h-6 text-red-500" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
                },

                // 将已作答状态（选项着色、输入框锁定、解析反馈栏）应用到当前题目 DOM
                _applyAnsweredView(q, saved, animate = false) {
                    if (!q || !saved) return;
                    const c = App.dom.get('q-options');
                    if (c) c.style.pointerEvents = 'none';
                    App.dom.hide('multi-actions');
                    const fillInput = document.getElementById('fill-input');
                    if (fillInput && q.type === 'fill') {
                        fillInput.value = String(saved.userAns || '');
                        fillInput.disabled = true;
                    }

                    if (saved.selfCheck || q.selfCheck) {
                        if (c && q.type === 'multi') {
                            const pickedSet = new Set(String(saved.userAns || '').split(''));
                            Array.from(c.children).forEach(child => {
                                if (pickedSet.has(child.dataset.val)) child.classList.add('self-pick');
                            });
                        } else if (c && (q.type === 'mcq' || q.type === 'tf')) {
                            Array.from(c.children).forEach(child => {
                                if (child.dataset.val === saved.userAns) child.classList.add('self-pick');
                            });
                        }
                        App.dom.show('quiz-feedback');
                        if (animate) this._animateFeedback(true);
                        this._setFbIcon(true);
                        App.dom.setText('fb-title', App.t('自测模式'));
                        App.dom.setText('fb-desc', App.t('本题未录入答案，不计分。可在英语专题「答案」中补录后重新练习。'));
                        return;
                    }

                    if (q.type === 'fill') {
                        const accepted = String(q.a || '').split('|').map(s => s.trim()).filter(Boolean);
                        const answerText = accepted.join(' / ');
                        App.dom.show('quiz-feedback');
                        if (animate) this._animateFeedback(saved.ok);
                        if (saved.ok) {
                            this._setFbIcon(true);
                            App.dom.setText('fb-title', App.t('回答正确！'));
                            if (saved.exact) {
                                App.dom.setText('fb-desc', App.t('太棒了，与系统答案完全一致。'));
                            } else {
                                App.dom.setHTML('fb-desc', `${App.t('回答正确。系统答案：')}<span class="font-bold text-primary-600">${App.utils.escapeHTML(answerText)}</span>`);
                            }
                        } else {
                            this._setFbIcon(false);
                            App.dom.setText('fb-title', App.t('回答错误 (Incorrect)'));
                            App.dom.setHTML('fb-desc', `${App.t('你的答案：')}<span class="font-bold text-red-500">${App.utils.escapeHTML(saved.userAns)}</span><br/>${App.t('正确答案：')}<span class="font-bold text-primary-600">${App.utils.escapeHTML(answerText)}</span>`);
                        }
                        return;
                    }

                    if (q.type === 'multi') {
                        const pickedSet = new Set(String(saved.userAns || '').split('').filter(Boolean));
                        if (c) {
                            Array.from(c.children).forEach(child => {
                                const val = child.dataset.val;
                                const isCorrect = (q.a && typeof q.a === 'string') ? q.a.includes(val) : false;
                                const isSelected = pickedSet.has(val);
                                if (isCorrect && !isSelected) child.classList.add('missed');
                                else if (isCorrect) child.classList.add('correct');
                                if (isSelected && !isCorrect) child.classList.add('wrong');
                            });
                        }
                        App.dom.show('quiz-feedback');
                        if (animate) this._animateFeedback(saved.ok);
                        if (saved.ok) {
                            this._setFbIcon(true);
                            App.dom.setText('fb-title', App.t('回答正确！'));
                            App.dom.setText('fb-desc', App.t('太棒了，完全匹配。'));
                        } else {
                            this._setFbIcon(false);
                            App.dom.setText('fb-title', App.t('回答错误 (Incorrect)'));
                            const detailedHTML = App.utils.getDetailedOptionHTML(q, q.a);
                            App.dom.setHTML('fb-desc', `${App.t('正确答案是：')}<span class="font-bold text-primary-600">${App.utils.escapeHTML(q.a)}</span><br/>${detailedHTML}`);
                        }
                        return;
                    }

                    // 单选 (mcq) 与判断 (tf)
                    if (c) {
                        Array.from(c.children).forEach(child => {
                            const val = child.dataset.val;
                            if (val === q.a) child.classList.add('correct');
                            else if (val === saved.userAns && !saved.ok) child.classList.add('wrong');
                        });
                    }
                    if (saved.ok) {
                        if (!animate) {
                            // 回看已答对的单选/判断题时显示简要正确状态，方便确认本轮作答情况
                            App.dom.show('quiz-feedback');
                            this._setFbIcon(true);
                            App.dom.setText('fb-title', App.t('回答正确！'));
                            if (q.type === 'mcq') {
                                App.dom.setHTML('fb-desc', `${App.t('你的选择：')}<span class="font-bold text-emerald-600">${App.utils.escapeHTML(saved.userAns)}</span>`);
                            } else {
                                const ansText = q.a === 'T' ? App.t('正确 (True)') : App.t('错误 (False)');
                                App.dom.setText('fb-desc', `${App.t('你的选择：')}${ansText}`);
                            }
                        } else {
                            App.dom.hide('quiz-feedback');
                        }
                    } else {
                        App.dom.show('quiz-feedback');
                        if (animate) this._animateFeedback(false);
                        this._setFbIcon(false);
                        App.dom.setText('fb-title', App.t('回答错误 (Incorrect)'));
                        if (q.type === 'mcq') {
                            const detailedHTML = App.utils.getDetailedOptionHTML(q, q.a);
                            App.dom.setHTML('fb-desc', `${App.t('正确答案：')}<span class="font-bold text-primary-600">${App.utils.escapeHTML(q.a)}</span><br/>${detailedHTML}`);
                        } else {
                            const ansText = q.a === 'T' ? App.t('正确 (True)') : App.t('错误 (False)');
                            App.dom.setText('fb-desc', `${App.t('正确答案：')}${ansText}`);
                        }
                    }
                },

                _updateNavUI() {
                    const total = Math.max(1, this.queue.length);
                    const pct = Math.round(((this.idx + 1) / total) * 100);
                    const fill = document.getElementById('quiz-progress-fill');
                    if (fill) fill.style.width = `${pct}%`;

                    const ansCount = this._getAnsweredCount();
                    App.dom.setText('quiz-answered-badge', `${ansCount}/${this.queue.length}`);

                    const prevBtn = document.getElementById('quiz-prev-btn');
                    if (prevBtn) {
                        const atStart = this.idx <= 0;
                        prevBtn.disabled = atStart;
                        prevBtn.classList.toggle('opacity-40', atStart);
                        prevBtn.classList.toggle('pointer-events-none', atStart);
                    }
                    const nextLabel = document.getElementById('quiz-next-label');
                    const isLast = this.idx >= this.queue.length - 1;
                    if (nextLabel) {
                        nextLabel.textContent = App.t(isLast ? '完成交卷' : '下一题');
                    } else {
                        const nextBtn = document.getElementById('quiz-next-btn');
                        if (nextBtn) nextBtn.textContent = App.t(isLast ? '完成交卷' : '下一题');
                    }
                    const retryCurBtn = document.getElementById('quiz-retry-cur-btn');
                    if (retryCurBtn) {
                        const hasAns = Boolean(this.sessionAnswers && this.sessionAnswers[this.idx]);
                        retryCurBtn.classList.toggle('hidden', !hasAns);
                    }
                    if (this._navSheetOpen) this._renderNavSheet();
                },

                toggleNavSheet(force) {
                    this._navSheetOpen = typeof force === 'boolean' ? force : !this._navSheetOpen;
                    const sheet = document.getElementById('quiz-nav-sheet');
                    if (sheet) sheet.classList.toggle('hidden', !this._navSheetOpen);
                    if (this._navSheetOpen) this._renderNavSheet();
                },

                _renderNavSheet() {
                    const grid = document.getElementById('quiz-nav-grid');
                    if (!grid) return;
                    grid.innerHTML = '';
                    const frag = document.createDocumentFragment();
                    for (let i = 0; i < this.queue.length; i++) {
                        const ans = this.sessionAnswers ? this.sessionAnswers[i] : null;
                        const isCur = i === this.idx;
                        const btn = document.createElement('button');
                        btn.type = 'button';
                        let cls = 'quiz-nav-pill ';
                        if (ans && ans.answered) {
                            if (ans.selfCheck) cls += 'is-self';
                            else if (ans.ok) cls += 'is-ok';
                            else cls += 'is-err';
                        } else {
                            cls += 'is-idle';
                        }
                        if (isCur) cls += ' is-cur';
                        btn.className = cls;
                        btn.textContent = String(i + 1);
                        btn.onclick = () => this.goTo(i);
                        frag.appendChild(btn);
                    }
                    grid.appendChild(frag);
                },

                prev() {
                    if (this._pendingNextTimer) {
                        clearTimeout(this._pendingNextTimer);
                        this._pendingNextTimer = null;
                    }
                    if (this.idx <= 0) return;
                    this._saveCurrentDraft();
                    this._slideDir = -1;
                    this.idx--;
                    this.render();
                },

                goTo(targetIdx) {
                    if (this._pendingNextTimer) {
                        clearTimeout(this._pendingNextTimer);
                        this._pendingNextTimer = null;
                    }
                    const n = parseInt(targetIdx, 10);
                    if (!Number.isFinite(n) || n < 0 || n >= this.queue.length) return;
                    if (n === this.idx) {
                        this.toggleNavSheet(false);
                        return;
                    }
                    this._saveCurrentDraft();
                    this._slideDir = n > this.idx ? 1 : -1;
                    this.idx = n;
                    this.toggleNavSheet(false);
                    this.render();
                },

                retryCurrent() {
                    if (this._pendingNextTimer) {
                        clearTimeout(this._pendingNextTimer);
                        this._pendingNextTimer = null;
                    }
                    if (this.sessionAnswers) delete this.sessionAnswers[this.idx];
                    if (this.sessionDrafts) delete this.sessionDrafts[this.idx];
                    this._recalcStats();
                    this._slideDir = 0;
                    this.render();
                },

                toggle(val, el) {
                    if (this.currentMultiSelection.has(val)) {
                        this.currentMultiSelection.delete(val);
                        el.classList.remove('selected');
                    } else {
                        this.currentMultiSelection.add(val);
                        el.classList.add('selected');
                    }
                },

                // ===== 填空题判分 =====
                // 标准答案支持多个可接受值，用 | 分隔（如 "TCP|传输控制协议"）；
                // 判分忽略大小写，且忽略全部空白（含词间空格）——
                // "information asymmetry" / "InformationAsymmetry" / "informationasymmetry" 一律判对
                submitFill() {
                    const q = this.queue[this.idx];
                    const input = document.getElementById('fill-input');
                    if (!input) return;
                    // 防重入：提交后 input 已禁用，700ms 自动跳题窗口内的再次点击直接忽略
                    if (input.disabled || this._answeredCurrent) return;
                    const userAns = input.value.trim();
                    if (!userAns) { alert(App.t("请先输入你的答案。(Please type your answer)")); return; }
                    this._answeredCurrent = true;
                    try { input.blur(); } catch (e) { }

                    const accepted = String(q.a || '').split('|').map(s => s.trim()).filter(Boolean);
                    // 归一化：忽略大小写 + 忽略全部空白（中英文一视同仁）
                    const norm = (s) => s.toLowerCase().replace(/\s+/g, '');
                    const ok = accepted.some(x => norm(x) === norm(userAns));

                    // 判断「字面上是否与系统答案完全一致」（不做任何归一化），
                    // 完全一致时反馈里不再重复显示系统答案
                    const exact = accepted.some(x => x === userAns);

                    const duration = this._questionStartTime ? Math.min(Date.now() - this._questionStartTime, 300000) : 0;
                    const saved = {
                        answered: true,
                        userAns,
                        ok: Boolean(ok),
                        exact: Boolean(exact),
                        selfCheck: Boolean(q.selfCheck)
                    };
                    this.sessionAnswers[this.idx] = saved;
                    delete this.sessionDrafts[this.idx];
                    this._recalcStats();

                    if (!q.selfCheck) {
                        App.data.record(q.id, ok, duration);
                    }
                    this._applyAnsweredView(q, saved, true);
                    this._updateNavUI();

                    if (q.selfCheck) {
                        if (this._pendingNextTimer) clearTimeout(this._pendingNextTimer);
                        this._pendingNextTimer = setTimeout(() => {
                            this._pendingNextTimer = null;
                            this.next();
                        }, 1400);
                    } else if (ok) {
                        // 与选择题行为一致：答对自动进入下一题（平滑自适应延迟）
                        const hasMedia = (Array.isArray(q.media) && q.media.length > 0) || Boolean(q.psg);
                        const delay = hasMedia ? 1100 : 700;
                        if (this._pendingNextTimer) clearTimeout(this._pendingNextTimer);
                        this._pendingNextTimer = setTimeout(() => {
                            this._pendingNextTimer = null;
                            this.next();
                        }, delay);
                    }
                },

                // ===== 键盘作答（A–D / 1–4 选择，←/→ 自由切题，S 收藏，Enter 提交 / 下一题）=====
                _ensureKeyboard() {
                    if (this._keysBound) return;
                    this._keysBound = true;
                    document.addEventListener('keydown', (e) => this._onQuizKey(e));
                },

                _onQuizKey(e) {
                    if (!window.App || App.router.currentView !== 'quiz') return;
                    if (e.repeat) return;   // 长按自动重复会以 ~400ms/题 的速度刷卷并全部落历史
                    // 输入框（填空题答案）里的按键交给输入框自己处理
                    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
                    if (e.ctrlKey || e.metaKey || e.altKey) return;
                    const q = this.queue && this.queue[this.idx];
                    if (!q) return;

                    // ← / → 方向键随时自由切换上下题（即使正在等待答对自动跳题也立即响应手动切题）
                    if (e.key === 'ArrowLeft') {
                        e.preventDefault();
                        this.prev();
                        return;
                    }
                    if (e.key === 'ArrowRight') {
                        e.preventDefault();
                        this.next();
                        return;
                    }

                    // 已答对、正在等自动进入下一题：忽略其余作答按键——
                    // 否则 400ms 窗口内的连按会重复写历史、得分率还会超过 100%
                    if (this._pendingNextTimer) return;
                    const fb = document.getElementById('quiz-feedback');
                    const feedbackShown = (fb && !fb.classList.contains('hidden')) || this._answeredCurrent;

                    const key = (e.key || '').toLowerCase();

                    // S 键快速收藏/取消收藏当前题目
                    if (key === 's') {
                        e.preventDefault();
                        App.data.toggleStar(q.id);
                        this._updateStarBtn(q, true);
                        return;
                    }

                    if (e.key === 'Enter' || e.key === ' ') {
                        if (q.type === 'fill') {
                            if (feedbackShown) { e.preventDefault(); this.next(); }
                            return;
                        }
                        if (q.type === 'multi' && !feedbackShown) {
                            e.preventDefault();
                            this.submitMulti();
                            return;
                        }
                        if (feedbackShown) { e.preventDefault(); this.next(); }
                        return;
                    }
                    if (feedbackShown) return;

                    const optBtns = document.querySelectorAll('#q-options .opt-btn');

                    if (q.type === 'tf') {
                        let v = null;
                        if (key === '1' || key === 't') v = 'T';
                        else if (key === '2' || key === 'f') v = 'F';
                        if (v && optBtns.length === 2) this.sub(v, v === 'T' ? optBtns[0] : optBtns[1]);
                        return;
                    }

                    let idx = '123456789'.indexOf(e.key);
                    if (idx === -1) idx = 'abcdefgh'.indexOf(key);
                    if (idx === -1 || idx >= (q.o || []).length) return;
                    const btn = optBtns[idx];
                    if (!btn) return;
                    if (q.type === 'multi') this.toggle(String.fromCharCode(65 + idx), btn);
                    else this.sub(String.fromCharCode(65 + idx), btn);
                },

                submitMulti() {
                    if (this._answeredCurrent || this._pendingNextTimer) return;
                    const q = this.queue[this.idx];
                    const selectedArr = Array.from(this.currentMultiSelection).sort();
                    const userAns = selectedArr.join('');

                    if (userAns.length === 0) { alert(App.t("请至少选择一个选项！(Select at least one option)")); return; }
                    this._answeredCurrent = true;

                    // 修复 1: 在判题时也做一次安全兜底，避免脏数据引发错误 (Normalization Check)
                    const normalizedAnswer = (q.a || '').split('').sort().join('');
                    const ok = userAns === normalizedAnswer;

                    const duration = this._questionStartTime ? Math.min(Date.now() - this._questionStartTime, 300000) : 0;
                    const saved = {
                        answered: true,
                        userAns,
                        ok: Boolean(ok),
                        exact: Boolean(ok),
                        selfCheck: Boolean(q.selfCheck)
                    };
                    this.sessionAnswers[this.idx] = saved;
                    delete this.sessionDrafts[this.idx];
                    this._recalcStats();

                    if (!q.selfCheck) {
                        App.data.record(q.id, ok, duration);
                    }
                    this._applyAnsweredView(q, saved, true);
                    this._updateNavUI();

                    // 多选题答对后自适应切题（与单选节奏对齐）
                    if (q.selfCheck) {
                        if (this._pendingNextTimer) clearTimeout(this._pendingNextTimer);
                        this._pendingNextTimer = setTimeout(() => {
                            this._pendingNextTimer = null;
                            this.next();
                        }, 1400);
                    } else if (ok) {
                        const hasMedia = (Array.isArray(q.media) && q.media.length > 0) || Boolean(q.psg);
                        const delay = hasMedia ? 1200 : 800;
                        if (this._pendingNextTimer) clearTimeout(this._pendingNextTimer);
                        this._pendingNextTimer = setTimeout(() => {
                            this._pendingNextTimer = null;
                            this.next();
                        }, delay);
                    }
                },

                sub(val, el) {
                    if (this._pendingNextTimer || this._answeredCurrent) return;   // 已作答或等待跳转：忽略重复提交
                    this._answeredCurrent = true;
                    const q = this.queue[this.idx];
                    const ok = val === q.a;
                    const duration = this._questionStartTime ? Math.min(Date.now() - this._questionStartTime, 300000) : 0;
                    const saved = {
                        answered: true,
                        userAns: val,
                        ok: Boolean(ok),
                        exact: Boolean(ok),
                        selfCheck: Boolean(q.selfCheck)
                    };
                    this.sessionAnswers[this.idx] = saved;
                    delete this.sessionDrafts[this.idx];
                    this._recalcStats();

                    if (!q.selfCheck) {
                        App.data.record(q.id, ok, duration);
                    }
                    this._applyAnsweredView(q, saved, true);
                    this._updateNavUI();

                    if (q.selfCheck) {
                        if (this._pendingNextTimer) clearTimeout(this._pendingNextTimer);
                        this._pendingNextTimer = setTimeout(() => {
                            this._pendingNextTimer = null;
                            this.next();
                        }, 1400);
                    } else if (ok) {
                        // 优化切题节奏：普通单选题 650ms，含图表/长阅读题目适当留出 1100ms 观察窗口
                        const hasMedia = (Array.isArray(q.media) && q.media.length > 0) || Boolean(q.psg);
                        const delay = hasMedia ? 1100 : 650;
                        if (this._pendingNextTimer) clearTimeout(this._pendingNextTimer);
                        this._pendingNextTimer = setTimeout(() => {
                            this._pendingNextTimer = null;
                            this.next();
                        }, delay);
                    }
                },
                next() {
                    if (this._pendingNextTimer) {
                        clearTimeout(this._pendingNextTimer);
                        this._pendingNextTimer = null;
                    }
                    this._saveCurrentDraft();
                    if (this.idx < this.queue.length - 1) {
                        this._slideDir = 1;
                        this.idx++;
                        this.render();
                    } else {
                        const unanswered = this._getUnansweredCount();
                        if (unanswered > 0) this.finishConfirmed();
                        else this.finish();
                    }
                },
                finish() {
                    this._active = false;
                    this.toggleNavSheet(false);
                    if (this._pendingNextTimer) {
                        clearTimeout(this._pendingNextTimer);
                        this._pendingNextTimer = null;
                    }
                    this._recalcStats();
                    // 答题结束，恢复云端同步并触发一次保存
                    App.data._suppressCloudSync = false;
                    if (App.data.saveToCloudDebounced) App.data.saveToCloudDebounced();
                    App.router.go('result');
                    const total = this.queue.length;
                    const answered = this._getAnsweredCount();
                    const unanswered = Math.max(0, total - answered);
                    // 未作答不再并入错误数：提前交卷时把两者混在一起会让用户误以为都答错了
                    const score = total === 0 ? 0 : Math.round((this.stats.c / total) * 100);
                    App.dom.setText('res-score', score + '%');
                    App.dom.setText('res-correct', this.stats.c);
                    App.dom.setText('res-wrong', this.stats.w);
                    const unEl = document.getElementById('res-unanswered-wrap');
                    if (unEl) {
                        unEl.classList.toggle('hidden', unanswered === 0);
                        App.dom.setText('res-unanswered', String(unanswered));
                    }
                    const retryWrongBtn = document.getElementById('res-retry-wrong-btn');
                    if (retryWrongBtn) {
                        const wrongCount = (this.sessionWrongIds || []).length;
                        retryWrongBtn.classList.toggle('hidden', wrongCount === 0);
                        retryWrongBtn.textContent = `${App.t('重练本轮错题')} (${wrongCount})`;
                    }
                },

                // 「提前交卷」入口：先确认再收卷。误触原来会直接结束整场练习，
                // 有未作答题目时把数量一起告知（答完最后一题自然收卷走 finish()，不弹确认）
                async finishConfirmed() {
                    const unanswered = this._getUnansweredCount();
                    const msg = unanswered > 0
                        ? App.t('还有 N 题未作答，确定提前交卷吗？').replace('N', unanswered)
                        : App.t('确定提前交卷吗？');
                    const ok = (window.App && App.ui && typeof App.ui.confirm === 'function')
                        ? await App.ui.confirm(msg)
                        : window.confirm(msg);
                    if (!ok) return;
                    this.finish();
                },
                isActive() {
                    return this._active === true;
                },

                // 阅读文章栏：桌面常驻左栏、手机抽屉；同文章连题保持滚动位置
                _renderPassage(q) {
                    const view = document.getElementById('view-quiz');
                    const col = document.getElementById('q-passage-col');
                    const txt = document.getElementById('q-passage-text');
                    const toggle = document.getElementById('psg-toggle');
                    const backdrop = document.getElementById('psg-backdrop');
                    if (!view || !col || !txt || !toggle || !backdrop) return;
                    if (q && q.psg) {
                        view.classList.add('has-psg');
                        const sig = String(q.psg.length) + ':' + q.psg.slice(0, 80);
                        if (txt.dataset.sig !== sig) {
                            txt.textContent = q.psg;
                            txt.dataset.sig = sig;
                            txt.scrollTop = 0;
                        }
                        if (this._psgFont == null) {
                            let v = 15;
                            try { v = parseInt(localStorage.getItem('qs_psg_fontsize'), 10) || 15; } catch (e) { }
                            this._psgFont = Math.min(24, Math.max(12, v));
                        }
                        txt.style.fontSize = this._psgFont + 'px';
                        // 收起抽屉（手机），避免上一题的开合状态残留
                        col.classList.remove('open');
                        backdrop.classList.add('hidden');
                    } else {
                        view.classList.remove('has-psg');
                        txt.textContent = '';
                        delete txt.dataset.sig;
                        col.classList.remove('open');
                        backdrop.classList.add('hidden');
                    }
                },

                // 文章字号：localStorage 记忆，12-24px
                _psgFont: null,

                psgFont(delta) {
                    if (this._psgFont == null) {
                        let v = 15;
                        try { v = parseInt(localStorage.getItem('qs_psg_fontsize'), 10) || 15; } catch (e) { }
                        this._psgFont = Math.min(24, Math.max(12, v));
                    }
                    this._psgFont = Math.min(24, Math.max(12, this._psgFont + delta));
                    try { localStorage.setItem('qs_psg_fontsize', String(this._psgFont)); } catch (e) { }
                    const txt = document.getElementById('q-passage-text');
                    if (txt) txt.style.fontSize = this._psgFont + 'px';
                },

                togglePassage() {
                    const col = document.getElementById('q-passage-col');
                    const backdrop = document.getElementById('psg-backdrop');
                    if (!col || !backdrop) return;
                    const open = col.classList.toggle('open');
                    backdrop.classList.toggle('hidden', !open);
                },

                // 刷题页收藏按钮：同步星标状态并绑定点击（每题渲染时刷新）
                _updateStarBtn(q, animatePop = false) {
                    const btn = document.getElementById('quiz-star-btn');
                    if (!btn || !q) return;
                    const icon = btn.querySelector('[data-star-icon]');
                    const sync = () => {
                        const starred = App.data.isStarred(q.id);
                        if (icon) {
                            icon.setAttribute('fill', starred ? 'currentColor' : 'none');
                            btn.classList.toggle('text-amber-400', starred);
                            btn.classList.toggle('text-[var(--sub)]', !starred);
                        }
                        const tip = App.t(starred ? '取消收藏' : '收藏');
                        btn.title = tip;
                        btn.setAttribute('aria-label', tip);
                    };
                    sync();
                    if (animatePop) {
                        btn.classList.remove('anim-star-pop');
                        void btn.offsetWidth;
                        btn.classList.add('anim-star-pop');
                    }
                    if (!btn.dataset.starBound) {
                        btn.dataset.starBound = '1';
                        btn.addEventListener('click', () => {
                            const cur = this.queue[this.idx];
                            if (!cur) return;
                            App.data.toggleStar(cur.id);
                            this._updateStarBtn(cur, true);
                        });
                    }
                },

                // 练习收尾清理：恢复同步、冲刷未上传记录（不负责跳转）
                _cleanup() {
                    this._active = false;
                    if (this._pendingNextTimer) {
                        clearTimeout(this._pendingNextTimer);
                        this._pendingNextTimer = null;
                    }
                    App.data._suppressCloudSync = false;
                    if (App.data._historyAppendBuffer.length > 0 && App.data.saveToCloudDebounced) {
                        App.data.saveToCloudDebounced();
                    }
                },

                abort() {
                    this._cleanup();
                    App.router.go('dashboard');
                },

                // 答题反馈的进场动画：答对轻弹出，答错抖一下（与选项的抖动同语言）。
                // 反馈面板是硬切显示的，不加动画会显得生硬；重复作答要先摘掉旧类。
                _animateFeedback(ok) {
                    const fb = document.getElementById('quiz-feedback');
                    if (!fb) return;
                    fb.classList.remove('anim-pop-in', 'anim-shake');
                    void fb.offsetWidth;
                    fb.classList.add(ok ? 'anim-pop-in' : 'anim-shake');
                }
};
