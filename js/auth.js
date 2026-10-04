export const auth = {

                token: null,
                session: null,
                init() {
                    this.token = localStorage.getItem('qs-auth-token') || null;
                    if (this.token) {
                        const payload = this.parseJwt(this.token);
                        // 过期的 token 不再建立会话：否则界面显示「已登录」，
                        // 但每个请求都会 401，用户会以为数据在同步其实没有
                        const expired = payload && typeof payload.exp === 'number'
                            && payload.exp < Math.floor(Date.now() / 1000);
                        if (payload && !expired) {
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
                    // 告诉密码管理器这是「登录已有账号」：避免 Chrome 把登录框
                    // 误判成注册表单而乱弹保存/泄露检查提示
                    const pwEl = document.getElementById('auth-password');
                    if (pwEl) pwEl.setAttribute('autocomplete', 'current-password');
                    
                    try {
                        const res = await fetch((App.apiBase || '') + '/api/auth/login', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ username, password })
                        });
                        // 网关 502/504 会返回 HTML，res.json() 直接抛 SyntaxError——兜住给友好文案
                        let data = null;
                        try { data = await res.json(); } catch (_) {}
                        if (!res.ok) {
                            return { error: { message: (data && data.error) || (res.status >= 500 ? '服务器暂时不可用，请稍后重试' : '登录失败') } };
                        }
                        // 服务端没给凭证时不能继续：否则会把字符串 "undefined" 写进 localStorage，
                        // 并把内部的 TypeError 文案直接显示给用户
                        if (!data || typeof data.token !== 'string' || !data.token) {
                            return { error: { message: '服务器未返回登录凭证，请稍后重试' } };
                        }
                        this.token = data.token;
                        localStorage.setItem('qs-auth-token', this.token);
                        const payload = this.parseJwt(this.token);
                        if (!payload) {
                            this.token = null;
                            localStorage.removeItem('qs-auth-token');
                            return { error: { message: '登录凭证无法解析，请稍后重试' } };
                        }
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
                    // 注册 = 设定新密码：标记为 new-password，Chrome 才会按
                    // 「新密码」流程处理（含正常的泄露检查），而不是按登录复用处理
                    const pwEl2 = document.getElementById('auth-password');
                    if (pwEl2) pwEl2.setAttribute('autocomplete', 'new-password');
                    const username = (loginId || '').trim();
                    if (!username) return { error: { message: '用户名不能为空' } };
                    if (username.includes('@')) return { error: { message: '用户名不能包含 @ 符号' } };
                    
                    try {
                        const res = await fetch((App.apiBase || '') + '/api/auth/signup', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ username, password })
                        });
                        let data = null;
                        try { data = await res.json(); } catch (_) {}
                        if (!res.ok) {
                            return { error: { message: (data && data.error) || (res.status >= 500 ? '服务器暂时不可用，请稍后重试' : '注册失败') } };
                        }
                        // 同 login：没凭证就停下，不要写入 "undefined" 或泄露内部错误
                        if (!data || typeof data.token !== 'string' || !data.token) {
                            return { error: { message: '服务器未返回注册凭证，请稍后重试' } };
                        }
                        this.token = data.token;
                        localStorage.setItem('qs-auth-token', this.token);
                        const payload = this.parseJwt(this.token);
                        if (!payload) {
                            this.token = null;
                            localStorage.removeItem('qs-auth-token');
                            return { error: { message: '注册凭证无法解析，请稍后重试' } };
                        }
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
                async logout(force = false) {
                    // 登出保护：本地有未上传的修改时，先上传完成再退出。
                    // 旧行为是「确认后照样清空本机」，提示却说数据留在本机——承诺和行为相反。
                    // 现在的行为：确定 = 等上传完成（最多约 6 秒）后退出；上传失败会再次
                    // 明确询问「仍要退出将丢失未上传的修改」，用户知情确认才允许丢数据。
                    if (!force && window.App && App.data) {
                        const d = App.data;
                        const hasPending = d._bankDirty || (Array.isArray(d._historyAppendBuffer) && d._historyAppendBuffer.length > 0) || d._isSaving;
                        if (hasPending) {
                            const choice = confirm(
                                '本地还有未同步到云端的修改。\n\n' +
                                '点击「确定」= 先把修改上传到云端，成功后自动退出；\n' +
                                '点击「取消」= 留在本页等待同步完成。\n\n' +
                                '（如需永久备份，请先在账户菜单中「导出全部题库」）'
                            );
                            if (!choice) return;
                            if (d.saveToCloudDebounced) d.saveToCloudDebounced();
                            let settled = false;
                            for (let i = 0; i < 24; i++) {
                                await new Promise(r => setTimeout(r, 250));
                                const stillDirty = d._bankDirty || (Array.isArray(d._historyAppendBuffer) && d._historyAppendBuffer.length > 0);
                                if (!stillDirty && !d._isSaving && !d._saveAgainPending && !d._cloudLoading) {
                                    settled = true;
                                    break;
                                }
                                // 空闲且有脏数据才补一脚：直接 await 完整保存。
                                // 千万不要再调 saveToCloudDebounced——它会先取消已在排队的
                                // 防抖计时器再置 _saveAgainPending，等待中的上传被取消，
                                // 循环就永远等不到「已同步」（实测踩过的死锁）。
                                if (stillDirty && !d._isSaving && !d._saveAgainPending && !d._cloudSaveTimer && typeof d.saveToCloud === 'function') {
                                    await d.saveToCloud();
                                }
                            }
                            if (!settled) {
                                const force2 = confirm(
                                    '上传没有在预期时间内完成（可能已离线）。\n\n' +
                                    '现在退出会丢失未上传的修改。\n\n' +
                                    '点击「确定」= 仍然退出（丢失未上传的修改）；\n' +
                                    '点击「取消」= 留在本页。'
                                );
                                if (!force2) return;
                                force = true;   // 用户在知情前提下选择丢弃
                            }
                        }
                    }
                    this.token = null;
                    this.session = null;
                    localStorage.removeItem('qs-auth-token');
                    this.applyAuthState();
                    // 登出 = 离开个人上下文：回首页，别把用户留在上一个账号的
                    // 个人空间/练习结果页上；同步 chip 也要立即变回未登录态
                    if (window.App && App.router && typeof App.router.go === 'function') App.router.go('dashboard');
                    if (window.App && App.sync && typeof App.sync.render === 'function') App.sync.render();
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
                        btn.title = "账户";
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
                            const d = App.data;
                            const hasLocalPending = d._bankDirty ||
                                (Array.isArray(d._historyAppendBuffer) && d._historyAppendBuffer.length > 0);
                            if (hasLocalPending) {
                                // 先推后拉：本机存着上次会话没上传完的修改，直接 loadFromCloud
                                // 会违反「云端不得覆盖本地新数据」的守卫。先上传本地状态
                                //（冲突则走 409 合并），保存成功后再补一次拉取收敛双方。
                                d._pullAfterSave = true;
                                if (typeof d.saveToCloudDebounced === 'function') d.saveToCloudDebounced();
                            } else {
                                d.loadFromCloud();
                            }
                        }
                        if (window.App && App.sync && typeof App.sync.startAutoPull === "function") {
                            App.sync.startAutoPull();
                        }
                        if (window.App && App.realtime && typeof App.realtime.setup === "function") {
                            const token = this.session.access_token;
                            const uid = this.getUserId();
                            App.realtime.setup(uid, token);
                        }
                        // 登录后立即把同步 chip 从「未登录」切回正常态（不等第一次同步往返）
                        if (window.App && App.sync && typeof App.sync.render === 'function') App.sync.render();
                    } else {
                        btn.title = "登录";
                        // 页面加载即未登录：把同步 chip 从静态「已同步」修正为「未登录」
                        if (window.App && App.sync && typeof App.sync.render === 'function') App.sync.render();
                        if (overlay) {
                            overlay.classList.remove("hidden", "opacity-0", "pointer-events-none");
                        }
                        if (window.App && App.data && typeof App.data.clearAllForLogout === "function") {
                            App.data.clearAllForLogout();
                        }
                        // 登出后立即清空界面上的旧统计，避免显示上一个账号的数据
                        if (window.App && App.router && typeof App.router.refresh === "function") {
                            App.router.refresh();
                        }
                        if (window.App && App.sync && typeof App.sync.stopAutoPull === "function") {
                            App.sync.stopAutoPull();
                        }
                        if (window.App && App.realtime && typeof App.realtime.teardown === "function") {
                            App.realtime.teardown();
                        }
                    }
                }
            
};