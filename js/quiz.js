export const quiz = {
                queue: [], idx: 0, stats: { c: 0, w: 0 }, currentMultiSelection: new Set(), lastConfig: null,
                _questionStartTime: null,
                _pendingNextTimer: null,

                init(mode, config = {}) {
                    if (this._pendingNextTimer) {
                        clearTimeout(this._pendingNextTimer);
                        this._pendingNextTimer = null;
                    }
                    // 答题期间暂停云端同步，做完再一次性上传
                    App.data._suppressCloudSync = true;
                    let pool = App.data.getQuestions();
                    if (!pool.length) {
                        alert("当前题库为空，请先在设置中导入题库文件。\n(The question bank is empty. Please import a JSON file in settings.)");
                        return false;
                    }

                    this.lastConfig = { mode, options: { ...config } };

                    let typeConstraint = 'all';
                    let limit = 20;

                    if (mode === 'random') {
                        if (!config.type) typeConstraint = App.dom.getValue('smart-type', 'all');
                        else typeConstraint = config.type;

                        if (!config.limit) {
                            const l = App.dom.getValue('smart-limit', '20');
                            limit = l === 'all' ? pool.length : parseInt(l);
                        } else {
                            limit = config.limit;
                        }

                        const subChks = document.querySelectorAll('.smart-subject-chk:checked');
                        if (subChks.length > 0) {
                            const selectedSubs = Array.from(subChks).map(c => c.value);
                            pool = pool.filter(q => selectedSubs.includes(q.sub));
                        }
                    } else if (mode === 'custom') {
                        if (!config.type) typeConstraint = App.dom.getValue('setup-type', 'all');
                        else typeConstraint = config.type;
                    }

                    if (typeConstraint === 'mcq') pool = pool.filter(q => q.type === 'mcq');
                    if (typeConstraint === 'tf') pool = pool.filter(q => q.type === 'tf');
                    if (typeConstraint === 'multi') pool = pool.filter(q => q.type === 'multi');

                    if (pool.length === 0) {
                        alert("此筛选条件下没有符合的题目。请更改条件后重试。\n(No questions match your filter criteria.)");
                        return false;
                    }

                    if (mode === 'mistakes') {
                        const errIds = new Set(App.data.history.filter(h => !h.r).map(h => h.id));
                        pool = pool.filter(q => errIds.has(q.id));
                        if (!pool.length) { alert("太棒了！您的题库中暂无错题。\n(Great job! No mistakes found.)"); return false; }
                        this.queue = App.utils.shuffle(pool);
                    } else if (mode === 'random') {
                        this.queue = App.utils.shuffle(pool).slice(0, limit);
                    } else if (mode === 'custom') {
                        const chks = document.querySelectorAll('.setup-chk:checked');
                        if (chks.length > 0) {
                            const targets = Array.from(chks).map(c => c.value);
                            pool = pool.filter(q => targets.includes(`${q.sub}|${q.chap}`));
                        }
                        if (!pool.length) { alert("选中的章节下没有符合的题目。\n(No questions in the selected chapters.)"); return false; }

                        pool = App.utils.shuffle(pool);
                        const l = App.dom.getValue('setup-limit', '20');
                        this.queue = l === 'all' ? pool : pool.slice(0, parseInt(l));
                    }

                    this.idx = 0; this.stats = { c: 0, w: 0 };
                    App.router.go('quiz');
                    this.render();
                    return true;
                },

                restart() {
                    if (this.lastConfig) this.init(this.lastConfig.mode, this.lastConfig.options);
                    else this.init('random');
                },

                render() {
                    if (this._pendingNextTimer) {
                        clearTimeout(this._pendingNextTimer);
                        this._pendingNextTimer = null;
                    }
                    const q = this.queue[this.idx];
                    if (!q) return;
                    App.dom.setText('q-type', q.type === 'mcq' ? '单选' : (q.type === 'multi' ? '多选' : '判断'));
                    App.dom.setText('q-sub', q.sub);
                    App.dom.setText('q-text', q.q);
                    App.dom.setText('quiz-progress', `${this.idx + 1} / ${this.queue.length}`);

                    this._questionStartTime = Date.now();

                    const c = App.dom.get('q-options');
                    if (c) { c.innerHTML = ''; c.style.pointerEvents = 'auto'; }
                    App.dom.hide('quiz-feedback');

                    this.currentMultiSelection = new Set();

                    if (q.type === 'multi') {
                        App.dom.show('multi-actions');
                        App.dom.show('multi-hint');

                        (q.o || []).forEach((opt, i) => {
                            const char = String.fromCharCode(65 + i);
                            const safeOpt = App.utils.escapeHTML(opt);
                            const b = document.createElement('div');
                            b.className = "opt-btn card p-4 cursor-pointer hover:border-primary-500 transition-all flex gap-3 items-center group mb-3 rounded-xl touch-manipulation";
                            b.dataset.val = char;
                            b.innerHTML = `<span class="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-[var(--sub)] font-bold flex items-center justify-center transition-colors border border-transparent">${char}</span><span class="text-sm font-medium">${safeOpt}</span>`;
                            b.onclick = () => this.toggle(char, b);
                            if (c) c.appendChild(b);
                        });
                    } else {
                        App.dom.hide('multi-actions');
                        App.dom.hide('multi-hint');

                        if (q.type === 'mcq') {
                            (q.o || []).forEach((opt, i) => {
                                const char = String.fromCharCode(65 + i);
                                const safeOpt = App.utils.escapeHTML(opt);
                                const b = document.createElement('div');
                                b.className = "opt-btn card p-4 cursor-pointer hover:border-primary-500 transition-all flex gap-3 items-center group mb-3 rounded-xl touch-manipulation";
                                b.innerHTML = `<span class="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-[var(--sub)] font-bold flex items-center justify-center group-hover:text-primary-600 group-hover:bg-primary-50 transition-colors">${char}</span><span class="text-sm font-medium">${safeOpt}</span>`;
                                b.onclick = () => this.sub(char, b);
                                if (c) c.appendChild(b);
                            });
                        } else {
                            ['T', 'F'].forEach(v => {
                                const b = document.createElement('div');
                                b.className = "opt-btn card p-4 cursor-pointer hover:border-primary-500 transition-all text-center font-bold mb-3 rounded-xl text-lg touch-manipulation";
                                b.innerText = v === 'T' ? '正确 (True)' : '错误 (False)';
                                b.onclick = () => this.sub(v, b);
                                if (c) c.appendChild(b);
                            });
                        }
                    }
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

                submitMulti() {
                    const q = this.queue[this.idx];
                    const selectedArr = Array.from(this.currentMultiSelection).sort();
                    const userAns = selectedArr.join('');

                    if (userAns.length === 0) { alert("请至少选择一个选项！(Select at least one option)"); return; }

                    // 修复 1: 在判题时也做一次安全兜底，避免脏数据引发错误 (Normalization Check)
                    const normalizedAnswer = (q.a || '').split('').sort().join('');
                    const ok = userAns === normalizedAnswer;

                    const duration = this._questionStartTime ? Math.min(Date.now() - this._questionStartTime, 300000) : 0;
                    App.data.record(q.id, ok, duration);

                    const c = App.dom.get('q-options');
                    if (c) c.style.pointerEvents = 'none';
                    App.dom.hide('multi-actions');
                    App.dom.show('quiz-feedback');

                    if (ok) {
                        this.stats.c++;
                        App.dom.setText('fb-icon', '✓');
                        App.dom.setText('fb-title', '回答正确！');
                        App.dom.setText('fb-desc', '太棒了，完全匹配。');
                    } else {
                        this.stats.w++;
                        App.dom.setText('fb-icon', '✕');
                        App.dom.setText('fb-title', '回答错误 (Incorrect)');
                        const detailedHTML = App.utils.getDetailedOptionHTML(q, q.a);
                        App.dom.setHTML('fb-desc', `正确答案是：<span class="font-bold text-primary-600">${q.a}</span><br/>${detailedHTML}`);
                    }

                    if (c) {
                        Array.from(c.children).forEach(child => {
                            const val = child.dataset.val;
                            const isCorrect = (q.a && typeof q.a === 'string') ? q.a.includes(val) : false;
                            const isSelected = this.currentMultiSelection.has(val);

                            if (isCorrect && !isSelected) child.classList.add('missed');
                            else if (isCorrect) child.classList.add('correct');
                            if (isSelected && !isCorrect) child.classList.add('wrong');
                        });
                    }
                },

                sub(val, el) {
                    const q = this.queue[this.idx];
                    const ok = val === q.a;
                    const duration = this._questionStartTime ? Math.min(Date.now() - this._questionStartTime, 300000) : 0;
                    App.data.record(q.id, ok, duration);

                    const c = App.dom.get('q-options');
                    if (c) c.style.pointerEvents = 'none';

                    if (ok) {
                        this.stats.c++;
                        el.classList.add('correct');
                        App.dom.hide('quiz-feedback');
                        if (this._pendingNextTimer) clearTimeout(this._pendingNextTimer);
                        this._pendingNextTimer = setTimeout(() => {
                            this._pendingNextTimer = null;
                            this.next();
                        }, 400);
                    } else {
                        this.stats.w++;
                        el.classList.add('wrong');
                        App.dom.show('quiz-feedback');
                        App.dom.setText('fb-icon', '✕');
                        App.dom.setText('fb-title', '回答错误 (Incorrect)');

                        if (q.type === 'mcq') {
                            const detailedHTML = App.utils.getDetailedOptionHTML(q, q.a);
                            App.dom.setHTML('fb-desc', `正确答案：<span class="font-bold text-primary-600">${q.a}</span><br/>${detailedHTML}`);
                        } else {
                            const ansText = q.a === 'T' ? '正确 (True)' : '错误 (False)';
                            App.dom.setText('fb-desc', `正确答案：${ansText}`);
                        }

                        if (q.type === 'mcq' && c) {
                            Array.from(c.children).forEach((child, idx) => {
                                if (String.fromCharCode(65 + idx) === q.a) child.classList.add('correct');
                            });
                        } else if (c) {
                            Array.from(c.children).forEach((child) => {
                                if ((q.a === 'T' && child.innerText.includes('True')) || (q.a === 'F' && child.innerText.includes('False'))) {
                                    child.classList.add('correct');
                                }
                            });
                        }
                    }
                },
                next() {
                    if (this._pendingNextTimer) {
                        clearTimeout(this._pendingNextTimer);
                        this._pendingNextTimer = null;
                    }
                    if (this.idx < this.queue.length - 1) { this.idx++; this.render(); } else this.finish();
                },
                finish() {
                    if (this._pendingNextTimer) {
                        clearTimeout(this._pendingNextTimer);
                        this._pendingNextTimer = null;
                    }
                    // 答题结束，恢复云端同步并触发一次保存
                    App.data._suppressCloudSync = false;
                    if (App.data.saveToCloudDebounced) App.data.saveToCloudDebounced();
                    App.router.go('result');
                    const total = this.queue.length;
                    const answered = this.stats.c + this.stats.w;
                    const unanswered = Math.max(0, total - answered);
                    const finalWrong = this.stats.w + unanswered;
                    const score = total === 0 ? 0 : Math.round((this.stats.c / total) * 100);
                    App.dom.setText('res-score', score + '%');
                    App.dom.setText('res-correct', this.stats.c);
                    App.dom.setText('res-wrong', finalWrong);
                },
                abort() {
                    if (this._pendingNextTimer) {
                        clearTimeout(this._pendingNextTimer);
                        this._pendingNextTimer = null;
                    }
                    // 提前退出，恢复云端同步并触发一次保存
                    App.data._suppressCloudSync = false;
                    if (App.data._historyAppendBuffer.length > 0 && App.data.saveToCloudDebounced) {
                        App.data.saveToCloudDebounced();
                    }
                    App.router.go('dashboard');
                }
            };
