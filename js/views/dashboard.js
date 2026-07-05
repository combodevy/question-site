export const dashboard = {

                    render() {
                        const s = App.data.getStats();
                        App.dom.setText('dash-acc', s.acc + '%');
                        App.dom.setText('dash-total', s.total);
                        App.dom.setText('dash-err', s.mistakes);
                        App.dom.setText('last-practice-time', s.timeText);

                        const ml = App.dom.get('mistake-list');
                        if (ml) {
                            ml.innerHTML = '';
                            if (s.total === 0) {
                                ml.innerHTML = `<div class="p-6 text-center text-[var(--sub)] text-xs border border-dashed border-[var(--border)] rounded-xl m-4">请先导入题库 (Please import a question bank first).</div>`;
                            } else if (s.topMistakes.length === 0) {
                                ml.innerHTML = `<div class="p-6 text-center text-[var(--sub)] text-xs border border-dashed border-[var(--border)] rounded-xl m-4">暂无错题数据，太棒了！(No mistakes recorded yet!)</div>`;
                            } else {
                                s.topMistakes.forEach((q, i) => {
                                    const d = document.createElement('div');
                                    d.className = "flex items-start justify-between p-4 border-b border-[var(--border)] active:bg-[var(--bg-hover)] cursor-pointer transition-colors gap-3";
                                    d.onclick = () => App.ui.openDrawer(q.id);
                                    const badgeClass = i === 0 ? 'rank-1' : (i === 1 ? 'rank-2' : (i === 2 ? 'rank-3' : 'bg-slate-100 text-slate-500'));

                                    const safeQuestion = App.utils.escapeHTML(q.q || '');
                                    let fullAnswer = '';
                                    if (q.type === 'mcq' || q.type === 'multi') {
                                        let inlineAns = q.a;
                                        if (q.type === 'mcq') {
                                            const idx = q.a.charCodeAt(0) - 65;
                                            if (q.o && q.o[idx]) inlineAns = `${q.a}. ${App.utils.escapeHTML(q.o[idx])}`;
                                        } else if (q.type === 'multi') {
                                            inlineAns = q.a.split('').map(c => {
                                                const idx = c.charCodeAt(0) - 65;
                                                return (q.o && q.o[idx]) ? `${c}. ${App.utils.escapeHTML(q.o[idx])}` : c;
                                            }).join(' , ');
                                        }
                                        fullAnswer = `<div class="font-bold text-emerald-600 mb-1">答案：${inlineAns}</div>` + App.utils.getDetailedOptionHTML(q, q.a);
                                    } else {
                                        fullAnswer = q.a === 'T' ? '<span class="font-bold text-emerald-600">正确 (True)</span>' : '<span class="font-bold text-red-500">错误 (False)</span>';
                                    }

                                    d.innerHTML = `
                                        <div class="flex items-start gap-3 flex-grow min-w-0">
                                            <span class="w-5 h-5 flex-shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5 ${badgeClass}">${i + 1}</span>
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
                        const h = App.data.history;
                        if (h.length === 0) {
                            App.dom.show('chart-empty');
                        } else {
                            App.dom.hide('chart-empty');
                            const pts = [];
                            for (let i = 6; i >= 0; i--) {
                                const d = new Date(); d.setDate(d.getDate() - i);
                                const ds = d.toISOString().slice(0, 10);
                                const recs = h.filter(x => new Date(x.t).toISOString().slice(0, 10) === ds);
                                pts.push(recs.length ? Math.round((recs.filter(x => x.r).length / recs.length) * 100) : 0);
                            }
                            requestAnimationFrame(() => App.chart.draw('dashboardChart', pts));
                        }
                    }
                
};