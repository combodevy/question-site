export const profile = {
    _me: null,
    _meAt: 0,

    render() {
        const root = App.dom.get('profile-root');
        if (!root) return;
        // 未登录：显示引导卡，绝不渲染账户操作按钮（修改密码/注销等都无意义）
        if (!App.auth || !App.auth.session) {
            root.innerHTML = `<div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-10 text-center">
                <div class="text-3xl mb-3">🔐</div>
                <div class="text-sm font-bold text-[var(--text)] mb-1">请先登录</div>
                <div class="text-xs text-[var(--sub)]">登录后即可查看你的学习数据、趋势与成就。</div>
            </div>`;
            return;
        }
        const esc = App.utils.escapeHTML;
        const s = App.data.getStats();
        const hist = App.data.getSafeHistory();
        const starred = (App.data.starredIds || []).length;

        const session = App.auth && App.auth.session;
        const username = (session && session.user && session.user.username) || '用户';
        const uid = App.auth && App.auth.getUserId ? App.auth.getUserId() : '';
        const shortId = uid ? uid.slice(0, 8) : '';

        // 注册时间：优先用缓存的 /me 资料（缓存必须属于当前登录用户——
        // 否则登出换号登录后 5 分钟内会显示上一个账号的资料），没有先显示占位，异步补上
        const me = (this._me && this._meUid === uid && uid) ? this._me : null;
        let createdText = '…';
        if (me && me.createdAt) {
            const m = String(me.createdAt).match(/(\d{4})-(\d{2})-(\d{2})/);
            if (m) createdText = `${m[1]} 年 ${parseInt(m[2], 10)} 月 ${parseInt(m[3], 10)} 日`;
        }
        const payload = App.auth && App.auth.token ? App.auth.parseJwt(App.auth.token) : null;
        const isAdmin = (me && me.isAdmin) || (payload && payload.role === 'admin');

        // ===== 完美一日：全历史按本地日聚合，找单日 ≥20 且全对的记录 =====
        const dayAgg = new Map();
        hist.forEach(x => {
            const k = App.utils.localDayKey(x.t);
            const d = dayAgg.get(k) || { a: 0, c: 0 };
            d.a++;
            if (x.r) d.c++;
            dayAgg.set(k, d);
        });
        const perfectDay = [...dayAgg.values()].some(d => d.a >= 20 && d.c === d.a);
        const subjectTouched = Object.values(s.subjectStats).filter(v => v.attempts > 0).length;

        const achievements = [
            { e: '🌱', name: '初来乍到', cond: '注册账号', ok: true },
            { e: '✏️', name: '小试牛刀', cond: '完成第 1 次作答', ok: s.totalAttempts >= 1 },
            { e: '💯', name: '百题斩', cond: '累计作答 ≥ 100 次', ok: s.totalAttempts >= 100 },
            { e: '🏆', name: '千题斩', cond: '累计作答 ≥ 1000 次', ok: s.totalAttempts >= 1000 },
            { e: '🔥', name: '三日坚持', cond: '连续练习 ≥ 3 天', ok: s.streak >= 3 },
            { e: '📅', name: '七日之约', cond: '连续练习 ≥ 7 天', ok: s.streak >= 7 },
            { e: '🌙', name: '三十而立', cond: '连续练习 ≥ 30 天', ok: s.streak >= 30 },
            { e: '🎯', name: '神射手', cond: '≥50 次作答且正确率 ≥ 85%', ok: s.totalAttempts >= 50 && s.acc >= 85 },
            { e: '⚡', name: '完美一日', cond: '单日作答 ≥ 20 次且全部正确', ok: perfectDay },
            { e: '⭐', name: '收藏家', cond: '收藏 ≥ 10 题', ok: starred >= 10 },
            { e: '🏗️', name: '题库建筑师', cond: '题库 ≥ 50 题', ok: s.total >= 50 },
            { e: '🧭', name: '全科探索', cond: '在 ≥ 3 个科目作答过', ok: subjectTouched >= 3 }
        ];
        const unlocked = achievements.filter(a => a.ok).length;

        // ===== 30 天趋势（纯 div 柱状，无第三方库依赖）=====
        const maxDay = Math.max(1, ...s.daily30.map(d => d.attempts));
        const trendCols = s.daily30.map(d => {
            const hPct = Math.round(d.attempts / maxDay * 100);
            const cPct = d.attempts ? Math.round(d.correct / d.attempts * hPct) : 0;
            return `<div class="flex-1 min-w-0 flex flex-col justify-end items-center h-full" title="${esc(d.label)}：${d.attempts} 次（对 ${d.correct}）">
                <div class="w-full max-w-[10px] rounded-t bg-emerald-500" style="height:${cPct}%"></div>
                <div class="w-full max-w-[10px] rounded-b bg-primary-500/70 ${cPct ? '' : 'rounded-t'}" style="height:${Math.max(2, hPct - cPct)}%"></div>
            </div>`;
        }).join('');
        const trendTotal = s.daily30.reduce((t, d) => t + d.attempts, 0);

        // ===== 科目掌握 =====
        const subEntries = Object.entries(s.subjectStats).sort((a, b) => b[1].attempts - a[1].attempts);
        const subRows = subEntries.map(([sub, v]) => {
            const color = v.acc >= 80 ? 'bg-emerald-500' : (v.acc >= 60 ? 'bg-amber-500' : (v.attempts ? 'bg-red-500' : 'bg-slate-300'));
            return `<div class="space-y-1">
                <div class="flex items-center justify-between text-xs">
                    <span class="font-medium text-[var(--text)] truncate mr-2">${esc(sub)}</span>
                    <span class="text-[11px] text-[var(--sub)] flex-shrink-0">${v.attempts} 次 · ${v.attempts ? v.acc + '%' : '未作答'}</span>
                </div>
                <div class="h-2 rounded-full bg-[var(--bg)] overflow-hidden">
                    <div class="h-full rounded-full ${color} transition-all" style="width:${v.attempts ? Math.max(4, v.acc) : 0}%"></div>
                </div>
            </div>`;
        }).join('') || '<div class="text-xs text-[var(--sub)]">还没有科目数据。</div>';

        // ===== 最近动态（最近 10 条）=====
        const fmtTime = (t) => {
            const d = new Date(t);
            const p = (x) => String(x).padStart(2, '0');
            return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
        };
        const recent = hist.slice(-10).reverse().map(x => {
            const q = App.data.getQuestionById(x.id);
            const title = q ? (q.q || '').slice(0, 32) : '题目已删除';
            const loc = q ? `${q.sub} · ${q.chap}` : '—';
            const dur = x.d > 0 ? Math.round(x.d / 1000) + ' 秒' : '—';
            return `<div class="flex items-center gap-3 py-2 border-b border-[var(--border)] last:border-b-0">
                <span class="text-[11px] text-[var(--sub)] font-mono flex-shrink-0 w-24">${fmtTime(x.t)}</span>
                <div class="flex-1 min-w-0">
                    <div class="text-xs text-[var(--text)] truncate">${esc(title)}</div>
                    <div class="text-[10px] text-[var(--sub)] truncate">${esc(loc)}</div>
                </div>
                <span class="text-[11px] text-[var(--sub)] flex-shrink-0">${dur}</span>
                <span class="text-xs font-bold flex-shrink-0 ${x.r ? 'text-emerald-500' : 'text-red-500'}">${x.r ? '✓' : '✕'}</span>
            </div>`;
        }).join('') || `<div class="text-xs text-[var(--sub)]">还没有作答记录，去练习一轮吧。</div>`;

        // ===== 成就墙 =====
        const badgeHtml = achievements.map(a => `
            <div class="rounded-xl border p-3 text-center transition-colors ${a.ok
                ? 'border-primary-200 dark:border-primary-800 bg-primary-50/60 dark:bg-primary-900/20'
                : 'border-[var(--border)] bg-[var(--bg)] opacity-55'}">
                <div class="text-xl leading-none mb-1.5 ${a.ok ? '' : 'grayscale'}">${a.ok ? a.e : '🔒'}</div>
                <div class="text-[11px] font-bold text-[var(--text)]">${esc(a.name)}</div>
                <div class="text-[10px] text-[var(--sub)] mt-0.5 leading-tight">${esc(a.cond)}</div>
            </div>`).join('');

        const statCell = (label, value, cls) => `
            <div class="rounded-xl bg-[var(--card)] border border-[var(--border)] p-3.5 text-center">
                <div class="text-lg font-bold ${cls}">${value}</div>
                <div class="text-[11px] text-[var(--sub)] mt-0.5">${label}</div>
            </div>`;

        root.innerHTML = `
            <!-- 资料卡 -->
            <div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-5 flex items-center gap-4">
                <div class="w-14 h-14 rounded-full bg-gradient-to-br from-primary-500 to-primary-700 text-white flex items-center justify-center text-xl font-bold flex-shrink-0 shadow-lg">${esc((username[0] || '?').toUpperCase())}</div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                        <span class="text-lg font-bold text-[var(--text)] truncate">${esc(username)}</span>
                        ${isAdmin ? '<span class="text-[10px] font-bold text-purple-700 bg-purple-100 dark:text-purple-300 dark:bg-purple-900/40 px-1.5 py-0.5 rounded-full">管理员</span>' : ''}
                    </div>
                    <div class="text-[11px] text-[var(--sub)] mt-1">注册于 ${esc(createdText)} · ID <span class="font-mono">${esc(shortId)}</span><button id="pf-copy-id" class="ml-1 text-primary-600 hover:underline">复制</button></div>
                </div>
                <div class="flex-shrink-0 text-center rounded-xl bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-900 px-3 py-2">
                    <div class="text-base font-bold text-orange-500">🔥 ${s.streak}</div>
                    <div class="text-[10px] text-[var(--sub)]">连续天数</div>
                </div>
            </div>

            <!-- 核心统计 -->
            <div class="grid grid-cols-3 md:grid-cols-6 gap-3">
                ${statCell('题库总量', s.total, 'text-[var(--text)]')}
                ${statCell('累计作答', s.totalAttempts, 'text-primary-600')}
                ${statCell('总正确率', (s.totalAttempts ? s.acc + '%' : '—'), 'text-emerald-500')}
                ${statCell('收藏', starred, 'text-amber-500')}
                ${statCell('平均用时', s.avgDuration ? s.avgDuration + ' 秒' : '—', 'text-[var(--text)]')}
                ${statCell('成就', unlocked + '/' + achievements.length, 'text-purple-500')}
            </div>

            <!-- 30 天趋势 -->
            <div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-5">
                <div class="flex items-center justify-between mb-3">
                    <h3 class="font-bold text-sm text-[var(--text)]">近 30 天作答趋势</h3>
                    <span class="text-[11px] text-[var(--sub)]">共 ${trendTotal} 次</span>
                </div>
                <div class="flex items-end gap-[3px] h-28">${trendCols}</div>
            </div>

            <!-- 科目掌握 + 最近动态 -->
            <div class="grid md:grid-cols-2 gap-6">
                <div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-5">
                    <h3 class="font-bold text-sm text-[var(--text)] mb-3">科目掌握</h3>
                    <div class="space-y-3">${subRows}</div>
                </div>
                <div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-5">
                    <h3 class="font-bold text-sm text-[var(--text)] mb-1">最近动态</h3>
                    ${recent}
                </div>
            </div>

            <!-- 成就墙 -->
            <div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-5">
                <div class="flex items-center justify-between mb-3">
                    <h3 class="font-bold text-sm text-[var(--text)]">成就墙</h3>
                    <span class="text-[11px] text-[var(--sub)]">已点亮 ${unlocked} / ${achievements.length}</span>
                </div>
                <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">${badgeHtml}</div>
            </div>

            <!-- 账户操作 -->
            <div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-5">
                <h3 class="font-bold text-sm text-[var(--text)] mb-3">账户操作</h3>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <button onclick="App.ui.openPasswordModal()" class="px-3 py-2.5 rounded-xl border border-[var(--border)] text-xs font-bold text-[var(--text)] hover:bg-[var(--bg)] active:scale-95 transition-all">修改密码</button>
                    <button onclick="App.ui.exportAllBank()" class="px-3 py-2.5 rounded-xl border border-[var(--border)] text-xs font-bold text-[var(--text)] hover:bg-[var(--bg)] active:scale-95 transition-all">导出备份 JSON</button>
                    <button onclick="App.ui.openPrintExport()" class="px-3 py-2.5 rounded-xl border border-[var(--border)] text-xs font-bold text-[var(--text)] hover:bg-[var(--bg)] active:scale-95 transition-all">导出 PDF 打印版</button>
                    <button onclick="App.ui.handleAccountMenuAction('logout')" class="px-3 py-2.5 rounded-xl border border-[var(--border)] text-xs font-bold text-[var(--text)] hover:bg-[var(--bg)] active:scale-95 transition-all">退出登录</button>
                </div>
                <button onclick="App.ui._startAccountDeletion()" class="mt-3 w-full px-3 py-2.5 rounded-xl border border-red-200 dark:border-red-900 text-xs font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 active:scale-[0.98] transition-all">注销账号（删除全部数据）</button>
            </div>`;

        // 复制 ID
        const copyBtn = document.getElementById('pf-copy-id');
        if (copyBtn) {
            copyBtn.onclick = () => {
                const done = () => { copyBtn.textContent = '已复制'; setTimeout(() => { copyBtn.textContent = '复制'; }, 1500); };
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(uid).then(done).catch(() => {});
                } else {
                    try {
                        const ta = document.createElement('textarea');
                        ta.value = uid; document.body.appendChild(ta); ta.select();
                        document.execCommand('copy'); document.body.removeChild(ta); done();
                    } catch (e) { /* 剪贴板不可用时静默 */ }
                }
            };
        }

        // 异步补全注册时间（/me 5 分钟缓存）
        this._ensureMe().then(me2 => {
            if (!me2 || !me2.createdAt) return;
            const m = String(me2.createdAt).match(/(\d{4})-(\d{2})-(\d{2})/);
            const el = document.getElementById('pf-copy-id');
            if (m && el) {
                const line = el.parentElement;
                if (line) line.firstChild.textContent = `注册于 ${m[1]} 年 ${parseInt(m[2], 10)} 月 ${parseInt(m[3], 10)} 日 · ID `;
            }
        });
    },

    _ensureMe() {
        return new Promise(resolve => {
            const now = Date.now();
            const uid = App.auth && App.auth.getUserId ? App.auth.getUserId() : '';
            // 缓存按用户绑定：换号登录后旧缓存立即失效
            if (this._me && uid && this._meUid === uid && now - this._meAt < 5 * 60 * 1000) return resolve(this._me);
            if (!uid) return resolve(null);
            const token = App.auth && App.auth.token;
            if (!token || !App.apiBase) return resolve(null);
            fetch(App.apiBase + '/api/auth/me', { headers: { Authorization: 'Bearer ' + token } })
                .then(r => (r.ok ? r.json() : null))
                .then(b => {
                    if (b && b.ok && b.user) {
                        this._me = b.user;
                        this._meUid = uid;
                        this._meAt = Date.now();
                        resolve(b.user);
                    } else resolve(null);
                })
                .catch(() => resolve(null));
        });
    }
};
