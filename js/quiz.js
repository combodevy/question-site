export const quiz = {
                queue: [], idx: 0, stats: { c: 0, w: 0 }, currentMultiSelection: new Set(), lastConfig: null,
                _questionStartTime: null,
                _pendingNextTimer: null,

                init(mode, config = {}) {
                    if (this._pendingNextTimer) {
                        clearTimeout(this._pendingNextTimer);
                        this._pendingNextTimer = null;
                    }
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
                            const n = parseInt(l, 10);
                            // parseInt 对空值/非法值返回 NaN，slice(0, NaN) 会得到空队列，
                            // 用户看到的是空白答题页。这里统一回退到「全部」。
                            limit = (l === 'all' || !Number.isFinite(n) || n <= 0) ? pool.length : n;
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

                    // 题型过滤：'all' 不过滤；其余按类型精确匹配（含 fill）
                    if (typeConstraint !== 'all') pool = pool.filter(q => q.type === typeConstraint);

                    if (pool.length === 0) {
                        alert("此筛选条件下没有符合的题目。请更改条件后重试。\n(No questions match your filter criteria.)");
                        return false;
                    }

                    if (mode === 'mistakes') {
                        const errIds = new Set(App.data.getSafeHistory().filter(h => !h.r).map(h => h.id));
                        pool = pool.filter(q => errIds.has(q.id));
                        // 排除已被用户从错题本「移除」的题，否则移除后练错题还会抽到它
                        pool = pool.filter(q => !App.data.isMistakeHidden(q.id));
                        if (!pool.length) { alert("太棒了！您的题库中暂无错题。\n(Great job! No mistakes found.)"); return false; }
                        this.queue = App.utils.shuffle(pool);
                    } else if (mode === 'review') {
                        // 间隔复习：只取今日到期（SM-2 计划）的题，按到期时间排序
                        const due = App.data.getReviewQueue();
                        if (!due.length) {
                            alert("今日没有到期的复习题目。\n先完成一轮练习，复习计划会随后出现。");
                            return false;
                        }
                        this.queue = due;
                    } else if (mode === 'random') {
                        this.queue = App.utils.shuffle(pool).slice(0, limit);
                    } else if (mode === 'custom') {
                        const chks = document.querySelectorAll('.setup-chk:checked');
                        if (chks.length > 0) {
                            const targets = Array.from(chks).map(c => c.value);
                            pool = pool.filter(q => targets.includes(`${q.sub}\u0001${q.chap}`));
                        }
                        if (!pool.length) { alert("选中的章节下没有符合的题目。\n(No questions in the selected chapters.)"); return false; }

                        pool = App.utils.shuffle(pool);
                        const l = App.dom.getValue('setup-limit', '20');
                        const n = parseInt(l, 10);
                        this.queue = (l === 'all' || !Number.isFinite(n) || n <= 0) ? pool : pool.slice(0, n);
                    }

                    this.idx = 0; this.stats = { c: 0, w: 0 };
                    // 走到这里说明所有校验都通过了，才暂停云端同步（答题期间攒着，做完一次性上传）。
                    // 注意：不能放在函数开头——上面有多条提前 return 的失败路径
                    //（题库为空 / 筛选无结果 / 无错题 / 章节无题），一旦泄漏这个标志位，
                    // 本次会话内所有题库与记录的改动都不再上传云端，而界面仍显示「已同步」。
                    App.data._suppressCloudSync = true;
                    this._ensureKeyboard();
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
                    App.dom.setText('q-type', q.type === 'mcq' ? '单选' : (q.type === 'multi' ? '多选' : (q.type === 'fill' ? '填空' : '判断')));
                    App.dom.setText('q-sub', q.sub);
                    App.dom.setText('q-text', q.q);
                    App.dom.setText('quiz-progress', `${this.idx + 1} / ${this.queue.length}`);

                    this._questionStartTime = Date.now();

                    const c = App.dom.get('q-options');
                    if (c) { c.innerHTML = ''; c.style.pointerEvents = 'auto'; }
                    App.dom.hide('quiz-feedback');

                    this.currentMultiSelection = new Set();

                    // 填空题：显示输入框 + 提交按钮（隐藏多选/判断交互）
                    const fillActions = document.getElementById('fill-actions');
                    const fillInput = document.getElementById('fill-input');
                    if (fillActions && fillInput) {
                        if (q.type === 'fill') {
                            fillActions.classList.remove('hidden');
                            fillInput.value = '';
                            fillInput.disabled = false;
                            setTimeout(() => { try { fillInput.focus(); } catch (e) { } }, 80);
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
                            b.className = "opt-btn card p-4 cursor-pointer hover:border-primary-500 transition-all flex gap-3 items-center group mb-3 rounded-xl touch-manipulation";
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

                // ===== 填空题判分 =====
                // 标准答案支持多个可接受值，用 | 分隔（如 "TCP|传输控制协议"）；
                // 判分忽略大小写，且忽略全部空白（含词间空格）——
                // "information asymmetry" / "InformationAsymmetry" / "informationasymmetry" 一律判对
                submitFill() {
                    const q = this.queue[this.idx];
                    const input = document.getElementById('fill-input');
                    if (!input) return;
                    const userAns = input.value.trim();
                    if (!userAns) { alert("请先输入你的答案。(Please type your answer)"); return; }

                    const accepted = String(q.a || '').split('|').map(s => s.trim()).filter(Boolean);
                    // 归一化：忽略大小写 + 忽略全部空白（中英文一视同仁）
                    const norm = (s) => s.toLowerCase().replace(/\s+/g, '');
                    const ok = accepted.some(x => norm(x) === norm(userAns));

                    // 判断「字面上是否与系统答案完全一致」（不做任何归一化），
                    // 完全一致时反馈里不再重复显示系统答案
                    const exact = accepted.some(x => x === userAns);

                    const duration = this._questionStartTime ? Math.min(Date.now() - this._questionStartTime, 300000) : 0;
                    App.data.record(q.id, ok, duration);

                    input.disabled = true;
                    const c = App.dom.get('q-options');
                    if (c) c.style.pointerEvents = 'none';
                    App.dom.show('quiz-feedback');
                    this._animateFeedback(ok);

                    const answerText = accepted.join(' / ');
                    if (ok) {
                        this.stats.c++;
                        App.dom.setText('fb-icon', '✓');
                        App.dom.setText('fb-title', '回答正确！');
                        if (exact) {
                            App.dom.setText('fb-desc', '太棒了，与系统答案完全一致。');
                        } else {
                            // 归一化判对但字面不同（如大小写/空格差异/等价写法）——仍显示系统标准答案
                            App.dom.setHTML('fb-desc', `回答正确。系统答案：<span class="font-bold text-primary-600">${App.utils.escapeHTML(answerText)}</span>`);
                        }
                        // 与选择题行为一致：答对自动进入下一题（稍等片刻让用户看到正确反馈）
                        if (this._pendingNextTimer) clearTimeout(this._pendingNextTimer);
                        this._pendingNextTimer = setTimeout(() => {
                            this._pendingNextTimer = null;
                            this.next();
                        }, 700);
                    } else {
                        this.stats.w++;
                        App.dom.setText('fb-icon', '✕');
                        App.dom.setText('fb-title', '回答错误 (Incorrect)');
                        App.dom.setHTML('fb-desc', `你的答案：<span class="font-bold text-red-500">${App.utils.escapeHTML(userAns)}</span><br/>正确答案：<span class="font-bold text-primary-600">${App.utils.escapeHTML(answerText)}</span>`);
                    }
                },

                // ===== 键盘作答（A–D / 1–4 选择，Enter 提交 / 下一题）=====
                _ensureKeyboard() {
                    if (this._keysBound) return;
                    this._keysBound = true;
                    document.addEventListener('keydown', (e) => this._onQuizKey(e));
                },

                _onQuizKey(e) {
                    if (!window.App || App.router.currentView !== 'quiz') return;
                    // 输入框（填空题答案）里的按键交给输入框自己处理
                    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
                    if (e.ctrlKey || e.metaKey || e.altKey) return;
                    const q = this.queue && this.queue[this.idx];
                    if (!q) return;
                    const fb = document.getElementById('quiz-feedback');
                    const feedbackShown = fb && !fb.classList.contains('hidden');

                    if (e.key === 'Enter') {
                        if (q.type === 'fill') return;   // 填空题 Enter 在输入框内提交
                        if (q.type === 'multi' && !feedbackShown) { e.preventDefault(); this.submitMulti(); return; }
                        if (feedbackShown) { e.preventDefault(); this.next(); }
                        return;
                    }
                    if (feedbackShown) return;

                    const key = (e.key || '').toLowerCase();
                    const optBtns = document.querySelectorAll('#q-options .opt-btn');

                    if (q.type === 'tf') {
                        let v = null;
                        if (key === '1' || key === 't') v = 'T';
                        else if (key === '2' || key === 'f') v = 'F';
                        if (v && optBtns.length === 2) this.sub(v, v === 'T' ? optBtns[0] : optBtns[1]);
                        return;
                    }

                    let idx = '123456789'.indexOf(e.key);
                    if (idx === -1) idx = 'abcde'.indexOf(key);
                    if (idx === -1 || idx >= (q.o || []).length) return;
                    const btn = optBtns[idx];
                    if (!btn) return;
                    if (q.type === 'multi') this.toggle(String.fromCharCode(65 + idx), btn);
                    else this.sub(String.fromCharCode(65 + idx), btn);
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
                    this._animateFeedback(ok);

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
                        this._animateFeedback(false);
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
