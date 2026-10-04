export const dashboard = {

                    render() {
                        const s = App.data.getStats();
                        this._renderDailyGoal(s);
                        this._animateNumber('dash-acc', s.acc, '%');
                        App.dom.setText('dash-total', s.total);
                        App.dom.setText('dash-err', s.mistakes);
                        App.dom.setText('last-practice-time', s.timeText);

                        // 间隔复习横幅：SM-2 计划中有今日到期的题时才显示
                        const reviewBanner = App.dom.get('review-banner');
                        if (reviewBanner && typeof App.data.getDueCount === 'function') {
                            const due = App.data.getDueCount();
                            App.dom.setText('review-due-count', String(due));
                            reviewBanner.classList.toggle('hidden', due === 0);
                        }

                        const ml = App.dom.get('mistake-list');
                        if (ml) {
                            ml.innerHTML = '';
                            if (s.total === 0) {
                                ml.innerHTML = `<div class="p-6 flex flex-col items-center gap-3 text-center border border-dashed border-[var(--border)] rounded-xl m-4">
                                    <div class="text-[var(--sub)] text-xs">题库还是空的，先导入一份题目开始练习吧。</div>
                                    <button onclick="App.ui.openImportCenter()" class="px-4 py-1.5 rounded-full bg-primary-600 text-white text-[11px] font-bold shadow-sm active:scale-95 transition-transform">导入题库</button>
                                </div>`;
                            } else if (s.topMistakes.length === 0) {
                                ml.innerHTML = `<div class="p-6 text-center text-[var(--sub)] text-xs border border-dashed border-[var(--border)] rounded-xl m-4">${App.t('暂无错题数据，太棒了！')}</div>`;
                            } else {
                                s.topMistakes.forEach((q, i) => {
                                    const d = document.createElement('div');
                                    d.className = "flex items-start justify-between p-4 border-b border-[var(--border)] active:bg-[var(--bg-hover)] cursor-pointer transition-colors gap-3";
                                    d.onclick = () => App.ui.openDrawer(q.id);
                                    const badgeClass = i === 0 ? 'rank-1' : (i === 1 ? 'rank-2' : (i === 2 ? 'rank-3' : 'bg-slate-100 text-slate-500'));

                                    const safeQuestion = App.utils.escapeHTML(q.q || '');
                                    let fullAnswer = '';
                                    if (q.type === 'mcq' || q.type === 'multi') {
                                        let inlineAns = App.utils.escapeHTML(q.a);
                                        if (q.type === 'mcq') {
                                            const idx = q.a.charCodeAt(0) - 65;
                                            if (q.o && q.o[idx]) inlineAns = `${App.utils.escapeHTML(q.a)}. ${App.utils.escapeHTML(q.o[idx])}`;
                                        } else if (q.type === 'multi') {
                                            inlineAns = q.a.split('').map(c => {
                                                const idx = c.charCodeAt(0) - 65;
                                                return (q.o && q.o[idx]) ? `${App.utils.escapeHTML(c)}. ${App.utils.escapeHTML(q.o[idx])}` : App.utils.escapeHTML(c);
                                            }).join(' , ');
                                        }
                                        fullAnswer = `<div class="font-bold text-emerald-600 mb-1">答案：${inlineAns}</div>` + App.utils.getDetailedOptionHTML(q, q.a);
                                    } else if (q.type === 'fill') {
                                        fullAnswer = '<div class="font-bold text-emerald-600 mb-1">答案：' + App.utils.escapeHTML(q.a || '') + '</div>';
                                    } else {
                                        fullAnswer = q.a === 'T' ? '<span class="font-bold text-emerald-600">正确 (True)</span>' : '<span class="font-bold text-red-500">错误 (False)</span>';
                                    }

                                    d.innerHTML = `
                                        <div class="flex items-start gap-3 flex-grow min-w-0">
                                            <span class="w-5 h-5 flex-shrink-0 rounded-full flex items-center justify-center text-[11px] font-bold mt-0.5 ${badgeClass}">${i + 1}</span>
                                            <div class="flex flex-col min-w-0">
                                                <div class="text-xs font-medium text-[var(--text)] line-clamp-2 mb-2">${safeQuestion}</div>
                                                <div class="text-[11px] bg-slate-50 dark:bg-slate-800 p-2 rounded-lg border border-[var(--border)] text-[var(--sub)] shadow-sm">
                                                    ${fullAnswer}
                                                </div>
                                            </div>
                                        </div>
                                        <div class="text-xs font-bold text-red-500 flex-shrink-0 self-center bg-red-50 px-2 py-1 rounded ml-1">${q.count}次</div>`;
                                    ml.appendChild(d);
                                });
                            }
                        }
                        // 七日趋势直接取 getStats 已单遍聚合好的 daily30 后 7 天，
                        // 不再对整份 history 逐日 filter 7 遍
                        const h = App.data.getSafeHistory();   // 仅用于「有没有作答」的空态判断
                        if (h.length === 0) {
                            App.dom.show('chart-empty');
                        } else {
                            const pts = s.daily30.slice(-7).map(d => d.acc);
                            if (pts.every(p => p === null)) {
                                // 有历史但最近 7 天都没练：画布会是全空，显示「暂无数据」而不是空白
                                App.dom.show('chart-empty');
                            } else {
                                App.dom.hide('chart-empty');
                                requestAnimationFrame(() => App.chart.draw('dashboardChart', pts));
                            }
                        }
                    },

                // 数字滚动：只有数值真的变了才动画（轮询刷新数值不变时直接写），
                // 400ms ease-out 计数，让「正确率变化」被看见而不喧宾夺主
                // 每日目标进度卡（Quizlet/多邻国式）：今日已练 X / 目标 Y
                // 目标在「设置 → 偏好设置」里配置，0 = 不显示
                _renderDailyGoal(s) {
                    const host = document.getElementById('dash-goal-slot');
                    if (!host) return;
                    const goal = (window.App && App.prefs && typeof App.prefs.getGoal === 'function') ? App.prefs.getGoal() : 0;
                    if (!goal) { host.innerHTML = ''; return; }
                    const today = s.daily30 && s.daily30.length ? s.daily30[s.daily30.length - 1] : null;
                    const done = today ? today.attempts : 0;
                    const pct = Math.min(100, Math.round(done / goal * 100));
                    const reached = done >= goal;
                    const t = (x) => App.t(x);
                    host.innerHTML = `
                        <div class="bg-[var(--card)] border ${reached ? 'border-emerald-300 dark:border-emerald-700' : 'border-[var(--border)]'} rounded-2xl p-4">
                            <div class="flex items-center justify-between mb-2">
                                <div class="flex items-center gap-2">
                                    <span class="text-base">${reached ? '🎉' : '🎯'}</span>
                                    <span class="text-xs font-bold text-[var(--text)]">${t('今日目标')}</span>
                                </div>
                                <span class="text-[11px] ${reached ? 'text-emerald-500 font-bold' : 'text-[var(--sub)]'}">${reached ? t('已达成') : `${done} / ${goal}`}</span>
                            </div>
                            <div class="h-2.5 rounded-full bg-[var(--bg)] overflow-hidden">
                                <div class="h-full rounded-full ${reached ? 'bg-emerald-500' : 'bg-primary-500'} transition-all duration-500" style="width:${Math.max(3, pct)}%"></div>
                            </div>
                            <div class="text-[10px] text-[var(--sub)] mt-1.5">${t('今日已练')} ${done} / ${goal} ${t('题')}</div>
                        </div>`;
                },
                _animateNumber(id, target, suffix) {
                    const el = App.dom.get(id);
                    if (!el) return;
                    this._numCache = this._numCache || {};
                    const prevv = this._numCache ? this._numCache[id] : undefined;
                    this._numCache = this._numCache || {};
                    this._numCache[id] = target;
                    if (typeof prevv !== 'number' || prevv === target) {
                        App.dom.setText(id, target + suffix);
                        return;
                    }
                    const t0 = performance.now();
                    const dur = 400;
                    const step = (t) => {
                        const p = Math.min((t - t0) / dur, 1);
                        const eased = 1 - Math.pow(1 - p, 3);
                        App.dom.setText(id, Math.round(prevv + (target - prevv) * eased) + suffix);
                        if (p < 1) requestAnimationFrame(step);
                    };
                    requestAnimationFrame(step);
                }
};