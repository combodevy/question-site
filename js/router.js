export const router = {
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
};
