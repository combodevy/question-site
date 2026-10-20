export const router = {
    validViews: ['dashboard', 'setup', 'library', 'quiz', 'result', 'analytics', 'profile', 'english'],
    currentView: 'dashboard',

    go(id) {
        const targetId = (id === 'mistake_book' || id === 'starred') ? 'library' : id;

        if (!this.validViews.includes(targetId)) {
            console.error(`[Router Error] Invalid view attempt: "${id}". Falling back to dashboard.`);
            this.go('dashboard');
            return;
        }

        // 练习进行中想离开：确认并清理（否则 _suppressCloudSync 卡死、计时器悬挂）
        if (this.currentView === 'quiz' && targetId !== 'quiz' && targetId !== 'result'
            && window.App && App.quiz && typeof App.quiz.isActive === 'function' && App.quiz.isActive()) {
            const msg = App.t('练习还在进行中，确定要退出吗？\n已作答的题目会保留并同步，未作答的部分将丢弃。');
            if (window.App && App.ui && typeof App.ui.confirm === 'function') {
                App.ui.confirm(msg).then(ok => {
                    if (!ok) return;
                    App.quiz._cleanup();
                    this.go(id);
                });
                return;
            }
            const ok = window.confirm(msg);
            if (!ok) return;
            App.quiz._cleanup();
        }

        const targetEl = App.dom.get(`view-${targetId}`);
        if (!targetEl) return;

        document.querySelectorAll('.view-section').forEach(e => e.classList.add('hidden'));

        let libMode = 'all';
        if (id === 'mistake_book') libMode = 'mistakes';
        else if (id === 'starred') libMode = 'starred';

        targetEl.classList.remove('hidden');
        // 视图真的切换了（而不是同视图数据刷新）才播进场动画：
        // 轮询同步每 15 秒就可能 refresh 一次，次次重播会晃眼
        if (this.currentView !== targetId) {
            targetEl.classList.remove('anim-view-in');
            void targetEl.offsetWidth;
            targetEl.classList.add('anim-view-in');
        }
        // 切换视图时把滚动位置归零。
        // 各视图共用外层 <main> 这个滚动容器，不重置的话从长页面切过来
        // 会停在上次的滚动位置（表现为「一打开不是在最上面」）。
        const scroller = App.utils.getScrollParent(targetEl);
        if (scroller) scroller.scrollTop = 0;
        const mainEl = document.querySelector && document.querySelector('main');
        if (mainEl) mainEl.scrollTop = 0;
        this.currentView = targetId;

        if (id === 'dashboard') App.views.dashboard.render();
        if (id === 'setup') App.views.setup.render();
        if (id === 'library' || id === 'mistake_book' || id === 'starred') App.views.library.render(libMode);
        if (id === 'analytics') App.views.analytics.render();
        if (id === 'profile') App.views.profile.render();
        if (id === 'english') App.views.english.render();
        if (mainEl) mainEl.scrollTop = 0;
        // 视图重渲染后跑一遍翻译 walker（仅精确命中字典的 UI 文本，内容区已排除）
        if (App.i18n && typeof App.i18n.walk === 'function') {
            App.i18n.walk(targetEl);
            App.i18n.walkAttrs(targetEl);
        }
    },
    refresh() {
        const view = this.currentView || 'dashboard';
        if (view === 'quiz' || view === 'result') return;
        // 英语真题正在做题时不因后台同步刷新而踢回试卷列表
        if (view === 'english' && window.App && App.views && App.views.english && App.views.english._sess) return;
        const targetEl = App.dom.get(`view-${view}`);
        const scroller = targetEl ? App.utils.getScrollParent(targetEl) : null;
        const prevScroll = scroller ? scroller.scrollTop : 0;
        if (view === 'library' && window.App && App.views && App.views.library) {
            const curMode = App.views.library.currentMode || 'all';
            App.views.library.render(curMode, { resetScroll: false });
        } else {
            if (view === 'dashboard') App.views.dashboard.render();
            if (view === 'setup') App.views.setup.render();
            if (view === 'analytics') App.views.analytics.render();
            if (view === 'profile') App.views.profile.render();
            if (view === 'english') App.views.english.render();
            if (scroller) scroller.scrollTop = prevScroll;
        }
        if (targetEl && App.i18n && typeof App.i18n.walk === 'function') {
            App.i18n.walk(targetEl);
            App.i18n.walkAttrs(targetEl);
        }
    },
    init() {
        try {
            const raw = sessionStorage.getItem('qs_restore_nav');
            if (raw) {
                sessionStorage.removeItem('qs_restore_nav');
                const nav = JSON.parse(raw);
                if (nav && nav.view && this.validViews.includes(nav.view) && nav.view !== 'quiz' && nav.view !== 'result') {
                    if (nav.view === 'library' && nav.libMode === 'mistakes') {
                        this.go('mistake_book');
                        return;
                    }
                    if (nav.view === 'library' && nav.libMode === 'starred') {
                        this.go('starred');
                        return;
                    }
                    this.go(nav.view);
                    return;
                }
            }
        } catch (e) { }
        this.go('dashboard');
    }
};
