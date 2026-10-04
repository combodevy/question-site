export const ui = {

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
                                alert('请拖入 .json 或 .txt 题库文件。');
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
                            // 恢复上次选的题型 / 题数（记住选择，不用每次重选）
                            this.restoreSelectChoice('smart-type', 'all');
                            this.restoreSelectChoice('smart-limit', '20');
                        }
                        this._showModalEl(el);
                    } else {
                        this.closeModal(id);
                    }
                },

                closeModal(id) {
                    const el = App.dom.get(`modal-${id}`);
                    if (el && !el.classList.contains('hidden')) {
                        this._hideModalEl(el);
                    }
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

                openImportCenter() {
                    // 重置上一次的预览状态：否则重开弹窗时状态栏写着「尚未选择文件」，
                    // 下面却还挂着上一次的科目结构与题目预览，文案与内容自相矛盾
                    this._jsonImportPreview = null;
                    this._jsonImportPreviewCount = 0;
                    this._jsonImportIdStats = null;
                    const applyBtn = App.dom.get('import-json-apply-btn');
                    if (applyBtn) applyBtn.disabled = true;
                    // 重置按钮文案与结果横幅：上次可能停在「已导入 ✓」或失败横幅
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
                    if (statusEl) statusEl.textContent = '尚未选择文件';
                    this.toggleModal('import-center');
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
                    if (structEl) structEl.innerHTML = '<div class="text-[11px] text-[var(--sub)] italic">正在解析文件…</div>';
                    if (listEl) listEl.innerHTML = '<div class="text-[11px] text-[var(--sub)] italic">正在解析文件…</div>';
                    if (statusEl) statusEl.textContent = `正在读取文件：${file.name}`;

                    if (file.size > 5 * 1024 * 1024) {
                        alert("文件过大，请上传 5MB 以内的题库文件。");
                        e.target.value = null;
                        if (statusEl) statusEl.textContent = "文件过大，已取消解析。";
                        this._setImportBanner('error', '<b>文件过大</b>（' + Math.round(file.size / 1024 / 1024 * 10) / 10 + 'MB）。请上传 5MB 以内的题库文件。');
                        this._setApplyBtn('ready');
                        { const ab = App.dom.get('import-json-apply-btn'); if (ab) ab.disabled = true; }
                        return;
                    }

                    const reader = new FileReader();
                    reader.onload = (event) => {
                        try {
                            const text = event.target.result;
                            // AI 生成的题库 JSON 常带 ```json 围栏或前后说明文字，宽容解析
                            let parsed = this._parseLooseJson(text);
                            if (parsed === null) {
                                if (statusEl) statusEl.textContent = "JSON 解析失败：未找到有效的 JSON 内容。";
                                if (structEl) structEl.innerHTML = '<div class="text-[11px] text-[var(--sub)] italic">JSON 解析失败，无法预览。</div>';
                                if (listEl) listEl.innerHTML = '<div class="text-[11px] text-[var(--sub)] italic">JSON 解析失败，无法预览。</div>';
                                // 清掉旧文件的预览，防止用户误导入上一个文件的内容
                                this._jsonImportPreview = null;
                                this._jsonImportPreviewCount = 0;
                                this._setImportBanner('error', '<b>JSON 解析失败：</b>文件里没有找到有效的 JSON 内容。'
                                    + '<br>如果是 AI 生成的结果，请确认复制的是完整 JSON（本系统也兼容带 markdown 代码块或前后说明文字的内容）。');
                                this._setApplyBtn('ready');
                                { const ab = App.dom.get('import-json-apply-btn'); if (ab) ab.disabled = true; }
                                return;
                            }

                            // 先清洗（会自动改写重复/缺失的题目 ID）再做结构校验，
                            // 保证预览数量与实际导入数量一致
                            const idStats = {};
                            const sanitized = (window.App && App.utils && typeof App.utils.sanitizeImportedBank === 'function')
                                ? App.utils.sanitizeImportedBank(parsed, idStats)
                                : parsed;

                            const check = App.data.validateSchema(sanitized);
                            if (check !== true) {
                                if (statusEl) statusEl.textContent = "结构校验失败：" + check;
                                if (structEl) structEl.innerHTML = '<div class="text-[11px] text-[var(--sub)] italic">结构校验失败，请根据模板调整 JSON。</div>';
                                if (listEl) listEl.innerHTML = '<div class="text-[11px] text-[var(--sub)] italic">结构校验失败，无法生成预览。</div>';
                                this._jsonImportPreview = null;
                                this._jsonImportPreviewCount = 0;
                                this._setImportBanner('error', '<b>结构校验失败：</b>' + App.utils.escapeHTML(String(check))
                                    + '<br>请对照「下载格式模板」调整 JSON 后重新选择文件。');
                                this._setApplyBtn('ready');
                                { const ab = App.dom.get('import-json-apply-btn'); if (ab) ab.disabled = true; }
                                return;
                            }
                            App.ui._jsonImportIdStats = idStats;

                            const r = App.ui._renderJsonPreviewData(sanitized);
                            App.ui._jsonImportPreview = sanitized;

                            if (statusEl) {
                                const fixNote = (App.ui._jsonImportIdStats && App.ui._jsonImportIdStats.fixedIds)
                                    ? `，已自动改写 ${App.ui._jsonImportIdStats.fixedIds} 个重复或缺失的题目 ID`
                                    : '';
                                statusEl.textContent = r.total
                                    ? `解析成功：检测到 ${r.total} 道题（科目 ${r.subjCount} 个，章节 ${r.chapCount} 个${fixNote}）。`
                                    : "解析完成，但未检测到任何符合条件的题目。";
                            }
                            // 解析结果反馈到横幅，并明确下一步动作
                            if (r.total) {
                                this._setImportBanner('info', `解析成功：检测到 <b>${r.total}</b> 道题（科目 ${r.subjCount} 个、章节 ${r.chapCount} 个）。`
                                    + '<br>请在下方预览确认科目/章节归属，然后点击右下角「导入预览中的题目」。');
                                this._setApplyBtn('ready');
                            } else {
                                this._setImportBanner('error', '解析完成，但<b>未检测到任何符合条件的题目</b>（单选/多选/判断/填空）。'
                                    + '<br>请检查 JSON 内容——问答题等主观题会被自动忽略。');
                                this._setApplyBtn('ready');
                                { const ab = App.dom.get('import-json-apply-btn'); if (ab) ab.disabled = true; }
                            }
                        } finally {
                            e.target.value = null;
                        }
                    };
                    reader.onerror = () => {
                        if (statusEl) statusEl.textContent = "文件读取失败。";
                        e.target.value = null;
                    };
                    reader.readAsText(file, 'UTF-8');
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

                    const structEl = App.dom.get('import-json-struct');
                    if (structEl) {
                        if (!total) {
                            structEl.innerHTML = '<div class="text-[11px] text-[var(--sub)] italic">未检测到任何单选 / 多选 / 判断题。</div>';
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
                                        <div class="flex items-center gap-2 text-[11px]">
                                            <span class="truncate flex-1">${App.utils.escapeHTML(chap)}</span>
                                            <span class="text-[var(--sub)]">${chapTotal} 题 · 单选 ${cMcq} · 多选 ${cMulti} · 判断 ${cTf}</span>
                                        </div>
                                    `);
                                }
                                blocks.push(`
                                    <div class="mb-2 last:mb-0">
                                        <div class="flex items-center justify-between mb-1">
                                            <div class="text-[11px] font-bold text-[var(--text)]">${App.utils.escapeHTML(sub)}</div>
                                            <div class="text-[11px] text-[var(--sub)]">${subTotal} 题</div>
                                        </div>
                                        <div class="space-y-0.5">${rows.join('')}</div>
                                    </div>
                                `);
                            }
                            structEl.innerHTML = blocks.join('') || '<div class="text-[11px] text-[var(--sub)] italic">未检测到任何题目。</div>';
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
                // 导入按钮状态机：busy（转圈+禁用）/ done（已导入✓+禁用）/ ready（可点）
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
                        btn.innerHTML = '<span>已导入 ✓</span>';
                        btn.classList.remove('opacity-80', 'cursor-wait');
                    } else {
                        btn.disabled = false;
                        if (btn.dataset.originalHtml) { btn.innerHTML = btn.dataset.originalHtml; delete btn.dataset.originalHtml; }
                        btn.classList.remove('opacity-80', 'cursor-wait');
                    }
                },

                async applyJsonPreviewImport() {
                    const data = App.ui._jsonImportPreview;
                    const count = App.ui._jsonImportPreviewCount || 0;
                    const statusEl = App.dom.get('import-json-status');
                    const applyBtn = App.dom.get('import-json-apply-btn');
                    if (!data || !count) {
                        alert("请先选择 JSON 文件并完成预览解析。");
                        return;
                    }
                    const ok = confirm(`即将根据预览结果导入约 ${count} 道题到当前题库，是否继续？`);
                    if (!ok) {
                        if (statusEl) statusEl.textContent = "已取消导入操作。";
                        this._setImportBanner('info', '已取消导入操作。文件预览仍保留，可随时重新点击导入。');
                        return;
                    }
                    // 整个导入流程包在 try/catch 里：任何意外异常都必须落到
                    // 「红色横幅 + 按钮恢复」的出口，绝不能让按钮灰死且无提示。
                    try {
                        // 导入是同步计算，大题库会阻塞界面；先让状态文字和 spinner 渲染出来再执行
                        if (statusEl) statusEl.textContent = "正在导入题库…";
                        this._setImportBanner('busy', `正在导入约 <b>${count}</b> 道题到本地题库…<br><span class="opacity-75">题库很大时这一步可能需要几秒，请不要关闭窗口。</span>`);
                        this._setApplyBtn('busy');
                        await new Promise(r => setTimeout(r, 30));
                        const report = App.data.importBank(JSON.stringify(data));
                        if (!report) {
                            // importBank 内部已 alert 具体原因；横幅给出失败状态
                            this._setImportBanner('error', '<b>导入失败。</b>具体原因见弹窗提示，修正 JSON 后可直接点击「重试导入」。本地题库未受影响。');
                            this._setApplyBtn('ready');
                            if (statusEl) statusEl.textContent = "导入失败";
                            return;
                        }
                        this._importSummary = `导入完成：新增 <b>${report.added}</b> 道、更新 <b>${report.updated}</b> 道`
                            + (report.moved ? `、移动到新章节 <b>${report.moved}</b> 道` : '')
                            + `、内容相同跳过 <b>${report.skippedSame}</b> 道。`
                            + (report.fixedIds ? `<br>已自动改写 <b>${report.fixedIds}</b> 个重复/缺失的题目 ID。` : '');
                        this._setImportBanner('busy', this._importSummary
                            + '<br><span class="opacity-75">正在同步到云端…</span>');
                        this._setApplyBtn('done');
                        if (statusEl) {
                            statusEl.textContent = `导入完成：新增 ${report.added} 道、更新 ${report.updated} 道`;
                        }
                        // 导入必然触发云端保存（防抖 400ms）；监视保存结果并反馈
                        this._watchImportSave();
                        // 立即刷新底层视图：弹窗后面如果是首页/题库页，统计数字和列表马上反映新题
                        if (window.App && App.router && typeof App.router.refresh === 'function') {
                            App.router.refresh();
                        }
                    } catch (e) {
                        console.error('导入流程异常', e);
                        this._setImportBanner('error', '<b>导入过程出现异常：</b>' + App.utils.escapeHTML(String(e && e.message || e))
                            + '<br>本地题库已回滚到导入前状态。请检查 JSON 后重试，或先「导出全部题库」备份。');
                        this._setApplyBtn('ready');
                        if (statusEl) statusEl.textContent = "导入异常";
                    }
                },

                // 导入后监视云端保存：横幅实时反映「同步中 → 已同步 / 同步失败」，
                // 数据本身始终已安全落在本机（IndexedDB），失败只影响云端副本
                _watchImportSave() {
                    if (this._importSaveWatch) clearTimeout(this._importSaveWatch);
                    let elapsed = 0;
                    const tick = () => {
                        const sync = window.App && App.sync ? App.sync : null;
                        const status = sync ? sync._lastStatus : 'success';
                        elapsed += 500;
                        if (status === 'error') {
                            this._setImportBanner('error', (this._importSummary || '导入完成。')
                                + '<br><b>云端同步失败</b>——数据已安全保存在本机，不会丢失。'
                                + '点击右上角同步状态按钮可查看详情并重试。');
                            this._importSaveWatch = null;
                            return;
                        }
                        if (status === 'pending' && elapsed < 20000) {
                            if (elapsed % 2000 === 0) {
                                this._setImportBanner('busy', (this._importSummary || '导入完成。')
                                    + `<br><span class="opacity-75">正在同步到云端… ${Math.round(elapsed / 1000)}s</span>`);
                            }
                            this._importSaveWatch = setTimeout(tick, 500);
                            return;
                        }
                        if (status === 'success' && !App.data._bankDirty) {
                            this._setImportBanner('success', (this._importSummary || '导入完成。')
                                + '<br><b>已同步到云端 ✓</b> 本地与云端的题库现在完全一致，可以关闭此窗口开始刷题了。');
                        } else {
                            this._setImportBanner('success', (this._importSummary || '导入完成。')
                                + '<br>数据已保存在本机；云端将在下次联网时自动同步。');
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
                        createdEl.textContent = m ? `注册于 ${m[1]} 年 ${parseInt(m[2], 10)} 月 ${parseInt(m[3], 10)} 日` : '…';
                    }
                    const badge = document.getElementById('am-admin-badge');
                    if (badge) badge.classList.toggle('hidden', !user.isAdmin);
                },

                handleAccountMenuAction(act) {
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
                        if (confirm('确定要退出登录吗？\n本地缓存会清空，题库和学习记录都保留在云端，下次登录自动恢复。')) {
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
                    if (!confirm(
                        '⚠️ 注销账号将永久删除：\n\n· 全部题库（' + stats.total + ' 题）\n· 全部刷题记录与学习数据\n· 收藏、错题本与云端备份\n\n此操作不可恢复！\n\n确定要继续吗？'
                    )) return;
                    const typed = prompt('防呆确认：请输入你的用户名「' + username + '」以继续');
                    if (typed === null) return;
                    if (typed.trim() !== username) {
                        alert('用户名不匹配，注销已取消。');
                        return;
                    }
                    const pw = prompt('最后一步：输入账号密码以确认注销');
                    if (pw === null) return;
                    if (!pw) { alert('密码不能为空。'); return; }

                    const token = await App.auth.getToken();
                    if (!token) { alert('登录状态已失效，请刷新页面后重试。'); return; }
                    fetch((App.apiBase || '') + '/api/auth/delete-account', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                        body: JSON.stringify({ password: pw })
                    }).then(r => r.json().then(b => ({ status: r.status, body: b })).catch(() => ({ status: r.status, body: {} })))
                      .then(({ status, body }) => {
                          if (status === 200 && body.ok) {
                              alert('账号已注销。所有数据已删除，感谢使用。');
                              App.auth.logout();
                              App.data.clearAllForLogout().then(() => location.reload());
                          } else {
                              alert((body && body.error) || ('注销失败 (HTTP ' + status + ')'));
                          }
                      })
                      .catch(() => alert('网络异常，注销未完成。'));
                },

                // ===== 导出全部题库（备份 / 换设备迁移用）=====
                exportAllBank() {
                    const all = App.data.getQuestions();
                    if (!all.length) {
                        alert('题库为空，没有可导出的内容。');
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
                    ['pw-old', 'pw-new', 'pw-new2'].forEach(id => {
                        const el = App.dom.get(id);
                        if (!el) return;
                        el.value = '';
                        el.type = 'password';   // 每次打开重置为隐藏态
                    });
                    const modal = App.dom.get('modal-password');
                    if (modal && !modal.dataset.pwToggleBound) {
                        modal.dataset.pwToggleBound = '1';
                        modal.addEventListener('click', (e) => {
                            const t = e.target.closest('[data-pw-toggle]');
                            if (!t) return;
                            const input = document.getElementById(t.dataset.pwToggle);
                            if (input) input.type = input.type === 'password' ? 'text' : 'password';
                        });
                    }
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
                    const fail = (msg) => { if (statusEl) statusEl.textContent = msg; };
                    if (!oldPw || !newPw || !newPw2) return fail('请填写完整三个密码框。');
                    if (newPw.length < 6) return fail('新密码至少需要 6 位。');
                    if (newPw !== newPw2) return fail('两次输入的新密码不一致。');
                    if (newPw === oldPw) return fail('新密码不能与原密码相同。');
                    // 防呆：弱模式密码提前提示（不强制阻断，与后端策略一致）。
                    // 纯数字或纯字母连续 6 位会被 Chrome 泄露检查点名，给出软提醒
                    if (/^\d{6,}$/.test(newPw)) {
                        if (!confirm('纯数字密码更容易被破解工具猜中，也可能会收到浏览器的安全提醒。\n\n仍要使用这个密码吗？（建议改为字母+数字混合）')) return;
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
                            attemptsEl.innerHTML = '<div class="text-[11px] text-[var(--sub)] py-3">还没有作答记录。</div>';
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
                                    ? (rec.x ? '≥5分' : (sec < 60 ? `${sec}秒` : `${Math.floor(sec / 60)}分${String(sec % 60).padStart(2, '0')}秒`))
                                    : '—';
                                const status = rec.r
                                    ? '<span class="text-emerald-600 dark:text-emerald-400 font-bold">✓ 正确</span>'
                                    : '<span class="text-red-500 font-bold">✕ 错误</span>';
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
                                    '<div class="text-[11px] text-amber-600 dark:text-amber-400 pt-1">该题曾被修改，早于修改时间的记录可能对应旧版题目内容。</div>');
                            }
                            // 表头（与记录行对齐）
                            const header = document.createElement('div');
                            header.className = 'flex items-center gap-2.5 px-2.5 text-[10px] text-[var(--sub)] uppercase tracking-wider';
                            header.innerHTML = '<span class="flex-1">日期 / 时间</span><span class="flex-1 text-right">结果</span><span class="w-14 text-right flex-shrink-0">用时</span>';
                            attemptsEl.prepend(header);
                        }
                    }

                    // 汇总统计（与学习分析页的单题数据一致）
                    const summaryEl = App.dom.get('drawer-summary');
                    if (summaryEl) {
                        const b = (label, value) => `<div>${label}：<span class="font-bold text-[var(--text)]">${value}</span></div>`;
                        if (!all.length) {
                            summaryEl.innerHTML = b('作答次数', 0);
                        } else {
                            const correct = all.filter(x => x.r).length;
                            const errRate = Math.round((all.length - correct) / all.length * 100);
                            const durRecs = all.filter(x => x.d > 0);
                            const avgSec = durRecs.length ? (durRecs.reduce((s, x) => s + x.d, 0) / durRecs.length / 1000).toFixed(1) : null;
                            const totalSec = Math.round(all.filter(x => x.d > 0).reduce((s, x) => s + x.d, 0) / 1000);
                            summaryEl.innerHTML =
                                b('作答次数', all.length) +
                                b('正确次数', correct) +
                                b('错误率', errRate + '%') +
                                (avgSec != null ? b('平均用时', avgSec + '秒/次') : b('平均用时', '—')) +
                                (totalSec ? b('总用时', totalSec + '秒') : '');
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

                // 宽容 JSON 解析：依次尝试 原文 → 剥 markdown 代码围栏 → 截取首个 { 到最后一个 }。
                // 返回解析结果；彻底失败返回 null。
                _parseLooseJson(text) {
                    if (typeof text !== 'string') return null;
                    const s = text.replace(/^\uFEFF/, '').trim();
                    try { return JSON.parse(s); } catch (e) { }
                    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
                    if (fence) {
                        try { return JSON.parse(fence[1].trim()); } catch (e) { }
                    }
                    const a = s.indexOf('{');
                    const b = s.lastIndexOf('}');
                    if (a !== -1 && b > a) {
                        try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { }
                    }
                    return null;
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
                    return [
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
                        '     · mcq 写单个字母，如 "B"',
                        '     · multi 写多个字母连写，如 "BD"',
                        '     · tf 只能是 "T"（正确）或 "F"（错误）',
                        '     · fill 写答案；有多个可接受的写法用 | 分隔，如 "TCP|传输控制协议"',
                        '   - "media"（可选）：题目带图片或表格时使用。题干中在对应位置写占位符 [图1]、[表1]，然后在 media 数组中提供内容：',
                        '     · 图片：{ "type": "img", "key": "图1", "src": "https://可公开访问的图片URL", "alt": "图示说明" }',
                        '     · 表格：{ "type": "table", "key": "表1", "html": "<table><tr><td>内容</td></tr></table>" }（html 只能用 table/thead/tbody/tr/th/td 等表格标签）',
                        '3. 只整理能客观判分的题目（上面四种），不要问答、简答等主观题。',
                        '4. 题目数量以资料内容为准，宁全勿缺。',
                        '',
                        '输出示例（结构与「下载格式模板」完全一致）：',
                        JSON.stringify(example, null, 4)
                    ].join('\n');
                })(),

                toggleAiPrompt() {
                    const box = document.getElementById('ai-prompt-box');
                    const caret = document.getElementById('ai-prompt-caret');
                    if (!box) return;
                    const show = box.classList.contains('hidden');
                    box.classList.toggle('hidden', !show);
                    if (caret) caret.style.transform = show ? 'rotate(180deg)' : '';
                    const ta = document.getElementById('ai-prompt-text');
                    if (show && ta && !ta.value) ta.value = this.AI_IMPORT_PROMPT;
                },

                async copyAiPrompt() {
                    const ta = document.getElementById('ai-prompt-text');
                    const btn = document.getElementById('ai-prompt-copy');
                    if (!ta) return;
                    if (!ta.value) ta.value = this.AI_IMPORT_PROMPT;
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
                        btn.textContent = ok ? '已复制 ✓' : '复制失败，请长按手动复制';
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
                    const all = App.data.getQuestions();
                    if (!all.length) {
                        alert('题库为空，没有可导出的内容。');
                        return;
                    }
                    const html = this._buildPrintDoc();
                    const win = window.open('', '_blank');
                    if (!win) {
                        alert('打印窗口被浏览器拦截了。\n请允许本站弹出窗口后重试（地址栏右侧一般会有拦截提示）。');
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
                    for (const sub of Object.keys(bySub).sort()) {
                        const subCount = Object.values(bySub[sub]).reduce((t2, a2) => t2 + a2.length, 0);
                        bodyParts.push(`<section class="subject"><h2>${esc(sub)}<span class="scnt">${subCount} ${t('题')}</span></h2>`);
                        for (const chap of Object.keys(bySub[sub]).sort()) {
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
        <button onclick="window.print()">🖨 ${t('打印 / 保存为 PDF')}</button>
        <button class="ghost" onclick="window.close()">${t('关闭')}</button>
        <span class="tip">${t('在打印对话框的「目标打印机」中选择「另存为 PDF」，即可导出 PDF 文件')}</span>
    </div>
    <div class="wrap">
        <header class="cover">
            <h1>${esc(bankName)}</h1>
            <div class="meta">${t('共')} ${n} ${t('题')}${user ? ' · ' + esc(user) : ''} · ${t('导出于')} ${dateStr} · LMS Genesis</div>
        </header>
        ${bodyParts.join('\n')}
        <footer>—— LMS Genesis ——</footer>
    </div>
</body>
</html>`;

                    return html;
                },

                // 打开疑似相似题审查弹窗
                openSimilarReview() {
                    const report = App.data._lastImportReport;
                    if (!report || !report.similarPairs || report.similarPairs.length === 0) {
                        alert("当前没有检测到需要审查的疑似相似题。请先通过导入题库生成。");
                        return;
                    }
                    if (typeof this.closeModal === 'function') {
                        this.closeModal('config');
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
                                    #${idx + 1} [${subEsc} / ${chapEsc}] 相似度：<span class="font-bold text-amber-600">${(pair.score * 100).toFixed(0)}%</span>
                                </div>
                            </div>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                                <div class="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2">
                                    <div class="text-[11px] text-[var(--sub)] mb-1">现有题（题库中已有） • ID: ${existId}</div>
                                    <div class="text-[11px] font-medium text-[var(--text)] mb-1">${existQ}</div>
                                    <div class="text-[11px] text-[var(--sub)]">答案：${existA}</div>
                                </div>
                                <div class="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2">
                                    <div class="text-[11px] text-[var(--sub)] mb-1">新导入题 • ID: ${incomingId}</div>
                                    <div class="text-[11px] font-medium text-[var(--text)] mb-1">${incomingQ}</div>
                                    <div class="text-[11px] text-[var(--sub)]">答案：${incomingA}</div>
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
                    // 删除按钮只在「编辑已有题目」时出现；新建模式没有可删的东西
                    const delBtn = App.dom.get('qe-delete');
                    if (delBtn) delBtn.classList.toggle('hidden', !qId);
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
                    const mediaHint = App.dom.get('qe-media-hint');
                    if (mediaHint) { mediaHint.classList.add('hidden'); mediaHint.textContent = ''; }

                    if (!qId) {
                        if (titleEl) titleEl.textContent = '新增题目';
                        if (idInput) idInput.value = '';
                        if (typeSelect) typeSelect.value = 'mcq';
                        if (qText) qText.value = '';
                        App.dom.get('qe-fill-block') && App.dom.get('qe-fill-block').classList.add('hidden');
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
                        // 富媒体提示：media 只能经 JSON 导入/导出维护，编辑弹窗改不了它，但要告知用户它存在
                        if (mediaHint && Array.isArray(q.media) && q.media.length) {
                            const imgs = q.media.filter(m => m && (m.type || 'img') === 'img').length;
                            const tabs = q.media.length - imgs;
                            mediaHint.textContent = `⚠ 此题含富媒体（图片 ${imgs} 个${tabs ? `、表格 ${tabs} 个` : ''}），题干中以 [图N]/[表N] 占位。编辑保存不会丢失这些内容；修改媒体本身请走「导入题库」。`;
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
                    }
                },

                addQuestionOption(initialText = '') {
                    const list = App.dom.get('qe-options-list');
                    if (!list) return;
                    const idx = list.querySelectorAll('.qe-opt-row').length;
                    const letter = String.fromCharCode(65 + idx);
                    const row = document.createElement('div');
                    row.className = 'qe-opt-row flex items-center gap-2';
                    // 选项内容可能不是字符串（例如导入的 JSON 里选项写成数字），
                    // 直接 .replace 会抛 TypeError；这里统一转成字符串并做完整属性转义
                    const safeValue = App.utils.escapeHTML(String(initialText == null ? '' : initialText));
                    row.innerHTML = `
                        <span class="w-5 text-[11px] font-bold text-[var(--sub)]">${letter}.</span>
                        <input class="flex-1 bg-[var(--card)] border border-[var(--border)] rounded-lg px-2 py-1.5 outline-none text-xs"
                               value="${safeValue}"
                               placeholder="选项内容" />
                        <label class="flex items-center gap-1 text-[11px] text-[var(--sub)]">
                            <input type="checkbox" class="accent-primary-600" />
                            <span>正确</span>
                        </label>
                        <button class="text-[11px] text-[var(--sub)] hover:text-red-500 p-1"
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
                    } else if (type === 'fill') {
                        answer = (App.dom.getValue('qe-fill-answer') || '').trim();
                        if (!answer) {
                            if (errEl) errEl.textContent = '请填写填空题的正确答案。';
                            return;
                        }
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

                    App.ui.closeModal('question-editor');
                    App.views.library.render(App.views.library.currentMode);
                },

                // 编辑弹窗内直接删除当前题目（软删除 → 回收站，可恢复）
                deleteQuestionFromEditor() {
                    const idInput = App.dom.get('qe-id');
                    const id = idInput ? idInput.value : '';
                    if (!id) return;
                    const q = App.data.getQuestionById(id);
                    if (!q) {
                        App.ui.closeModal('question-editor');
                        return;
                    }
                    const msg = ['确定删除这道题吗？', (q.q || '').slice(0, 60), '', '题目会进入回收站，可随时恢复。'].join('\n');
                    if (!confirm(msg)) return;
                    App.data.softDeleteByIds(new Set([id]), 'editor-delete');
                    App.ui.closeModal('question-editor');
                    if (window.App && App.views && App.views.library && typeof App.views.library.render === 'function') {
                        App.views.library.render(App.views.library.currentMode);
                    }
                },

                openTrashModal() {
                    const modal = App.dom.get('modal-trash');
                    const list = App.dom.get('trash-list');
                    if (!modal || !list) return;

                    // 先确保弹窗可见，再做内容渲染：渲染无论发生什么都不应阻止弹窗打开
                    this._showModalEl(modal);

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
                                // 底层视图同步刷新：题库列表/统计立即反映恢复的题
                                if (window.App && App.router && typeof App.router.refresh === 'function') App.router.refresh();
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
                    try {
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
                                                        恢复
                                                    </button>
                                                    <button class="px-2 py-0.5 rounded border border-red-200 bg-red-50 text-red-600 text-[11px] font-bold"
                                                        data-action="destroy" data-sub="${subKey}" data-chap="${chapKey}" data-id="${idKey}">
                                                        彻底删除
                                                    </button>
                                                </div>
                                            </div>
                                            <div class="text-[11px] font-medium text-[var(--text)] mb-1">${safeQuestion}</div>
                                            <div class="text-[11px] text-[var(--sub)]">删除原因：${safeReason} / 路径：${safePathSub} - ${safePathChap}</div>
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
                        list.innerHTML = '<div class="text-center text-red-500 py-8">回收站内容渲染失败：' + App.utils.escapeHTML(e.message || String(e)) + '</div>';
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
                                if (!actionEl) return;
                                const action = actionEl.dataset.action;
                                const sub = actionEl.dataset.sub ? decodeURIComponent(actionEl.dataset.sub) : '';
                                if (!sub) return;
                                if (action === 'select-sub') {
                                    this._bankMgrCurrentSubject = sub;
                                    this.renderBankManager();
                                } else if (action === 'view-questions') {
                                    const filter = App.dom.get('lib-filter');
                                    if (filter) {
                                        filter.value = sub;
                                    }
                                    App.router.go('library');
                                    this.closeBankManager();
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
                        subList.innerHTML = '<div class="text-[11px] text-[var(--sub)] py-4 text-center">当前没有科目，请先导入或新增题目。</div>';
                        chapList.innerHTML = '<div class="text-[11px] text-[var(--sub)] py-4 text-center">暂无章节。</div>';
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
                            <div data-action="select-sub" data-sub="${encodeURIComponent(sub)}" class="flex items-center justify-between px-3 py-2 rounded-xl border ${activeClass} cursor-pointer hover:border-primary-400 dark:hover:border-primary-700 transition-colors">
                                <div class="flex flex-col">
                                    <span class="text-[11px] font-bold text-[var(--text)]">${App.utils.escapeHTML(sub)}</span>
                                    <span class="text-[11px] text-[var(--sub)]">${chaps.length} 章节 · ${total} 题</span>
                                </div>
                                <div class="flex items-center gap-1">
                                    <button data-action="view-questions" data-sub="${encodeURIComponent(sub)}" class="px-2 py-1 rounded-lg text-[11px] border border-primary-200 text-primary-600 bg-primary-50 hover:bg-primary-100 dark:bg-primary-950/30 dark:text-primary-400 dark:border-primary-900 transition-colors font-bold">查看</button>
                                    <button data-action="rename-sub" data-sub="${encodeURIComponent(sub)}" class="px-2 py-1 rounded-lg text-[11px] border border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900 transition-colors">重命名</button>
                                    <button data-action="delete-sub" data-sub="${encodeURIComponent(sub)}" class="px-2 py-1 rounded-lg text-[11px] border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900 transition-colors">删除</button>
                                </div>
                            </div>
                        `;
                    });
                    subList.innerHTML = subHtml;

                    const chapters = App.data.getChapters(current);
                    if (!chapters.length) {
                        chapList.innerHTML = '<div class="text-[11px] text-[var(--sub)] py-4 text-center">该科目暂无章节。</div>';
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
                                    <span class="text-[11px] text-[var(--sub)]">${count} 题</span>
                                </div>
                                <div class="flex items-center gap-1">
                                    <button data-action="rename-chap" data-sub="${encodeURIComponent(current)}" data-chap="${encodeURIComponent(chap)}" class="px-2 py-1 rounded-lg text-[11px] border border-blue-200 text-blue-600 bg-blue-50">重命名</button>
                                    <button data-action="delete-chap" data-sub="${encodeURIComponent(current)}" data-chap="${encodeURIComponent(chap)}" class="px-2 py-1 rounded-lg text-[11px] border border-red-200 text-red-600 bg-red-50">删除</button>
                                </div>
                            </div>
                        `;
                    });
                    chapList.innerHTML = chapHtml;
                },

                _bankMgrBound: false,
                _bankMgrCurrentSubject: ''
            
};