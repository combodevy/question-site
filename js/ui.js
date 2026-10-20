export const ui = {
                    // JSON 导入预览状态（handleJsonPreviewUpload 写入 / applyJsonPreviewImport 读取）
                    _jsonImportPreview: null,
                    _jsonImportPreviewCount: 0,
                    _jsonImportIdStats: null,

                _importSessionId: 0,
                _importReader: null,
                // ===== 弹层开/关基元 =====
                // 关闭时 200ms 后才加 hidden（保留淡出动画），因此「打开」必须先取消
                // 未完成的关闭计时器，否则快速关闭再打开会被旧计时器重新隐藏——
                // 这正是回收站弹窗「点了没反应」的根因。
                _showModalEl(el) {
                    if (!el) return;
                    if (el._closeTimer) {
                        clearTimeout(el._closeTimer);
                        el._closeTimer = null;
                    }
                    el.classList.remove('hidden');
                    // 强制重排：确保 display 变更先生效，透明度过渡可靠触发
                    void el.offsetWidth;
                    el.classList.remove('opacity-0', 'pointer-events-none');
                },

                _hideModalEl(el) {
                    if (!el) return;
                    el.classList.add('opacity-0', 'pointer-events-none');
                    if (el._closeTimer) clearTimeout(el._closeTimer);
                    el._closeTimer = setTimeout(() => {
                        el.classList.add('hidden');
                        el._closeTimer = null;
                    }, 200);
                },

                // 弹窗的通用交互：点空白关闭 + Esc 关闭。
                // 用 document 上的一次性委托实现，避免给 9 个弹窗各写一遍。
                initModalInteractions() {
                    if (this._modalInteractionsBound) return;
                    this._modalInteractionsBound = true;
                    // 这两个弹窗里有用户未保存的内容（正在编辑的题目、已解析的导入预览），
                    // 不参与「点空白关闭」和「Esc 关闭」，只能通过明确的关闭/取消按钮退出。
                    const GUARDED = new Set(['modal-question-editor', 'modal-import-center']);
                    const topOpenModal = () => [...document.querySelectorAll('[id^="modal-"]')]
                        .filter(el => !el.classList.contains('hidden') && !GUARDED.has(el.id))
                        .pop();   // 所有弹窗同为 z-50，DOM 里靠后的画在上面

                    // 1) 点弹窗外的空白处关闭（只有直接点在遮罩本身才算，点在卡片内部不算）
                    document.addEventListener('click', (e) => {
                        const el = e.target;
                        if (!el || typeof el.id !== 'string' || !el.id.startsWith('modal-')) return;
                        if (GUARDED.has(el.id)) return;
                        if (el.classList.contains('hidden')) return;
                        this.closeModal(el.id.slice('modal-'.length));
                    });

                    // 2) Esc 关闭：优先关最上层的弹窗，没有弹窗时关抽屉 / 账户菜单
                    document.addEventListener('keydown', (e) => {
                        if (e.key !== 'Escape' && e.key !== 'Esc') return;
                        const top = topOpenModal();
                        if (top) {
                            this.closeModal(top.id.slice('modal-'.length));
                            return;
                        }
                        // 分析页题目详情浮层（非 modal- 前缀，需单独处理）
                        const popoverOv = document.getElementById('an-q-popover-overlay');
                        if (popoverOv && !popoverOv.classList.contains('hidden')) {
                            if (App.views && App.views.analytics && typeof App.views.analytics.hideQuestionPopover === 'function') {
                                App.views.analytics.hideQuestionPopover();
                            } else {
                                popoverOv.classList.add('hidden');
                            }
                            return;
                        }
                        const drawer = App.dom.get('insight-drawer');
                        if (drawer && !drawer.classList.contains('translate-x-full')) {
                            this.closeDrawer();
                            return;
                        }
                        const menu = App.dom.get('account-menu');
                        if (menu && !menu.classList.contains('hidden')) {
                            this.closeAccountMenu();
                        }
                    });

                    // 3) 导入中心支持直接拖拽 .json 文件进来（免去找文件对话框）
                    const importModal = document.getElementById('modal-import-center');
                    if (importModal && !this._dragBound) {
                        this._dragBound = true;
                        const highlight = (on) => {
                            const zone = document.getElementById('import-tab-json');
                            if (!zone) return;
                            zone.classList.toggle('ring-2', on);
                            zone.classList.toggle('ring-primary-400', on);
                        };
                        importModal.addEventListener('dragover', (e) => {
                            e.preventDefault();
                            highlight(true);
                        });
                        importModal.addEventListener('dragleave', (e) => {
                            if (!importModal.contains(e.relatedTarget)) highlight(false);
                        });
                        importModal.addEventListener('drop', (e) => {
                            e.preventDefault();
                            highlight(false);
                            const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
                            if (!file) return;
                            // AI 输出的题库常被存成 .txt，同样放行（解析时会剥掉 markdown 围栏）
                            if (!/\.(json|txt)$/i.test(file.name) && file.type !== 'application/json' && file.type !== 'text/plain') {
                                alert(App.t('请拖入 .json 或 .txt 题库文件。'));
                                return;
                            }
                            // handleJsonPreviewUpload 只读取 e.target.files[0] 并在结尾清空 e.target.value，
                            // 传一个最小的事件替身即可，无需真的构造 FileReader 目标输入框
                            App.ui.handleJsonPreviewUpload({ target: { files: [file], value: null } });
                        });
                    }
                },

                // ===== 练习选择持久化：记住用户上次选的题型 / 题数 =====
                rememberPracticeChoice(id, value) {
                    try { localStorage.setItem('qs_choice_' + id, value); } catch (e) { }
                },

                restorePracticeChoice(id) {
                    try { return localStorage.getItem('qs_choice_' + id); } catch (e) { return null; }
                },

                // 恢复 select 的值；存储值不在选项列表里时回退到默认，防止 select 进入无效态
                restoreSelectChoice(id, fallback) {
                    const el = App.dom.get(id);
                    if (!el) return;
                    const saved = this.restorePracticeChoice(id);
                    const valid = saved && Array.from(el.options).some(o => o.value === saved);
                    el.value = valid ? saved : fallback;
                },

                toggleModal(id) {
                    const el = App.dom.get(`modal-${id}`);
                    if (!el) return;

                    if (el.classList.contains('hidden')) {
                        // 打开设置弹窗时同步偏好控件的当前值
                        if (id === 'config' && window.App && App.prefs && typeof App.prefs.open === 'function') {
                            App.prefs.open();
                        }
                        if (id === 'smart-practice') {
                            const container = App.dom.get('smart-subjects-list');
                            if (container) {
                                container.innerHTML = '';
                                const subs = App.data.getSubjects();
                                if (subs.length === 0) {
                                    container.innerHTML = '<div class="text-xs text-[var(--sub)] italic">' + App.t('当前题库为空，请先在设置中导入题库文件。') + '</div>';
                                } else {
                                    let savedMem = null;
                                    try {
                                        const raw = JSON.parse(localStorage.getItem('qs_smart_state') || 'null');
                                        if (raw && Array.isArray(raw.checked) && Array.isArray(raw.seen) && raw.seen.length > 0) {
                                            savedMem = { checked: new Set(raw.checked), seen: new Set(raw.seen) };
                                        }
                                    } catch (e) { }
                                    const persistSmart = () => {
                                        try {
                                            const all = Array.from(container.querySelectorAll('.smart-chap-chk')).map(b => b.value);
                                            const checked = Array.from(container.querySelectorAll('.smart-chap-chk:checked')).map(b => b.value);
                                            localStorage.setItem('qs_smart_state', JSON.stringify({ checked, seen: all }));
                                        } catch (e) { }
                                    };
                                    subs.forEach(sub => {
                                        const chaps = App.data.getChapters(sub);
                                        const group = document.createElement('div');
                                        group.className = 'border border-[var(--border)] rounded-xl p-2.5 bg-[var(--bg)] space-y-1.5';
                                        const head = document.createElement('div');
                                        head.className = 'flex items-center justify-between gap-2 px-1';
                                        const subTitle = document.createElement('span');
                                        subTitle.className = 'text-xs font-bold text-primary-600 truncate';
                                        subTitle.textContent = sub;
                                        const toggleSubBtn = document.createElement('button');
                                        toggleSubBtn.type = 'button';
                                        toggleSubBtn.className = 'text-[11px] font-bold text-primary-600 hover:underline flex-shrink-0';
                                        toggleSubBtn.textContent = App.t('全选');
                                        head.appendChild(subTitle);
                                        head.appendChild(toggleSubBtn);
                                        group.appendChild(head);

                                        const chapWrap = document.createElement('div');
                                        chapWrap.className = 'space-y-1 max-h-44 overflow-y-auto custom-scroll pr-0.5';
                                        chaps.forEach(chap => {
                                            const key = `${sub}\u0001${chap}`;
                                            const count = (App.data.bank[sub] && Array.isArray(App.data.bank[sub][chap])) ? App.data.bank[sub][chap].length : 0;
                                            const isChecked = savedMem ? (savedMem.seen.has(key) ? savedMem.checked.has(key) : true) : true;
                                            const row = document.createElement('div');
                                            row.className = 'flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-primary-400 transition-colors';
                                            const lbl = document.createElement('label');
                                            lbl.className = 'flex items-center gap-2 flex-1 min-w-0 cursor-pointer select-none';
                                            const chk = document.createElement('input');
                                            chk.type = 'checkbox';
                                            chk.className = 'smart-chap-chk accent-primary-600 w-4 h-4 flex-shrink-0';
                                            chk.value = key;
                                            chk.checked = isChecked;
                                            chk.addEventListener('change', () => {
                                                const boxes = Array.from(chapWrap.querySelectorAll('.smart-chap-chk'));
                                                toggleSubBtn.textContent = App.t(boxes.every(b => b.checked) ? '取消全选' : '全选');
                                                persistSmart();
                                            });
                                            const nameSpan = document.createElement('span');
                                            nameSpan.className = 'text-xs text-[var(--text)] truncate';
                                            nameSpan.textContent = chap;
                                            nameSpan.title = chap;
                                            const cntSpan = document.createElement('span');
                                            cntSpan.className = 'text-[10px] font-mono text-[var(--sub)] flex-shrink-0';
                                            cntSpan.textContent = `${count} ${App.t('题')}`;
                                            lbl.appendChild(chk);
                                            lbl.appendChild(nameSpan);
                                            lbl.appendChild(cntSpan);

                                            const runBtn = document.createElement('button');
                                            runBtn.type = 'button';
                                            runBtn.className = 'px-2 py-0.5 rounded bg-primary-600 text-white text-[10px] font-bold hover:bg-primary-700 active:scale-95 transition-all flex-shrink-0 whitespace-nowrap';
                                            runBtn.textContent = App.t('直练本章');
                                            runBtn.addEventListener('click', () => {
                                                if (App.quiz.init('random', { chapters: [key] })) {
                                                    this.closeModal('smart-practice');
                                                }
                                            });

                                            row.appendChild(lbl);
                                            row.appendChild(runBtn);
                                            chapWrap.appendChild(row);
                                        });
                                        const initBoxes = Array.from(chapWrap.querySelectorAll('.smart-chap-chk'));
                                        if (initBoxes.length && initBoxes.every(b => b.checked)) {
                                            toggleSubBtn.textContent = App.t('取消全选');
                                        }
                                        toggleSubBtn.addEventListener('click', () => {
                                            const boxes = Array.from(chapWrap.querySelectorAll('.smart-chap-chk'));
                                            const anyUnchecked = boxes.some(b => !b.checked);
                                            boxes.forEach(b => { b.checked = anyUnchecked; });
                                            toggleSubBtn.textContent = App.t(anyUnchecked ? '取消全选' : '全选');
                                            persistSmart();
                                        });
                                        group.appendChild(chapWrap);
                                        container.appendChild(group);
                                    });
                                }
                            }
                            // 恢复上次选的题型 / 题数（默认整章全部 'all'）
                            this.restoreSelectChoice('smart-type', 'all');
                            this.restoreSelectChoice('smart-limit', 'all');
                        }
                        if (id === 'auth') {
                            this.switchAuthMode(this._authMode || 'login');
                        }
                        this._showModalEl(el);
                    } else {
                        this.closeModal(id);
                    }
                },

                _authMode: 'login',

                switchAuthMode(mode) {
                    const isSignup = mode === 'signup';
                    this._authMode = isSignup ? 'signup' : 'login';
                    const titleEl = App.dom.get('auth-modal-title');
                    const tabLogin = App.dom.get('auth-tab-login');
                    const tabSignup = App.dom.get('auth-tab-signup');
                    const userHint = App.dom.get('auth-username-hint');
                    const pwStrengthWrap = App.dom.get('auth-pw-strength-wrap');
                    const confirmWrap = App.dom.get('auth-confirm-wrap');
                    const confirmInput = App.dom.get('auth-password-confirm');
                    const loginBtn = App.dom.get('auth-login-btn');
                    const signupBtn = App.dom.get('auth-signup-btn');
                    const statusEl = App.dom.get('auth-status');

                    if (titleEl) titleEl.textContent = App.t(isSignup ? '注册新账号' : '账号登录');
                    if (tabLogin) {
                        tabLogin.className = isSignup
                            ? 'py-1.5 rounded-lg text-[var(--sub)] hover:text-[var(--text)] transition-all'
                            : 'py-1.5 rounded-lg bg-[var(--card)] text-primary-600 shadow-sm transition-all';
                    }
                    if (tabSignup) {
                        tabSignup.className = isSignup
                            ? 'py-1.5 rounded-lg bg-[var(--card)] text-primary-600 shadow-sm transition-all'
                            : 'py-1.5 rounded-lg text-[var(--sub)] hover:text-[var(--text)] transition-all';
                    }
                    if (userHint) userHint.classList.toggle('hidden', !isSignup);
                    if (pwStrengthWrap) pwStrengthWrap.classList.toggle('hidden', !isSignup);
                    if (confirmWrap) {
                        confirmWrap.classList.toggle('hidden', !isSignup);
                        confirmWrap.classList.toggle('flex', isSignup);
                    }
                    if (confirmInput) {
                        confirmInput.value = '';
                        confirmInput.classList.add('pw-masked');
                    }
                    if (loginBtn) loginBtn.classList.toggle('hidden', isSignup);
                    if (signupBtn) signupBtn.classList.toggle('hidden', !isSignup);
                    if (statusEl) statusEl.textContent = '';
                    if (isSignup) {
                        const pwInput = App.dom.get('auth-password');
                        this.updateAuthPasswordStrength(pwInput ? pwInput.value : '');
                    }
                },

                updateAuthPasswordStrength(pw) {
                    const bar = App.dom.get('auth-pw-strength-bar');
                    const txt = App.dom.get('auth-pw-strength-text');
                    if (!bar || !txt) return;
                    const s = String(pw || '');
                    if (!s.length) {
                        bar.style.width = '0%';
                        bar.className = 'h-full w-0 transition-all duration-200 rounded-full';
                        txt.className = 'text-[10px] text-[var(--sub)]';
                        txt.textContent = App.t('至少 6 位，建议字母+数字组合');
                        return;
                    }
                    if (s.length < 6) {
                        bar.style.width = '25%';
                        bar.className = 'h-full transition-all duration-200 rounded-full bg-red-500';
                        txt.className = 'text-[10px] text-red-500';
                        txt.textContent = App.t('密码长度不足 6 位');
                        return;
                    }
                    let classes = 0;
                    if (/[a-z]/.test(s)) classes++;
                    if (/[A-Z]/.test(s)) classes++;
                    if (/\d/.test(s)) classes++;
                    if (/[^a-zA-Z0-9]/.test(s)) classes++;
                    if (classes <= 1 || s.length < 8) {
                        bar.style.width = '55%';
                        bar.className = 'h-full transition-all duration-200 rounded-full bg-amber-500';
                        txt.className = 'text-[10px] text-amber-600 dark:text-amber-400';
                        txt.textContent = App.t('密码强度：中等（建议混合字母与数字）');
                    } else {
                        bar.style.width = '100%';
                        bar.className = 'h-full transition-all duration-200 rounded-full bg-emerald-500';
                        txt.className = 'text-[10px] text-emerald-600 dark:text-emerald-400';
                        txt.textContent = App.t('密码强度：高');
                    }
                },

                closeModal(id) {
                    if (id === 'app-dialog' && this._dialogResolver) {
                        this._resolveDialog(false);
                        return;
                    }
                    const el = App.dom.get(`modal-${id}`);
                    if (el && !el.classList.contains('hidden')) {
                        this._hideModalEl(el);
                    }
                },

                _dialogResolver: null,
                _dialogMode: 'confirm',

                _resolveDialog(ok) {
                    const modal = App.dom.get('modal-app-dialog');
                    const inputEl = App.dom.get('app-dialog-input');
                    const resolve = this._dialogResolver;
                    const mode = this._dialogMode;
                    this._dialogResolver = null;
                    if (modal) this._hideModalEl(modal);
                    if (typeof resolve === 'function') {
                        if (mode === 'prompt') {
                            resolve(ok ? (inputEl ? inputEl.value : '') : null);
                        } else {
                            resolve(Boolean(ok));
                        }
                    }
                },

                confirm(message, opts = {}) {
                    const modal = (window.App && App.dom && typeof App.dom.get === 'function')
                        ? App.dom.get('modal-app-dialog')
                        : (typeof document !== 'undefined' && document.getElementById ? document.getElementById('modal-app-dialog') : null);
                    if (!modal) {
                        const fn = (typeof window !== 'undefined' && typeof window.confirm === 'function') ? window.confirm : () => true;
                        return Promise.resolve(fn(message));
                    }
                    if (this._dialogResolver) this._resolveDialog(false);
                    this._dialogMode = 'confirm';
                    const titleEl = App.dom.get('app-dialog-title');
                    const msgEl = App.dom.get('app-dialog-message');
                    const inputWrap = App.dom.get('app-dialog-input-wrap');
                    const okBtn = App.dom.get('app-dialog-ok');
                    const cancelBtn = App.dom.get('app-dialog-cancel');
                    if (titleEl) titleEl.textContent = opts.title || App.t('操作确认');
                    if (msgEl) msgEl.textContent = String(message || '');
                    if (inputWrap) inputWrap.classList.add('hidden');
                    if (okBtn) okBtn.textContent = opts.okText || App.t('确定');
                    if (cancelBtn) cancelBtn.textContent = opts.cancelText || App.t('取消');
                    this._showModalEl(modal);
                    setTimeout(() => { if (okBtn && typeof okBtn.focus === 'function') okBtn.focus(); }, 30);
                    return new Promise((resolve) => {
                        this._dialogResolver = resolve;
                    });
                },

                prompt(message, defaultValue = '', opts = {}) {
                    const modal = (window.App && App.dom && typeof App.dom.get === 'function')
                        ? App.dom.get('modal-app-dialog')
                        : (typeof document !== 'undefined' && document.getElementById ? document.getElementById('modal-app-dialog') : null);
                    if (!modal) {
                        const fn = (typeof window !== 'undefined' && typeof window.prompt === 'function') ? window.prompt : () => defaultValue;
                        return Promise.resolve(fn(message, defaultValue));
                    }
                    if (this._dialogResolver) this._resolveDialog(false);
                    this._dialogMode = 'prompt';
                    const titleEl = App.dom.get('app-dialog-title');
                    const msgEl = App.dom.get('app-dialog-message');
                    const inputWrap = App.dom.get('app-dialog-input-wrap');
                    const inputEl = App.dom.get('app-dialog-input');
                    const okBtn = App.dom.get('app-dialog-ok');
                    const cancelBtn = App.dom.get('app-dialog-cancel');
                    if (titleEl) titleEl.textContent = opts.title || App.t('请输入');
                    if (msgEl) msgEl.textContent = String(message || '');
                    if (inputWrap) inputWrap.classList.remove('hidden');
                    if (inputEl) {
                        inputEl.type = opts.inputType || 'text';
                        inputEl.value = defaultValue != null ? String(defaultValue) : '';
                        if (!inputEl.dataset.enterBound) {
                            inputEl.dataset.enterBound = '1';
                            inputEl.addEventListener('keydown', (ev) => {
                                if (ev.key === 'Enter') {
                                    ev.preventDefault();
                                    this._resolveDialog(true);
                                }
                            });
                        }
                    }
                    if (okBtn) okBtn.textContent = opts.okText || App.t('确定');
                    if (cancelBtn) cancelBtn.textContent = opts.cancelText || App.t('取消');
                    this._showModalEl(modal);
                    setTimeout(() => {
                        if (inputEl && typeof inputEl.focus === 'function') {
                            inputEl.focus();
                            if (typeof inputEl.select === 'function') inputEl.select();
                        }
                    }, 30);
                    return new Promise((resolve) => {
                        this._dialogResolver = resolve;
                    });
                },

                // 密码显隐按钮（登录框 + 改密弹窗共用）：document 级委托，启动时注册
                _initPwToggles() {
                    if (document.body.dataset.pwToggleBound) return;
                    document.body.dataset.pwToggleBound = '1';
                    document.addEventListener('click', (e) => {
                        const t = e.target.closest('[data-pw-toggle]');
                        if (!t) return;
                        const input = document.getElementById(t.dataset.pwToggle);
                        if (!input) return;
                        let show;
                        if (input.classList.contains('pw-masked') || input.dataset.pwMasked === '1') {
                            input.dataset.pwMasked = '1';
                            show = input.classList.contains('pw-masked');
                            input.classList.toggle('pw-masked', !show);
                        } else {
                            show = input.type === 'password';
                            input.type = show ? 'text' : 'password';
                        }
                        // eye=隐藏态（点我显示），eye-off=显示态（点我隐藏）
                        const eye = t.querySelector('[data-eye]');
                        const eyeOff = t.querySelector('[data-eye-off]');
                        if (eye) eye.classList.toggle('hidden', show);
                        if (eyeOff) eyeOff.classList.toggle('hidden', !show);
                    });
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

                _lastRawImportText: '',
                _lastImportedQuestionIds: [],

                _setImportStep(step) {
                    const activeCls = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-primary-300 dark:border-primary-700 bg-primary-50/70 dark:bg-primary-950/40 text-primary-700 dark:text-primary-300 font-bold transition-all';
                    const doneCls = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/60 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 font-bold transition-all';
                    const idleCls = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--sub)] transition-all';
                    for (let i = 1; i <= 3; i++) {
                        const el = App.dom.get(`import-step-${i}`);
                        if (!el) continue;
                        const badge = el.querySelector('span');
                        if (i < step) {
                            el.className = doneCls;
                            if (badge) {
                                badge.className = 'w-4 h-4 rounded-full bg-emerald-600 text-white text-[10px] inline-flex items-center justify-center flex-shrink-0';
                                badge.innerHTML = '<svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>';
                            }
                        } else if (i === step) {
                            el.className = activeCls;
                            if (badge) {
                                badge.className = 'w-4 h-4 rounded-full bg-primary-600 text-white text-[10px] inline-flex items-center justify-center flex-shrink-0';
                                badge.textContent = String(i);
                            }
                        } else {
                            el.className = idleCls;
                            if (badge) {
                                badge.className = 'w-4 h-4 rounded-full bg-slate-200 dark:bg-slate-700 text-[var(--sub)] text-[10px] inline-flex items-center justify-center flex-shrink-0';
                                badge.textContent = String(i);
                            }
                        }
                    }
                },

                toggleImportPasteBox(force) {
                    const box = App.dom.get('import-paste-box');
                    if (!box) return;
                    const show = typeof force === 'boolean' ? force : box.classList.contains('hidden');
                    box.classList.toggle('hidden', !show);
                    if (show) {
                        const ta = App.dom.get('import-paste-input');
                        if (ta && typeof ta.focus === 'function') setTimeout(() => ta.focus(), 30);
                    }
                },

                async pasteClipboardToImport() {
                    const ta = App.dom.get('import-paste-input');
                    if (!ta) return;
                    try {
                        if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
                            const txt = await navigator.clipboard.readText();
                            if (txt) {
                                ta.value = txt;
                                this.handleJsonPastePreview();
                                return;
                            }
                        }
                    } catch (e) { /* 浏览器权限限制时引导 Ctrl+V */ }
                    ta.focus();
                    if (typeof showGlobalToast === 'function') {
                        showGlobalToast(App.t('请直接在输入框内按 Ctrl+V / ⌘+V 粘贴'), 'info');
                    }
                },

                clearImportPaste() {
                    const ta = App.dom.get('import-paste-input');
                    if (ta) {
                        ta.value = '';
                        ta.focus();
                    }
                },

                openFailedTextInPasteBox() {
                    this.toggleImportPasteBox(true);
                    const ta = App.dom.get('import-paste-input');
                    if (ta && this._lastRawImportText) {
                        ta.value = this._lastRawImportText;
                        ta.focus();
                    }
                },

                handleJsonPastePreview() {
                    const ta = App.dom.get('import-paste-input');
                    const text = ta ? ta.value.trim() : '';
                    if (!text) {
                        this._setImportBanner('error', App.t('请先在文本框中粘贴 JSON 内容后再点击「解析并预览」。'));
                        return;
                    }
                    this._processRawImportText(text, App.t('粘贴的 JSON 文本'));
                },

                _computeImportDiff(sanitizedData) {
                    const existingMap = new Map();
                    const bank = (window.App && App.data && App.data.bank) ? App.data.bank : {};
                    let existingBankTotal = 0;
                    for (const sub in bank) {
                        for (const chap in (bank[sub] || {})) {
                            const arr = bank[sub][chap] || [];
                            arr.forEach(q => {
                                if (q && typeof q.id === 'string') {
                                    existingBankTotal++;
                                    existingMap.set(q.id, { sub, chap, q });
                                }
                            });
                        }
                    }
                    let willAdd = 0;
                    let willUpdate = 0;
                    let willSkipSame = 0;
                    const importedIds = [];
                    for (const sub in (sanitizedData || {})) {
                        for (const chap in (sanitizedData[sub] || {})) {
                            const arr = sanitizedData[sub][chap] || [];
                            arr.forEach(q => {
                                if (!q || !q.id) return;
                                importedIds.push(q.id);
                                const ex = existingMap.get(q.id);
                                if (!ex) {
                                    willAdd++;
                                } else {
                                    const qOld = ex.q;
                                    const sameContent = qOld.type === q.type
                                        && qOld.q === q.q
                                        && JSON.stringify(qOld.o || []) === JSON.stringify(q.o || [])
                                        && qOld.a === q.a
                                        && ex.sub === sub
                                        && ex.chap === chap;
                                    if (sameContent) willSkipSame++;
                                    else willUpdate++;
                                }
                            });
                        }
                    }
                    return { willAdd, willUpdate, willSkipSame, existingBankTotal, importedIds };
                },

                openImportCenter() {
                    if (typeof this.closeModal === 'function') this.closeModal('config');
                    // 重置上一次的预览状态：否则重开弹窗时状态栏写着「尚未选择文件」，
                    // 下面却还挂着上一次的科目结构与题目预览，文案与内容自相矛盾
                    this._jsonImportPreview = null;
                    this._jsonImportPreviewCount = 0;
                    this._jsonImportIdStats = null;
                    this._lastRawImportText = '';
                    this._setImportStep(1);
                    const pasteBox = App.dom.get('import-paste-box');
                    if (pasteBox) pasteBox.classList.add('hidden');
                    const healthBox = App.dom.get('import-health-box');
                    if (healthBox) { healthBox.classList.add('hidden'); healthBox.innerHTML = ''; }
                    const sortChapsBtn = App.dom.get('import-sort-chapters-btn');
                    if (sortChapsBtn) sortChapsBtn.classList.add('hidden');
                    const applyBtn = App.dom.get('import-json-apply-btn');
                    if (applyBtn) applyBtn.disabled = true;
                    // 重置按钮文案与结果横幅：上次可能停在「已导入」或失败横幅
                    this._setApplyBtn('ready');
                    if (applyBtn) applyBtn.disabled = true;   // 重置后仍需等新预览
                    this._hideImportBanner();
                    this._importSummary = null;
                    ['import-json-total', 'import-json-subjects', 'import-json-chapters',
                        'import-json-mcq', 'import-json-multi', 'import-json-tf'].forEach(id => {
                            const el = App.dom.get(id);
                            if (el) el.textContent = '0';
                        });
                    const structEl = App.dom.get('import-json-struct');
                    if (structEl) structEl.innerHTML = '<div class="text-[11px] text-[var(--sub)] italic">' + App.t('请选择 JSON 文件后查看科目和章节分布。') + '</div>';
                    const listEl = App.dom.get('import-json-list');
                    if (listEl) listEl.innerHTML = '<div class="text-[11px] text-[var(--sub)] italic">' + App.t('暂无预览，请先选择 JSON 文件。') + '</div>';
                    const statusEl = App.dom.get('import-json-status');
                    if (statusEl) statusEl.textContent = App.t('尚未选择文件（支持拖拽 .json/.txt 到此窗口）');
                    this.toggleModal('import-center');
                },

                handleJsonPreviewUpload(e) {
                    const file = e.target.files[0];
                    if (!file) return;
                    const statusEl = App.dom.get('import-json-status');
                    const applyBtn = App.dom.get('import-json-apply-btn');
                    if (applyBtn) applyBtn.disabled = true;
                    if (statusEl) statusEl.textContent = App.t('正在读取文件：') + file.name;

                    if (file.size > 5 * 1024 * 1024) {
                        alert(App.t("文件过大，请上传 5MB 以内的题库文件。"));
                        e.target.value = null;
                        if (statusEl) statusEl.textContent = App.t("文件过大，已取消解析。");
                        this._setImportBanner('error', `<b>${App.t('文件过大')}</b>（${Math.round(file.size / 1024 / 1024 * 10) / 10}${App.t('MB）。请上传 5MB 以内的题库文件。')}）`);
                        this._setApplyBtn('ready');
                        { const ab = App.dom.get('import-json-apply-btn'); if (ab) ab.disabled = true; }
                        return;
                    }

                    const reader = new FileReader();
                    reader.onload = (event) => {
                        try {
                            const text = event.target.result;
                            this._processRawImportText(text, file.name);
                        } finally {
                            e.target.value = null;
                        }
                    };
                    reader.onerror = () => {
                        if (statusEl) statusEl.textContent = App.t("文件读取失败。");
                        this._setImportBanner('error', App.t('读取本地文件失败，请重新选择文件或改用「粘贴 JSON 文本」导入。'));
                        e.target.value = null;
                    };
                    reader.readAsText(file, 'UTF-8');
                },

                _processRawImportText(text, sourceLabel = '') {
                    this._lastRawImportText = String(text == null ? '' : text);
                    const isEn = window.App && App.i18n && App.i18n.lang === 'en';
                    const statusEl = App.dom.get('import-json-status');
                    const totalEl = App.dom.get('import-json-total');
                    const subEl = App.dom.get('import-json-subjects');
                    const chapEl = App.dom.get('import-json-chapters');
                    const mcqEl = App.dom.get('import-json-mcq');
                    const multiEl = App.dom.get('import-json-multi');
                    const tfEl = App.dom.get('import-json-tf');
                    const structEl = App.dom.get('import-json-struct');
                    const listEl = App.dom.get('import-json-list');
                    const healthBox = App.dom.get('import-health-box');
                    const applyBtn = App.dom.get('import-json-apply-btn');

                    if (applyBtn) applyBtn.disabled = true;
                    if (healthBox) { healthBox.classList.add('hidden'); healthBox.innerHTML = ''; }
                    [totalEl, subEl, chapEl, mcqEl, multiEl, tfEl].forEach(el => { if (el) el.textContent = '0'; });

                    const syntaxDiag = {};
                    const parsed = this._parseLooseJson(this._lastRawImportText, syntaxDiag);
                    if (parsed === null) {
                        this._setImportStep(1);
                        if (statusEl) statusEl.textContent = App.t("JSON 语法解析失败");
                        if (structEl) structEl.innerHTML = '<div class="text-[11px] text-[var(--sub)] italic">' + App.t('JSON 解析失败，无法预览。') + '</div>';
                        if (listEl) listEl.innerHTML = '<div class="text-[11px] text-[var(--sub)] italic">' + App.t('JSON 解析失败，无法预览。') + '</div>';
                        this._jsonImportPreview = null;
                        this._jsonImportPreviewCount = 0;

                        const locTxt = syntaxDiag.line
                            ? (isEn ? ` (near Line ${syntaxDiag.line}, Col ${syntaxDiag.col || 1})` : `（定位：第 ${syntaxDiag.line} 行、第 ${syntaxDiag.col || 1} 列附近）`)
                            : '';
                        const reasonHtml = syntaxDiag.hint
                            ? `<div class="mt-1 font-medium">${App.utils.escapeHTML(syntaxDiag.hint)}</div>`
                            : '';
                        const snippetHtml = syntaxDiag.snippetHtml || '';
                        const editBtnTxt = isEn ? 'Open in text box to fix' : '在下方文本框中打开并修改';

                        this._setImportBanner('error',
                            `<div class="space-y-1.5">`
                            + `<div><b>${isEn ? 'JSON Syntax Error' : 'JSON 语法格式有误'}</b>${locTxt}：<code>${App.utils.escapeHTML(syntaxDiag.rawError || 'Invalid JSON')}</code></div>`
                            + reasonHtml
                            + snippetHtml
                            + `<div class="pt-1 flex flex-wrap items-center gap-2">`
                            + `<button type="button" onclick="App.ui.openFailedTextInPasteBox()" class="px-3 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[11px] font-bold active:scale-95 transition-all">${editBtnTxt}</button>`
                            + `<span class="opacity-80">${isEn ? 'Or fix the file and re-upload.' : '你也可以点此按钮直接在页面内修正括号/引号后重新解析。'}</span>`
                            + `</div></div>`
                        );
                        this._setApplyBtn('ready');
                        if (applyBtn) applyBtn.disabled = true;
                        return;
                    }

                    const idStats = {};
                    const sanitized = (window.App && App.utils && typeof App.utils.sanitizeImportedBank === 'function')
                        ? App.utils.sanitizeImportedBank(parsed, idStats)
                        : parsed;

                    // 展示数据体检报告（如果有自动修复、自动补全 ID、或跳过的损坏题目）
                    const invalidItems = Array.isArray(idStats.invalidItems) ? idStats.invalidItems : [];
                    const fixedIds = idStats.fixedIds || 0;
                    const autoFixed = idStats.autoFixed || 0;
                    const syntaxFixed = Boolean(syntaxDiag.autoRepairedSyntax);

                    if (healthBox && (invalidItems.length > 0 || fixedIds > 0 || autoFixed > 0 || syntaxFixed)) {
                        const badges = [];
                        if (syntaxFixed) badges.push(isEn ? 'Auto-fixed trailing commas/fences' : '已自动修复 JSON 尾随逗号/代码块围栏');
                        if (autoFixed > 0) badges.push(isEn ? `Auto-normalized ${autoFixed} field(s)/answer(s)` : `已自动规范化 ${autoFixed} 处字段/答案写法`);
                        if (fixedIds > 0) badges.push(isEn ? `Auto-generated/deduped ${fixedIds} ID(s)` : `已自动生成或去重 ${fixedIds} 个题目 ID`);
                        if (invalidItems.length > 0) badges.push(isEn ? `Skipped ${invalidItems.length} invalid item(s)` : `已自动隔离跳过 ${invalidItems.length} 道格式异常题`);

                        let invalidListHtml = '';
                        if (invalidItems.length > 0) {
                            const rows = invalidItems.map(it =>
                                `<div class="py-1 border-b border-amber-200/60 dark:border-amber-800/50 last:border-b-0 flex flex-col gap-0.5">`
                                + `<div class="font-bold">[${App.utils.escapeHTML(it.loc)}] <span class="text-red-600 dark:text-red-400">${App.utils.escapeHTML(it.reason)}</span></div>`
                                + `<div class="opacity-80 truncate">${App.utils.escapeHTML(it.q)}</div>`
                                + `</div>`
                            ).join('');
                            invalidListHtml = `<details class="mt-1"><summary class="cursor-pointer font-bold underline select-none">${isEn ? `Click to view ${invalidItems.length} skipped item(s) & reasons` : `点击展开查看被跳过的 ${invalidItems.length} 道异常题目及具体原因`}</summary><div class="mt-1.5 max-h-40 overflow-y-auto custom-scroll bg-[var(--card)]/80 rounded-lg p-2 space-y-1">${rows}</div></details>`;
                        }

                        const toolSvg = '<svg class="w-3.5 h-3.5 inline-block mr-1 -mt-0.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';
                        healthBox.innerHTML = `<div class="font-bold flex flex-wrap items-center gap-1.5"><span>${toolSvg}${isEn ? 'Data Health Check:' : '格式自动体检与修复：'}</span><span>${badges.join(' / ')}</span></div>` + invalidListHtml;
                        healthBox.classList.remove('hidden');
                    }

                    const check = App.data.validateSchema(sanitized);
                    if (check !== true) {
                        this._setImportStep(1);
                        if (statusEl) statusEl.textContent = isEn ? ("Schema validation failed: " + check) : ("结构校验失败：" + check);
                        if (structEl) structEl.innerHTML = '<div class="text-[11px] text-[var(--sub)] italic">' + App.t('结构校验失败，请根据模板调整 JSON。') + '</div>';
                        if (listEl) listEl.innerHTML = '<div class="text-[11px] text-[var(--sub)] italic">' + App.t('结构校验失败，无法生成预览。') + '</div>';
                        this._jsonImportPreview = null;
                        this._jsonImportPreviewCount = 0;
                        this._setImportBanner('error', isEn
                            ? ('<b>Schema validation failed:</b> ' + App.utils.escapeHTML(String(check))
                                + '<br>Compare your JSON with the "Download template" file and retry.')
                            : ('<b>结构校验未通过：</b>' + App.utils.escapeHTML(String(check))
                                + '<br>请对照「下载格式模板」调整 JSON，或点击上方「粘贴 JSON 文本」直接修改。'));
                        this._setApplyBtn('ready');
                        if (applyBtn) applyBtn.disabled = true;
                        return;
                    }
                    App.ui._jsonImportIdStats = idStats;

                    const r = App.ui._renderJsonPreviewData(sanitized);
                    App.ui._jsonImportPreview = sanitized;

                    if (r.total) {
                        this._setImportStep(2);
                        const diff = this._computeImportDiff(sanitized);
                        if (statusEl) {
                            statusEl.textContent = isEn
                                ? `Ready: ${r.total} question(s) (${sourceLabel || 'JSON'})`
                                : `已就绪：${r.total} 道有效题目${sourceLabel ? `（${sourceLabel}）` : ''}`;
                        }
                        const topMsg = isEn
                            ? `<b>Preview ready:</b> <b>${r.total}</b> valid question(s) across <b>${r.subjCount}</b> subject(s) & <b>${r.chapCount}</b> chapter(s).`
                            : `<b>预览就绪：</b>共检测到 <b>${r.total}</b> 道有效题目（涵盖 <b>${r.subjCount}</b> 个科目、<b>${r.chapCount}</b> 个章节）。`;
                        const diffBadges = isEn
                            ? `<div class="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">`
                                + `<span class="px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold">+${diff.willAdd} new</span>`
                                + `<span class="px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-bold">~${diff.willUpdate} update</span>`
                                + `<span class="px-2 py-0.5 rounded-md bg-slate-200/80 dark:bg-slate-800 text-[var(--sub)] font-bold">=${diff.willSkipSame} unchanged</span>`
                                + (diff.willAdd === 0 && diff.willUpdate === 0 && diff.willSkipSame > 0
                                    ? `<span class="text-amber-600 dark:text-amber-400 font-bold">（All ${diff.willSkipSame} questions already exist in your bank）</span>`
                                    : '')
                                + `</div>`
                            : `<div class="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">`
                                + `<span class="px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold">预计新增 +${diff.willAdd} 道</span>`
                                + `<span class="px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-bold">同 ID 更新 ~${diff.willUpdate} 道</span>`
                                + `<span class="px-2 py-0.5 rounded-md bg-slate-200/80 dark:bg-slate-800 text-[var(--sub)] font-bold">已存在跳过 =${diff.willSkipSame} 道</span>`
                                + (diff.willAdd === 0 && diff.willUpdate === 0 && diff.willSkipSame > 0
                                    ? `<span class="text-amber-600 dark:text-amber-400 font-bold">（提示：这 ${diff.willSkipSame} 道题在当前题库中已全部存在，内容完全一致）</span>`
                                    : '')
                                + `</div>`;
                        const quickBtnText = isEn
                            ? `Import ${r.total} questions now`
                            : `立即导入这 ${r.total} 道题`;
                        this._setImportBanner('info',
                            `<div class="flex flex-wrap items-center justify-between gap-3">`
                            + `<div class="min-w-0 flex-1">${topMsg}${diffBadges}</div>`
                            + `<button type="button" onclick="App.ui.applyJsonPreviewImport()" class="px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-xs font-bold shadow-md active:scale-95 transition-all flex-shrink-0">${quickBtnText}</button>`
                            + `</div>`
                        );
                        this._setApplyBtn('ready');
                        const pasteBox = App.dom.get('import-paste-box');
                        if (pasteBox) pasteBox.classList.add('hidden');
                    } else {
                        this._setImportStep(1);
                        if (statusEl) statusEl.textContent = App.t("未检测到任何符合条件的题目。");
                        const reasonHint = invalidItems.length > 0
                            ? (isEn
                                ? `<br>All <b>${invalidItems.length}</b> item(s) had format issues — see the yellow diagnostic box below for exact reasons.`
                                : `<br>文件中的 <b>${invalidItems.length}</b> 道题均因格式问题被拦截，请查看下方黄色「格式自动体检」框了解每道题的具体原因。`)
                            : (isEn
                                ? '<br>Make sure your JSON follows `{ "Subject": { "Chapter": [ { "type": "mcq", "q": "...", "o": [...], "a": "A" } ] } }` or use "Download template".'
                                : '<br>请确认 JSON 含单选(mcq)/多选(multi)/判断(tf)/填空(fill)题目，可点击「下载格式模板」对照结构。');
                        this._setImportBanner('error',
                            (isEn ? '<b>Parsed JSON, but 0 valid questions were found.</b>' : '<b>JSON 语法正确，但未提取到任何有效题目。</b>')
                            + reasonHint
                        );
                        this._setApplyBtn('ready');
                        if (applyBtn) applyBtn.disabled = true;
                    }
                },

                // 预览渲染公共函数：统计数量、渲染科目结构和题目列表，并刷新计数卡片。
                // flat 始终携带题目 id，保证行内「应用」按钮可以修改归属（此前首次加载漏传 id 导致按钮必报错）。
                _renderJsonPreviewData(data) {
                    const flat = [];
                    const subjSet = new Set();
                    const chapSet = new Set();
                    let mcqCount = 0, multiCount = 0, tfCount = 0;

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
                                else tfCount++;   // tf 与 fill 合并为「判断+填空」列
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
                    const setText = (id, v) => { const el = App.dom.get(id); if (el) el.textContent = String(v); };
                    setText('import-json-total', total);
                    setText('import-json-subjects', subjSet.size);
                    setText('import-json-chapters', chapSet.size);
                    setText('import-json-mcq', mcqCount);
                    setText('import-json-multi', multiCount);
                    setText('import-json-tf', tfCount);

                    const sortChapsBtn = App.dom.get('import-sort-chapters-btn');
                    if (sortChapsBtn) sortChapsBtn.classList.toggle('hidden', chapSet.size < 2);

                    const structEl = App.dom.get('import-json-struct');
                    if (structEl) {
                        if (!structEl.dataset.orderBound) {
                            structEl.dataset.orderBound = '1';
                            structEl.addEventListener('click', (e) => {
                                const btn = e.target.closest('button[data-import-act]');
                                if (!btn || btn.disabled) return;
                                const act = btn.dataset.importAct;
                                const sub = btn.dataset.sub ? decodeURIComponent(btn.dataset.sub) : '';
                                const chap = btn.dataset.chap ? decodeURIComponent(btn.dataset.chap) : '';
                                const dir = parseInt(btn.dataset.dir || '0', 10);
                                if (act === 'move-chap' && sub && chap && dir) {
                                    this.moveImportPreviewChapter(sub, chap, dir);
                                } else if (act === 'move-sub' && sub && dir) {
                                    this.moveImportPreviewSubject(sub, dir);
                                } else if (act === 'sort-sub-chaps' && sub) {
                                    this.autoSortImportPreview(sub);
                                } else if (act === 'sort-all-chaps') {
                                    this.autoSortImportPreview();
                                }
                            });
                        }

                        if (!total) {
                            structEl.innerHTML = '<div class="text-[11px] text-[var(--sub)] italic">未检测到任何单选 / 多选 / 判断题。</div>';
                        } else {
                            const isEn = window.App && App.i18n && App.i18n.lang === 'en';
                            const subjArr = Array.from(subjSet);
                            let anyOutOfOrder = false;
                            const blocks = [];

                            subjArr.forEach((sub, sIdx) => {
                                const chapDict = data[sub] || {};
                                const chapKeys = Object.keys(chapDict).filter(c => Array.isArray(chapDict[c]) && chapDict[c].length > 0);
                                if (App.utils && typeof App.utils.isChapterListOutOfOrder === 'function' && App.utils.isChapterListOutOfOrder(chapKeys)) {
                                    anyOutOfOrder = true;
                                }
                                let subTotal = 0;
                                const rows = [];
                                const subEnc = encodeURIComponent(sub);

                                chapKeys.forEach((chap, cIdx) => {
                                    const arrQ = chapDict[chap] || [];
                                    const chapTotal = arrQ.length;
                                    subTotal += chapTotal;
                                    let cMcq = 0, cMulti = 0, cTf = 0;
                                    arrQ.forEach(qItem => {
                                        if (qItem.type === 'mcq') cMcq++;
                                        else if (qItem.type === 'multi') cMulti++;
                                        else cTf++;
                                    });
                                    const chapEnc = encodeURIComponent(chap);
                                    const upDisabled = cIdx === 0 ? 'disabled' : '';
                                    const downDisabled = cIdx === chapKeys.length - 1 ? 'disabled' : '';
                                    const upSvg = '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7"/></svg>';
                                    const downSvg = '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>';
                                    const moveBtns = chapKeys.length > 1
                                        ? `<span class="inline-flex items-center gap-0.5 flex-shrink-0">`
                                            + `<button type="button" data-import-act="move-chap" data-sub="${subEnc}" data-chap="${chapEnc}" data-dir="-1" ${upDisabled} title="${App.t('上移章节')}" class="w-5 h-5 rounded border border-[var(--border)] bg-[var(--card)] text-[var(--sub)] hover:text-primary-600 hover:border-primary-400 disabled:opacity-30 disabled:pointer-events-none inline-flex items-center justify-center leading-none">${upSvg}</button>`
                                            + `<button type="button" data-import-act="move-chap" data-sub="${subEnc}" data-chap="${chapEnc}" data-dir="1" ${downDisabled} title="${App.t('下移章节')}" class="w-5 h-5 rounded border border-[var(--border)] bg-[var(--card)] text-[var(--sub)] hover:text-primary-600 hover:border-primary-400 disabled:opacity-30 disabled:pointer-events-none inline-flex items-center justify-center leading-none">${downSvg}</button>`
                                            + `</span>`
                                        : '';
                                    rows.push(`
                                        <div class="flex items-center gap-1.5 text-[11px] py-0.5 px-1 rounded hover:bg-[var(--card)] transition-colors">
                                            ${moveBtns}
                                            <span class="truncate flex-1 min-w-0 text-[var(--text)]" title="${App.utils.escapeHTML(chap)}">${App.utils.escapeHTML(chap)}</span>
                                            <span class="text-[var(--sub)] flex-shrink-0 whitespace-nowrap">${chapTotal} 题 (单${cMcq}/多${cMulti}/判填${cTf})</span>
                                        </div>
                                    `);
                                });

                                const upSubSvg = '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7"/></svg>';
                                const downSubSvg = '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>';
                                const sortIconSvg = '<svg class="w-3 h-3 inline-block mr-0.5 -mt-0.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/></svg>';
                                const subMoveBtns = subjArr.length > 1
                                    ? `<span class="inline-flex items-center gap-0.5 mr-1">`
                                        + `<button type="button" data-import-act="move-sub" data-sub="${subEnc}" data-dir="-1" ${sIdx === 0 ? 'disabled' : ''} title="${App.t('上移科目')}" class="w-5 h-5 rounded border border-[var(--border)] bg-[var(--card)] text-[var(--sub)] hover:text-primary-600 disabled:opacity-30 disabled:pointer-events-none inline-flex items-center justify-center">${upSubSvg}</button>`
                                        + `<button type="button" data-import-act="move-sub" data-sub="${subEnc}" data-dir="1" ${sIdx === subjArr.length - 1 ? 'disabled' : ''} title="${App.t('下移科目')}" class="w-5 h-5 rounded border border-[var(--border)] bg-[var(--card)] text-[var(--sub)] hover:text-primary-600 disabled:opacity-30 disabled:pointer-events-none inline-flex items-center justify-center">${downSubSvg}</button>`
                                        + `</span>`
                                    : '';
                                const sortSubBtn = chapKeys.length > 1
                                    ? `<button type="button" data-import-act="sort-sub-chaps" data-sub="${subEnc}" class="text-[10px] text-primary-600 dark:text-primary-400 hover:underline font-bold whitespace-nowrap ml-2 inline-flex items-center" title="${App.t('按章节编号自动排序')}">${sortIconSvg}${App.t('章节排序')}</button>`
                                    : '';

                                blocks.push(`
                                    <div class="mb-2.5 last:mb-0 pb-2 last:pb-0 border-b border-[var(--border)]/60 last:border-b-0">
                                        <div class="flex items-center justify-between mb-1 gap-1">
                                            <div class="flex items-center min-w-0 flex-1">
                                                ${subMoveBtns}
                                                <span class="text-[11px] font-bold text-[var(--text)] truncate">${App.utils.escapeHTML(sub)}</span>
                                                ${sortSubBtn}
                                            </div>
                                            <div class="text-[11px] text-[var(--sub)] flex-shrink-0 whitespace-nowrap">${subTotal} 题</div>
                                        </div>
                                        <div class="space-y-0.5">${rows.join('')}</div>
                                    </div>
                                `);
                            });

                            const warnIconSvg = '<svg class="w-3.5 h-3.5 inline-block mr-1 -mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>';
                            const outOfOrderHint = anyOutOfOrder
                                ? `<div class="mb-2 px-2.5 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 flex items-center justify-between gap-2 text-[11px]">`
                                    + `<span class="truncate inline-flex items-center">${warnIconSvg}${isEn ? 'Chapters appear out of numerical order' : '检测到章节顺序可能乱序（如 Chapter 2 在 Chapter 1 前）'}</span>`
                                    + `<button type="button" data-import-act="sort-all-chaps" class="px-2 py-0.5 rounded bg-amber-500 hover:bg-amber-600 text-white font-bold flex-shrink-0 whitespace-nowrap active:scale-95 transition-all">${isEn ? 'Auto-sort' : '一键按章节号排好'}</button>`
                                    + `</div>`
                                : '';

                            structEl.innerHTML = (outOfOrderHint + blocks.join('')) || '<div class="text-[11px] text-[var(--sub)] italic">未检测到任何题目。</div>';
                        }
                    }

                    const listEl = App.dom.get('import-json-list');
                    if (listEl) {
                        if (!flat.length) {
                            listEl.innerHTML = '<div class="text-[11px] text-[var(--sub)] italic">暂无题目预览。</div>';
                        } else {
                            const previewItems = flat.slice(0, 50);
                            listEl.innerHTML = previewItems.map((item, idx) => {
                                const typeLabel = item.type === 'mcq' ? '单选' : (item.type === 'multi' ? '多选' : (item.type === 'fill' ? '填空' : '判断'));
                                const qText = App.utils.escapeHTML(String(item.q || '')).slice(0, 80);
                                const subEsc = App.utils.escapeHTML(item.sub);
                                const chapEsc = App.utils.escapeHTML(item.chap);
                                const idEsc = App.utils.escapeHTML(item.id || '');
                                return `
                                    <div class="border-b border-[var(--border)] pb-1 last:border-b-0" id="import-json-row-${idx}" data-sub="${subEsc}" data-chap="${chapEsc}" data-qid="${idEsc}">
                                        <div class="flex items-center justify-between gap-1">
                                            <span class="text-[11px] text-[var(--sub)]">#${idx + 1}</span>
                                            <span class="text-[11px] text-[var(--sub)] truncate flex-1 text-right">${subEsc} / ${chapEsc}</span>
                                        </div>
                                        <div class="flex items-center justify-between gap-1 mt-0.5">
                                            <span class="inline-flex items-center px-1.5 py-0.5 rounded-full border border-[var(--border)] text-[11px] text-[var(--sub)]">${typeLabel}</span>
                                            <span class="text-[11px] text-[var(--text)] flex-1 text-right">${qText}${String(item.q || '').length > 80 ? '…' : ''}</span>
                                        </div>
                                        <div class="mt-1 flex items-center gap-1 text-[11px] text-[var(--sub)]">
                                            <span>科目</span>
                                            <input class="import-json-sub-input flex-1 min-w-[80px] bg-[var(--card)] border border-[var(--border)] rounded px-1 py-0.5 outline-none" value="${subEsc}">
                                            <span>章节</span>
                                            <input class="import-json-chap-input flex-1 min-w-[80px] bg-[var(--card)] border border-[var(--border)] rounded px-1 py-0.5 outline-none" value="${chapEsc}">
                                            <button class="px-1.5 py-0.5 border border-[var(--border)] rounded text-[11px] text-primary-600 hover:bg-primary-50"
                                                onclick="App.ui.applyJsonMetaChange(${idx})">应用</button>
                                        </div>
                                    </div>
                                `;
                            }).join('');
                        }
                    }

                    const applyBtn = App.dom.get('import-json-apply-btn');
                    if (applyBtn) applyBtn.disabled = !flat.length;
                    App.ui._jsonImportPreviewCount = total;
                    return { total, subjCount: subjSet.size, chapCount: chapSet.size };
                },

                moveImportPreviewSubject(sub, delta) {
                    const data = this._jsonImportPreview;
                    if (!data || typeof data !== 'object') return;
                    const keys = Object.keys(data);
                    const idx = keys.indexOf(sub);
                    if (idx === -1) return;
                    const targetIdx = idx + delta;
                    if (targetIdx < 0 || targetIdx >= keys.length) return;
                    const tmp = keys[idx];
                    keys[idx] = keys[targetIdx];
                    keys[targetIdx] = tmp;
                    const rebuilt = {};
                    for (const k of keys) rebuilt[k] = data[k];
                    this._jsonImportPreview = rebuilt;
                    this._renderJsonPreviewData(rebuilt);
                },

                moveImportPreviewChapter(sub, chap, delta) {
                    const data = this._jsonImportPreview;
                    if (!data || !data[sub] || typeof data[sub] !== 'object') return;
                    const keys = Object.keys(data[sub]);
                    const idx = keys.indexOf(chap);
                    if (idx === -1) return;
                    const targetIdx = idx + delta;
                    if (targetIdx < 0 || targetIdx >= keys.length) return;
                    const tmp = keys[idx];
                    keys[idx] = keys[targetIdx];
                    keys[targetIdx] = tmp;
                    const rebuiltChaps = {};
                    for (const k of keys) rebuiltChaps[k] = data[sub][k];
                    data[sub] = rebuiltChaps;
                    this._renderJsonPreviewData(data);
                },

                autoSortImportPreview(targetSub) {
                    const data = this._jsonImportPreview;
                    if (!data || typeof data !== 'object') return;
                    const cmp = (window.App && App.utils && typeof App.utils.naturalCompare === 'function')
                        ? (a, b) => App.utils.naturalCompare(a, b)
                        : (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
                    const subs = targetSub ? [targetSub] : Object.keys(data);
                    let anyChanged = false;
                    for (const s of subs) {
                        if (!data[s] || typeof data[s] !== 'object') continue;
                        const chaps = Object.keys(data[s]);
                        if (chaps.length < 2) continue;
                        const sorted = [...chaps].sort(cmp);
                        if (chaps.some((c, i) => c !== sorted[i])) {
                            anyChanged = true;
                            const rebuilt = {};
                            for (const c of sorted) rebuilt[c] = data[s][c];
                            data[s] = rebuilt;
                        }
                    }
                    this._renderJsonPreviewData(data);
                    if (typeof showGlobalToast === 'function') {
                        showGlobalToast(
                            anyChanged
                                ? App.t('已按章节序号自动排好顺序。')
                                : App.t('当前章节已经是自然顺序，无需调整。'),
                            anyChanged ? 'success' : 'info'
                        );
                    }
                },

                // ===== 导入结果横幅 =====
                // 旧版把全部提示塞进右上角一个 truncate 的 11px 小气泡里——
                // 长文案被 CSS 截断，用户根本看不到（「导入了没？成功了还是失败了？」的根因）。
                _IMPORT_BANNER_STYLE: {
                    busy:    'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
                    success: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
                    error:   'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300',
                    info:    'border-[var(--border)] bg-[var(--bg)] text-[var(--sub)]'
                },
                _IMPORT_BANNER_ICON: {
                    busy: '<svg class="animate-spin w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path></svg>',
                    success: '<svg class="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
                    error: '<svg class="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M12 3l9.5 16.5H2.5L12 3z"></path></svg>',
                    info: '<svg class="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>'
                },
                _setImportBanner(kind, html) {
                    const el = App.dom.get('import-json-result');
                    if (!el) return;
                    el.className = 'flex items-start gap-2.5 px-3.5 py-3 rounded-xl border text-[11px] leading-relaxed '
                        + (this._IMPORT_BANNER_STYLE[kind] || this._IMPORT_BANNER_STYLE.info);
                    el.innerHTML = (this._IMPORT_BANNER_ICON[kind] || this._IMPORT_BANNER_ICON.info)
                        + '<span class="flex-1 min-w-0">' + html + '</span>';
                },
                _hideImportBanner() {
                    const el = App.dom.get('import-json-result');
                    if (el) { el.className = 'hidden'; el.innerHTML = ''; }
                },
                // 导入按钮状态机：busy（转圈+禁用）/ done（已导入+禁用）/ ready（可点）
                _setApplyBtn(state) {
                    const btn = App.dom.get('import-json-apply-btn');
                    if (!btn) return;
                    if (state === 'busy') {
                        if (!btn.dataset.originalHtml) btn.dataset.originalHtml = btn.innerHTML;
                        btn.disabled = true;
                        btn.innerHTML = '<svg class="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path></svg><span>导入中…</span>';
                        btn.classList.add('opacity-80', 'cursor-wait');
                    } else if (state === 'done') {
                        btn.disabled = true;
                        btn.innerHTML = '<span class="inline-flex items-center gap-1"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg><span>已导入</span></span>';
                        btn.classList.remove('opacity-80', 'cursor-wait');
                    } else {
                        btn.disabled = false;
                        if (btn.dataset.originalHtml) { btn.innerHTML = btn.dataset.originalHtml; delete btn.dataset.originalHtml; }
                        btn.classList.remove('opacity-80', 'cursor-wait');
                    }
                },

                _importingBusy: false,

                async applyJsonPreviewImport() {
                    if (this._importingBusy) return;
                    const data = App.ui._jsonImportPreview;
                    const count = App.ui._jsonImportPreviewCount || 0;
                    const statusEl = App.dom.get('import-json-status');
                    if (!data || !count) {
                        alert(App.t("请先选择 JSON 文件并完成预览解析。"));
                        return;
                    }
                    // 题库导入中心本身就是「先预览、再确认导入」的专用弹窗，
                    // 点击「导入预览中的题目」即代表用户已确认导入。
                    // 不再调用原生 window.confirm()，防止在 Vivaldi / 禁用原生弹窗的浏览器中
                    // confirm() 被静默拦截返回 false 导致用户没点取消却提示「已取消导入操作。」。
                    this._importingBusy = true;
                    // 整个导入流程包在 try/catch 里：任何意外异常都必须落到
                    // 「红色横幅 + 按钮恢复」的出口，绝不能让按钮灰死且无提示。
                    try {
                        // 导入是同步计算，大题库会阻塞界面；先让状态文字和 spinner 渲染出来再执行
                        if (statusEl) statusEl.textContent = App.t("正在导入题库…");
                        this._setImportBanner('busy', `${App.t('正在导入约 ')}<b>${count}</b>${App.t(' 道题到本地题库…')}<br><span class="opacity-75">${App.t('题库很大时这一步可能需要几秒，请不要关闭窗口。')}</span>`);
                        this._setApplyBtn('busy');
                        await new Promise(r => setTimeout(r, 30));
                        const report = App.data.importBank(JSON.stringify(data));
                        if (!report) {
                            // importBank 内部已 alert 具体原因；横幅给出失败状态
                            this._setImportBanner('error', App.i18n.lang === 'en'
                                ? '<b>Import failed.</b> See the dialog for the reason. Fix the JSON and click "Retry import" — your local bank is untouched.'
                                : '<b>导入失败。</b>具体原因见弹窗提示，修正 JSON 后可直接点击「重试导入」。本地题库未受影响。');
                            this._setApplyBtn('ready');
                            if (statusEl) statusEl.textContent = App.i18n.lang === 'en' ? "Import failed" : "导入失败";
                            return;
                        }
                        const importedIds = [];
                        for (const sub in (data || {})) {
                            for (const chap in (data[sub] || {})) {
                                (data[sub][chap] || []).forEach(q => { if (q && q.id) importedIds.push(q.id); });
                            }
                        }
                        this._lastImportedQuestionIds = importedIds;
                        this._setImportStep(3);
                        const totalBankNow = App.data.getQuestions().length;
                        const isEn = App.i18n && App.i18n.lang === 'en';
                        const allSkippedNote = (report.added === 0 && report.updated === 0 && report.skippedSame > 0)
                            ? (isEn
                                ? `<div class="mt-1 text-amber-700 dark:text-amber-300 font-bold">Note: All ${report.skippedSame} questions already existed in your bank with identical content, so no duplicates were added.</div>`
                                : `<div class="mt-1 text-amber-700 dark:text-amber-300 font-bold">说明：这 ${report.skippedSame} 道题在你的题库中已经全部存在且内容完全一致，因此未重复添加。</div>`)
                            : '';
                        const simBtnHtml = (report.similarPairs && report.similarPairs.length > 0)
                            ? `<button type="button" onclick="App.ui.openSimilarReview()" class="px-3 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 text-[11px] font-bold hover:bg-amber-100 active:scale-95 transition-all">${isEn ? `Review ${report.similarPairs.length} similar pair(s)` : `审查 ${report.similarPairs.length} 组相似题`}</button>`
                            : '';
                        const actionBtnsHtml = `<div class="mt-2 pt-2 border-t border-current/15 flex flex-wrap items-center gap-2">`
                            + `<button type="button" onclick="App.ui.practiceLastImported()" class="px-3.5 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-[11px] font-bold shadow-sm active:scale-95 transition-all">${isEn ? `Practice these ${importedIds.length} questions →` : `立即刷这批题 (${importedIds.length} 道) →`}</button>`
                            + `<button type="button" onclick="App.ui.viewImportedInLibrary()" class="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--text)] text-[11px] font-bold hover:border-primary-400 active:scale-95 transition-all">${isEn ? 'View in Library →' : '去题库查看 →'}</button>`
                            + simBtnHtml
                            + `</div>`;

                        this._importSummary = (isEn
                            ? `<b>Import successful!</b> Added <b>+${report.added}</b>, updated <b>~${report.updated}</b>, unchanged skipped <b>=${report.skippedSame}</b> (Total bank: <b>${totalBankNow}</b> questions).`
                            : `<b>导入成功！</b>新增 <b>+${report.added}</b> 道、更新 <b>~${report.updated}</b> 道、重复跳过 <b>=${report.skippedSame}</b> 道（当前题库共 <b>${totalBankNow}</b> 道题）。`)
                            + (report.fixedIds ? (isEn ? `<br>Auto-fixed <b>${report.fixedIds}</b> duplicate/missing question ID(s).` : `<br>已自动补全/去重 <b>${report.fixedIds}</b> 个题目 ID。`) : '')
                            + allSkippedNote;
                        this._importActionBtnsHtml = actionBtnsHtml;

                        this._setImportBanner('success', this._importSummary
                            + (isEn
                                ? '<br><span class="opacity-80">Syncing to cloud…</span>'
                                : '<br><span class="opacity-80">正在同步到云端…</span>')
                            + actionBtnsHtml);
                        this._setApplyBtn('done');
                        if (statusEl) {
                            statusEl.textContent = isEn
                                ? `Imported: +${report.added} new, ~${report.updated} updated, =${report.skippedSame} skipped`
                                : `导入完成：新增 ${report.added} 道、更新 ${report.updated} 道、跳过 ${report.skippedSame} 道`;
                        }
                        if (typeof showGlobalToast === 'function') {
                            showGlobalToast(
                                isEn
                                    ? `Import complete: +${report.added} new, ~${report.updated} updated, =${report.skippedSame} unchanged (Total: ${totalBankNow})`
                                    : `导入完成：新增 ${report.added} 道、更新 ${report.updated} 道、相同跳过 ${report.skippedSame} 道（总题库 ${totalBankNow} 题）`,
                                'success'
                            );
                        }
                        // 导入必然触发云端保存（防抖 400ms）；监视保存结果并反馈
                        this._watchImportSave();
                        // 立即刷新底层视图：弹窗后面如果是首页/题库页，统计数字和列表马上反映新题
                        if (window.App && App.router && typeof App.router.refresh === 'function') {
                            App.router.refresh();
                        }
                    } catch (e) {
                        console.error('导入流程异常', e);
                        this._setImportBanner('error', App.i18n.lang === 'en'
                            ? ('<b>Import error:</b>' + App.utils.escapeHTML(String(e && e.message || e))
                                + '<br>The local bank has been rolled back. Check the JSON and retry, or "Export full bank" first as a backup.')
                            : ('<b>导入过程出现异常：</b>' + App.utils.escapeHTML(String(e && e.message || e))
                                + '<br>本地题库已回滚到导入前状态。请检查 JSON 后重试，或先「导出全部题库」备份。'));
                        this._setApplyBtn('ready');
                        if (statusEl) statusEl.textContent = App.i18n.lang === 'en' ? "Import error" : "导入异常";
                    } finally {
                        this._importingBusy = false;
                    }
                },

                practiceLastImported() {
                    const ids = new Set(this._lastImportedQuestionIds || []);
                    const all = App.data.getQuestions();
                    const list = ids.size ? all.filter(q => ids.has(q.id)) : all;
                    if (!list.length) {
                        alert(App.t('未找到刚刚导入的题目。'));
                        return;
                    }
                    this.closeModal('import-center');
                    App.quiz.init('filtered', { questions: list });
                },

                viewImportedInLibrary() {
                    this.closeModal('import-center');
                    App.router.go('library');
                },

                // 导入后监视云端保存：横幅实时反映「同步中 → 已同步 / 同步失败」，
                // 数据本身始终已安全落在本机（IndexedDB），失败只影响云端副本
                _watchImportSave() {
                    if (this._importSaveWatch) clearTimeout(this._importSaveWatch);
                    let elapsed = 0;
                    const btns = this._importActionBtnsHtml || '';
                    const tick = () => {
                        const sync = window.App && App.sync ? App.sync : null;
                        const status = sync ? sync._lastStatus : 'success';
                        elapsed += 500;
                        if (status === 'error') {
                            const _doneTxt = this._importSummary || (App.i18n.lang === 'en' ? 'Import finished.' : '导入完成。');
                            this._setImportBanner('error', _doneTxt
                                + (App.i18n.lang === 'en'
                                    ? '<br><b>Cloud sync failed</b> — data is safe on this device. Click the sync status icon (top right) for details and retry.'
                                    : '<br><b>云端同步失败</b>——数据已安全保存在本机，不会丢失。点击右上角同步状态按钮可查看详情并重试。')
                                + btns);
                            this._importSaveWatch = null;
                            return;
                        }
                        if (status === 'pending' && elapsed < 20000) {
                            if (elapsed % 2000 === 0) {
                                this._setImportBanner('success', (this._importSummary || '导入完成。')
                                    + (App.i18n.lang === 'en'
                                        ? `<br><span class="opacity-75">Syncing to cloud… ${Math.round(elapsed / 1000)}s</span>`
                                        : `<br><span class="opacity-75">正在同步到云端… ${Math.round(elapsed / 1000)}s</span>`)
                                    + btns);
                            }
                            this._importSaveWatch = setTimeout(tick, 500);
                            return;
                        }
                        const _d2 = this._importSummary || (App.i18n.lang === 'en' ? 'Import finished.' : '导入完成。');
                        if (status === 'success' && !App.data._bankDirty) {
                            this._setImportBanner('success', _d2
                                + (App.i18n.lang === 'en'
                                    ? '<br><b>Synced to cloud</b> Local and cloud banks are identical.'
                                    : '<br><b>已同步到云端</b> 本地与云端的题库现在完全一致。')
                                + btns);
                        } else {
                            this._setImportBanner('success', _d2
                                + (App.i18n.lang === 'en'
                                    ? '<br>Data saved on this device; it will sync to the cloud next time you are online.'
                                    : '<br>数据已保存在本机；云端将在下次联网时自动同步。')
                                + btns);
                        }
                        this._importSaveWatch = null;
                    };
                    this._importSaveWatch = setTimeout(tick, 1500);
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

                    const r = App.ui._renderJsonPreviewData(data);

                    if (statusEl) {
                        statusEl.textContent = r.total
                            ? `预览已更新：当前将导入 ${r.total} 道题（科目 ${r.subjCount} 个，章节 ${r.chapCount} 个）。`
                            : "当前预览中不再包含任何题目。";
                    }
                },

                initTheme() {
                    if (localStorage.getItem('dark') === '1') document.documentElement.classList.add('dark');
                },

                // ===== 账户菜单（右上角头像弹层） =====
                toggleAccountMenu() {
                    const menu = App.dom.get('account-menu');
                    const backdrop = App.dom.get('account-menu-backdrop');
                    if (!menu || !backdrop) return;
                    // 关闭后 200ms 内重开：先清掉未完成的关闭计时器，否则 toggle 会误判为「关闭」
                    if (menu._closeTimer) { clearTimeout(menu._closeTimer); menu._closeTimer = null; }
                    if (backdrop._closeTimer) { clearTimeout(backdrop._closeTimer); backdrop._closeTimer = null; }
                    if (menu.classList.contains('hidden')) {
                        this._renderAccountMenu();
                        menu.classList.remove('hidden');
                        backdrop.classList.remove('hidden');
                        setTimeout(() => {
                            menu.classList.remove('opacity-0', 'pointer-events-none');
                            backdrop.classList.remove('opacity-0');
                        }, 10);
                    } else {
                        this.closeAccountMenu();
                    }
                },

                closeAccountMenu() {
                    const menu = App.dom.get('account-menu');
                    const backdrop = App.dom.get('account-menu-backdrop');
                    if (backdrop) {
                        // 无条件清理遮罩：即使菜单状态异常，也绝不能让遮罩残留挡住页面点击
                        backdrop.classList.add('opacity-0');
                        backdrop._closeTimer = setTimeout(() => {
                            backdrop.classList.add('hidden');
                            backdrop._closeTimer = null;
                        }, 200);
                    }
                    if (!menu || menu.classList.contains('hidden')) return;
                    menu.classList.add('opacity-0', 'pointer-events-none');
                    menu._closeTimer = setTimeout(() => {
                        menu.classList.add('hidden');
                        menu._closeTimer = null;
                    }, 200);
                },

                _renderAccountMenu() {
                    const session = window.App && App.auth && App.auth.session;
                    if (!session) return;
                    const username = (session.user && session.user.username) || '用户';
                    App.dom.setText('am-username', username);
                    App.dom.setText('am-avatar', (username[0] || '?').toUpperCase());
                    // uid 在下方 getUserId 处取值；此处先占位，避免引用未定义变量
                    const uidEarly = App.auth.getUserId ? App.auth.getUserId() : '';
                    App.dom.setText('am-uid', uidEarly ? 'ID: ' + uidEarly.slice(0, 8) : '');
                    // 管理员徽章：token role 仅作前端展示初值，权威判定在服务端
                    const payload = (window.App && App.auth && App.auth.token) ? App.auth.parseJwt(App.auth.token) : null;
                    const badge = document.getElementById('am-admin-badge');
                    if (badge) {
                        const isAdmin = payload && payload.role === 'admin';
                        badge.classList.toggle('hidden', !isAdmin);
                    }
                    // 注册时间等完整资料从 /api/auth/me 拉取（缓存 5 分钟，避免每次开菜单都打接口）
                    const profileEl = document.getElementById('am-profile');
                    if (profileEl) profileEl.classList.remove('hidden');
                    const now = Date.now();
                    // 缓存按用户绑定：换号登录后旧缓存立即失效，不得显示上一个账号的资料
                    const meUid = App.auth && App.auth.getUserId ? App.auth.getUserId() : '';
                    const meCacheValid = this._meCache && meUid && this._meCacheUid === meUid
                        && now - this._meCacheAt < 5 * 60 * 1000;
                    if (!meCacheValid) {
                        this._loadProfileForMenu();
                    } else {
                        this._applyProfileToMenu(this._meCache);
                    }
                    // 学习数据速览
                    const s = App.data.getStats();
                    const statsEl = App.dom.get('am-stats');
                    if (statsEl) {
                        const cell = (label, value, color) => `
                            <div class="rounded-lg bg-[var(--bg)] py-1.5 text-center">
                                <div class="text-sm font-bold ${color}">${value}</div>
                                <div class="text-[11px] text-[var(--sub)] mt-0.5">${label}</div>
                            </div>`;
                        statsEl.innerHTML =
                            cell(App.t('题库总量'), s.total, 'text-[var(--text)]') +
                            cell(App.t('收藏'), (window.App.data.starredIds || []).length, 'text-amber-500') +
                            cell(App.t('连续天数'), s.streak + (App.i18n.lang === 'en' ? 'd' : '天'), 'text-orange-500');
                    }
                    // 回收站入口右侧的数量徽标：有内容时才显示，让用户知道里面有没有东西
                    const trashCountEl = App.dom.get('am-trash-count');
                    if (trashCountEl) {
                        const n = App.data.getTrashCount();
                        if (n > 0) {
                            trashCountEl.textContent = n + ' 题';
                            trashCountEl.classList.remove('hidden');
                        } else {
                            trashCountEl.textContent = '';
                            trashCountEl.classList.add('hidden');
                        }
                    }
                },

                _loadProfileForMenu() {
                    const token = window.App && App.auth ? App.auth.token : null;
                    if (!token || !window.App.apiBase) return;
                    fetch(window.App.apiBase + '/api/auth/me', { headers: { Authorization: 'Bearer ' + token } })
                        .then(r => (r.ok ? r.json() : null))
                        .then(body => {
                            if (!body || !body.ok || !body.user) return;
                            this._meCache = body.user;
                            this._meCacheUid = App.auth && App.auth.getUserId ? App.auth.getUserId() : '';
                            this._meCacheAt = Date.now();
                            this._applyProfileToMenu(body.user);
                        })
                        .catch(() => { /* 静默：菜单信息缺失不影响功能 */ });
                },

                _applyProfileToMenu(user) {
                    const createdEl = document.getElementById('am-created');
                    if (createdEl) {
                        // created_at 是 D1 的 UTC 时间串，转本地展示
                        const m = user.createdAt ? String(user.createdAt).match(/(\d{4})-(\d{2})-(\d{2})/) : null;
                        createdEl.textContent = m ? (App.i18n.lang === 'en' ? `Joined ${m[1]}-${m[2]}-${m[3]}` : `注册于 ${m[1]} 年 ${m[2]} 月 ${m[3]} 日`) : '…';
                    }
                    const badge = document.getElementById('am-admin-badge');
                    if (badge) badge.classList.toggle('hidden', !user.isAdmin);
                },

                async handleAccountMenuAction(act) {
                    this.closeAccountMenu();
                    if (act === 'profile') {
                        App.router.go('profile');
                    } else if (act === 'analytics') {
                        App.router.go('analytics');
                    } else if (act === 'import') {
                        App.ui.openImportCenter();
                    } else if (act === 'export') {
                        App.ui.exportAllBank();
                    } else if (act === 'export-print') {
                        App.ui.openPrintExport();
                    } else if (act === 'sync') {
                        App.sync.openLogPanel();
                    } else if (act === 'trash') {
                        // 账户菜单里的第二个回收站入口（右上角小图标之外的一条更易发现的路径）
                        App.ui.openTrashModal();
                    } else if (act === 'password') {
                        this.openPasswordModal();
                    } else if (act === 'delete-account') {
                        this._startAccountDeletion();
                    } else if (act === 'logout') {
                        if (await this.confirm(App.t('确定要退出登录吗？\n本地缓存会清空，题库和学习记录都保留在云端，下次登录自动恢复。'))) {
                            this._meCache = null;
                            App.auth.logout();
                        }
                    }
                },

                // ===== 注销账号：三重防呆（警告 → 输入用户名 → 输入密码）=====
                async _startAccountDeletion() {
                    const session = window.App && App.auth && App.auth.session;
                    if (!session) return;
                    const username = (session.user && session.user.username) || '';
                    const stats = App.data.getStats();
                    if (!(await this.confirm(
                        App.t('注意：注销账号将永久删除：') + '\n\n- ' + App.t('全部题库（') + stats.total + App.t('题）') + '\n- ' + App.t('全部刷题记录与学习数据') + '\n- ' + App.t('收藏、错题本与云端备份') + '\n\n' + App.t('此操作不可恢复！') + '\n\n' + App.t('确定要继续吗？')
                    ))) return;
                    const typed = await this.prompt(App.t('防呆确认：请输入你的用户名「') + username + App.t('」以继续'), '');
                    if (typed === null) return;
                    if (typed.trim() !== username) {
                        alert(App.t('用户名不匹配，注销已取消。'));
                        return;
                    }
                    const pw = await this.prompt(App.t('最后一步：输入账号密码以确认注销'), '', { inputType: 'password' });
                    if (pw === null) return;
                    if (!pw) { alert(App.t('密码不能为空。')); return; }

                    const token = await App.auth.getToken();
                    if (!token) { alert('登录状态已失效，请刷新页面后重试。'); return; }
                    fetch((App.apiBase || '') + '/api/auth/delete-account', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                        body: JSON.stringify({ password: pw })
                    }).then(r => r.json().then(b => ({ status: r.status, body: b })).catch(() => ({ status: r.status, body: {} })))
                      .then(({ status, body }) => {
                          if (status === 200 && body.ok) {
                              alert(App.t('账号已注销。所有数据已删除，感谢使用。'));
                              App.auth.logout();
                              App.data.clearAllForLogout().then(() => location.reload());
                          } else {
                              alert((body && body.error) || (App.t('注销失败 (HTTP ') + status + ')'));
                          }
                      })
                      .catch(() => alert('网络异常，注销未完成。'));
                },

                // ===== 导出全部题库（备份 / 换设备迁移用）=====
                exportAllBank() {
                    const all = App.data.getQuestions();
                    if (!all.length) {
                        alert(App.t('题库为空，没有可导出的内容。'));
                        return;
                    }
                    const out = {};
                    all.forEach(q => {
                        if (!out[q.sub]) out[q.sub] = {};
                        if (!out[q.sub][q.chap]) out[q.sub][q.chap] = [];
                        // 剥掉渲染期附加字段，导出的文件可以直接再导入
                        const { _pinyin, _aiAnalysis, sub, chap, ...rest } = q;
                        out[q.sub][q.chap].push(rest);
                    });
                    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `LMS_Export_All_${Date.now()}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                },

                // ===== 修改密码 =====
                openPasswordModal() {
                    if (typeof this.closeModal === 'function') this.closeModal('config');
                    ['pw-old', 'pw-new', 'pw-new2'].forEach(id => {
                        const el = App.dom.get(id);
                        if (!el) return;
                        el.value = '';
                        el.type = 'text';
                        el.classList.add('pw-masked');
                    });
                    const modal = App.dom.get('modal-password');
                    const statusEl = App.dom.get('pw-status');
                    if (statusEl) statusEl.textContent = '';
                    this.toggleModal('password');
                },

                async submitPasswordChange() {
                    const statusEl = App.dom.get('pw-status');
                    const submitBtn = App.dom.get('pw-submit');
                    const oldPw = (App.dom.getValue('pw-old') || '').trim();
                    const newPw = (App.dom.getValue('pw-new') || '').trim();
                    const newPw2 = (App.dom.getValue('pw-new2') || '').trim();
                    const fail = (msg) => { if (statusEl) statusEl.textContent = (window.App && App.t) ? App.t(msg) : msg; };
                    if (!oldPw || !newPw || !newPw2) return fail('请填写完整三个密码框。');
                    if (newPw.length < 6) return fail('新密码至少需要 6 位。');
                    if (newPw !== newPw2) return fail('两次输入的新密码不一致。');
                    if (newPw === oldPw) return fail('新密码不能与原密码相同。');
                    // 防呆：弱模式密码提前提示（不强制阻断，与后端策略一致）。
                    // 纯数字或纯字母连续 6 位会被 Chrome 泄露检查点名，给出软提醒
                    if (/^\d{6,}$/.test(newPw)) {
                        if (!confirm(App.t('纯数字密码更容易被破解工具猜中，也可能会收到浏览器的安全提醒。') + '\n\n' + App.t('仍要使用这个密码吗？（建议改为字母+数字混合）'))) return;
                    }
                    const token = await App.auth.getToken();
                    if (!token) return fail('登录状态已失效，请重新登录后再试。');
                    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '提交中…'; }
                    try {
                        const res = await fetch((App.apiBase || '') + '/api/auth/change-password', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                            body: JSON.stringify({ oldPassword: oldPw, newPassword: newPw })
                        });
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok) {
                            fail((data && data.error) || `修改失败 (HTTP ${res.status})`);
                            return;
                        }
                        if (statusEl) statusEl.textContent = '密码修改成功，下次登录请使用新密码。';
                        // 清空输入框（避免浏览器自动填充残留），稍后自动关闭
                        ['pw-old', 'pw-new', 'pw-new2'].forEach(id => { const el = App.dom.get(id); if (el) el.value = ''; });
                        setTimeout(() => this.closeModal('password'), 1200);
                    } catch (e) {
                        fail('网络异常，请稍后重试。');
                    } finally {
                        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '确认修改'; }
                    }
                },

                toggleTheme() {
                    const isDark = !document.documentElement.classList.contains('dark');
                    document.documentElement.classList.toggle('dark');
                    try { localStorage.setItem('dark', isDark ? '1' : '0'); } catch (e) { }

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
                    const en = App.i18n && App.i18n.lang === 'en';
                    const drawer = App.dom.get('insight-drawer');
                    const backdrop = App.dom.get('drawer-backdrop');
                    if (!drawer || !backdrop) return;

                    App.dom.setText('drawer-meta', `${q.sub} / ${q.chap}`);
                    const drawerQ = App.dom.get('drawer-q');
                    if (drawerQ) {
                        if (Array.isArray(q.media) && q.media.length) {
                            drawerQ.innerHTML = App.utils.renderMedia(q.q, q.media, { imgClass: 'max-w-full rounded-lg my-2' });
                        } else {
                            drawerQ.textContent = q.q;
                        }
                    }

                    // ===== 作答记录：近 5 次明细 + 汇总统计 =====
                    const all = App.data.getSafeHistory().filter(x => x.id === id);
                    const recent = all.slice(-5).reverse();   // 最近的在最上

                    const attemptsEl = App.dom.get('drawer-attempts');
                    if (attemptsEl) {
                        if (!recent.length) {
                            attemptsEl.innerHTML = '<div class="text-[11px] text-[var(--sub)] py-3">' + App.t('还没有作答记录。') + '</div>';
                        } else {
                            attemptsEl.innerHTML = recent.map((rec) => {
                                const d = new Date(rec.t);
                                const pad = (n) => String(n).padStart(2, '0');
                                const dateStr = `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
                                const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
                                // 用时缺失（旧记录无 d）显示「—」；达到 300s 上限的截断记录显示「≥5分」
                                //（不是精确计时）；分秒用整数进位，修复 119999ms 显示「1分60秒」的问题
                                const sec = Math.round(rec.d / 1000);
                                const durStr = rec.d > 0
                                    ? (rec.x ? App.t('≥5分') : (sec < 60 ? `${sec}${en ? 's' : '秒'}` : `${Math.floor(sec / 60)}${en ? 'm ' : '分'}${String(sec % 60).padStart(2, '0')}${en ? 's' : '秒'}`))
                                    : '—';
                                const status = rec.r
                                    ? '<span class="text-emerald-600 dark:text-emerald-400 font-bold inline-flex items-center gap-0.5"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>' + App.t('正确') + '</span>'
                                    : '<span class="text-red-500 font-bold inline-flex items-center gap-0.5"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>' + App.t('错误') + '</span>';
                                return `
                                    <div class="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg bg-[var(--bg)] text-[11px]">
                                        <span class="font-mono text-[var(--sub)] flex-shrink-0">${dateStr} ${timeStr}</span>
                                        <span class="flex-1 text-right">${status}</span>
                                        <span class="w-14 text-right font-mono text-[var(--sub)] flex-shrink-0">${durStr}</span>
                                    </div>`;
                            }).join('');
                            // 题目被编辑过且存在早于编辑时间的记录：历史可能对应旧版本题干/答案
                            if (q._editedAt && recent.some(rec => rec.t < q._editedAt)) {
                                attemptsEl.insertAdjacentHTML('beforeend',
                                    '<div class="text-[11px] text-amber-600 dark:text-amber-400 pt-1">' + App.t('该题曾被修改，早于修改时间的记录可能对应旧版题目内容。') + '</div>');
                            }
                            // 表头（与记录行对齐）
                            const header = document.createElement('div');
                            header.className = 'flex items-center gap-2.5 px-2.5 text-[10px] text-[var(--sub)] uppercase tracking-wider';
                            header.innerHTML = `<span class="flex-1">${App.t('日期 / 时间')}</span><span class="flex-1 text-right">${App.t('结果')}</span><span class="w-14 text-right flex-shrink-0">${App.t('用时')}</span>`;
                            attemptsEl.prepend(header);
                        }
                    }

                    // 汇总统计（与学习分析页的单题数据一致）
                    const summaryEl = App.dom.get('drawer-summary');
                    if (summaryEl) {
                        const b = (label, value) => `<div>${label}${en ? ': ' : '：'}<span class="font-bold text-[var(--text)]">${value}</span></div>`;
                        if (!all.length) {
                            summaryEl.innerHTML = b(App.t('作答次数'), 0);
                        } else {
                            const correct = all.filter(x => x.r).length;
                            const errRate = Math.round((all.length - correct) / all.length * 100);
                            const durRecs = all.filter(x => x.d > 0);
                            const avgSec = durRecs.length ? (durRecs.reduce((s, x) => s + x.d, 0) / durRecs.length / 1000).toFixed(1) : null;
                            const totalSec = Math.round(all.filter(x => x.d > 0).reduce((s, x) => s + x.d, 0) / 1000);
                            summaryEl.innerHTML =
                                b(App.t('作答次数'), all.length) +
                                b(App.t('正确次数'), correct) +
                                b(App.t('错误率'), errRate + '%') +
                                (avgSec != null ? b(App.t('平均用时'), avgSec + (en ? 's/attempt' : '秒/次')) : b(App.t('平均用时'), '—')) +
                                (totalSec ? b(App.t('总用时'), totalSec + (en ? 's' : '秒')) : '');
                        }
                    }

                    // 打开前先取消未完成的关闭计时器，否则「快速关再开」会被旧计时器重新隐藏
                    if (backdrop._closeTimer) { clearTimeout(backdrop._closeTimer); backdrop._closeTimer = null; }
                    backdrop.classList.remove('hidden');
                    drawer.classList.remove('translate-x-full');
                    setTimeout(() => backdrop.classList.remove('opacity-0'), 10);
                },
                closeDrawer() {
                    const drawer = App.dom.get('insight-drawer');
                    const backdrop = App.dom.get('drawer-backdrop');
                    // 无条件清理遮罩：即使抽屉元素缺失或状态异常，
                    // 也绝不能让遮罩残留挡住整页点击（与 closeAccountMenu 同样的防护）
                    if (backdrop) {
                        backdrop.classList.add('opacity-0');
                        if (backdrop._closeTimer) clearTimeout(backdrop._closeTimer);
                        backdrop._closeTimer = setTimeout(() => {
                            backdrop.classList.add('hidden');
                            backdrop._closeTimer = null;
                        }, 300);
                    }
                    if (!drawer) return;
                    drawer.classList.add('translate-x-full');
                },

                // 宽容 JSON 解析 + 精准语法诊断：
                // 依次尝试 原文 → 剥 markdown 代码围栏 → 截取外层 {...} 或 [...] → 自动修复尾随逗号/注释。
                // 若仍失败，向 diagOut 填充精确的行号、列号、出错代码片段与人话原因提示。
                _parseLooseJson(text, diagOut) {
                    if (typeof text !== 'string') return null;
                    const s = text.replace(/^[\uFEFF\u200B-\u200D]+/, '').trim();
                    if (!s) {
                        if (diagOut) {
                            diagOut.rawError = 'Empty input';
                            diagOut.hint = (window.App && App.i18n && App.i18n.lang === 'en') ? 'The file or text is empty.' : '文件内容为空，请确认选择了正确的 JSON 文件。';
                        }
                        return null;
                    }
                    try { return JSON.parse(s); } catch (e) { }

                    let candidate = s;
                    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
                    if (fence && fence[1]) {
                        candidate = fence[1].trim();
                        try { return JSON.parse(candidate); } catch (e) { }
                    } else {
                        const firstBrace = s.indexOf('{');
                        const firstBracket = s.indexOf('[');
                        let startIdx = -1;
                        let endIdx = -1;
                        if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
                            startIdx = firstBrace;
                            endIdx = s.lastIndexOf('}');
                        } else if (firstBracket !== -1) {
                            startIdx = firstBracket;
                            endIdx = s.lastIndexOf(']');
                        }
                        if (startIdx !== -1 && endIdx > startIdx) {
                            candidate = s.slice(startIdx, endIdx + 1);
                            try { return JSON.parse(candidate); } catch (e) { }
                        }
                    }

                    // 尝试自动修复常见非标 JSON 错误：剥离字符串外的 // 与 /* */ 注释、去掉对象/数组末尾多余逗号
                    const tryAutoRepair = (raw) => {
                        let out = '';
                        let inStr = false;
                        let esc = false;
                        for (let i = 0; i < raw.length; i++) {
                            const ch = raw[i];
                            const next = raw[i + 1];
                            if (inStr) {
                                out += ch;
                                if (esc) esc = false;
                                else if (ch === '\\') esc = true;
                                else if (ch === '"') inStr = false;
                                continue;
                            }
                            if (ch === '"') {
                                inStr = true;
                                out += ch;
                                continue;
                            }
                            if (ch === '/' && next === '/') {
                                while (i < raw.length && raw[i] !== '\n') i++;
                                out += '\n';
                                continue;
                            }
                            if (ch === '/' && next === '*') {
                                i += 2;
                                while (i < raw.length && !(raw[i] === '*' && raw[i + 1] === '/')) i++;
                                i++;
                                continue;
                            }
                            out += ch;
                        }
                        // 移除 ] 或 } 前的多余尾随逗号
                        return out.replace(/,(\s*[}\]])/g, '$1');
                    };

                    try {
                        const repaired = tryAutoRepair(candidate);
                        const res = JSON.parse(repaired);
                        if (diagOut) diagOut.autoRepairedSyntax = true;
                        return res;
                    } catch (err) {
                        if (diagOut) this._buildJsonSyntaxDiag(candidate, err, diagOut);
                        return null;
                    }
                },

                _buildJsonSyntaxDiag(src, err, diagOut) {
                    const isEn = window.App && App.i18n && App.i18n.lang === 'en';
                    const msg = String((err && err.message) || err || 'SyntaxError');
                    diagOut.rawError = msg;

                    // 1. 检测括号/引号是否未闭合（AI 输出截断最常见症状）
                    let depthBrace = 0;
                    let depthBracket = 0;
                    let inStr = false;
                    let esc = false;
                    for (let i = 0; i < src.length; i++) {
                        const ch = src[i];
                        if (inStr) {
                            if (esc) esc = false;
                            else if (ch === '\\') esc = true;
                            else if (ch === '"') inStr = false;
                            continue;
                        }
                        if (ch === '"') inStr = true;
                        else if (ch === '{') depthBrace++;
                        else if (ch === '}') depthBrace--;
                        else if (ch === '[') depthBracket++;
                        else if (ch === ']') depthBracket--;
                    }

                    // 2. 从 SyntaxError message 中提取 position 或 line/column
                    let pos = -1;
                    const posMatch = msg.match(/position\s+(\d+)/i);
                    const lcMatch = msg.match(/line\s+(\d+)\s+column\s+(\d+)/i);
                    const lines = src.split(/\r?\n/);
                    let line = 0;
                    let col = 0;

                    if (lcMatch) {
                        line = parseInt(lcMatch[1], 10);
                        col = parseInt(lcMatch[2], 10);
                    } else if (posMatch) {
                        pos = parseInt(posMatch[1], 10);
                        let acc = 0;
                        for (let i = 0; i < lines.length; i++) {
                            const len = lines[i].length + 1;
                            if (acc + len > pos || i === lines.length - 1) {
                                line = i + 1;
                                col = Math.max(1, pos - acc + 1);
                                break;
                            }
                            acc += len;
                        }
                    } else if (inStr || depthBrace > 0 || depthBracket > 0) {
                        line = lines.length;
                        col = (lines[lines.length - 1] || '').length + 1;
                    }

                    diagOut.line = line;
                    diagOut.col = col;

                    // 3. 生成人话诊断建议
                    if (inStr || depthBrace > 0 || depthBracket > 0) {
                        diagOut.hint = isEn
                            ? `The JSON appears truncated at the end (${depthBrace > 0 ? `${depthBrace} unclosed "{"` : ''}${depthBracket > 0 ? ` ${depthBracket} unclosed "["` : ''}${inStr ? ' unclosed quote "\""' : ''}). If generated by AI, ask the AI to "continue" and paste the complete JSON.`
                            : `检测到 JSON 在末尾未闭合（${depthBrace > 0 ? `缺 ${depthBrace} 个 "}" ` : ''}${depthBracket > 0 ? `缺 ${depthBracket} 个 "]" ` : ''}${inStr ? '双引号未闭合' : ''}）——通常是因为 AI 输出太长在中途截断了。请让 AI「继续输出」补全末尾，或点击下方按钮手动补齐括号。`;
                    } else if (/Unexpected token/i.test(msg) || /Expected/i.test(msg)) {
                        diagOut.hint = isEn
                            ? 'Common causes: unescaped double quotes (") inside question/option text, missing comma between items, or full-width Chinese punctuation (： ， “ ”) used outside strings.'
                            : '常见原因：① 题干或选项内部包含了未转义的英文双引号 `"`（请改为中文引号 `“”` 或 `\\"`）；② 上一行末尾漏写了逗号 `,`；③ 冒号/括号误用了中文全角符号。';
                    } else {
                        diagOut.hint = isEn
                            ? 'Check the highlighted line below or compare with "Download template".'
                            : '请查看下方高亮定位的出错行，或对照「下载格式模板」检查格式。';
                    }

                    // 4. 构造出错行上下文代码片段
                    if (line >= 1 && line <= lines.length) {
                        const startL = Math.max(1, line - 1);
                        const endL = Math.min(lines.length, line + 1);
                        const codeRows = [];
                        for (let l = startL; l <= endL; l++) {
                            const rawLine = lines[l - 1] || '';
                            const isErrLine = l === line;
                            const numStr = String(l).padStart(4, ' ');
                            codeRows.push(
                                `<div class="${isErrLine ? 'bg-red-500/15 text-red-700 dark:text-red-300 font-bold' : 'opacity-75'} px-2 py-0.5 whitespace-pre overflow-x-auto">`
                                + `<span class="select-none opacity-60 mr-2">${numStr} |</span>${App.utils.escapeHTML(rawLine.slice(0, 160))}`
                                + `</div>`
                            );
                            if (isErrLine && col > 0 && col <= 160) {
                                const padSpaces = ' '.repeat(Math.max(0, col - 1));
                                codeRows.push(
                                    `<div class="text-red-600 dark:text-red-400 font-bold px-2 whitespace-pre select-none">`
                                    + `<span class="opacity-0 mr-2">${numStr} |</span>${padSpaces}▲ ${isEn ? 'Error here' : '此处语法异常'}`
                                    + `</div>`
                                );
                            }
                        }
                        diagOut.snippetHtml = `<div class="mt-1.5 rounded-lg border border-red-300 dark:border-red-800/80 bg-[var(--card)] font-mono text-[11px] leading-snug overflow-hidden">${codeRows.join('')}</div>`;
                    }
                },

                // ===== AI 生成题库提示词 =====
                // 与「下载格式模板」和 validateSchema 的规则保持同一套口径：
                // 四种题型、选项不带字母前缀、tf 只收 T/F、fill 用 | 分隔多答案。
                // 输出示例直接由对象 JSON.stringify(..., 4) 生成——和下载的模板同一排版，且永远合法。
                AI_IMPORT_PROMPT: (() => {
                    const example = {
                        "数学": {
                            "第一章": [
                                {
                                    "id": "q1",
                                    "type": "mcq",
                                    "q": "1+1 等于多少？",
                                    "o": ["1", "2", "3", "4"],
                                    "a": "B"
                                },
                                {
                                    "id": "q2",
                                    "type": "fill",
                                    "q": "圆的面积公式是 S = π__。",
                                    "a": "r²|r^2"
                                },
                                {
                                    "id": "q3",
                                    "type": "mcq",
                                    "q": "如图所示的图形是 __。[图1]",
                                    "media": [{ "type": "img", "key": "图1", "src": "https://example.com/shape.png", "alt": "三角形" }],
                                    "o": ["三角形", "正方形", "圆形", "梯形"],
                                    "a": "A"
                                },
                                {
                                    "id": "q4",
                                    "type": "mcq",
                                    "q": "根据表中数据，增速最快的城市是 __。[表1]",
                                    "media": [{ "type": "table", "key": "表1", "html": "<table><tr><th>城市</th><th>增速</th></tr><tr><td>甲</td><td>5%</td></tr><tr><td>乙</td><td>8%</td></tr></table>" }],
                                    "o": ["甲", "乙", "丙", "丁"],
                                    "a": "B"
                                }
                            ]
                        }
                    };
                    const zhText = [
                        '请把我的资料整理成刷题题库。输出一个完整的 JSON 文件内容，不要加任何解释文字，也不要用 markdown 代码块包裹。',
                        '',
                        '格式要求：',
                        '1. 顶层结构：{ "科目名": { "章节名": [题目, ...] } }。科目、章节按资料内容合理划分。',
                        '2. 每道题一个对象，字段：',
                        '   - "id"：题目编号，如 "q1"、"q2"，全库不重复；也可以整体省略，系统会自动生成',
                        '   - "type"：只能是 "mcq"（单选）/ "multi"（多选）/ "tf"（判断）/ "fill"（填空）',
                        '   - "q"：题干字符串；句中填空用 __ 表示空位',
                        '   - "o"：选项数组，单选和多选必填，2-8 个，只写选项内容，不要带 "A." 之类的字母前缀；判断题和填空题不需要此字段',
                        '   - "a"：答案字符串：',
                        '     - mcq 写单个字母，如 "B"',
                        '     - multi 写多个字母连写，如 "BD"',
                        '     - tf 只能是 "T"（正确）或 "F"（错误）',
                        '     - fill 写答案；有多个可接受的写法用 | 分隔，如 "TCP|传输控制协议"',
                        '   - "media"（可选）：题目带图片或表格时使用。题干中在对应位置写占位符 [图1]、[表1]，然后在 media 数组中提供内容：',
                        '     - 图片：{ "type": "img", "key": "图1", "src": "https://可公开访问的图片URL", "alt": "图示说明" }',
                        '     - 表格：{ "type": "table", "key": "表1", "html": "<table><tr><td>内容</td></tr></table>" }（html 只能用 table/thead/tbody/tr/th/td 等表格标签）',
                        '3. 只整理能客观判分的题目（上面四种），不要问答、简答等主观题。',
                        '4. 题目数量以资料内容为准，宁全勿缺。',
                        '',
                        '输出示例（结构与「下载格式模板」完全一致）：',
                        JSON.stringify(example, null, 4)
                    ].join('\n');
                    const exampleEn = {
                        "Math": {
                            "Chapter 1": [
                                { "id": "q1", "type": "mcq", "q": "What is 1 + 1?", "o": ["1", "2", "3", "4"], "a": "B" },
                                { "id": "q2", "type": "fill", "q": "The area of a circle is S = π__.", "a": "r²|r^2" },
                                { "id": "q3", "type": "mcq", "q": "The shape shown is __.[Image1]", "media": [{ "type": "img", "key": "Image1", "src": "https://example.com/shape.png", "alt": "triangle" }], "o": ["Triangle", "Square", "Circle", "Trapezoid"], "a": "A" },
                                { "id": "q4", "type": "mcq", "q": "Per the table[Table1], the fastest-growing city is __.", "media": [{ "type": "table", "key": "Table1", "html": "<table><tr><th>City</th><th>Growth</th></tr><tr><td>A</td><td>5%</td></tr><tr><td>B</td><td>8%</td></tr></table>" }], "o": ["A", "B", "C", "D"], "a": "B" }
                            ]
                        }
                    };
                    const enText = [
                        'Turn my material into a quiz bank. Output one complete JSON file content — no explanations, no markdown code fences.',
                        '',
                        'Format requirements:',
                        '1. Top-level structure: { "Subject": { "Chapter": [question, ...] } }. Split subjects/chapters sensibly from the material.',
                        '2. Each question is an object with fields:',
                        '   - "id": unique id like "q1"; may be omitted (auto-generated)',
                        '   - "type": only "mcq" / "multi" / "tf" / "fill"',
                        '   - "q": question text; use __ for blanks',
                        '   - "o": options array (required for mcq/multi), 2-8 items, no "A." prefixes; omit for tf/fill',
                        '   - "a": answer string:',
                        '     - mcq: one letter, e.g. "B"',
                        '     - multi: concatenated letters, e.g. "BD"',
                        '     - tf: only "T" (true) or "F" (false)',
                        '     - fill: the answer; multiple accepted forms separated by |',
                        '   - "media" (optional): for images/tables. Put [图1]/[表1]-style placeholders in the text and provide:',
                        '     - image: { "type": "img", "key": "Image1", "src": "https://public-url", "alt": "description" }',
                        '     - table: { "type": "table", "key": "Table1", "html": "<table><tr><td>text</td></tr></table>" } (table tags only)',
                        '3. Only objectively gradable questions (the four types) — no essays.',
                        '4. Be thorough; prefer completeness over brevity.',
                        '',
                        'Output example (same structure as the downloadable template):',
                        JSON.stringify(exampleEn, null, 4)
                    ].join('\n');
                    return { zh: zhText, en: enText };
                })(),

                aiPrompt() {
                    return (App.i18n && App.i18n.lang === 'en') ? this.AI_IMPORT_PROMPT.en : this.AI_IMPORT_PROMPT.zh;
                },

                toggleAiPrompt() {
                    const box = document.getElementById('ai-prompt-box');
                    const caret = document.getElementById('ai-prompt-caret');
                    if (!box) return;
                    const show = box.classList.contains('hidden');
                    box.classList.toggle('hidden', !show);
                    if (caret) caret.style.transform = show ? 'rotate(180deg)' : '';
                    const ta = document.getElementById('ai-prompt-text');
                    if (show && ta && !ta.value) ta.value = this.aiPrompt();
                },

                async copyAiPrompt() {
                    const ta = document.getElementById('ai-prompt-text');
                    const btn = document.getElementById('ai-prompt-copy');
                    if (!ta) return;
                    if (!ta.value) ta.value = this.aiPrompt();
                    ta.removeAttribute('readonly');
                    ta.select();
                    let ok = false;
                    try {
                        if (navigator.clipboard && window.isSecureContext) {
                            await navigator.clipboard.writeText(ta.value);
                            ok = true;
                        }
                    } catch (e) { }
                    if (!ok) {
                        try { ok = document.execCommand('copy'); } catch (e) { }
                    }
                    ta.setSelectionRange(0, 0);
                    ta.setAttribute('readonly', '');
                    if (btn) {
                        const old = btn.textContent;
                        btn.textContent = ok ? App.t('已复制') : App.t('复制失败，请长按手动复制');
                        setTimeout(() => { btn.textContent = old; }, 2000);
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
                                },
                                {
                                    "id": "q4",
                                    "type": "fill",
                                    "q": "示例填空题 (Example Fill-in-the-blank)",
                                    "a": "TCP|传输控制协议"
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

                // 导出为可读文本（.txt）：按科目/章节分组的纯文本，适合打印或分享。
                // 与 JSON 导出互补——JSON 用于再导入，文本用于人看。
                // ===== 导出 PDF（打印版题库）=====
                // 生成一份排版良好的打印文档（封面 + 按科目/章节分组的题目 + 末尾参考答案），
                // 在新窗口打开并自动呼起系统打印对话框——用户在打印目标里选「另存为 PDF」
                // 即可得到 PDF 文件。零第三方依赖；全部 HTML 在主页面生成（escapeHTML /
                // renderMedia 白名单渲染），打印窗口不含任何可执行脚本。
                openPrintExport() {
                    if (typeof this.closeModal === 'function') this.closeModal('config');
                    const all = App.data.getQuestions();
                    if (!all.length) {
                        alert(App.t('题库为空，没有可导出的内容。'));
                        return;
                    }
                    const html = this._buildPrintDoc();
                    const win = window.open('', '_blank');
                    if (!win) {
                        alert(App.t('打印窗口被浏览器拦截了。') + '\n' + App.t('请允许本站弹出窗口后重试（地址栏右侧一般会有拦截提示）。'));
                        return;
                    }
                    win.document.open();
                    win.document.write(html);
                    win.document.close();
                    const autoPrint = () => {
                        setTimeout(() => { try { win.focus(); win.print(); } catch (e) { /* 用户可手动点工具栏按钮 */ } }, 400);
                    };
                    if (win.document.readyState === 'complete') autoPrint();
                    else win.addEventListener('load', autoPrint);
                },

                // 纯文档生成（无副作用，便于测试）：返回完整打印版 HTML 字符串
                _buildPrintDoc() {
                    const all = App.data.getQuestions();
                    const esc = App.utils.escapeHTML;
                    const t = (s) => App.t(s);
                    const en = App.i18n && App.i18n.lang === 'en';
                    // 跟随应用当前深浅色主题，导出窗口的工具栏与底色保持一致观感
                    const isDark = document.documentElement.classList.contains('dark');
                    const typeLabel = { mcq: t('单选题'), multi: t('多选题'), tf: t('判断题'), fill: t('填空题') };

                    const bySub = {};
                    all.forEach(q => {
                        (bySub[q.sub] = bySub[q.sub] || {})[q.chap] = (bySub[q.sub][q.chap] || []).concat(q);
                    });

                    let n = 0;
                    const bodyParts = [];
                    for (const sub of Object.keys(bySub)) {
                        const subCount = Object.values(bySub[sub]).reduce((t2, a2) => t2 + a2.length, 0);
                        bodyParts.push(`<section class="subject"><h2>${esc(sub)}<span class="scnt">${subCount} ${t('题')}</span></h2>`);
                        for (const chap of Object.keys(bySub[sub])) {
                            const arr = bySub[sub][chap];
                            bodyParts.push(`<h3>${esc(chap)}<span class="cnt">${arr.length} ${t('题')}</span></h3>`);
                            for (const q of arr) {
                                n++;
                                const stemHtml = (Array.isArray(q.media) && q.media.length)
                                    ? App.utils.renderMedia(q.q, q.media, {})
                                    : esc(q.q);
                                let opts = '';
                                if (q.type === 'mcq' || q.type === 'multi') {
                                    opts = (q.o || []).map((o, i) =>
                                        `<div class="opt">${String.fromCharCode(65 + i)}、${esc(o)}</div>`).join('');
                                }
                                // 参考试卷格式：题号+【题型】+题干同一行；选项 A、xx；尾部「我的答案：」书写线
                                // 答案直接写在每道题后面：选择/判断写字母或 √×，填空写文本
                                const ansInline = q.type === 'tf'
                                    ? (q.a === 'T' ? '√' : '×')
                                    : (q.type === 'mcq' || q.type === 'multi' ? esc(q.a || '') : esc((q.a || '').split('|').join(' / ')));
                                bodyParts.push(
                                    `<div class="q"><div class="stem"><span class="no">${n}</span><span class="tag">【${typeLabel[q.type] || esc(q.type)}】</span>${stemHtml}</div>` +
                                    opts +
                                    `<div class="myans">${t('我的答案：')}<span class="ansline"></span></div>` +
                                    `<div class="qans">${t('答案：')}<b>${ansInline}</b></div></div>`
                                );
                            }
                        }
                        bodyParts.push('</section>');
                    }

                    const bankName = (App.data.bankName || t('我的题库')).slice(0, 60);
                    const dateStr = new Date().toISOString().slice(0, 10);
                    const user = (App.auth && App.auth.session && App.auth.session.user && App.auth.session.user.username) || '';

                    const html = `<!DOCTYPE html>
<html lang="${en ? 'en' : 'zh-CN'}" class="${isDark ? 'dark' : ''}">
<head>
<meta charset="utf-8">
<title>${esc(bankName)}_${dateStr}</title>
<style>
    @page { size: A4; margin: 16mm 15mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    /* 主题变量：与主应用 :root/.dark 完全一致 */
    :root { --bg:#f8fafc; --card:#ffffff; --text:#0f172a; --sub:#64748b; --border:#e2e8f0; --primary:#0d9488; --primary-h:#0f766e; }
    .dark { --bg:#0f172a; --card:#1e293b; --text:#f8fafc; --sub:#94a3b8; --border:#334155; }
    body { font: 11.5pt/1.75 Inter, -apple-system, "Microsoft YaHei", "PingFang SC", sans-serif; color: #111; background: var(--bg); }
    .toolbar { position: sticky; top: 0; z-index: 9; display: flex; align-items: center; gap: 10px;
        padding: 10px 16px; background: var(--card); border-bottom: 1px solid var(--border); color: var(--text);
        font-family: Inter, -apple-system, sans-serif; }
    .toolbar button { padding: 7px 16px; border-radius: 10px; border: 1px solid var(--primary); background: var(--primary);
        color: #fff; font-weight: 600; font-size: 13px; cursor: pointer; transition: background .15s; }
    .toolbar button:hover { background: var(--primary-h); }
    .toolbar button.ghost { background: var(--card); color: var(--text); border-color: var(--border); }
    .toolbar button.ghost:hover { background: var(--bg); }
    .toolbar .tip { font-size: 12px; color: var(--sub); }
    .wrap { max-width: 180mm; margin: 0 auto; padding: 8px 2mm 16mm; background: #fff; border-radius: 12px;
        box-shadow: 0 4px 24px rgba(0,0,0,.12); }
    .cover { text-align: center; padding: 20px 0 12px; border-bottom: 2.5px solid #222; margin-bottom: 6px; }
    .cover h1 { font-size: 20pt; margin: 0 0 6px; letter-spacing: 2px; }
    .cover .meta { font-size: 10pt; color: #555; }
    h2 { font-size: 13.5pt; margin: 20px 0 4px; padding-bottom: 3px; border-bottom: 2px solid #333;
        page-break-after: avoid; break-after: avoid; }
    h2 .scnt { font-size: 9.5pt; font-weight: normal; color: #777; margin-left: 8px; }
    h3 { font-size: 11.5pt; margin: 13px 0 4px; color: #222; page-break-after: avoid; break-after: avoid; }
    h3 .cnt { font-size: 9pt; font-weight: normal; color: #999; margin-left: 6px; }
    .q { padding: 5px 0 6px; margin: 0; page-break-inside: avoid; break-inside: avoid; }
    .q + .q { border-top: 1px solid #e4e4e4; }
    .stem { margin: 1px 0; }
    .stem .no { font-weight: 700; margin-right: 5px; }
    .stem .tag { color: #333; font-weight: 600; }
    .opt { margin: 1px 0 1px 14px; }
    .myans { margin: 3px 0 1px 14px; color: #333; }
    .ansline { display: inline-block; min-width: 220px; border-bottom: 1px solid #999; height: 1em; vertical-align: baseline; }
    .media-img { max-width: 60%; height: auto; display: block; margin: 5px 0; border: 1px solid #ddd; border-radius: 4px; }
    .media-table { margin: 5px 0; }
    .media-table table { border-collapse: collapse; }
    .media-table th, .media-table td { border: 1px solid #888; padding: 2px 9px; text-align: left; }
    .media-table th { background: #f0f0f0; }
    .answers { page-break-before: always; break-before: page; }
    .answers table { width: 100%; border-collapse: collapse; font-size: 10.5pt; margin-top: 8px; }
    .answers th, .answers td { border: 1px solid #999; padding: 4px 9px; text-align: left; }
    .answers th { background: #efefef; font-size: 10pt; }
    .answers .ano { width: 44px; text-align: center; font-weight: 700; }
    .answers .aloc { color: #777; font-size: 9.5pt; }
    footer { margin-top: 22px; text-align: center; font-size: 9pt; color: #aaa; }
    @media print { .no-print { display: none !important; } body { font-size: 10.5pt; background: #fff; } .wrap { padding: 0; background: #fff; box-shadow: none; border-radius: 0; } }
</style>
</head>
<body>
    <div class="toolbar no-print">
        <button onclick="window.print()">${t('打印 / 保存为 PDF')}</button>
        <button class="ghost" onclick="window.close()">${t('关闭')}</button>
        <span class="tip">${t('在打印对话框的「目标打印机」中选择「另存为 PDF」，即可导出 PDF 文件')}</span>
    </div>
    <div class="wrap">
        <header class="cover">
            <h1>${esc(bankName)}</h1>
            <div class="meta">${t('共')} ${n} ${t('题')}${user ? ' / ' + esc(user) : ''} / ${t('导出于')} ${dateStr}</div>
        </header>
        ${bodyParts.join('\n')}
        <footer></footer>
    </div>
</body>
</html>`;

                    return html;
                },

                // 打开疑似相似题审查弹窗
                openSimilarReviewModal() {
                    return this.openSimilarReview();
                },

                openSimilarReview() {
                    if (typeof this.closeModal === 'function') {
                        this.closeModal('config');
                        this.closeModal('import-center');
                    }
                    const report = App.data._lastImportReport;
                    if (!report || !report.similarPairs || report.similarPairs.length === 0) {
                        alert(App.t("当前没有检测到需要审查的疑似相似题。请先通过导入题库生成。"));
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
                                <div class="text-[11px] text-[var(--sub)]">
                                    #${idx + 1} [${subEsc} / ${chapEsc}] ${App.t('相似度：')}<span class="font-bold text-amber-600">${(pair.score * 100).toFixed(0)}%</span>
                                </div>
                            </div>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                                <div class="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2">
                                    <div class="text-[11px] text-[var(--sub)] mb-1">${App.t('现有题（题库中已有） / ID:')} ${existId}</div>
                                    <div class="text-[11px] font-medium text-[var(--text)] mb-1">${existQ}</div>
                                    <div class="text-[11px] text-[var(--sub)]">${App.t('答案：')}${existA}</div>
                                </div>
                                <div class="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2">
                                    <div class="text-[11px] text-[var(--sub)] mb-1">${App.t('新导入题 / ID:')} ${incomingId}</div>
                                    <div class="text-[11px] font-medium text-[var(--text)] mb-1">${incomingQ}</div>
                                    <div class="text-[11px] text-[var(--sub)]">${App.t('答案：')}${incomingA}</div>
                                </div>
                            </div>
                            <div class="mt-2 flex flex-wrap gap-3 text-[11px]">
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

                    this._showModalEl(modal);
                },

                // 应用疑似相似题审查结果：根据用户选择软删对应题目
                async applySimilarReview() {
                    const report = App.data._lastImportReport;
                    if (!report || !report.similarPairs || report.similarPairs.length === 0) {
                        alert('当前没有待审查的相似题。');
                        return;
                    }
                    if (!(await this.confirm(App.t('确认要应用这 ') + report.similarPairs.length + App.t(' 组审查结果吗？')))) {
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
                openQuestionEditor(qId, presetSub = '', presetChap = '') {
                    // 兼容旧语法环境：在函数体内处理默认值
                    if (typeof qId === 'undefined') qId = null;
                    const modal = App.dom.get('modal-question-editor');
                    if (!modal) return;
                    // 删除按钮只在「编辑已有题目」时出现；新建模式显示「保存并继续下一题」
                    const delBtn = App.dom.get('qe-delete');
                    if (delBtn) delBtn.classList.toggle('hidden', !qId);
                    const saveNextBtn = App.dom.get('qe-save-next');
                    if (saveNextBtn) saveNextBtn.classList.toggle('hidden', Boolean(qId));

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

                    const subjects = App.data.getSubjects();
                    if (subSelect) {
                        subSelect.innerHTML = '';
                        if (!subjects.length) {
                            const emptyOpt = document.createElement('option');
                            emptyOpt.value = '';
                            emptyOpt.textContent = App.t('（请在右侧输入新科目）');
                            subSelect.appendChild(emptyOpt);
                        } else {
                            subjects.forEach(s => {
                                const opt = document.createElement('option');
                                opt.value = s;
                                opt.textContent = s;
                                subSelect.appendChild(opt);
                            });
                        }
                    }

                    const filterEl = App.dom.get('lib-filter');
                    const chapFilterEl = App.dom.get('lib-chapter');
                    let defaultSub = presetSub || (filterEl && filterEl.value !== 'all' ? filterEl.value : (subjects[0] || ''));
                    let defaultChap = presetChap || '';
                    if (!defaultChap && chapFilterEl && chapFilterEl.value && chapFilterEl.value !== 'all') {
                        if (chapFilterEl.value.includes('\u0001')) {
                            const [sPart, cPart] = chapFilterEl.value.split('\u0001');
                            if (!presetSub && sPart) defaultSub = sPart;
                            defaultChap = cPart || '';
                        } else {
                            defaultChap = chapFilterEl.value;
                        }
                    }

                    if (subSelect && defaultSub && subjects.includes(defaultSub)) subSelect.value = defaultSub;
                    if (subInput) subInput.value = (defaultSub && !subjects.includes(defaultSub)) ? defaultSub : '';

                    const updateChaps = (sub, preferredChap = '') => {
                        if (!chapSelect) return;
                        chapSelect.innerHTML = '';
                        const chaps = sub ? App.data.getChapters(sub) : [];
                        if (!chaps.length) {
                            const emptyOpt = document.createElement('option');
                            emptyOpt.value = '';
                            emptyOpt.textContent = App.t('（请在右侧输入新章节）');
                            chapSelect.appendChild(emptyOpt);
                            return;
                        }
                        chaps.forEach(c => {
                            const opt = document.createElement('option');
                            opt.value = c;
                            opt.textContent = c;
                            chapSelect.appendChild(opt);
                        });
                        if (preferredChap && chaps.includes(preferredChap)) {
                            chapSelect.value = preferredChap;
                        }
                    };
                    updateChaps(defaultSub, defaultChap);
                    if (chapInput) {
                        const existingChaps = defaultSub ? App.data.getChapters(defaultSub) : [];
                        chapInput.value = (defaultChap && !existingChaps.includes(defaultChap)) ? defaultChap : '';
                    }

                    if (subSelect) {
                        subSelect.onchange = () => updateChaps(subSelect.value);
                    }

                    const optionsBlock = App.dom.get('qe-options-block');
                    const tfBlock = App.dom.get('qe-tf-block');
                    const optList = App.dom.get('qe-options-list');
                    const mediaHint = App.dom.get('qe-media-hint');
                    if (mediaHint) { mediaHint.classList.add('hidden'); mediaHint.textContent = ''; }

                    if (!qId) {
                        if (titleEl) titleEl.textContent = App.t('新增题目');
                        if (idInput) idInput.value = '';
                        if (typeSelect) typeSelect.value = 'mcq';
                        if (qText) qText.value = '';
                        const fillInput = App.dom.get('qe-fill-answer');
                        if (fillInput) fillInput.value = '';
                        App.dom.get('qe-fill-block') && App.dom.get('qe-fill-block').classList.add('hidden');
                        if (optionsBlock && optList) {
                            optionsBlock.classList.remove('hidden');
                            tfBlock && tfBlock.classList.add('hidden');
                            optList.innerHTML = '';
                            ['', '', '', ''].forEach(x => App.ui.addQuestionOption(x));
                        }
                        if (tfBlock) {
                            const radios = tfBlock.querySelectorAll('input[name="qe-tf"]');
                            radios.forEach(r => r.checked = false);
                        }
                    } else {
                        const q = App.data.getQuestionById(qId);
                        if (!q) return;
                        if (titleEl) titleEl.textContent = App.t('编辑题目');
                        if (idInput) idInput.value = q.id;
                        if (qText) qText.value = q.q;
                        // 富媒体提示：media 只能经 JSON 导入/导出维护，编辑弹窗改不了它，但要告知用户它存在
                        if (mediaHint && Array.isArray(q.media) && q.media.length) {
                            const imgs = q.media.filter(m => m && (m.type || 'img') === 'img').length;
                            const tabs = q.media.length - imgs;
                            mediaHint.textContent = App.i18n.lang === 'en' ? `Note: Rich media on this question (${imgs} image(s)${tabs ? `, ${tabs} table(s)` : ''}). Placeholders [图N]/[表N] appear in the text. Editing keeps them; manage media via "Import questions".` : `提示：此题含富媒体（图片 ${imgs} 个${tabs ? `、表格 ${tabs} 个` : ''}），题干中以 [图N]/[表N] 占位。编辑保存不会丢失这些内容；修改媒体本身请走「导入题库」。`;
                            mediaHint.classList.remove('hidden');
                        }
                        if (subSelect) subSelect.value = q.sub;
                        updateChaps(q.sub);
                        if (chapSelect) chapSelect.value = q.chap;
                        if (typeSelect) typeSelect.value = q.type;

                        const fillBlock = App.dom.get('qe-fill-block');
                        const fillInput = App.dom.get('qe-fill-answer');
                        if (q.type === 'fill') {
                            optionsBlock && optionsBlock.classList.add('hidden');
                            tfBlock && tfBlock.classList.add('hidden');
                            fillBlock && fillBlock.classList.remove('hidden');
                            if (fillInput) fillInput.value = q.a || '';
                        } else if (q.type === 'tf') {
                            optionsBlock && optionsBlock.classList.add('hidden');
                            if (tfBlock) {
                                tfBlock.classList.remove('hidden');
                                const radios = tfBlock.querySelectorAll('input[name="qe-tf"]');
                                radios.forEach(r => { r.checked = r.value === q.a; });
                            }
                            fillBlock && fillBlock.classList.add('hidden');
                        } else {
                            fillBlock && fillBlock.classList.add('hidden');
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

                    this._showModalEl(modal);
                },

                onQuestionTypeChange() {
                    const typeEl = App.dom.get('qe-type');
                    const type = typeEl ? typeEl.value : 'mcq';
                    const optionsBlock = App.dom.get('qe-options-block');
                    const tfBlock = App.dom.get('qe-tf-block');
                    const fillBlock = App.dom.get('qe-fill-block');
                    const tfRadios = document.querySelectorAll('#qe-tf-block input[name="qe-tf"]');

                    if (type === 'fill') {
                        optionsBlock && optionsBlock.classList.add('hidden');
                        tfBlock && tfBlock.classList.add('hidden');
                        fillBlock && fillBlock.classList.remove('hidden');
                    } else if (type === 'tf') {
                        // 切换为判断题：隐藏选项区，清空所有选项勾选
                        const list = App.dom.get('qe-options-list');
                        if (list) {
                            const rows = list.querySelectorAll('.qe-opt-row input[type="checkbox"]');
                            rows.forEach(chk => chk.checked = false);
                        }
                        optionsBlock && optionsBlock.classList.add('hidden');
                        tfBlock && tfBlock.classList.remove('hidden');
                        fillBlock && fillBlock.classList.add('hidden');
                    } else {
                        fillBlock && fillBlock.classList.add('hidden');
                        // 切换为选择题：显示选项区，清空判断题勾选
                        tfRadios.forEach(r => { r.checked = false; });
                        optionsBlock && optionsBlock.classList.remove('hidden');
                        tfBlock && tfBlock.classList.add('hidden');
                        const list = App.dom.get('qe-options-list');
                        if (list && list.querySelectorAll('.qe-opt-row').length === 0) {
                            ['', '', '', ''].forEach(x => App.ui.addQuestionOption(x));
                        }
                        // 防呆：从多选切回单选时，若已勾选多个正确项，自动只保留第一个勾选
                        if (type === 'mcq' && list) {
                            let seenChecked = false;
                            list.querySelectorAll('.qe-opt-row input[type="checkbox"]').forEach(chk => {
                                if (chk.checked) {
                                    if (seenChecked) chk.checked = false;
                                    else seenChecked = true;
                                }
                            });
                        }
                    }
                },

                addQuestionOption(initialText = '') {
                    const list = App.dom.get('qe-options-list');
                    if (!list) return;
                    const idx = list.querySelectorAll('.qe-opt-row').length;
                    if (idx >= 16) {
                        alert(App.t('最多支持 16 个选项（A–P）。'));
                        return;
                    }
                    const letter = String.fromCharCode(65 + idx);
                    const row = document.createElement('div');
                    row.className = 'qe-opt-row flex items-center gap-2';
                    // 选项内容可能不是字符串（例如导入的 JSON 里选项写成数字），
                    // 直接 .replace 会抛 TypeError；这里统一转成字符串并做完整属性转义
                    const safeValue = App.utils.escapeHTML(String(initialText == null ? '' : initialText));
                    row.innerHTML = `
                        <span class="w-5 text-[11px] font-bold text-[var(--sub)]">${letter}.</span>
                        <input class="flex-1 bg-[var(--card)] border border-[var(--border)] rounded-lg px-2 py-1.5 outline-none text-base sm:text-xs focus:border-primary-500"
                               value="${safeValue}"
                               placeholder="${App.t('选项内容')} ${letter}" />
                        <label class="flex items-center gap-1 text-[11px] text-[var(--sub)] cursor-pointer select-none flex-shrink-0">
                            <input type="checkbox" class="accent-primary-600" onchange="App.ui._onQuestionOptCheck(this)" />
                            <span>${App.t('正确')}</span>
                        </label>
                        <button type="button" class="text-[11px] text-[var(--sub)] hover:text-red-500 p-1 flex-shrink-0 inline-flex items-center justify-center"
                                title="${App.t('删除此选项')}"
                                onclick="this.parentElement.remove(); App.ui.renumberQuestionOptions()">
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                        </button>
                    `;
                    list.appendChild(row);
                },

                // 防呆：单选题 (mcq) 模式下勾选某个选项为「正确」时，自动取消其余选项的勾选
                _onQuestionOptCheck(chkEl) {
                    if (!chkEl || !chkEl.checked) return;
                    const typeEl = App.dom.get('qe-type');
                    const type = typeEl ? typeEl.value : 'mcq';
                    if (type !== 'mcq') return;
                    const list = App.dom.get('qe-options-list');
                    if (!list) return;
                    list.querySelectorAll('.qe-opt-row input[type="checkbox"]').forEach(other => {
                        if (other !== chkEl) other.checked = false;
                    });
                },

                renumberQuestionOptions() {
                    const list = App.dom.get('qe-options-list');
                    if (!list) return;
                    const rows = list.querySelectorAll('.qe-opt-row');
                    rows.forEach((row, idx) => {
                        const letter = String.fromCharCode(65 + idx);
                        const span = row.querySelector('span');
                        if (span) span.textContent = `${letter}.`;
                        const inp = row.querySelector('input[type="text"], input:not([type])');
                        if (inp) inp.placeholder = `${App.t('选项内容')} ${letter}`;
                    });
                },

                saveQuestionFromEditor(keepOpenForNext = false) {
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
                        if (errEl) { errEl.textContent = App.t('科目 / 章节 / 题干 不能为空。'); errEl.scrollIntoView({ block: 'nearest' }); }
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
                            if (errEl) { errEl.textContent = App.t('请为判断题选择正确答案。'); errEl.scrollIntoView({ block: 'nearest' }); }
                            return;
                        }
                        answer = val;
                    } else if (type === 'fill') {
                        const rawFill = (App.dom.getValue('qe-fill-answer') || '').trim();
                        const variants = rawFill.split('|').map(s => s.trim()).filter(Boolean);
                        if (!variants.length) {
                            if (errEl) { errEl.textContent = App.t('请填写填空题的正确答案。'); errEl.scrollIntoView({ block: 'nearest' }); }
                            return;
                        }
                        answer = variants.join('|');
                    } else {
                        const list = App.dom.get('qe-options-list');
                        if (!list) return;
                        const rows = list.querySelectorAll('.qe-opt-row');
                        if (rows.length < 2) {
                            if (errEl) { errEl.textContent = App.t('单选 / 多选题至少需要两个选项。'); errEl.scrollIntoView({ block: 'nearest' }); }
                            return;
                        }
                        const ansLetters = [];
                        let checkedEmptyRow = false;
                        rows.forEach((row) => {
                            const input = row.querySelector('input[type="text"], input:not([type])');
                            const chk = row.querySelector('input[type="checkbox"]');
                            if (!input) return;
                            const text = input.value.trim();
                            if (!text) {
                                if (chk && chk.checked) checkedEmptyRow = true;
                                return;
                            }
                            options.push(text);
                            if (chk && chk.checked) {
                                const letter = String.fromCharCode(65 + options.length - 1);
                                ansLetters.push(letter);
                            }
                        });
                        if (checkedEmptyRow) {
                            if (errEl) { errEl.textContent = App.t('已勾选为「正确」的选项内容不能为空，请填写该选项内容或改勾其他选项。'); errEl.scrollIntoView({ block: 'nearest' }); }
                            return;
                        }
                        if (!options.length || options.length < 2) {
                            if (errEl) { errEl.textContent = App.t('选项内容不能为空，并且至少两项。'); errEl.scrollIntoView({ block: 'nearest' }); }
                            return;
                        }
                        if (!ansLetters.length) {
                            if (errEl) { errEl.textContent = App.t('请至少勾选一个正确选项。'); errEl.scrollIntoView({ block: 'nearest' }); }
                            return;
                        }
                        answer = ansLetters.sort().join('');
                        if (type === 'mcq' && answer.length !== 1) {
                            if (errEl) { errEl.textContent = App.t('单选题只能有一个正确选项。'); errEl.scrollIntoView({ block: 'nearest' }); }
                            return;
                        }
                    }

                    // 基础清洗：去掉选项前面的 A./1)/① 等前缀，避免重复前缀
                    const cleanedOptions = options.map(txt => {
                        return txt.replace(/^[A-Za-z0-9①-⑳Ａ-Ｚａ-ｚ０-９][\.、．:：）)\-\s]+/, '').trim();
                    });
                    if (type === 'mcq' || type === 'multi') {
                        const lowerSet = new Set(cleanedOptions.map(s => s.toLowerCase()));
                        if (lowerSet.size !== cleanedOptions.length) {
                            if (errEl) { errEl.textContent = App.t('存在内容完全相同的重复选项，请检查修正。'); errEl.scrollIntoView({ block: 'nearest' }); }
                            return;
                        }
                    }

                    // 编辑已有题时，保留表单覆盖不到的扩展字段（media 图片/表格等）——
                    // 否则编辑一次题干，media 就会被 upsertQuestion 整体替换掉（数据丢失）
                    let carried = {};
                    if (id) {
                        const existing = App.data.getQuestionById(id);
                        if (existing) {
                            const { id: _i, sub: _s, chap: _c, type: _t, q: _q, o: _o, a: _a, ...rest } = existing;
                            carried = rest;
                        }
                    }

                    App.data.upsertQuestion({
                        ...carried,
                        id,
                        sub,
                        chap,
                        type,
                        q,
                        o: (type === 'tf' || type === 'fill') ? undefined : cleanedOptions,
                        a: answer
                    });

                    if (App.data && typeof App.data.saveToCloudDebounced === 'function') {
                        App.data.saveToCloudDebounced();
                    }

                    if (window.App && App.router && typeof App.router.refresh === 'function') {
                        App.router.refresh();
                    } else if (window.App && App.views && App.views.library && typeof App.views.library.render === 'function') {
                        App.views.library.render(App.views.library.currentMode);
                    }

                    if (keepOpenForNext && !id) {
                        // 保持弹窗开启，保留刚才使用的科目、章节和题型，清空题干与选项以便连续录入下一题
                        this.openQuestionEditor(null, sub, chap);
                        if (typeSelect) {
                            typeSelect.value = type;
                            this.onQuestionTypeChange();
                        }
                        if (qText && typeof qText.focus === 'function') setTimeout(() => qText.focus(), 20);
                        if (typeof showGlobalToast === 'function') {
                            showGlobalToast(App.t('题目已保存，可继续录入下一题。'), 'success');
                        }
                        return;
                    }

                    App.ui.closeModal('question-editor');
                    if (typeof showGlobalToast === 'function') {
                        showGlobalToast(App.t(id ? '题目修改已保存。' : '新题目已添加到题库。'), 'success');
                    }
                },

                // 编辑弹窗内直接删除当前题目（软删除 → 回收站，可恢复）
                async deleteQuestionFromEditor() {
                    const idInput = App.dom.get('qe-id');
                    const id = idInput ? idInput.value : '';
                    if (!id) return;
                    const q = App.data.getQuestionById(id);
                    if (!q) {
                        App.ui.closeModal('question-editor');
                        return;
                    }
                    const msg = [App.t('确定删除这道题吗？'), (q.q || '').slice(0, 60), '', App.t('题目会进入回收站，可随时恢复。')].join('\n');
                    if (!(await this.confirm(msg))) return;
                    App.data.softDeleteByIds(new Set([id]), 'editor-delete');
                    App.ui.closeModal('question-editor');
                    if (window.App && App.router && typeof App.router.refresh === 'function') {
                        App.router.refresh();
                    } else if (window.App && App.views && App.views.library && typeof App.views.library.render === 'function') {
                        App.views.library.render(App.views.library.currentMode);
                    }
                },

                openTrashModal() {
                    if (typeof this.closeModal === 'function') this.closeModal('config');
                    const modal = App.dom.get('modal-trash');
                    const list = App.dom.get('trash-list');
                    if (!modal || !list) return;

                    // 先确保弹窗可见，再做内容渲染：渲染无论发生什么都不应阻止弹窗打开
                    this._showModalEl(modal);

                    if (!list.dataset.bound) {
                        list.addEventListener('click', async (e) => {
                            const btn = e.target.closest('button[data-action]');
                            if (!btn) return;
                            const action = btn.dataset.action;
                            const sub = decodeURIComponent(btn.dataset.sub || '');
                            const chap = decodeURIComponent(btn.dataset.chap || '');
                            const id = decodeURIComponent(btn.dataset.id || '');
                            if (action === 'restore') {
                                App.data.restoreFromTrash(sub, chap, id);
                                App.ui.openTrashModal();
                                // 底层视图同步刷新：题库列表/统计立即反映恢复的题
                                if (window.App && App.router && typeof App.router.refresh === 'function') App.router.refresh();
                            } else if (action === 'destroy') {
                                if (await App.ui.confirm(App.t('确定要永久删除这道题吗？此操作不可恢复。'))) {
                                    App.data.destroyFromTrash(sub, chap, id);
                                    App.ui.openTrashModal();
                                }
                            }
                        });
                        list.dataset.bound = '1';
                    }

                    list.innerHTML = '';
                    try {
                        const trash = App.data.trash || {};
                        const subs = Object.keys(trash);

                        if (!subs.length) {
                            list.innerHTML = '<div class="text-center text-[var(--sub)] py-8">' + App.t('回收站为空。') + '</div>';
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
                                                <span class="text-[11px] font-bold text-primary-600 bg-primary-50 px-1 rounded border border-primary-100">${App.utils.escapeHTML(sub)}</span>
                                                <span class="text-[11px] text-[var(--sub)] border border-[var(--border)] px-1 rounded">${App.utils.escapeHTML(chap)}</span>
                                            </div>
                                            <span class="text-[11px] text-[var(--sub)]">${arr.length} 题</span>
                                        </div>
                                    `;
                                    arr.forEach(q => {
                                        if (!q || typeof q !== 'object') return;
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
                                                <div class="text-[11px] text-[var(--sub)]">ID: ${App.utils.escapeHTML(String(q.id || ''))}</div>
                                                <div class="flex items-center gap-2">
                                                    <span class="text-[11px] text-[var(--sub)]">${timeStr}</span>
                                                    <button class="px-2 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-600 text-[11px] font-bold"
                                                        data-action="restore" data-sub="${subKey}" data-chap="${chapKey}" data-id="${idKey}">
                                                        ${App.t('恢复')}
                                                    </button>
                                                    <button class="px-2 py-0.5 rounded border border-red-200 bg-red-50 text-red-600 text-[11px] font-bold"
                                                        data-action="destroy" data-sub="${subKey}" data-chap="${chapKey}" data-id="${idKey}">
                                                        ${App.t('彻底删除')}
                                                    </button>
                                                </div>
                                            </div>
                                            <div class="text-[11px] font-medium text-[var(--text)] mb-1">${safeQuestion}</div>
                                            <div class="text-[11px] text-[var(--sub)]">${App.t('删除原因：')}${safeReason} / ${App.t('路径：')}${safePathSub} - ${safePathChap}</div>
                                        `;
                                        block.appendChild(item);
                                    });
                                    list.appendChild(block);
                                });
                            });
                        }
                    } catch (e) {
                        // 渲染异常也不能无声无息：弹窗保持打开并显示错误
                        console.error('回收站渲染失败', e);
                        list.innerHTML = '<div class="text-center text-red-500 py-8">' + (App.i18n.lang === 'en' ? 'Failed to render trash: ' : '回收站内容渲染失败：') + '' + App.utils.escapeHTML(e.message || String(e)) + '</div>';
                    }
                },

                async openCloudBackups() {
                    if (typeof this.closeModal === 'function') this.closeModal('config');
                    const modal = App.dom.get('modal-cloud-backups');
                    if (!modal) return;
                    this._showModalEl(modal);
                    const list = App.dom.get('cloud-backups-list');
                    list.innerHTML = '<div class="text-[var(--sub)] italic text-center py-4">Loading…</div>';
                    try {
                        const token = await App.auth.getToken();
                        const res = await fetch(App.apiBase + '/api/user-backups', { headers: { Authorization: 'Bearer ' + token } });
                        const body = await res.json().catch(() => ({}));
                        if (!res.ok || !body.ok) {
                            list.innerHTML = '<div class="text-red-500 text-center py-4">' + App.utils.escapeHTML(body.error || 'Failed to load') + '</div>';
                            return;
                        }
                        const typeLabel = { history: App.t('刷题记录'), bank: App.t('题库') };
                        if (!body.backups.length) {
                            list.innerHTML = '<div class="text-[var(--sub)] italic text-center py-4">' + App.t('暂无云端备份。') + '</div>';
                            return;
                        }
                        list.innerHTML = body.backups.map(b => {
                            const kb = Math.max(1, Math.round((b.size || 0) / 1024));
                            const d = new Date(String(b.created_at).replace(' ', 'T') + 'Z');
                            const pad = (n) => String(n).padStart(2, '0');
                            const dt = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
                            const typeTxt = typeLabel[b.type] || b.type;
                            // 主操作是「预览并恢复」：备份的意义是能一键回滚，
                            // 而不是让用户下载成 JSON 再自己走一遍（合并式的）导入。
                            return `<div class="anim-fade-in flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--bg)]">
                                <div class="flex flex-col min-w-0">
                                    <span class="font-bold text-[var(--text)]">${App.utils.escapeHTML(typeTxt)}</span>
                                    <span class="text-[10px] text-[var(--sub)]">${dt} / ${kb} KB</span>
                                </div>
                                <div class="flex items-center gap-1.5 flex-shrink-0">
                                    <button onclick="App.ui.previewCloudBackup(${b.id})" class="px-3 py-1.5 rounded-lg bg-primary-600 text-white text-[11px] font-bold hover:bg-primary-700 active:scale-95 transition-all shadow-sm">${App.t('预览并恢复')}</button>
                                    <button onclick="App.ui.downloadCloudBackup(${b.id})" title="${App.t('下载备份文件')}" aria-label="${App.t('下载备份文件')}"
                                        class="w-7 h-7 rounded-lg border border-[var(--border)] text-[var(--sub)] hover:text-[var(--text)] hover:bg-[var(--card)] active:scale-95 transition-all flex items-center justify-center">
                                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V4"></path></svg>
                                    </button>
                                </div>
                            </div>`;
                        }).join('');
                    } catch (e) {
                        list.innerHTML = '<div class="text-red-500 text-center py-4">' + App.utils.escapeHTML(String(e)) + '</div>';
                    }
                },

                async downloadCloudBackup(id) {
                    try {
                        const token = await App.auth.getToken();
                        const res = await fetch(App.apiBase + '/api/user-backups?id=' + id, { headers: { Authorization: 'Bearer ' + token } });
                        const body = await res.json().catch(() => ({}));
                        if (!res.ok || !body.ok) { alert(App.t('下载失败。')); return; }
                        const name = (body.type === 'bank' ? App.t('题库') : App.t('刷题记录')) + '_' + String(body.id) + '.json';
                        const blob = new Blob([JSON.stringify(body.payload, null, 2)], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = name;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                    } catch (e) {
                        alert(App.t('下载失败。'));
                    }
                },

                /* ===== 云端备份：预览差异 + 一键覆盖恢复 ===== */

                /** 差异项的标签与配色。注意：全部写成完整类名字面量——静态 Tailwind 靠扫源码收集类名。
                 *  注意：primary 是自定义调色板，只有 50/100/500/600/700 这几档，别写 300/400/800/900/950（生成不出来） */
                _bpKindStyle: {
                    added: { label: 'NEW', chip: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800' },
                    removed: { label: 'DEL', chip: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-300 dark:border-red-800' },
                    moved: { label: 'MOVE', chip: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-800' },
                    changed: { label: 'MOD', chip: 'bg-primary-500/10 text-primary-600 dark:text-primary-500 border-primary-500 dark:border-primary-500' },
                    same: { label: '=', chip: 'bg-[var(--bg)] text-[var(--sub)] border-[var(--border)]' }
                },

                _bpFieldLabel(f) {
                    const m = { q: App.t('题干'), o: App.t('选项'), a: App.t('答案'), type: App.t('题型'), id: 'ID' };
                    return m[f] || f;
                },

                /** 值 → 单行短文本（差异明细里用） */
                _bpShort(v, n) {
                    if (v === undefined) return '—';
                    let s = typeof v === 'string' ? v : JSON.stringify(v);
                    if (s === undefined) s = String(v);
                    s = s.replace(/\s+/g, ' ').trim();
                    const lim = n || 60;
                    return App.utils.escapeHTML(s.length > lim ? s.slice(0, lim) + '…' : s);
                },

                _bpTime(t) {
                    if (typeof t !== 'number' || !Number.isFinite(t)) return '—';
                    const d = new Date(t);
                    const pad = (n) => String(n).padStart(2, '0');
                    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
                },

                /**
                 * 预览弹窗骨架（只建一次）。
                 * id 以 `modal-` 开头且直接子元素是 `.card`，因此自动获得与其它弹窗一致的
                 * 缩放+淡入过渡；点空白关闭 / Esc 关闭由 initModalInteractions 的委托统一处理。
                 */
                _ensureBackupPreviewModal() {
                    let modal = document.getElementById('modal-backup-preview');
                    if (modal) return modal;
                    modal = document.createElement('div');
                    modal.id = 'modal-backup-preview';
                    modal.className = 'fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4 backdrop-blur-sm hidden opacity-0 pointer-events-none';
                    modal.innerHTML =
                        '<div class="card w-full max-w-4xl rounded-2xl shadow-2xl p-0 flex flex-col max-h-[88vh]">' +
                        '  <div class="p-4 border-b border-[var(--border)] flex justify-between items-start gap-3 bg-[var(--bg-hover)] rounded-t-2xl">' +
                        '    <div class="flex flex-col min-w-0">' +
                        '      <h3 class="font-bold text-base" data-bp-title></h3>' +
                        '      <span class="text-[10px] text-[var(--sub)] mt-0.5" data-bp-subtitle></span>' +
                        '    </div>' +
                        '    <button data-bp-close aria-label="' + App.t('关闭') + '" class="text-[var(--sub)] hover:text-[var(--text)] p-1 flex-shrink-0">' +
                        '      <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>' +
                        '    </button>' +
                        '  </div>' +
                        '  <div class="flex-grow overflow-y-auto custom-scroll p-4 space-y-3 text-xs" data-bp-body></div>' +
                        '  <div class="p-3 border-t border-[var(--border)] flex items-center justify-between gap-3 flex-wrap" data-bp-footer></div>' +
                        '</div>';
                    document.body.appendChild(modal);
                    modal.addEventListener('click', (e) => {
                        if (e.target.closest('[data-bp-close]')) { this.closeModal('backup-preview'); return; }
                        const f = e.target.closest('[data-bp-filter]');
                        if (f) {
                            this._bpState.filter = f.dataset.bpFilter;
                            this._renderBackupList();
                            return;
                        }
                        if (e.target.closest('[data-bp-more]')) {
                            this._bpState.shown += 150;
                            this._renderBackupList();
                            return;
                        }
                        if (e.target.closest('[data-bp-apply]')) { this.applyCloudBackup(); return; }
                    });
                    // 搜索只重画列表（不重建输入框），否则每敲一个字就丢焦点
                    modal.addEventListener('input', (e) => {
                        if (e.target.matches && e.target.matches('[data-bp-search]')) {
                            this._bpState.query = e.target.value.trim();
                            this._bpState.shown = 150;
                            this._renderBackupList();
                        }
                    });
                    return modal;
                },

                /** 打开某份备份的恢复预览 */
                async previewCloudBackup(id) {
                    const modal = this._ensureBackupPreviewModal();
                    const body = modal.querySelector('[data-bp-body]');
                    const footer = modal.querySelector('[data-bp-footer]');
                    modal.querySelector('[data-bp-title]').textContent = App.t('恢复预览');
                    modal.querySelector('[data-bp-subtitle]').textContent = '';
                    body.innerHTML = '<div class="text-[var(--sub)] italic text-center py-10">' + App.t('正在读取备份…') + '</div>';
                    footer.innerHTML = '';
                    this._showModalEl(modal);
                    let data;
                    try {
                        const token = await App.auth.getToken();
                        const res = await fetch(App.apiBase + '/api/user-backups?id=' + id, { headers: { Authorization: 'Bearer ' + token } });
                        data = await res.json().catch(() => ({}));
                        if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to load backup');
                    } catch (e) {
                        body.innerHTML = '<div class="text-red-500 text-center py-10">' + App.utils.escapeHTML(String(e.message || e)) + '</div>';
                        return;
                    }
                    this._renderBackupPreview(App.data.diffCloudBackup(data.type, data.payload), data);
                },

                _renderBackupPreview(diff, data) {
                    const modal = document.getElementById('modal-backup-preview');
                    if (!modal) return;
                    const body = modal.querySelector('[data-bp-body]');
                    const footer = modal.querySelector('[data-bp-footer]');
                    const esc = App.utils.escapeHTML;
                    const isBank = diff.type === 'bank';
                    const typeName = isBank ? App.t('题库') : App.t('刷题记录');

                    let dt = '';
                    if (data && data.createdAt) {
                        const d = new Date(String(data.createdAt).replace(' ', 'T') + 'Z');
                        const pad = (n) => String(n).padStart(2, '0');
                        dt = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
                    }
                    const sizeKB = (data && data.payload) ? Math.max(1, Math.round(JSON.stringify(data.payload).length / 1024)) : 0;

                    modal.querySelector('[data-bp-title]').textContent = App.t('恢复预览') + ' / ' + typeName;
                    modal.querySelector('[data-bp-subtitle]').textContent =
                        (dt ? App.t('备份时间') + ' ' + dt + ' / ' : '') + sizeKB + ' KB / ' + App.t('覆盖式恢复（不是合并）');

                    this._bpState = { diff, data, filter: 'changed', query: '', shown: 150, applying: false };

                    const c = diff.counts;
                    const tones = {
                        added: 'border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400',
                        removed: 'border-red-200 dark:border-red-900 bg-red-50/60 dark:bg-red-950/20 text-red-600 dark:text-red-400',
                        changed: 'border-primary-100 dark:border-primary-700 bg-primary-50/60 dark:bg-primary-700/20 text-primary-600 dark:text-primary-500',
                        same: 'border-[var(--border)] bg-[var(--bg)] text-[var(--sub)]'
                    };
                    const card = (label, n, tone) => '<div class="anim-fade-in rounded-xl border px-3 py-2 ' + tone + '">' +
                        '<div class="text-[10px] text-[var(--sub)]">' + label + '</div>' +
                        '<div class="text-lg font-bold">' + n + '</div></div>';
                    const summary = '<div class="grid grid-cols-2 sm:grid-cols-4 gap-2">' +
                        card(App.t('新增'), c.added, tones.added) +
                        card(App.t('删除'), c.removed, tones.removed) +
                        card(App.t('修改'), c.changed + (c.moved || 0), tones.changed) +
                        card(App.t('不变'), c.same, tones.same) +
                        '</div>';

                    let overview;
                    if (isBank) {
                        // 占位符刻意各用不同字母：`.replace('S2')` 会被 `.replace('S')` 抢先命中，
                        // 所以不写成 S / S2 这种可前缀嵌套的形式
                        overview = App.t('当前 N 题（S 个科目 / H 个章节） → 恢复后 M 题（P 个科目 / Q 个章节）')
                            .replace('N', diff.curTotal).replace('S', diff.curGroups.subjects).replace('H', diff.curGroups.chapters)
                            .replace('M', diff.bakTotal).replace('P', diff.bakGroups.subjects).replace('Q', diff.bakGroups.chapters);
                    } else {
                        overview = App.t('当前 N 条记录 → 恢复后 M 条记录')
                            .replace('N', diff.curTotal).replace('M', diff.bakTotal) +
                            '<br>' + App.t('最后练习时间：A → B')
                                .replace('A', this._bpTime(diff.curLast)).replace('B', this._bpTime(diff.bakLast));
                    }
                    if (diff.invalid) overview += '<br>' + App.t('备份里有 R 条记录格式非法，恢复时会被丢弃。').replace('R', diff.invalid);

                    const chipCls = (on) => 'px-2.5 py-1 rounded-full border text-[10px] font-bold transition-all active:scale-95 ' +
                        (on ? 'bg-primary-600 text-white border-primary-600 shadow-sm' : 'border-[var(--border)] text-[var(--sub)] hover:bg-[var(--bg)]');
                    const FILTERS = [
                        ['changed', App.t('仅变化')],
                        ['added', App.t('新增')],
                        ['removed', App.t('删除')],
                        ['modified', App.t('修改')],
                        ['all', App.t('全部')]
                    ];
                    const toolbar = '<div class="flex flex-wrap items-center gap-2">' +
                        '<div class="flex flex-wrap gap-1.5">' +
                        FILTERS.map(([k, label]) => '<button data-bp-filter="' + k + '" class="' + chipCls(k === 'changed') + '">' + label + '</button>').join('') +
                        '</div>' +
                        '<input data-bp-search type="search" placeholder="' + App.t('搜索题号 / 题干…') + '" ' +
                        'class="ml-auto w-full sm:w-56 bg-[var(--card)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-[11px] outline-none focus:border-primary-500 transition-colors">' +
                        '</div>';

                    body.innerHTML =
                        summary +
                        '<div class="anim-fade-in rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--sub)]">' + overview + '</div>' +
                        toolbar +
                        '<div class="text-[10px] text-[var(--sub)]" data-bp-listmeta></div>' +
                        '<div class="space-y-1.5" data-bp-list></div>';
                    this._renderBackupList();

                    const changedCount = c.added + c.removed + c.changed + (c.moved || 0);
                    footer.innerHTML =
                        '<div class="text-[10px] text-[var(--sub)] leading-relaxed flex-1 min-w-[220px]">' +
                        (changedCount
                            ? App.t('将用这份备份完整覆盖当前数据。恢复前会自动把当前状态另存一份云端备份，可再恢复回来。')
                            : App.t('这份备份与当前数据完全一致，无需恢复。')) +
                        '</div>' +
                        '<div class="flex items-center gap-2">' +
                        '<button data-bp-close class="px-3 py-2 rounded-lg border border-[var(--border)] text-[11px] font-bold text-[var(--text)] hover:bg-[var(--bg)] transition-all">' + App.t('取消') + '</button>' +
                        '<button data-bp-apply class="px-4 py-2 rounded-lg bg-primary-600 text-white text-[11px] font-bold hover:bg-primary-700 active:scale-95 transition-all shadow-sm' +
                        (changedCount ? '' : ' opacity-50 pointer-events-none') + '">' + App.t('确认覆盖恢复') + '</button>' +
                        '</div>';
                },

                /** 只重画「筛选 chip 状态 + 列表 + 计数」，不动工具栏（避免搜索框丢焦点） */
                _renderBackupList() {
                    const modal = document.getElementById('modal-backup-preview');
                    const st = this._bpState;
                    if (!modal || !st) return;
                    const listEl = modal.querySelector('[data-bp-list]');
                    const metaEl = modal.querySelector('[data-bp-listmeta]');
                    const chipOn = 'px-2.5 py-1 rounded-full border text-[10px] font-bold transition-all active:scale-95 bg-primary-600 text-white border-primary-600 shadow-sm';
                    const chipOff = 'px-2.5 py-1 rounded-full border text-[10px] font-bold transition-all active:scale-95 border-[var(--border)] text-[var(--sub)] hover:bg-[var(--bg)]';
                    modal.querySelectorAll('[data-bp-filter]').forEach((b) => {
                        b.className = (b.dataset.bpFilter === st.filter) ? chipOn : chipOff;
                    });
                    const items = st.diff.items.filter((it) => this._bpMatch(it, st.filter, st.query));
                    const shown = items.slice(0, st.shown);
                    listEl.innerHTML = shown.map((it, i) => this._bpRow(it, st.diff.type, i)).join('') ||
                        '<div class="text-[var(--sub)] italic text-center py-8">' + App.t('没有符合条件的差异项。') + '</div>';
                    metaEl.textContent = App.t('显示 N / M 项').replace('N', shown.length).replace('M', items.length);
                    if (items.length > shown.length) {
                        listEl.insertAdjacentHTML('beforeend',
                            '<button data-bp-more class="w-full px-3 py-2 rounded-xl border border-dashed border-[var(--border)] text-[11px] font-bold text-[var(--sub)] hover:bg-[var(--bg)] transition-all">' +
                            App.t('显示更多（还有 R 项）').replace('R', items.length - shown.length) + '</button>');
                    }
                },

                _bpMatch(it, filter, query) {
                    if (filter === 'changed' && it.kind === 'same') return false;
                    if (filter === 'added' && it.kind !== 'added') return false;
                    if (filter === 'removed' && it.kind !== 'removed') return false;
                    if (filter === 'modified' && it.kind !== 'changed' && it.kind !== 'moved') return false;
                    if (!query) return true;
                    const q = query.toLowerCase();
                    const parts = [
                        it.id, it.key,
                        it.to && it.to.sub, it.to && it.to.chap, it.to && it.to.q && it.to.q.id, it.to && it.to.q && it.to.q.q,
                        it.from && it.from.sub, it.from && it.from.chap, it.from && it.from.q && it.from.q.q,
                        it.to && it.to.id, it.from && it.from.id
                    ].filter(Boolean).join(' ');
                    return parts.toLowerCase().indexOf(q) > -1;
                },

                _bpRow(it, type, idx) {
                    const esc = App.utils.escapeHTML;
                    const k = this._bpKindStyle[it.kind] || this._bpKindStyle.same;
                    // 逐条错开一点点延迟，列表出现时是「一条条落下来」而不是整体闪一下
                    const delay = ' style="animation-delay:' + Math.min(idx * 12, 260) + 'ms"';
                    const chip = '<span class="flex-shrink-0 px-1.5 py-0.5 rounded border text-[9px] font-bold ' + k.chip + '">' + k.label + '</span>';
                    if (type === 'bank') {
                        const q = (it.to && it.to.q) || (it.from && it.from.q) || {};
                        const loc = it.to ? (it.to.sub + ' / ' + it.to.chap) : (it.from.sub + ' / ' + it.from.chap);
                        const moveNote = (it.kind === 'moved')
                            ? '<div class="text-[10px] text-[var(--sub)]">' + esc(it.from.sub + ' / ' + it.from.chap) + ' → ' + esc(it.to.sub + ' / ' + it.to.chap) + '</div>'
                            : '';
                        const fields = (it.fields || []).map((f) =>
                            '<div class="text-[10px] leading-relaxed">' +
                            '<span class="text-[var(--sub)]">' + esc(this._bpFieldLabel(f.field)) + '</span> ' +
                            '<span class="text-red-500 line-through">' + this._bpShort(f.from, 46) + '</span> ' +
                            '<span class="text-[var(--sub)]">→</span> ' +
                            '<span class="text-emerald-600 dark:text-emerald-400">' + this._bpShort(f.to, 46) + '</span>' +
                            '</div>').join('');
                        return '<div class="anim-fade-in flex items-start gap-2 px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--card)]"' + delay + '>' +
                            chip +
                            '<div class="min-w-0 flex-1">' +
                            '<div class="text-[11px] text-[var(--text)] leading-relaxed">' + this._bpShort(q.q, 120) + '</div>' +
                            '<div class="text-[10px] text-[var(--sub)] mt-0.5">' + esc(loc) + '</div>' +
                            moveNote + fields +
                            '</div></div>';
                    }
                    const rec = it.to || it.from || {};
                    const okWord = App.t('正确');
                    const errWord = App.t('错误');
                    const resTxt = (it.kind === 'changed')
                        ? ((it.from && it.from.r) ? okWord : errWord) + ' → ' + ((it.to && it.to.r) ? okWord : errWord)
                        : (rec.r ? okWord : errWord);
                    const resCls = (it.kind === 'changed')
                        ? 'text-amber-600 dark:text-amber-400'
                        : (rec.r ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500');
                    return '<div class="anim-fade-in flex items-center gap-2 px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--card)]"' + delay + '>' +
                        chip +
                        '<div class="min-w-0 flex-1">' +
                        '<div class="text-[11px] font-mono text-[var(--text)] truncate">' + esc(String(rec.id || it.key || '')) + '</div>' +
                        '<div class="text-[10px] text-[var(--sub)]">' + this._bpTime(rec.t) + '</div>' +
                        '</div>' +
                        '<span class="flex-shrink-0 text-[11px] font-bold ' + resCls + '">' + resTxt + '</span>' +
                        '</div>';
                },

                /** 确认后：先给当前状态存一份云端备份，再整份覆盖 */
                async applyCloudBackup() {
                    const st = this._bpState;
                    if (!st || st.applying) return;
                    const diff = st.diff;
                    const btn = document.querySelector('[data-bp-apply]');
                    st.applying = true;
                    if (btn) {
                        btn.classList.add('opacity-60', 'pointer-events-none');
                        btn.textContent = App.t('恢复中…');
                    }
                    try {
                        const okBk = await App.data._backupCurrentState(diff.type);
                        if (!okBk) throw new Error(App.t('无法先把当前状态备份到云端'));
                        const res = App.data.restoreCloudBackup(diff.type, st.data.payload);
                        this.closeModal('backup-preview');
                        this.closeModal('cloud-backups');
                        if (window.App && App.router && typeof App.router.refresh === 'function') App.router.refresh();
                        const msg = (diff.type === 'bank')
                            ? App.t('已恢复题库：N 题 / S 个科目').replace('N', res.questions).replace('S', res.subjects)
                            : App.t('已恢复刷题记录：N 条').replace('N', res.records);
                        if (typeof showGlobalToast === 'function') showGlobalToast(msg, 'success');
                        if (window.App && App.sync && typeof App.sync.showSyncStatus === 'function') {
                            App.sync.showSyncStatus('success', 0, msg);
                        }
                    } catch (e) {
                        st.applying = false;
                        if (btn) {
                            btn.classList.remove('opacity-60', 'pointer-events-none');
                            btn.textContent = App.t('确认覆盖恢复');
                        }
                        if (typeof showGlobalError === 'function') showGlobalError(App.t('恢复失败：') + String(e && e.message || e), true);
                    }
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
                                const actionEl = e.target.closest('[data-action]');
                                if (!actionEl || actionEl.disabled) return;
                                const action = actionEl.dataset.action;
                                const sub = actionEl.dataset.sub ? decodeURIComponent(actionEl.dataset.sub) : '';
                                if (!sub) return;
                                if (action === 'select-sub') {
                                    this._bankMgrCurrentSubject = sub;
                                    this.renderBankManager();
                                } else if (action === 'move-sub-up') {
                                    e.stopPropagation();
                                    App.data.moveSubject(sub, -1);
                                } else if (action === 'move-sub-down') {
                                    e.stopPropagation();
                                    App.data.moveSubject(sub, 1);
                                } else if (action === 'view-questions') {
                                    e.stopPropagation();
                                    if (window.App && App.views && App.views.library) {
                                        App.views.library._pendingFilterSub = sub;
                                        App.views.library._pendingFilterChap = 'all';
                                    }
                                    const filter = App.dom.get('lib-filter');
                                    if (filter) filter.value = sub;
                                    const chapFilter = App.dom.get('lib-chapter');
                                    if (chapFilter) chapFilter.value = 'all';
                                    App.router.go('library');
                                    this.closeBankManager();
                                } else if (action === 'rename-sub') {
                                    e.stopPropagation();
                                    App.data.renameSubjectInteractive(sub);
                                } else if (action === 'delete-sub') {
                                    e.stopPropagation();
                                    App.data.deleteSubjectInteractive(sub);
                                }
                            });
                        }
                        if (chapList) {
                            chapList.addEventListener('click', (e) => {
                                const btn = e.target.closest('button[data-action]');
                                if (!btn || btn.disabled) return;
                                const action = btn.dataset.action;
                                const sub = btn.dataset.sub ? decodeURIComponent(btn.dataset.sub) : '';
                                const chap = btn.dataset.chap ? decodeURIComponent(btn.dataset.chap) : '';
                                if (action === 'sort-chaps' && sub) {
                                    App.data.sortChaptersNaturally(sub);
                                    return;
                                }
                                if (!sub || !chap) return;
                                if (action === 'move-chap-up') {
                                    App.data.moveChapter(sub, chap, -1);
                                } else if (action === 'move-chap-down') {
                                    App.data.moveChapter(sub, chap, 1);
                                } else if (action === 'view-chap-questions') {
                                    if (window.App && App.views && App.views.library) {
                                        App.views.library._pendingFilterSub = sub;
                                        App.views.library._pendingFilterChap = chap;
                                    }
                                    const filter = App.dom.get('lib-filter');
                                    if (filter) filter.value = sub;
                                    const chapFilter = App.dom.get('lib-chapter');
                                    if (chapFilter) chapFilter.value = chap;
                                    App.router.go('library');
                                    this.closeBankManager();
                                } else if (action === 'rename-chap') {
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
                    this._showModalEl(modal);
                },

                closeBankManager() {
                    const modal = App.dom.get('modal-bank-manager');
                    if (!modal) return;
                    this._hideModalEl(modal);
                },

                renderBankManager() {
                    const subList = App.dom.get('bank-manager-subject-list');
                    const chapList = App.dom.get('bank-manager-chapter-list');
                    const currentLabel = App.dom.get('bank-manager-current-subject');
                    if (!subList || !chapList || !currentLabel) return;
                    const subjects = App.data.getSubjects();
                    if (!subjects.length) {
                        subList.innerHTML = '<div class="text-[11px] text-[var(--sub)] py-4 text-center">' + App.t('当前没有科目，请先导入或新增题目。') + '</div>';
                        chapList.innerHTML = '<div class="text-[11px] text-[var(--sub)] py-4 text-center">' + App.t('暂无章节。') + '</div>';
                        currentLabel.textContent = '';
                        return;
                    }
                    const current = this._bankMgrCurrentSubject && subjects.indexOf(this._bankMgrCurrentSubject) !== -1
                        ? this._bankMgrCurrentSubject
                        : subjects[0];
                    this._bankMgrCurrentSubject = current;
                    currentLabel.textContent = current;
                    let subHtml = '';
                    subjects.forEach((sub, sIdx) => {
                        const chaps = App.data.getChapters(sub);
                        const total = chaps.reduce((n, chap) => {
                            const arr = App.data.bank[sub] && App.data.bank[sub][chap];
                            return n + (Array.isArray(arr) ? arr.length : 0);
                        }, 0);
                        const activeClass = sub === current
                            ? 'border-primary-400 dark:border-primary-600 bg-primary-50/70 dark:bg-primary-950/30'
                            : 'border-[var(--border)] bg-[var(--card)]';
                        const subEnc = encodeURIComponent(sub);
                        const upDis = sIdx === 0 ? 'disabled' : '';
                        const downDis = sIdx === subjects.length - 1 ? 'disabled' : '';
                        const upSvg = '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7"/></svg>';
                        const downSvg = '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>';
                        const subMoveBtns = subjects.length > 1
                            ? `<span class="inline-flex flex-col gap-0.5 flex-shrink-0 mr-1">`
                                + `<button type="button" data-action="move-sub-up" data-sub="${subEnc}" ${upDis} title="${App.t('上移科目')}" class="w-5 h-4 rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--sub)] hover:text-primary-600 disabled:opacity-30 disabled:pointer-events-none inline-flex items-center justify-center leading-none">${upSvg}</button>`
                                + `<button type="button" data-action="move-sub-down" data-sub="${subEnc}" ${downDis} title="${App.t('下移科目')}" class="w-5 h-4 rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--sub)] hover:text-primary-600 disabled:opacity-30 disabled:pointer-events-none inline-flex items-center justify-center leading-none">${downSvg}</button>`
                                + `</span>`
                            : '';
                        subHtml += `
                            <div data-action="select-sub" data-sub="${subEnc}" class="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border ${activeClass} cursor-pointer hover:border-primary-400 dark:hover:border-primary-700 transition-colors">
                                <div class="flex items-center min-w-0 flex-1">
                                    ${subMoveBtns}
                                    <div class="flex flex-col min-w-0 flex-1">
                                        <span class="text-[11px] font-bold text-[var(--text)] break-words leading-snug">${App.utils.escapeHTML(sub)}</span>
                                        <span class="text-[11px] text-[var(--sub)] mt-0.5">${App.i18n.lang === 'en' ? `${chaps.length} ch / ${total} q` : `${chaps.length} 章节 / ${total} 题`}</span>
                                    </div>
                                </div>
                                <div class="flex items-center gap-1 flex-shrink-0">
                                    <button type="button" data-action="view-questions" data-sub="${subEnc}" class="px-2 py-1 rounded-lg text-[11px] border border-primary-200 text-primary-600 bg-primary-50 hover:bg-primary-100 dark:bg-primary-950/30 dark:text-primary-400 dark:border-primary-900 transition-colors font-bold whitespace-nowrap">${App.t('查看')}</button>
                                    <button type="button" data-action="rename-sub" data-sub="${subEnc}" class="px-2 py-1 rounded-lg text-[11px] border border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900 transition-colors whitespace-nowrap">${App.t('重命名')}</button>
                                    <button type="button" data-action="delete-sub" data-sub="${subEnc}" class="px-2 py-1 rounded-lg text-[11px] border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900 transition-colors whitespace-nowrap">${App.t('删除')}</button>
                                </div>
                            </div>
                        `;
                    });
                    subList.innerHTML = subHtml;

                    const chapters = App.data.getChapters(current);
                    if (!chapters.length) {
                        chapList.innerHTML = '<div class="text-[11px] text-[var(--sub)] py-4 text-center">' + App.t('该科目暂无章节。') + '</div>';
                        return;
                    }
                    const isEn = window.App && App.i18n && App.i18n.lang === 'en';
                    const subEncCur = encodeURIComponent(current);
                    const upChapSvg = '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7"/></svg>';
                    const downChapSvg = '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>';
                    const warnChapSvg = '<svg class="w-3.5 h-3.5 inline-block mr-1 -mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>';
                    let chapHtml = '';
                    if (App.utils && typeof App.utils.isChapterListOutOfOrder === 'function' && App.utils.isChapterListOutOfOrder(chapters)) {
                        chapHtml += `
                            <div class="px-3 py-2 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 flex items-center justify-between gap-2 text-[11px]">
                                <span class="truncate inline-flex items-center">${warnChapSvg}${isEn ? 'Chapters appear out of numerical order' : '检测到章节顺序可能乱序'}</span>
                                <button type="button" data-action="sort-chaps" data-sub="${subEncCur}" class="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold flex-shrink-0 whitespace-nowrap active:scale-95 transition-all">${isEn ? 'Auto-sort' : '一键按章节号排好'}</button>
                            </div>
                        `;
                    }
                    chapters.forEach((chap, cIdx) => {
                        const arr = App.data.bank[current] && App.data.bank[current][chap];
                        const count = Array.isArray(arr) ? arr.length : 0;
                        const chapEnc = encodeURIComponent(chap);
                        const upDis = cIdx === 0 ? 'disabled' : '';
                        const downDis = cIdx === chapters.length - 1 ? 'disabled' : '';
                        const chapMoveBtns = chapters.length > 1
                            ? `<span class="inline-flex flex-col gap-0.5 flex-shrink-0 mr-1.5">`
                                + `<button type="button" data-action="move-chap-up" data-sub="${subEncCur}" data-chap="${chapEnc}" ${upDis} title="${App.t('上移章节')}" class="w-5 h-4 rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--sub)] hover:text-primary-600 disabled:opacity-30 disabled:pointer-events-none inline-flex items-center justify-center leading-none">${upChapSvg}</button>`
                                + `<button type="button" data-action="move-chap-down" data-sub="${subEncCur}" data-chap="${chapEnc}" ${downDis} title="${App.t('下移章节')}" class="w-5 h-4 rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--sub)] hover:text-primary-600 disabled:opacity-30 disabled:pointer-events-none inline-flex items-center justify-center leading-none">${downChapSvg}</button>`
                                + `</span>`
                            : '';
                        chapHtml += `
                            <div class="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--card)]">
                                <div class="flex items-center min-w-0 flex-1">
                                    ${chapMoveBtns}
                                    <div class="flex flex-col min-w-0 flex-1">
                                        <span class="text-[11px] font-bold text-[var(--text)] break-words leading-snug">${App.utils.escapeHTML(chap)}</span>
                                        <span class="text-[11px] text-[var(--sub)] mt-0.5">${isEn ? count + ' q' : count + ' 题'}</span>
                                    </div>
                                </div>
                                <div class="flex items-center gap-1 flex-shrink-0">
                                    <button type="button" data-action="view-chap-questions" data-sub="${subEncCur}" data-chap="${chapEnc}" class="px-2 py-1 rounded-lg text-[11px] border border-primary-200 text-primary-600 bg-primary-50 hover:bg-primary-100 dark:bg-primary-950/30 dark:text-primary-400 dark:border-primary-900 font-bold whitespace-nowrap">${App.t('查看')}</button>
                                    <button type="button" data-action="rename-chap" data-sub="${subEncCur}" data-chap="${chapEnc}" class="px-2 py-1 rounded-lg text-[11px] border border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900 whitespace-nowrap">${App.t('重命名')}</button>
                                    <button type="button" data-action="delete-chap" data-sub="${subEncCur}" data-chap="${chapEnc}" class="px-2 py-1 rounded-lg text-[11px] border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900 whitespace-nowrap">${App.t('删除')}</button>
                                </div>
                            </div>
                        `;
                    });
                    chapList.innerHTML = chapHtml;
                },

                _bankMgrBound: false,
                _bankMgrCurrentSubject: ''
            
};