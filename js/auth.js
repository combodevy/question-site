export const auth = {

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
            
};