        const App = {
            apiBase: window.API_BASE || '',
            dom: {
                get(id) {
                    const el = document.getElementById(id);
                    if (!el) console.warn(`[DOM Warning] Element #${id} not found.`);
                    return el;
                },
                setText(id, text) {
                    const el = this.get(id);
                    if (el) el.innerText = text;
                },
                setHTML(id, html) {
                    const el = this.get(id);
                    if (el) el.innerHTML = html;
                },
                show(id) {
                    const el = this.get(id);
                    if (el) el.classList.remove('hidden');
                },
                hide(id) {
                    const el = this.get(id);
                    if (el) el.classList.add('hidden');
                },
                getValue(id, fallback = null) {
                    const el = this.get(id);
                    return el ? el.value : fallback;
                },
                setValue(id, val) {
                    const el = this.get(id);
                    if (el) el.value = val;
                }
            },

            utils: {
                toPinyinStr(text) {
                    if (!text || typeof pinyinPro === 'undefined') return text ? String(text).toLowerCase() : '';
                    return pinyinPro.pinyin(text, { toneType: 'none', separator: '' }).toLowerCase();
                },
                shuffle(array) {
                    const arr = [...array];
                    let currentIndex = arr.length, randomIndex;
                    while (currentIndex != 0) {
                        randomIndex = Math.floor(Math.random() * currentIndex);
                        currentIndex--;
                        [arr[currentIndex], arr[randomIndex]] = [arr[randomIndex], arr[currentIndex]];
                    }
                    return arr;
                },
                escapeHTML(text) {
                    if (text == null) return '';
                    return String(text).replace(/[&<>"']/g, function (m) {
                        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m] || m;
                    });
                },
                highlightByPinyin(text, pinyinQuery) {
                    if (!pinyinQuery || typeof text !== 'string' || typeof pinyinPro === 'undefined') return text;

                    const charPinyinPairs = [];
                    for (let i = 0; i < text.length; i++) {
                        const char = text[i];
                        if (/[\u4e00-\u9fff]/.test(char)) {
                            charPinyinPairs.push({
                                char,
                                py: pinyinPro.pinyin(char, { toneType: 'none', type: 'string' }).replace(/\s/g, '').toLowerCase()
                            });
                        } else {
                            charPinyinPairs.push({ char, py: char.toLowerCase() });
                        }
                    }

                    const markRanges = [];

                    for (let i = 0; i < charPinyinPairs.length; i++) {
                        let combined = '';
                        for (let j = i; j < charPinyinPairs.length; j++) {
                            combined += charPinyinPairs[j].py;

                            if (combined === pinyinQuery) {
                                markRanges.push([i, j]);
                                break;
                            }

                            if (combined.length > pinyinQuery.length) {
                                const withoutLast = combined.slice(0, combined.length - charPinyinPairs[j].py.length);
                                const remaining = pinyinQuery.slice(withoutLast.length);

                                if (withoutLast === pinyinQuery.slice(0, withoutLast.length)
                                    && charPinyinPairs[j].py.startsWith(remaining)) {
                                    markRanges.push([i, j]);
                                }
                                break;
                            }

                            if (!pinyinQuery.startsWith(combined)) break;
                        }
                    }

                    if (markRanges.length === 0) return text;
                    markRanges.sort((a, b) => a[0] - b[0]);
                    const mergedRanges = [];
                    markRanges.forEach(r => {
                        if (!mergedRanges.length || r[0] > mergedRanges[mergedRanges.length - 1][1] + 1) {
                            mergedRanges.push([r[0], r[1]]);
                        } else {
                            mergedRanges[mergedRanges.length - 1][1] = Math.max(mergedRanges[mergedRanges.length - 1][1], r[1]);
                        }
                    });

                    const markedIndices = new Set();
                    mergedRanges.forEach(([s, e]) => {
                        for (let i = s; i <= e; i++) markedIndices.add(i);
                    });

                    let result = '';
                    let inMark = false;
                    charPinyinPairs.forEach(({ char }, i) => {
                        if (markedIndices.has(i) && !inMark) {
                            result += '<mark class="bg-yellow-200 dark:bg-yellow-700/50 rounded px-0.5 text-inherit">';
                            inMark = true;
                        }
                        if (!markedIndices.has(i) && inMark) {
                            result += '</mark>';
                            inMark = false;
                        }
                        result += char;
                    });
                    if (inMark) result += '</mark>';

                    return result;
                },
                highlight(text, query) {
                    if (typeof text !== 'string') return text;
                    if (!query) return this.escapeHTML(text);

                    const isPinyinQuery = /^[a-z0-9]+$/i.test(query);
                    if (isPinyinQuery && typeof pinyinPro !== 'undefined') {
                        const pinyinResult = App.utils.highlightByPinyin(text, query.toLowerCase());
                        if (pinyinResult !== text) {
                            const placeholderOpen = '__MARK_OPEN__';
                            const placeholderClose = '__MARK_CLOSE__';
                            const tmp = pinyinResult
                                .replace(/<mark[^>]*>/g, placeholderOpen)
                                .replace(/<\/mark>/g, placeholderClose);
                            const escaped = this.escapeHTML(tmp);
                            return escaped
                                .replace(new RegExp(placeholderOpen, 'g'), '<mark class="bg-yellow-200 dark:bg-yellow-700/50 rounded px-0.5 text-inherit">')
                                .replace(new RegExp(placeholderClose, 'g'), '</mark>');
                        }
                    }

                    const escapedText = this.escapeHTML(text);
                    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const reg = new RegExp(`(${escapedQuery})`, 'gi');
                    return escapedText.replace(reg, '<mark class="bg-yellow-200 dark:bg-yellow-700/50 rounded px-0.5 text-inherit">$1</mark>');
                },
                getDetailedOptionHTML(q, charStr, searchQuery = '') {
                    if (!q.o || !Array.isArray(q.o)) return '<span class="text-red-500 text-xs">选项数据缺失 (Data Missing)</span>';

                    const texts = q.o.map((optText, idx) => {
                        const char = String.fromCharCode(65 + idx);
                        const isCorrect = (charStr || '').includes(char);
                        const hlOptText = App.utils.highlight(optText, searchQuery);

                        if (isCorrect) {
                            return `<div class="mt-1 py-1 px-2 rounded bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 font-bold flex items-start gap-1.5 text-xs transition-colors">
                                        <span class="flex-shrink-0">✅</span>
                                        <span class="leading-snug">${char}. ${hlOptText}</span>
                                    </div>`;
                        } else {
                            return `<div class="mt-1 py-1 px-2 rounded text-[var(--sub)] flex items-start gap-1.5 text-xs opacity-75 transition-colors">
                                        <span class="flex-shrink-0 text-rose-400 opacity-80">❌</span>
                                        <span class="leading-snug">${char}. ${hlOptText}</span>
                                    </div>`;
                        }
                    });
                    return `<div class="mt-1.5 flex flex-col">${texts.join('')}</div>`;
                },
                editDistance(a, b) {
                    const m = a.length, n = b.length;
                    const dp = Array.from({ length: m + 1 }, (_, i) =>
                        Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
                    );
                    for (let i = 1; i <= m; i++) {
                        for (let j = 1; j <= n; j++) {
                            dp[i][j] = a[i - 1] === b[j - 1]
                                ? dp[i - 1][j - 1]
                                : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
                        }
                    }
                    return dp[m][n];
                },
                fuzzyMatch(text, query) {
                    if (!query || query.length < 2) return false;
                    const tolerance = Math.floor(query.length / 4) + 1;

                    for (let i = 0; i <= text.length - query.length + tolerance; i++) {
                        const sub = text.substring(i, i + query.length);
                        if (this.editDistance(sub, query) <= tolerance) return true;
                    }
                    return false;
                },

                // 归一化题干文本：去除空白与常见标点并转小写，便于相似度计算
                normalizeQuestionText(text) {
                    if (!text) return '';
                    return String(text)
                        .toLowerCase()
                        .replace(/[\s\u3000]/g, '')
                        .replace(/[，。,\.、；;！!？?\(\)\[\]【】'"“”‘’]/g, '');
                },

                // 简单相似度：1 - (编辑距离 / 最大长度)，范围 [0,1]
                similarity(a, b) {
                    if (!a && !b) return 1;
                    if (!a || !b) return 0;
                    const maxLen = Math.max(a.length, b.length);
                    if (!maxLen) return 1;
                    const dist = this.editDistance(a, b);
                    return 1 - dist / maxLen;
                }
            },

            chart: {
                draw(canvasId, dataPoints) {
                    const cvs = App.dom.get(canvasId);
                    if (!cvs || !cvs.parentElement) return;

                    const ctx = cvs.getContext('2d');
                    if (!ctx) return;

                    const parent = cvs.parentElement;
                    if (parent.clientWidth === 0 || parent.clientHeight === 0) {
                        if (!cvs.dataset.pendingDraw) {
                            cvs.dataset.pendingDraw = '1';
                            requestAnimationFrame(() => {
                                delete cvs.dataset.pendingDraw;
                                App.chart.draw(canvasId, dataPoints);
                            });
                        }
                        return;
                    }
                    cvs.width = parent.clientWidth;
                    cvs.height = parent.clientHeight;
                    const w = cvs.width, h = cvs.height;
                    const pad = 10;

                    ctx.clearRect(0, 0, w, h);

                    if (!dataPoints || dataPoints.length === 0) return;
                    if (dataPoints.length === 1) {
                        ctx.fillStyle = '#64748b'; ctx.font = '10px Inter'; ctx.textAlign = 'center';
                        ctx.fillText(dataPoints[0] + '%', w / 2, h / 2);
                        return;
                    }

                    ctx.strokeStyle = '#0d9488'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
                    ctx.beginPath();
                    const step = (w - pad * 2) / (dataPoints.length - 1);

                    dataPoints.forEach((val, i) => {
                        const x = pad + i * step;
                        const y = h - pad - (val / 100 * (h - pad * 2));
                        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                        ctx.fillStyle = '#64748b'; ctx.font = '10px Inter'; ctx.textAlign = 'center';
                        ctx.fillText(val + '%', x, y - 8);
                    });
                    ctx.stroke();

                    const grad = ctx.createLinearGradient(0, 0, 0, h);
                    grad.addColorStop(0, 'rgba(13, 148, 136, 0.2)');
                    grad.addColorStop(1, 'rgba(13, 148, 136, 0)');
                    ctx.fillStyle = grad;
                    ctx.lineTo(pad + (dataPoints.length - 1) * step, h);
                    ctx.lineTo(pad, h);
                    ctx.fill();
                },

                drawBar(canvasId, labels, values, colors) {
                    const cvs = App.dom.get(canvasId);
                    if (!cvs) return;
                    const ctx = cvs.getContext('2d');
                    const parent = cvs.parentElement;
                    if (!parent || parent.clientWidth === 0) {
                        if (!cvs.dataset.pendingDrawBar) {
                            cvs.dataset.pendingDrawBar = '1';
                            requestAnimationFrame(() => {
                                delete cvs.dataset.pendingDrawBar;
                                App.chart.drawBar(canvasId, labels, values, colors);
                            });
                        }
                        return;
                    }
                    cvs.width = parent.clientWidth;
                    cvs.height = Math.max(labels.length * 36 + 20, 100);
                    const w = cvs.width, barH = 20, padL = 60, padR = 40;

                    ctx.clearRect(0, 0, w, cvs.height);

                    labels.forEach((label, i) => {
                        const y = 10 + i * 36;
                        const val = values[i] || 0;
                        const barW = (val / 100) * (w - padL - padR);

                        ctx.fillStyle = 'rgba(148,163,184,0.15)';
                        ctx.beginPath();
                        ctx.roundRect(padL, y, w - padL - padR, barH, 6);
                        ctx.fill();

                        if (barW > 0) {
                            ctx.fillStyle = colors[i] || '#0d9488';
                            ctx.beginPath();
                            ctx.roundRect(padL, y, barW, barH, 6);
                            ctx.fill();
                        }

                        ctx.fillStyle = '#64748b';
                        ctx.font = '11px Inter';
                        ctx.textAlign = 'right';
                        ctx.fillText(label.slice(0, 5), padL - 8, y + 14);

                        ctx.textAlign = 'left';
                        const isDarkMode = document.documentElement.classList.contains('dark');
                        ctx.fillStyle = isDarkMode ? '#f8fafc' : '#0f172a';
                        ctx.font = 'bold 11px Inter';
                        ctx.fillText(val + '%', padL + barW + 8, y + 14);
                    });
                },

                drawDonut(canvasId, values, labels, colors) {
                    const cvs = App.dom.get(canvasId);
                    if (!cvs) return;
                    const ctx = cvs.getContext('2d');
                    const size = Math.min(cvs.parentElement.clientWidth, 160);
                    cvs.width = size; cvs.height = size;
                    const cx = size / 2, cy = size / 2, r = size / 2 - 12, innerR = r * 0.58;
                    const total = values.reduce((a, b) => a + b, 0);
                    if (total === 0) return;

                    let startAngle = -Math.PI / 2;
                    values.forEach((v, i) => {
                        if (v === 0) return;
                        const slice = (v / total) * 2 * Math.PI;
                        ctx.beginPath();
                        ctx.moveTo(cx, cy);
                        ctx.arc(cx, cy, r, startAngle, startAngle + slice);
                        ctx.closePath();
                        ctx.fillStyle = colors[i];
                        ctx.fill();
                        startAngle += slice;
                    });

                    ctx.beginPath();
                    ctx.arc(cx, cy, innerR, 0, 2 * Math.PI);
                    const isDarkMode = document.documentElement.classList.contains('dark');
                    ctx.fillStyle = isDarkMode ? '#1e293b' : '#ffffff';
                    ctx.fill();

                    ctx.fillStyle = '#64748b';
                    ctx.font = `bold ${Math.round(size / 8)}px Inter`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(total + '次', cx, cy);
                },

                drawHeatmap(canvasId, daily30) {
                    const cvs = App.dom.get(canvasId);
                    if (!cvs) return;
                    const ctx = cvs.getContext('2d');
                    const parent = cvs.parentElement;
                    cvs.width = parent.clientWidth;
                    const cellW = Math.floor((cvs.width - 10) / 30);
                    cvs.height = cellW + 24;

                    ctx.clearRect(0, 0, cvs.width, cvs.height);

                    daily30.forEach((day, i) => {
                        const x = 5 + i * cellW;
                        const hasData = day.attempts > 0;
                        const intensity = hasData ? Math.min(day.attempts / 20, 1) : 0;

                        if (!hasData) {
                            ctx.fillStyle = document.documentElement.classList.contains('dark') ? 'rgba(51,65,85,0.4)' : 'rgba(148,163,184,0.2)';
                        } else {
                            const g = Math.round(148 - intensity * 60);
                            ctx.fillStyle = `rgba(13, ${g + 80}, 136, ${0.3 + intensity * 0.7})`;
                        }
                        ctx.beginPath();
                        ctx.roundRect(x, 4, cellW - 2, cellW - 2, 3);
                        ctx.fill();

                        if (i % 7 === 0 || i === 29) {
                            ctx.fillStyle = '#94a3b8';
                            ctx.font = '9px Inter';
                            ctx.textAlign = 'center';
                            ctx.fillText(day.label, x + cellW / 2, cvs.height - 4);
                        }
                    });
                }
            },

            auth: {
                token: null,
                session: null,
                init() {
                    this.token = localStorage.getItem('qs-auth-token') || null;
                    if (this.token) {
                        const payload = this.parseJwt(this.token);
                        if (payload) {
                            this.session = {
                                access_token: this.token,
                                user: {
                                    id: payload.sub,
                                    email: `${payload.username}@user.local`,
                                    username: payload.username
                                }
                            };
                        } else {
                            this.token = null;
                            localStorage.removeItem('qs-auth-token');
                        }
                    }
                    this.applyAuthState();
                },
                parseJwt(token) {
                    if (!token) return null;
                    try {
                        const base64Url = token.split('.')[1];
                        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
                        const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
                            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
                        }).join(''));
                        return JSON.parse(jsonPayload);
                    } catch (e) {
                        return null;
                    }
                },
                async getToken() {
                    return this.token;
                },
                getUserId() {
                    return this.session && this.session.user ? this.session.user.id : '';
                },
                async login(loginId, password) {
                    const username = (loginId || '').trim();
                    if (!username) return { error: { message: '用户名不能为空' } };
                    
                    try {
                        const res = await fetch((App.apiBase || '') + '/api/auth/login', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ username, password })
                        });
                        const data = await res.json();
                        if (!res.ok) {
                            return { error: { message: data.error || '登录失败' } };
                        }
                        this.token = data.token;
                        localStorage.setItem('qs-auth-token', this.token);
                        const payload = this.parseJwt(this.token);
                        this.session = {
                            access_token: this.token,
                            user: {
                                id: payload.sub,
                                email: `${payload.username}@user.local`,
                                username: payload.username
                            }
                        };
                        this.applyAuthState();
                        return { data: this.session };
                    } catch (err) {
                        return { error: { message: err.message || '网络连接失败' } };
                    }
                },
                async signup(loginId, password) {
                    const username = (loginId || '').trim();
                    if (!username) return { error: { message: '用户名不能为空' } };
                    if (username.includes('@')) return { error: { message: '用户名不能包含 @ 符号' } };
                    
                    try {
                        const res = await fetch((App.apiBase || '') + '/api/auth/signup', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ username, password })
                        });
                        const data = await res.json();
                        if (!res.ok) {
                            return { error: { message: data.error || '注册失败' } };
                        }
                        this.token = data.token;
                        localStorage.setItem('qs-auth-token', this.token);
                        const payload = this.parseJwt(this.token);
                        this.session = {
                            access_token: this.token,
                            user: {
                                id: payload.sub,
                                email: `${payload.username}@user.local`,
                                username: payload.username
                            }
                        };
                        this.applyAuthState();
                        return { data: this.session };
                    } catch (err) {
                        return { error: { message: err.message || '网络连接失败' } };
                    }
                },
                async logout() {
                    this.token = null;
                    this.session = null;
                    localStorage.removeItem('qs-auth-token');
                    this.applyAuthState();
                },
                applyAuthState() {
                    const btn = document.getElementById("auth-btn");
                    const icon = document.getElementById("auth-icon");
                    const overlay = document.getElementById("auth-overlay");
                    if (!btn || !icon) return;
                    btn.classList.remove(
                        "bg-primary-600",
                        "text-white",
                        "border-emerald-400",
                        "bg-emerald-50",
                        "text-emerald-700",
                        "shadow",
                        "shadow-emerald-200"
                    );
                    btn.classList.add("border", "border-[var(--border)]", "bg-[var(--card)]", "text-[var(--sub)]");
                    if (this.session) {
                        btn.title = "退出登录";
                        btn.classList.remove("border-[var(--border)]", "bg-[var(--card)]", "text-[var(--sub)]");
                        btn.classList.add(
                            "border-emerald-400",
                            "bg-emerald-50",
                            "text-emerald-700",
                            "shadow",
                            "shadow-emerald-200"
                        );
                        if (overlay) {
                            overlay.classList.add("hidden");
                            overlay.classList.add("opacity-0", "pointer-events-none");
                        }
                        if (window.App && App.data && typeof App.data.loadFromCloud === "function") {
                            App.data._syncReady = false;
                            App.data.loadFromCloud();
                        }
                        if (window.App && App.sync && typeof App.sync.startAutoPull === "function") {
                            App.sync.startAutoPull();
                        }
                        if (window.App && App.realtime && typeof App.realtime.setup === "function") {
                            const token = this.session.access_token;
                            const uid = this.getUserId();
                            App.realtime.setup(uid, token);
                        }
                    } else {
                        btn.title = "登录";
                        if (overlay) {
                            overlay.classList.remove("hidden", "opacity-0", "pointer-events-none");
                        }
                        if (window.App && App.data && typeof App.data.clearAllForLogout === "function") {
                            App.data.clearAllForLogout();
                        }
                        if (window.App && App.sync && typeof App.sync.stopAutoPull === "function") {
                            App.sync.stopAutoPull();
                        }
                        if (window.App && App.realtime && typeof App.realtime.teardown === "function") {
                            App.realtime.teardown();
                        }
                    }
                }
            },

            data: {
                // 历史记录和题库存储 Key
                historyKey: 'lms_v26_history',
                bankKey: 'lms_v26_bank',
                // 回收站存储 Key
                trashKey: 'lms_v26_trash',
                bankNameKey: 'lms_v26_bank_name',

                // 刷题历史
                history: [],
                lastPracticeTime: null,

                // 题库结构：{ [subject]: { [chapter]: Question[] } }
                bank: {},
                bankName: '',
                // 回收站结构：与 bank 相同，但题目对象附带删除元信息
                trash: {},
                hiddenMistakeIds: [],

                // 运行时缓存
                _cachedQuestions: null,
                _questionMap: null,
                _errFreqCache: null,
                _isHistoryDirty: true,
                _suppressCloudSync: false,
                _lastSyncedCounts: null,
                _cloudSaveTimer: null,
                _lastSyncedQuestionIds: null,
                _bankDirty: false,
                _syncReady: false,
                _cloudLoading: false,
                _pendingSaveState: null,
                _deferredSave: false,
                remoteVersion: 0,
                // ========== 增量同步 (Incremental Sync) ==========
                _historyAppendBuffer: [],    // 自上次同步以来新增的 history 条目
                _lastHistoryTimestamp: 0,     // 上次同步时的最新 history 时间戳
                _lastEtag: null,             // 上次 load 返回的 ETag

                init() {
                    try {
                        const hStr = localStorage.getItem(this.historyKey);
                        if (hStr) {
                            const parsed = JSON.parse(hStr);
                            if (parsed && Array.isArray(parsed.history)) {
                                this.history = parsed.history.filter(h =>
                                    h && typeof h.id === 'string' && typeof h.r === 'boolean' && typeof h.t === 'number'
                                );
                            } else {
                                this.history = [];
                            }
                            this.lastPracticeTime = typeof parsed.lastPracticeTime === 'number' ? parsed.lastPracticeTime : null;
                            if (parsed && Array.isArray(parsed.hiddenMistakeIds)) {
                                this.hiddenMistakeIds = parsed.hiddenMistakeIds;
                            } else {
                                this.hiddenMistakeIds = [];
                            }
                        }
                    } catch (e) { console.error("History parse error", e); }

                    try {
                        const bStr = localStorage.getItem(this.bankKey);
                        if (bStr) {
                            const parsed = JSON.parse(bStr);
                            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                                this.bank = parsed;
                            } else {
                                this.bank = {};
                            }
                            if (window.App && App.ai && typeof App.ai.sanitizeImportedBank === 'function') {
                                const sanitized = App.ai.sanitizeImportedBank(this.bank);
                                const before = JSON.stringify(this.bank);
                                const after = JSON.stringify(sanitized);
                                if (before !== after) {
                                    this.bank = sanitized;
                                    this._safeSetItem(this.bankKey, after);
                                }
                            }
                        }
                    } catch (e) { console.error("Bank parse error", e); }
                    try {
                        const nStr = localStorage.getItem(this.bankNameKey);
                        if (nStr && typeof nStr === 'string') {
                            this.bankName = nStr;
                        }
                    } catch (e) { }

                    // 加载回收站
                    try {
                        const tStr = localStorage.getItem(this.trashKey);
                        if (tStr) {
                            const parsed = JSON.parse(tStr);
                            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                                this.trash = parsed;
                            } else {
                                this.trash = {};
                            }
                        }
                    } catch (e) { console.error("Trash parse error", e); }
                },

                _safeSetItem(key, value) {
                    try {
                        localStorage.setItem(key, value);
                        return true;
                    } catch (e) {
                        if (e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014)) {
                            alert('本地存储空间已满，请清理回收站或精简题库。');
                            return false;
                        }
                        console.error('Storage error', e);
                        return false;
                    }
                },

                clearAllForLogout() {
                    this.bank = {};
                    this.bankName = '';
                    this.history = [];
                    this.trash = {};
                    this.hiddenMistakeIds = [];
                    this._cachedQuestions = null;
                    this._questionMap = null;
                    this._errFreqCache = null;
                    this._isHistoryDirty = true;
                    this._lastSyncedCounts = null;
                    this._lastSyncedQuestionIds = null;
                    this._bankDirty = false;
                    this._syncReady = false;
                    this._cloudLoading = false;
                    this.remoteVersion = 0;
                    this._historyAppendBuffer = [];
                    this._lastHistoryTimestamp = 0;
                    this._lastEtag = null;
                    try {
                        localStorage.removeItem(this.bankKey);
                        localStorage.removeItem(this.bankNameKey);
                        localStorage.removeItem(this.historyKey);
                        localStorage.removeItem(this.trashKey);
                    } catch (e) {
                        console.error(e);
                    }
                },

                saveHistory() {
                    this._safeSetItem(this.historyKey, JSON.stringify({
                        history: this.history,
                        lastPracticeTime: this.lastPracticeTime,
                        hiddenMistakeIds: Array.isArray(this.hiddenMistakeIds) ? this.hiddenMistakeIds : []
                    }));
                    if (!this._suppressCloudSync && this.saveToCloudDebounced) {
                        this.saveToCloudDebounced();
                    }
                },

                validateSchema(data) {
                    if (!data || typeof data !== 'object' || Array.isArray(data)) return "Root must be an object";
                    for (const sub in data) {
                        if (typeof data[sub] !== 'object' || Array.isArray(data[sub])) return `Subject [${sub}] format error`;
                        for (const chap in data[sub]) {
                            if (!Array.isArray(data[sub][chap])) return `Chapter [${chap}] must be an array`;
                            for (let i = 0; i < data[sub][chap].length; i++) {
                                const q = data[sub][chap][i];
                                if (!q.id || !q.type || !q.q || !q.a) return `Missing core fields in [${sub}]-[${chap}] index ${i}`;
                                if (['mcq', 'multi'].includes(q.type) && (!Array.isArray(q.o) || q.o.length < 2)) {
                                    return `Invalid options array for question ID ${q.id}`;
                                }
                                // 修复 6: 归一化多选题答案 (Normalize Multi-select Answers)
                                if (q.type === 'multi' && typeof q.a === 'string') {
                                    q.a = q.a.split('').sort().join('');
                                }
                            }
                        }
                    }
                    return true;
                },

                // 最近一次导入报告，包括新增/更新/重复/相似题等统计
                _lastImportReport: null,

                importBank(jsonStr) {
                    try {
                        const prevBank = JSON.parse(JSON.stringify(this.bank || {}));
                        const prevTrash = JSON.parse(JSON.stringify(this.trash || {}));
                        const prevHistory = Array.isArray(this.history) ? this.history.slice() : [];

                        const parsed = JSON.parse(jsonStr);
                        const sanitizedInput = (window.App && App.ai && typeof App.ai.sanitizeImportedBank === 'function')
                            ? App.ai.sanitizeImportedBank(parsed)
                            : parsed;
                        const validationResult = this.validateSchema(sanitizedInput);
                        if (validationResult !== true) {
                            throw new Error(`模式校验失败 (Schema Validation Failed): ${validationResult}`);
                        }

                        // 导入统计信息与疑似相似题收集
                        const report = {
                            added: 0,
                            updated: 0,
                            skippedSame: 0,
                            importPairs: [],   // id 相同但内容不同的覆盖记录
                            similarPairs: []   // id 不同但题干高度相似的记录
                        };

                        // 构建旧题全局索引（id -> 位置与题目）
                        const globalMap = new Map();
                        for (const sub in this.bank) {
                            for (const chap in (this.bank[sub] || {})) {
                                const arr = this.bank[sub][chap] || [];
                                arr.forEach(q => {
                                    if (q && typeof q.id === 'string') {
                                        globalMap.set(q.id, { sub, chap, q });
                                    }
                                });
                            }
                        }
                        // 构建导入数据的全局索引（同 id 最后一次出现生效）
                        const importMap = new Map();
                        for (const sub in sanitizedInput) {
                            const chapters = sanitizedInput[sub] || {};
                            for (const chap in chapters) {
                                const arr = Array.isArray(chapters[chap]) ? chapters[chap] : [];
                                arr.forEach(qNew => {
                                    if (!qNew || typeof qNew !== 'object') return;
                                    if (qNew.type === 'multi' && typeof qNew.a === 'string') {
                                        qNew.a = qNew.a.split('').sort().join('');
                                    }
                                    if (typeof qNew.id !== 'string' || !qNew.id) return;
                                    importMap.set(qNew.id, { sub, chap, q: qNew });
                                });
                            }
                        }
                        // 合并：逐 id 处理，避免在章节维度上反复 push
                        importMap.forEach(({ sub, chap, q: qNew }, id) => {
                            if (!this.bank[sub]) this.bank[sub] = {};
                            if (!this.bank[sub][chap]) this.bank[sub][chap] = [];
                            const targetArr = this.bank[sub][chap];
                            const exist = globalMap.get(id);
                            if (exist) {
                                const qOld = exist.q;
                                const same =
                                    qOld.type === qNew.type &&
                                    qOld.q === qNew.q &&
                                    JSON.stringify(qOld.o || []) === JSON.stringify(qNew.o || []) &&
                                    qOld.a === qNew.a;
                                if (same) {
                                    report.skippedSame++;
                                } else {
                                    const oldArr = this.bank[exist.sub] && this.bank[exist.sub][exist.chap];
                                    if (Array.isArray(oldArr)) {
                                        const idx = oldArr.findIndex(x => x.id === id);
                                        if (idx !== -1) {
                                            const oldQ = oldArr[idx];
                                            if (!this.trash[exist.sub]) this.trash[exist.sub] = {};
                                            if (!this.trash[exist.sub][exist.chap]) this.trash[exist.sub][exist.chap] = [];
                                            this.trash[exist.sub][exist.chap].push({
                                                ...oldQ,
                                                deletedAt: Date.now(),
                                                deletedBy: 'import',
                                                reason: 'override',
                                                originalPath: { sub: exist.sub, chap: exist.chap }
                                            });
                                            oldArr.splice(idx, 1);
                                        }
                                    }
                                    targetArr.push(qNew);
                                    globalMap.set(id, { sub, chap, q: qNew });
                                    report.updated++;
                                    report.importPairs.push({
                                        sub,
                                        chap,
                                        oldId: qOld.id,
                                        newId: qNew.id,
                                        oldQ: qOld.q,
                                        newQ: qNew.q
                                    });
                                }
                            } else {
                                targetArr.push(qNew);
                                globalMap.set(id, { sub, chap, q: qNew });
                                report.added++;
                            }
                        });
                        // 对每个章节进行一次去重（按 id 保留最后一个）
                        for (const sub in this.bank) {
                            for (const chap in (this.bank[sub] || {})) {
                                const arr = this.bank[sub][chap] || [];
                                const uniq = new Map();
                                arr.forEach(q => {
                                    if (q && typeof q.id === 'string') {
                                        uniq.set(q.id, q);
                                    }
                                });
                                this.bank[sub][chap] = Array.from(uniq.values());
                            }
                        }
                        this.normalizeBankStructure();
                        if (!this.bankName) {
                            const subs = Object.keys(sanitizedInput || {});
                            if (subs.length === 1) {
                                this.bankName = subs[0];
                            } else if (subs.length > 1) {
                                this.bankName = subs[0];
                            }
                            if (this.bankName) {
                                this._safeSetItem(this.bankNameKey, this.bankName);
                            }
                        }
                        this.persistBank();
                        // 记录导入报告，供 UI 后续查看
                        this._lastImportReport = report;
                        return report;
                    } catch (e) {
                        try {
                            this.bank = JSON.parse(JSON.stringify(prevBank || {}));
                            this.trash = JSON.parse(JSON.stringify(prevTrash || {}));
                            this.history = Array.isArray(prevHistory) ? prevHistory.slice() : [];
                        } catch (rollbackError) {
                            console.error('导入回滚失败', rollbackError);
                        }
                        alert("导入失败，请检查 JSON 格式。\n(Import failed.)\n\n报错详情: " + e.message);
                        return null;
                    }
                },

                clearBank() {
                    if (confirm("确定清空题库吗？该操作不会清空您的做题记录。\n(Are you sure to clear the question bank? Practice history will be preserved.)")) {
                        this.bank = {};
                        this.persistBank();
                        App.ui.closeModal('config');
                        App.router.go('dashboard');
                    }
                },

                resetHistory() {
                    if (confirm("确定清空所有刷题记录吗？\n(Are you sure to reset all practice history?)")) {
                        this.history = [];
                        this.lastPracticeTime = null;
                        this.saveHistory();
                        App.ui.closeModal('config');
                        App.router.go('dashboard');
                    }
                },

                getQuestions() {
                    if (this._cachedQuestions) return this._cachedQuestions;

                    let list = [];
                    for (let sub in this.bank) {
                        for (let chap in this.bank[sub]) {
                            list = list.concat(this.bank[sub][chap].map(q => {
                                const rawText = [q.q, chap, q.a, ...(q.o || [])].join(' ');
                                return {
                                    ...q,
                                    sub,
                                    chap,
                                    _pinyin: App.utils.toPinyinStr(rawText)
                                };
                            }));
                        }
                    }
                    this._cachedQuestions = list;
                    return list;
                },

                getQuestionById(id) {
                    if (!this._questionMap) {
                        this._questionMap = new Map();
                        this.getQuestions().forEach(q => this._questionMap.set(q.id, q));
                    }
                    return this._questionMap.get(id);
                },

                getMistakeCount(id) {
                    if (this._isHistoryDirty || !this._errFreqCache) {
                        this._errFreqCache = new Map();
                        this.history.forEach(h => {
                            if (!h.r) this._errFreqCache.set(h.id, (this._errFreqCache.get(h.id) || 0) + 1);
                        });
                        this._isHistoryDirty = false;
                    }
                    return this._errFreqCache.get(id) || 0;
                },

                // 持久化题库
                persistBank() {
                    this._safeSetItem(this.bankKey, JSON.stringify(this.bank));
                    if (this.bankName) {
                        this._safeSetItem(this.bankNameKey, this.bankName);
                    }
                    this._cachedQuestions = null;
                    this._questionMap = null;
                    this._errFreqCache = null;
                    this._isHistoryDirty = true;
                    this._bankDirty = true;
                    if (!this._suppressCloudSync && this.saveToCloudDebounced) {
                        this.saveToCloudDebounced();
                    }
                },

                renameSubject(oldSub, newSub) {
                    const trimmed = String(newSub || '').trim();
                    if (!trimmed || trimmed === oldSub || !this.bank[oldSub]) return;
                    if (!this.bank[trimmed]) this.bank[trimmed] = {};
                    for (const chap in this.bank[oldSub]) {
                        if (!this.bank[trimmed][chap]) this.bank[trimmed][chap] = [];
                        const arr = this.bank[oldSub][chap] || [];
                        this.bank[trimmed][chap] = this.bank[trimmed][chap].concat(arr);
                    }
                    delete this.bank[oldSub];
                    if (this.trash && this.trash[oldSub]) {
                        if (!this.trash[trimmed]) this.trash[trimmed] = {};
                        for (const chap in this.trash[oldSub]) {
                            if (!this.trash[trimmed][chap]) this.trash[trimmed][chap] = [];
                            const arr = this.trash[oldSub][chap] || [];
                            this.trash[trimmed][chap] = this.trash[trimmed][chap].concat(arr);
                        }
                        delete this.trash[oldSub];
                        this.persistTrash();
                    }
                    this.normalizeBankStructure();
                    if (App && App.ui && App.ui._bankMgrCurrentSubject === oldSub) {
                        App.ui._bankMgrCurrentSubject = trimmed;
                    }
                    this.persistBank();
                },

                deleteSubject(sub) {
                    if (!this.bank[sub]) return;
                    // 收集该科目下所有题目 ID，用于清理 history
                    const deletedIds = new Set();
                    const chapDict = this.bank[sub] || {};
                    for (const chap in chapDict) {
                        const arr = chapDict[chap];
                        if (Array.isArray(arr)) arr.forEach(q => { if (q && q.id) deletedIds.add(q.id); });
                    }
                    delete this.bank[sub];
                    if (this.trash && this.trash[sub]) {
                        delete this.trash[sub];
                        this.persistTrash();
                    }
                    // Bug #5 fix: 清理被删除题目的历史记录
                    if (deletedIds.size > 0 && Array.isArray(this.history)) {
                        this.history = this.history.filter(h => !deletedIds.has(h.id));
                        this._safeSetItem(this.historyKey, JSON.stringify({
                            history: this.history,
                            lastPracticeTime: this.lastPracticeTime,
                            hiddenMistakeIds: this.hiddenMistakeIds
                        }));
                    }
                    this.persistBank();
                },

                renameChapter(sub, oldChap, newChap) {
                    if (!this.bank[sub] || !this.bank[sub][oldChap]) return;
                    const trimmed = String(newChap || '').trim();
                    if (!trimmed || trimmed === oldChap) return;
                    if (!this.bank[sub][trimmed]) this.bank[sub][trimmed] = [];
                    const arr = this.bank[sub][oldChap] || [];
                    this.bank[sub][trimmed] = this.bank[sub][trimmed].concat(arr);
                    delete this.bank[sub][oldChap];
                    if (!Object.keys(this.bank[sub] || {}).length) delete this.bank[sub];
                    if (this.trash && this.trash[sub] && this.trash[sub][oldChap]) {
                        if (!this.trash[sub][trimmed]) this.trash[sub][trimmed] = [];
                        const tArr = this.trash[sub][oldChap] || [];
                        this.trash[sub][trimmed] = this.trash[sub][trimmed].concat(tArr);
                        delete this.trash[sub][oldChap];
                        if (!Object.keys(this.trash[sub] || {}).length) delete this.trash[sub];
                        this.persistTrash();
                    }
                    this.normalizeBankStructure();
                    this.persistBank();
                },

                deleteChapter(sub, chap) {
                    if (!this.bank[sub] || !this.bank[sub][chap]) return;
                    // 收集该章节下所有题目 ID，用于清理 history
                    const deletedIds = new Set();
                    const arr = this.bank[sub][chap];
                    if (Array.isArray(arr)) arr.forEach(q => { if (q && q.id) deletedIds.add(q.id); });
                    delete this.bank[sub][chap];
                    if (!Object.keys(this.bank[sub] || {}).length) delete this.bank[sub];
                    if (this.trash && this.trash[sub] && this.trash[sub][chap]) {
                        delete this.trash[sub][chap];
                        if (!Object.keys(this.trash[sub] || {}).length) delete this.trash[sub];
                        this.persistTrash();
                    }
                    // Bug #5 fix: 清理被删除题目的历史记录
                    if (deletedIds.size > 0 && Array.isArray(this.history)) {
                        this.history = this.history.filter(h => !deletedIds.has(h.id));
                        this._safeSetItem(this.historyKey, JSON.stringify({
                            history: this.history,
                            lastPracticeTime: this.lastPracticeTime,
                            hiddenMistakeIds: this.hiddenMistakeIds
                        }));
                    }
                    this.persistBank();
                },

                normalizeBankStructure() {
                    const bank = this.bank || {};
                    for (const sub in bank) {
                        const chapDict = bank[sub];
                        if (!chapDict || typeof chapDict !== 'object') continue;
                        for (const chap in chapDict) {
                            const arr = chapDict[chap];
                            if (!Array.isArray(arr)) continue;
                            arr.forEach(q => {
                                if (!q || typeof q !== 'object') return;
                                if (q.sub !== sub) q.sub = sub;
                                if (q.chap !== chap) q.chap = chap;
                            });
                        }
                    }
                },

                renameSubjectInteractive(sub) {
                    const next = window.prompt('请输入新的科目名称', sub);
                    if (!next || next.trim() === sub) return;
                    this.renameSubject(sub, next.trim());
                    if (App && App.ui && typeof App.ui.renderBankManager === 'function') {
                        App.ui.renderBankManager();
                    }
                },

                deleteSubjectInteractive(sub) {
                    if (!window.confirm(`确定要删除科目「${sub}」及其所有章节和题目吗？`)) return;
                    this.deleteSubject(sub);
                    if (App && App.ui && typeof App.ui.renderBankManager === 'function') {
                        App.ui.renderBankManager();
                    }
                },

                renameChapterInteractive(sub, chap) {
                    const next = window.prompt(`请输入新的章节名称（${sub}）`, chap);
                    if (!next || next.trim() === chap) return;
                    this.renameChapter(sub, chap, next.trim());
                    if (App && App.ui && typeof App.ui.renderBankManager === 'function') {
                        App.ui.renderBankManager();
                    }
                },

                deleteChapterInteractive(sub, chap) {
                    if (!window.confirm(`确定要删除章节「${sub} / ${chap}」及其所有题目吗？`)) return;
                    this.deleteChapter(sub, chap);
                    if (App && App.ui && typeof App.ui.renderBankManager === 'function') {
                        App.ui.renderBankManager();
                    }
                },

                /**
                 * 核心方法：保存数据到云端 (Core: Save to Cloud)
                 * 包含防抖 (Debounce)、锁机制 (Locking) 和增量更新逻辑
                 */
                async saveToCloud() {
                    // 1. 并发锁：如果正在保存或正在加载，则标记为"需要再次保存"并返回
                    // 这防止了多个并发请求导致的版本冲突 (409 Error)
                    if (this._isSaving) {
                        this._saveAgainPending = true;
                        return;
                    }
                    if (this._cloudLoading) {
                        this._saveAgainPending = true;
                        return;
                    }

                    if (!App.auth || typeof App.auth.getToken !== 'function') return;
                    this._isSaving = true;
                    try {
                        const token = await App.auth.getToken();
                        if (!token) return;

                        // 2. 确保在保存前已经从云端加载过最新数据
                        if (!this._syncReady) {
                            await this.loadFromCloud();
                            // If load failed or is still pending (should be awaited), check ready again
                            if (!this._syncReady) return;
                        }
                        const bank = this.bank || {};
                        const history = Array.isArray(this.history) ? this.history : [];
                        const trash = this.trash || {};
                        const lastPracticeTime = this.lastPracticeTime || null;
                        this.normalizeBankStructure();
                        const questions = [];
                        let totalTrash = 0;

                        // 3. 扁平化题库结构，便于统计和传输
                        for (const sub in bank) {
                            if (!bank[sub]) continue;
                            for (const chap in bank[sub]) {
                                const arr = bank[sub][chap];
                                if (!Array.isArray(arr)) continue;
                                arr.forEach(q => {
                                    if (q && typeof q === 'object') {
                                        questions.push(q);
                                    }
                                });
                            }
                        }
                        for (const sub in trash) {
                            if (!trash[sub]) continue;
                            for (const chap in trash[sub]) {
                                const arr = trash[sub][chap];
                                if (!Array.isArray(arr)) continue;
                                totalTrash += arr.length;
                            }
                        }
                        if (!questions.length && !history.length && !totalTrash) return;

                        const counts = {
                            questions: questions.length,
                            history: history.length,
                            trash: totalTrash
                        };
                        const prev = this._lastSyncedCounts || { questions: 0, history: 0, trash: 0 };
                        const delta = {
                            questions: counts.questions - prev.questions,
                            history: counts.history - prev.history,
                            trash: counts.trash - prev.trash
                        };
                        const inferredName = this.bankName || Object.keys(bank || {})[0] || "默认题库";

                        // 4. 优化：如果题库内容没有变动（Dirty Flag 为 false），则跳过全量题目上传
                        // 仅更新元数据 (State) 和历史记录，节省带宽
                        const skipQuestionsUpdate = !this._bankDirty && delta.questions === 0;

                        // ========== 增量同步决策 ==========
                        // 如果只有 history 变动（bank/trash 没变），使用增量模式
                        const historyBuffer = Array.isArray(this._historyAppendBuffer) ? this._historyAppendBuffer : [];
                        const useIncrementalSync = !this._bankDirty
                            && delta.questions === 0
                            && delta.trash === 0
                            && historyBuffer.length > 0;

                        if (window.App && App.sync && typeof App.sync.setDebug === 'function') {
                            App.sync.setDebug({
                                time: Date.now(),
                                name: inferredName,
                                questionsCount: questions.length,
                                historyCount: history.length,
                                trashCount: totalTrash,
                                skipQuestionsUpdate,
                                useIncrementalSync,
                                historyBufferSize: historyBuffer.length,
                                version: typeof this.remoteVersion === "number" ? this.remoteVersion : 0
                            });
                        }

                        // 5. 构造要保存的完整状态树
                        const state = {
                            bank,
                            bankName: this.bankName || null,
                            history,
                            lastPracticeTime,
                            trash,
                            hiddenMistakeIds: Array.isArray(this.hiddenMistakeIds) ? this.hiddenMistakeIds : []
                        };
                        const allIds = [];
                        for (const sub in bank) {
                            for (const chap in bank[sub]) {
                                const arr = bank[sub][chap];
                                if (!Array.isArray(arr)) continue;
                                arr.forEach(q => {
                                    if (q && typeof q.id === 'string') allIds.push(q.id);
                                });
                            }
                        }
                        const prevIds = Array.isArray(this._lastSyncedQuestionIds) ? this._lastSyncedQuestionIds : [];
                        const prevSet = new Set(prevIds);
                        const currSet = new Set(allIds);
                        const addedIds = [];
                        const removedIds = [];
                        currSet.forEach(id => {
                            if (!prevSet.has(id)) addedIds.push(id);
                        });
                        prevSet.forEach(id => {
                            if (!currSet.has(id)) removedIds.push(id);
                        });


                        let res;
                        try {
                            if (window.App && App.sync && typeof App.sync.setStatus === 'function') {
                                App.sync.setStatus('pending', null, null);
                            }
                            if (!this._pendingSaveState) {
                                this._pendingSaveState = {
                                    bank: JSON.parse(JSON.stringify(this.bank || {})),
                                    history: Array.isArray(this.history) ? this.history.slice() : [],
                                    trash: JSON.parse(JSON.stringify(this.trash || {})),
                                    lastPracticeTime: this.lastPracticeTime || null,
                                    hiddenMistakeIds: Array.isArray(this.hiddenMistakeIds) ? this.hiddenMistakeIds.slice() : [],
                                    bankName: this.bankName || ''
                                };
                            }
                            res = await fetch((App.apiBase || '') + "/api/save-question-set", {
                                method: "POST",
                                headers: {
                                    "Content-Type": "application/json",
                                    Authorization: "Bearer " + token
                                },
                                body: JSON.stringify(useIncrementalSync ? {
                                    // ========== 增量模式：仅发送新增 history ==========
                                    name: inferredName,
                                    statePartial: true,
                                    historyAppend: historyBuffer,
                                    skipQuestionsUpdate: true,
                                    version: typeof this.remoteVersion === "number" ? this.remoteVersion : 0,
                                    partialFields: ['lastPracticeTime'],
                                    partialValues: { lastPracticeTime: lastPracticeTime },
                                    delta: {
                                        questions: 0,
                                        history: historyBuffer.length,
                                        trash: 0,
                                        incremental: true
                                    }
                                } : {
                                    // ========== 全量模式（原逻辑） ==========
                                    name: inferredName,
                                    questions,
                                    state,
                                    skipQuestionsUpdate,
                                    version: typeof this.remoteVersion === "number" ? this.remoteVersion : 0,
                                    // 同时附带 historyAppend 以防万一
                                    historyAppend: historyBuffer.length > 0 ? historyBuffer : undefined,
                                    delta: {
                                        questions: delta.questions,
                                        history: delta.history,
                                        trash: delta.trash,
                                        questionIds: {
                                            added: addedIds,
                                            removed: removedIds
                                        }
                                    }
                                })
                            });
                        } catch (e) {
                            console.error("保存题库到云端失败", e);
                            if (window.App && App.sync && typeof App.sync.showSyncStatus === 'function') {
                                App.sync.showSyncStatus('error', delta, '网络错误或无法连接服务器');
                            }
                            return;
                        }
                        try {
                            const data = await res.json();
                            if (!res.ok || !data) {
                                console.error("保存题库到云端失败", data);
                                if (window.App && App.sync && typeof App.sync.showSyncStatus === 'function') {
                                    const msg = (data && (data.error || data.detail)) || '未知错误';
                                    App.sync.showSyncStatus('error', delta, msg);
                                }
                                if (res.status === 409 && window.App && App.data && typeof App.data.loadFromCloud === "function") {
                                    try {
                                        // Temporarily release lock to allow loadFromCloud
                                        this._isSaving = false;
                                        await App.data.loadFromCloud();
                                        this._isSaving = true;

                                        if (typeof this._retryAfterConflictOnce !== 'number') this._retryAfterConflictOnce = 0;
                                        if (this._retryAfterConflictOnce < 1) {
                                            this._retryAfterConflictOnce++;
                                            if (this._pendingSaveState) {
                                                this._suppressCloudSync = true;
                                                const s = this._pendingSaveState;
                                                this.bank = s.bank || {};
                                                this.history = Array.isArray(s.history) ? s.history : [];
                                                this.trash = s.trash || {};
                                                this.lastPracticeTime = s.lastPracticeTime || null;
                                                this.hiddenMistakeIds = Array.isArray(s.hiddenMistakeIds) ? s.hiddenMistakeIds : [];
                                                this.bankName = s.bankName || this.bankName;
                                                this._safeSetItem(this.bankKey, JSON.stringify(this.bank));
                                                this._safeSetItem(this.historyKey, JSON.stringify({
                                                    history: this.history,
                                                    lastPracticeTime: this.lastPracticeTime,
                                                    hiddenMistakeIds: this.hiddenMistakeIds
                                                }));
                                                this._safeSetItem(this.trashKey, JSON.stringify(this.trash));
                                                if (this.bankName) this._safeSetItem(this.bankNameKey, this.bankName);
                                                this._bankDirty = true;
                                                this._suppressCloudSync = false;
                                            }
                                            // Trigger retry via saveAgainPending logic
                                            this._saveAgainPending = true;
                                        } else {
                                            this._retryAfterConflictOnce = 0;
                                        }
                                    } catch (e) {
                                        console.error("loadFromCloud after conflict failed", e);
                                        this._isSaving = true; // Restore lock if it was released
                                    }
                                }
                            } else {
                                this._lastSyncedCounts = counts;
                                this._lastSyncedQuestionIds = allIds;
                                if (typeof data.version === "number" && Number.isFinite(data.version)) {
                                    this.remoteVersion = data.version;
                                }
                                if (window.App && App.sync && typeof App.sync.showSyncStatus === 'function') {
                                    App.sync.showSyncStatus('success', delta);
                                }
                                this._bankDirty = false;
                                this.bankName = inferredName;
                                this._safeSetItem(this.bankNameKey, this.bankName);
                                this._retryAfterConflictOnce = 0;
                                this._pendingSaveState = null;
                                // ========== 增量同步：清空 buffer ==========
                                this._historyAppendBuffer = [];
                                // 更新最后同步的 history 时间戳
                                if (this.history.length > 0) {
                                    this._lastHistoryTimestamp = this.history[this.history.length - 1].t || 0;
                                }
                            }
                        } catch (e) {
                            console.error("解析云端保存响应失败", e);
                            if (window.App && App.sync && typeof App.sync.showSyncStatus === 'function') {
                                App.sync.showSyncStatus('error', delta, '解析服务器响应失败');
                            }
                        }
                    } finally {
                        this._isSaving = false;
                        if (this._saveAgainPending) {
                            this._saveAgainPending = false;
                            this.saveToCloudDebounced();
                        }
                    }
                },

                saveToCloudDebounced() {
                    if (this._cloudSaveTimer) {
                        clearTimeout(this._cloudSaveTimer);
                    }
                    if (!App.auth || !App.auth.session) return;
                    if (!this._syncReady) {
                        this._deferredSave = true;
                        this.loadFromCloud();
                        return;
                    }
                    if (window.App && App.sync && typeof App.sync.setStatus === 'function') {
                        App.sync.setStatus('pending', null, null);
                    }
                    this._cloudSaveTimer = setTimeout(() => {
                        this._cloudSaveTimer = null;
                        this.saveToCloud();
                    }, 400);
                },

                /**
                 * 核心方法：从云端加载数据 (Core: Load from Cloud)
                 * 处理数据合并、版本校验和状态恢复
                 */
                async loadFromCloud() {
                    if (!App.auth || typeof App.auth.getToken !== 'function') return;

                    // 1. 并发控制：如果已经在加载中，直接返回当前的 Promise
                    // 避免重复请求浪费资源
                    if (this._cloudLoading) {
                        if (this._loadPromise) return this._loadPromise;
                        return;
                    }
                    this._cloudLoading = true;
                    this._loadPromise = (async () => {
                        try {
                            const token = await App.auth.getToken();
                            if (!token) return;

                            let res;
                            try {
                                // ========== ETag + 增量加载 ==========
                                let loadUrl = (App.apiBase || '') + "/api/load-question-set";
                                // 如果已经成功加载过，发送 historyAfter 参数加速后续加载
                                if (this._lastHistoryTimestamp > 0 && this._syncReady) {
                                    loadUrl += '?historyAfter=' + this._lastHistoryTimestamp;
                                }
                                const headers = {
                                    Authorization: "Bearer " + token
                                };
                                // ETag: 如果有上次的 ETag，发送 If-None-Match
                                if (this._lastEtag) {
                                    headers['If-None-Match'] = this._lastEtag;
                                }
                                res = await fetch(loadUrl, {
                                    method: "GET",
                                    headers
                                });
                            } catch (e) {
                                console.error("从云端加载题库失败", e);
                                this._syncReady = true;
                                if (this._deferredSave) {
                                    this._deferredSave = false;
                                    this.saveToCloudDebounced();
                                }
                                return;
                            }
                            // ========== 304 Not Modified: 数据未变化，跳过处理 ==========
                            if (res.status === 304) {
                                this._syncReady = true;
                                if (this._deferredSave) {
                                    this._deferredSave = false;
                                    this.saveToCloudDebounced();
                                }
                                return;
                            }
                            if (!res.ok) {
                                console.error("从云端加载题库失败", res.status);
                                if (window.App && App.sync && typeof App.sync.showSyncStatus === 'function') {
                                    App.sync.showSyncStatus('error', null, '从云端加载题库失败 (HTTP ' + res.status + ')');
                                }
                                this._syncReady = true;
                                if (this._deferredSave) {
                                    this._deferredSave = false;
                                    this.saveToCloudDebounced();
                                }
                                return;
                            }
                            // 保存 ETag
                            const newEtag = res.headers.get('etag');
                            if (newEtag) {
                                this._lastEtag = newEtag;
                            }
                            let data;
                            try {
                                data = await res.json();
                            } catch (e) {
                                console.error("解析云端题库响应失败", e);
                                this._syncReady = true;
                                if (this._deferredSave) {
                                    this._deferredSave = false;
                                    this.saveToCloudDebounced();
                                }
                                return;
                            }
                            if (!data || !data.ok) {
                                return;
                            }

                            // 2. 解析云端返回的数据包
                            const state = data.state && typeof data.state === "object" ? data.state : null;
                            if (!state) {
                                // 如果云端是空的（新用户），初始化版本号
                                if (typeof data.version === "number" && Number.isFinite(data.version)) {
                                    this.remoteVersion = data.version;
                                } else {
                                    this.remoteVersion = 0;
                                }
                                this._syncReady = true;
                                if (this._deferredSave) {
                                    this._deferredSave = false;
                                    this.saveToCloudDebounced();
                                }
                                return;
                            }

                            // 3. 应用数据到本地
                            // _suppressCloudSync 标志位防止应用数据时触发不必要的自动保存
                            this._suppressCloudSync = true;
                            if (typeof data.version === "number" && Number.isFinite(data.version)) {
                                this.remoteVersion = data.version;
                            } else {
                                this.remoteVersion = 0;
                            }
                            this.bank = state.bank && typeof state.bank === "object" ? state.bank : {};
                            // ========== 增量 history 合并 ==========
                            if (data.historyPartial && Array.isArray(state.history)) {
                                // 服务端返回的是增量 history，合并到本地而非替换
                                const existingTimestamps = new Set(this.history.map(h => h.t));
                                const newEntries = state.history.filter(h => !existingTimestamps.has(h.t));
                                if (newEntries.length > 0) {
                                    this.history = this.history.concat(newEntries);
                                }
                            } else {
                                this.history = Array.isArray(state.history) ? state.history : [];
                            }
                            // 更新 _lastHistoryTimestamp
                            if (this.history.length > 0) {
                                const maxT = this.history.reduce((m, h) => Math.max(m, h.t || 0), 0);
                                this._lastHistoryTimestamp = maxT;
                            }
                            this.lastPracticeTime =
                                typeof state.lastPracticeTime === "number" ? state.lastPracticeTime : null;
                            this.trash = state.trash && typeof state.trash === "object" ? state.trash : {};
                            this.hiddenMistakeIds = Array.isArray(state.hiddenMistakeIds) ? state.hiddenMistakeIds : [];
                            this.bankName = typeof data.name === "string" && data.name ? data.name : (state.bankName || this.bankName || '');
                            if (this.bankName) {
                                this._safeSetItem(this.bankNameKey, this.bankName);
                            }
                            // 持久化到 LocalStorage
                            this._safeSetItem(this.bankKey, JSON.stringify(this.bank));
                            this._safeSetItem(this.historyKey, JSON.stringify({
                                history: this.history,
                                lastPracticeTime: this.lastPracticeTime,
                                hiddenMistakeIds: this.hiddenMistakeIds
                            }));
                            this._safeSetItem(this.trashKey, JSON.stringify(this.trash));
                            const bankCount = (() => {
                                let n = 0;
                                for (const sub in this.bank) {
                                    for (const chap in this.bank[sub] || {}) {
                                        const arr = this.bank[sub][chap];
                                        if (Array.isArray(arr)) n += arr.length;
                                    }
                                }
                                return n;
                            })();
                            const allIds = [];
                            for (const sub in this.bank) {
                                for (const chap in this.bank[sub]) {
                                    const arr = this.bank[sub][chap];
                                    if (!Array.isArray(arr)) continue;
                                    arr.forEach(q => {
                                        if (q && typeof q.id === 'string') allIds.push(q.id);
                                    });
                                }
                            }
                            const trashCount = (() => {
                                let n = 0;
                                for (const sub in this.trash) {
                                    for (const chap in this.trash[sub] || {}) {
                                        const arr = this.trash[sub][chap];
                                        if (Array.isArray(arr)) n += arr.length;
                                    }
                                }
                                return n;
                            })();
                            this._lastSyncedCounts = {
                                questions: bankCount,
                                history: this.history.length,
                                trash: trashCount
                            };
                            this._lastSyncedQuestionIds = allIds;
                            this._bankDirty = false;
                            this._syncReady = true;
                            this._suppressCloudSync = false;
                            if (window.App && App.router && typeof App.router.refresh === 'function') {
                                App.router.refresh();
                            }
                            if (this._deferredSave) {
                                this._deferredSave = false;
                                this.saveToCloudDebounced();
                            }
                        } finally {
                            this._cloudLoading = false;
                            this._loadPromise = null;
                        }
                    })();

                    return this._loadPromise;
                },

                // 持久化回收站
                persistTrash() {
                    this._safeSetItem(this.trashKey, JSON.stringify(this.trash));
                    if (!this._suppressCloudSync && this.saveToCloudDebounced) {
                        this.saveToCloudDebounced();
                    }
                },

                /**
                 * 软删除：将指定 ID 的题目从 bank 移动到 trash
                 */
                softDeleteByIds(idSet, reason = 'manual-delete') {
                    const now = Date.now();
                    let changed = false;

                    for (const sub in this.bank) {
                        for (const chap in this.bank[sub]) {
                            const arr = this.bank[sub][chap];
                            if (!Array.isArray(arr) || !arr.length) continue;

                            const remain = [];
                            arr.forEach(q => {
                                if (!idSet.has(q.id)) {
                                    remain.push(q);
                                } else {
                                    if (!this.trash[sub]) this.trash[sub] = {};
                                    if (!this.trash[sub][chap]) this.trash[sub][chap] = [];
                                    this.trash[sub][chap].push({
                                        ...q,
                                        deletedAt: now,
                                        deletedBy: 'user',
                                        reason,
                                        originalPath: { sub, chap }
                                    });
                                    changed = true;
                                }
                            });

                            this.bank[sub][chap] = remain;
                        }
                    }

                    // 同步清理历史记录中已被删除题目的答题记录，保持统计数据一致
                    if (idSet && idSet.size > 0 && Array.isArray(this.history) && this.history.length) {
                        const beforeLen = this.history.length;
                        this.history = this.history.filter(h => !idSet.has(h.id));
                        if (this.history.length !== beforeLen) {
                            this.saveHistory();
                            this._isHistoryDirty = true;
                        }
                    }

                    if (changed) {
                        this.persistBank();
                        this.persistTrash();
                    }
                },

                // 从回收站恢复单题
                restoreFromTrash(sub, chap, id) {
                    if (!this.trash[sub] || !this.trash[sub][chap]) return;
                    const arr = this.trash[sub][chap];
                    const idx = arr.findIndex(q => q.id === id);
                    if (idx === -1) return;

                    const q = arr[idx];
                    const targetSub = q.originalPath?.sub || sub;
                    const targetChap = q.originalPath?.chap || chap;
                    const { deletedAt, deletedBy, reason, originalPath, ...cleanQ } = q;

                    if (!this.bank[targetSub]) this.bank[targetSub] = {};
                    if (!this.bank[targetSub][targetChap]) this.bank[targetSub][targetChap] = [];
                    this.bank[targetSub][targetChap].push(cleanQ);

                    arr.splice(idx, 1);
                    if (!arr.length) delete this.trash[sub][chap];
                    if (!Object.keys(this.trash[sub] || {}).length) delete this.trash[sub];

                    this.persistBank();
                    this.persistTrash();
                },

                // 从回收站彻底删除
                destroyFromTrash(sub, chap, id) {
                    if (!this.trash[sub] || !this.trash[sub][chap]) return;
                    const arr = this.trash[sub][chap];
                    const idx = arr.findIndex(q => q.id === id);
                    if (idx === -1) return;

                    arr.splice(idx, 1);
                    if (!arr.length) delete this.trash[sub][chap];
                    if (!Object.keys(this.trash[sub] || {}).length) delete this.trash[sub];

                    this.persistTrash();
                },

                // 清空回收站
                emptyTrash() {
                    if (!confirm("确定要清空回收站中的所有题目吗？该操作不可恢复。")) return;
                    this.trash = {};
                    this.persistTrash();
                    if (window.App && App.ui && typeof App.ui.openTrashModal === 'function') {
                        App.ui.openTrashModal();
                    }
                },

                _idCounter: 0,

                generateQuestionId() {
                    if (typeof this._idCounter !== 'number') this._idCounter = 0;
                    return `q-${Date.now()}-${(this._idCounter++).toString(36)}-${Math.random().toString(36).slice(2, 4)}`;
                },

                upsertQuestion(question) {
                    const q = { ...question };
                    if (!q.id || typeof q.id !== 'string') {
                        q.id = this.generateQuestionId();
                    }

                    if (!this.bank[q.sub]) this.bank[q.sub] = {};
                    if (!this.bank[q.sub][q.chap]) this.bank[q.sub][q.chap] = [];

                    // 删除全局旧 ID
                    for (const sub in this.bank) {
                        for (const chap in this.bank[sub]) {
                            const arr = this.bank[sub][chap];
                            const idx = arr.findIndex(x => x.id === q.id);
                            if (idx !== -1) {
                                arr.splice(idx, 1);
                                if (!arr.length) delete this.bank[sub][chap];
                            }
                        }
                        if (!Object.keys(this.bank[sub] || {}).length) delete this.bank[sub];
                    }

                    this.bank[q.sub][q.chap].push(q);
                    this.persistBank();
                },

                removeQuestionsById(idSet) {
                    let changed = false;
                    for (const sub in this.bank) {
                        for (const chap in this.bank[sub]) {
                            const arr = this.bank[sub][chap];
                            const next = arr.filter(q => !idSet.has(q.id));
                            if (next.length !== arr.length) {
                                this.bank[sub][chap] = next;
                                changed = true;
                            }
                        }
                    }
                    if (changed) this.persistBank();
                },

                getSubjects() { return Object.keys(this.bank); },
                getChapters(sub) { return this.bank[sub] ? Object.keys(this.bank[sub]) : []; },

                getStats() {
                    const all = this.getQuestions();
                    const h = this.history;
                    const corr = h.filter(x => x.r).length;
                    const errFreq = {};
                    h.filter(x => !x.r).forEach(x => { errFreq[x.id] = (errFreq[x.id] || 0) + 1; });

                    const topMistakes = Object.entries(errFreq).sort((a, b) => b[1] - a[1]).slice(0, 10)
                        .map(([id, count]) => { const q = this.getQuestionById(id); return q ? { ...q, count, a: q.a, type: q.type, o: q.o } : null; }).filter(Boolean);

                    let timeText = '从未练习 (Never Practiced)';
                    if (this.lastPracticeTime) {
                        const diff = Date.now() - this.lastPracticeTime;
                        const mins = Math.floor(diff / 60000);
                        if (mins < 60) {
                            timeText = `距离上次练习已过去：${mins}分钟 (Minutes ago)`;
                        } else {
                            const hrs = Math.floor(mins / 60);
                            const m = mins % 60;
                            timeText = `距离上次练习已过去：${hrs}小时${m}分钟`;
                        }
                    }

                    const subjectStats = {};
                    this.getSubjects().forEach(sub => {
                        const subQids = new Set(all.filter(q => q.sub === sub).map(q => q.id));
                        const subH = h.filter(x => subQids.has(x.id));
                        subjectStats[sub] = {
                            attempts: subH.length,
                            correct: subH.filter(x => x.r).length,
                            acc: subH.length ? Math.round(subH.filter(x => x.r).length / subH.length * 100) : 0
                        };
                    });

                    const typeStats = { mcq: { a: 0, c: 0 }, tf: { a: 0, c: 0 }, multi: { a: 0, c: 0 } };
                    h.forEach(x => {
                        const q = this.getQuestionById(x.id);
                        if (!q || !typeStats[q.type]) return;
                        typeStats[q.type].a++;
                        if (x.r) typeStats[q.type].c++;
                    });
                    Object.keys(typeStats).forEach(t => {
                        typeStats[t].acc = typeStats[t].a ? Math.round(typeStats[t].c / typeStats[t].a * 100) : 0;
                    });

                    const daily30 = [];
                    for (let i = 29; i >= 0; i--) {
                        const d = new Date(); d.setDate(d.getDate() - i);
                        const ds = d.toISOString().slice(0, 10);
                        const recs = h.filter(x => new Date(x.t).toISOString().slice(0, 10) === ds);
                        daily30.push({
                            date: ds,
                            label: `${d.getMonth() + 1}/${d.getDate()}`,
                            attempts: recs.length,
                            correct: recs.filter(x => x.r).length,
                            acc: recs.length ? Math.round(recs.filter(x => x.r).length / recs.length * 100) : null
                        });
                    }

                    const durRecords = h.filter(x => x.d > 0);
                    const avgDuration = durRecords.length
                        ? Math.round(durRecords.reduce((s, x) => s + x.d, 0) / durRecords.length / 1000)
                        : null;

                    const durBuckets = [0, 0, 0, 0, 0];
                    durRecords.forEach(x => {
                        const s = x.d / 1000;
                        if (s < 5) durBuckets[0]++;
                        else if (s < 15) durBuckets[1]++;
                        else if (s < 30) durBuckets[2]++;
                        else if (s < 60) durBuckets[3]++;
                        else durBuckets[4]++;
                    });

                    let streak = 0;
                    for (let i = 0; i <= 365; i++) {
                        const d = new Date(); d.setDate(d.getDate() - i);
                        const ds = d.toISOString().slice(0, 10);
                        if (h.some(x => new Date(x.t).toISOString().slice(0, 10) === ds)) streak++;
                        else break;
                    }

                    const subEntries = Object.entries(subjectStats).filter(([, v]) => v.attempts > 0);
                    const bestSub = subEntries.sort((a, b) => b[1].acc - a[1].acc)[0]?.[0] || null;
                    const worstSub = [...subEntries].sort((a, b) => a[1].acc - b[1].acc)[0]?.[0] || null;

                    return {
                        total: all.length,
                        acc: h.length ? Math.round((corr / h.length) * 100) : 0,
                        mistakes: Object.keys(errFreq).length,
                        topMistakes,
                        timeText,
                        subjectStats,
                        typeStats,
                        daily30,
                        avgDuration,
                        durBuckets,
                        streak,
                        bestSub,
                        worstSub,
                        totalAttempts: h.length,
                        totalCorrect: corr
                    };
                },
                clearMistakeHistory(id) {
                    if (!Array.isArray(this.hiddenMistakeIds)) this.hiddenMistakeIds = [];
                    if (!this.hiddenMistakeIds.includes(id)) {
                        this.hiddenMistakeIds.push(id);
                    }
                    this._errFreqCache = null;
                    this._isHistoryDirty = true;
                    this.saveHistory();
                },
                record(id, res, duration = 0) {
                    const now = Date.now();
                    const entry = { id, r: res, t: now, d: duration };
                    this.history.push(entry);
                    // 增量同步：同时追加到 buffer，供下次 save 时发送
                    this._historyAppendBuffer.push(entry);
                    this.lastPracticeTime = now;
                    this._isHistoryDirty = true;
                    this.saveHistory();
                }
            },

            ai: {
                _messages: [],
                _currentQ: null,
                _isLoading: false,
                _apiKey: '',
                _provider: 'glm',
                _queue: [],
                _isProcessingQueue: false,
                _lastCallAt: 0,
                _minIntervalMs: 1000,
                _monitorEnabled: false,
                _stats: {
                    totalRequests: 0,
                    totalErrors: 0,
                    totalPromptTokens: 0,
                    totalCompletionTokens: 0,
                    lastLatency: 0,
                    lastStatus: null,
                    lastError: '',
                    recent: []
                },

                _providers: {
                    glm: {
                        name: 'GLM-4-Flash (智谱)',
                        endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
                        model: 'glm-4-flash',
                        storageKey: 'lms_api_key_glm',
                        modelStorageKey: 'lms_model_glm',
                        authHeader: (key) => `Bearer ${key}`,
                        docsUrl: 'https://open.bigmodel.cn/usercenter/apikeys'
                    },
                    deepseek: {
                        name: 'DeepSeek-Chat',
                        endpoint: 'https://api.deepseek.com/chat/completions',
                        model: 'deepseek-chat',
                        storageKey: 'lms_api_key_deepseek',
                        modelStorageKey: 'lms_model_deepseek',
                        authHeader: (key) => `Bearer ${key}`,
                        docsUrl: 'https://platform.deepseek.com/api_keys'
                    },
                    openai: {
                        name: 'GPT-4o-mini (OpenAI)',
                        endpoint: 'https://api.openai.com/v1/chat/completions',
                        model: 'gpt-4o-mini',
                        storageKey: 'lms_api_key_openai',
                        modelStorageKey: 'lms_model_openai',
                        authHeader: (key) => `Bearer ${key}`,
                        docsUrl: 'https://platform.openai.com/api-keys'
                    },
                    gemini: {
                        name: 'Gemini 2.0 Flash (Google)',
                        endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
                        model: 'gemini-2.0-flash',
                        storageKey: 'lms_api_key_gemini',
                        modelStorageKey: 'lms_model_gemini',
                        authHeader: (key) => `Bearer ${key}`,
                        docsUrl: 'https://aistudio.google.com/app/apikey'
                    },
                    moonshot: {
                        name: 'Moonshot (Kimi)',
                        endpoint: 'https://api.moonshot.cn/v1/chat/completions',
                        model: 'moonshot-v1-8k',
                        storageKey: 'lms_api_key_moonshot',
                        modelStorageKey: 'lms_model_moonshot',
                        authHeader: (key) => `Bearer ${key}`,
                        docsUrl: 'https://platform.moonshot.cn/console/api-keys'
                    },
                    qwen: {
                        name: '通义千问 (Qwen)',
                        endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
                        model: 'qwen-plus',
                        storageKey: 'lms_api_key_qwen',
                        modelStorageKey: 'lms_model_qwen',
                        authHeader: (key) => `Bearer ${key}`,
                        docsUrl: 'https://dashscope.aliyun.com/apiKey'
                    },
                    baichuan: {
                        name: '百川 Baichuan',
                        endpoint: 'https://api.baichuan-ai.com/v1/chat/completions',
                        model: 'Baichuan4',
                        storageKey: 'lms_api_key_baichuan',
                        modelStorageKey: 'lms_model_baichuan',
                        authHeader: (key) => `Bearer ${key}`,
                        docsUrl: 'https://platform.baichuan-ai.com/console/apikey'
                    },
                    minimax: {
                        name: 'MiniMax',
                        endpoint: 'https://api.minimax.chat/v1/text/chatcompletion_v2',
                        model: 'abab6.5-chat',
                        storageKey: 'lms_api_key_minimax',
                        modelStorageKey: 'lms_model_minimax',
                        authHeader: (key) => `Bearer ${key}`,
                        docsUrl: 'https://www.minimax.chat/document/guides/document_dev_landing'
                    },
                    custom: {
                        name: '自定义 OpenAI 兼容 API',
                        endpoint: '',
                        model: 'gpt-4o-mini',
                        storageKey: 'lms_api_key_custom',
                        modelStorageKey: 'lms_model_custom',
                        authHeader: (key) => `Bearer ${key}`,
                        docsUrl: 'about:blank'
                    }
                },

                init() {
                    this._provider = localStorage.getItem('lms_ai_provider') || 'glm';
                    const cfg = this._providers[this._provider];
                    this._apiKey = cfg ? (localStorage.getItem(cfg.storageKey) || '') : '';

                    const sel = App.dom.get('config-provider-select');
                    if (sel) sel.value = this._provider;

                    const keyInput = App.dom.get('config-api-key');
                    if (keyInput) keyInput.value = this._apiKey;

                    this.updateProviderUI();

                    const monitorFlag = localStorage.getItem('lms_ai_monitor') === '1';
                    this._monitorEnabled = monitorFlag;
                    const monitorToggle = App.dom.get('ai-monitor-toggle');
                    if (monitorToggle) monitorToggle.checked = monitorFlag;
                    this.updateMonitorUI();
                },

                getActiveModelName() {
                    const cfg = this._providers[this._provider];
                    if (!cfg) return '';
                    const key = cfg.modelStorageKey;
                    const saved = key ? (localStorage.getItem(key) || '') : '';
                    return saved || cfg.model;
                },

                getAdvancedParams() {
                    const temp = parseFloat(localStorage.getItem('lms_ai_param_temperature') || '');
                    const topP = parseFloat(localStorage.getItem('lms_ai_param_top_p') || '');
                    const maxTokens = parseInt(localStorage.getItem('lms_ai_param_max_tokens') || '', 10);
                    const presence = parseFloat(localStorage.getItem('lms_ai_param_presence') || '');
                    const frequency = parseFloat(localStorage.getItem('lms_ai_param_frequency') || '');
                    const timeout = parseInt(localStorage.getItem('lms_ai_param_timeout') || '', 10);
                    return {
                        temperature: isFinite(temp) ? temp : 0.7,
                        top_p: isFinite(topP) ? topP : 1.0,
                        max_tokens: isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 1024,
                        presence_penalty: isFinite(presence) ? presence : 0.0,
                        frequency_penalty: isFinite(frequency) ? frequency : 0.0,
                        timeoutMs: isFinite(timeout) ? (timeout > 0 ? timeout : 0) : 60000
                    };
                },

                updateProviderUI() {
                    const cfg = this._providers[this._provider];
                    if (!cfg) return;

                    const keyInput = App.dom.get('config-api-key');
                    if (keyInput) keyInput.placeholder = `输入 ${cfg.name} API Key，可换行填写多个`;

                    const link = App.dom.get('config-docs-link');
                    if (link) {
                        link.href = cfg.docsUrl;
                        link.textContent = `获取 ${cfg.name} Key →`;
                    }

                    const savedKey = localStorage.getItem(cfg.storageKey) || '';
                    this._apiKey = savedKey;
                    if (keyInput) keyInput.value = savedKey;

                    const modelInput = App.dom.get('config-model-name');
                    const activeModel = this.getActiveModelName();
                    if (modelInput) modelInput.value = activeModel;

                    const modelLabel = App.dom.get('config-current-model');
                    if (modelLabel) modelLabel.textContent = activeModel || cfg.model;

                    const adv = this.getAdvancedParams();
                    const tInput = App.dom.get('ai-param-temperature');
                    const pInput = App.dom.get('ai-param-top-p');
                    const mInput = App.dom.get('ai-param-max-tokens');
                    const prInput = App.dom.get('ai-param-presence');
                    const fInput = App.dom.get('ai-param-frequency');
                    const toInput = App.dom.get('ai-param-timeout');
                    if (tInput) tInput.value = String(adv.temperature);
                    if (pInput) pInput.value = String(adv.top_p);
                    if (mInput) mInput.value = String(adv.max_tokens);
                    if (prInput) prInput.value = String(adv.presence_penalty);
                    if (fInput) fInput.value = String(adv.frequency_penalty);
                    if (toInput) toInput.value = String(adv.timeoutMs);
                },

                onProviderChange(val) {
                    this._provider = val;
                    localStorage.setItem('lms_ai_provider', val);
                    this.updateProviderUI();
                },

                saveApiKey() {
                    const keyInput = App.dom.get('config-api-key');
                    const modelInput = App.dom.get('config-model-name');
                    const cfg = this._providers[this._provider];
                    if (keyInput && cfg) {
                        this._apiKey = keyInput.value.trim();
                        localStorage.setItem(cfg.storageKey, this._apiKey);
                    }
                    if (modelInput && cfg) {
                        const val = modelInput.value.trim();
                        if (cfg.modelStorageKey) {
                            if (val) localStorage.setItem(cfg.modelStorageKey, val);
                            else localStorage.removeItem(cfg.modelStorageKey);
                        }
                    }
                    const tInput = App.dom.get('ai-param-temperature');
                    const pInput = App.dom.get('ai-param-top-p');
                    const mInput = App.dom.get('ai-param-max-tokens');
                    const prInput = App.dom.get('ai-param-presence');
                    const fInput = App.dom.get('ai-param-frequency');
                    const toInput = App.dom.get('ai-param-timeout');
                    if (tInput && tInput.value) localStorage.setItem('lms_ai_param_temperature', tInput.value);
                    if (pInput && pInput.value) localStorage.setItem('lms_ai_param_top_p', pInput.value);
                    if (mInput && mInput.value) localStorage.setItem('lms_ai_param_max_tokens', mInput.value);
                    if (prInput && prInput.value) localStorage.setItem('lms_ai_param_presence', prInput.value);
                    if (fInput && fInput.value) localStorage.setItem('lms_ai_param_frequency', fInput.value);
                    if (toInput && toInput.value) localStorage.setItem('lms_ai_param_timeout', toInput.value);
                    this.updateProviderUI();
                    alert(`${cfg?.name || 'API 配置'} 保存成功！支持填写多个 Key，并自定义模型名称。`);
                },

                saveAdvancedParams() {
                    const tInput = App.dom.get('ai-param-temperature');
                    const pInput = App.dom.get('ai-param-top-p');
                    const mInput = App.dom.get('ai-param-max-tokens');
                    const prInput = App.dom.get('ai-param-presence');
                    const fInput = App.dom.get('ai-param-frequency');
                    const toInput = App.dom.get('ai-param-timeout');
                    if (tInput && tInput.value !== '') localStorage.setItem('lms_ai_param_temperature', tInput.value);
                    else localStorage.removeItem('lms_ai_param_temperature');
                    if (pInput && pInput.value !== '') localStorage.setItem('lms_ai_param_top_p', pInput.value);
                    else localStorage.removeItem('lms_ai_param_top_p');
                    if (mInput && mInput.value !== '') localStorage.setItem('lms_ai_param_max_tokens', mInput.value);
                    else localStorage.removeItem('lms_ai_param_max_tokens');
                    if (prInput && prInput.value !== '') localStorage.setItem('lms_ai_param_presence', prInput.value);
                    else localStorage.removeItem('lms_ai_param_presence');
                    if (fInput && fInput.value !== '') localStorage.setItem('lms_ai_param_frequency', fInput.value);
                    else localStorage.removeItem('lms_ai_param_frequency');
                    if (toInput && toInput.value !== '') localStorage.setItem('lms_ai_param_timeout', toInput.value);
                    else localStorage.removeItem('lms_ai_param_timeout');
                    this.updateProviderUI();
                    alert('AI 高级参数已保存。');
                },

                async call(messages, maxTokens = 1024, temperature = 0.7) {
                    return new Promise((resolve, reject) => {
                        this._queue.push({ messages, maxTokens, temperature, resolve, reject });
                        this._drainQueue();
                    });
                },

                async _drainQueue() {
                    if (this._isProcessingQueue) return;
                    this._isProcessingQueue = true;
                    while (this._queue.length) {
                        const job = this._queue.shift();
                        const now = Date.now();
                        const diff = now - this._lastCallAt;
                        if (this._lastCallAt && diff < this._minIntervalMs) {
                            await new Promise(r => setTimeout(r, this._minIntervalMs - diff));
                        }
                        try {
                            const result = await this._executeAPICall(job.messages, job.maxTokens, job.temperature);
                            job.resolve(result.content);
                        } catch (e) {
                            job.reject(e);
                        } finally {
                            this._lastCallAt = Date.now();
                        }
                    }
                    this._isProcessingQueue = false;
                },

                async _executeAPICall(messages, maxTokens, temperature) {
                    const cfg = this._providers[this._provider];
                    if (!cfg) throw new Error('未知的模型提供商 (Unknown Provider)');
                    if (!this._apiKey) throw new Error('请先在设置中配置 API Key (API Key missing)');

                    const adv = this.getAdvancedParams();
                    const finalTemp = Number.isFinite(temperature) ? temperature : adv.temperature;
                    const bodyMax = typeof maxTokens === 'number' ? maxTokens : adv.max_tokens;
                    const topP = adv.top_p;
                    const presencePenalty = adv.presence_penalty;
                    const frequencyPenalty = adv.frequency_penalty;
                    const timeoutMs = adv.timeoutMs;

                    const start = Date.now();
                    let status = 0;
                    let abortId = null;
                    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
                    try {
                        const rawKey = this._apiKey || '';
                        const keyList = rawKey
                            .split(/[\n,;]/)
                            .map(s => s.trim())
                            .filter(Boolean);
                        if (!keyList.length) throw new Error('API Key 为空，请在设置中填写至少一个 Key');
                        const keyIndex = Math.floor(Math.random() * keyList.length);
                        const useKey = keyList[keyIndex];
                        const endpoint = cfg.endpoint || localStorage.getItem('lms_ai_custom_endpoint') || '';
                        if (controller && typeof timeoutMs === 'number' && timeoutMs > 0) {
                            abortId = setTimeout(() => controller.abort(), timeoutMs);
                        }
                        const response = await fetch(endpoint, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': cfg.authHeader(useKey)
                            },
                            signal: controller ? controller.signal : undefined,
                            body: JSON.stringify({
                                model: this.getActiveModelName(),
                                messages,
                                stream: false,
                                max_tokens: bodyMax,
                                temperature: finalTemp,
                                top_p: topP,
                                presence_penalty: presencePenalty,
                                frequency_penalty: frequencyPenalty
                            })
                        });
                        status = response.status;
                        const latency = Date.now() - start;
                        if (!response.ok) {
                            if (status === 429 || status === 503) {
                                this._minIntervalMs = Math.min(this._minIntervalMs * 2, 10000);
                            }
                            const errBody = await response.text();
                            this._updateMetrics({
                                ok: false,
                                status,
                                latency,
                                usage: null,
                                provider: this._provider,
                                model: cfg.model,
                                errorMessage: errBody.slice(0, 200)
                            });
                            throw new Error(`API Error ${status}: ${errBody.slice(0, 200)}`);
                        }
                        const data = await response.json();
                        const usage = data && data.usage ? data.usage : null;
                        this._updateMetrics({
                            ok: true,
                            status,
                            latency,
                            usage,
                            provider: this._provider,
                            model: cfg.model,
                            errorMessage: ''
                        });
                        const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content ? data.choices[0].message.content : '';
                        return { content, usage };
                    } catch (e) {
                        if (!status) {
                            const latency = Date.now() - start;
                            this._updateMetrics({
                                ok: false,
                                status: status || 0,
                                latency,
                                usage: null,
                                provider: this._provider,
                                model: cfg.model,
                                errorMessage: e && e.message ? e.message : String(e)
                            });
                        }
                        if (e && e.name === 'AbortError') {
                            throw new Error('请求超时，请稍后重试。');
                        }
                        throw e;
                    } finally {
                        if (abortId) clearTimeout(abortId);
                    }
                },

                _updateMetrics(info) {
                    if (!this._stats) {
                        this._stats = {
                            totalRequests: 0,
                            totalErrors: 0,
                            totalPromptTokens: 0,
                            totalCompletionTokens: 0,
                            lastLatency: 0,
                            lastStatus: null,
                            lastError: '',
                            recent: []
                        };
                    }
                    this._stats.totalRequests++;
                    if (!info.ok) this._stats.totalErrors++;
                    const pt = info.usage && typeof info.usage.prompt_tokens === 'number' ? info.usage.prompt_tokens : 0;
                    const ct = info.usage && typeof info.usage.completion_tokens === 'number' ? info.usage.completion_tokens : 0;
                    this._stats.totalPromptTokens += pt;
                    this._stats.totalCompletionTokens += ct;
                    this._stats.lastLatency = info.latency;
                    this._stats.lastStatus = info.status;
                    this._stats.lastError = info.errorMessage || '';
                    const now = Date.now();
                    const record = {
                        ts: now,
                        provider: info.provider,
                        model: info.model,
                        ok: info.ok,
                        status: info.status,
                        latency: info.latency,
                        promptTokens: pt || null,
                        completionTokens: ct || null
                    };
                    this._stats.recent.push(record);
                    if (this._stats.recent.length > 20) this._stats.recent.shift();
                    this.updateMonitorUI();
                },

                getLastUsageRecord() {
                    if (!this._stats || !this._stats.recent || !this._stats.recent.length) return null;
                    const last = this._stats.recent[this._stats.recent.length - 1];
                    if (last && (last.promptTokens != null || last.completionTokens != null)) return last;
                    return null;
                },

                toggleMonitor(enabled) {
                    this._monitorEnabled = !!enabled;
                    localStorage.setItem('lms_ai_monitor', this._monitorEnabled ? '1' : '0');
                    this.updateMonitorUI();
                },

                updateMonitorUI() {
                    const panel = App.dom.get('ai-monitor-panel');
                    const summaryEl = App.dom.get('ai-monitor-summary');
                    const listEl = App.dom.get('ai-monitor-requests');
                    const toggle = App.dom.get('ai-monitor-toggle');
                    if (!panel || !summaryEl || !listEl || !toggle) return;
                    if (this._monitorEnabled) {
                        panel.classList.remove('hidden');
                        toggle.checked = true;
                    } else {
                        panel.classList.add('hidden');
                        toggle.checked = false;
                        return;
                    }
                    const s = this._stats || {
                        totalRequests: 0,
                        totalErrors: 0,
                        totalPromptTokens: 0,
                        totalCompletionTokens: 0,
                        lastLatency: 0,
                        lastStatus: null
                    };
                    const cfg = this._providers[this._provider];
                    const providerName = cfg ? cfg.name : this._provider;
                    const totalTokens = s.totalPromptTokens + s.totalCompletionTokens;
                    let tokenText = '';
                    if (totalTokens > 0) {
                        tokenText = `，Token 用量：提示 ${s.totalPromptTokens}，回答 ${s.totalCompletionTokens}，合计 ${totalTokens}`;
                    }
                    const statusText = typeof s.lastStatus === 'number' && s.lastStatus > 0 ? `，最近状态码：${s.lastStatus}` : '';
                    const latencyText = s.lastLatency ? `，最近延迟：${s.lastLatency}ms` : '';
                    summaryEl.textContent = `${providerName} · 最小间隔 ${this._minIntervalMs}ms · 请求 ${s.totalRequests} 次，错误 ${s.totalErrors} 次${statusText}${latencyText}${tokenText}`;
                    const records = (s.recent || []).slice().reverse();
                    if (!records.length) {
                        listEl.innerHTML = '<div class="text-[10px] text-[var(--sub)]">暂无调用记录。</div>';
                        return;
                    }
                    const rows = records.slice(0, 10).map(r => {
                        const date = new Date(r.ts);
                        const time = date.toLocaleTimeString();
                        const status = r.ok ? 'OK' : 'ERR';
                        const tokens = r.promptTokens != null || r.completionTokens != null ? `${r.promptTokens || 0}/${r.completionTokens || 0}` : '无';
                        return `<div class="flex justify-between gap-2"><span class="flex-1 truncate">${time} · ${r.model}</span><span class="w-10 text-right">${status}</span><span class="w-14 text-right">${r.latency}ms</span><span class="w-16 text-right">${tokens}</span></div>`;
                    });
                    listEl.innerHTML = rows.join('');
                },

                setContext(q) {
                    this._currentQ = q;
                    this._messages = [];
                    const msgArea = App.dom.get('ai-chat-messages');
                    if (msgArea) msgArea.innerHTML = `
                        <div id="ai-chat-welcome" class="text-xs text-[var(--sub)] text-center py-4">
                            ✨ 对这道题有疑问？向 AI 提问吧 (Ask AI about this question)
                        </div>`;
                    const input = App.dom.get('ai-chat-input');
                    if (input) { input.value = ''; input.style.height = 'auto'; }
                },

                buildSystemPrompt(q) {
                    let optionsText = '';
                    if (q.type === 'mcq' || q.type === 'multi') {
                        optionsText = '\n选项：\n' + (q.o || []).map((o, i) =>
                            `${String.fromCharCode(65 + i)}. ${o}`
                        ).join('\n');
                    }
                    const typeMap = { mcq: '单选题', tf: '判断题', multi: '多选题' };
                    const answerText = q.type === 'tf'
                        ? (q.a === 'T' ? '正确' : '错误')
                        : q.a;

                    return `你是一个专业的学习助手。用户正在学习以下题目，请基于题目内容回答用户的问题，解释知识点，帮助用户理解。回答请简洁清晰，使用中文。

            题目信息：
            科目：${q.sub}
            章节：${q.chap}
            题型：${typeMap[q.type] || q.type}
            题目：${q.q}${optionsText}
            正确答案：${answerText}

            请根据以上题目内容回答用户的问题。如果用户的问题与题目无关，也可以适当回答，但优先聚焦在题目知识点上。`;
                },

                buildMistakeProfile(pool) {
                    return pool.map(q => {
                        const records = App.data.history.filter(h => h.id === q.id);
                        const totalAttempts = records.length;
                        const wrongAttempts = records.filter(h => !h.r).length;
                        const errorRate = totalAttempts > 0 ? Math.round((wrongAttempts / totalAttempts) * 100) : 100;

                        const durRecords = records.filter(h => h.d > 0);
                        const avgDuration = durRecords.length > 0
                            ? Math.round(durRecords.reduce((s, h) => s + h.d, 0) / durRecords.length / 1000)
                            : null;

                        const lastRecord = records[records.length - 1];
                        const lastCorrect = lastRecord ? lastRecord.r : false;

                        let consecutiveWrong = 0;
                        for (let i = records.length - 1; i >= 0; i--) {
                            if (!records[i].r) consecutiveWrong++;
                            else break;
                        }

                        const daysSinceLastAttempt = lastRecord
                            ? Math.round((Date.now() - lastRecord.t) / 86400000)
                            : 999;

                        return {
                            id: q.id,
                            q: q.q.slice(0, 30),
                            sub: q.sub,
                            errorRate,
                            avgDuration,
                            consecutiveWrong,
                            lastCorrect,
                            daysSinceLastAttempt,
                            totalAttempts
                        };
                    });
                },

                buildAnalysisPrompt(profiles) {
                    const profileText = profiles.map((p, i) =>
                        `${i + 1}. [${p.sub}] "${p.q}..." | 错误率:${p.errorRate}% | 连续答错:${p.consecutiveWrong}次 | 平均用时:${p.avgDuration ?? '未知'}秒 | 上次答题:${p.daysSinceLastAttempt}天前 | 最近一次:${p.lastCorrect ? '✓正确' : '✗错误'} | 共答:${p.totalAttempts}次`
                    ).join('\n');

                    return `你是一个基于认知心理学和记忆科学的学习分析助手。以下是学生的错题数据，请根据以下原则分析并给出最优的复习顺序：

分析原则：
1. 遗忘曲线：距上次作答越久且当时答错的题，遗忘风险越高，优先级越高
2. 顽固错题：连续答错次数越多，说明知识点越薄弱，需要优先强化
3. 作答时长：用时极短但答错（可能是猜的）和用时极长但答错（理解困难），都需要重点关注
4. 近期状态：最近一次仍答错的题比已答对的更紧迫
5. 错误率权重：错误率越高，越需要优先复习

题目数据（共${profiles.length}道）：
${profileText}

请返回一个JSON数组，格式如下，按复习优先级从高到低排列：
[
  { "id": "题目id", "priority": "high/medium/low", "reason": "简短的分析原因（20字内）", "strategy": "quick_review/deep_study/reinforce" }
]

strategy含义：quick_review=快速过一遍即可, deep_study=需要深入理解, reinforce=需要反复强化

只返回JSON，不要其他文字。`;
                },

                _extractJson(text) {
                    if (typeof text !== 'string') return text;
                    const arrMatch = text.match(/\[[\s\S]*\]/);
                    const objMatch = text.match(/\{[\s\S]*\}/);
                    if (arrMatch && objMatch) {
                        return arrMatch.index < objMatch.index ? arrMatch[0] : objMatch[0];
                    }
                    return arrMatch ? arrMatch[0] : (objMatch ? objMatch[0] : text);
                },

                async analyzeMistakes(pool) {
                    let analysisPool = pool;
                    if (pool.length > 50) {
                        analysisPool = [...pool].sort((a, b) => App.data.getMistakeCount(b.id) - App.data.getMistakeCount(a.id)).slice(0, 50);
                    }

                    const profiles = this.buildMistakeProfile(analysisPool);

                    const raw = await this.call(
                        [{ role: 'user', content: this.buildAnalysisPrompt(profiles) }],
                        2048, 0.3
                    );

                    const cleaned = this._extractJson(raw);
                    const parsed = JSON.parse(cleaned);
                    const usage = this.getLastUsageRecord && this.getLastUsageRecord();
                    if (usage) {
                        const total = (usage.promptTokens || 0) + (usage.completionTokens || 0);
                        console.info(`[AI Mistake Analysis] tokens: prompt=${usage.promptTokens || 0}, completion=${usage.completionTokens || 0}, total=${total}`);
                    }
                    return parsed;
                },

                // 基于原始文本构造题库导入提示词
                buildImportPrompt(rawText) {
                    const example = `{
  "示例科目": {
    "第1章 示例章节": [
      {
        "id": "ex-001",
        "type": "mcq",
        "q": "示例单选题：下面哪一项是……？",
        "o": ["选项A", "选项B", "选项C", "选项D"],
        "a": "B"
      },
      {
        "id": "ex-002",
        "type": "tf",
        "q": "示例判断题：下列说法是否正确？",
        "a": "T"
      },
      {
        "id": "ex-003",
        "type": "multi",
        "q": "示例多选题：下面哪些选项是正确的？",
        "o": ["选项A", "选项B", "选项C"],
        "a": "AC"
      }
    ]
  }
}`;

                    return `你是一名专业的试题结构化助手，任务是从原始文档文本中自动识别出客观题并整理成统一的 JSON 题库格式。

【题型范围（非常重要）】
只抽取以下三种题型，其他类型（如填空题、简答题、主观题、计算题、证明题等）一律忽略、不要出现在 JSON 中：
1. 单选题（mcq）：只有一个正确选项
2. 多选题（multi）：有多个正确选项
3. 判断题（tf）：对/错、是/否、正确/错误

【JSON 目标结构】
根对象是一个字典：键为科目名称（字符串），值为「章节字典」。
章节字典的键为章节名称（字符串），值为题目数组。
每个题目对象必须满足下面模式（不要增加多余字段）：
- id: 字符串，题目标识，保证在全局范围内唯一（可以用「科目简写 + 序号」等方式生成）
- type: "mcq" | "multi" | "tf"
- q: 题干文本（不含选项字母）
- o: 仅对 mcq 和 multi 必须，为选项数组，例如 ["选项A","选项B","选项C","选项D"]
- a:
  - 对 mcq：正确选项的字母，例如 "A"
  - 对 multi：所有正确选项的字母按字母顺序拼接，例如 "AC"、"BD"
  - 对 tf：正确为 "T"，错误为 "F"

【JSON 示例】
${example}

【解析规则建议】
- 尝试识别原文中的科目名称和章节标题（如「一、微观经济学」「第1章 需求与供给」），据此进行分组；如果无法可靠识别，可以将所有题目放入同一个科目和章节下，例如科目名为「默认科目」、章节名为「默认章节」。
- 单选 / 多选选项前通常带有「A.」「B.」「C.」或「A、」「B、」等前缀，请去掉这些前缀，仅保留选项内容。
- 多选题的答案可能以「ABCD」「AC」「B、C」等形式出现，请自动规范为按字母顺序排列且不带分隔符的形式，例如 "AC"。
- 判断题的答案如果是「正确/错误」「对/错」「T/F」，请统一转换为 "T" 或 "F"。
- 严格保证输出是合法的 JSON，键名用双引号包裹，不要在 JSON 外多输出任何说明性文字。

【待解析原始内容】
${rawText}

请直接输出最终 JSON 对象，不要添加解释或注释。`;
                },

                // 只保留单选 / 多选 / 判断题，过滤掉其他类型
                sanitizeImportedBank(obj) {
                    const allowed = new Set(['mcq', 'multi', 'tf']);
                    const result = {};
                    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return result;

                    for (const [sub, chapDict] of Object.entries(obj)) {
                        if (!chapDict || typeof chapDict !== 'object' || Array.isArray(chapDict)) continue;
                        const cleanedChaps = {};
                        for (const [chap, arr] of Object.entries(chapDict)) {
                            if (!Array.isArray(arr)) continue;
                            const cleanedQs = arr
                                .filter(q => q && allowed.has(q.type))
                                .map(q => {
                                    const copy = { ...q };
                                    if ((copy.type === 'mcq' || copy.type === 'multi') && Array.isArray(copy.o)) {
                                        copy.o = copy.o.map(opt => {
                                            if (typeof opt !== 'string') return opt;
                                            return opt.replace(/^\s*[A-ZＡ-Ｚ][\.\．、，\)\）]\s*/, '');
                                        });
                                    }
                                    return copy;
                                });
                            if (cleanedQs.length > 0) cleanedChaps[chap] = cleanedQs;
                        }
                        if (Object.keys(cleanedChaps).length > 0) result[sub] = cleanedChaps;
                    }
                    return result;
                },

                // 从 modal 文本框中读取原始内容，调用大模型生成题库 JSON（仅写入预览区，不直接导入）
                async importFromRawText() {
                    if (this._isLoading) return;

                    if (!this._apiKey) {
                        alert("请先在【设置】中选择模型并配置对应的 API Key。");
                        return;
                    }

                    const textarea = App.dom.get('ai-import-raw');
                    const previewEl = App.dom.get('ai-import-preview');
                    const statusEl = App.dom.get('ai-import-status');
                    const raw = textarea ? textarea.value.trim() : '';
                    if (!raw) {
                        alert("请先上传文档或在文本框中粘贴试题内容。");
                        return;
                    }

                    const maxLen = 20000;
                    const limited = raw.length > maxLen ? raw.slice(0, maxLen) : raw;
                    const segmentSize = 4000;
                    const segments = [];
                    for (let i = 0; i < limited.length; i += segmentSize) {
                        segments.push(limited.slice(i, i + segmentSize));
                    }

                    this._isLoading = true;
                    if (previewEl) previewEl.value = '';
                    if (statusEl) statusEl.textContent = "🧠 正在分段调用 AI 识别题目并生成题库 JSON，请稍候…";

                    try {
                        const merged = {};
                        let totalPrompt = 0;
                        let totalCompletion = 0;
                        for (let i = 0; i < segments.length; i++) {
                            const seg = segments[i];
                            const prompt = this.buildImportPrompt(seg);
                            if (statusEl) statusEl.textContent = `🧠 正在处理第 ${i + 1} / ${segments.length} 段文本…`;
                            const reply = await this.call(
                                [{ role: 'user', content: prompt }],
                                4096,
                                0.2
                            );
                            const lastUsage = this.getLastUsageRecord && this.getLastUsageRecord();
                            if (lastUsage) {
                                totalPrompt += lastUsage.promptTokens || 0;
                                totalCompletion += lastUsage.completionTokens || 0;
                            }
                            const cleaned = this._extractJson(reply);
                            const obj = JSON.parse(cleaned);
                            const sanitized = this.sanitizeImportedBank(obj);
                            for (const [sub, chapDict] of Object.entries(sanitized)) {
                                if (!merged[sub]) merged[sub] = {};
                                for (const [chap, arr] of Object.entries(chapDict)) {
                                    if (!merged[sub][chap]) merged[sub][chap] = [];
                                    merged[sub][chap] = merged[sub][chap].concat(arr);
                                }
                            }
                        }
                        if (!Object.keys(merged).length) {
                            if (statusEl) statusEl.textContent = "⚠️ AI 未识别到任何单选/多选/判断题，请检查原文格式后重试。";
                            alert("AI 未识别到任何符合要求的客观题（mcq/multi/tf）。");
                            return;
                        }
                        const pretty = JSON.stringify(merged, null, 2);
                        if (previewEl) previewEl.value = pretty;
                        if (statusEl) {
                            const tokenTip = totalPrompt + totalCompletion > 0
                                ? ` 本次 Token 用量：提示 ${totalPrompt}，回答 ${totalCompletion}，合计 ${totalPrompt + totalCompletion}。`
                                : '';
                            statusEl.textContent = "✅ 已生成 JSON 预览（仅包含单选/多选/判断题），请确认无误后再点击「导入预览 JSON 到题库」。" + tokenTip;
                        }
                    } catch (e) {
                        console.error("AI import error", e);
                        if (statusEl) statusEl.textContent = "❌ AI 识别或预览生成失败：" + (e.message || e.toString());
                        alert("AI 识别或预览生成失败，请检查状态栏中的错误信息。");
                    } finally {
                        this._isLoading = false;
                    }
                },

                // 从只读预览区读取 JSON 并导入题库
                importFromPreview() {
                    const previewEl = App.dom.get('ai-import-preview');
                    const statusEl = App.dom.get('ai-import-status');
                    const reportEl = App.dom.get('ai-import-report');
                    const text = previewEl ? previewEl.value.trim() : '';
                    if (!text) {
                        alert("预览区为空，请先生成 JSON 预览。");
                        return;
                    }
                    try {
                        const obj = JSON.parse(text);
                        const sanitized = this.sanitizeImportedBank(obj);
                        if (!Object.keys(sanitized).length) {
                            if (statusEl) statusEl.textContent = "⚠️ 预览 JSON 中没有单选/多选/判断题，未导入任何题目。";
                            alert("预览 JSON 中没有包含 type 为 mcq/multi/tf 的题目。");
                            return;
                        }
                        // 统计本次即将导入的题目数量，并进行二次确认
                        let questionCount = 0;
                        for (const sub in sanitized) {
                            const chapDict = sanitized[sub] || {};
                            for (const chap in chapDict) {
                                const arr = chapDict[chap];
                                if (Array.isArray(arr)) questionCount += arr.length;
                            }
                        }
                        const ok = confirm(`即将根据预览 JSON 导入约 ${questionCount} 道题（仅单选/多选/判断题），是否继续？`);
                        if (!ok) {
                            if (statusEl) statusEl.textContent = "已取消本次导入，请检查预览 JSON 是否符合预期。";
                            return;
                        }

                        const report = App.data.importBank(JSON.stringify(sanitized));
                        if (!report) {
                            if (statusEl) statusEl.textContent = "❌ 导入失败，请检查 JSON 格式或控制台错误信息。";
                            return;
                        }
                        if (statusEl) statusEl.textContent = "✅ 已根据预览 JSON 成功导入题库（仅包含单选/多选/判断题）。";

                        // 展示导入报告及疑似相似题提醒
                        if (reportEl) {
                            const r = App.data._lastImportReport;
                            if (r) {
                                let html = `<div class="font-bold mb-1">导入结果摘要：</div>
                                    <ul class="list-disc ml-4 space-y-0.5">
                                        <li>新增题目：${r.added}</li>
                                        <li>覆盖更新：${r.updated}</li>
                                        <li>完全重复跳过：${r.skippedSame}</li>
                                        <li>疑似相似题组：${r.similarPairs.length}</li>
                                    </ul>`;
                                if (r.similarPairs.length) {
                                    html += `<div class="mt-2 font-bold">疑似相似题预警（仅展示前 5 组）：</div>`;
                                    r.similarPairs.slice(0, 5).forEach((pair, idx) => {
                                        const subEsc = App.utils.escapeHTML(pair.sub || '');
                                        const chapEsc = App.utils.escapeHTML(pair.chap || '');
                                        const existQ = App.utils.escapeHTML(pair.existing?.q || '');
                                        const incomingQ = App.utils.escapeHTML(pair.incoming?.q || '');
                                        html += `<div class="mt-1.5 p-1.5 rounded border border-[var(--border)] bg-[var(--card)]">
                                            <div class="text-[10px] text-[var(--sub)] mb-1">#${idx + 1} [${subEsc} / ${chapEsc}] 相似度：${(pair.score * 100).toFixed(0)}%</div>
                                            <div class="text-[11px] text-emerald-700 mb-0.5">现有：${existQ}</div>
                                            <div class="text-[11px] text-sky-700">新题：${incomingQ}</div>
                                        </div>`;
                                    });
                                    html += `<div class="mt-1 text-[10px] text-[var(--sub)]">可以点击下方按钮进入「疑似相似题审查」界面，逐题决定是否保留。</div>
                                             <button onclick="App.ui.openSimilarReview()" class="mt-2 px-2 py-1 rounded border border-amber-200 bg-amber-50 text-amber-700 text-[10px] hover:bg-amber-100 active:scale-95">
                                                打开疑似相似题审查
                                             </button>`;
                                }
                                reportEl.innerHTML = html;
                                reportEl.classList.remove('hidden');
                            }
                        }
                    } catch (e) {
                        console.error("Import from preview error", e);
                        if (statusEl) statusEl.textContent = "❌ 预览 JSON 解析失败：" + (e.message || e.toString());
                        alert("预览 JSON 不是合法的 JSON 格式，请检查后重试。");
                    }
                },

                async send() {
                    if (this._isLoading || !this._currentQ) return;
                    if (!this._apiKey) {
                        alert("请先在设置中选择模型并配置对应的 API Key。(Please select a model and configure API Key in Settings first.)");
                        return;
                    }

                    const input = App.dom.get('ai-chat-input');
                    const userText = input ? input.value.trim() : '';
                    if (!userText) return;

                    input.value = '';
                    input.style.height = 'auto';

                    this.appendMessage('user', userText);
                    this._messages.push({ role: 'user', content: userText });

                    const loadingId = `ai-msg-loading-${Date.now()}`;
                    this.appendMessage('assistant', '...', loadingId);

                    this._isLoading = true;
                    App.dom.get('ai-send-btn').disabled = true;

                    try {
                        const aiText = await this.call(
                            [{ role: 'system', content: this.buildSystemPrompt(this._currentQ) }, ...this._messages],
                            1024, 0.7
                        );
                        const usage = this.getLastUsageRecord && this.getLastUsageRecord();
                        let decorated = aiText;
                        if (usage && (usage.promptTokens || usage.completionTokens)) {
                            const p = usage.promptTokens || 0;
                            const c = usage.completionTokens || 0;
                            const total = p + c;
                            decorated = aiText + `\n\n—— 本次 Token：提示 ${p}，回答 ${c}，合计 ${total}`;
                        }
                        this.replaceMessage(loadingId, decorated);
                        this._messages.push({ role: 'assistant', content: aiText });

                    } catch (e) {
                        this.replaceMessage(loadingId, `❌ 请求失败：${e.message}`);
                    } finally {
                        this._isLoading = false;
                        const btn = App.dom.get('ai-send-btn');
                        if (btn) btn.disabled = false;
                    }
                },

                handleKeydown(e) {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        this.send();
                    }
                },

                autoResize(el) {
                    el.style.height = 'auto';
                    el.style.height = Math.min(el.scrollHeight, 96) + 'px';
                },

                appendMessage(role, content, id = '') {
                    const msgArea = App.dom.get('ai-chat-messages');
                    if (!msgArea) return;

                    const welcome = msgArea.querySelector('#ai-chat-welcome');
                    if (welcome) welcome.remove();

                    const div = document.createElement('div');
                    if (id) div.id = id;

                    if (role === 'user') {
                        div.className = 'flex justify-end';
                        div.innerHTML = `<div class="max-w-[85%] bg-primary-600 text-white text-xs rounded-2xl rounded-br-sm px-3 py-2 leading-relaxed whitespace-pre-wrap shadow-sm">${App.utils.escapeHTML(content)}</div>`;
                    } else {
                        div.className = 'flex justify-start';
                        div.innerHTML = `<div class="max-w-[85%] bg-[var(--card)] border border-[var(--border)] text-xs rounded-2xl rounded-bl-sm px-3 py-2 leading-relaxed text-[var(--text)] whitespace-pre-wrap shadow-sm">${content === '...' ? '<span class="animate-pulse">AI 正在思考...</span>' : App.utils.escapeHTML(content)}</div>`;
                    }

                    msgArea.appendChild(div);
                    msgArea.scrollTop = msgArea.scrollHeight;
                },

                replaceMessage(id, content) {
                    const el = App.dom.get(id);
                    if (!el) return;
                    el.querySelector('div').innerHTML = App.utils.escapeHTML(content);
                    const msgArea = App.dom.get('ai-chat-messages');
                    if (msgArea) msgArea.scrollTop = msgArea.scrollHeight;
                },

                clearChat() {
                    if (this._currentQ) this.setContext(this._currentQ);
                }
            },

            quiz: {
                queue: [], idx: 0, stats: { c: 0, w: 0 }, currentMultiSelection: new Set(), lastConfig: null,
                _questionStartTime: null,
                _isAnalyzing: false,
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

                async initWithAI() {
                    // 修复 3: 防重复并发锁 (Mutex Lock)
                    if (this._isAnalyzing) return;

                    const aiModeOn = document.getElementById('ai-mode-toggle')?.checked;

                    if (!aiModeOn) {
                        this.init('mistakes');
                        return;
                    }

                    if (!App.ai._apiKey) {
                        alert("AI 模式需要先在设置中选择模型并配置对应的 API Key。(AI mode requires API Provider configuration first.)");
                        return;
                    }

                    let pool = App.data.getQuestions();
                    const errIds = new Set(App.data.history.filter(h => !h.r).map(h => h.id));
                    pool = pool.filter(q => errIds.has(q.id));

                    if (!pool.length) {
                        alert("太棒了！暂无错题。(Great job! No mistakes found.)");
                        return;
                    }

                    this._isAnalyzing = true;
                    const btn = document.querySelector('[onclick="App.quiz.initWithAI()"]');
                    const originalText = btn?.innerHTML;
                    if (btn) btn.innerHTML = '🧠 分析中...';

                    try {
                        const analysisResult = await App.ai.analyzeMistakes(pool);

                        const priorityWeight = { high: 3, medium: 2, low: 1 };
                        const analysisMap = new Map(analysisResult.map(r => [r.id, r]));

                        pool.sort((a, b) => {
                            const wa = priorityWeight[analysisMap.get(a.id)?.priority] || 0;
                            const wb = priorityWeight[analysisMap.get(b.id)?.priority] || 0;
                            return wb - wa;
                        });

                        pool = pool.map(q => ({
                            ...q,
                            _aiAnalysis: analysisMap.get(q.id) || null
                        }));

                        this.lastConfig = { mode: 'mistakes', options: {} };
                        this.queue = pool;
                        this.idx = 0;
                        this.stats = { c: 0, w: 0 };
                        App.router.go('quiz');
                        this.render();

                    } catch (e) {
                        alert(`AI 分析失败：${e.message}\n将使用普通模式开始。(Falling back to normal mode.)`);
                        this.init('mistakes');
                    } finally {
                        this._isAnalyzing = false;
                        if (btn) btn.innerHTML = originalText;
                    }
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

                    const aiTag = App.dom.get('q-ai-tag');
                    if (aiTag) {
                        if (q._aiAnalysis) {
                            const priorityColor = { high: 'text-red-500 bg-red-50 dark:bg-red-900/20', medium: 'text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20', low: 'text-green-600 bg-green-50 dark:bg-green-900/20' };
                            const strategyLabel = { quick_review: '快速过', deep_study: '深入理解', reinforce: '反复强化' };
                            const p = q._aiAnalysis;
                            aiTag.className = `text-[9px] font-bold px-2 py-0.5 rounded border ${priorityColor[p.priority] || ''}`;
                            aiTag.textContent = `🧠 ${strategyLabel[p.strategy] || ''} · ${p.reason}`;
                            aiTag.classList.remove('hidden');
                        } else {
                            aiTag.classList.add('hidden');
                        }
                    }

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
                        App.dom.setText('fb-icon', '🎉');
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
            },

            router: {
                validViews: ['dashboard', 'setup', 'library', 'quiz', 'result', 'analytics'],
                currentView: 'dashboard',

                go(id) {
                    const targetId = id === 'mistake_book' ? 'library' : id;

                    if (!this.validViews.includes(targetId)) {
                        console.error(`[Router Error] Invalid view attempt: "${id}". Falling back to dashboard.`);
                        this.go('dashboard');
                        return;
                    }

                    const targetEl = App.dom.get(`view-${targetId}`);
                    if (!targetEl) return;

                    document.querySelectorAll('.view-section').forEach(e => e.classList.add('hidden'));

                    let libMode = 'all';
                    if (id === 'mistake_book') libMode = 'mistakes';

                    targetEl.classList.remove('hidden');
                    this.currentView = targetId;

                    if (id === 'dashboard') App.views.dashboard.render();
                    if (id === 'setup') App.views.setup.render();
                    if (id === 'library' || id === 'mistake_book') App.views.library.render(libMode);
                    if (id === 'analytics') App.views.analytics.render();
                },
                refresh() {
                    const view = this.currentView || 'dashboard';
                    if (view === 'quiz' || view === 'result') return;
                    this.go(view);
                },
                init() { this.go('dashboard'); }
            },

            views: {
                dashboard: {
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
                },
                setup: {
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
                },
                library: {
                    currentMode: 'all',
                    _searchQuery: '',
                    _debounceTimer: null,
                    _scrollListenerAttached: false,
                    _searchKeydownAttached: false,
                    _expandAll: false,
                    // 管理模式与选中集合
                    _manageMode: false,
                    _selectedIds: new Set(),

                    handleTypeChange() { this.render(); },
                    handleFilterChange() { this.render(); },

                    handleSearch(val) {
                        clearTimeout(this._debounceTimer);
                        const clearBtn = App.dom.get('lib-search-clear');
                        if (clearBtn) clearBtn.classList.toggle('hidden', val.length === 0);

                        this._debounceTimer = setTimeout(() => {
                            this._searchQuery = val.trim().toLowerCase();
                            this.render();
                        }, 300);
                    },

                    clearSearch() {
                        const input = App.dom.get('lib-search');
                        if (input) input.value = '';
                        this.handleSearch('');
                    },

                    backToTop() {
                        const listEl = App.dom.get('lib-list');
                        if (listEl) listEl.scrollTo({ top: 0, behavior: 'smooth' });
                    },

                    toggleExpandAll() {
                        this._expandAll = !this._expandAll;
                        const listEl = App.dom.get('lib-list');
                        if (!listEl) return;
                        const panels = listEl.querySelectorAll('.details-panel');
                        panels.forEach(p => {
                            if (this._expandAll) p.classList.remove('hidden');
                            else p.classList.add('hidden');
                        });
                        const btn = App.dom.get('lib-toggle-expand');
                        if (btn) {
                            btn.classList.toggle('bg-primary-600', this._expandAll);
                            btn.classList.toggle('text-white', this._expandAll);
                        }
                    },

                    toggleDetails(el) {
                        const container = el.closest('.p-4');
                        if (!container) return;
                        const panel = container.querySelector('.details-panel');
                        if (!panel) return;
                        panel.classList.toggle('hidden');
                    },

                    // 切换管理模式：显示/隐藏多选框和管理工具条
                    toggleManageMode() {
                        this._manageMode = !this._manageMode;
                        this._selectedIds = new Set();

                        const listEl = App.dom.get('lib-list');
                        if (listEl) {
                            const chks = listEl.querySelectorAll('.lib-select-chk');
                            chks.forEach(chk => {
                                chk.classList.toggle('hidden', !this._manageMode);
                                chk.checked = false;
                            });
                        }

                        const bar = App.dom.get('lib-manage-bar');
                        if (bar) bar.classList.toggle('hidden', !this._manageMode);
                        App.dom.setText('lib-selected-count', '0');

                        const btn = App.dom.get('lib-manage-toggle');
                        if (btn) {
                            btn.classList.toggle('bg-primary-600', this._manageMode);
                            btn.classList.toggle('text-white', this._manageMode);
                        }
                    },

                    // 多选框变化时更新选中集合
                    handleSelectChange(el) {
                        const id = el.dataset.id;
                        if (!id) return;
                        if (el.checked) this._selectedIds.add(id);
                        else this._selectedIds.delete(id);
                        App.dom.setText('lib-selected-count', String(this._selectedIds.size));
                    },

                    // 单题删除：软删除到回收站
                    deleteSingle(id) {
                        if (!confirm("确定删除这道题吗？此操作会将题目放入回收站，可在回收站中恢复。")) return;
                        App.data.softDeleteByIds(new Set([id]), 'manual-delete');
                        this.render(this.currentMode);
                    },

                    // 批量删除选中
                    bulkDeleteSelected() {
                        if (!this._selectedIds || this._selectedIds.size === 0) {
                            alert("请先勾选至少一题再执行批量删除。");
                            return;
                        }
                        if (!confirm(`确定删除选中的 ${this._selectedIds.size} 道题目吗？这些题将被移入回收站，可在回收站中恢复。`)) return;
                        App.data.softDeleteByIds(this._selectedIds, 'manual-delete-bulk');
                        this._selectedIds = new Set();
                        App.dom.setText('lib-selected-count', '0');
                        this.render(this.currentMode);
                    },

                    // 批量导出选中为 JSON
                    exportSelected() {
                        if (!this._selectedIds || this._selectedIds.size === 0) {
                            alert("请先勾选至少一题再导出。");
                            return;
                        }
                        if (this._selectedIds.size > 500) {
                            if (!confirm(`您选中了 ${this._selectedIds.size} 道题，导出可能需要较长时间，确认继续吗？`)) {
                                return;
                            }
                        }
                        const all = App.data.getQuestions();
                        const selected = all.filter(q => this._selectedIds.has(q.id));
                        if (!selected.length) {
                            alert("选中的题目在当前题库中已不存在。");
                            return;
                        }
                        const out = {};
                        selected.forEach(q => {
                            if (!out[q.sub]) out[q.sub] = {};
                            if (!out[q.sub][q.chap]) out[q.sub][q.chap] = [];
                            const { _pinyin, _aiAnalysis, sub, chap, ...rest } = q;
                            out[q.sub][q.chap].push(rest);
                        });

                        const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `LMS_Export_${Date.now()}.json`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                    },

                    render(mode) {
                        const prevMode = this.currentMode;
                        // 切换模式时重置搜索关键字
                        if (mode && mode !== prevMode) {
                            this._searchQuery = '';
                            App.dom.setValue('lib-search', '');
                            const clearBtn = App.dom.get('lib-search-clear');
                            if (clearBtn) clearBtn.classList.add('hidden');
                        }
                        if (mode) this.currentMode = mode;
                        mode = this.currentMode;

                        // 任何一次重新渲染，都重置管理模式下的选中状态，避免状态遗留
                        if (this._manageMode) {
                            this._selectedIds = new Set();
                            App.dom.setText('lib-selected-count', '0');
                        }

                        App.dom.setText('lib-title', mode === 'mistakes' ? '错题本' : '总题库');

                        const filter = App.dom.get('lib-filter');
                        const typeFilter = App.dom.get('lib-type');
                        const sortSel = App.dom.get('lib-sort');

                        let currentSortValue = sortSel ? sortSel.value : 'default';

                        if (filter) filter.classList.toggle('hidden', mode === 'mistakes');

                        if (filter) {
                            const savedFilterValue = filter.value;
                            filter.innerHTML = '<option value="all">全科目</option>';
                            const subjects = App.data.getSubjects();
                            subjects.forEach(s => filter.add(new Option(s, s)));
                            if (savedFilterValue === 'all' || subjects.includes(savedFilterValue)) {
                                filter.value = savedFilterValue;
                            } else {
                                filter.value = 'all';
                            }
                        }

                        if (sortSel) {
                            const currentType = typeFilter ? typeFilter.value : 'all';
                            let html = `
                                <option value="default">默认</option>
                                <option value="err_desc">错率↓</option>
                                <option value="ans_asc">答案A-Z</option>
                            `;
                            if (currentType === 'tf') {
                                html += `<option value="tf_true">答案 (对->错)</option>`;
                                html += `<option value="tf_false">答案 (错->对)</option>`;
                            }
                            sortSel.innerHTML = html;

                            let hasOption = false;
                            for (let i = 0; i < sortSel.options.length; i++) {
                                if (sortSel.options[i].value === currentSortValue) {
                                    hasOption = true; break;
                                }
                            }
                            if (hasOption) sortSel.value = currentSortValue;
                            else { sortSel.value = 'default'; currentSortValue = 'default'; }
                        }

                        let qs = App.data.getQuestions();

                        if (mode === 'mistakes') {
                            const hidden = new Set(Array.isArray(App.data.hiddenMistakeIds) ? App.data.hiddenMistakeIds : []);
                            const errSet = new Set(App.data.history.filter(h => !h.r && !hidden.has(h.id)).map(h => h.id));
                            qs = qs.filter(q => errSet.has(q.id));
                        } else {
                            if (filter && filter.value !== 'all') qs = qs.filter(q => q.sub === filter.value);
                            if (typeFilter && typeFilter.value !== 'all') {
                                const t = typeFilter.value;
                                qs = qs.filter(q => q.type === t);
                            }
                        }

                        if (this._searchQuery) {
                            const q_str = this._searchQuery;
                            qs = qs.filter(q => {
                                const haystack = [
                                    q.q,
                                    q.chap,
                                    q.a,
                                    ...(q.o || [])
                                ].join(' ').toLowerCase();

                                return haystack.includes(q_str)
                                    || (q._pinyin && q._pinyin.includes(q_str))
                                    || App.utils.fuzzyMatch(haystack, q_str);
                            });
                        }

                        const sType = currentSortValue;
                        let sortedQs = [...qs];

                        if (sType === 'err_desc') {
                            sortedQs.sort((a, b) => {
                                return (App.data.getMistakeCount(b.id) - App.data.getMistakeCount(a.id)) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
                            });
                        } else if (sType === 'ans_asc') {
                            sortedQs.sort((a, b) => {
                                const aAns = (a.a || '').split('').sort().join('');
                                const bAns = (b.a || '').split('').sort().join('');
                                return aAns.localeCompare(bAns, undefined, { numeric: true }) ||
                                    String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
                            });
                        } else if (sType === 'tf_true') {
                            sortedQs.sort((a, b) => {
                                if (a.a === b.a) return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
                                return a.a === 'T' ? -1 : 1;
                            });
                        } else if (sType === 'tf_false') {
                            sortedQs.sort((a, b) => {
                                if (a.a === b.a) return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
                                return a.a === 'F' ? -1 : 1;
                            });
                        }

                        qs = sortedQs;
                        App.dom.setText('lib-count', qs.length);

                        const c = App.dom.get('lib-list');
                        if (!c) return;
                        c.innerHTML = '';

                        if (qs.length === 0) {
                            if (this._searchQuery) {
                                const safeQuery = App.utils.escapeHTML(this._searchQuery);
                                c.innerHTML = `<div class="p-8 text-center text-xs text-[var(--sub)]">未找到与 "<span class="font-bold text-primary-600">${safeQuery}</span>" 相关的题目。(No results found)</div>`;
                            } else {
                                c.innerHTML = '<div class="p-8 text-center text-xs text-[var(--sub)]">尚未加载题目。请导入题库或更改筛选条件。</div>';
                            }
                            return;
                        }

                        if (!this._searchKeydownAttached) {
                            const input = App.dom.get('lib-search');
                            if (input) {
                                input.addEventListener('keydown', (e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        input.blur();
                                    }
                                });
                                this._searchKeydownAttached = true;
                            }
                        }

                        const frag = document.createDocumentFragment();
                        qs.forEach((q, index) => {
                            const d = document.createElement('div');
                            d.className = "p-4 border-b border-[var(--border)] hover:bg-[var(--bg-hover)] transition-colors";
                            d.dataset.qid = q.id;

                            let mistakeBadge = '';
                            let delBtn = '';
                            if (mode === 'mistakes') {
                                const errCount = App.data.getMistakeCount(q.id);
                                mistakeBadge = `<span class="text-[10px] font-bold text-white bg-red-500 px-1.5 py-0.5 rounded-full ml-2">${errCount}</span>`;
                                delBtn = `<button class="ml-auto text-xs text-[var(--sub)] hover:text-red-500 p-2 border border-[var(--border)] rounded" onclick="event.stopPropagation(); App.data.clearMistakeHistory('${q.id}'); App.views.library.render()">✕ 移除</button>`;
                            }

                            let ansPreview = '';
                            let detailsHtml = '';

                            if (q.type === 'tf') {
                                const isTrue = q.a === 'T';
                                ansPreview = isTrue
                                    ? '<span class="status-true">√ (正确/True)</span>'
                                    : '<span class="status-false">× (错误/False)</span>';
                                detailsHtml = `<div class="mt-2 text-xs text-[var(--sub)] hidden details-panel">此题为判断题。</div>`;
                            } else {
                                let inlineAns = q.a;
                                if (q.type === 'mcq') {
                                    const idx = q.a.charCodeAt(0) - 65;
                                    if (q.o && q.o[idx]) inlineAns = `${q.a}. ${App.utils.highlight(q.o[idx], this._searchQuery)}`;
                                } else if (q.type === 'multi') {
                                    inlineAns = q.a.split('').map(c => {
                                        const idx = c.charCodeAt(0) - 65;
                                        return (q.o && q.o[idx]) ? `${c}. ${App.utils.highlight(q.o[idx], this._searchQuery)}` : c;
                                    }).join(' , ');
                                }

                                ansPreview = `<span class="font-bold text-primary-600">✅ 答案：${inlineAns}</span>`;
                                detailsHtml = `<div class="mt-2 hidden details-panel bg-slate-50 dark:bg-slate-800 p-2 rounded-lg border border-[var(--border)]">` +
                                    App.utils.getDetailedOptionHTML(q, q.a, this._searchQuery) +
                                    `</div>`;
                            }

                            const typeLabel = q.type === 'mcq' ? '单选' : (q.type === 'multi' ? '多选' : '判断');
                            const highlightedQ = App.utils.highlight(q.q, this._searchQuery);

                            const safeSub = App.utils.escapeHTML(q.sub || '');
                            d.innerHTML = `
                                <div class="flex justify-between mb-1 items-center">
                                    <label class="flex items-center gap-2 cursor-pointer select-none">
                                        <input type="checkbox" class="lib-select-chk w-4 h-4 mr-1 hidden" data-id="${App.utils.escapeHTML(String(q.id || ''))}" onchange="App.views.library.handleSelectChange(this)">
                                        <span class="text-[10px] font-bold text-[var(--sub)] mr-1">#${index + 1}</span>
                                        <span class="text-[10px] font-bold text-primary-600 bg-primary-50 px-1 rounded border border-primary-100">${safeSub}</span>
                                        <span class="text-[10px] text-[var(--sub)] border border-[var(--border)] px-1 rounded">${typeLabel}</span>
                                        ${mistakeBadge}
                                    </label>
                                    <div class="flex items-center gap-1">
                                        ${delBtn}
                                        <button class="text-[10px] text-[var(--sub)] hover:text-primary-600 p-1 rounded prevent-drawer" onclick="event.stopPropagation(); App.ui.openQuestionEditor('${App.utils.escapeHTML(String(q.id || ''))}')">✎</button>
                                        <button class="text-[var(--sub)] hover:text-primary-600 p-1 rounded prevent-drawer" onclick="event.stopPropagation(); App.ui.openDrawer('${App.utils.escapeHTML(String(q.id || ''))}')">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-4.553a1 1 0 00-1.414-1.414L13.586 8.586A2 2 0 0112.172 9H7a2 2 0 00-2 2v6h6v-1a2 2 0 01.586-1.414l4.553-4.553z"/>
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 18h14"/>
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                                <div class="font-medium text-sm text-[var(--text)] leading-snug cursor-pointer hover:text-primary-600 transition-colors lib-toggle" onclick="App.views.library.toggleDetails(this)">${highlightedQ}</div>
                                <div class="mt-2 text-xs font-bold text-[var(--sub)] flex flex-col gap-1 cursor-pointer lib-toggle" onclick="App.views.library.toggleDetails(this)">
                                    <span>${ansPreview}</span>
                                </div>
                                ${detailsHtml}`;
                            frag.appendChild(d);
                        });
                        c.appendChild(frag);

                        if (!this._scrollListenerAttached) {
                            const listEl = App.dom.get('lib-list');
                            const btn = App.dom.get('lib-back-top');
                            if (listEl && btn) {
                                listEl.addEventListener('scroll', () => {
                                    btn.classList.toggle('opacity-0', listEl.scrollTop < 200);
                                    btn.classList.toggle('pointer-events-none', listEl.scrollTop < 200);
                                });
                                this._scrollListenerAttached = true;
                            }
                        }
                    }
                },

                analytics: {
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
            },
            ui: {
                _importSessionId: 0,
                _importReader: null,
                toggleModal(id) {
                    const el = App.dom.get(`modal-${id}`);
                    if (!el) return;

                    if (el.classList.contains('hidden')) {
                        el.classList.remove('hidden');
                        if (id === 'smart-practice') {
                            const container = App.dom.get('smart-subjects-list');
                            if (container) {
                                container.innerHTML = '';
                                const subs = App.data.getSubjects();
                                if (subs.length === 0) {
                                    container.innerHTML = '<div class="text-xs text-[var(--sub)] italic">当前题库为空，请前往右上角设置导入数据。</div>';
                                } else {
                                    subs.forEach(sub => {
                                        const div = document.createElement('div');
                                        const escapedSub = App.utils.escapeHTML(sub);
                                        div.innerHTML = `
                                            <label class="flex items-center gap-2 p-2.5 border border-[var(--border)] rounded-lg cursor-pointer hover:bg-[var(--bg-hover)] bg-[var(--card)] transition-colors">
                                                <input type="checkbox" class="smart-subject-chk accent-primary-600 w-4 h-4" value="${escapedSub}" checked>
                                                <span class="text-xs font-bold text-[var(--text)]">${escapedSub}</span>
                                            </label>
                                        `;
                                        container.appendChild(div);
                                    });
                                }
                            }
                        }
                        setTimeout(() => el.classList.remove('opacity-0', 'pointer-events-none'), 10);
                    } else {
                        this.closeModal(id);
                    }
                },

                closeModal(id) {
                    const el = App.dom.get(`modal-${id}`);
                    if (el && !el.classList.contains('hidden')) {
                        el.classList.add('opacity-0', 'pointer-events-none');
                        setTimeout(() => el.classList.add('hidden'), 200);
                    }
                },

                toggleAIAdvanced() {
                    const panel = App.dom.get('ai-advanced-panel');
                    if (!panel) return;
                    panel.classList.toggle('hidden');
                },

                showAITooltip(event, id) {
                    event.stopPropagation();
                    const existing = document.getElementById('ai-param-tooltip');
                    if (existing) existing.remove();
                    const map = {
                        'ai-tip-temperature': '控制随机性：0 更谨慎，值越大回答越发散。',
                        'ai-tip-top-p': '核采样比例：与 temperature 类似，一般二者只调一个。',
                        'ai-tip-max-tokens': '限制单次回复的最大 Token 数，防止回答过长。',
                        'ai-tip-presence': '鼓励提及新主题，值越大越不重复已出现的内容。',
                        'ai-tip-frequency': '惩罚重复词汇，值越大越少出现重复句子。',
                        'ai-tip-timeout': 'HTTP 请求超时时间，单位毫秒，填 0 表示不超时。'
                    };
                    const text = map[id] || '';
                    if (!text) return;
                    const tip = document.createElement('div');
                    tip.id = 'ai-param-tooltip';
                    tip.className = 'fixed z-50 max-w-xs text-[10px] text-[var(--sub)] bg-[var(--card)] border border-[var(--border)] rounded-lg px-2 py-1 shadow-lg';
                    tip.textContent = text;
                    document.body.appendChild(tip);
                    const rect = event.currentTarget.getBoundingClientRect();
                    const tipRect = tip.getBoundingClientRect();
                    let left = rect.left + rect.width / 2 - tipRect.width / 2;
                    if (left < 8) left = 8;
                    if (left + tipRect.width > window.innerWidth - 8) left = window.innerWidth - tipRect.width - 8;
                    let top = rect.bottom + 6;
                    if (top + tipRect.height > window.innerHeight - 8) top = rect.top - tipRect.height - 6;
                    tip.style.left = left + 'px';
                    tip.style.top = top + 'px';
                    const hide = () => {
                        tip.remove();
                        document.removeEventListener('click', hide, true);
                        window.removeEventListener('scroll', hide, true);
                        window.removeEventListener('resize', hide, true);
                    };
                    setTimeout(() => {
                        document.addEventListener('click', hide, true);
                        window.addEventListener('scroll', hide, true);
                        window.addEventListener('resize', hide, true);
                    }, 0);
                },

                _initGlobalBackTop() {
                    const btn = App.dom.get('global-back-top');
                    if (!btn) return;
                    const THRESHOLD = 200;
                    const update = () => {
                        let show = false;
                        if (window.scrollY > THRESHOLD || document.documentElement.scrollTop > THRESHOLD) {
                            show = true;
                        } else {
                            const scrollers = document.querySelectorAll('.custom-scroll');
                            for (const el of scrollers) {
                                if (el.offsetParent !== null && el.scrollTop > THRESHOLD) {
                                    show = true;
                                    break;
                                }
                            }
                        }
                        btn.classList.toggle('opacity-0', !show);
                        btn.classList.toggle('pointer-events-none', !show);
                    };
                    window.addEventListener('scroll', update, { passive: true });
                    const scrollers = document.querySelectorAll('.custom-scroll');
                    scrollers.forEach(el => {
                        el.addEventListener('scroll', update, { passive: true });
                    });
                    update();
                },

                scrollAllToTop() {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                    document.documentElement.scrollTo({ top: 0, behavior: 'smooth' });
                    const scrollers = document.querySelectorAll('.custom-scroll');
                    scrollers.forEach(el => {
                        if (el.offsetParent !== null && el.scrollTop > 0) {
                            el.scrollTo({ top: 0, behavior: 'smooth' });
                        }
                    });
                },

                openImportCenter(defaultTab = 'json') {
                    this.toggleModal('import-center');
                    App.ui.switchImportTab(defaultTab);
                    const statusEl = App.dom.get('import-json-status');
                    if (statusEl && defaultTab === 'json') {
                        statusEl.textContent = '尚未选择文件';
                    }
                },

                switchImportTab(tab) {
                    const isJson = tab === 'json';
                    const btnJson = App.dom.get('import-tab-btn-json');
                    const btnAi = App.dom.get('import-tab-btn-ai');
                    const tabJson = App.dom.get('import-tab-json');
                    const tabAi = App.dom.get('import-tab-ai');
                    if (btnJson && btnAi) {
                        btnJson.classList.toggle('bg-[var(--card)]', isJson);
                        btnJson.classList.toggle('text-[var(--text)]', isJson);
                        btnJson.classList.toggle('bg-transparent', !isJson);
                        btnJson.classList.toggle('text-[var(--sub)]', !isJson);
                        btnAi.classList.toggle('bg-[var(--card)]', !isJson);
                        btnAi.classList.toggle('text-[var(--text)]', !isJson);
                        btnAi.classList.toggle('bg-transparent', isJson);
                        btnAi.classList.toggle('text-[var(--sub)]', isJson);
                    }
                    if (tabJson && tabAi) {
                        tabJson.classList.toggle('hidden', !isJson);
                        tabAi.classList.toggle('hidden', isJson);
                    }
                },

                handleJsonPreviewUpload(e) {
                    const file = e.target.files[0];
                    if (!file) return;
                    const statusEl = App.dom.get('import-json-status');
                    const totalEl = App.dom.get('import-json-total');
                    const subEl = App.dom.get('import-json-subjects');
                    const chapEl = App.dom.get('import-json-chapters');
                    const mcqEl = App.dom.get('import-json-mcq');
                    const multiEl = App.dom.get('import-json-multi');
                    const tfEl = App.dom.get('import-json-tf');
                    const structEl = App.dom.get('import-json-struct');
                    const listEl = App.dom.get('import-json-list');
                    const applyBtn = App.dom.get('import-json-apply-btn');

                    if (applyBtn) applyBtn.disabled = true;
                    if (totalEl) totalEl.textContent = '0';
                    if (subEl) subEl.textContent = '0';
                    if (chapEl) chapEl.textContent = '0';
                    if (mcqEl) mcqEl.textContent = '0';
                    if (multiEl) multiEl.textContent = '0';
                    if (tfEl) tfEl.textContent = '0';
                    if (structEl) structEl.innerHTML = '<div class="text-[10px] text-[var(--sub)] italic">正在解析文件…</div>';
                    if (listEl) listEl.innerHTML = '<div class="text-[10px] text-[var(--sub)] italic">正在解析文件…</div>';
                    if (statusEl) statusEl.textContent = `正在读取文件：${file.name}`;

                    if (file.size > 5 * 1024 * 1024) {
                        alert("文件过大，请上传 5MB 以内的题库文件。(File exceeds 5MB limit.)");
                        e.target.value = null;
                        if (statusEl) statusEl.textContent = "❌ 文件过大，已取消解析。";
                        return;
                    }

                    const reader = new FileReader();
                    reader.onload = (event) => {
                        try {
                            const text = event.target.result;
                            let parsed;
                            try {
                                parsed = JSON.parse(text);
                            } catch (err) {
                                if (statusEl) statusEl.textContent = "❌ JSON 解析失败：" + (err.message || err.toString());
                                if (structEl) structEl.innerHTML = '<div class="text-[10px] text-[var(--sub)] italic">JSON 解析失败，无法预览。</div>';
                                if (listEl) listEl.innerHTML = '<div class="text-[10px] text-[var(--sub)] italic">JSON 解析失败，无法预览。</div>';
                                return;
                            }

                            const check = App.data.validateSchema(parsed);
                            if (check !== true) {
                                if (statusEl) statusEl.textContent = "❌ 结构校验失败：" + check;
                                if (structEl) structEl.innerHTML = '<div class="text-[10px] text-[var(--sub)] italic">结构校验失败，请根据模板调整 JSON。</div>';
                                if (listEl) listEl.innerHTML = '<div class="text-[10px] text-[var(--sub)] italic">结构校验失败，无法生成预览。</div>';
                                return;
                            }

                            const sanitized = (window.App && App.ai && typeof App.ai.sanitizeImportedBank === 'function')
                                ? App.ai.sanitizeImportedBank(parsed)
                                : parsed;

                            const flat = [];
                            const subjSet = new Set();
                            const chapSet = new Set();
                            let mcqCount = 0, multiCount = 0, tfCount = 0;

                            for (const sub in sanitized) {
                                const chapDict = sanitized[sub] || {};
                                let subTotal = 0;
                                const chapsInfo = [];
                                for (const chap in chapDict) {
                                    const arr = Array.isArray(chapDict[chap]) ? chapDict[chap] : [];
                                    if (!arr.length) continue;
                                    chapSet.add(`${sub}::${chap}`);
                                    let cMcq = 0, cMulti = 0, cTf = 0;
                                    arr.forEach(q => {
                                        if (!q) return;
                                        const type = q.type;
                                        if (type === 'mcq') { mcqCount++; cMcq++; }
                                        else if (type === 'multi') { multiCount++; cMulti++; }
                                        else if (type === 'tf') { tfCount++; cTf++; }
                                        flat.push({
                                            sub,
                                            chap,
                                            type,
                                            q: q.q || ''
                                        });
                                    });
                                    const chapTotal = arr.length;
                                    subTotal += chapTotal;
                                    chapsInfo.push({ chap, total: chapTotal, mcq: cMcq, multi: cMulti, tf: cTf });
                                }
                                if (chapsInfo.length) {
                                    subjSet.add(sub);
                                }
                            }

                            const total = flat.length;
                            if (totalEl) totalEl.textContent = String(total);
                            if (subEl) subEl.textContent = String(subjSet.size);
                            if (chapEl) chapEl.textContent = String(chapSet.size);
                            if (mcqEl) mcqEl.textContent = String(mcqCount);
                            if (multiEl) multiEl.textContent = String(multiCount);
                            if (tfEl) tfEl.textContent = String(tfCount);

                            if (structEl) {
                                if (!total) {
                                    structEl.innerHTML = '<div class="text-[10px] text-[var(--sub)] italic">未检测到任何单选 / 多选 / 判断题。</div>';
                                } else {
                                    const blocks = [];
                                    for (const sub of Array.from(subjSet)) {
                                        const chapDict = sanitized[sub] || {};
                                        let subTotal = 0;
                                        const rows = [];
                                        for (const chap in chapDict) {
                                            const arr = Array.isArray(chapDict[chap]) ? chapDict[chap] : [];
                                            if (!arr.length) continue;
                                            const chapTotal = arr.length;
                                            subTotal += chapTotal;
                                            let cMcq = 0, cMulti = 0, cTf = 0;
                                            arr.forEach(q => {
                                                if (q.type === 'mcq') cMcq++;
                                                else if (q.type === 'multi') cMulti++;
                                                else if (q.type === 'tf') cTf++;
                                            });
                                            rows.push(`
                                                <div class="flex items-center gap-2 text-[10px]">
                                                    <span class="truncate flex-1">${App.utils.escapeHTML(chap)}</span>
                                                    <span class="text-[var(--sub)]">${chapTotal} 题 · 单选 ${cMcq} · 多选 ${cMulti} · 判断 ${cTf}</span>
                                                </div>
                                            `);
                                        }
                                        blocks.push(`
                                            <div class="mb-2 last:mb-0">
                                                <div class="flex items-center justify-between mb-1">
                                                    <div class="text-[10px] font-bold text-[var(--text)]">${App.utils.escapeHTML(sub)}</div>
                                                    <div class="text-[10px] text-[var(--sub)]">${subTotal} 题</div>
                                                </div>
                                                <div class="space-y-0.5">${rows.join('')}</div>
                                            </div>
                                        `);
                                    }
                                    structEl.innerHTML = blocks.join('') || '<div class="text-[10px] text-[var(--sub)] italic">未检测到任何题目。</div>';
                                }
                            }

                            if (listEl) {
                                if (!flat.length) {
                                    listEl.innerHTML = '<div class="text-[10px] text-[var(--sub)] italic">暂无题目预览。</div>';
                                } else {
                                    const previewItems = flat.slice(0, 50);
                                    listEl.innerHTML = previewItems.map((item, idx) => {
                                        const typeLabel = item.type === 'mcq' ? '单选' : (item.type === 'multi' ? '多选' : '判断');
                                        const qText = App.utils.escapeHTML(String(item.q || '')).slice(0, 80);
                                        const subEsc = App.utils.escapeHTML(item.sub);
                                        const chapEsc = App.utils.escapeHTML(item.chap);
                                        const idEsc = App.utils.escapeHTML(item.id || '');
                                        return `
                                            <div class="border-b border-[var(--border)] pb-1 last:border-b-0" id="import-json-row-${idx}" data-sub="${subEsc}" data-chap="${chapEsc}" data-qid="${idEsc}">
                                                <div class="flex items-center justify-between gap-1">
                                                    <span class="text-[10px] text-[var(--sub)]">#${idx + 1}</span>
                                                    <span class="text-[10px] text-[var(--sub)] truncate flex-1 text-right">${subEsc} / ${chapEsc}</span>
                                                </div>
                                                <div class="flex items-center justify-between gap-1 mt-0.5">
                                                    <span class="inline-flex items-center px-1.5 py-0.5 rounded-full border border-[var(--border)] text-[9px] text-[var(--sub)]">${typeLabel}</span>
                                                    <span class="text-[11px] text-[var(--text)] flex-1 text-right">${qText}${String(item.q || '').length > 80 ? '…' : ''}</span>
                                                </div>
                                                <div class="mt-1 flex items-center gap-1 text-[10px] text-[var(--sub)]">
                                                    <span>科目</span>
                                                    <input class="import-json-sub-input flex-1 min-w-[80px] bg-[var(--card)] border border-[var(--border)] rounded px-1 py-0.5 outline-none" value="${subEsc}">
                                                    <span>章节</span>
                                                    <input class="import-json-chap-input flex-1 min-w-[80px] bg-[var(--card)] border border-[var(--border)] rounded px-1 py-0.5 outline-none" value="${chapEsc}">
                                                    <button class="px-1.5 py-0.5 border border-[var(--border)] rounded text-[10px] text-primary-600 hover:bg-primary-50"
                                                        onclick="App.ui.applyJsonMetaChange(${idx})">应用</button>
                                                </div>
                                            </div>
                                        `;
                                    }).join('');
                                }
                            }

                            App.ui._jsonImportPreview = sanitized;
                            App.ui._jsonImportPreviewCount = flat.length;
                            if (applyBtn) applyBtn.disabled = !flat.length;

                            if (statusEl) {
                                statusEl.textContent = flat.length
                                    ? `✅ 解析成功：检测到 ${flat.length} 道题（科目 ${subjSet.size} 个，章节 ${chapSet.size} 个）。`
                                    : "⚠️ 解析完成，但未检测到任何符合条件的题目。";
                            }
                        } finally {
                            e.target.value = null;
                        }
                    };
                    reader.onerror = () => {
                        if (statusEl) statusEl.textContent = "❌ 文件读取失败。";
                        e.target.value = null;
                    };
                    reader.readAsText(file, 'UTF-8');
                },

                applyJsonPreviewImport() {
                    const data = App.ui._jsonImportPreview;
                    const count = App.ui._jsonImportPreviewCount || 0;
                    const statusEl = App.dom.get('import-json-status');
                    if (!data || !count) {
                        alert("请先选择 JSON 文件并完成预览解析。");
                        return;
                    }
                    const ok = confirm(`即将根据预览结果导入约 ${count} 道题到当前题库，是否继续？`);
                    if (!ok) {
                        if (statusEl) statusEl.textContent = "已取消导入操作。";
                        return;
                    }
                    const report = App.data.importBank(JSON.stringify(data));
                    if (!report) {
                        if (statusEl) statusEl.textContent = "❌ 导入失败，请检查 JSON 格式或控制台错误信息。";
                        return;
                    }
                    if (statusEl) statusEl.textContent = "✅ 已根据预览 JSON 成功导入题库。";
                },

                applyJsonMetaChange(idx) {
                    const row = document.getElementById(`import-json-row-${idx}`);
                    if (!row) return;
                    const subInput = row.querySelector('.import-json-sub-input');
                    const chapInput = row.querySelector('.import-json-chap-input');
                    if (!subInput || !chapInput) return;
                    const newSub = subInput.value.trim();
                    const newChap = chapInput.value.trim();
                    const oldSub = row.dataset.sub || '';
                    const oldChap = row.dataset.chap || '';
                    const qid = row.dataset.qid || '';
                    App.ui.updateJsonPreviewMeta(oldSub, oldChap, qid, newSub, newChap);
                },

                updateJsonPreviewMeta(oldSub, oldChap, qid, newSub, newChap) {
                    newSub = (newSub || '').trim();
                    newChap = (newChap || '').trim();
                    const statusEl = App.dom.get('import-json-status');
                    if (!newSub || !newChap) {
                        alert('科目和章节不能为空。');
                        return;
                    }
                    if (!qid) {
                        alert('当前题目缺少 ID，无法调整归属。');
                        return;
                    }
                    const data = App.ui._jsonImportPreview;
                    if (!data) {
                        alert('预览数据不存在，请先重新选择 JSON 文件。');
                        return;
                    }
                    if (oldSub === newSub && oldChap === newChap) {
                        return;
                    }
                    if (!data[oldSub] || !data[oldSub][oldChap]) {
                        alert('原科目/章节中未找到该题，可能结构已被修改。');
                        return;
                    }
                    const arr = data[oldSub][oldChap];
                    const idx = arr.findIndex(q => q && q.id === qid);
                    if (idx === -1) {
                        alert('在原位置未找到对应题目，无法调整。');
                        return;
                    }
                    const q = arr[idx];
                    arr.splice(idx, 1);
                    if (!arr.length) delete data[oldSub][oldChap];
                    if (!Object.keys(data[oldSub] || {}).length) delete data[oldSub];

                    if (!data[newSub]) data[newSub] = {};
                    if (!data[newSub][newChap]) data[newSub][newChap] = [];
                    data[newSub][newChap].push(q);

                    App.ui._jsonImportPreview = data;

                    const flat = [];
                    const subjSet = new Set();
                    const chapSet = new Set();
                    let mcqCount = 0, multiCount = 0, tfCount = 0;
                    const totalEl = App.dom.get('import-json-total');
                    const subEl = App.dom.get('import-json-subjects');
                    const chapEl = App.dom.get('import-json-chapters');
                    const mcqEl = App.dom.get('import-json-mcq');
                    const multiEl = App.dom.get('import-json-multi');
                    const tfEl = App.dom.get('import-json-tf');
                    const structEl = App.dom.get('import-json-struct');
                    const listEl = App.dom.get('import-json-list');
                    const applyBtn = App.dom.get('import-json-apply-btn');

                    for (const sub in data) {
                        const chapDict = data[sub] || {};
                        let hasAny = false;
                        for (const chap in chapDict) {
                            const arrQ = Array.isArray(chapDict[chap]) ? chapDict[chap] : [];
                            if (!arrQ.length) continue;
                            hasAny = true;
                            chapSet.add(`${sub}::${chap}`);
                            arrQ.forEach(qItem => {
                                if (!qItem) return;
                                const type = qItem.type;
                                if (type === 'mcq') mcqCount++;
                                else if (type === 'multi') multiCount++;
                                else if (type === 'tf') tfCount++;
                                flat.push({
                                    sub,
                                    chap,
                                    type,
                                    q: qItem.q || '',
                                    id: qItem.id || ''
                                });
                            });
                        }
                        if (hasAny) {
                            subjSet.add(sub);
                        }
                    }

                    const total = flat.length;
                    App.ui._jsonImportPreviewCount = total;
                    if (totalEl) totalEl.textContent = String(total);
                    if (subEl) subEl.textContent = String(subjSet.size);
                    if (chapEl) chapEl.textContent = String(chapSet.size);
                    if (mcqEl) mcqEl.textContent = String(mcqCount);
                    if (multiEl) multiEl.textContent = String(multiCount);
                    if (tfEl) tfEl.textContent = String(tfCount);

                    if (structEl) {
                        if (!total) {
                            structEl.innerHTML = '<div class="text-[10px] text-[var(--sub)] italic">未检测到任何单选 / 多选 / 判断题。</div>';
                        } else {
                            const blocks = [];
                            for (const sub of Array.from(subjSet)) {
                                const chapDict = data[sub] || {};
                                let subTotal = 0;
                                const rows = [];
                                for (const chap in chapDict) {
                                    const arrQ = Array.isArray(chapDict[chap]) ? chapDict[chap] : [];
                                    if (!arrQ.length) continue;
                                    const chapTotal = arrQ.length;
                                    subTotal += chapTotal;
                                    let cMcq = 0, cMulti = 0, cTf = 0;
                                    arrQ.forEach(qItem => {
                                        if (qItem.type === 'mcq') cMcq++;
                                        else if (qItem.type === 'multi') cMulti++;
                                        else if (qItem.type === 'tf') cTf++;
                                    });
                                    rows.push(`
                                        <div class="flex items-center gap-2 text-[10px]">
                                            <span class="truncate flex-1">${App.utils.escapeHTML(chap)}</span>
                                            <span class="text-[var(--sub)]">${chapTotal} 题 · 单选 ${cMcq} · 多选 ${cMulti} · 判断 ${cTf}</span>
                                        </div>
                                    `);
                                }
                                blocks.push(`
                                    <div class="mb-2 last:mb-0">
                                        <div class="flex items-center justify-between mb-1">
                                            <div class="text-[10px] font-bold text-[var(--text)]">${App.utils.escapeHTML(sub)}</div>
                                            <div class="text-[10px] text-[var(--sub)]">${subTotal} 题</div>
                                        </div>
                                        <div class="space-y-0.5">${rows.join('')}</div>
                                    </div>
                                `);
                            }
                            structEl.innerHTML = blocks.join('') || '<div class="text-[10px] text-[var(--sub)] italic">未检测到任何题目。</div>';
                        }
                    }

                    if (listEl) {
                        if (!flat.length) {
                            listEl.innerHTML = '<div class="text-[10px] text-[var(--sub)] italic">暂无题目预览。</div>';
                        } else {
                            const previewItems = flat.slice(0, 50);
                            listEl.innerHTML = previewItems.map((item, idx) => {
                                const typeLabel = item.type === 'mcq' ? '单选' : (item.type === 'multi' ? '多选' : '判断');
                                const qText = App.utils.escapeHTML(String(item.q || '')).slice(0, 80);
                                const subEsc = App.utils.escapeHTML(item.sub);
                                const chapEsc = App.utils.escapeHTML(item.chap);
                                const idEsc = App.utils.escapeHTML(item.id || '');
                                return `
                                    <div class="border-b border-[var(--border)] pb-1 last:border-b-0" id="import-json-row-${idx}" data-sub="${subEsc}" data-chap="${chapEsc}" data-qid="${idEsc}">
                                        <div class="flex items-center justify-between gap-1">
                                            <span class="text-[10px] text-[var(--sub)]">#${idx + 1}</span>
                                            <span class="text-[10px] text-[var(--sub)] truncate flex-1 text-right">${subEsc} / ${chapEsc}</span>
                                        </div>
                                        <div class="flex items-center justify-between gap-1 mt-0.5">
                                            <span class="inline-flex items-center px-1.5 py-0.5 rounded-full border border-[var(--border)] text-[9px] text-[var(--sub)]">${typeLabel}</span>
                                            <span class="text-[11px] text-[var(--text)] flex-1 text-right">${qText}${String(item.q || '').length > 80 ? '…' : ''}</span>
                                        </div>
                                        <div class="mt-1 flex items-center gap-1 text-[10px] text-[var(--sub)]">
                                            <span>科目</span>
                                            <input class="import-json-sub-input flex-1 min-w-[80px] bg-[var(--card)] border border-[var(--border)] rounded px-1 py-0.5 outline-none" value="${subEsc}">
                                            <span>章节</span>
                                            <input class="import-json-chap-input flex-1 min-w-[80px] bg-[var(--card)] border border-[var(--border)] rounded px-1 py-0.5 outline-none" value="${chapEsc}">
                                            <button class="px-1.5 py-0.5 border border-[var(--border)] rounded text-[10px] text-primary-600 hover:bg-primary-50"
                                                onclick="App.ui.applyJsonMetaChange(${idx})">应用</button>
                                        </div>
                                    </div>
                                `;
                            }).join('');
                        }
                    }

                    if (applyBtn) applyBtn.disabled = !flat.length;
                    if (statusEl) {
                        statusEl.textContent = flat.length
                            ? `✅ 预览已更新：当前将导入 ${flat.length} 道题（科目 ${subjSet.size} 个，章节 ${chapSet.size} 个）。`
                            : "⚠️ 当前预览中不再包含任何题目。";
                    }
                },

                initTheme() {
                    if (localStorage.getItem('dark') === '1') document.documentElement.classList.add('dark');
                },
                toggleTheme() {
                    const isDark = !document.documentElement.classList.contains('dark');
                    document.documentElement.classList.toggle('dark');
                    localStorage.setItem('dark', isDark ? '1' : '0');

                    const currentView = document.querySelector('[id^="view-"]:not(.hidden)');
                    if (currentView) {
                        const viewName = currentView.id.replace('view-', '');
                        if (App.views[viewName] && typeof App.views[viewName].render === 'function') {
                            App.views[viewName].render();
                        }
                    }
                },
                openDrawer(id) {
                    const q = App.data.getQuestionById(id); if (!q) return;
                    const drawer = App.dom.get('insight-drawer');
                    const backdrop = App.dom.get('drawer-backdrop');
                    if (!drawer || !backdrop) return;

                    App.dom.setText('drawer-meta', `${q.sub} • ${q.chap}`);
                    App.dom.setText('drawer-q', q.q);
                    const h = App.data.history.filter(x => x.id === id).slice(-5);
                    const dots = App.dom.get('drawer-dots');
                    if (dots) {
                        dots.innerHTML = '';
                        h.forEach(rec => {
                            const d = document.createElement('div');
                            d.className = `w-3 h-3 rounded-full ${rec.r ? 'dot-correct' : 'dot-wrong'}`;
                            dots.appendChild(d);
                        });
                        for (let i = 0; i < (5 - h.length); i++) {
                            const d = document.createElement('div');
                            d.className = `w-3 h-3 rounded-full dot-empty`;
                            dots.appendChild(d);
                        }
                    }

                    App.ai.setContext(q);

                    backdrop.classList.remove('hidden');
                    drawer.classList.remove('translate-x-full');
                    setTimeout(() => backdrop.classList.remove('opacity-0'), 10);
                },
                closeDrawer() {
                    const drawer = App.dom.get('insight-drawer');
                    const backdrop = App.dom.get('drawer-backdrop');
                    if (!drawer || !backdrop) return;

                    drawer.classList.add('translate-x-full');
                    backdrop.classList.add('opacity-0');
                    setTimeout(() => backdrop.classList.add('hidden'), 300);
                },

                handleFileUpload(e) {
                    const file = e.target.files[0];
                    if (!file) return;

                    // 修复 4: 增加文件大小限制 (5MB上限)，防止大文件阻塞主线程 (Prevent Main Thread Blocking)
                    if (file.size > 5 * 1024 * 1024) {
                        alert("文件过大，请上传 5MB 以内的题库文件。(File exceeds 5MB limit.)");
                        e.target.value = null;
                        return;
                    }

                    const reader = new FileReader();
                    reader.onload = (event) => {
                        const text = event.target.result;
                        const report = App.data.importBank(text);
                        if (!report) {
                            alert('导入失败，请检查 JSON 内容。');
                        } else {
                            const msgLines = [
                                `题库导入完成：`,
                                `- 新增题目：${report.added}`,
                                `- 覆盖更新：${report.updated}`,
                                `- 完全重复跳过：${report.skippedSame}`,
                                report.similarPairs.length ? `- 疑似相似题组：${report.similarPairs.length} 组` : ''
                            ].filter(Boolean);
                            alert(msgLines.join('\n'));
                        }
                    };
                    reader.onerror = () => alert('文件读取失败 (File read error)');
                    reader.readAsText(file, 'UTF-8');
                    e.target.value = null;
                },

                // AI 文档导入：根据文件类型提取纯文本并填充到文本框中
                async handleAIImportFile(e) {
                    const file = e.target.files[0];
                    if (!file) return;
                    this._importSessionId += 1;
                    const sessionId = this._importSessionId;
                    if (this._importReader && this._importReader.readyState === 1) {
                        try { this._importReader.abort(); } catch (e) { }
                    }
                    this._importReader = null;

                    const nameEl = App.dom.get('ai-import-file-name');
                    if (nameEl) {
                        const sizeKb = Math.round(file.size / 1024);
                        nameEl.textContent = `${file.name} (${sizeKb} KB)`;
                    }

                    const statusEl = App.dom.get('ai-import-status');
                    const textArea = App.dom.get('ai-import-raw');

                    const setStatus = (msg) => { if (sessionId === this._importSessionId && statusEl) statusEl.textContent = msg; };
                    const setRaw = (txt) => { if (sessionId === this._importSessionId && textArea) textArea.value = txt || ''; };

                    setStatus("正在读取并解析文件内容…");

                    const ext = file.name.toLowerCase().split('.').pop();

                    try {
                        if (ext === 'txt' || ext === 'md') {
                            const reader = new FileReader();
                            this._importReader = reader;
                            reader.onload = (event) => {
                                if (sessionId !== this._importSessionId) return;
                                setRaw(event.target.result || '');
                                setStatus("文本文件读取完成，可以点击「AI 识别并导入」。");
                            };
                            reader.onerror = () => { if (sessionId === this._importSessionId) setStatus("❌ 文本文件读取失败。"); };
                            reader.readAsText(file, 'UTF-8');
                        } else if (ext === 'docx') {
                            if (!window.mammoth) {
                                setStatus("❌ 未找到 DOCX 解析库 mammoth，无法解析 Word 文档。");
                                return;
                            }
                            const reader = new FileReader();
                            this._importReader = reader;
                            reader.onload = async (event) => {
                                try {
                                    if (sessionId !== this._importSessionId) return;
                                    const arrayBuffer = event.target.result;
                                    const result = await mammoth.extractRawText({ arrayBuffer });
                                    if (sessionId !== this._importSessionId) return;
                                    setRaw(result.value || '');
                                    setStatus("DOCX 文档解析完成，可以点击「AI 识别并导入」。");
                                    if (arrayBuffer) {
                                        event.target.result = null;
                                    }
                                } catch (err) {
                                    console.error("DOCX parse error", err);
                                    setStatus("❌ 解析 DOCX 文档失败，请确认文件格式是否正确。");
                                }
                            };
                            reader.onerror = () => { if (sessionId === this._importSessionId) setStatus("❌ 读取 DOCX 文件失败。"); };
                            reader.readAsArrayBuffer(file);
                        } else if (ext === 'pdf') {
                            const reader = new FileReader();
                            this._importReader = reader;
                            reader.onload = async (event) => {
                                try {
                                    if (window.pdfjsReady) {
                                        await window.pdfjsReady;
                                    }
                                    if (!window.pdfjsLib) {
                                        setStatus("❌ 未找到 PDF 解析库 pdf.js，无法解析 PDF 文档。");
                                        return;
                                    }
                                    if (sessionId !== this._importSessionId) return;
                                    const arrayBuffer = event.target.result;
                                    const uint8Array = new Uint8Array(arrayBuffer);
                                    const loadingTask = window.pdfjsLib.getDocument({ data: uint8Array });
                                    const pdf = await loadingTask.promise;

                                    let text = '';
                                    const batchSize = 10;
                                    for (let i = 1; i <= pdf.numPages; i += batchSize) {
                                        if (sessionId !== this._importSessionId) return;
                                        const end = Math.min(i + batchSize - 1, pdf.numPages);
                                        for (let pageNum = i; pageNum <= end; pageNum++) {
                                            if (sessionId !== this._importSessionId) return;
                                            const page = await pdf.getPage(pageNum);
                                            const content = await page.getTextContent();
                                            const strings = content.items.map(item => item.str);
                                            text += strings.join(' ') + '\n\n';
                                        }
                                        // 批处理之间让出主线程，避免长时间阻塞界面
                                        await new Promise(resolve => setTimeout(resolve, 0));
                                        setStatus(`正在解析 PDF 第 ${end}/${pdf.numPages} 页…`);
                                    }

                                    if (sessionId !== this._importSessionId) return;
                                    setRaw(text.trim());
                                    setStatus("PDF 文档解析完成，可以点击「AI 识别并导入」。");
                                    text = null;
                                } catch (err) {
                                    console.error("PDF parse error", err);
                                    setStatus("❌ 解析 PDF 文档失败，请确认文件格式是否正常。");
                                }
                            };
                            reader.onerror = () => { if (sessionId === this._importSessionId) setStatus("❌ 读取 PDF 文件失败。"); };
                            reader.readAsArrayBuffer(file);
                        } else {
                            setStatus("❌ 当前仅支持 .txt / .md / .docx / .pdf 文件类型。");
                        }
                    } catch (err) {
                        console.error('AI import file handling error', err);
                        setStatus("❌ 文件处理过程中发生错误：" + (err.message || '未知错误'));
                    } finally {
                        e.target.value = null;
                    }
                },

                downloadTemplate() {
                    const template = {
                        "Subject Example (科目示例)": {
                            "Chapter 1 (章节示例)": [
                                {
                                    "id": "q1",
                                    "type": "mcq",
                                    "q": "示例单选题 (Example MCQ Question)",
                                    "o": ["Option A", "Option B", "Option C", "Option D"],
                                    "a": "A"
                                },
                                {
                                    "id": "q2",
                                    "type": "tf",
                                    "q": "示例判断题 (Example True/False)",
                                    "a": "F"
                                },
                                {
                                    "id": "q3",
                                    "type": "multi",
                                    "q": "示例多选题 (Example Multi-select)",
                                    "o": ["Option A", "Option B", "Option C"],
                                    "a": "AC"
                                }
                            ]
                        }
                    };
                    const blob = new Blob([JSON.stringify(template, null, 4)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'LMS_Question_Bank_Template.json';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                },

                // 打开疑似相似题审查弹窗
                openSimilarReview() {
                    const report = App.data._lastImportReport;
                    if (!report || !report.similarPairs || report.similarPairs.length === 0) {
                        alert("当前没有检测到需要审查的疑似相似题。请先通过导入题库生成。");
                        return;
                    }
                    const modal = App.dom.get('modal-dup-review');
                    const list = App.dom.get('dup-review-list');
                    if (!modal || !list) return;

                    list.innerHTML = '';
                    const pairs = report.similarPairs;

                    pairs.forEach((pair, idx) => {
                        const item = document.createElement('div');
                        item.className = 'mb-3 border border-[var(--border)] rounded-xl p-3 bg-[var(--card)]';
                        const subEsc = App.utils.escapeHTML(pair.sub || '');
                        const chapEsc = App.utils.escapeHTML(pair.chap || '');
                        const existId = App.utils.escapeHTML(pair.existing?.id || '');
                        const incomingId = App.utils.escapeHTML(pair.incoming?.id || '');
                        const existQ = App.utils.escapeHTML(pair.existing?.q || '');
                        const incomingQ = App.utils.escapeHTML(pair.incoming?.q || '');
                        const existA = App.utils.escapeHTML(pair.existing?.a || '-');
                        const incomingA = App.utils.escapeHTML(pair.incoming?.a || '-');
                        item.innerHTML = `
                            <div class="flex items-center justify-between mb-2">
                                <div class="text-[10px] text-[var(--sub)]">
                                    #${idx + 1} [${subEsc} / ${chapEsc}] 相似度：<span class="font-bold text-amber-600">${(pair.score * 100).toFixed(0)}%</span>
                                </div>
                            </div>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                                <div class="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2">
                                    <div class="text-[10px] text-[var(--sub)] mb-1">现有题（题库中已有） • ID: ${existId}</div>
                                    <div class="text-[11px] font-medium text-[var(--text)] mb-1">${existQ}</div>
                                    <div class="text-[10px] text-[var(--sub)]">答案：${existA}</div>
                                </div>
                                <div class="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2">
                                    <div class="text-[10px] text-[var(--sub)] mb-1">新导入题 • ID: ${incomingId}</div>
                                    <div class="text-[11px] font-medium text-[var(--text)] mb-1">${incomingQ}</div>
                                    <div class="text-[10px] text-[var(--sub)]">答案：${incomingA}</div>
                                </div>
                            </div>
                            <div class="mt-2 flex flex-wrap gap-3 text-[10px]">
                                <label class="flex items-center gap-1">
                                    <input type="radio" name="dup-choice-${idx}" value="keep-both" class="accent-primary-600" checked>
                                    <span>都保留（默认）</span>
                                </label>
                                <label class="flex items-center gap-1">
                                    <input type="radio" name="dup-choice-${idx}" value="keep-old" class="accent-primary-600">
                                    <span>保留现有题，删除新题</span>
                                </label>
                                <label class="flex items-center gap-1">
                                    <input type="radio" name="dup-choice-${idx}" value="keep-new" class="accent-primary-600">
                                    <span>保留新题，删除旧题</span>
                                </label>
                            </div>
                        `;
                        list.appendChild(item);
                    });

                    modal.classList.remove('hidden');
                    setTimeout(() => modal.classList.remove('opacity-0', 'pointer-events-none'), 10);
                },

                // 应用疑似相似题审查结果：根据用户选择软删对应题目
                applySimilarReview() {
                    const report = App.data._lastImportReport;
                    if (!report || !report.similarPairs || report.similarPairs.length === 0) {
                        alert('当前没有待审查的相似题。');
                        return;
                    }
                    if (!confirm(`确认要应用这 ${report.similarPairs.length} 组审查结果吗？`)) {
                        return;
                    }
                    const toDeleteOld = new Set();
                    const toDeleteNew = new Set();

                    report.similarPairs.forEach((pair, idx) => {
                        const choice = document.querySelector(`input[name="dup-choice-${idx}"]:checked`);
                        const val = choice ? choice.value : 'keep-both';
                        if (val === 'keep-old') {
                            toDeleteNew.add(pair.incoming.id);
                        } else if (val === 'keep-new') {
                            toDeleteOld.add(pair.existing.id);
                        }
                    });

                    if (toDeleteOld.size === 0 && toDeleteNew.size === 0) {
                        App.ui.closeModal('dup-review');
                        return;
                    }

                    if (toDeleteOld.size > 0) {
                        App.data.softDeleteByIds(toDeleteOld, 'duplicate-review-discard-old');
                    }
                    if (toDeleteNew.size > 0) {
                        App.data.softDeleteByIds(toDeleteNew, 'duplicate-review-discard-new');
                    }

                    // 审查完成后清空相似对，避免重复处理
                    report.similarPairs = [];
                    App.ui.closeModal('dup-review');
                    // 刷新总题库，让变更立刻生效
                    App.views.library.render(App.views.library.currentMode);
                },

                // 打开题目编辑器
                openQuestionEditor(qId) {
                    // 兼容旧语法环境：在函数体内处理默认值
                    if (typeof qId === 'undefined') qId = null;
                    const modal = App.dom.get('modal-question-editor');
                    if (!modal) return;
                    const titleEl = App.dom.get('qe-title');
                    const idInput = App.dom.get('qe-id');
                    const subSelect = App.dom.get('qe-subject-select');
                    const subInput = App.dom.get('qe-subject-input');
                    const chapSelect = App.dom.get('qe-chapter-select');
                    const chapInput = App.dom.get('qe-chapter-input');
                    const typeSelect = App.dom.get('qe-type');
                    const qText = App.dom.get('qe-q');
                    const errEl = App.dom.get('qe-error');

                    if (errEl) errEl.textContent = '';

                    if (subSelect) {
                        subSelect.innerHTML = '';
                        const subjects = App.data.getSubjects();
                        subjects.forEach(s => {
                            const opt = document.createElement('option');
                            opt.value = s;
                            opt.textContent = s;
                            subSelect.appendChild(opt);
                        });
                    }

                    const filterEl = App.dom.get('lib-filter');
                    const defaultSub = filterEl && filterEl.value !== 'all' ? filterEl.value : (App.data.getSubjects()[0] || '');
                    if (subSelect && defaultSub) subSelect.value = defaultSub;
                    if (subInput) subInput.value = '';

                    const updateChaps = (sub) => {
                        if (!chapSelect) return;
                        chapSelect.innerHTML = '';
                        if (!sub) return;
                        const chaps = App.data.getChapters(sub);
                        chaps.forEach(c => {
                            const opt = document.createElement('option');
                            opt.value = c;
                            opt.textContent = c;
                            chapSelect.appendChild(opt);
                        });
                    };
                    updateChaps(defaultSub);
                    if (chapInput) chapInput.value = '';

                    if (subSelect) {
                        subSelect.onchange = () => updateChaps(subSelect.value);
                    }

                    const optionsBlock = App.dom.get('qe-options-block');
                    const tfBlock = App.dom.get('qe-tf-block');
                    const optList = App.dom.get('qe-options-list');

                    if (!qId) {
                        if (titleEl) titleEl.textContent = '新增题目';
                        if (idInput) idInput.value = '';
                        if (typeSelect) typeSelect.value = 'mcq';
                        if (qText) qText.value = '';
                        if (optionsBlock && optList) {
                            optionsBlock.classList.remove('hidden');
                            tfBlock && tfBlock.classList.add('hidden');
                            optList.innerHTML = '';
                            ['选项 A', '选项 B', '选项 C', '选项 D'].forEach(t => App.ui.addQuestionOption(t));
                        }
                        if (tfBlock) {
                            const radios = tfBlock.querySelectorAll('input[name="qe-tf"]');
                            radios.forEach(r => r.checked = false);
                        }
                    } else {
                        const q = App.data.getQuestionById(qId);
                        if (!q) return;
                        if (titleEl) titleEl.textContent = '编辑题目';
                        if (idInput) idInput.value = q.id;
                        if (qText) qText.value = q.q;
                        if (subSelect) subSelect.value = q.sub;
                        updateChaps(q.sub);
                        if (chapSelect) chapSelect.value = q.chap;
                        if (typeSelect) typeSelect.value = q.type;

                        if (q.type === 'tf') {
                            optionsBlock && optionsBlock.classList.add('hidden');
                            if (tfBlock) {
                                tfBlock.classList.remove('hidden');
                                const radios = tfBlock.querySelectorAll('input[name="qe-tf"]');
                                radios.forEach(r => { r.checked = r.value === q.a; });
                            }
                        } else {
                            if (optionsBlock && optList) {
                                optionsBlock.classList.remove('hidden');
                                tfBlock && tfBlock.classList.add('hidden');
                                optList.innerHTML = '';
                                (q.o || []).forEach(text => App.ui.addQuestionOption(text));
                                const correctSet = new Set((q.a || '').split(''));
                                const rows = optList.querySelectorAll('.qe-opt-row');
                                rows.forEach((row, idx) => {
                                    const chk = row.querySelector('input[type="checkbox"]');
                                    if (!chk) return;
                                    const letter = String.fromCharCode(65 + idx);
                                    chk.checked = correctSet.has(letter);
                                });
                            }
                        }
                    }

                    modal.classList.remove('hidden');
                    setTimeout(() => modal.classList.remove('opacity-0', 'pointer-events-none'), 10);
                },

                onQuestionTypeChange() {
                    const typeEl = App.dom.get('qe-type');
                    const type = typeEl ? typeEl.value : 'mcq';
                    const optionsBlock = App.dom.get('qe-options-block');
                    const tfBlock = App.dom.get('qe-tf-block');
                    const tfRadios = document.querySelectorAll('#qe-tf-block input[name="qe-tf"]');

                    if (type === 'tf') {
                        // 切换为判断题：隐藏选项区，清空所有选项勾选
                        const list = App.dom.get('qe-options-list');
                        if (list) {
                            const rows = list.querySelectorAll('.qe-opt-row input[type="checkbox"]');
                            rows.forEach(chk => chk.checked = false);
                        }
                        optionsBlock && optionsBlock.classList.add('hidden');
                        tfBlock && tfBlock.classList.remove('hidden');
                    } else {
                        // 切换为选择题：显示选项区，清空判断题勾选
                        tfRadios.forEach(r => { r.checked = false; });
                        optionsBlock && optionsBlock.classList.remove('hidden');
                        tfBlock && tfBlock.classList.add('hidden');
                    }
                },

                addQuestionOption(initialText = '') {
                    const list = App.dom.get('qe-options-list');
                    if (!list) return;
                    const idx = list.querySelectorAll('.qe-opt-row').length;
                    const letter = String.fromCharCode(65 + idx);
                    const row = document.createElement('div');
                    row.className = 'qe-opt-row flex items-center gap-2';
                    row.innerHTML = `
                        <span class="w-5 text-[11px] font-bold text-[var(--sub)]">${letter}.</span>
                        <input class="flex-1 bg-[var(--card)] border border-[var(--border)] rounded-lg px-2 py-1.5 outline-none text-xs"
                               value="${initialText.replace(/"/g, '&quot;')}"
                               placeholder="选项内容" />
                        <label class="flex items-center gap-1 text-[10px] text-[var(--sub)]">
                            <input type="checkbox" class="accent-primary-600" />
                            <span>正确</span>
                        </label>
                        <button class="text-[10px] text-[var(--sub)] hover:text-red-500 p-1"
                                onclick="this.parentElement.remove(); App.ui.renumberQuestionOptions()">
                            ✕
                        </button>
                    `;
                    list.appendChild(row);
                },

                renumberQuestionOptions() {
                    const list = App.dom.get('qe-options-list');
                    if (!list) return;
                    const rows = list.querySelectorAll('.qe-opt-row');
                    rows.forEach((row, idx) => {
                        const letter = String.fromCharCode(65 + idx);
                        const span = row.querySelector('span');
                        if (span) span.textContent = `${letter}.`;
                    });
                },

                saveQuestionFromEditor() {
                    const id = App.dom.get('qe-id')?.value || '';
                    const subSelect = App.dom.get('qe-subject-select');
                    const subInput = App.dom.get('qe-subject-input');
                    const chapSelect = App.dom.get('qe-chapter-select');
                    const chapInput = App.dom.get('qe-chapter-input');
                    const typeSelect = App.dom.get('qe-type');
                    const qText = App.dom.get('qe-q');
                    const errEl = App.dom.get('qe-error');

                    const type = typeSelect ? typeSelect.value : 'mcq';
                    const sub = (subInput && subInput.value.trim()) || (subSelect && subSelect.value) || '';
                    const chap = (chapInput && chapInput.value.trim()) || (chapSelect && chapSelect.value) || '';
                    const q = qText ? qText.value.trim() : '';

                    if (errEl) errEl.textContent = '';
                    if (!sub || !chap || !q) {
                        if (errEl) errEl.textContent = '科目 / 章节 / 题干 不能为空。';
                        return;
                    }

                    let options = [];
                    let answer = '';

                    if (type === 'tf') {
                        const tfBlock = App.dom.get('qe-tf-block');
                        const radios = tfBlock ? tfBlock.querySelectorAll('input[name="qe-tf"]') : [];
                        let val = '';
                        radios.forEach(r => { if (r.checked) val = r.value; });
                        if (!val) {
                            if (errEl) errEl.textContent = '请为判断题选择正确答案。';
                            return;
                        }
                        answer = val;
                    } else {
                        const list = App.dom.get('qe-options-list');
                        if (!list) return;
                        const rows = list.querySelectorAll('.qe-opt-row');
                        if (rows.length < 2) {
                            if (errEl) errEl.textContent = '单选 / 多选题至少需要两个选项。';
                            return;
                        }
                        const ansLetters = [];
                        rows.forEach((row, idx) => {
                            const input = row.querySelector('input[type="text"], input:not([type])');
                            const chk = row.querySelector('input[type="checkbox"]');
                            if (!input) return;
                            const text = input.value.trim();
                            if (!text) return;
                            options.push(text);
                            if (chk && chk.checked) {
                                const letter = String.fromCharCode(65 + idx);
                                ansLetters.push(letter);
                            }
                        });
                        if (!options.length || options.length < 2) {
                            if (errEl) errEl.textContent = '选项内容不能为空，并且至少两项。';
                            return;
                        }
                        if (!ansLetters.length) {
                            if (errEl) errEl.textContent = '请至少勾选一个正确选项。';
                            return;
                        }
                        answer = ansLetters.sort().join('');
                        if (type === 'mcq' && answer.length !== 1) {
                            if (errEl) errEl.textContent = '单选题只能有一个正确选项。';
                            return;
                        }
                    }

                    // 基础清洗：去掉选项前面的 A./1)/① 等前缀，避免重复前缀
                    const cleanedOptions = options.map(txt => {
                        return txt.replace(/^[A-Za-z0-9①-⑳Ａ-Ｚａ-ｚ０-９][\.、．:：）)\-\s]+/, '').trim();
                    });

                    App.data.upsertQuestion({
                        id,
                        sub,
                        chap,
                        type,
                        q,
                        o: type === 'tf' ? undefined : cleanedOptions,
                        a: answer
                    });

                    if (App.data && typeof App.data.saveToCloudDebounced === 'function') {
                        App.data.saveToCloudDebounced();
                    }

                    App.ui.closeModal('question-editor');
                    App.views.library.render(App.views.library.currentMode);
                },

                openTrashModal() {
                    const modal = App.dom.get('modal-trash');
                    const list = App.dom.get('trash-list');
                    if (!modal || !list) return;

                    if (!list.dataset.bound) {
                        list.addEventListener('click', (e) => {
                            const btn = e.target.closest('button[data-action]');
                            if (!btn) return;
                            const action = btn.dataset.action;
                            const sub = decodeURIComponent(btn.dataset.sub || '');
                            const chap = decodeURIComponent(btn.dataset.chap || '');
                            const id = decodeURIComponent(btn.dataset.id || '');
                            if (action === 'restore') {
                                App.data.restoreFromTrash(sub, chap, id);
                                App.ui.openTrashModal();
                            } else if (action === 'destroy') {
                                if (confirm('确定要永久删除这道题吗？此操作不可恢复。')) {
                                    App.data.destroyFromTrash(sub, chap, id);
                                    App.ui.openTrashModal();
                                }
                            }
                        });
                        list.dataset.bound = '1';
                    }

                    list.innerHTML = '';
                    const trash = App.data.trash || {};
                    const subs = Object.keys(trash);

                    if (!subs.length) {
                        list.innerHTML = '<div class="text-center text-[var(--sub)] py-8">回收站为空。</div>';
                    } else {
                        subs.forEach(sub => {
                            const chapDict = trash[sub] || {};
                            const chaps = Object.keys(chapDict);
                            chaps.forEach(chap => {
                                const arr = chapDict[chap] || [];
                                if (!arr.length) return;
                                const block = document.createElement('div');
                                block.className = 'mb-4 border border-[var(--border)] rounded-xl p-3 bg-[var(--card)]';
                                block.innerHTML = `
                                    <div class="flex items-center justify-between mb-2">
                                        <div class="flex items-center gap-2">
                                            <span class="text-[10px] font-bold text-primary-600 bg-primary-50 px-1 rounded border border-primary-100">${sub}</span>
                                            <span class="text-[10px] text-[var(--sub)] border border-[var(--border)] px-1 rounded">${chap}</span>
                                        </div>
                                        <span class="text-[10px] text-[var(--sub)]">${arr.length} 题</span>
                                    </div>
                                `;
                                arr.forEach(q => {
                                    const item = document.createElement('div');
                                    item.className = 'mt-2 p-2 rounded-lg border border-dashed border-[var(--border)] bg-[var(--bg)]';
                                    const timeStr = q.deletedAt ? new Date(q.deletedAt).toLocaleString() : '';
                                    const subKey = encodeURIComponent(sub);
                                    const chapKey = encodeURIComponent(chap);
                                    const idKey = encodeURIComponent(q.id || '');
                                    const safeQuestion = App.utils.escapeHTML(q.q || '');
                                    const safeReason = App.utils.escapeHTML(q.reason || '未知');
                                    const safePathSub = App.utils.escapeHTML(q.originalPath?.sub || sub);
                                    const safePathChap = App.utils.escapeHTML(q.originalPath?.chap || chap);
                                    item.innerHTML = `
                                        <div class="flex justify-between items-center mb-1">
                                            <div class="text-[10px] text-[var(--sub)]">ID: ${q.id}</div>
                                            <div class="flex items-center gap-2">
                                                <span class="text-[10px] text-[var(--sub)]">${timeStr}</span>
                                                <button class="px-2 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-600 text-[10px] font-bold"
                                                    data-action="restore" data-sub="${subKey}" data-chap="${chapKey}" data-id="${idKey}">
                                                    恢复
                                                </button>
                                                <button class="px-2 py-0.5 rounded border border-red-200 bg-red-50 text-red-600 text-[10px] font-bold"
                                                    data-action="destroy" data-sub="${subKey}" data-chap="${chapKey}" data-id="${idKey}">
                                                    彻底删除
                                                </button>
                                            </div>
                                        </div>
                                        <div class="text-[11px] font-medium text-[var(--text)] mb-1">${safeQuestion}</div>
                                        <div class="text-[10px] text-[var(--sub)]">删除原因：${safeReason} / 路径：${safePathSub} - ${safePathChap}</div>
                                    `;
                                    block.appendChild(item);
                                });
                                list.appendChild(block);
                            });
                        });
                    }

                    modal.classList.remove('hidden');
                    setTimeout(() => modal.classList.remove('opacity-0', 'pointer-events-none'), 10);
                },

                openBankManager() {
                    if (typeof this.closeModal === 'function') {
                        this.closeModal('config');
                    }
                    const modal = App.dom.get('modal-bank-manager');
                    if (!modal) return;
                    if (!this._bankMgrBound) {
                        const subList = App.dom.get('bank-manager-subject-list');
                        const chapList = App.dom.get('bank-manager-chapter-list');
                        if (subList) {
                            subList.addEventListener('click', (e) => {
                                const btn = e.target.closest('button[data-action]');
                                if (!btn) return;
                                const action = btn.dataset.action;
                                const sub = btn.dataset.sub ? decodeURIComponent(btn.dataset.sub) : '';
                                if (!sub) return;
                                if (action === 'select-sub') {
                                    this._bankMgrCurrentSubject = sub;
                                    this.renderBankManager();
                                } else if (action === 'rename-sub') {
                                    App.data.renameSubjectInteractive(sub);
                                } else if (action === 'delete-sub') {
                                    App.data.deleteSubjectInteractive(sub);
                                }
                            });
                        }
                        if (chapList) {
                            chapList.addEventListener('click', (e) => {
                                const btn = e.target.closest('button[data-action]');
                                if (!btn) return;
                                const action = btn.dataset.action;
                                const sub = btn.dataset.sub ? decodeURIComponent(btn.dataset.sub) : '';
                                const chap = btn.dataset.chap ? decodeURIComponent(btn.dataset.chap) : '';
                                if (!sub || !chap) return;
                                if (action === 'rename-chap') {
                                    App.data.renameChapterInteractive(sub, chap);
                                } else if (action === 'delete-chap') {
                                    App.data.deleteChapterInteractive(sub, chap);
                                }
                            });
                        }
                        this._bankMgrBound = true;
                    }
                    const subjects = App.data.getSubjects();
                    if (!this._bankMgrCurrentSubject || subjects.indexOf(this._bankMgrCurrentSubject) === -1) {
                        this._bankMgrCurrentSubject = subjects[0] || '';
                    }
                    this.renderBankManager();
                    modal.classList.remove('hidden');
                    setTimeout(() => {
                        modal.classList.remove('opacity-0', 'pointer-events-none');
                    }, 10);
                },

                closeBankManager() {
                    const modal = App.dom.get('modal-bank-manager');
                    if (!modal) return;
                    modal.classList.add('opacity-0', 'pointer-events-none');
                    setTimeout(() => modal.classList.add('hidden'), 150);
                },

                renderBankManager() {
                    const subList = App.dom.get('bank-manager-subject-list');
                    const chapList = App.dom.get('bank-manager-chapter-list');
                    const currentLabel = App.dom.get('bank-manager-current-subject');
                    if (!subList || !chapList || !currentLabel) return;
                    const subjects = App.data.getSubjects();
                    if (!subjects.length) {
                        subList.innerHTML = '<div class="text-[10px] text-[var(--sub)] py-4 text-center">当前没有科目，请先导入或新增题目。</div>';
                        chapList.innerHTML = '<div class="text-[10px] text-[var(--sub)] py-4 text-center">暂无章节。</div>';
                        currentLabel.textContent = '';
                        return;
                    }
                    const current = this._bankMgrCurrentSubject && subjects.indexOf(this._bankMgrCurrentSubject) !== -1
                        ? this._bankMgrCurrentSubject
                        : subjects[0];
                    this._bankMgrCurrentSubject = current;
                    currentLabel.textContent = current;
                    let subHtml = '';
                    subjects.forEach(sub => {
                        const chaps = App.data.getChapters(sub);
                        const total = chaps.reduce((n, chap) => {
                            const arr = App.data.bank[sub] && App.data.bank[sub][chap];
                            return n + (Array.isArray(arr) ? arr.length : 0);
                        }, 0);
                        const activeClass = sub === current ? 'border-primary-300 bg-primary-50' : 'border-[var(--border)] bg-[var(--card)]';
                        subHtml += `
                            <div class="flex items-center justify-between px-3 py-2 rounded-xl border ${activeClass}">
                                <div class="flex flex-col">
                                    <span class="text-[11px] font-bold text-[var(--text)]">${App.utils.escapeHTML(sub)}</span>
                                    <span class="text-[10px] text-[var(--sub)]">${chaps.length} 章节 · ${total} 题</span>
                                </div>
                                <div class="flex items-center gap-1">
                                    <button data-action="select-sub" data-sub="${encodeURIComponent(sub)}" class="px-2 py-1 rounded-lg text-[10px] border border-[var(--border)]">查看</button>
                                    <button data-action="rename-sub" data-sub="${encodeURIComponent(sub)}" class="px-2 py-1 rounded-lg text-[10px] border border-blue-200 text-blue-600 bg-blue-50">重命名</button>
                                    <button data-action="delete-sub" data-sub="${encodeURIComponent(sub)}" class="px-2 py-1 rounded-lg text-[10px] border border-red-200 text-red-600 bg-red-50">删除</button>
                                </div>
                            </div>
                        `;
                    });
                    subList.innerHTML = subHtml;

                    const chapters = App.data.getChapters(current);
                    if (!chapters.length) {
                        chapList.innerHTML = '<div class="text-[10px] text-[var(--sub)] py-4 text-center">该科目暂无章节。</div>';
                        return;
                    }
                    let chapHtml = '';
                    chapters.forEach(chap => {
                        const arr = App.data.bank[current] && App.data.bank[current][chap];
                        const count = Array.isArray(arr) ? arr.length : 0;
                        chapHtml += `
                            <div class="flex items-center justify-between px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--card)]">
                                <div class="flex flex-col">
                                    <span class="text-[11px] font-bold text-[var(--text)]">${App.utils.escapeHTML(chap)}</span>
                                    <span class="text-[10px] text-[var(--sub)]">${count} 题</span>
                                </div>
                                <div class="flex items-center gap-1">
                                    <button data-action="rename-chap" data-sub="${encodeURIComponent(current)}" data-chap="${encodeURIComponent(chap)}" class="px-2 py-1 rounded-lg text-[10px] border border-blue-200 text-blue-600 bg-blue-50">重命名</button>
                                    <button data-action="delete-chap" data-sub="${encodeURIComponent(current)}" data-chap="${encodeURIComponent(chap)}" class="px-2 py-1 rounded-lg text-[10px] border border-red-200 text-red-600 bg-red-50">删除</button>
                                </div>
                            </div>
                        `;
                    });
                    chapList.innerHTML = chapHtml;
                },

                _bankMgrBound: false,
                _bankMgrCurrentSubject: ''
            },
            sync: {
                _lastStatus: 'success',
                _realtimeDisconnected: false,
                _lastMessage: '',
                _lastSyncDebug: null,
                render() {
                    const btn = App.dom.get('save-cloud-btn');
                    const icon = document.getElementById('sync-indicator-icon');
                    const textEl = document.getElementById('sync-text');
                    if (!btn || !icon) return;

                    // Reset classes on dot and button
                    btn.className = "flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all duration-200 active:scale-95 border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50";
                    icon.className = "w-2 h-2 rounded-full transition-all duration-300";
                    
                    let titleText = '';
                    let statusText = '已同步';

                    if (this._lastStatus === 'error') {
                        btn.classList.add('border-red-400', 'bg-red-500/5');
                        icon.classList.add('bg-red-500', 'shadow-[0_0_8px_rgba(239,68,68,0.4)]');
                        statusText = '同步失败';
                        titleText = '最近同步：失败（' + (this._lastMessage || '同步失败') + '）';
                    } else if (this._lastStatus === 'pending') {
                        btn.classList.add('border-primary-500', 'bg-primary-500/5');
                        icon.classList.add('bg-primary-500', 'animate-pulse');
                        statusText = '同步中...';
                        titleText = '同步中...';
                    } else if (this._realtimeDisconnected) {
                        btn.classList.add('border-yellow-400', 'bg-yellow-500/5');
                        icon.classList.add('bg-yellow-500');
                        statusText = '未连接';
                        titleText = '实时通道未连接' + (this._lastMessage ? '（' + this._lastMessage + '）' : '');
                    } else {
                        btn.classList.add('border-emerald-500', 'bg-emerald-500/5');
                        icon.classList.add('bg-emerald-500');
                        statusText = '已同步';
                        titleText = '最近同步：成功';
                    }

                    if (textEl) {
                        textEl.textContent = statusText;
                    }
                    btn.title = titleText;
                },
                setStatus(status, delta, message) {
                    this._lastStatus = status || 'success';
                    this._lastMessage = message || '';
                    this.render();
                },
                setDebug(info) {
                    this._lastSyncDebug = info;
                },
                showSyncStatus(status, delta, message) {
                    this.setStatus(status, delta, message);
                    if (status === 'error') {
                        const toast = document.getElementById('sync-toast');
                        if (toast) {
                            toast.textContent = message || '同步失败';
                            toast.classList.remove('opacity-0');
                            toast.classList.add('opacity-100');
                            if (this._toastTimer) {
                                clearTimeout(this._toastTimer);
                            }
                            this._toastTimer = setTimeout(() => {
                                toast.classList.add('opacity-0');
                                toast.classList.remove('opacity-100');
                            }, 5000);
                        }
                    }
                },
                async openLogPanel() {
                    if (!App.auth || typeof App.auth.getToken !== 'function') return;
                    const token = await App.auth.getToken();
                    if (!token) return;
                    let res;
                    try {
                        res = await fetch((App.apiBase || '') + '/api/sync-logs', {
                            method: 'GET',
                            headers: {
                                Authorization: 'Bearer ' + token
                            }
                        });
                    } catch (e) {
                        console.error('获取同步记录失败', e);
                        return;
                    }
                    if (!res.ok) {
                        console.error('获取同步记录失败', res.status);
                        return;
                    }
                    let data;
                    try {
                        data = await res.json();
                    } catch (e) {
                        console.error('解析同步记录失败', e);
                        return;
                    }
                    const list = document.getElementById('sync-log-list');
                    const modal = document.getElementById('sync-log-modal');
                    const debugPanel = document.getElementById('sync-debug-panel');
                    if (!list || !modal) return;
                    if (debugPanel) {
                        const dbg = this._lastSyncDebug;
                        if (!dbg) {
                            debugPanel.innerHTML = '<div class="text-[var(--sub)]">暂无诊断信息</div>';
                        } else {
                            const time = dbg.time ? new Date(dbg.time).toLocaleString() : '';
                            debugPanel.innerHTML = `
                                <div class="flex flex-col gap-1">
                                    <div class="text-[10px] uppercase tracking-wider text-[var(--sub)]">同步诊断</div>
                                    <div>时间：${App.utils.escapeHTML(time)}</div>
                                    <div>题库：${App.utils.escapeHTML(dbg.name || '')}</div>
                                    <div>questions=${dbg.questionsCount} / history=${dbg.historyCount} / trash=${dbg.trashCount}</div>
                                    <div>skipQuestionsUpdate=${dbg.skipQuestionsUpdate ? 'true' : 'false'} / version=${dbg.version}</div>
                                </div>
                            `;
                        }
                    }
                    list.innerHTML = '';
                    const logs = data && data.ok && Array.isArray(data.logs) ? data.logs : [];
                    if (!logs.length) {
                        list.innerHTML = '<div class="text-[var(--sub)] text-xs py-4 text-center">暂无同步记录</div>';
                    } else {
                        logs.forEach(l => {
                            const line = document.createElement('div');
                            line.className = 'flex flex-col gap-1 px-3 py-2 border-b border-[var(--border)]';
                            const time = l.created_at ? new Date(l.created_at).toLocaleString() : '';
                            const status = l.status || 'unknown';
                            const delta = l.delta || {};
                            const qd = delta.questions || 0;
                            const hd = delta.history || 0;
                            const td = delta.trash || 0;
                            const statusText = status === 'success' ? '成功' : status === 'error' ? '失败' : status;
                            const statusColor = status === 'success' ? 'text-emerald-500' : status === 'error' ? 'text-red-500' : 'text-[var(--sub)]';
                            line.innerHTML = `
                                <div class="flex justify-between items-center text-xs">
                                    <span class="text-[var(--sub)]">${time}</span>
                                    <span class="${statusColor} font-bold">${statusText}</span>
                                </div>
                                <div class="text-[10px] text-[var(--sub)]">
                                    题库变化 ${qd >= 0 ? '+' : ''}${qd}，记录变化 ${hd >= 0 ? '+' : ''}${hd}${td ? `，回收站变化 ${td >= 0 ? '+' : ''}${td}` : ''}
                                </div>
                                ${l.error ? `<div class="text-[10px] text-red-500">错误：${App.utils.escapeHTML(l.error)}</div>` : ''}
                            `;
                            list.appendChild(line);
                        });
                    }
                    modal.classList.remove('hidden');
                    modal.classList.remove('opacity-0', 'pointer-events-none');
                    if (!modal.dataset.bound) {
                        modal.addEventListener('click', (e) => {
                            if (e.target === modal) {
                                App.sync.closeLogPanel();
                            }
                        });
                        modal.dataset.bound = '1';
                    }
                },
                closeLogPanel() {
                    const modal = document.getElementById('sync-log-modal');
                    if (!modal) return;
                    modal.classList.add('opacity-0', 'pointer-events-none');
                    setTimeout(() => {
                        modal.classList.add('hidden');
                    }, 200);
                },
                startAutoPull(intervalMs) {
                    // Bug #16 fix: 轮询回退机制，当 WebSocket/Ably 不可用时定期拉取更新
                    this.stopAutoPull();
                    const interval = intervalMs || 60000; // 默认 60 秒
                    this._pollTimer = setInterval(() => {
                        if (window.App && App.data && typeof App.data.loadFromCloud === 'function') {
                            App.data.loadFromCloud();
                        }
                    }, interval);
                },
                stopAutoPull() {
                    if (this._pollTimer) {
                        clearInterval(this._pollTimer);
                        this._pollTimer = null;
                    }
                },
                _toastTimer: null,
                _pollTimer: null
            },
            realtime: {
                client: null,
                channel: null,
                ws: null,
                mode: null,
                setup(userId, token) {
                    if (!userId || !token) return;
                    if (this.mode) return;
                    const wsUrl = (window.REALTIME_WS_URL || '').trim();
                    if (wsUrl) {
                        this.mode = 'ws';
                        this._setupWebSocket(wsUrl, userId, token);
                    }
                },
                _setDisconnected(msg) {
                    if (window.App && App.sync && typeof App.sync.render === "function") {
                        App.sync._realtimeDisconnected = true;
                        App.sync._lastMessage = msg || '';
                        App.sync.render();
                    }
                },
                _setConnected() {
                    if (window.App && App.sync && typeof App.sync.render === "function") {
                        App.sync._realtimeDisconnected = false;
                        App.sync._lastMessage = '';
                        App.sync.render();
                    }
                },
                _wsReconnectDelay: 1000,
                _wsMaxReconnectDelay: 30000,
                _wsReconnectTimer: null,
                _setupWebSocket(baseUrl, userId, token) {
                    // 清除之前的重连计时器
                    if (this._wsReconnectTimer) {
                        clearTimeout(this._wsReconnectTimer);
                        this._wsReconnectTimer = null;
                    }
                    try {
                        let url = baseUrl;
                        try {
                            const u = new URL(baseUrl);
                            u.searchParams.set('userId', userId);
                            u.searchParams.set('token', token);
                            url = u.toString();
                        } catch (e) {
                            const sep = baseUrl.includes('?') ? '&' : '?';
                            url = `${baseUrl}${sep}userId=${encodeURIComponent(userId)}&token=${encodeURIComponent(token)}`;
                        }
                        const ws = new WebSocket(url);
                        this.ws = ws;
                        ws.onopen = () => {
                            this._setConnected();
                            // 连接成功，重置重连延迟
                            this._wsReconnectDelay = 1000;
                        };
                        ws.onmessage = (evt) => {
                            let data = null;
                            try {
                                data = JSON.parse(evt.data);
                            } catch (e) { }
                            if (!data || typeof data !== 'object') return;
                            if (data.type === 'set-updated') {
                                if (window.App && App.data && typeof App.data.loadFromCloud === "function") {
                                    App.data.loadFromCloud();
                                }
                            }
                        };
                        ws.onclose = () => {
                            this._setDisconnected('');
                            this.ws = null;
                            // Bug #2 fix: 指数退避自动重连
                            this._scheduleReconnect(baseUrl, userId, token);
                        };
                        ws.onerror = () => {
                            this._setDisconnected('Realtime gateway error');
                        };
                    } catch (e) {
                        this._setDisconnected('初始化实时连接失败');
                        this._scheduleReconnect(baseUrl, userId, token);
                    }
                },
                _scheduleReconnect(baseUrl, userId, token) {
                    if (this._wsReconnectTimer) return;
                    const delay = this._wsReconnectDelay;
                    console.log(`[Realtime] WebSocket will reconnect in ${delay}ms`);
                    this._wsReconnectTimer = setTimeout(() => {
                        this._wsReconnectTimer = null;
                        // 指数退避：每次重连失败后延迟翻倍，最大 30 秒
                        this._wsReconnectDelay = Math.min(this._wsReconnectDelay * 2, this._wsMaxReconnectDelay);
                        this._setupWebSocket(baseUrl, userId, token);
                    }, delay);
                },

                teardown() {
                    if (this.ws) {
                        try {
                            this.ws.close();
                        } catch (e) { }
                        this.ws = null;
                    }
                    if (this.channel) {
                        try {
                            this.channel.unsubscribe();
                        } catch (e) { }
                        this.channel = null;
                    }
                    if (this.client) {
                        try {
                            this.client.close();
                        } catch (e) { }
                        this.client = null;
                    }
                    this.mode = null;
                }
            },

            init() {
                this.data.init();
                this.ui.initTheme();
                this.auth.init();
                this.ai.init();
                this.router.init();
                this.ui._initGlobalBackTop();
            }
        };

        window.addEventListener('DOMContentLoaded', () => {
            window.App = App;
            App.init();
            window.addEventListener('storage', (e) => {
                if (!e.key) return;
                // Bug #13 fix: 仅在核心数据键变更时弹出确认框
                const dataKeys = [
                    App.data && App.data.bankKey,
                    App.data && App.data.historyKey,
                    App.data && App.data.trashKey
                ].filter(Boolean);
                if (!dataKeys.includes(e.key)) return;
                const shouldReload = window.confirm(
                    '检测到其他标签页修改了题库数据。\n\n点击“确定”重新加载当前标签页的数据，点击“取消”忽略本次变更。'
                );
                if (!shouldReload) return;
                if (window.App && App.data && typeof App.data.init === 'function') {
                    App.data.init();
                }
                if (window.App && App.router && typeof App.router.go === 'function') {
                    const view = App.router.currentView || 'dashboard';
                    App.router.go(view);
                }
            });
        });
        window.addEventListener("DOMContentLoaded", function () {
            const saveBtn = document.getElementById("save-cloud-btn");
            const overlayLoginBtn = document.getElementById("auth-overlay-login-btn");
            const authBtn = document.getElementById("auth-btn");
            const loginBtn = document.getElementById("auth-login-btn");
            const signupBtn = document.getElementById("auth-signup-btn");
            const emailInput = document.getElementById("auth-email");
            const passwordInput = document.getElementById("auth-password");
            const statusEl = document.getElementById("auth-status");
            const showStatus = (msg) => { if (statusEl) statusEl.textContent = msg || ''; };
            if (saveBtn) {
                saveBtn.addEventListener("contextmenu", function (e) {
                    e.preventDefault();
                    if (window.App && App.sync && typeof App.sync.openLogPanel === "function") {
                        App.sync.openLogPanel();
                    }
                });
            }
            const openAuthModal = () => {
                if (window.App && App.ui && typeof App.ui.toggleModal === "function") {
                    App.ui.toggleModal('auth');
                }
            };
            if (authBtn) {
                authBtn.addEventListener("click", function () {
                    if (window.App && App.auth && App.auth.session) {
                        App.auth.logout();
                    } else {
                        openAuthModal();
                    }
                });
            }
            if (overlayLoginBtn) {
                overlayLoginBtn.addEventListener("click", function () {
                    openAuthModal();
                });
            }
            if (loginBtn) {
                loginBtn.addEventListener("click", async function () {
                    const loginId = emailInput ? emailInput.value.trim() : '';
                    const password = passwordInput ? passwordInput.value : '';
                    if (!loginId || !password) {
                        showStatus('请输入用户名和密码');
                        return;
                    }
                    showStatus('登录中...');
                    const { error } = await App.auth.login(loginId, password);
                    if (error) {
                        showStatus(error.message || '登录失败');
                        return;
                    }
                    showStatus('登录成功');
                    if (window.App && App.ui && typeof App.ui.closeModal === "function") {
                        App.ui.closeModal('auth');
                    }
                });
            }
            if (signupBtn) {
                signupBtn.addEventListener("click", async function () {
                    const loginId = emailInput ? emailInput.value.trim() : '';
                    const password = passwordInput ? passwordInput.value : '';
                    if (!loginId || !password) {
                        showStatus('请输入用户名和密码');
                        return;
                    }
                    showStatus('注册中...');
                    const { error } = await App.auth.signup(loginId, password);
                    if (error) {
                        const msg = /already registered/i.test(error.message || '') ? '该用户名已被注册' : (error.message || '注册失败');
                        showStatus(msg);
                        return;
                    }
                    showStatus('注册成功，可以直接使用该用户名登录');
                });
            }
        });