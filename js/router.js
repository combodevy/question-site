export const router = {
    validViews: ['dashboard', 'setup', 'library', 'quiz', 'result', 'analytics', 'profile'],
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
        this.currentView = targetId;

        if (id === 'dashboard') App.views.dashboard.render();
        if (id === 'setup') App.views.setup.render();
        if (id === 'library' || id === 'mistake_book') App.views.library.render(libMode);
        if (id === 'analytics') App.views.analytics.render();
        if (id === 'profile') App.views.profile.render();
    },
    refresh() {
        const view = this.currentView || 'dashboard';
        if (view === 'quiz' || view === 'result') return;
        this.go(view);
    },
    init() { this.go('dashboard'); }
};
