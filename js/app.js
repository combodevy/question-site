import { dom } from './dom.js';
import { utils } from './utils.js';
import { chart } from './chart.js';
import { auth } from './auth.js';
import { data, sync, realtime } from './data.js';
import { quiz } from './quiz.js';
import { router } from './router.js';
import { ui } from './ui.js';
import { dashboard } from './views/dashboard.js';
import { setup } from './views/setup.js';
import { library } from './views/library.js';
import { analytics } from './views/analytics.js';

const App = {
    apiBase: window.API_BASE || '',
    dom,
    utils,
    chart,
    auth,
    data,
    sync,
    realtime,
    quiz,
    router,
    ui,
    views: {
        dashboard,
        setup,
        library,
        analytics
    },
    async init() {
        await this.data.init();
        this.ui.initTheme();
        this.auth.init();
        this.router.init();
        this.ui._initGlobalBackTop();
    }
};

window.addEventListener('DOMContentLoaded', async () => {
    window.App = App;
    await App.init();

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

    // 跨标签页数据同步同步监听
    window.addEventListener('storage', async (e) => {
        if (!e.key) return;
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
            await App.data.init();
        }
        if (window.App && App.router && typeof App.router.go === 'function') {
            const view = App.router.currentView || 'dashboard';
            App.router.go(view);
        }
    });

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

export { App };
