import { dom } from './dom.js';
import { utils } from './utils.js';
import { chart } from './chart.js';
import { auth } from './auth.js';
import { data, sync } from './data.js';
import { quiz } from './quiz.js';
import { router } from './router.js';
import { ui } from './ui.js';
import { dashboard } from './views/dashboard.js';
import { setup } from './views/setup.js';
import { library } from './views/library.js';
import { analytics } from './views/analytics.js';
import { profile } from './views/profile.js';
import { english } from './views/english.js';
import { i18n } from './i18n.js';
import { prefs } from './prefs.js';

const App = {
    apiBase: window.API_BASE || '',
    dom,
    utils,
    chart,
    auth,
    data,
    sync,
    quiz,
    router,
    ui,
    i18n,
    prefs,
    // 全局翻译入口：UI 生成字符串专用（题库用户内容不得经过它）
    t: (s) => i18n.t(s),
    views: {
        dashboard,
        setup,
        library,
        analytics,
        profile,
        english
    },
    async init() {
        // 逐步容错：任何一步失败都不能阻止后面的初始化。
        // 特别是 auth.init()——它负责把「请先登录」遮罩收起来；
        // 一旦它没跑，整页都会被那个遮罩挡住，表现为「什么按钮都点不了」。
        // 语言先行：翻译钩子（alert/confirm/DOM walker）必须在任何 UI 渲染前就位
        try { this.i18n.apply(); } catch (e) { console.error('i18n apply failed', e); }
        const steps = [
            ['data.init', () => this.data.init()],
            ['ui.initTheme', () => this.ui.initTheme()],
            ['ui.initModalInteractions', () => this.ui.initModalInteractions()],
            ['auth.init', () => this.auth.init()],
            ['router.init', () => this.router.init()],
            ['ui._initGlobalBackTop', () => this.ui._initGlobalBackTop()],
            ['ui._initPwToggles', () => this.ui._initPwToggles()],
        ];
        for (const [name, fn] of steps) {
            try {
                await fn();
            } catch (e) {
                console.error(`[App.init] ${name} 失败，继续执行后续初始化`, e);
            }
        }
    }
};

window.addEventListener('DOMContentLoaded', async () => {
    window.App = App;
    await App.init();

    // ===== 全局错误提示：任何未捕获异常都可见，避免"点了没反应"式的静默失败 =====
    // 同时上报到 Worker（/api/client-errors），管理后台「系统日志」可见——
    // 线上出问题开发者先于用户知道。节流：每会话最多报 5 条，防止循环上报。
    let lastReportedError = null;
    const showGlobalError = (msg, err) => {
        let toast = document.getElementById('global-error-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'global-error-toast';
            // pointer-events-none：这是纯提示、没有任何可点的东西，
            // 不能让它悬在页面上挡住下面的按钮（尤其它 z-[70] 高于所有弹窗）
            toast.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 z-[70] pointer-events-none px-4 py-2 rounded-lg bg-red-600 text-white text-xs shadow-lg max-w-[90vw] transition-opacity duration-200';
            document.body.appendChild(toast);
        }
        toast.textContent = App.t('程序异常：') + msg;
        // 淡入：先归零再过渡到 1，避免直接蹦出（淡出已有 260ms 过渡）
        toast.style.display = 'block';
        toast.style.transition = 'opacity 200ms ease-out';
        toast.style.opacity = '0';
        void toast.offsetWidth;
        toast.style.opacity = '1';
        clearTimeout(showGlobalError._t);
        showGlobalError._t = setTimeout(() => {
            // 先淡出再隐藏，避免硬切消失
            toast.style.opacity = '0';
            setTimeout(() => { toast.style.display = 'none'; }, 260);
        }, 5000);

        // 错误上报（静默失败，不影响用户）
        if (!showGlobalError._reportCount) showGlobalError._reportCount = 0;
        if (showGlobalError._reportCount >= 5) return;
        if (!App.apiBase || !App.auth || !App.auth.session) return;
        if (msg === lastReportedError) return;   // 同一条错误不重复报
        lastReportedError = msg;
        showGlobalError._reportCount++;
        try {
            fetch(App.apiBase + '/api/client-errors', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + (App.auth.token || '')
                },
                body: JSON.stringify({
                    message: String(msg).slice(0, 300),
                    stack: err && err.stack ? String(err.stack).slice(0, 500) : '',
                    page: location.pathname
                })
            }).catch(() => { });
        } catch (e) { }
    };
    window.addEventListener('error', (e) => {
        if (e && e.message) showGlobalError(e.message.slice(0, 120), e.error);
    });
    window.addEventListener('unhandledrejection', (e) => {
        const reason = e && e.reason;
        if (reason && reason.message && !/fetch|network|Failed to fetch/i.test(reason.message)) {
            showGlobalError(reason.message.slice(0, 120), reason);
        }
    });

    // config.js 没加载成功时 window.API_BASE 会是空的，所有接口都会打到当前站点，
    // 表现为「同步一直失败」但没有任何线索。这里主动给出可见提示。
    if (typeof window.API_BASE === 'undefined') {
        // 只把「config.js 根本没加载」当异常；同源部署（API_BASE=""）是合法配置
        console.error('[App] window.API_BASE 未定义：config.js 可能未成功加载。');
        showGlobalError(App.t('配置缺失（config.js 未加载），云端同步不可用，请刷新页面重试'));
    }

    // ===== 版本检测：部署了新版本后提示用户刷新，避免一直跑旧代码 =====
    // ★ 曾经的问题：检测到新版本后只把提示条显示出来，却没有更新 localStorage 里的版本号，
    //   于是每次检查（包括用户刷新页面之后）都仍然判定为「有新版本」，提示条永久常驻。
    //   现在：一检测到新版本就立刻记录，本次会话提示一次，刷新拿到新代码后不再提示。
    App.checkAppVersion = async () => {
        try {
            const res = await fetch('/version.json', { cache: 'no-store' });
            if (!res.ok) return;
            const data = await res.json();
            if (!data || data.v === undefined || data.v === null) return;
            const key = 'qs_app_version';
            const known = localStorage.getItem(key);
            if (!known) {
                localStorage.setItem(key, String(data.v));
                return;
            }
            if (known === String(data.v)) return;   // 已经是最新，不提示

            // 立刻记录新版本号——这是「常驻」的根因修复
            localStorage.setItem(key, String(data.v));

            // 本次会话里用户主动点过「稍后」，就不再打扰（下次打开仍会提醒）
            try {
                if (sessionStorage.getItem('qs_version_dismissed') === String(data.v)) return;
            } catch (e) { /* 隐私模式下 sessionStorage 可能不可用 */ }

            let bar = document.getElementById('app-version-bar');
            if (!bar) {
                bar = document.createElement('div');
                bar.id = 'app-version-bar';
                // z-[45]：高于各种遮罩(40)、低于弹窗(50)。
                // 这样它永远不会盖在弹窗上挡住里面的按钮（曾用 z-[60]，会挡住弹窗底部）。
                bar.className = 'fixed bottom-14 left-1/2 -translate-x-1/2 z-[45] flex items-center gap-2 px-3 py-2 rounded-full bg-slate-900 text-white text-xs shadow-lg';
                bar.innerHTML = '<span>' + App.t('应用已更新') + '</span>'
                    + '<button id="app-version-reload" class="px-3 py-1 rounded-full bg-primary-600 font-bold active:scale-95 transition-transform">立即刷新</button>'
                    + '<button id="app-version-dismiss" class="px-1.5 py-1 rounded-full text-slate-300 hover:text-white leading-none" title="本次不再提示" aria-label="关闭">✕</button>';
                document.body.appendChild(bar);
                const reloadBtn = document.getElementById('app-version-reload');
                if (reloadBtn) reloadBtn.onclick = () => location.reload();
                const dismissBtn = document.getElementById('app-version-dismiss');
                if (dismissBtn) {
                    dismissBtn.onclick = () => {
                        try { sessionStorage.setItem('qs_version_dismissed', String(data.v)); } catch (e) { }
                        bar.style.display = 'none';
                    };
                }
            }
            bar.style.display = 'flex';
        } catch (e) { /* 离线或网络抖动时静默跳过 */ }
    };
    const versionThrottle = { last: 0 };
    App.maybeCheckAppVersion = () => {
        const now = Date.now();
        if (now - versionThrottle.last < 300000) return; // 5 分钟节流
        versionThrottle.last = now;
        App.checkAppVersion();
    };
    App.checkAppVersion();
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') App.maybeCheckAppVersion();
    });
    window.addEventListener('online', App.maybeCheckAppVersion);

    // ===== 窗口尺寸变化时重绘当前视图 =====
    // 图表画布按绘制时的容器尺寸定稿，窗口拉伸后旧图尺寸不再匹配。
    // 防抖 200ms：拖拽调整窗口的过程中不重画，停下后画一次。
    let resizeTimer = null;
    window.addEventListener('resize', () => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            const currentView = document.querySelector('[id^="view-"]:not(.hidden)');
            if (!currentView) return;
            const viewName = currentView.id.replace('view-', '');
            if (window.App && App.views && App.views[viewName] && typeof App.views[viewName].render === 'function') {
                App.views[viewName].render();
            }
        }, 200);
    });

    // ===== 自动同步时机补全 =====
    // 1. 切回标签页时拉一次云端（ETag 命中 304 几乎零成本；管理员推送的题库能即时出现）。
    //    节流 15 秒，避免快速切换标签页时频繁请求。
    let lastVisibilityPull = 0;
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        const now = Date.now();
        if (now - lastVisibilityPull < 15000) return;
        if (!window.App || !App.auth || !App.auth.session) return;
        if (!App.data || !App.data._syncReady || App.data._cloudLoading || App.data._isSaving) return;
        lastVisibilityPull = now;
        App.data.loadFromCloud();
    });

    // 1.5 跨标签页 IndexedDB 变更通知：storage 事件只覆盖 localStorage，
    //     题库数据在 IndexedDB 里，其他标签页的写入必须用 BroadcastChannel 广播。
    //     本标签页也有未保存修改时不直接覆盖（那会丢数据），改为提示 + 触发合并保存。
    try {
        App._tabId = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()));
        const dataChannel = new BroadcastChannel('qs_data_changed');
        dataChannel.onmessage = (e) => {
            const info = e.data || {};
            if (info.from === App._tabId) return;
            if (!window.App || !App.auth || !App.auth.session) return;
            // 账号校验：多标签页可能登录不同账号，别的账号的数据变化与本页无关
            const myUid = App.auth && typeof App.auth.getUserId === 'function' ? App.auth.getUserId() : '';
            if (info.uid && info.uid !== myUid) return;
            const dataKeys = [App.data && App.data.bankKey, App.data && App.data.historyKey,
                App.data && App.data.trashKey, App.data && App.data.starredKey].filter(Boolean);
            if (!info.key || !dataKeys.includes(info.key)) return;
            const d = App.data;
            const isStarredOnly = info.key === d.starredKey;
            const selfDirty = d._bankDirty || (Array.isArray(d._historyAppendBuffer) && d._historyAppendBuffer.length > 0) || d._isSaving;
            if (selfDirty) {
                if (typeof showGlobalError === 'function') showGlobalError(App.t('其他标签页修改了题库数据；本页也有未保存修改，保存时会自动合并。'));
                if (d.saveToCloudDebounced) d.saveToCloudDebounced();
                return;
            }
            // 纯收藏变化：静默从 IDB 重读，不打断用户（弹确认框对一颗星来说太吵）
            if (isStarredOnly) {
                if (typeof d.reloadFromLocalIDB === 'function') d.reloadFromLocalIDB();
                return;
            }
            // 非阻塞提示条替代 confirm：后台事件不该打断正在做题/操作的用户
            if (typeof showGlobalError === 'function') {
                showGlobalError(App.t('检测到其他标签页修改了题库数据。'));
                const bar = document.getElementById('global-error-toast');
                if (bar && !document.getElementById('tab-sync-reload')) {
                    const btn = document.createElement('button');
                    btn.id = 'tab-sync-reload';
                    btn.className = 'ml-2 underline font-bold';
                    btn.textContent = App.t('立即刷新');
                    btn.onclick = () => { if (window.App && App.data && App.data.reloadFromLocalIDB) App.data.reloadFromLocalIDB(); if (bar) bar.remove(); };
                    bar.appendChild(btn);
                }
            }
            // 关键：另一页的写入是即时落 IndexedDB 的（防抖只影响云端），
            // 所以确定后从共享 IDB 重读，而不是 loadFromCloud——云端可能还没收到
            if (typeof d.reloadFromLocalIDB === 'function') d.reloadFromLocalIDB();
            else if (d.loadFromCloud) d.loadFromCloud();
        };
        App._syncBroadcast = (key) => {
            try {
                const uid = App.auth && typeof App.auth.getUserId === 'function' ? App.auth.getUserId() : '';
                dataChannel.postMessage({ from: App._tabId, key, uid });
            } catch (err) { }
        };
    } catch (e) { /* 浏览器不支持 BroadcastChannel 时静默降级（退回 storage 事件路径） */ }

    // 2. 网络恢复时：立即补传本地未同步的修改 + 拉取云端最新
    window.addEventListener('online', () => {
        if (!window.App || !App.auth || !App.auth.session) return;
        if (App.data && typeof App.data.saveToCloudDebounced === 'function') {
            App.data.saveToCloudDebounced();
        }
        if (App.data && typeof App.data.loadFromCloud === 'function') {
            App.data.loadFromCloud();
        }
    });
    // 跨标签页数据变更通知已由 BroadcastChannel（qs_data_changed）接管：
    // 题库数据存在 IndexedDB，storage 事件对它永不触发——旧监听是死代码，已移除。

    // 绑定全局云端保存按钮（左键/右键都打开同步历史记录）与账户模态框事件
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
        // 左键同样打开同步记录面板（右键已有绑定），提高可发现性
        saveBtn.addEventListener("click", function () {
            if (window.App && App.sync && typeof App.sync.openLogPanel === "function") {
                App.sync.openLogPanel();
            }
        });
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
                // 已登录：展开账户菜单（个人信息 + 常用入口 + 退出登录）
                if (window.App && App.ui && typeof App.ui.toggleAccountMenu === "function") {
                    App.ui.toggleAccountMenu();
                }
            } else {
                openAuthModal();
            }
        });
    }

    // 账户菜单项点击委托（data-act 分发）
    const accountMenu = document.getElementById("account-menu");
    if (accountMenu) {
        accountMenu.addEventListener("click", function (e) {
            const item = e.target.closest("[data-act]");
            if (!item) return;
            if (window.App && App.ui && typeof App.ui.handleAccountMenuAction === "function") {
                App.ui.handleAccountMenuAction(item.dataset.act);
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
            // 防连点：重复提交不仅重复请求，还会白吃登录限流与注册限流的配额
            if (loginBtn.disabled) return;
            loginBtn.disabled = true;
            try {
                await doLogin();
            } finally {
                loginBtn.disabled = false;
            }
        });

        async function doLogin() {
            {
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
            }
        }
    }

    if (signupBtn) {
        signupBtn.addEventListener("click", async function () {
            const loginId = emailInput ? emailInput.value.trim() : '';
            const password = passwordInput ? passwordInput.value : '';
            if (!loginId || !password) {
                showStatus('请输入用户名和密码');
                return;
            }
            if (signupBtn.disabled) return;
            signupBtn.disabled = true;
            try {
                await doSignup();
            } finally {
                signupBtn.disabled = false;
            }
        });

        async function doSignup() {
            {
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
            showStatus(App.t('注册成功，已自动登录'));
            }
        }
    }
});

export { App };
