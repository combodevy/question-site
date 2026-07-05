export const ui = {

                _importSessionId: 0,
                _importReader: null,
                toggleModal(id) {
                    const el = App.dom.get(`modal-${id}`);
                    if (!el) return;

                    if (el.classList.contains('hidden')) {
                        el.classList.remove('hidden');
                        if (id === 'smart-practice') {
                            const container = App.dom.get('smart-subjects-list');
                            if (container) {
                                container.innerHTML = '';
                                const subs = App.data.getSubjects();
                                if (subs.length === 0) {
                                    container.innerHTML = '<div class="text-xs text-[var(--sub)] italic">当前题库为空，请前往右上角设置导入数据。</div>';
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
                        }
                        setTimeout(() => el.classList.remove('opacity-0', 'pointer-events-none'), 10);
                    } else {
                        this.closeModal(id);
                    }
                },

                closeModal(id) {
                    const el = App.dom.get(`modal-${id}`);
                    if (el && !el.classList.contains('hidden')) {
                        el.classList.add('opacity-0', 'pointer-events-none');
                        setTimeout(() => el.classList.add('hidden'), 200);
                    }
                },

                toggleAIAdvanced() {
                    const panel = App.dom.get('ai-advanced-panel');
                    if (!panel) return;
                    panel.classList.toggle('hidden');
                },

                showAITooltip(event, id) {
                    event.stopPropagation();
                    const existing = document.getElementById('ai-param-tooltip');
                    if (existing) existing.remove();
                    const map = {
                        'ai-tip-temperature': '控制随机性：0 更谨慎，值越大回答越发散。',
                        'ai-tip-top-p': '核采样比例：与 temperature 类似，一般二者只调一个。',
                        'ai-tip-max-tokens': '限制单次回复的最大 Token 数，防止回答过长。',
                        'ai-tip-presence': '鼓励提及新主题，值越大越不重复已出现的内容。',
                        'ai-tip-frequency': '惩罚重复词汇，值越大越少出现重复句子。',
                        'ai-tip-timeout': 'HTTP 请求超时时间，单位毫秒，填 0 表示不超时。'
                    };
                    const text = map[id] || '';
                    if (!text) return;
                    const tip = document.createElement('div');
                    tip.id = 'ai-param-tooltip';
                    tip.className = 'fixed z-50 max-w-xs text-[10px] text-[var(--sub)] bg-[var(--card)] border border-[var(--border)] rounded-lg px-2 py-1 shadow-lg';
                    tip.textContent = text;
                    document.body.appendChild(tip);
                    const rect = event.currentTarget.getBoundingClientRect();
                    const tipRect = tip.getBoundingClientRect();
                    let left = rect.left + rect.width / 2 - tipRect.width / 2;
                    if (left < 8) left = 8;
                    if (left + tipRect.width > window.innerWidth - 8) left = window.innerWidth - tipRect.width - 8;
                    let top = rect.bottom + 6;
                    if (top + tipRect.height > window.innerHeight - 8) top = rect.top - tipRect.height - 6;
                    tip.style.left = left + 'px';
                    tip.style.top = top + 'px';
                    const hide = () => {
                        tip.remove();
                        document.removeEventListener('click', hide, true);
                        window.removeEventListener('scroll', hide, true);
                        window.removeEventListener('resize', hide, true);
                    };
                    setTimeout(() => {
                        document.addEventListener('click', hide, true);
                        window.addEventListener('scroll', hide, true);
                        window.addEventListener('resize', hide, true);
                    }, 0);
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

                openImportCenter(defaultTab = 'json') {
                    this.toggleModal('import-center');
                    App.ui.switchImportTab(defaultTab);
                    const statusEl = App.dom.get('import-json-status');
                    if (statusEl && defaultTab === 'json') {
                        statusEl.textContent = '尚未选择文件';
                    }
                },

                switchImportTab(tab) {
                    const isJson = tab === 'json';
                    const btnJson = App.dom.get('import-tab-btn-json');
                    const btnAi = App.dom.get('import-tab-btn-ai');
                    const tabJson = App.dom.get('import-tab-json');
                    const tabAi = App.dom.get('import-tab-ai');
                    if (btnJson && btnAi) {
                        btnJson.classList.toggle('bg-[var(--card)]', isJson);
                        btnJson.classList.toggle('text-[var(--text)]', isJson);
                        btnJson.classList.toggle('bg-transparent', !isJson);
                        btnJson.classList.toggle('text-[var(--sub)]', !isJson);
                        btnAi.classList.toggle('bg-[var(--card)]', !isJson);
                        btnAi.classList.toggle('text-[var(--text)]', !isJson);
                        btnAi.classList.toggle('bg-transparent', isJson);
                        btnAi.classList.toggle('text-[var(--sub)]', isJson);
                    }
                    if (tabJson && tabAi) {
                        tabJson.classList.toggle('hidden', !isJson);
                        tabAi.classList.toggle('hidden', isJson);
                    }
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
                    if (structEl) structEl.innerHTML = '<div class="text-[10px] text-[var(--sub)] italic">正在解析文件…</div>';
                    if (listEl) listEl.innerHTML = '<div class="text-[10px] text-[var(--sub)] italic">正在解析文件…</div>';
                    if (statusEl) statusEl.textContent = `正在读取文件：${file.name}`;

                    if (file.size > 5 * 1024 * 1024) {
                        alert("文件过大，请上传 5MB 以内的题库文件。(File exceeds 5MB limit.)");
                        e.target.value = null;
                        if (statusEl) statusEl.textContent = "❌ 文件过大，已取消解析。";
                        return;
                    }

                    const reader = new FileReader();
                    reader.onload = (event) => {
                        try {
                            const text = event.target.result;
                            let parsed;
                            try {
                                parsed = JSON.parse(text);
                            } catch (err) {
                                if (statusEl) statusEl.textContent = "❌ JSON 解析失败：" + (err.message || err.toString());
                                if (structEl) structEl.innerHTML = '<div class="text-[10px] text-[var(--sub)] italic">JSON 解析失败，无法预览。</div>';
                                if (listEl) listEl.innerHTML = '<div class="text-[10px] text-[var(--sub)] italic">JSON 解析失败，无法预览。</div>';
                                return;
                            }

                            const check = App.data.validateSchema(parsed);
                            if (check !== true) {
                                if (statusEl) statusEl.textContent = "❌ 结构校验失败：" + check;
                                if (structEl) structEl.innerHTML = '<div class="text-[10px] text-[var(--sub)] italic">结构校验失败，请根据模板调整 JSON。</div>';
                                if (listEl) listEl.innerHTML = '<div class="text-[10px] text-[var(--sub)] italic">结构校验失败，无法生成预览。</div>';
                                return;
                            }

                            const sanitized = (window.App && App.ai && typeof App.ai.sanitizeImportedBank === 'function')
                                ? App.ai.sanitizeImportedBank(parsed)
                                : parsed;

                            const flat = [];
                            const subjSet = new Set();
                            const chapSet = new Set();
                            let mcqCount = 0, multiCount = 0, tfCount = 0;

                            for (const sub in sanitized) {
                                const chapDict = sanitized[sub] || {};
                                let subTotal = 0;
                                const chapsInfo = [];
                                for (const chap in chapDict) {
                                    const arr = Array.isArray(chapDict[chap]) ? chapDict[chap] : [];
                                    if (!arr.length) continue;
                                    chapSet.add(`${sub}::${chap}`);
                                    let cMcq = 0, cMulti = 0, cTf = 0;
                                    arr.forEach(q => {
                                        if (!q) return;
                                        const type = q.type;
                                        if (type === 'mcq') { mcqCount++; cMcq++; }
                                        else if (type === 'multi') { multiCount++; cMulti++; }
                                        else if (type === 'tf') { tfCount++; cTf++; }
                                        flat.push({
                                            sub,
                                            chap,
                                            type,
                                            q: q.q || ''
                                        });
                                    });
                                    const chapTotal = arr.length;
                                    subTotal += chapTotal;
                                    chapsInfo.push({ chap, total: chapTotal, mcq: cMcq, multi: cMulti, tf: cTf });
                                }
                                if (chapsInfo.length) {
                                    subjSet.add(sub);
                                }
                            }

                            const total = flat.length;
                            if (totalEl) totalEl.textContent = String(total);
                            if (subEl) subEl.textContent = String(subjSet.size);
                            if (chapEl) chapEl.textContent = String(chapSet.size);
                            if (mcqEl) mcqEl.textContent = String(mcqCount);
                            if (multiEl) multiEl.textContent = String(multiCount);
                            if (tfEl) tfEl.textContent = String(tfCount);

                            if (structEl) {
                                if (!total) {
                                    structEl.innerHTML = '<div class="text-[10px] text-[var(--sub)] italic">未检测到任何单选 / 多选 / 判断题。</div>';
                                } else {
                                    const blocks = [];
                                    for (const sub of Array.from(subjSet)) {
                                        const chapDict = sanitized[sub] || {};
                                        let subTotal = 0;
                                        const rows = [];
                                        for (const chap in chapDict) {
                                            const arr = Array.isArray(chapDict[chap]) ? chapDict[chap] : [];
                                            if (!arr.length) continue;
                                            const chapTotal = arr.length;
                                            subTotal += chapTotal;
                                            let cMcq = 0, cMulti = 0, cTf = 0;
                                            arr.forEach(q => {
                                                if (q.type === 'mcq') cMcq++;
                                                else if (q.type === 'multi') cMulti++;
                                                else if (q.type === 'tf') cTf++;
                                            });
                                            rows.push(`
                                                <div class="flex items-center gap-2 text-[10px]">
                                                    <span class="truncate flex-1">${App.utils.escapeHTML(chap)}</span>
                                                    <span class="text-[var(--sub)]">${chapTotal} 题 · 单选 ${cMcq} · 多选 ${cMulti} · 判断 ${cTf}</span>
                                                </div>
                                            `);
                                        }
                                        blocks.push(`
                                            <div class="mb-2 last:mb-0">
                                                <div class="flex items-center justify-between mb-1">
                                                    <div class="text-[10px] font-bold text-[var(--text)]">${App.utils.escapeHTML(sub)}</div>
                                                    <div class="text-[10px] text-[var(--sub)]">${subTotal} 题</div>
                                                </div>
                                                <div class="space-y-0.5">${rows.join('')}</div>
                                            </div>
                                        `);
                                    }
                                    structEl.innerHTML = blocks.join('') || '<div class="text-[10px] text-[var(--sub)] italic">未检测到任何题目。</div>';
                                }
                            }

                            if (listEl) {
                                if (!flat.length) {
                                    listEl.innerHTML = '<div class="text-[10px] text-[var(--sub)] italic">暂无题目预览。</div>';
                                } else {
                                    const previewItems = flat.slice(0, 50);
                                    listEl.innerHTML = previewItems.map((item, idx) => {
                                        const typeLabel = item.type === 'mcq' ? '单选' : (item.type === 'multi' ? '多选' : '判断');
                                        const qText = App.utils.escapeHTML(String(item.q || '')).slice(0, 80);
                                        const subEsc = App.utils.escapeHTML(item.sub);
                                        const chapEsc = App.utils.escapeHTML(item.chap);
                                        const idEsc = App.utils.escapeHTML(item.id || '');
                                        return `
                                            <div class="border-b border-[var(--border)] pb-1 last:border-b-0" id="import-json-row-${idx}" data-sub="${subEsc}" data-chap="${chapEsc}" data-qid="${idEsc}">
                                                <div class="flex items-center justify-between gap-1">
                                                    <span class="text-[10px] text-[var(--sub)]">#${idx + 1}</span>
                                                    <span class="text-[10px] text-[var(--sub)] truncate flex-1 text-right">${subEsc} / ${chapEsc}</span>
                                                </div>
                                                <div class="flex items-center justify-between gap-1 mt-0.5">
                                                    <span class="inline-flex items-center px-1.5 py-0.5 rounded-full border border-[var(--border)] text-[9px] text-[var(--sub)]">${typeLabel}</span>
                                                    <span class="text-[11px] text-[var(--text)] flex-1 text-right">${qText}${String(item.q || '').length > 80 ? '…' : ''}</span>
                                                </div>
                                                <div class="mt-1 flex items-center gap-1 text-[10px] text-[var(--sub)]">
                                                    <span>科目</span>
                                                    <input class="import-json-sub-input flex-1 min-w-[80px] bg-[var(--card)] border border-[var(--border)] rounded px-1 py-0.5 outline-none" value="${subEsc}">
                                                    <span>章节</span>
                                                    <input class="import-json-chap-input flex-1 min-w-[80px] bg-[var(--card)] border border-[var(--border)] rounded px-1 py-0.5 outline-none" value="${chapEsc}">
                                                    <button class="px-1.5 py-0.5 border border-[var(--border)] rounded text-[10px] text-primary-600 hover:bg-primary-50"
                                                        onclick="App.ui.applyJsonMetaChange(${idx})">应用</button>
                                                </div>
                                            </div>
                                        `;
                                    }).join('');
                                }
                            }

                            App.ui._jsonImportPreview = sanitized;
                            App.ui._jsonImportPreviewCount = flat.length;
                            if (applyBtn) applyBtn.disabled = !flat.length;

                            if (statusEl) {
                                statusEl.textContent = flat.length
                                    ? `✅ 解析成功：检测到 ${flat.length} 道题（科目 ${subjSet.size} 个，章节 ${chapSet.size} 个）。`
                                    : "⚠️ 解析完成，但未检测到任何符合条件的题目。";
                            }
                        } finally {
                            e.target.value = null;
                        }
                    };
                    reader.onerror = () => {
                        if (statusEl) statusEl.textContent = "❌ 文件读取失败。";
                        e.target.value = null;
                    };
                    reader.readAsText(file, 'UTF-8');
                },

                applyJsonPreviewImport() {
                    const data = App.ui._jsonImportPreview;
                    const count = App.ui._jsonImportPreviewCount || 0;
                    const statusEl = App.dom.get('import-json-status');
                    if (!data || !count) {
                        alert("请先选择 JSON 文件并完成预览解析。");
                        return;
                    }
                    const ok = confirm(`即将根据预览结果导入约 ${count} 道题到当前题库，是否继续？`);
                    if (!ok) {
                        if (statusEl) statusEl.textContent = "已取消导入操作。";
                        return;
                    }
                    const report = App.data.importBank(JSON.stringify(data));
                    if (!report) {
                        if (statusEl) statusEl.textContent = "❌ 导入失败，请检查 JSON 格式或控制台错误信息。";
                        return;
                    }
                    if (statusEl) statusEl.textContent = "✅ 已根据预览 JSON 成功导入题库。";
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

                    const flat = [];
                    const subjSet = new Set();
                    const chapSet = new Set();
                    let mcqCount = 0, multiCount = 0, tfCount = 0;
                    const totalEl = App.dom.get('import-json-total');
                    const subEl = App.dom.get('import-json-subjects');
                    const chapEl = App.dom.get('import-json-chapters');
                    const mcqEl = App.dom.get('import-json-mcq');
                    const multiEl = App.dom.get('import-json-multi');
                    const tfEl = App.dom.get('import-json-tf');
                    const structEl = App.dom.get('import-json-struct');
                    const listEl = App.dom.get('import-json-list');
                    const applyBtn = App.dom.get('import-json-apply-btn');

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
                                else if (type === 'tf') tfCount++;
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
                    App.ui._jsonImportPreviewCount = total;
                    if (totalEl) totalEl.textContent = String(total);
                    if (subEl) subEl.textContent = String(subjSet.size);
                    if (chapEl) chapEl.textContent = String(chapSet.size);
                    if (mcqEl) mcqEl.textContent = String(mcqCount);
                    if (multiEl) multiEl.textContent = String(multiCount);
                    if (tfEl) tfEl.textContent = String(tfCount);

                    if (structEl) {
                        if (!total) {
                            structEl.innerHTML = '<div class="text-[10px] text-[var(--sub)] italic">未检测到任何单选 / 多选 / 判断题。</div>';
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
                                        <div class="flex items-center gap-2 text-[10px]">
                                            <span class="truncate flex-1">${App.utils.escapeHTML(chap)}</span>
                                            <span class="text-[var(--sub)]">${chapTotal} 题 · 单选 ${cMcq} · 多选 ${cMulti} · 判断 ${cTf}</span>
                                        </div>
                                    `);
                                }
                                blocks.push(`
                                    <div class="mb-2 last:mb-0">
                                        <div class="flex items-center justify-between mb-1">
                                            <div class="text-[10px] font-bold text-[var(--text)]">${App.utils.escapeHTML(sub)}</div>
                                            <div class="text-[10px] text-[var(--sub)]">${subTotal} 题</div>
                                        </div>
                                        <div class="space-y-0.5">${rows.join('')}</div>
                                    </div>
                                `);
                            }
                            structEl.innerHTML = blocks.join('') || '<div class="text-[10px] text-[var(--sub)] italic">未检测到任何题目。</div>';
                        }
                    }

                    if (listEl) {
                        if (!flat.length) {
                            listEl.innerHTML = '<div class="text-[10px] text-[var(--sub)] italic">暂无题目预览。</div>';
                        } else {
                            const previewItems = flat.slice(0, 50);
                            listEl.innerHTML = previewItems.map((item, idx) => {
                                const typeLabel = item.type === 'mcq' ? '单选' : (item.type === 'multi' ? '多选' : '判断');
                                const qText = App.utils.escapeHTML(String(item.q || '')).slice(0, 80);
                                const subEsc = App.utils.escapeHTML(item.sub);
                                const chapEsc = App.utils.escapeHTML(item.chap);
                                const idEsc = App.utils.escapeHTML(item.id || '');
                                return `
                                    <div class="border-b border-[var(--border)] pb-1 last:border-b-0" id="import-json-row-${idx}" data-sub="${subEsc}" data-chap="${chapEsc}" data-qid="${idEsc}">
                                        <div class="flex items-center justify-between gap-1">
                                            <span class="text-[10px] text-[var(--sub)]">#${idx + 1}</span>
                                            <span class="text-[10px] text-[var(--sub)] truncate flex-1 text-right">${subEsc} / ${chapEsc}</span>
                                        </div>
                                        <div class="flex items-center justify-between gap-1 mt-0.5">
                                            <span class="inline-flex items-center px-1.5 py-0.5 rounded-full border border-[var(--border)] text-[9px] text-[var(--sub)]">${typeLabel}</span>
                                            <span class="text-[11px] text-[var(--text)] flex-1 text-right">${qText}${String(item.q || '').length > 80 ? '…' : ''}</span>
                                        </div>
                                        <div class="mt-1 flex items-center gap-1 text-[10px] text-[var(--sub)]">
                                            <span>科目</span>
                                            <input class="import-json-sub-input flex-1 min-w-[80px] bg-[var(--card)] border border-[var(--border)] rounded px-1 py-0.5 outline-none" value="${subEsc}">
                                            <span>章节</span>
                                            <input class="import-json-chap-input flex-1 min-w-[80px] bg-[var(--card)] border border-[var(--border)] rounded px-1 py-0.5 outline-none" value="${chapEsc}">
                                            <button class="px-1.5 py-0.5 border border-[var(--border)] rounded text-[10px] text-primary-600 hover:bg-primary-50"
                                                onclick="App.ui.applyJsonMetaChange(${idx})">应用</button>
                                        </div>
                                    </div>
                                `;
                            }).join('');
                        }
                    }

                    if (applyBtn) applyBtn.disabled = !flat.length;
                    if (statusEl) {
                        statusEl.textContent = flat.length
                            ? `✅ 预览已更新：当前将导入 ${flat.length} 道题（科目 ${subjSet.size} 个，章节 ${chapSet.size} 个）。`
                            : "⚠️ 当前预览中不再包含任何题目。";
                    }
                },

                initTheme() {
                    if (localStorage.getItem('dark') === '1') document.documentElement.classList.add('dark');
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
                    App.dom.setText('drawer-q', q.q);
                    const h = App.data.history.filter(x => x.id === id).slice(-5);
                    const dots = App.dom.get('drawer-dots');
                    if (dots) {
                        dots.innerHTML = '';
                        h.forEach(rec => {
                            const d = document.createElement('div');
                            d.className = `w-3 h-3 rounded-full ${rec.r ? 'dot-correct' : 'dot-wrong'}`;
                            dots.appendChild(d);
                        });
                        for (let i = 0; i < (5 - h.length); i++) {
                            const d = document.createElement('div');
                            d.className = `w-3 h-3 rounded-full dot-empty`;
                            dots.appendChild(d);
                        }
                    }

                    App.ai.setContext(q);

                    backdrop.classList.remove('hidden');
                    drawer.classList.remove('translate-x-full');
                    setTimeout(() => backdrop.classList.remove('opacity-0'), 10);
                },
                closeDrawer() {
                    const drawer = App.dom.get('insight-drawer');
                    const backdrop = App.dom.get('drawer-backdrop');
                    if (!drawer || !backdrop) return;

                    drawer.classList.add('translate-x-full');
                    backdrop.classList.add('opacity-0');
                    setTimeout(() => backdrop.classList.add('hidden'), 300);
                },

                handleFileUpload(e) {
                    const file = e.target.files[0];
                    if (!file) return;

                    // 修复 4: 增加文件大小限制 (5MB上限)，防止大文件阻塞主线程 (Prevent Main Thread Blocking)
                    if (file.size > 5 * 1024 * 1024) {
                        alert("文件过大，请上传 5MB 以内的题库文件。(File exceeds 5MB limit.)");
                        e.target.value = null;
                        return;
                    }

                    const reader = new FileReader();
                    reader.onload = (event) => {
                        const text = event.target.result;
                        const report = App.data.importBank(text);
                        if (!report) {
                            alert('导入失败，请检查 JSON 内容。');
                        } else {
                            const msgLines = [
                                `题库导入完成：`,
                                `- 新增题目：${report.added}`,
                                `- 覆盖更新：${report.updated}`,
                                `- 完全重复跳过：${report.skippedSame}`,
                                report.similarPairs.length ? `- 疑似相似题组：${report.similarPairs.length} 组` : ''
                            ].filter(Boolean);
                            alert(msgLines.join('\n'));
                        }
                    };
                    reader.onerror = () => alert('文件读取失败 (File read error)');
                    reader.readAsText(file, 'UTF-8');
                    e.target.value = null;
                },

                // AI 文档导入：根据文件类型提取纯文本并填充到文本框中
                async handleAIImportFile(e) {
                    const file = e.target.files[0];
                    if (!file) return;
                    this._importSessionId += 1;
                    const sessionId = this._importSessionId;
                    if (this._importReader && this._importReader.readyState === 1) {
                        try { this._importReader.abort(); } catch (e) { }
                    }
                    this._importReader = null;

                    const nameEl = App.dom.get('ai-import-file-name');
                    if (nameEl) {
                        const sizeKb = Math.round(file.size / 1024);
                        nameEl.textContent = `${file.name} (${sizeKb} KB)`;
                    }

                    const statusEl = App.dom.get('ai-import-status');
                    const textArea = App.dom.get('ai-import-raw');

                    const setStatus = (msg) => { if (sessionId === this._importSessionId && statusEl) statusEl.textContent = msg; };
                    const setRaw = (txt) => { if (sessionId === this._importSessionId && textArea) textArea.value = txt || ''; };

                    setStatus("正在读取并解析文件内容…");

                    const ext = file.name.toLowerCase().split('.').pop();

                    try {
                        if (ext === 'txt' || ext === 'md') {
                            const reader = new FileReader();
                            this._importReader = reader;
                            reader.onload = (event) => {
                                if (sessionId !== this._importSessionId) return;
                                setRaw(event.target.result || '');
                                setStatus("文本文件读取完成，可以点击「AI 识别并导入」。");
                            };
                            reader.onerror = () => { if (sessionId === this._importSessionId) setStatus("❌ 文本文件读取失败。"); };
                            reader.readAsText(file, 'UTF-8');
                        } else if (ext === 'docx') {
                            if (!window.mammoth) {
                                setStatus("❌ 未找到 DOCX 解析库 mammoth，无法解析 Word 文档。");
                                return;
                            }
                            const reader = new FileReader();
                            this._importReader = reader;
                            reader.onload = async (event) => {
                                try {
                                    if (sessionId !== this._importSessionId) return;
                                    const arrayBuffer = event.target.result;
                                    const result = await mammoth.extractRawText({ arrayBuffer });
                                    if (sessionId !== this._importSessionId) return;
                                    setRaw(result.value || '');
                                    setStatus("DOCX 文档解析完成，可以点击「AI 识别并导入」。");
                                    if (arrayBuffer) {
                                        event.target.result = null;
                                    }
                                } catch (err) {
                                    console.error("DOCX parse error", err);
                                    setStatus("❌ 解析 DOCX 文档失败，请确认文件格式是否正确。");
                                }
                            };
                            reader.onerror = () => { if (sessionId === this._importSessionId) setStatus("❌ 读取 DOCX 文件失败。"); };
                            reader.readAsArrayBuffer(file);
                        } else if (ext === 'pdf') {
                            const reader = new FileReader();
                            this._importReader = reader;
                            reader.onload = async (event) => {
                                try {
                                    if (window.pdfjsReady) {
                                        await window.pdfjsReady;
                                    }
                                    if (!window.pdfjsLib) {
                                        setStatus("❌ 未找到 PDF 解析库 pdf.js，无法解析 PDF 文档。");
                                        return;
                                    }
                                    if (sessionId !== this._importSessionId) return;
                                    const arrayBuffer = event.target.result;
                                    const uint8Array = new Uint8Array(arrayBuffer);
                                    const loadingTask = window.pdfjsLib.getDocument({ data: uint8Array });
                                    const pdf = await loadingTask.promise;

                                    let text = '';
                                    const batchSize = 10;
                                    for (let i = 1; i <= pdf.numPages; i += batchSize) {
                                        if (sessionId !== this._importSessionId) return;
                                        const end = Math.min(i + batchSize - 1, pdf.numPages);
                                        for (let pageNum = i; pageNum <= end; pageNum++) {
                                            if (sessionId !== this._importSessionId) return;
                                            const page = await pdf.getPage(pageNum);
                                            const content = await page.getTextContent();
                                            const strings = content.items.map(item => item.str);
                                            text += strings.join(' ') + '\n\n';
                                        }
                                        // 批处理之间让出主线程，避免长时间阻塞界面
                                        await new Promise(resolve => setTimeout(resolve, 0));
                                        setStatus(`正在解析 PDF 第 ${end}/${pdf.numPages} 页…`);
                                    }

                                    if (sessionId !== this._importSessionId) return;
                                    setRaw(text.trim());
                                    setStatus("PDF 文档解析完成，可以点击「AI 识别并导入」。");
                                    text = null;
                                } catch (err) {
                                    console.error("PDF parse error", err);
                                    setStatus("❌ 解析 PDF 文档失败，请确认文件格式是否正常。");
                                }
                            };
                            reader.onerror = () => { if (sessionId === this._importSessionId) setStatus("❌ 读取 PDF 文件失败。"); };
                            reader.readAsArrayBuffer(file);
                        } else {
                            setStatus("❌ 当前仅支持 .txt / .md / .docx / .pdf 文件类型。");
                        }
                    } catch (err) {
                        console.error('AI import file handling error', err);
                        setStatus("❌ 文件处理过程中发生错误：" + (err.message || '未知错误'));
                    } finally {
                        e.target.value = null;
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
                                <div class="text-[10px] text-[var(--sub)]">
                                    #${idx + 1} [${subEsc} / ${chapEsc}] 相似度：<span class="font-bold text-amber-600">${(pair.score * 100).toFixed(0)}%</span>
                                </div>
                            </div>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                                <div class="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2">
                                    <div class="text-[10px] text-[var(--sub)] mb-1">现有题（题库中已有） • ID: ${existId}</div>
                                    <div class="text-[11px] font-medium text-[var(--text)] mb-1">${existQ}</div>
                                    <div class="text-[10px] text-[var(--sub)]">答案：${existA}</div>
                                </div>
                                <div class="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2">
                                    <div class="text-[10px] text-[var(--sub)] mb-1">新导入题 • ID: ${incomingId}</div>
                                    <div class="text-[11px] font-medium text-[var(--text)] mb-1">${incomingQ}</div>
                                    <div class="text-[10px] text-[var(--sub)]">答案：${incomingA}</div>
                                </div>
                            </div>
                            <div class="mt-2 flex flex-wrap gap-3 text-[10px]">
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

                    modal.classList.remove('hidden');
                    setTimeout(() => modal.classList.remove('opacity-0', 'pointer-events-none'), 10);
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

                    if (!qId) {
                        if (titleEl) titleEl.textContent = '新增题目';
                        if (idInput) idInput.value = '';
                        if (typeSelect) typeSelect.value = 'mcq';
                        if (qText) qText.value = '';
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
                        if (subSelect) subSelect.value = q.sub;
                        updateChaps(q.sub);
                        if (chapSelect) chapSelect.value = q.chap;
                        if (typeSelect) typeSelect.value = q.type;

                        if (q.type === 'tf') {
                            optionsBlock && optionsBlock.classList.add('hidden');
                            if (tfBlock) {
                                tfBlock.classList.remove('hidden');
                                const radios = tfBlock.querySelectorAll('input[name="qe-tf"]');
                                radios.forEach(r => { r.checked = r.value === q.a; });
                            }
                        } else {
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

                    modal.classList.remove('hidden');
                    setTimeout(() => modal.classList.remove('opacity-0', 'pointer-events-none'), 10);
                },

                onQuestionTypeChange() {
                    const typeEl = App.dom.get('qe-type');
                    const type = typeEl ? typeEl.value : 'mcq';
                    const optionsBlock = App.dom.get('qe-options-block');
                    const tfBlock = App.dom.get('qe-tf-block');
                    const tfRadios = document.querySelectorAll('#qe-tf-block input[name="qe-tf"]');

                    if (type === 'tf') {
                        // 切换为判断题：隐藏选项区，清空所有选项勾选
                        const list = App.dom.get('qe-options-list');
                        if (list) {
                            const rows = list.querySelectorAll('.qe-opt-row input[type="checkbox"]');
                            rows.forEach(chk => chk.checked = false);
                        }
                        optionsBlock && optionsBlock.classList.add('hidden');
                        tfBlock && tfBlock.classList.remove('hidden');
                    } else {
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
                    row.innerHTML = `
                        <span class="w-5 text-[11px] font-bold text-[var(--sub)]">${letter}.</span>
                        <input class="flex-1 bg-[var(--card)] border border-[var(--border)] rounded-lg px-2 py-1.5 outline-none text-xs"
                               value="${initialText.replace(/"/g, '&quot;')}"
                               placeholder="选项内容" />
                        <label class="flex items-center gap-1 text-[10px] text-[var(--sub)]">
                            <input type="checkbox" class="accent-primary-600" />
                            <span>正确</span>
                        </label>
                        <button class="text-[10px] text-[var(--sub)] hover:text-red-500 p-1"
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

                    App.data.upsertQuestion({
                        id,
                        sub,
                        chap,
                        type,
                        q,
                        o: type === 'tf' ? undefined : cleanedOptions,
                        a: answer
                    });

                    if (App.data && typeof App.data.saveToCloudDebounced === 'function') {
                        App.data.saveToCloudDebounced();
                    }

                    App.ui.closeModal('question-editor');
                    App.views.library.render(App.views.library.currentMode);
                },

                openTrashModal() {
                    const modal = App.dom.get('modal-trash');
                    const list = App.dom.get('trash-list');
                    if (!modal || !list) return;

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
                                            <span class="text-[10px] font-bold text-primary-600 bg-primary-50 px-1 rounded border border-primary-100">${sub}</span>
                                            <span class="text-[10px] text-[var(--sub)] border border-[var(--border)] px-1 rounded">${chap}</span>
                                        </div>
                                        <span class="text-[10px] text-[var(--sub)]">${arr.length} 题</span>
                                    </div>
                                `;
                                arr.forEach(q => {
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
                                            <div class="text-[10px] text-[var(--sub)]">ID: ${q.id}</div>
                                            <div class="flex items-center gap-2">
                                                <span class="text-[10px] text-[var(--sub)]">${timeStr}</span>
                                                <button class="px-2 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-600 text-[10px] font-bold"
                                                    data-action="restore" data-sub="${subKey}" data-chap="${chapKey}" data-id="${idKey}">
                                                    恢复
                                                </button>
                                                <button class="px-2 py-0.5 rounded border border-red-200 bg-red-50 text-red-600 text-[10px] font-bold"
                                                    data-action="destroy" data-sub="${subKey}" data-chap="${chapKey}" data-id="${idKey}">
                                                    彻底删除
                                                </button>
                                            </div>
                                        </div>
                                        <div class="text-[11px] font-medium text-[var(--text)] mb-1">${safeQuestion}</div>
                                        <div class="text-[10px] text-[var(--sub)]">删除原因：${safeReason} / 路径：${safePathSub} - ${safePathChap}</div>
                                    `;
                                    block.appendChild(item);
                                });
                                list.appendChild(block);
                            });
                        });
                    }

                    modal.classList.remove('hidden');
                    setTimeout(() => modal.classList.remove('opacity-0', 'pointer-events-none'), 10);
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
                    modal.classList.remove('hidden');
                    setTimeout(() => {
                        modal.classList.remove('opacity-0', 'pointer-events-none');
                    }, 10);
                },

                closeBankManager() {
                    const modal = App.dom.get('modal-bank-manager');
                    if (!modal) return;
                    modal.classList.add('opacity-0', 'pointer-events-none');
                    setTimeout(() => modal.classList.add('hidden'), 150);
                },

                renderBankManager() {
                    const subList = App.dom.get('bank-manager-subject-list');
                    const chapList = App.dom.get('bank-manager-chapter-list');
                    const currentLabel = App.dom.get('bank-manager-current-subject');
                    if (!subList || !chapList || !currentLabel) return;
                    const subjects = App.data.getSubjects();
                    if (!subjects.length) {
                        subList.innerHTML = '<div class="text-[10px] text-[var(--sub)] py-4 text-center">当前没有科目，请先导入或新增题目。</div>';
                        chapList.innerHTML = '<div class="text-[10px] text-[var(--sub)] py-4 text-center">暂无章节。</div>';
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
                                    <span class="text-[10px] text-[var(--sub)]">${chaps.length} 章节 · ${total} 题</span>
                                </div>
                                <div class="flex items-center gap-1">
                                    <button data-action="view-questions" data-sub="${encodeURIComponent(sub)}" class="px-2 py-1 rounded-lg text-[10px] border border-primary-200 text-primary-600 bg-primary-50 hover:bg-primary-100 dark:bg-primary-950/30 dark:text-primary-400 dark:border-primary-900 transition-colors font-bold">查看</button>
                                    <button data-action="rename-sub" data-sub="${encodeURIComponent(sub)}" class="px-2 py-1 rounded-lg text-[10px] border border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900 transition-colors">重命名</button>
                                    <button data-action="delete-sub" data-sub="${encodeURIComponent(sub)}" class="px-2 py-1 rounded-lg text-[10px] border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900 transition-colors">删除</button>
                                </div>
                            </div>
                        `;
                    });
                    subList.innerHTML = subHtml;

                    const chapters = App.data.getChapters(current);
                    if (!chapters.length) {
                        chapList.innerHTML = '<div class="text-[10px] text-[var(--sub)] py-4 text-center">该科目暂无章节。</div>';
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
                                    <span class="text-[10px] text-[var(--sub)]">${count} 题</span>
                                </div>
                                <div class="flex items-center gap-1">
                                    <button data-action="rename-chap" data-sub="${encodeURIComponent(current)}" data-chap="${encodeURIComponent(chap)}" class="px-2 py-1 rounded-lg text-[10px] border border-blue-200 text-blue-600 bg-blue-50">重命名</button>
                                    <button data-action="delete-chap" data-sub="${encodeURIComponent(current)}" data-chap="${encodeURIComponent(chap)}" class="px-2 py-1 rounded-lg text-[10px] border border-red-200 text-red-600 bg-red-50">删除</button>
                                </div>
                            </div>
                        `;
                    });
                    chapList.innerHTML = chapHtml;
                },

                _bankMgrBound: false,
                _bankMgrCurrentSubject: ''
            
};