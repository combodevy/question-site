export const analytics = {

                    currentMode: 'global',

                    setMode(mode) {
                        this.currentMode = mode === 'subject' ? 'subject' : 'global';
                        this.render();
                    },

                    hideQuestionPopover() {
                        const overlay = App.dom.get('an-q-popover-overlay');
                        const pop = App.dom.get('an-q-popover');
                        if (overlay) overlay.classList.add('hidden');
                        if (pop) {
                            pop.classList.add('hidden');
                            pop.innerHTML = '';
                        }
                    },

                    showQuestionPopover(id, avgSec, totalSec, attempts, el) {
                        const q = App.data.getQuestionById(id);
                        const overlay = App.dom.get('an-q-popover-overlay');
                        const pop = App.dom.get('an-q-popover');
                        if (!q || !pop || !overlay) return;

                        const subSelect = App.dom.get('an-subject-select');
                        const currentSub = subSelect ? subSelect.value : 'all';
                        const allHistory = App.data.history || [];
                        const scopedHistory = currentSub === 'all'
                            ? allHistory
                            : allHistory.filter(hEntry => {
                                const qq = App.data.getQuestionById(hEntry.id);
                                return qq && qq.sub === currentSub;
                            });
                        const records = scopedHistory.filter(hEntry => hEntry.id === id);
                        const attemptsReal = records.length || attempts || 0;
                        const wrong = records.filter(x => !x.r).length;
                        const correct = records.filter(x => x.r).length;
                        const errRate = attemptsReal ? Math.round(wrong / attemptsReal * 100) : 0;
                        const durRecords = records.filter(x => x.d > 0);
                        const totalMs = durRecords.reduce((sum, x) => sum + x.d, 0);
                        const avgSecReal = durRecords.length ? (totalMs / durRecords.length / 1000) : (avgSec || 0);
                        const totalSecReal = totalMs ? Math.round(totalMs / 1000) : (totalSec || 0);

                        const typeLabel = q.type === 'mcq' ? '单选题' : (q.type === 'multi' ? '多选题' : '判断题');
                        let bodyHtml = '';
                        if (q.type === 'tf') {
                            const isTrue = q.a === 'T';
                            const tfLabel = isTrue ? '√ (正确/True)' : '× (错误/False)';
                            bodyHtml = `<div class="text-[11px] text-[var(--sub)] mb-1">${tfLabel}</div>`;
                        } else {
                            const detailHtml = App.utils.getDetailedOptionHTML(q, q.a, '');
                            bodyHtml = `<div class="mt-1">${detailHtml}</div>`;
                        }

                        const avgText = attemptsReal ? `${Math.round(avgSecReal * 10) / 10} 秒/次` : '--';
                        const totalText = totalSecReal ? `${totalSecReal} 秒` : '--';

                        pop.innerHTML = `
                            <div id="an-q-arrow" class="absolute"></div>
                            <div class="flex items-center justify-between gap-2 mb-1 pr-3">
                                <div class="text-[10px] text-[var(--sub)] truncate max-w-[80%]">${App.utils.escapeHTML(q.sub || '')} • ${App.utils.escapeHTML(q.chap || '')} • ${typeLabel}</div>
                            </div>
                            <div class="text-[12px] font-medium text-[var(--text)] mb-1 leading-snug whitespace-pre-line">${App.utils.escapeHTML(q.q || '')}</div>
                            ${bodyHtml}
                            <div class="mt-2 pt-1 border-t border-[var(--border)] text-[10px] text-[var(--sub)] grid grid-cols-2 gap-y-0.5 gap-x-2">
                                <div>作答次数：<span class="font-bold text-[var(--text)]">${attemptsReal}</span></div>
                                <div>正确次数：<span class="font-bold text-[var(--text)]">${correct}</span></div>
                                <div>错误次数：<span class="font-bold text-[var(--text)]">${wrong}</span></div>
                                <div>错误率：<span class="font-bold text-[var(--text)]">${errRate}%</span></div>
                                <div>平均用时：<span class="font-bold text-[var(--text)]">${avgText}</span></div>
                                <div>总用时：<span class="font-bold text-[var(--text)]">${totalText}</span></div>
                            </div>
                        `;

                        overlay.classList.remove('hidden');
                        pop.classList.remove('hidden');

                        const anchorRect = el.getBoundingClientRect();
                        pop.style.left = '0px';
                        pop.style.top = '0px';
                        const popRect = pop.getBoundingClientRect();
                        const padding = 8;
                        const viewportWidth = window.innerWidth;
                        const viewportHeight = window.innerHeight;
                        const width = popRect.width;
                        const height = popRect.height;

                        let top = window.scrollY + anchorRect.bottom + 10;
                        let arrowPos = 'top';
                        if (top + height + padding > window.scrollY + viewportHeight) {
                            top = window.scrollY + anchorRect.top - height - 10;
                            if (top < window.scrollY + padding) {
                                top = window.scrollY + Math.max(padding, anchorRect.top + (anchorRect.height / 2) - height / 2);
                            }
                            arrowPos = 'bottom';
                        }

                        let left = anchorRect.left + anchorRect.width / 2 - width / 2;
                        left = Math.max(padding, Math.min(left, viewportWidth - width - padding));

                        pop.style.left = left + 'px';
                        pop.style.top = top + 'px';

                        const arrowContainer = document.getElementById('an-q-arrow');
                        if (arrowContainer) {
                            if (arrowPos === 'top') {
                                arrowContainer.innerHTML = '<div class="w-3 h-3 bg-[var(--card)] border-l border-t border-[var(--border)] rotate-45 absolute -top-1 left-1/2 -translate-x-1/2"></div>';
                            } else {
                                arrowContainer.innerHTML = '<div class="w-3 h-3 bg-[var(--card)] border-r border-b border-[var(--border)] rotate-45 absolute -bottom-1 left-1/2 -translate-x-1/2"></div>';
                            }
                        }
                    },

                    render() {
                        const s = App.data.getStats();

                        const tabGlobal = App.dom.get('an-tab-global');
                        const tabSubject = App.dom.get('an-tab-subject');
                        if (tabGlobal && tabSubject) {
                            const isSubject = this.currentMode === 'subject';
                            tabGlobal.classList.toggle('bg-[var(--card)]', !isSubject);
                            tabGlobal.classList.toggle('text-[var(--text)]', !isSubject);
                            tabGlobal.classList.toggle('bg-transparent', isSubject);
                            tabGlobal.classList.toggle('text-[var(--sub)]', isSubject);
                            tabSubject.classList.toggle('bg-[var(--card)]', isSubject);
                            tabSubject.classList.toggle('text-[var(--text)]', isSubject);
                            tabSubject.classList.toggle('bg-transparent', !isSubject);
                            tabSubject.classList.toggle('text-[var(--sub)]', !isSubject);
                        }

                        const globalBlocks = document.querySelectorAll('.an-global-block');
                        const subjectBlocks = document.querySelectorAll('.an-subject-block');
                        globalBlocks.forEach(el => el.classList.toggle('hidden', this.currentMode !== 'global'));
                        subjectBlocks.forEach(el => el.classList.toggle('hidden', this.currentMode !== 'subject'));

                        App.dom.setText('an-total-attempts', s.totalAttempts);
                        App.dom.setText('an-acc', s.acc + '%');
                        App.dom.setText('an-streak', s.streak + '天');
                        App.dom.setText('an-avg-dur', s.avgDuration != null ? s.avgDuration + '秒' : '--');

                        const subSelect = App.dom.get('an-subject-select');
                        const subs = Object.keys(s.subjectStats || {});
                        let currentSub = 'all';
                        if (subSelect) {
                            const prev = subSelect.value || 'all';
                            subSelect.innerHTML = '<option value="all">全部科目</option>' + subs.map(sub => {
                                const esc = App.utils.escapeHTML(sub);
                                return `<option value="${esc}">${esc}</option>`;
                            }).join('');
                            currentSub = subs.includes(prev) || prev === 'all' ? prev : 'all';
                            subSelect.value = currentSub;
                            subSelect.onchange = () => this.setMode('subject');
                        }

                        const filteredHistory = (currentSub === 'all')
                            ? App.data.history
                            : App.data.history.filter(hEntry => {
                                const q = App.data.getQuestionById(hEntry.id);
                                return q && q.sub === currentSub;
                            });

                        const labelEl = App.dom.get('an-subject-current-label');
                        if (labelEl) {
                            labelEl.textContent = currentSub === 'all' ? '当前视图：全部科目' : `当前视图：${currentSub}`;
                        }

                        if (this.currentMode === 'subject') {
                            const totalAttemptsSub = filteredHistory.length;
                            const totalCorrectSub = filteredHistory.filter(x => x.r).length;
                            const durRecordsSub = filteredHistory.filter(x => x.d > 0);
                            const totalDurMs = durRecordsSub.reduce((sum, x) => sum + x.d, 0);
                            const avgDurSub = durRecordsSub.length ? Math.round(totalDurMs / durRecordsSub.length / 1000) : null;

                            const qTimeMap = new Map();
                            filteredHistory.forEach(hEntry => {
                                const q = App.data.getQuestionById(hEntry.id);
                                if (!q) return;
                                let rec = qTimeMap.get(hEntry.id);
                                if (!rec) {
                                    rec = { q, attempts: 0, totalMs: 0 };
                                    qTimeMap.set(hEntry.id, rec);
                                }
                                rec.attempts++;
                                if (hEntry.d > 0) rec.totalMs += hEntry.d;
                            });
                            const qTimeList = Array.from(qTimeMap.values()).map(rec => {
                                const avgMs = rec.attempts ? rec.totalMs / rec.attempts : 0;
                                return { q: rec.q, attempts: rec.attempts, totalMs: rec.totalMs, avgMs };
                            }).filter(x => x.totalMs > 0).sort((a, b) => b.avgMs - a.avgMs).slice(0, 10);

                            const now = Date.now();
                            const buckets = [
                                { label: '今天', min: 0, max: 0, attempts: 0, correct: 0 },
                                { label: '1-3天', min: 1, max: 3, attempts: 0, correct: 0 },
                                { label: '4-7天', min: 4, max: 7, attempts: 0, correct: 0 },
                                { label: '8-14天', min: 8, max: 14, attempts: 0, correct: 0 },
                                { label: '>14天', min: 15, max: Infinity, attempts: 0, correct: 0 }
                            ];
                            filteredHistory.forEach(hEntry => {
                                const days = Math.floor((now - hEntry.t) / 86400000);
                                for (let i = 0; i < buckets.length; i++) {
                                    const b = buckets[i];
                                    if (days >= b.min && days <= b.max) {
                                        b.attempts++;
                                        if (hEntry.r) b.correct++;
                                        break;
                                    }
                                }
                            });

                            const distinctQCount = qTimeMap.size;
                            const subDetail = App.dom.get('an-subject-detail');
                            if (subDetail) {
                                if (!filteredHistory.length) {
                                    subDetail.innerHTML = `<div class="col-span-2 md:col-span-4 text-[11px] text-[var(--sub)]">当前科目暂无练习数据。</div>`;
                                } else {
                                    const totalSec = Math.round(totalDurMs / 1000);
                                    const totalMin = Math.floor(totalSec / 60);
                                    const totalSecRem = totalSec % 60;
                                    const totalTimeText = totalSec ? (totalMin ? `${totalMin}分${totalSecRem}秒` : `${totalSecRem}秒`) : '--';
                                    const accSub = totalAttemptsSub ? Math.round(totalCorrectSub / totalAttemptsSub * 100) : 0;
                                    const avgTimeText = avgDurSub != null ? `${avgDurSub}秒/题` : '--';
                                    subDetail.innerHTML = `
                                        <div>
                                            <div class="text-[10px] text-[var(--sub)]">当前科目作答次数</div>
                                            <div class="text-sm font-bold text-[var(--text)]">${totalAttemptsSub}</div>
                                        </div>
                                        <div>
                                            <div class="text-[10px] text-[var(--sub)]">当前科目正确率</div>
                                            <div class="text-sm font-bold text-emerald-600">${accSub}%</div>
                                        </div>
                                        <div>
                                            <div class="text-[10px] text-[var(--sub)]">累计作答总时长</div>
                                            <div class="text-sm font-bold text-[var(--text)]">${totalTimeText}</div>
                                        </div>
                                        <div>
                                            <div class="text-[10px] text-[var(--sub)]">平均单题用时</div>
                                            <div class="text-sm font-bold text-blue-500">${avgTimeText}</div>
                                        </div>
                                        <div>
                                            <div class="text-[10px] text-[var(--sub)]">涉及题目数量</div>
                                            <div class="text-sm font-bold text-[var(--text)]">${distinctQCount}</div>
                                        </div>
                                        <div>
                                            <div class="text-[10px] text-[var(--sub)]">最近活跃天数</div>
                                            <div class="text-sm font-bold text-[var(--text)]">${buckets.filter(b => b.attempts > 0).length}</div>
                                        </div>
                                    `;
                                }
                            }

                            const qTimeEl = App.dom.get('an-sub-qtime');
                            if (qTimeEl) {
                                if (!qTimeList.length) {
                                    qTimeEl.innerHTML = '<div class="text-[11px] text-[var(--sub)]">暂无充足数据，建议先多做几题。</div>';
                                } else {
                                    qTimeEl.innerHTML = qTimeList.map((item, idx) => {
                                        const avgSec = item.avgMs / 1000;
                                        const avgSecRounded = Math.round(avgSec * 10) / 10;
                                        const totalSec = Math.round(item.totalMs / 1000);
                                        const qText = App.utils.escapeHTML(item.q.q).slice(0, 40);
                                        return `
                                            <div class="flex flex-col gap-0.5 border-b border-[var(--border)] pb-1 last:border-b-0 cursor-pointer" onclick="App.views.analytics.showQuestionPopover('${item.q.id}', ${avgSecRounded}, ${totalSec}, ${item.attempts}, this)">
                                                <div class="flex items-center justify-between">
                                                    <span class="text-[10px] text-[var(--sub)]">#${idx + 1}</span>
                                                    <span class="text-[10px] text-[var(--sub)]">${item.attempts} 次</span>
                                                </div>
                                                <div class="text-[11px] text-[var(--text)]">${qText}${item.q.q.length > 40 ? '…' : ''}</div>
                                                <div class="flex items-center justify-between text-[10px] text-[var(--sub)]">
                                                    <span>平均用时约 ${avgSecRounded} 秒，总用时 ${totalSec} 秒</span>
                                                </div>
                                            </div>
                                        `;
                                    }).join('');
                                }
                            }

                            const forgetEl = App.dom.get('an-sub-forget');
                            if (forgetEl) {
                                if (!filteredHistory.length) {
                                    forgetEl.innerHTML = '<div class="text-[11px] text-[var(--sub)]">暂无数据，无法估计遗忘趋势。</div>';
                                } else {
                                    forgetEl.innerHTML = buckets.map(b => {
                                        const acc = b.attempts ? Math.round(b.correct / b.attempts * 100) : 0;
                                        return `
                                            <div class="flex items-center gap-2">
                                                <div class="w-20 text-[10px] text-[var(--sub)]">${b.label}</div>
                                                <div class="flex-1 h-2 rounded-full bg-[var(--border)] overflow-hidden">
                                                    <div class="h-2 bg-emerald-500" style="width:${acc}%;"></div>
                                                </div>
                                                <div class="w-16 text-right text-[10px] text-[var(--sub)]">${b.attempts} 次 / ${acc}%</div>
                                            </div>
                                        `;
                                    }).join('');
                                }
                            }

                            const dailyAccSub = [];
                            for (let i = 29; i >= 0; i--) {
                                const d = new Date(); d.setDate(d.getDate() - i);
                                const ds = d.toISOString().slice(0, 10);
                                const recs = filteredHistory.filter(x => new Date(x.t).toISOString().slice(0, 10) === ds);
                                if (!recs.length) {
                                    dailyAccSub.push(0);
                                } else {
                                    const c = recs.filter(x => x.r).length;
                                    dailyAccSub.push(Math.round(c / recs.length * 100));
                                }
                            }
                            requestAnimationFrame(() => App.chart.draw('anSubForgetChart', dailyAccSub));

                            const cvs = App.dom.get('anSubForgetChart');
                            if (!filteredHistory.length && cvs && cvs.getContext) {
                                const ctx = cvs.getContext('2d');
                                ctx && ctx.clearRect(0, 0, cvs.width, cvs.height);
                            }
                        }

                        requestAnimationFrame(() => App.chart.drawHeatmap('heatmapChart', s.daily30));

                        const subEntries = Object.entries(s.subjectStats).filter(([, v]) => v.attempts > 0);
                        if (subEntries.length > 0) {
                            const labels = subEntries.map(([k]) => k);
                            const values = subEntries.map(([, v]) => v.acc);
                            const colors = ['#0d9488', '#0891b2', '#7c3aed', '#db2777', '#ea580c', '#65a30d'].slice(0, labels.length);
                            requestAnimationFrame(() => App.chart.drawBar('subjectChart', labels, values, colors));
                        }

                        const typeLabels = ['单选题', '多选题', '判断题'];
                        const typeKeys = ['mcq', 'multi', 'tf'];
                        const typeValues = typeKeys.map(k => s.typeStats[k] ? s.typeStats[k].acc : 0);
                        const typeColors = ['#0d9488', '#7c3aed', '#f59e0b'];
                        requestAnimationFrame(() => App.chart.drawBar('typeChart', typeLabels, typeValues, typeColors));

                        const durLabels = ['<5秒', '5-15秒', '15-30秒', '30-60秒', '>60秒'];
                        const durColors = ['#10b981', '#0d9488', '#0891b2', '#7c3aed', '#ef4444'];
                        requestAnimationFrame(() => App.chart.drawDonut('durChart', s.durBuckets, durLabels, durColors));

                        const legend = App.dom.get('dur-legend');
                        if (legend) {
                            legend.innerHTML = durLabels.map((l, i) => `
                                <div class="flex items-center gap-1.5">
                                    <div class="w-2.5 h-2.5 rounded-sm flex-shrink-0" style="background:${durColors[i]}"></div>
                                    <span class="text-[var(--sub)]">${l}</span>
                                    <span class="font-bold ml-auto">${s.durBuckets[i]}</span>
                                </div>`).join('');
                        }

                        const summary = App.dom.get('an-sub-summary');
                        if (summary) {
                            summary.innerHTML = '';
                            if (s.bestSub) {
                                summary.innerHTML += `
                                    <div class="flex items-center justify-between p-3 bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-900/30 rounded-xl">
                                        <div class="flex items-center gap-3">
                                            <span class="text-xl">🏆</span>
                                            <div><div class="text-[10px] font-bold text-green-700 dark:text-green-500 uppercase tracking-wide">最强科目</div><div class="text-xs text-[var(--text)] font-medium">${s.bestSub}</div></div>
                                        </div>
                                        <span class="font-bold text-lg text-green-600 dark:text-green-400">${s.subjectStats[s.bestSub].acc}%</span>
                                    </div>`;
                            }
                            if (s.worstSub && s.worstSub !== s.bestSub) {
                                summary.innerHTML += `
                                    <div class="flex items-center justify-between p-3 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 rounded-xl mt-3">
                                        <div class="flex items-center gap-3">
                                            <span class="text-xl">📌</span>
                                            <div><div class="text-[10px] font-bold text-red-600 dark:text-red-500 uppercase tracking-wide">需加强</div><div class="text-xs text-[var(--text)] font-medium">${s.worstSub}</div></div>
                                        </div>
                                        <span class="font-bold text-lg text-red-500 dark:text-red-400">${s.subjectStats[s.worstSub].acc}%</span>
                                    </div>`;
                            }
                            if (!s.bestSub && !s.worstSub) {
                                summary.innerHTML = `<div class="text-xs text-[var(--sub)] p-4 text-center border border-dashed border-[var(--border)] rounded-xl">暂无足够的练习数据进行分析</div>`;
                            }
                        }
                    }
                }
            
};