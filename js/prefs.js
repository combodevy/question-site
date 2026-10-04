// 偏好设置交互：语言 / 每日目标 / 默认练习题数
// 语言切换 = 持久化 + 整页刷新（保证所有已渲染文本一致）
export const prefs = {
    open() {
        // 弹窗是静态 HTML：打开时按当前语言补一遍 walker 翻译
        try {
            const el = document.getElementById('modal-config');
            if (el && window.App && App.i18n) { App.i18n.walk(el); App.i18n.walkAttrs(el); }
        } catch (e) { }
        const lang = (function () { try { return localStorage.getItem('qs_lang') === 'en' ? 'en' : 'zh'; } catch (e) { return 'zh'; } })();
        let goal = 0, limit = '20';
        try { goal = parseInt(localStorage.getItem('qs_daily_goal') || '0', 10) || 0; } catch (e) { }
        try { limit = localStorage.getItem('qs_default_limit') || '20'; } catch (e) { }
        document.querySelectorAll('#pref-lang-group .pref-lang').forEach(b => {
            const active = b.dataset.lang === lang;
            b.classList.toggle('bg-primary-600', active);
            b.classList.toggle('text-white', active);
            b.classList.toggle('border-primary-600', active);
            b.classList.toggle('border-[var(--border)]', !active);
            b.classList.toggle('text-[var(--text)]', !active);
        });
        const goalEl = document.getElementById('pref-goal');
        if (goalEl) goalEl.value = goal > 0 ? goal : '';
        const limitEl = document.getElementById('pref-limit');
        if (limitEl) limitEl.value = limit;
    },

    pickLang(lang) {
        try { localStorage.setItem('qs_lang', lang); } catch (e) { }
        // 语言立即生效需要翻译全部已渲染文本：整页刷新最干净
        location.reload();
    },

    savePrefs() {
        const goalEl = document.getElementById('pref-goal');
        const limitEl = document.getElementById('pref-limit');
        const goal = Math.max(0, Math.min(9999, parseInt(goalEl && goalEl.value || '0', 10) || 0));
        const limit = limitEl ? limitEl.value : '20';
        try {
            localStorage.setItem('qs_daily_goal', String(goal));
            localStorage.setItem('qs_default_limit', limit);
        } catch (e) { }
        const btn = document.getElementById('pref-save-btn');
        if (btn) {
            const t = window.App && App.t ? App.t : (s) => s;
            // 目标/题数即时生效，不需要刷新页面——短暂显示「已保存」后恢复按钮，
            // 旧实现承诺「即将刷新」却从不刷新，按钮永久卡在禁用态（bug）
            btn.textContent = t('已保存 ✓');
            btn.disabled = true;
            setTimeout(() => {
                btn.textContent = t('保存');
                btn.disabled = false;
            }, 1200);
        }
        // 立即生效：重渲染当前视图（每日目标卡马上反映新目标）
        setTimeout(() => { if (window.App && App.router) App.router.refresh(); }, 200);
    },

    getGoal() {
        try { return Math.max(0, parseInt(localStorage.getItem('qs_daily_goal') || '0', 10) || 0); } catch (e) { return 0; }
    },

    getDefaultLimit() {
        try {
            const v = localStorage.getItem('qs_default_limit');
            if (v === 'all') return 'all';
            const n = parseInt(v || '20', 10);
            return [10, 20, 50, 100].includes(n) ? String(n) : '20';
        } catch (e) { return '20'; }
    }
};
