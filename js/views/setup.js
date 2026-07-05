export const setup = {

                    render() {
                        App.dom.setValue('setup-type', 'all');
                        App.dom.setValue('setup-limit', '20');

                        const c = App.dom.get('setup-options');
                        if (!c) return;
                        c.innerHTML = '';
                        const subs = App.data.getSubjects();
                        if (subs.length === 0) {
                            c.innerHTML = '<div class="text-center text-[var(--sub)] mt-10">未检测到题库，请前往右上角设置导入题库 JSON 文件。</div>';
                            return;
                        }

                        subs.forEach(sub => {
                            const safeSub = App.utils.escapeHTML(sub);
                            const w = document.createElement('div'); w.className = "mb-4";
                            w.innerHTML = `<div class="font-bold text-primary-600 mb-2 px-1 text-sm">${safeSub}</div>`;
                            const g = document.createElement('div'); g.className = "grid grid-cols-2 gap-2";
                            App.data.getChapters(sub).forEach(chap => {
                                const safeChap = App.utils.escapeHTML(chap);
                                const l = document.createElement('label');
                                l.className = "flex items-center gap-2 p-3 border border-[var(--border)] rounded-xl cursor-pointer active:border-primary-500 transition-colors bg-[var(--card)] touch-manipulation";
                                l.innerHTML = `<input type="checkbox" class="setup-chk accent-primary-600 w-4 h-4" value="${sub}|${chap}" checked> <span class="text-xs font-medium truncate">${safeChap}</span>`;
                                g.appendChild(l);
                            });
                            w.appendChild(g); c.appendChild(w);
                        });
                    }
                
};