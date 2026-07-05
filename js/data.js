import { getDBItem, setDBItem, deleteDBItem } from './db.js';

export const data = {

                // 历史记录和题库存储 Key
                historyKey: 'lms_v26_history',
                bankKey: 'lms_v26_bank',
                // 回收站存储 Key
                trashKey: 'lms_v26_trash',
                bankNameKey: 'lms_v26_bank_name',

                // 刷题历史
                history: [],
                lastPracticeTime: null,

                // 题库结构：{ [subject]: { [chapter]: Question[] } }
                bank: {},
                bankName: '',
                // 回收站结构：与 bank 相同，但题目对象附带删除元信息
                trash: {},
                hiddenMistakeIds: [],

                // 运行时缓存
                _cachedQuestions: null,
                _questionMap: null,
                _errFreqCache: null,
                _isHistoryDirty: true,
                _suppressCloudSync: false,
                _lastSyncedCounts: null,
                _cloudSaveTimer: null,
                _lastSyncedQuestionIds: null,
                _bankDirty: false,
                _syncReady: false,
                _cloudLoading: false,
                _pendingSaveState: null,
                _deferredSave: false,
                remoteVersion: 0,
                // ========== 增量同步 (Incremental Sync) ==========
                _historyAppendBuffer: [],    // 自上次同步以来新增的 history 条目
                _lastHistoryTimestamp: 0,     // 上次同步时的最新 history 时间戳
                _lastEtag: null,             // 上次 load 返回的 ETag

                async init() {
                    // 无缝迁移：检测并迁移原先存储于 localStorage 的数据到 IndexedDB
                    try {
                        const keysToMigrate = [this.historyKey, this.bankKey, this.bankNameKey, this.trashKey];
                        for (const key of keysToMigrate) {
                            const legacyVal = localStorage.getItem(key);
                            if (legacyVal !== null) {
                                await setDBItem(key, legacyVal);
                                localStorage.removeItem(key);
                            }
                        }
                    } catch (e) {
                        console.error("LocalStorage to IndexedDB migration failed:", e);
                    }

                    try {
                        const hStr = await getDBItem(this.historyKey);
                        if (hStr) {
                            const parsed = JSON.parse(hStr);
                            if (parsed && Array.isArray(parsed.history)) {
                                this.history = parsed.history.filter(h =>
                                    h && typeof h.id === 'string' && typeof h.r === 'boolean' && typeof h.t === 'number'
                                );
                            } else {
                                this.history = [];
                            }
                            this.lastPracticeTime = typeof parsed.lastPracticeTime === 'number' ? parsed.lastPracticeTime : null;
                            if (parsed && Array.isArray(parsed.hiddenMistakeIds)) {
                                this.hiddenMistakeIds = parsed.hiddenMistakeIds;
                            } else {
                                this.hiddenMistakeIds = [];
                            }
                        }
                    } catch (e) { console.error("History parse error", e); }

                    try {
                        const bStr = await getDBItem(this.bankKey);
                        if (bStr) {
                            const parsed = JSON.parse(bStr);
                            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                                this.bank = parsed;
                            } else {
                                this.bank = {};
                            }
                            if (window.App && App.ai && typeof App.ai.sanitizeImportedBank === 'function') {
                                const sanitized = App.ai.sanitizeImportedBank(this.bank);
                                const before = JSON.stringify(this.bank);
                                const after = JSON.stringify(sanitized);
                                if (before !== after) {
                                    this.bank = sanitized;
                                    await setDBItem(this.bankKey, after);
                                }
                            }
                        }
                    } catch (e) { console.error("Bank parse error", e); }
                    try {
                        const nStr = await getDBItem(this.bankNameKey);
                        if (nStr && typeof nStr === 'string') {
                            this.bankName = nStr;
                        }
                    } catch (e) { }

                    // 加载回收站
                    try {
                        const tStr = await getDBItem(this.trashKey);
                        if (tStr) {
                            const parsed = JSON.parse(tStr);
                            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                                this.trash = parsed;
                            } else {
                                this.trash = {};
                            }
                        }
                    } catch (e) { console.error("Trash parse error", e); }
                },

                async _safeSetItem(key, value) {
                    try {
                        await setDBItem(key, value);
                        return true;
                    } catch (e) {
                        console.error('IndexedDB write error', e);
                        return false;
                    }
                },

                async clearAllForLogout() {
                    this.bank = {};
                    this.bankName = '';
                    this.history = [];
                    this.trash = {};
                    this.hiddenMistakeIds = [];
                    this._cachedQuestions = null;
                    this._questionMap = null;
                    this._errFreqCache = null;
                    this._isHistoryDirty = true;
                    this._lastSyncedCounts = null;
                    this._lastSyncedQuestionIds = null;
                    this._bankDirty = false;
                    this._syncReady = false;
                    this._cloudLoading = false;
                    this.remoteVersion = 0;
                    this._historyAppendBuffer = [];
                    this._lastHistoryTimestamp = 0;
                    this._lastEtag = null;
                    try {
                        await deleteDBItem(this.bankKey);
                        await deleteDBItem(this.bankNameKey);
                        await deleteDBItem(this.historyKey);
                        await deleteDBItem(this.trashKey);
                    } catch (e) {
                        console.error(e);
                    }
                },

                saveHistory() {
                    this._safeSetItem(this.historyKey, JSON.stringify({
                        history: this.history,
                        lastPracticeTime: this.lastPracticeTime,
                        hiddenMistakeIds: Array.isArray(this.hiddenMistakeIds) ? this.hiddenMistakeIds : []
                    }));
                    if (!this._suppressCloudSync && this.saveToCloudDebounced) {
                        this.saveToCloudDebounced();
                    }
                },

                validateSchema(data) {
                    if (!data || typeof data !== 'object' || Array.isArray(data)) return "Root must be an object";
                    for (const sub in data) {
                        if (typeof data[sub] !== 'object' || Array.isArray(data[sub])) return `Subject [${sub}] format error`;
                        for (const chap in data[sub]) {
                            if (!Array.isArray(data[sub][chap])) return `Chapter [${chap}] must be an array`;
                            for (let i = 0; i < data[sub][chap].length; i++) {
                                const q = data[sub][chap][i];
                                if (!q.id || !q.type || !q.q || !q.a) return `Missing core fields in [${sub}]-[${chap}] index ${i}`;
                                if (['mcq', 'multi'].includes(q.type) && (!Array.isArray(q.o) || q.o.length < 2)) {
                                    return `Invalid options array for question ID ${q.id}`;
                                }
                                // 修复 6: 归一化多选题答案 (Normalize Multi-select Answers)
                                if (q.type === 'multi' && typeof q.a === 'string') {
                                    q.a = q.a.split('').sort().join('');
                                }
                            }
                        }
                    }
                    return true;
                },

                // 最近一次导入报告，包括新增/更新/重复/相似题等统计
                _lastImportReport: null,

                importBank(jsonStr) {
                    try {
                        const prevBank = JSON.parse(JSON.stringify(this.bank || {}));
                        const prevTrash = JSON.parse(JSON.stringify(this.trash || {}));
                        const prevHistory = Array.isArray(this.history) ? this.history.slice() : [];

                        const parsed = JSON.parse(jsonStr);
                        const sanitizedInput = (window.App && App.ai && typeof App.ai.sanitizeImportedBank === 'function')
                            ? App.ai.sanitizeImportedBank(parsed)
                            : parsed;
                        const validationResult = this.validateSchema(sanitizedInput);
                        if (validationResult !== true) {
                            throw new Error(`模式校验失败 (Schema Validation Failed): ${validationResult}`);
                        }

                        // 导入统计信息与疑似相似题收集
                        const report = {
                            added: 0,
                            updated: 0,
                            skippedSame: 0,
                            importPairs: [],   // id 相同但内容不同的覆盖记录
                            similarPairs: []   // id 不同但题干高度相似的记录
                        };

                        // 构建旧题全局索引（id -> 位置与题目）
                        const globalMap = new Map();
                        for (const sub in this.bank) {
                            for (const chap in (this.bank[sub] || {})) {
                                const arr = this.bank[sub][chap] || [];
                                arr.forEach(q => {
                                    if (q && typeof q.id === 'string') {
                                        globalMap.set(q.id, { sub, chap, q });
                                    }
                                });
                            }
                        }
                        // 构建导入数据的全局索引（同 id 最后一次出现生效）
                        const importMap = new Map();
                        for (const sub in sanitizedInput) {
                            const chapters = sanitizedInput[sub] || {};
                            for (const chap in chapters) {
                                const arr = Array.isArray(chapters[chap]) ? chapters[chap] : [];
                                arr.forEach(qNew => {
                                    if (!qNew || typeof qNew !== 'object') return;
                                    if (qNew.type === 'multi' && typeof qNew.a === 'string') {
                                        qNew.a = qNew.a.split('').sort().join('');
                                    }
                                    if (typeof qNew.id !== 'string' || !qNew.id) return;
                                    importMap.set(qNew.id, { sub, chap, q: qNew });
                                });
                            }
                        }
                        // 合并：逐 id 处理，避免在章节维度上反复 push
                        importMap.forEach(({ sub, chap, q: qNew }, id) => {
                            if (!this.bank[sub]) this.bank[sub] = {};
                            if (!this.bank[sub][chap]) this.bank[sub][chap] = [];
                            const targetArr = this.bank[sub][chap];
                            const exist = globalMap.get(id);
                            if (exist) {
                                const qOld = exist.q;
                                const same =
                                    qOld.type === qNew.type &&
                                    qOld.q === qNew.q &&
                                    JSON.stringify(qOld.o || []) === JSON.stringify(qNew.o || []) &&
                                    qOld.a === qNew.a;
                                if (same) {
                                    report.skippedSame++;
                                } else {
                                    const oldArr = this.bank[exist.sub] && this.bank[exist.sub][exist.chap];
                                    if (Array.isArray(oldArr)) {
                                        const idx = oldArr.findIndex(x => x.id === id);
                                        if (idx !== -1) {
                                            const oldQ = oldArr[idx];
                                            if (!this.trash[exist.sub]) this.trash[exist.sub] = {};
                                            if (!this.trash[exist.sub][exist.chap]) this.trash[exist.sub][exist.chap] = [];
                                            this.trash[exist.sub][exist.chap].push({
                                                ...oldQ,
                                                deletedAt: Date.now(),
                                                deletedBy: 'import',
                                                reason: 'override',
                                                originalPath: { sub: exist.sub, chap: exist.chap }
                                            });
                                            oldArr.splice(idx, 1);
                                        }
                                    }
                                    targetArr.push(qNew);
                                    globalMap.set(id, { sub, chap, q: qNew });
                                    report.updated++;
                                    report.importPairs.push({
                                        sub,
                                        chap,
                                        oldId: qOld.id,
                                        newId: qNew.id,
                                        oldQ: qOld.q,
                                        newQ: qNew.q
                                    });
                                }
                            } else {
                                targetArr.push(qNew);
                                globalMap.set(id, { sub, chap, q: qNew });
                                report.added++;
                            }
                        });
                        // 对每个章节进行一次去重（按 id 保留最后一个）
                        for (const sub in this.bank) {
                            for (const chap in (this.bank[sub] || {})) {
                                const arr = this.bank[sub][chap] || [];
                                const uniq = new Map();
                                arr.forEach(q => {
                                    if (q && typeof q.id === 'string') {
                                        uniq.set(q.id, q);
                                    }
                                });
                                this.bank[sub][chap] = Array.from(uniq.values());
                            }
                        }
                        this.normalizeBankStructure();
                        if (!this.bankName) {
                            const subs = Object.keys(sanitizedInput || {});
                            if (subs.length === 1) {
                                this.bankName = subs[0];
                            } else if (subs.length > 1) {
                                this.bankName = subs[0];
                            }
                            if (this.bankName) {
                                this._safeSetItem(this.bankNameKey, this.bankName);
                            }
                        }
                        this.persistBank();
                        // 记录导入报告，供 UI 后续查看
                        this._lastImportReport = report;
                        return report;
                    } catch (e) {
                        try {
                            this.bank = JSON.parse(JSON.stringify(prevBank || {}));
                            this.trash = JSON.parse(JSON.stringify(prevTrash || {}));
                            this.history = Array.isArray(prevHistory) ? prevHistory.slice() : [];
                        } catch (rollbackError) {
                            console.error('导入回滚失败', rollbackError);
                        }
                        alert("导入失败，请检查 JSON 格式。\n(Import failed.)\n\n报错详情: " + e.message);
                        return null;
                    }
                },

                clearBank() {
                    if (confirm("确定清空题库吗？该操作不会清空您的做题记录。\n(Are you sure to clear the question bank? Practice history will be preserved.)")) {
                        this.bank = {};
                        this.persistBank();
                        App.ui.closeModal('config');
                        App.router.go('dashboard');
                    }
                },

                resetHistory() {
                    if (confirm("确定清空所有刷题记录吗？\n(Are you sure to reset all practice history?)")) {
                        this.history = [];
                        this.lastPracticeTime = null;
                        this.saveHistory();
                        App.ui.closeModal('config');
                        App.router.go('dashboard');
                    }
                },

                getQuestions() {
                    if (this._cachedQuestions) return this._cachedQuestions;

                    let list = [];
                    for (let sub in this.bank) {
                        for (let chap in this.bank[sub]) {
                            list = list.concat(this.bank[sub][chap].map(q => {
                                const rawText = [q.q, chap, q.a, ...(q.o || [])].join(' ');
                                return {
                                    ...q,
                                    sub,
                                    chap,
                                    _pinyin: App.utils.toPinyinStr(rawText)
                                };
                            }));
                        }
                    }
                    this._cachedQuestions = list;
                    return list;
                },

                getQuestionById(id) {
                    if (!this._questionMap) {
                        this._questionMap = new Map();
                        this.getQuestions().forEach(q => this._questionMap.set(q.id, q));
                    }
                    return this._questionMap.get(id);
                },

                getMistakeCount(id) {
                    if (this._isHistoryDirty || !this._errFreqCache) {
                        this._errFreqCache = new Map();
                        this.history.forEach(h => {
                            if (!h.r) this._errFreqCache.set(h.id, (this._errFreqCache.get(h.id) || 0) + 1);
                        });
                        this._isHistoryDirty = false;
                    }
                    return this._errFreqCache.get(id) || 0;
                },

                // 持久化题库
                persistBank() {
                    this._safeSetItem(this.bankKey, JSON.stringify(this.bank));
                    if (this.bankName) {
                        this._safeSetItem(this.bankNameKey, this.bankName);
                    }
                    this._cachedQuestions = null;
                    this._questionMap = null;
                    this._errFreqCache = null;
                    this._isHistoryDirty = true;
                    this._bankDirty = true;
                    if (!this._suppressCloudSync && this.saveToCloudDebounced) {
                        this.saveToCloudDebounced();
                    }
                },

                renameSubject(oldSub, newSub) {
                    const trimmed = String(newSub || '').trim();
                    if (!trimmed || trimmed === oldSub || !this.bank[oldSub]) return;
                    if (!this.bank[trimmed]) this.bank[trimmed] = {};
                    for (const chap in this.bank[oldSub]) {
                        if (!this.bank[trimmed][chap]) this.bank[trimmed][chap] = [];
                        const arr = this.bank[oldSub][chap] || [];
                        this.bank[trimmed][chap] = this.bank[trimmed][chap].concat(arr);
                    }
                    delete this.bank[oldSub];
                    if (this.trash && this.trash[oldSub]) {
                        if (!this.trash[trimmed]) this.trash[trimmed] = {};
                        for (const chap in this.trash[oldSub]) {
                            if (!this.trash[trimmed][chap]) this.trash[trimmed][chap] = [];
                            const arr = this.trash[oldSub][chap] || [];
                            this.trash[trimmed][chap] = this.trash[trimmed][chap].concat(arr);
                        }
                        delete this.trash[oldSub];
                        this.persistTrash();
                    }
                    this.normalizeBankStructure();
                    if (App && App.ui && App.ui._bankMgrCurrentSubject === oldSub) {
                        App.ui._bankMgrCurrentSubject = trimmed;
                    }
                    this.persistBank();
                },

                deleteSubject(sub) {
                    if (!this.bank[sub]) return;
                    // 收集该科目下所有题目 ID，用于清理 history
                    const deletedIds = new Set();
                    const chapDict = this.bank[sub] || {};
                    for (const chap in chapDict) {
                        const arr = chapDict[chap];
                        if (Array.isArray(arr)) arr.forEach(q => { if (q && q.id) deletedIds.add(q.id); });
                    }
                    delete this.bank[sub];
                    if (this.trash && this.trash[sub]) {
                        delete this.trash[sub];
                        this.persistTrash();
                    }
                    // Bug #5 fix: 清理被删除题目的历史记录
                    if (deletedIds.size > 0 && Array.isArray(this.history)) {
                        this.history = this.history.filter(h => !deletedIds.has(h.id));
                        this._safeSetItem(this.historyKey, JSON.stringify({
                            history: this.history,
                            lastPracticeTime: this.lastPracticeTime,
                            hiddenMistakeIds: this.hiddenMistakeIds
                        }));
                    }
                    this.persistBank();
                },

                renameChapter(sub, oldChap, newChap) {
                    if (!this.bank[sub] || !this.bank[sub][oldChap]) return;
                    const trimmed = String(newChap || '').trim();
                    if (!trimmed || trimmed === oldChap) return;
                    if (!this.bank[sub][trimmed]) this.bank[sub][trimmed] = [];
                    const arr = this.bank[sub][oldChap] || [];
                    this.bank[sub][trimmed] = this.bank[sub][trimmed].concat(arr);
                    delete this.bank[sub][oldChap];
                    if (!Object.keys(this.bank[sub] || {}).length) delete this.bank[sub];
                    if (this.trash && this.trash[sub] && this.trash[sub][oldChap]) {
                        if (!this.trash[sub][trimmed]) this.trash[sub][trimmed] = [];
                        const tArr = this.trash[sub][oldChap] || [];
                        this.trash[sub][trimmed] = this.trash[sub][trimmed].concat(tArr);
                        delete this.trash[sub][oldChap];
                        if (!Object.keys(this.trash[sub] || {}).length) delete this.trash[sub];
                        this.persistTrash();
                    }
                    this.normalizeBankStructure();
                    this.persistBank();
                },

                deleteChapter(sub, chap) {
                    if (!this.bank[sub] || !this.bank[sub][chap]) return;
                    // 收集该章节下所有题目 ID，用于清理 history
                    const deletedIds = new Set();
                    const arr = this.bank[sub][chap];
                    if (Array.isArray(arr)) arr.forEach(q => { if (q && q.id) deletedIds.add(q.id); });
                    delete this.bank[sub][chap];
                    if (!Object.keys(this.bank[sub] || {}).length) delete this.bank[sub];
                    if (this.trash && this.trash[sub] && this.trash[sub][chap]) {
                        delete this.trash[sub][chap];
                        if (!Object.keys(this.trash[sub] || {}).length) delete this.trash[sub];
                        this.persistTrash();
                    }
                    // Bug #5 fix: 清理被删除题目的历史记录
                    if (deletedIds.size > 0 && Array.isArray(this.history)) {
                        this.history = this.history.filter(h => !deletedIds.has(h.id));
                        this._safeSetItem(this.historyKey, JSON.stringify({
                            history: this.history,
                            lastPracticeTime: this.lastPracticeTime,
                            hiddenMistakeIds: this.hiddenMistakeIds
                        }));
                    }
                    this.persistBank();
                },

                normalizeBankStructure() {
                    const bank = this.bank || {};
                    for (const sub in bank) {
                        const chapDict = bank[sub];
                        if (!chapDict || typeof chapDict !== 'object') continue;
                        for (const chap in chapDict) {
                            const arr = chapDict[chap];
                            if (!Array.isArray(arr)) continue;
                            arr.forEach(q => {
                                if (!q || typeof q !== 'object') return;
                                if (q.sub !== sub) q.sub = sub;
                                if (q.chap !== chap) q.chap = chap;
                            });
                        }
                    }
                },

                renameSubjectInteractive(sub) {
                    const next = window.prompt('请输入新的科目名称', sub);
                    if (!next || next.trim() === sub) return;
                    this.renameSubject(sub, next.trim());
                    if (App && App.ui && typeof App.ui.renderBankManager === 'function') {
                        App.ui.renderBankManager();
                    }
                },

                deleteSubjectInteractive(sub) {
                    if (!window.confirm(`确定要删除科目「${sub}」及其所有章节和题目吗？`)) return;
                    this.deleteSubject(sub);
                    if (App && App.ui && typeof App.ui.renderBankManager === 'function') {
                        App.ui.renderBankManager();
                    }
                },

                renameChapterInteractive(sub, chap) {
                    const next = window.prompt(`请输入新的章节名称（${sub}）`, chap);
                    if (!next || next.trim() === chap) return;
                    this.renameChapter(sub, chap, next.trim());
                    if (App && App.ui && typeof App.ui.renderBankManager === 'function') {
                        App.ui.renderBankManager();
                    }
                },

                deleteChapterInteractive(sub, chap) {
                    if (!window.confirm(`确定要删除章节「${sub} / ${chap}」及其所有题目吗？`)) return;
                    this.deleteChapter(sub, chap);
                    if (App && App.ui && typeof App.ui.renderBankManager === 'function') {
                        App.ui.renderBankManager();
                    }
                },

                /**
                 * 核心方法：保存数据到云端 (Core: Save to Cloud)
                 * 包含防抖 (Debounce)、锁机制 (Locking) 和增量更新逻辑
                 */
                async saveToCloud() {
                    // 1. 并发锁：如果正在保存或正在加载，则标记为"需要再次保存"并返回
                    // 这防止了多个并发请求导致的版本冲突 (409 Error)
                    if (this._isSaving) {
                        this._saveAgainPending = true;
                        return;
                    }
                    if (this._cloudLoading) {
                        this._saveAgainPending = true;
                        return;
                    }

                    if (!App.auth || typeof App.auth.getToken !== 'function') return;
                    this._isSaving = true;
                    try {
                        const token = await App.auth.getToken();
                        if (!token) return;

                        // 2. 确保在保存前已经从云端加载过最新数据
                        if (!this._syncReady) {
                            await this.loadFromCloud();
                            // If load failed or is still pending (should be awaited), check ready again
                            if (!this._syncReady) return;
                        }
                        const bank = this.bank || {};
                        const history = Array.isArray(this.history) ? this.history : [];
                        const trash = this.trash || {};
                        const lastPracticeTime = this.lastPracticeTime || null;
                        this.normalizeBankStructure();
                        const questions = [];
                        let totalTrash = 0;

                        // 3. 扁平化题库结构，便于统计和传输
                        for (const sub in bank) {
                            if (!bank[sub]) continue;
                            for (const chap in bank[sub]) {
                                const arr = bank[sub][chap];
                                if (!Array.isArray(arr)) continue;
                                arr.forEach(q => {
                                    if (q && typeof q === 'object') {
                                        questions.push(q);
                                    }
                                });
                            }
                        }
                        for (const sub in trash) {
                            if (!trash[sub]) continue;
                            for (const chap in trash[sub]) {
                                const arr = trash[sub][chap];
                                if (!Array.isArray(arr)) continue;
                                totalTrash += arr.length;
                            }
                        }
                        if (!questions.length && !history.length && !totalTrash) return;

                        const counts = {
                            questions: questions.length,
                            history: history.length,
                            trash: totalTrash
                        };
                        const prev = this._lastSyncedCounts || { questions: 0, history: 0, trash: 0 };
                        const delta = {
                            questions: counts.questions - prev.questions,
                            history: counts.history - prev.history,
                            trash: counts.trash - prev.trash
                        };
                        const inferredName = this.bankName || Object.keys(bank || {})[0] || "默认题库";

                        // 4. 优化：如果题库内容没有变动（Dirty Flag 为 false），则跳过全量题目上传
                        // 仅更新元数据 (State) 和历史记录，节省带宽
                        const skipQuestionsUpdate = !this._bankDirty && delta.questions === 0;

                        // ========== 增量同步决策 ==========
                        // 如果只有 history 变动（bank/trash 没变），使用增量模式
                        const historyBuffer = Array.isArray(this._historyAppendBuffer) ? this._historyAppendBuffer : [];
                        const useIncrementalSync = !this._bankDirty
                            && delta.questions === 0
                            && delta.trash === 0
                            && historyBuffer.length > 0;

                        if (window.App && App.sync && typeof App.sync.setDebug === 'function') {
                            App.sync.setDebug({
                                time: Date.now(),
                                name: inferredName,
                                questionsCount: questions.length,
                                historyCount: history.length,
                                trashCount: totalTrash,
                                skipQuestionsUpdate,
                                useIncrementalSync,
                                historyBufferSize: historyBuffer.length,
                                version: typeof this.remoteVersion === "number" ? this.remoteVersion : 0
                            });
                        }

                        // 5. 构造要保存的完整状态树
                        const state = {
                            bank,
                            bankName: this.bankName || null,
                            history,
                            lastPracticeTime,
                            trash,
                            hiddenMistakeIds: Array.isArray(this.hiddenMistakeIds) ? this.hiddenMistakeIds : []
                        };
                        const allIds = [];
                        for (const sub in bank) {
                            for (const chap in bank[sub]) {
                                const arr = bank[sub][chap];
                                if (!Array.isArray(arr)) continue;
                                arr.forEach(q => {
                                    if (q && typeof q.id === 'string') allIds.push(q.id);
                                });
                            }
                        }
                        const prevIds = Array.isArray(this._lastSyncedQuestionIds) ? this._lastSyncedQuestionIds : [];
                        const prevSet = new Set(prevIds);
                        const currSet = new Set(allIds);
                        const addedIds = [];
                        const removedIds = [];
                        currSet.forEach(id => {
                            if (!prevSet.has(id)) addedIds.push(id);
                        });
                        prevSet.forEach(id => {
                            if (!currSet.has(id)) removedIds.push(id);
                        });


                        let res;
                        try {
                            if (window.App && App.sync && typeof App.sync.setStatus === 'function') {
                                App.sync.setStatus('pending', null, null);
                            }
                            if (!this._pendingSaveState) {
                                this._pendingSaveState = {
                                    bank: JSON.parse(JSON.stringify(this.bank || {})),
                                    history: Array.isArray(this.history) ? this.history.slice() : [],
                                    trash: JSON.parse(JSON.stringify(this.trash || {})),
                                    lastPracticeTime: this.lastPracticeTime || null,
                                    hiddenMistakeIds: Array.isArray(this.hiddenMistakeIds) ? this.hiddenMistakeIds.slice() : [],
                                    bankName: this.bankName || ''
                                };
                            }
                            res = await fetch((App.apiBase || '') + "/api/save-question-set", {
                                method: "POST",
                                headers: {
                                    "Content-Type": "application/json",
                                    Authorization: "Bearer " + token
                                },
                                body: JSON.stringify(useIncrementalSync ? {
                                    // ========== 增量模式：仅发送新增 history ==========
                                    name: inferredName,
                                    statePartial: true,
                                    historyAppend: historyBuffer,
                                    skipQuestionsUpdate: true,
                                    version: typeof this.remoteVersion === "number" ? this.remoteVersion : 0,
                                    partialFields: ['lastPracticeTime'],
                                    partialValues: { lastPracticeTime: lastPracticeTime },
                                    delta: {
                                        questions: 0,
                                        history: historyBuffer.length,
                                        trash: 0,
                                        incremental: true
                                    }
                                } : {
                                    // ========== 全量模式（原逻辑） ==========
                                    name: inferredName,
                                    questions,
                                    state,
                                    skipQuestionsUpdate,
                                    version: typeof this.remoteVersion === "number" ? this.remoteVersion : 0,
                                    // 同时附带 historyAppend 以防万一
                                    historyAppend: historyBuffer.length > 0 ? historyBuffer : undefined,
                                    delta: {
                                        questions: delta.questions,
                                        history: delta.history,
                                        trash: delta.trash,
                                        questionIds: {
                                            added: addedIds,
                                            removed: removedIds
                                        }
                                    }
                                })
                            });
                        } catch (e) {
                            console.error("保存题库到云端失败", e);
                            if (window.App && App.sync && typeof App.sync.showSyncStatus === 'function') {
                                App.sync.showSyncStatus('error', delta, '网络错误或无法连接服务器');
                            }
                            return;
                        }
                        try {
                            const data = await res.json();
                            if (!res.ok || !data) {
                                console.error("保存题库到云端失败", data);
                                if (window.App && App.sync && typeof App.sync.showSyncStatus === 'function') {
                                    const msg = (data && (data.error || data.detail)) || '未知错误';
                                    App.sync.showSyncStatus('error', delta, msg);
                                }
                                if (res.status === 409 && window.App && App.data && typeof App.data.loadFromCloud === "function") {
                                    try {
                                        // Temporarily release lock to allow loadFromCloud
                                        this._isSaving = false;
                                        await App.data.loadFromCloud();
                                        this._isSaving = true;

                                        if (typeof this._retryAfterConflictOnce !== 'number') this._retryAfterConflictOnce = 0;
                                        if (this._retryAfterConflictOnce < 1) {
                                            this._retryAfterConflictOnce++;
                                            if (this._pendingSaveState) {
                                                this._suppressCloudSync = true;
                                                const s = this._pendingSaveState;
                                                this.bank = s.bank || {};
                                                this.history = Array.isArray(s.history) ? s.history : [];
                                                this.trash = s.trash || {};
                                                this.lastPracticeTime = s.lastPracticeTime || null;
                                                this.hiddenMistakeIds = Array.isArray(s.hiddenMistakeIds) ? s.hiddenMistakeIds : [];
                                                this.bankName = s.bankName || this.bankName;
                                                this._safeSetItem(this.bankKey, JSON.stringify(this.bank));
                                                this._safeSetItem(this.historyKey, JSON.stringify({
                                                    history: this.history,
                                                    lastPracticeTime: this.lastPracticeTime,
                                                    hiddenMistakeIds: this.hiddenMistakeIds
                                                }));
                                                this._safeSetItem(this.trashKey, JSON.stringify(this.trash));
                                                if (this.bankName) this._safeSetItem(this.bankNameKey, this.bankName);
                                                this._bankDirty = true;
                                                this._suppressCloudSync = false;
                                            }
                                            // Trigger retry via saveAgainPending logic
                                            this._saveAgainPending = true;
                                        } else {
                                            this._retryAfterConflictOnce = 0;
                                        }
                                    } catch (e) {
                                        console.error("loadFromCloud after conflict failed", e);
                                        this._isSaving = true; // Restore lock if it was released
                                    }
                                }
                            } else {
                                this._lastSyncedCounts = counts;
                                this._lastSyncedQuestionIds = allIds;
                                if (typeof data.version === "number" && Number.isFinite(data.version)) {
                                    this.remoteVersion = data.version;
                                }
                                if (window.App && App.sync && typeof App.sync.showSyncStatus === 'function') {
                                    App.sync.showSyncStatus('success', delta);
                                }
                                this._bankDirty = false;
                                this.bankName = inferredName;
                                this._safeSetItem(this.bankNameKey, this.bankName);
                                this._retryAfterConflictOnce = 0;
                                this._pendingSaveState = null;
                                // ========== 增量同步：清空 buffer ==========
                                this._historyAppendBuffer = [];
                                // 更新最后同步的 history 时间戳
                                if (this.history.length > 0) {
                                    this._lastHistoryTimestamp = this.history[this.history.length - 1].t || 0;
                                }
                            }
                        } catch (e) {
                            console.error("解析云端保存响应失败", e);
                            if (window.App && App.sync && typeof App.sync.showSyncStatus === 'function') {
                                App.sync.showSyncStatus('error', delta, '解析服务器响应失败');
                            }
                        }
                    } finally {
                        this._isSaving = false;
                        if (this._saveAgainPending) {
                            this._saveAgainPending = false;
                            this.saveToCloudDebounced();
                        }
                    }
                },

                saveToCloudDebounced() {
                    if (this._cloudSaveTimer) {
                        clearTimeout(this._cloudSaveTimer);
                    }
                    if (!App.auth || !App.auth.session) return;
                    if (!this._syncReady) {
                        this._deferredSave = true;
                        this.loadFromCloud();
                        return;
                    }
                    if (window.App && App.sync && typeof App.sync.setStatus === 'function') {
                        App.sync.setStatus('pending', null, null);
                    }
                    this._cloudSaveTimer = setTimeout(() => {
                        this._cloudSaveTimer = null;
                        this.saveToCloud();
                    }, 400);
                },

                /**
                 * 核心方法：从云端加载数据 (Core: Load from Cloud)
                 * 处理数据合并、版本校验和状态恢复
                 */
                async loadFromCloud() {
                    if (!App.auth || typeof App.auth.getToken !== 'function') return;

                    // 1. 并发控制：如果已经在加载中，直接返回当前的 Promise
                    // 避免重复请求浪费资源
                    if (this._cloudLoading) {
                        if (this._loadPromise) return this._loadPromise;
                        return;
                    }
                    this._cloudLoading = true;
                    this._loadPromise = (async () => {
                        try {
                            const token = await App.auth.getToken();
                            if (!token) return;

                            let res;
                            try {
                                // ========== ETag + 增量加载 ==========
                                let loadUrl = (App.apiBase || '') + "/api/load-question-set";
                                // 如果已经成功加载过，发送 historyAfter 参数加速后续加载
                                if (this._lastHistoryTimestamp > 0 && this._syncReady) {
                                    loadUrl += '?historyAfter=' + this._lastHistoryTimestamp;
                                }
                                const headers = {
                                    Authorization: "Bearer " + token
                                };
                                // ETag: 如果有上次的 ETag，发送 If-None-Match
                                if (this._lastEtag) {
                                    headers['If-None-Match'] = this._lastEtag;
                                }
                                res = await fetch(loadUrl, {
                                    method: "GET",
                                    headers
                                });
                            } catch (e) {
                                console.error("从云端加载题库失败", e);
                                this._syncReady = true;
                                if (this._deferredSave) {
                                    this._deferredSave = false;
                                    this.saveToCloudDebounced();
                                }
                                return;
                            }
                            // ========== 304 Not Modified: 数据未变化，跳过处理 ==========
                            if (res.status === 304) {
                                this._syncReady = true;
                                if (this._deferredSave) {
                                    this._deferredSave = false;
                                    this.saveToCloudDebounced();
                                }
                                return;
                            }
                            if (!res.ok) {
                                console.error("从云端加载题库失败", res.status);
                                if (window.App && App.sync && typeof App.sync.showSyncStatus === 'function') {
                                    App.sync.showSyncStatus('error', null, '从云端加载题库失败 (HTTP ' + res.status + ')');
                                }
                                this._syncReady = true;
                                if (this._deferredSave) {
                                    this._deferredSave = false;
                                    this.saveToCloudDebounced();
                                }
                                return;
                            }
                            // 保存 ETag
                            const newEtag = res.headers.get('etag');
                            if (newEtag) {
                                this._lastEtag = newEtag;
                            }
                            let data;
                            try {
                                data = await res.json();
                            } catch (e) {
                                console.error("解析云端题库响应失败", e);
                                this._syncReady = true;
                                if (this._deferredSave) {
                                    this._deferredSave = false;
                                    this.saveToCloudDebounced();
                                }
                                return;
                            }
                            if (!data || !data.ok) {
                                return;
                            }

                            // 2. 解析云端返回的数据包
                            const state = data.state && typeof data.state === "object" ? data.state : null;
                            if (!state) {
                                // 如果云端是空的（新用户），初始化版本号
                                if (typeof data.version === "number" && Number.isFinite(data.version)) {
                                    this.remoteVersion = data.version;
                                } else {
                                    this.remoteVersion = 0;
                                }
                                this._syncReady = true;
                                if (this._deferredSave) {
                                    this._deferredSave = false;
                                    this.saveToCloudDebounced();
                                }
                                return;
                            }

                            // 3. 应用数据到本地
                            // _suppressCloudSync 标志位防止应用数据时触发不必要的自动保存
                            this._suppressCloudSync = true;
                            if (typeof data.version === "number" && Number.isFinite(data.version)) {
                                this.remoteVersion = data.version;
                            } else {
                                this.remoteVersion = 0;
                            }
                            this.bank = state.bank && typeof state.bank === "object" ? state.bank : {};
                            // ========== 增量 history 合并 ==========
                            if (data.historyPartial && Array.isArray(state.history)) {
                                // 服务端返回的是增量 history，合并到本地而非替换
                                const existingTimestamps = new Set(this.history.map(h => h.t));
                                const newEntries = state.history.filter(h => !existingTimestamps.has(h.t));
                                if (newEntries.length > 0) {
                                    this.history = this.history.concat(newEntries);
                                }
                            } else {
                                this.history = Array.isArray(state.history) ? state.history : [];
                            }
                            // 更新 _lastHistoryTimestamp
                            if (this.history.length > 0) {
                                const maxT = this.history.reduce((m, h) => Math.max(m, h.t || 0), 0);
                                this._lastHistoryTimestamp = maxT;
                            }
                            this.lastPracticeTime =
                                typeof state.lastPracticeTime === "number" ? state.lastPracticeTime : null;
                            this.trash = state.trash && typeof state.trash === "object" ? state.trash : {};
                            this.hiddenMistakeIds = Array.isArray(state.hiddenMistakeIds) ? state.hiddenMistakeIds : [];
                            this.bankName = typeof data.name === "string" && data.name ? data.name : (state.bankName || this.bankName || '');
                            if (this.bankName) {
                                this._safeSetItem(this.bankNameKey, this.bankName);
                            }
                            // 持久化到 LocalStorage
                            this._safeSetItem(this.bankKey, JSON.stringify(this.bank));
                            this._safeSetItem(this.historyKey, JSON.stringify({
                                history: this.history,
                                lastPracticeTime: this.lastPracticeTime,
                                hiddenMistakeIds: this.hiddenMistakeIds
                            }));
                            this._safeSetItem(this.trashKey, JSON.stringify(this.trash));
                            const bankCount = (() => {
                                let n = 0;
                                for (const sub in this.bank) {
                                    for (const chap in this.bank[sub] || {}) {
                                        const arr = this.bank[sub][chap];
                                        if (Array.isArray(arr)) n += arr.length;
                                    }
                                }
                                return n;
                            })();
                            const allIds = [];
                            for (const sub in this.bank) {
                                for (const chap in this.bank[sub]) {
                                    const arr = this.bank[sub][chap];
                                    if (!Array.isArray(arr)) continue;
                                    arr.forEach(q => {
                                        if (q && typeof q.id === 'string') allIds.push(q.id);
                                    });
                                }
                            }
                            const trashCount = (() => {
                                let n = 0;
                                for (const sub in this.trash) {
                                    for (const chap in this.trash[sub] || {}) {
                                        const arr = this.trash[sub][chap];
                                        if (Array.isArray(arr)) n += arr.length;
                                    }
                                }
                                return n;
                            })();
                            this._lastSyncedCounts = {
                                questions: bankCount,
                                history: this.history.length,
                                trash: trashCount
                            };
                            this._lastSyncedQuestionIds = allIds;
                            this._bankDirty = false;
                            this._syncReady = true;
                            this._suppressCloudSync = false;
                            if (window.App && App.router && typeof App.router.refresh === 'function') {
                                App.router.refresh();
                            }
                            if (this._deferredSave) {
                                this._deferredSave = false;
                                this.saveToCloudDebounced();
                            }
                        } finally {
                            this._cloudLoading = false;
                            this._loadPromise = null;
                        }
                    })();

                    return this._loadPromise;
                },

                // 持久化回收站
                persistTrash() {
                    this._safeSetItem(this.trashKey, JSON.stringify(this.trash));
                    if (!this._suppressCloudSync && this.saveToCloudDebounced) {
                        this.saveToCloudDebounced();
                    }
                },

                /**
                 * 软删除：将指定 ID 的题目从 bank 移动到 trash
                 */
                softDeleteByIds(idSet, reason = 'manual-delete') {
                    const now = Date.now();
                    let changed = false;

                    for (const sub in this.bank) {
                        for (const chap in this.bank[sub]) {
                            const arr = this.bank[sub][chap];
                            if (!Array.isArray(arr) || !arr.length) continue;

                            const remain = [];
                            arr.forEach(q => {
                                if (!idSet.has(q.id)) {
                                    remain.push(q);
                                } else {
                                    if (!this.trash[sub]) this.trash[sub] = {};
                                    if (!this.trash[sub][chap]) this.trash[sub][chap] = [];
                                    this.trash[sub][chap].push({
                                        ...q,
                                        deletedAt: now,
                                        deletedBy: 'user',
                                        reason,
                                        originalPath: { sub, chap }
                                    });
                                    changed = true;
                                }
                            });

                            this.bank[sub][chap] = remain;
                        }
                    }

                    // 同步清理历史记录中已被删除题目的答题记录，保持统计数据一致
                    if (idSet && idSet.size > 0 && Array.isArray(this.history) && this.history.length) {
                        const beforeLen = this.history.length;
                        this.history = this.history.filter(h => !idSet.has(h.id));
                        if (this.history.length !== beforeLen) {
                            this.saveHistory();
                            this._isHistoryDirty = true;
                        }
                    }

                    if (changed) {
                        this.persistBank();
                        this.persistTrash();
                    }
                },

                // 从回收站恢复单题
                restoreFromTrash(sub, chap, id) {
                    if (!this.trash[sub] || !this.trash[sub][chap]) return;
                    const arr = this.trash[sub][chap];
                    const idx = arr.findIndex(q => q.id === id);
                    if (idx === -1) return;

                    const q = arr[idx];
                    const targetSub = q.originalPath?.sub || sub;
                    const targetChap = q.originalPath?.chap || chap;
                    const { deletedAt, deletedBy, reason, originalPath, ...cleanQ } = q;

                    if (!this.bank[targetSub]) this.bank[targetSub] = {};
                    if (!this.bank[targetSub][targetChap]) this.bank[targetSub][targetChap] = [];
                    this.bank[targetSub][targetChap].push(cleanQ);

                    arr.splice(idx, 1);
                    if (!arr.length) delete this.trash[sub][chap];
                    if (!Object.keys(this.trash[sub] || {}).length) delete this.trash[sub];

                    this.persistBank();
                    this.persistTrash();
                },

                // 从回收站彻底删除
                destroyFromTrash(sub, chap, id) {
                    if (!this.trash[sub] || !this.trash[sub][chap]) return;
                    const arr = this.trash[sub][chap];
                    const idx = arr.findIndex(q => q.id === id);
                    if (idx === -1) return;

                    arr.splice(idx, 1);
                    if (!arr.length) delete this.trash[sub][chap];
                    if (!Object.keys(this.trash[sub] || {}).length) delete this.trash[sub];

                    this.persistTrash();
                },

                // 清空回收站
                emptyTrash() {
                    if (!confirm("确定要清空回收站中的所有题目吗？该操作不可恢复。")) return;
                    this.trash = {};
                    this.persistTrash();
                    if (window.App && App.ui && typeof App.ui.openTrashModal === 'function') {
                        App.ui.openTrashModal();
                    }
                },

                _idCounter: 0,

                generateQuestionId() {
                    if (typeof this._idCounter !== 'number') this._idCounter = 0;
                    return `q-${Date.now()}-${(this._idCounter++).toString(36)}-${Math.random().toString(36).slice(2, 4)}`;
                },

                upsertQuestion(question) {
                    const q = { ...question };
                    if (!q.id || typeof q.id !== 'string') {
                        q.id = this.generateQuestionId();
                    }

                    if (!this.bank[q.sub]) this.bank[q.sub] = {};
                    if (!this.bank[q.sub][q.chap]) this.bank[q.sub][q.chap] = [];

                    // 删除全局旧 ID
                    for (const sub in this.bank) {
                        for (const chap in this.bank[sub]) {
                            const arr = this.bank[sub][chap];
                            const idx = arr.findIndex(x => x.id === q.id);
                            if (idx !== -1) {
                                arr.splice(idx, 1);
                                if (!arr.length) delete this.bank[sub][chap];
                            }
                        }
                        if (!Object.keys(this.bank[sub] || {}).length) delete this.bank[sub];
                    }

                    this.bank[q.sub][q.chap].push(q);
                    this.persistBank();
                },

                removeQuestionsById(idSet) {
                    let changed = false;
                    for (const sub in this.bank) {
                        for (const chap in this.bank[sub]) {
                            const arr = this.bank[sub][chap];
                            const next = arr.filter(q => !idSet.has(q.id));
                            if (next.length !== arr.length) {
                                this.bank[sub][chap] = next;
                                changed = true;
                            }
                        }
                    }
                    if (changed) this.persistBank();
                },

                getSubjects() { return Object.keys(this.bank); },
                getChapters(sub) { return this.bank[sub] ? Object.keys(this.bank[sub]) : []; },

                getStats() {
                    const all = this.getQuestions();
                    const h = this.history;
                    const corr = h.filter(x => x.r).length;
                    const errFreq = {};
                    h.filter(x => !x.r).forEach(x => { errFreq[x.id] = (errFreq[x.id] || 0) + 1; });

                    const topMistakes = Object.entries(errFreq).sort((a, b) => b[1] - a[1]).slice(0, 10)
                        .map(([id, count]) => { const q = this.getQuestionById(id); return q ? { ...q, count, a: q.a, type: q.type, o: q.o } : null; }).filter(Boolean);

                    let timeText = '从未练习 (Never Practiced)';
                    if (this.lastPracticeTime) {
                        const diff = Date.now() - this.lastPracticeTime;
                        const mins = Math.floor(diff / 60000);
                        if (mins < 60) {
                            timeText = `距离上次练习已过去：${mins}分钟 (Minutes ago)`;
                        } else {
                            const hrs = Math.floor(mins / 60);
                            const m = mins % 60;
                            timeText = `距离上次练习已过去：${hrs}小时${m}分钟`;
                        }
                    }

                    const subjectStats = {};
                    this.getSubjects().forEach(sub => {
                        const subQids = new Set(all.filter(q => q.sub === sub).map(q => q.id));
                        const subH = h.filter(x => subQids.has(x.id));
                        subjectStats[sub] = {
                            attempts: subH.length,
                            correct: subH.filter(x => x.r).length,
                            acc: subH.length ? Math.round(subH.filter(x => x.r).length / subH.length * 100) : 0
                        };
                    });

                    const typeStats = { mcq: { a: 0, c: 0 }, tf: { a: 0, c: 0 }, multi: { a: 0, c: 0 } };
                    h.forEach(x => {
                        const q = this.getQuestionById(x.id);
                        if (!q || !typeStats[q.type]) return;
                        typeStats[q.type].a++;
                        if (x.r) typeStats[q.type].c++;
                    });
                    Object.keys(typeStats).forEach(t => {
                        typeStats[t].acc = typeStats[t].a ? Math.round(typeStats[t].c / typeStats[t].a * 100) : 0;
                    });

                    const daily30 = [];
                    for (let i = 29; i >= 0; i--) {
                        const d = new Date(); d.setDate(d.getDate() - i);
                        const ds = d.toISOString().slice(0, 10);
                        const recs = h.filter(x => new Date(x.t).toISOString().slice(0, 10) === ds);
                        daily30.push({
                            date: ds,
                            label: `${d.getMonth() + 1}/${d.getDate()}`,
                            attempts: recs.length,
                            correct: recs.filter(x => x.r).length,
                            acc: recs.length ? Math.round(recs.filter(x => x.r).length / recs.length * 100) : null
                        });
                    }

                    const durRecords = h.filter(x => x.d > 0);
                    const avgDuration = durRecords.length
                        ? Math.round(durRecords.reduce((s, x) => s + x.d, 0) / durRecords.length / 1000)
                        : null;

                    const durBuckets = [0, 0, 0, 0, 0];
                    durRecords.forEach(x => {
                        const s = x.d / 1000;
                        if (s < 5) durBuckets[0]++;
                        else if (s < 15) durBuckets[1]++;
                        else if (s < 30) durBuckets[2]++;
                        else if (s < 60) durBuckets[3]++;
                        else durBuckets[4]++;
                    });

                    let streak = 0;
                    for (let i = 0; i <= 365; i++) {
                        const d = new Date(); d.setDate(d.getDate() - i);
                        const ds = d.toISOString().slice(0, 10);
                        if (h.some(x => new Date(x.t).toISOString().slice(0, 10) === ds)) streak++;
                        else break;
                    }

                    const subEntries = Object.entries(subjectStats).filter(([, v]) => v.attempts > 0);
                    const bestSub = subEntries.sort((a, b) => b[1].acc - a[1].acc)[0]?.[0] || null;
                    const worstSub = [...subEntries].sort((a, b) => a[1].acc - b[1].acc)[0]?.[0] || null;

                    return {
                        total: all.length,
                        acc: h.length ? Math.round((corr / h.length) * 100) : 0,
                        mistakes: Object.keys(errFreq).length,
                        topMistakes,
                        timeText,
                        subjectStats,
                        typeStats,
                        daily30,
                        avgDuration,
                        durBuckets,
                        streak,
                        bestSub,
                        worstSub,
                        totalAttempts: h.length,
                        totalCorrect: corr
                    };
                },
                clearMistakeHistory(id) {
                    if (!Array.isArray(this.hiddenMistakeIds)) this.hiddenMistakeIds = [];
                    if (!this.hiddenMistakeIds.includes(id)) {
                        this.hiddenMistakeIds.push(id);
                    }
                    this._errFreqCache = null;
                    this._isHistoryDirty = true;
                    this.saveHistory();
                },
                record(id, res, duration = 0) {
                    const now = Date.now();
                    const entry = { id, r: res, t: now, d: duration };
                    this.history.push(entry);
                    // 增量同步：同时追加到 buffer，供下次 save 时发送
                    this._historyAppendBuffer.push(entry);
                    this.lastPracticeTime = now;
                    this._isHistoryDirty = true;
                    this.saveHistory();
                }
            
};

export const sync = {

                _lastStatus: 'success',
                _realtimeDisconnected: false,
                _lastMessage: '',
                _lastSyncDebug: null,
                render() {
                    const btn = App.dom.get('save-cloud-btn');
                    const icon = document.getElementById('sync-indicator-icon');
                    const textEl = document.getElementById('sync-text');
                    if (!btn || !icon) return;

                    // Reset classes on dot and button
                    btn.className = "flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all duration-200 active:scale-95 border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50";
                    icon.className = "w-2 h-2 rounded-full transition-all duration-300";
                    
                    let titleText = '';
                    let statusText = '已同步';

                    if (this._lastStatus === 'error') {
                        btn.classList.add('border-red-400', 'bg-red-500/5');
                        icon.classList.add('bg-red-500', 'shadow-[0_0_8px_rgba(239,68,68,0.4)]');
                        statusText = '同步失败';
                        titleText = '最近同步：失败（' + (this._lastMessage || '同步失败') + '）';
                    } else if (this._lastStatus === 'pending') {
                        btn.classList.add('border-primary-500', 'bg-primary-500/5');
                        icon.classList.add('bg-primary-500', 'animate-pulse');
                        statusText = '同步中...';
                        titleText = '同步中...';
                    } else if (this._realtimeDisconnected) {
                        btn.classList.add('border-yellow-400', 'bg-yellow-500/5');
                        icon.classList.add('bg-yellow-500');
                        statusText = '未连接';
                        titleText = '实时通道未连接' + (this._lastMessage ? '（' + this._lastMessage + '）' : '');
                    } else {
                        btn.classList.add('border-emerald-500', 'bg-emerald-500/5');
                        icon.classList.add('bg-emerald-500');
                        statusText = '已同步';
                        titleText = '最近同步：成功';
                    }

                    if (textEl) {
                        textEl.textContent = statusText;
                    }
                    btn.title = titleText;
                },
                setStatus(status, delta, message) {
                    this._lastStatus = status || 'success';
                    this._lastMessage = message || '';
                    this.render();
                },
                setDebug(info) {
                    this._lastSyncDebug = info;
                },
                showSyncStatus(status, delta, message) {
                    this.setStatus(status, delta, message);
                    if (status === 'error') {
                        const toast = document.getElementById('sync-toast');
                        if (toast) {
                            toast.textContent = message || '同步失败';
                            toast.classList.remove('opacity-0');
                            toast.classList.add('opacity-100');
                            if (this._toastTimer) {
                                clearTimeout(this._toastTimer);
                            }
                            this._toastTimer = setTimeout(() => {
                                toast.classList.add('opacity-0');
                                toast.classList.remove('opacity-100');
                            }, 5000);
                        }
                    }
                },
                async openLogPanel() {
                    if (!App.auth || typeof App.auth.getToken !== 'function') return;
                    const token = await App.auth.getToken();
                    if (!token) return;
                    let res;
                    try {
                        res = await fetch((App.apiBase || '') + '/api/sync-logs', {
                            method: 'GET',
                            headers: {
                                Authorization: 'Bearer ' + token
                            }
                        });
                    } catch (e) {
                        console.error('获取同步记录失败', e);
                        return;
                    }
                    if (!res.ok) {
                        console.error('获取同步记录失败', res.status);
                        return;
                    }
                    let data;
                    try {
                        data = await res.json();
                    } catch (e) {
                        console.error('解析同步记录失败', e);
                        return;
                    }
                    const list = document.getElementById('sync-log-list');
                    const modal = document.getElementById('sync-log-modal');
                    const debugPanel = document.getElementById('sync-debug-panel');
                    if (!list || !modal) return;
                    if (debugPanel) {
                        const dbg = this._lastSyncDebug;
                        if (!dbg) {
                            debugPanel.innerHTML = '<div class="text-[var(--sub)]">暂无诊断信息</div>';
                        } else {
                            const time = dbg.time ? new Date(dbg.time).toLocaleString() : '';
                            debugPanel.innerHTML = `
                                <div class="flex flex-col gap-1">
                                    <div class="text-[10px] uppercase tracking-wider text-[var(--sub)]">同步诊断</div>
                                    <div>时间：${App.utils.escapeHTML(time)}</div>
                                    <div>题库：${App.utils.escapeHTML(dbg.name || '')}</div>
                                    <div>questions=${dbg.questionsCount} / history=${dbg.historyCount} / trash=${dbg.trashCount}</div>
                                    <div>skipQuestionsUpdate=${dbg.skipQuestionsUpdate ? 'true' : 'false'} / version=${dbg.version}</div>
                                </div>
                            `;
                        }
                    }
                    list.innerHTML = '';
                    const logs = data && data.ok && Array.isArray(data.logs) ? data.logs : [];
                    if (!logs.length) {
                        list.innerHTML = '<div class="text-[var(--sub)] text-xs py-4 text-center">暂无同步记录</div>';
                    } else {
                        logs.forEach(l => {
                            const line = document.createElement('div');
                            line.className = 'flex flex-col gap-1 px-3 py-2 border-b border-[var(--border)]';
                            const time = l.created_at ? new Date(l.created_at).toLocaleString() : '';
                            const status = l.status || 'unknown';
                            const delta = l.delta || {};
                            const qd = delta.questions || 0;
                            const hd = delta.history || 0;
                            const td = delta.trash || 0;
                            const statusText = status === 'success' ? '成功' : status === 'error' ? '失败' : status;
                            const statusColor = status === 'success' ? 'text-emerald-500' : status === 'error' ? 'text-red-500' : 'text-[var(--sub)]';
                            line.innerHTML = `
                                <div class="flex justify-between items-center text-xs">
                                    <span class="text-[var(--sub)]">${time}</span>
                                    <span class="${statusColor} font-bold">${statusText}</span>
                                </div>
                                <div class="text-[10px] text-[var(--sub)]">
                                    题库变化 ${qd >= 0 ? '+' : ''}${qd}，记录变化 ${hd >= 0 ? '+' : ''}${hd}${td ? `，回收站变化 ${td >= 0 ? '+' : ''}${td}` : ''}
                                </div>
                                ${l.error ? `<div class="text-[10px] text-red-500">错误：${App.utils.escapeHTML(l.error)}</div>` : ''}
                            `;
                            list.appendChild(line);
                        });
                    }
                    modal.classList.remove('hidden');
                    modal.classList.remove('opacity-0', 'pointer-events-none');
                    if (!modal.dataset.bound) {
                        modal.addEventListener('click', (e) => {
                            if (e.target === modal) {
                                App.sync.closeLogPanel();
                            }
                        });
                        modal.dataset.bound = '1';
                    }
                },
                closeLogPanel() {
                    const modal = document.getElementById('sync-log-modal');
                    if (!modal) return;
                    modal.classList.add('opacity-0', 'pointer-events-none');
                    setTimeout(() => {
                        modal.classList.add('hidden');
                    }, 200);
                },
                startAutoPull(intervalMs) {
                    // Bug #16 fix: 轮询回退机制，当 WebSocket/Ably 不可用时定期拉取更新
                    this.stopAutoPull();
                    const interval = intervalMs || 60000; // 默认 60 秒
                    this._pollTimer = setInterval(() => {
                        if (window.App && App.data && typeof App.data.loadFromCloud === 'function') {
                            App.data.loadFromCloud();
                        }
                    }, interval);
                },
                stopAutoPull() {
                    if (this._pollTimer) {
                        clearInterval(this._pollTimer);
                        this._pollTimer = null;
                    }
                },
                _toastTimer: null,
                _pollTimer: null
            
};

export const realtime = {

                client: null,
                channel: null,
                ws: null,
                mode: null,
                setup(userId, token) {
                    if (!userId || !token) return;
                    if (this.mode) return;
                    const wsUrl = (window.REALTIME_WS_URL || '').trim();
                    if (wsUrl) {
                        this.mode = 'ws';
                        this._setupWebSocket(wsUrl, userId, token);
                    }
                },
                _setDisconnected(msg) {
                    if (window.App && App.sync && typeof App.sync.render === "function") {
                        App.sync._realtimeDisconnected = true;
                        App.sync._lastMessage = msg || '';
                        App.sync.render();
                    }
                },
                _setConnected() {
                    if (window.App && App.sync && typeof App.sync.render === "function") {
                        App.sync._realtimeDisconnected = false;
                        App.sync._lastMessage = '';
                        App.sync.render();
                    }
                },
                _wsReconnectDelay: 1000,
                _wsMaxReconnectDelay: 30000,
                _wsReconnectTimer: null,
                _setupWebSocket(baseUrl, userId, token) {
                    // 清除之前的重连计时器
                    if (this._wsReconnectTimer) {
                        clearTimeout(this._wsReconnectTimer);
                        this._wsReconnectTimer = null;
                    }
                    try {
                        let url = baseUrl;
                        try {
                            const u = new URL(baseUrl);
                            u.searchParams.set('userId', userId);
                            u.searchParams.set('token', token);
                            url = u.toString();
                        } catch (e) {
                            const sep = baseUrl.includes('?') ? '&' : '?';
                            url = `${baseUrl}${sep}userId=${encodeURIComponent(userId)}&token=${encodeURIComponent(token)}`;
                        }
                        const ws = new WebSocket(url);
                        this.ws = ws;
                        ws.onopen = () => {
                            this._setConnected();
                            // 连接成功，重置重连延迟
                            this._wsReconnectDelay = 1000;
                        };
                        ws.onmessage = (evt) => {
                            let data = null;
                            try {
                                data = JSON.parse(evt.data);
                            } catch (e) { }
                            if (!data || typeof data !== 'object') return;
                            if (data.type === 'set-updated') {
                                if (window.App && App.data && typeof App.data.loadFromCloud === "function") {
                                    App.data.loadFromCloud();
                                }
                            }
                        };
                        ws.onclose = () => {
                            this._setDisconnected('');
                            this.ws = null;
                            // Bug #2 fix: 指数退避自动重连
                            this._scheduleReconnect(baseUrl, userId, token);
                        };
                        ws.onerror = () => {
                            this._setDisconnected('Realtime gateway error');
                        };
                    } catch (e) {
                        this._setDisconnected('初始化实时连接失败');
                        this._scheduleReconnect(baseUrl, userId, token);
                    }
                },
                _scheduleReconnect(baseUrl, userId, token) {
                    if (this._wsReconnectTimer) return;
                    const delay = this._wsReconnectDelay;
                    console.log(`[Realtime] WebSocket will reconnect in ${delay}ms`);
                    this._wsReconnectTimer = setTimeout(() => {
                        this._wsReconnectTimer = null;
                        // 指数退避：每次重连失败后延迟翻倍，最大 30 秒
                        this._wsReconnectDelay = Math.min(this._wsReconnectDelay * 2, this._wsMaxReconnectDelay);
                        this._setupWebSocket(baseUrl, userId, token);
                    }, delay);
                },

                teardown() {
                    if (this.ws) {
                        try {
                            this.ws.close();
                        } catch (e) { }
                        this.ws = null;
                    }
                    if (this.channel) {
                        try {
                            this.channel.unsubscribe();
                        } catch (e) { }
                        this.channel = null;
                    }
                    if (this.client) {
                        try {
                            this.client.close();
                        } catch (e) { }
                        this.client = null;
                    }
                    this.mode = null;
                }
            
};