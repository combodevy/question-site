import { getDBItem, setDBItem, deleteDBItem } from './db.js';
import { utils } from './utils.js';

export const data = {

                // 历史记录和题库存储 Key
                historyKey: 'lms_v26_history',
                bankKey: 'lms_v26_bank',
                // 回收站存储 Key
                trashKey: 'lms_v26_trash',
                bankNameKey: 'lms_v26_bank_name',
                // 记录本地数据属于哪个账号，防止同设备换账号后串数据
                lastUserIdKey: 'lms_v26_last_user',
                _currentUserId: null,

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
                // 本地编辑序号：每次本地数据变动自增，用于判断保存期间是否有新编辑
                _editSeq: 0,
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
                // 以下 4 个此前只在赋值处隐式产生（依赖 undefined 为假值），这里补上显式初值，
                // 让状态集合保持可枚举、可审计
                _isSaving: false,
                _saveAgainPending: false,
                _pullAfterSave: false,
                _retryAfterConflictOnce: 0,
                _loadPromise: null,
                // record() 用：保证 history 时间戳严格单调递增（增量同步以 (id|t) 去重）
                _lastRecordTs: 0,
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
                                this.history = this.sanitizeHistory(parsed.history);
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
                            if (window.App && App.utils && typeof App.utils.sanitizeImportedBank === 'function') {
                                const sanitized = App.utils.sanitizeImportedBank(this.bank);
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

                    // 恢复「有未上传修改」标记：上次会话可能改完没来得及上传就关掉了。
                    // 带着脏标记启动，2.4 守卫会拦下云端覆盖，登录后走「先推后拉」。
                    if (this._hasUnsyncedFlag()) {
                        this._bankDirty = true;
                    }
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

                // history 条目的去重键：稳定记录 ID（rid）。
                // 旧数据没有 rid 时回退到「id|时间戳」复合键（跨设备同毫秒可能碰撞，属历史数据兼容）。
                _historyKey(h) {
                    if (h && typeof h.rid === 'string' && h.rid) return 'r:' + h.rid;
                    const id = (h && typeof h.id === 'string') ? h.id : '';
                    const t = (h && typeof h.t === 'number') ? h.t : '';
                    return id + '|' + t;
                },

                // 把 history 归一化成合法记录：丢掉缺字段/类型不对的脏数据。
                // 本地载入与云端载入必须用同一套规则，否则脏数据会让 getStats() 里的
                // new Date(x.t).toISOString() 抛 RangeError，首页直接白屏。
                sanitizeHistory(list) {
                    if (!Array.isArray(list)) return [];
                    const out = list.filter(h =>
                        h && typeof h === 'object' &&
                        typeof h.id === 'string' &&
                        typeof h.r === 'boolean' &&
                        typeof h.t === 'number' && Number.isFinite(h.t)
                    );
                    // 按时间排序（稳定 rid 作同毫秒次序键）：所有依赖顺序的消费者
                    //（抽屉「最近5次」、SM-2 推导、增量游标）都依赖正确的时间序
                    // localeCompare 对相等值返回 0，满足排序契约（旧写法相等时返回 1）
                    out.sort((a, b) => (a.t - b.t) || String(a.rid || '').localeCompare(String(b.rid || '')));
                    return out;
                },

                // 对外暴露「净化后的 history」。
                // 任何视图都不应直接读 App.data.history —— 一旦里面混进 null 项或非法时间戳，
                // new Date(x.t).toISOString() 会抛 RangeError、h.r / h.id 会抛 TypeError，
                // 表现就是整页白屏（首页 7 日图、分析页遗忘曲线都踩过）。
                getSafeHistory() {
                    // 历史修订号缓存：sanitizeHistory 每次都复制+排序全部记录，
                    // 首页/分析页/抽屉一轮会调多次；数据没变时直接复用上次结果。
                    if (this._sanitizedCache && this._sanitizedCacheRev === this._histRev) {
                        return this._sanitizedCache;
                    }
                    this._sanitizedCache = this.sanitizeHistory(this.history);
                    this._sanitizedCacheRev = this._histRev;
                    return this._sanitizedCache;
                },

                bumpHistoryRev() {
                    this._histRev = (this._histRev || 0) + 1;
                },

                // 跨标签页同步：另一标签页写入的数据是即时落 IndexedDB 的（防抖只影响云端），
                // 所以干净标签页收到广播后直接从共享 IDB 重读本账号数据即可，不必等云端。
                // 只在「本页无未保存修改」时由调用方触发；重读后刷新视图。
                async reloadFromLocalIDB() {
                    try {
                        const bStr = await getDBItem(this.bankKey);
                        const hStr = await getDBItem(this.historyKey);
                        const tStr = await getDBItem(this.trashKey);
                        if (bStr) {
                            const parsed = JSON.parse(bStr);
                            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) this.bank = parsed;
                        }
                        if (hStr) {
                            const parsed = JSON.parse(hStr);
                            if (parsed && Array.isArray(parsed.history)) {
                                this.history = this.sanitizeHistory(parsed.history);
                                this.bumpHistoryRev();
                                this.lastPracticeTime = typeof parsed.lastPracticeTime === 'number' ? parsed.lastPracticeTime : null;
                                this.hiddenMistakeIds = Array.isArray(parsed.hiddenMistakeIds) ? parsed.hiddenMistakeIds : [];
                            }
                        }
                        if (tStr) {
                            const parsed = JSON.parse(tStr);
                            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) this.trash = parsed;
                        }
                        this._cachedQuestions = null;
                        this._questionMap = null;
                        this._errFreqCache = null;
                        this._isHistoryDirty = true;
                        if (window.App && App.router && typeof App.router.refresh === 'function') App.router.refresh();
                        return true;
                    } catch (e) {
                        console.error('reloadFromLocalIDB failed', e);
                        return false;
                    }
                },

                // 该题是否已被用户从错题本里移除（题库页的「移除错题」按钮）
                isMistakeHidden(id) {
                    return Array.isArray(this.hiddenMistakeIds) && this.hiddenMistakeIds.includes(id);
                },

                // 「存在未上传修改」的持久标记。_bankDirty 只存在内存里，刷新/关标签页就丢；
                // 没有这个标记，改完没等上传就刷新，启动时的 loadFromCloud 会因为"看起来不脏"
                // 而用云端旧数据把本地新修改直接盖掉（真实丢数据场景，已在线上复现过）。
                _markUnsynced() {
                    try { localStorage.setItem('lms_v26_unsynced', '1'); } catch (e) { }
                },
                _clearUnsynced() {
                    try { localStorage.removeItem('lms_v26_unsynced'); } catch (e) { }
                },
                _hasUnsyncedFlag() {
                    try { return localStorage.getItem('lms_v26_unsynced') === '1'; } catch (e) { return false; }
                },

                // 当前题库中存在的题目 id 集合（回收站里/已删除的不算）。
                // 统计口径：作答历史保留（恢复时学习状态跟着回来），但统计只看在库的题。
                _activeQuestionIds() {
                    const ids = new Set();
                    for (const sub in this.bank) {
                        for (const chap in (this.bank[sub] || {})) {
                            (this.bank[sub][chap] || []).forEach(q => { if (q && q.id) ids.add(q.id); });
                        }
                    }
                    return ids;
                },

                async clearAllForLogout() {
                    this.bank = {};
                    this.bankName = '';
                    this.history = [];
                    this.trash = {};
                    this.hiddenMistakeIds = [];
                    this._sanitizedCache = null;
                    this._sanitizedCacheRev = -1;
                    this._cachedQuestions = null;
                    this._questionMap = null;
                    this._errFreqCache = null;
                    this._isHistoryDirty = true;
                    this._lastSyncedCounts = null;
                    this._lastSyncedQuestionIds = null;
                    this._bankDirty = false;
                    this._clearUnsynced();
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
                        await deleteDBItem(this.lastUserIdKey);
                        await deleteDBItem('lms_v26_synced_base');   // 三方合并基线一并清除
                        this._lastSyncedBank = null;
                        this._currentUserId = null;
                    } catch (e) {
                        console.error(e);
                    }
                },

                saveHistory() {
                    this._editSeq++;
                    this.bumpHistoryRev();
                    this._markUnsynced();
                    if (window.App && App._syncBroadcast) App._syncBroadcast(this.historyKey);
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
                    const TYPES = new Set(['mcq', 'multi', 'tf', 'fill']);
                    for (const sub in data) {
                        if (!sub || typeof sub !== 'string') return "Subject name must be a non-empty string";
                        if (typeof data[sub] !== 'object' || Array.isArray(data[sub])) return `Subject [${sub}] format error`;
                        for (const chap in data[sub]) {
                            if (!Array.isArray(data[sub][chap])) return `Chapter [${chap}] must be an array`;
                            for (let i = 0; i < data[sub][chap].length; i++) {
                                const q = data[sub][chap][i];
                                if (!q || typeof q !== 'object') return `Question at [${sub}]-[${chap}] index ${i} is not an object`;
                                // 核心字段：id/题干/答案都必须是非空字符串（数字 id 会让回收站/编辑器按引用查找时失配）
                                if (typeof q.id !== 'string' || !q.id.trim()) return `Missing/invalid id at [${sub}]-[${chap}] index ${i}`;
                                if (typeof q.q !== 'string' || !q.q.trim()) return `Missing/invalid question text for ID ${q.id}`;
                                if (typeof q.a !== 'string' || !q.a.trim()) return `Missing/invalid answer for ID ${q.id}`;
                                if (!TYPES.has(q.type)) return `Unknown type "${q.type}" for ID ${q.id} (allowed: mcq/multi/tf/fill)`;
                                // 防御性长度上限：单题题干/答案异常巨大通常是坏数据，会拖垮渲染和同步
                                if (q.q.length > 5000) return `Question text too long (>5000 chars) for ID ${q.id}`;
                                if (q.a.length > 500) return `Answer too long (>500 chars) for ID ${q.id}`;

                                // 修复 6: 归一化多选题答案 (Normalize Multi-select Answers)
                                if (q.type === 'multi' && typeof q.a === 'string') {
                                    q.a = q.a.split('').sort().join('');
                                }

                                if (q.type === 'mcq' || q.type === 'multi') {
                                    if (!Array.isArray(q.o) || q.o.length < 2) return `Invalid options array for question ID ${q.id}`;
                                    if (q.o.length > 8) return `Too many options (>8) for question ID ${q.id}`;
                                    for (let k = 0; k < q.o.length; k++) {
                                        if (typeof q.o[k] !== 'string' || !q.o[k].trim()) {
                                            return `Option ${String.fromCharCode(65 + k)} is empty/invalid for question ID ${q.id}`;
                                        }
                                    }
                                    const maxLetter = String.fromCharCode(64 + q.o.length);   // 选项数对应的最后一个字母
                                    // 答案统一转大写（大小写宽容），再按字母序归一化多选
                                    q.a = q.a.trim().toUpperCase();
                                    if (q.type === 'mcq') {
                                        // 答案必须是选项范围内的大写字母
                                        if (!/^[A-Z]$/.test(q.a) || q.a > maxLetter) {
                                            return `Answer must be a letter within A-${maxLetter} for MCQ ID ${q.id}`;
                                        }
                                    } else {
                                        // 多选：每个字母都要在范围内且不重复（上面已按字母序归一化）
                                        if (!/^[A-Z]+$/.test(q.a)) {
                                            return `Multi answer must be letters like "ABD" for ID ${q.id}`;
                                        }
                                        q.a = q.a.split('').sort().join('');
                                        const letters = q.a.split('');
                                        if (new Set(letters).size !== letters.length || letters.some(ch => ch > maxLetter)) {
                                            return `Multi answer has duplicate/out-of-range letters for ID ${q.id}`;
                                        }
                                    }
                                } else if (q.type === 'tf') {
                                    // 判断题只接受 T/F（大小写宽容，统一存大写）
                                    const up = q.a.trim().toUpperCase();
                                    if (up !== 'T' && up !== 'F') return `TF answer must be T or F for ID ${q.id}`;
                                    q.a = up;
                                } else if (q.type === 'fill') {
                                    // 填空题允许多答案（| 分隔），每个分支都不能是空白
                                    if (q.a.split('|').some(p => !p.trim())) {
                                        return `Fill answer has an empty variant for ID ${q.id}`;
                                    }
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
                        const idStats = {};
                        const sanitizedInput = (window.App && App.utils && typeof App.utils.sanitizeImportedBank === 'function')
                            ? App.utils.sanitizeImportedBank(parsed, idStats)
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
                            fixedIds: idStats.fixedIds || 0,
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
                        // 相似题检测的基准：导入前的旧题，按科目分组、题干预先归一化。
                        // 字符计数缓存供 bagDistance 预筛用（编辑距离的下界），避免全量 O(m·n) DP。
                        const SIMILARITY_THRESHOLD = 0.85;
                        const MIN_NORM_LEN = 6;
                        const SIMILAR_PAIRS_CAP = 200;
                        const oldBySubject = new Map();
                        for (const sub in this.bank) {
                            const list = [];
                            for (const chap in (this.bank[sub] || {})) {
                                const arr = this.bank[sub][chap] || [];
                                for (const q of arr) {
                                    if (!q || typeof q !== 'object' || typeof q.id !== 'string') continue;
                                    const norm = App.utils.normalizeQuestionText(q.q || '');
                                    if (norm.length >= MIN_NORM_LEN) list.push({ sub, chap, q, norm, counts: App.utils.charCounts(norm) });
                                }
                            }
                            oldBySubject.set(sub, list);
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
                                    // 内容相同但归属变了：执行移动。否则用户调整章节结构后重新导入，
                                    // 题目会一直留在旧分类里（报告却显示「重复跳过」）
                                    if (exist.sub !== sub || exist.chap !== chap) {
                                        const oldArr2 = this.bank[exist.sub] && this.bank[exist.sub][exist.chap];
                                        if (Array.isArray(oldArr2)) {
                                            const i2 = oldArr2.findIndex(x => x.id === id);
                                            if (i2 !== -1) oldArr2.splice(i2, 1);
                                            if (!oldArr2.length && this.bank[exist.sub]) delete this.bank[exist.sub][exist.chap];
                                        }
                                        targetArr.push(qNew);
                                        globalMap.set(id, { sub, chap, q: qNew });
                                        report.moved = (report.moved || 0) + 1;
                                    } else {
                                        report.skippedSame++;
                                    }
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

                                // 相似题检测：题干高度相似、但 id 不同（很可能是同一道题重复导入）。
                                // 之前 report.similarPairs 只被初始化、从未写入，导致 UI 上的
                                // 「疑似相似题审查」永远提示「没有检测到」。
                                if (report.similarPairs.length < SIMILAR_PAIRS_CAP) {
                                    const normNew = App.utils.normalizeQuestionText(qNew.q || '');
                                    if (normNew.length >= MIN_NORM_LEN) {
                                        // 三段式加速，判定结果与逐对全量 DP 完全一致：
                                        // ① 长度差预筛：|lenA-lenB| ≤ bagDistance ≤ 编辑距离，超界直接跳过；
                                        // ② 字符袋距离预筛（编辑距离的下界）；
                                        // ③ 带 cutoff 的编辑距离 DP（行最小值超界即中止）。
                                        const countsNew = App.utils.charCounts(normNew);
                                        const candidates = oldBySubject.get(sub) || [];
                                        for (const o of candidates) {
                                            if (o.q.id === qNew.id) continue;
                                            const maxLen = Math.max(normNew.length, o.norm.length);
                                            const allowed = Math.floor(maxLen * (1 - SIMILARITY_THRESHOLD));
                                            if (Math.abs(normNew.length - o.norm.length) > allowed) continue;
                                            if (App.utils.bagDistance(countsNew, o.counts) > allowed) continue;
                                            const dist = App.utils.editDistance(normNew, o.norm, allowed);
                                            if (dist > allowed) continue;
                                            const score = 1 - dist / maxLen;
                                            report.similarPairs.push({
                                                sub,
                                                chap,
                                                score,
                                                existing: { id: o.q.id, q: o.q.q, a: o.q.a, type: o.q.type, sub: o.sub, chap: o.chap },
                                                incoming: { id: qNew.id, q: qNew.q, a: qNew.a, type: qNew.type, sub, chap }
                                            });
                                            if (report.similarPairs.length >= SIMILAR_PAIRS_CAP) break;
                                        }
                                    }
                                }
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
                        // 三件套必须一起做，否则刚答完题留在增量缓冲里的记录会在随后的
                        // statePartial 保存中被 Worker concat 回云端——「清空」清不掉云端：
                        this._historyAppendBuffer = [];   // ① 待上传的增量作废
                        this._errFreqCache = null;        // ② 错题频次缓存失效（否则按错排序仍用旧值）
                        this._lastHistoryTimestamp = 0;   // ③ 游标归零，下次全量拉取
                        this._isHistoryDirty = true;
                        // 强制走全量保存（useIncrementalSync 要求 !_bankDirty）：
                        // 全量模式的 state.history = [] 会整份替换云端，而不是把旧增量 concat 回去
                        this._bankDirty = true;
                        this._markUnsynced();
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
                    // 统计口径：只统计当前在库的题（回收站/已删除的题不算错题）。
                    // getQuestionById 与 _errFreqCache 在 persistBank 里一起失效，口径一致。
                    if (!this.getQuestionById(id)) return 0;
                    if (this.isMistakeHidden(id)) return 0;
                    if (this._isHistoryDirty || !this._errFreqCache) {
                        this._errFreqCache = new Map();
                        // 读路径防护：跳过 null / 缺字段的脏记录，避免整页崩掉
                        const src = Array.isArray(this.history) ? this.history : [];
                        src.forEach(h => {
                            if (!h || typeof h !== 'object' || typeof h.id !== 'string') return;
                            if (!h.r) this._errFreqCache.set(h.id, (this._errFreqCache.get(h.id) || 0) + 1);
                        });
                        this._isHistoryDirty = false;
                    }
                    return this._errFreqCache.get(id) || 0;
                },

                // 持久化题库
                persistBank() {
                    this._editSeq++;
                    this._safeSetItem(this.bankKey, JSON.stringify(this.bank));
                    if (this.bankName) {
                        this._safeSetItem(this.bankNameKey, this.bankName);
                    }
                    this._cachedQuestions = null;
                    this._questionMap = null;
                    this._errFreqCache = null;
                    this._isHistoryDirty = true;
                    this._bankDirty = true;
                    this._markUnsynced();
                    if (window.App && App._syncBroadcast) App._syncBroadcast(this.bankKey);
                    if (!this._suppressCloudSync && this.saveToCloudDebounced) {
                        this.saveToCloudDebounced();
                    }
                },

                renameSubject(oldSub, newSub) {
                    const trimmed = String(newSub || '').trim();
                    if (!trimmed || trimmed === oldSub || !this.bank[oldSub]) return;
                    if (!this.bank[trimmed]) this.bank[trimmed] = {};
                    for (const chap in this.bank[oldSub]) {
                        // 目标科目可能已存在同名章节，按 id 合并去重
                        this.bank[trimmed][chap] = this._mergeById(this.bank[trimmed][chap], this.bank[oldSub][chap]);
                    }
                    delete this.bank[oldSub];
                    if (this.trash && this.trash[oldSub]) {
                        if (!this.trash[trimmed]) this.trash[trimmed] = {};
                        for (const chap in this.trash[oldSub]) {
                            const mergedArr = this._mergeById(this.trash[trimmed][chap], this.trash[oldSub][chap]);
                            // 同步 originalPath：否则恢复时会按旧科目名重建科目，而不是回到当前路径
                            mergedArr.forEach(q => {
                                if (q && q.originalPath && q.originalPath.sub === oldSub) q.originalPath.sub = trimmed;
                            });
                            this.trash[trimmed][chap] = mergedArr;
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

                // 把题目移入回收站（软删除），并带上恢复所需的位置信息
                _moveToTrash(sub, chap, questions, reason) {
                    if (!Array.isArray(questions) || questions.length === 0) return;
                    if (!this.trash) this.trash = {};
                    if (!this.trash[sub]) this.trash[sub] = {};
                    if (!Array.isArray(this.trash[sub][chap])) this.trash[sub][chap] = [];
                    const now = Date.now();
                    for (const q of questions) {
                        if (!q || typeof q !== 'object') continue;
                        this.trash[sub][chap].push({
                            ...q,
                            deletedAt: now,
                            deletedBy: 'user',
                            reason,
                            originalPath: { sub, chap }
                        });
                    }
                },

                // 【已废弃】软删除不再清除历史——回收站恢复时学习状态一并恢复。
                // 统计口径由视图负责：错题本/首页错题榜只统计存在于题库中的题。

                deleteSubject(sub) {
                    if (!this.bank[sub]) return;
                    const chapDict = this.bank[sub] || {};
                    for (const chap in chapDict) {
                        const arr = chapDict[chap];
                        if (!Array.isArray(arr)) continue;
                        // 软删除：题目进回收站、可恢复（与单题删除保持一致的行为）
                        this._moveToTrash(sub, chap, arr, 'delete-subject');
                    }
                    delete this.bank[sub];
                    // 注意：不再顺手删掉 this.trash[sub]——回收站里原有的内容也应保留
                    // 历史记录同样保留：恢复科目时学习状态一并恢复
                    this.persistBank();
                    this.persistTrash();
                },

                renameChapter(sub, oldChap, newChap) {
                    if (!this.bank[sub] || !this.bank[sub][oldChap]) return;
                    const trimmed = String(newChap || '').trim();
                    if (!trimmed || trimmed === oldChap) return;
                    if (!this.bank[sub][trimmed]) this.bank[sub][trimmed] = [];
                    // 目标章节可能已存在，按 id 合并去重
                    this.bank[sub][trimmed] = this._mergeById(this.bank[sub][trimmed], this.bank[sub][oldChap]);
                    delete this.bank[sub][oldChap];
                    if (!Object.keys(this.bank[sub] || {}).length) delete this.bank[sub];
                    if (this.trash && this.trash[sub] && this.trash[sub][oldChap]) {
                        const mergedArr = this._mergeById(this.trash[sub][trimmed], this.trash[sub][oldChap]);
                        // 同步 originalPath：否则恢复时会按旧章节名重建章节
                        mergedArr.forEach(q => {
                            if (q && q.originalPath && q.originalPath.chap === oldChap) q.originalPath.chap = trimmed;
                        });
                        this.trash[sub][trimmed] = mergedArr;
                        delete this.trash[sub][oldChap];
                        if (!Object.keys(this.trash[sub] || {}).length) delete this.trash[sub];
                        this.persistTrash();
                    }
                    this.normalizeBankStructure();
                    this.persistBank();
                },

                deleteChapter(sub, chap) {
                    if (!this.bank[sub] || !this.bank[sub][chap]) return;
                    const arr = this.bank[sub][chap];
                    if (Array.isArray(arr)) {
                        // 软删除：题目进回收站、可恢复
                        this._moveToTrash(sub, chap, arr, 'delete-chapter');
                    }
                    delete this.bank[sub][chap];
                    if (!Object.keys(this.bank[sub] || {}).length) delete this.bank[sub];
                    // 注意：不再顺手删掉 this.trash[sub][chap]——回收站里原有的内容也应保留
                    // 历史记录同样保留：恢复章节时学习状态一并恢复
                    this.persistBank();
                    this.persistTrash();
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
                        if (window.App && App.router && typeof App.router.refresh === 'function') {
                            App.router.refresh();
                        }
                },

                deleteSubjectInteractive(sub) {
                    if (!window.confirm(`确定要删除科目「${sub}」及其所有章节和题目吗？\n所有题目会被移入回收站，可在回收站中恢复。`)) return;
                    this.deleteSubject(sub);
                    if (App && App.ui && typeof App.ui.renderBankManager === 'function') {
                        App.ui.renderBankManager();
                    }
                        if (window.App && App.router && typeof App.router.refresh === 'function') {
                            App.router.refresh();
                        }
                },

                renameChapterInteractive(sub, chap) {
                    const next = window.prompt(`请输入新的章节名称（${sub}）`, chap);
                    if (!next || next.trim() === chap) return;
                    this.renameChapter(sub, chap, next.trim());
                    if (App && App.ui && typeof App.ui.renderBankManager === 'function') {
                        App.ui.renderBankManager();
                    }
                        if (window.App && App.router && typeof App.router.refresh === 'function') {
                            App.router.refresh();
                        }
                },

                deleteChapterInteractive(sub, chap) {
                    if (!window.confirm(`确定要删除章节「${sub} / ${chap}」及其所有题目吗？\n所有题目会被移入回收站，可在回收站中恢复。`)) return;
                    this.deleteChapter(sub, chap);
                    if (App && App.ui && typeof App.ui.renderBankManager === 'function') {
                        App.ui.renderBankManager();
                    }
                        if (window.App && App.router && typeof App.router.refresh === 'function') {
                            App.router.refresh();
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
                        // 加载在途：改用 _deferredSave 标记（加载完成的各出口都会消费它并重试保存），
                        // 不能用 _saveAgainPending——没有任何加载路径会消费它，保存会被静默吞掉
                        this._deferredSave = true;
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
                            if (!this._syncReady) {
                                // 加载失败（断网等）：不能让挂起的保存被静默吞掉。
                                // 标记脏数据由轮询/网络恢复后的下一次保存接力，并给出可见的失败状态。
                                this._bankDirty = true;
                                if (window.App && App.sync && typeof App.sync.showSyncStatus === 'function') {
                                    App.sync.showSyncStatus('error', null, '网络异常，数据已保存在本地，恢复后自动重试上传');
                                }
                                return;
                            }
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
                        // 三样都空且从未同步过 → 没有内容可存，直接跳过。
                        // 但只要同步过一次，就必须继续上传：否则「清空题库+重置记录+清空回收站」
                        // 这个操作不会上传，60 秒后轮询会把云端旧数据整份拉回来。
                        if (!questions.length && !history.length && !totalTrash && !this._lastSyncedCounts) return;

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


                        // 记录发起保存时的编辑序号：若保存期间又有新编辑，成功后不能清掉脏标记
                        const editSeqAtSave = this._editSeq;
                        let res;
                        try {
                            if (window.App && App.sync && typeof App.sync.setStatus === 'function') {
                                App.sync.setStatus('pending', null, null);
                            }
                            // 每次保存都重新快照：快照必须代表「本次尝试要上传的状态」。
                            // 原来只在为 null 时创建，导致一次失败后快照一直停在旧状态，
                            // 之后若遇到 409 会回滚到那份旧数据，把中间的编辑一起丢掉。
                            this._pendingSaveState = {
                                bank: JSON.parse(JSON.stringify(this.bank || {})),
                                history: Array.isArray(this.history) ? this.history.slice() : [],
                                trash: JSON.parse(JSON.stringify(this.trash || {})),
                                lastPracticeTime: this.lastPracticeTime || null,
                                hiddenMistakeIds: Array.isArray(this.hiddenMistakeIds) ? this.hiddenMistakeIds.slice() : [],
                                bankName: this.bankName || ''
                            };
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
                                    partialFields: ['lastPracticeTime', 'hiddenMistakeIds'],
                                    partialValues: {
                                        lastPracticeTime: lastPracticeTime,
                                        hiddenMistakeIds: Array.isArray(this.hiddenMistakeIds) ? this.hiddenMistakeIds : []
                                    },
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
                                // token 失效（401）：停止重试保存，自动登出
                                if (res.status === 401) {
                                    const reason = (data && data.error) || '登录已过期';
                                    if (window.App && App.auth && typeof App.auth.logout === 'function') {
                                        App.auth.logout();
                                        alert(reason + '，请重新登录。');
                                    }
                                    return;
                                }
                                if (window.App && App.sync && typeof App.sync.showSyncStatus === 'function') {
                                    const msg = (data && (data.error || data.detail)) || '未知错误';
                                    App.sync.showSyncStatus('error', delta, msg);
                                }
                                if (res.status === 409 && window.App && App.data && typeof App.data.loadFromCloud === "function") {
                                    // 409 = 另一设备先保存了。策略：三方合并（保存快照 base / 当前本地 live / 远端 remote），
                                    // 任何一方的修改都不静默丢弃。全程持有 _isSaving 锁——中途释放会让
                                    // 合并窗口内的防抖保存并发执行，而合并会用旧快照重建 bank，把窗口里的新编辑覆盖掉。
                                    try {
                                        const remote = await (async () => {
                                            const r = await fetch((App.apiBase || '') + "/api/load-question-set", {
                                                headers: { Authorization: "Bearer " + token }
                                            });
                                            // HTTP 失败直接判为「拉取失败」，绝不能把错误响应体 r.json() 当远端真身
                                            if (!r.ok) return null;
                                            let j = null;
                                            try { j = await r.json(); } catch (e) { return null; }
                                            // 结构校验：ok 标志 + state 对象 + 数字版本号，齐备才可信；
                                            // 缺任何一项都返回 null → 走合并中止路径
                                            if (!j || j.ok !== true || !j.state || typeof j.state !== 'object' || typeof j.version !== 'number') return null;
                                            return j;
                                        })();
                                        if (!remote) {
                                            // 远端快照读取失败（401/5xx/坏 JSON/缺字段）：
                                            // 绝不能用「空题库」合并——那会把 base 有而 live 未改的题
                                            // 全部当成远端删除而清空。原样保留本地一切，不写不重试。
                                            this._bankDirty = true;
                                            this._markUnsynced();
                                            if (window.App && App.sync && typeof App.sync.showSyncStatus === 'function') {
                                                App.sync.showSyncStatus('error', delta, '合并失败：无法读取云端最新数据。本地修改已全部保留，请稍后重试或先在账户菜单「导出全部题库」备份');
                                            }
                                            this._retryAfterConflictOnce = 0;
                                            return;
                                        }
                                        // 把远端最新版本号带回来：随后的重试上传必须通过版本校验
                                        if (remote && typeof remote.version === 'number' && Number.isFinite(remote.version)) {
                                            this.remoteVersion = remote.version;
                                        }
                                        if (typeof this._retryAfterConflictOnce !== 'number') this._retryAfterConflictOnce = 0;
                                        if (this._retryAfterConflictOnce < 1) {
                                            this._retryAfterConflictOnce++;
                                            const s = this._pendingSaveState;
                                            if (s) {
                                                this._suppressCloudSync = true;
                                                // base 必须是「双方最后达成一致的状态」，且必须来自持久化快照：
                                                // 内存快照刷新即失——刷新后离线编辑既有题目再登录时，
                                                // 保存瞬间快照 == 本地编辑版，三方合并会把同 ID 冲突误判成
                                                // 「只有远端改了」→ 离线编辑被静默覆盖（复审 3.2）。
                                                // 快照按账号存 IndexedDB，与未同步标记同生共死。
                                                let baseBank = null;
                                                let baseTrusted = false;
                                                try {
                                                    const baseUid = App.auth && typeof App.auth.getUserId === 'function' ? App.auth.getUserId() : '';
                                                    const baseRaw = await getDBItem('lms_v26_synced_base');
                                                    if (baseRaw) {
                                                        const parsedBase = JSON.parse(baseRaw);
                                                        if (parsedBase && parsedBase.uid === baseUid && parsedBase.bank && typeof parsedBase.bank === 'object') {
                                                            baseBank = parsedBase.bank;
                                                            baseTrusted = true;
                                                        }
                                                    }
                                                } catch (baseErr) { baseBank = null; baseTrusted = false; }
                                                if (!baseBank || typeof baseBank !== 'object') {
                                                    // 无可信基线（旧版本升级/清空后首次）：回退保存瞬间快照，
                                                    // 但合并规则降级为「分歧即保留双方」，绝不静默采信任何一方
                                                    baseBank = s.bank || {};
                                                    baseTrusted = false;
                                                }
                                                const liveBank = this.bank || {};     // 当前本地状态（可能已含合并窗口内的新编辑）
                                                const remoteBank = (remote.state && typeof remote.state.bank === 'object' && remote.state.bank) || {};
                                                const remoteTrash = (remote.state && typeof remote.state.trash === 'object' && remote.state.trash) || {};

                                                const flatten = (bk) => {
                                                    const m = new Map();
                                                    for (const fsub in (bk || {})) {
                                                        for (const fchap in (bk[fsub] || {})) {
                                                            ((bk[fsub][fchap]) || []).forEach(fq => { if (fq && fq.id) m.set(fq.id, { q: fq, sub: fsub, chap: fchap }); });
                                                        }
                                                    }
                                                    return m;
                                                };
                                                const sameQ = (a, b) => !!a && !!b && a.sub === b.sub && a.chap === b.chap && JSON.stringify(a.q) === JSON.stringify(b.q);

                                                // —— 回收站先合并（远端 ∪ 当前本地）：后面的「本地已删除」判定要用全集 ——
                                                const mergedTrash = JSON.parse(JSON.stringify(remoteTrash));
                                                const trashIds = new Set();
                                                for (const tsub in mergedTrash) {
                                                    for (const tchap in (mergedTrash[tsub] || {})) {
                                                        ((mergedTrash[tsub][tchap]) || []).forEach(q => { if (q && q.id) trashIds.add(q.id); });
                                                    }
                                                }
                                                for (const tsub in (this.trash || {})) {
                                                    for (const tchap in (this.trash[tsub] || {})) {
                                                        for (const q of ((this.trash[tsub][tchap]) || [])) {
                                                            if (!q || !q.id || trashIds.has(q.id)) continue;
                                                            if (!mergedTrash[tsub]) mergedTrash[tsub] = {};
                                                            if (!Array.isArray(mergedTrash[tsub][tchap])) mergedTrash[tsub][tchap] = [];
                                                            mergedTrash[tsub][tchap].push({ ...q, originalPath: (q.originalPath && q.originalPath.sub) ? q.originalPath : { sub: tsub, chap: tchap } });
                                                            trashIds.add(q.id);
                                                        }
                                                    }
                                                }
                                                const trashHas = (qid) => {
                                                    for (const tsub in mergedTrash) {
                                                        for (const tchap in (mergedTrash[tsub] || {})) {
                                                            if (((mergedTrash[tsub][tchap]) || []).some(x => x && x.id === qid)) return true;
                                                        }
                                                    }
                                                    return false;
                                                };
                                                const putInto = (bk, bsub, bchap, q) => {
                                                    if (!bk[bsub]) bk[bsub] = {};
                                                    if (!Array.isArray(bk[bsub][bchap])) bk[bsub][bchap] = [];
                                                    bk[bsub][bchap].push(q);
                                                };

                                                const base = flatten(baseBank);
                                                const live = flatten(liveBank);
                                                const mergedBank = JSON.parse(JSON.stringify(remoteBank));
                                                const remoteMap = flatten(mergedBank);

                                                let editConflicts = 0;
                                                const cloneQ = (q) => JSON.parse(JSON.stringify(q));
                                                const removeFromMerged = (qid) => {
                                                    for (const rsub in mergedBank) {
                                                        for (const rchap in (mergedBank[rsub] || {})) {
                                                            mergedBank[rsub][rchap] = (mergedBank[rsub][rchap] || []).filter(x => !x || x.id !== qid);
                                                        }
                                                    }
                                                };
                                                // —— ① 逐 ID 处理「本地活动题」——
                                                for (const [id, lv] of live) {
                                                    const bv = base.get(id) || null;
                                                    const rv = remoteMap.get(id) || null;
                                                    const liveChanged = !bv || !sameQ(lv, bv);
                                                    if (sameQ(lv, rv)) continue;   // 两边内容一致（含双方都没有 base 记录的新增同步）→ 无需处理
                                                    if (!rv) {
                                                        // 远端没有这道题。仅在基线可信时才敢判定，否则保守保留：
                                                        // ① base 也没有 → 本地新增，保留；
                                                        // ② base 有 + 本地改过 → 远端删除 vs 本地编辑，编辑保留进题库（数据不丢）；
                                                        // ③ base 有 + 本地没改 → 尊重远端的删除，本题从题库消失
                                                        //   （若远端是正规软删除，其回收站副本已由上面的回收站合并带回）
                                                        if (!baseTrusted) {
                                                            if (!trashHas(id)) putInto(mergedBank, lv.sub, lv.chap, cloneQ(lv.q));
                                                        } else if (!bv) {
                                                            if (!trashHas(id)) putInto(mergedBank, lv.sub, lv.chap, cloneQ(lv.q));
                                                        } else if (liveChanged) {
                                                            putInto(mergedBank, lv.sub, lv.chap, cloneQ(lv.q));
                                                        } else {
                                                            removeFromMerged(id);   // 远端删除获胜
                                                        }
                                                        continue;
                                                    }
                                                    if (!liveChanged && baseTrusted) continue;   // 本地没改过 → 远端版本即为结果
                                                    const remoteChanged = baseTrusted ? (!bv || !sameQ(rv, bv)) : true;
                                                    if (baseTrusted && !remoteChanged) {
                                                        // 只有本地改了：移除远端位置的同 id，放本地版本
                                                        removeFromMerged(id);
                                                        putInto(mergedBank, lv.sub, lv.chap, cloneQ(lv.q));
                                                        continue;
                                                    }
                                                    // 两端都改了（或基线不可信无法判定）：
                                                    // 云端版本进题库，本地编辑版本完整存入回收站，绝不静默覆盖
                                                    editConflicts++;
                                                    putInto(mergedTrash, lv.sub, lv.chap, { ...lv.q, deletedAt: Date.now(), deletedBy: 'sync', reason: 'conflict-local-edit', originalPath: { sub: lv.sub, chap: lv.chap } });
                                                    trashIds.add(id);
                                                }
                                                // —— ② 处理「本地已删除」的 base 题（不在 live 里）：删除必须参与合并 ——
                                                // 此前只遍历本地活动题，本地移入回收站的题不会从远端活动题库移除，
                                                // 删除会失效（同一题同时出现在题库和回收站）。
                                                for (const [id, bv] of base) {
                                                    if (live.has(id)) continue;
                                                    const rv = remoteMap.get(id) || null;
                                                    if (!rv) continue;                       // 远端也没有：双方 trash 里都有，无事可做
                                                    if (!trashHas(id)) continue;             // 本地 trash 里没有 → 不是本地删的（异常态），保守不动
                                                    const remoteChanged = baseTrusted ? (!bv || !sameQ(rv, bv)) : true;
                                                    if (!remoteChanged || !baseTrusted) {
                                                        // 远端未改（或基线不可信）→ 本地删除获胜：从合并题库移除
                                                        removeFromMerged(id);
                                                    } else {
                                                        // 本地删除后远端又编辑了：保留两版——远端留在题库，
                                                        // 本地回收站副本已由回收站合并带回，计入提示
                                                        editConflicts++;
                                                    }
                                                }

                                                this.bank = mergedBank;
                                                this.trash = mergedTrash;
                                                this.bumpHistoryRev();
                                                this.bumpHistoryRev();

                                                // —— 作答：远端并入本地（rid 优先去重，与 _historyKey 同一规则）——
                                                // 建集合与查重必须用同一个键函数：此前一边用 _historyKey（'r:…'）
                                                // 一边用裸 'id|t'，永远查不中，历史会翻倍。
                                                const remoteHist = (remote.state && Array.isArray(remote.state.history)) ? remote.state.history : [];
                                                const histKeys = new Set(this.history.map(x => this._historyKey(x)));
                                                for (const rh of remoteHist) {
                                                    const k = this._historyKey(rh);
                                                    if (!histKeys.has(k)) { this.history.push(rh); histKeys.add(k); }
                                                }
                                                const localHist = s.history || [];
                                                for (const lh of localHist) {
                                                    const k = this._historyKey(lh);
                                                    if (!histKeys.has(k)) { this.history.push(lh); histKeys.add(k); }
                                                }
                                                if (typeof remote.state?.lastPracticeTime === 'number' || typeof s.lastPracticeTime === 'number') {
                                                    this.lastPracticeTime = Math.max(remote.state?.lastPracticeTime || 0, s.lastPracticeTime || 0) || null;
                                                }
                                                this.bankName = this.bankName || s.bankName || (remote.name ?? '');

                                                // 隐藏错题：按 id 并集合并（两台设备各自的隐藏都保留），
                                                // 不再整组覆盖——后保存端覆盖先保存端会丢隐藏状态
                                                const localHidden = Array.isArray(this.hiddenMistakeIds) ? this.hiddenMistakeIds : [];
                                                const remoteHidden = (remote.state && Array.isArray(remote.state.hiddenMistakeIds)) ? remote.state.hiddenMistakeIds : [];
                                                this.hiddenMistakeIds = [...new Set([...localHidden, ...remoteHidden])];

                                                this._safeSetItem(this.bankKey, JSON.stringify(this.bank));
                                                this._safeSetItem(this.historyKey, JSON.stringify({
                                                    history: this.history,
                                                    lastPracticeTime: this.lastPracticeTime,
                                                    hiddenMistakeIds: this.hiddenMistakeIds
                                                }));
                                                this._safeSetItem(this.trashKey, JSON.stringify(this.trash));
                                                if (this.bankName) this._safeSetItem(this.bankNameKey, this.bankName);
                                                this._cachedQuestions = null;
                                                this._questionMap = null;
                                                this._errFreqCache = null;
                                                this._isHistoryDirty = true;
                                                this._bankDirty = true;
                                                this._markUnsynced();
                                                this._suppressCloudSync = false;
                                                if (window.App && App.sync && typeof App.sync.showSyncStatus === 'function') {
                                                    App.sync.showSyncStatus('pending', null, editConflicts > 0
                                                        ? `检测到多设备修改，已合并双方数据（${editConflicts} 道题两端都有修改，你的版本已存入回收站）…`
                                                        : '检测到多设备修改，正在合并双方数据…');
                                                }
                                            }
                                            // 重试：此时 _bankDirty=true，只上传双方合并后的差异
                                            this._saveAgainPending = true;
                                        } else {
                                            // 二次冲突：保留当前合并结果，交给用户手动处理（导出/刷新）
                                            this._retryAfterConflictOnce = 0;
                                            this._bankDirty = true;
                                            if (window.App && App.sync && typeof App.sync.showSyncStatus === 'function') {
                                                App.sync.showSyncStatus('error', delta, '多设备修改冲突，已保留双方数据；请稍后重试或导出备份');
                                            }
                                        }
                                    } catch (e) {
                                        console.error("409 conflict merge failed", e);
                                        this._bankDirty = true;   // 合并失败时本地数据绝不能丢
                                    }
                                }
                            } else {
                                this._lastSyncedCounts = counts;
                                this._lastSyncedQuestionIds = allIds;
                                // 记录「双方已达成一致的题库快照」：409 三方合并用它当 base，
                                // 才能区分「本地离线改过」和「远端改过」，而不是靠保存瞬间快照猜。
                                // 快照必须持久化到 IndexedDB（按账号）：内存版刷新即失，
                                // 刷新后离线编辑的同 ID 冲突会因拿不到基线被误判（复审 3.2）。
                                try {
                                    this._lastSyncedBank = JSON.stringify(this.bank);
                                    const baseUid = App.auth && typeof App.auth.getUserId === 'function' ? App.auth.getUserId() : '';
                                    setDBItem('lms_v26_synced_base', JSON.stringify({ uid: baseUid, version: this.remoteVersion, bank: this.bank })).catch(() => { });
                                } catch (syncErr) { }
                                if (typeof data.version === "number" && Number.isFinite(data.version)) {
                                    this.remoteVersion = data.version;
                                }
                                if (window.App && App.sync && typeof App.sync.showSyncStatus === 'function') {
                                    App.sync.showSyncStatus('success', delta);
                                }
                                // 只有当保存期间没有新的本地编辑时才清脏标记；
                                // 否则保持 _bankDirty，防止轮询加载用旧云数据覆盖更新的本地状态
                                if (this._editSeq === editSeqAtSave) {
                                    this._bankDirty = false;
                                    this._clearUnsynced();
                                }
                                // 登录时因「先推后拉」跳过的那次云端拉取，在这里补上
                                if (this._pullAfterSave) {
                                    this._pullAfterSave = false;
                                    this.loadFromCloud();
                                }
                                this.bankName = inferredName;
                                this._safeSetItem(this.bankNameKey, this.bankName);
                                this._retryAfterConflictOnce = 0;
                                this._pendingSaveState = null;
                                // ========== 增量同步：清空 buffer ==========
                                this._historyAppendBuffer = [];
                                // 更新最后同步的 history 时间戳
                                if (this.history.length > 0) {
                                    // 必须取最大值而不是「最后一个元素」：history 合并后顺序不保证有序。
                                    // 游标取 maxT 本身（服务端 >= 语义）：同毫秒迟到的跨设备记录仍能增量取到，
                                    // 重复下发的部分由客户端 rid 去重吸收
                                    this._lastHistoryTimestamp = this.history.reduce((m, h) => Math.max(m, (h && Number.isFinite(h.t)) ? h.t : 0), 0);   // +1：游标语义为「最后已知之后的记录」
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
                                // 网络断开：保持 _syncReady=false，本地脏数据保留，给用户可见提示。
                                // 不触发 _deferredSave 立即重试（只会再次失败），由下一轮轮询/操作自然恢复。
                                if (this._bankDirty && window.App && App.sync && typeof App.sync.showSyncStatus === 'function') {
                                    App.sync.showSyncStatus('error', null, '网络异常，数据已保存在本地，恢复后自动重试上传');
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
                                // token 失效（401）：自动登出并提示重新登录，避免每次轮询都报同步失败
                                if (res.status === 401) {
                                    this._syncReady = false;
                                    // 注意：这里不能读 data —— 它在下方才用 let 声明，属于暂时性死区，
                                    // 读取会抛 ReferenceError（曾导致 token 过期时同步彻底失效且不登出）
                                    if (window.App && App.auth && typeof App.auth.logout === 'function') {
                                        App.auth.logout();
                                        alert('登录已过期，请重新登录。');
                                    }
                                    return;
                                }
                                if (window.App && App.sync && typeof App.sync.showSyncStatus === 'function') {
                                    App.sync.showSyncStatus('error', null, '从云端加载题库失败 (HTTP ' + res.status + ')');
                                }
                                this._syncReady = true;
                                this._bankDirty = true; // 云端状态未知，保守视为有未上传修改，防止本地数据被云覆盖
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
                                this._bankDirty = true; // 云端状态未知，保守视为有未上传修改
                                if (this._deferredSave) {
                                    this._deferredSave = false;
                                    this.saveToCloudDebounced();
                                }
                                return;
                            }
                            if (!data || !data.ok) {
                                this._syncReady = true;
                                if (this._deferredSave) {
                                    this._deferredSave = false;
                                    this.saveToCloudDebounced();
                                }
                                return;
                            }

                            // 2. 解析云端返回的数据包
                            const state = data.state && typeof data.state === "object" ? data.state : null;
                            if (!state) {
                                // 云端为空（新用户）：若本地数据属于另一个账号，先清掉避免串号
                                const uid = App.auth && typeof App.auth.getUserId === 'function' ? App.auth.getUserId() : '';
                                let prevUid = null;
                                try { prevUid = await getDBItem(this.lastUserIdKey); } catch (e) { }
                                if (prevUid && typeof prevUid === 'string' && uid && prevUid !== uid) {
                                    this.bank = {};
                                    this.bankName = '';
                                    this.history = [];
                                    this.trash = {};
                                    this.hiddenMistakeIds = [];
                                    this.lastPracticeTime = null;
                                    this._cachedQuestions = null;
                                    this._questionMap = null;
                                    this._errFreqCache = null;
                                    this._lastSyncedCounts = { questions: 0, history: 0, trash: 0 };
                                    this._lastSyncedQuestionIds = [];
                                    this._historyAppendBuffer = [];
                                    this._lastHistoryTimestamp = 0;
                                    try {
                                        await deleteDBItem(this.bankKey);
                                        await deleteDBItem(this.bankNameKey);
                                        await deleteDBItem(this.historyKey);
                                        await deleteDBItem(this.trashKey);
                                    } catch (e) { }
                                }
                                if (uid) {
                                    this._currentUserId = uid;
                                    try { await setDBItem(this.lastUserIdKey, uid); } catch (e) { }
                                }
                                // 初始化版本号
                                if (typeof data.version === "number" && Number.isFinite(data.version)) {
                                    this.remoteVersion = data.version;
                                } else {
                                    this.remoteVersion = 0;
                                }
                                this._syncReady = true;
                                // 登录后云端为空也要刷新一次视图：清掉登录前渲染的旧内容，
                                // 让用户看到"空题库"的真实状态而不是等待假象
                                if (window.App && App.router && typeof App.router.refresh === 'function') {
                                    App.router.refresh();
                                }
                                if (this._deferredSave) {
                                    this._deferredSave = false;
                                    this.saveToCloudDebounced();
                                }
                                return;
                            }

                            // 2.4 本地存在未落库的修改（保存仍在途 / 保存被挂起 / 脏标记）时，
                            // 这次加载一律不应用——否则加载会用旧云数据覆盖更新的本地状态。
                            // 服务端新增的作答记录仍按时间戳增量并入本地；等挂起的保存上传
                            // 完成后，版本号由保存结果对齐，下一次加载自然收敛。
                            if (this._isSaving || this._deferredSave || this._bankDirty || this._historyAppendBuffer.length > 0) {
                                // 安全规则：只有「待上传的只有作答记录（题库本身没改）」时，
                                // 才能把云端新版本号对齐到本地。题库有未上传修改时保留旧版本号——
                                // 随后的整库保存会因版本不匹配被服务端 409 拒绝，从而走三方合并；
                                // 若在这里采纳新版本号，保存会被服务端当成版本吻合直接接受，
                                // 远端另一台设备的修改会被本机旧库静默覆盖，合并逻辑根本没机会运行。
                                if (typeof data.version === "number" && Number.isFinite(data.version) && !this._bankDirty) {
                                    this.remoteVersion = data.version;
                                }
                                if (Array.isArray(state.history)) {
                                    const incoming = this.sanitizeHistory(state.history);
                                    const existingTimestamps = new Set(this.history.map(h => this._historyKey(h)));
                                    const newEntries = incoming.filter(h => !existingTimestamps.has(this._historyKey(h)));
                                    if (newEntries.length > 0) {
                                        this.history = this.history.concat(newEntries);
this.bumpHistoryRev();
this.bumpHistoryRev();
                                        this._safeSetItem(this.historyKey, JSON.stringify({
                                            history: this.history,
                                            lastPracticeTime: this.lastPracticeTime,
                                            hiddenMistakeIds: Array.isArray(this.hiddenMistakeIds) ? this.hiddenMistakeIds : []
                                        }));
                                    }
                                    if (this.history.length > 0) {
                                        // 游标取 maxT 本身（服务端按 >= 下发）：同毫秒的迟到记录仍能取到，
                                        // 多下发的一条重复记录由客户端按 rid 去重，无副作用
                                        this._lastHistoryTimestamp = this.history.reduce((m, h) => Math.max(m, (h && Number.isFinite(h.t)) ? h.t : 0), 0);
                                    }
                                }
                                this._errFreqCache = null;
                                this._isHistoryDirty = true;
                                this._syncReady = true;
                                // 该路径会并入新的作答记录，同样要刷新视图保持统计同步
                                if (window.App && App.router && typeof App.router.refresh === 'function') {
                                    App.router.refresh();
                                }
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
                                const incoming = this.sanitizeHistory(state.history);
                                const existingTimestamps = new Set(this.history.map(h => this._historyKey(h)));
                                const newEntries = incoming.filter(h => !existingTimestamps.has(this._historyKey(h)));
                                if (newEntries.length > 0) {
                                    this.history = this.history.concat(newEntries);
this.bumpHistoryRev();
this.bumpHistoryRev();
                                }
                            } else {
                                this.history = this.sanitizeHistory(state.history);
this.bumpHistoryRev();
this.bumpHistoryRev();
                            }
                            // 更新 _lastHistoryTimestamp
                            if (this.history.length > 0) {
                                const maxT = this.history.reduce((m, h) => Math.max(m, (h && Number.isFinite(h.t)) ? h.t : 0), 0);
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
                            try {
                                this._lastSyncedBank = JSON.stringify(this.bank);
                                const baseUid2 = App.auth && typeof App.auth.getUserId === 'function' ? App.auth.getUserId() : '';
                                setDBItem('lms_v26_synced_base', JSON.stringify({ uid: baseUid2, version: this.remoteVersion, bank: this.bank })).catch(() => { });
                            } catch (syncErr) { }
                            this._lastSyncedCounts = {
                                questions: bankCount,
                                history: this.history.length,
                                trash: trashCount
                            };
                            this._lastSyncedQuestionIds = allIds;
                            // 记录本地数据归属账号
                            {
                                const uid = App.auth && typeof App.auth.getUserId === 'function' ? App.auth.getUserId() : '';
                                if (uid && uid !== this._currentUserId) {
                                    this._currentUserId = uid;
                                    try { await setDBItem(this.lastUserIdKey, uid); } catch (e) { }
                                }
                            }
                            // 关键：同步后必须失效派生缓存，否则页面加载时先用本地旧数据
                            // 渲染填充的缓存会一直挡住云端新数据，直到下次编辑才刷新
                            this._cachedQuestions = null;
                            this._questionMap = null;
                            this._errFreqCache = null;
                            this._isHistoryDirty = true;
                            this._bankDirty = false;
                            this._clearUnsynced();
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
                    this._editSeq++;
                    this._safeSetItem(this.trashKey, JSON.stringify(this.trash));
                    if (window.App && App._syncBroadcast) App._syncBroadcast(this.trashKey);
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

                    // 历史记录保留在 history 中（不清除）：回收站恢复时学习状态一并恢复。
                    // 统计口径：错题本/首页错题榜只统计存在于题库中的题，回收站里的题不会出现。

                    if (changed) {
                        this._pruneEmptyContainers();
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
                    // 归位路径字段：originalPath 可能来自重命名前的旧路径，结构字段必须一致
                    cleanQ.sub = targetSub;
                    cleanQ.chap = targetChap;

                    // 全库 ID 冲突检查：同 ID 的活动题在「其他」科目/章节时同样会造成
                    // 全局重复（此前只查目标章节）。内容不同 → 取消恢复并明确告知，
                    // 回收站副本原样保留（零数据丢失）；内容相同 → 销毁回收站副本去重。
                    for (const gsub in this.bank) {
                        for (const gchap in (this.bank[gsub] || {})) {
                            if (gsub === targetSub && gchap === targetChap) continue;
                            const dup = (this.bank[gsub][gchap] || []).find(x => x && x.id === id);
                            if (!dup) continue;
                            // 全对象比较：扩展字段（解释/来源/标签等）不同也算不同——
                            // 只比对核心四项会静默销毁用户仍需要的回收站副本（复审 3.15）
                            const sameAsLive = JSON.stringify(dup) === JSON.stringify(cleanQ);
                            if (sameAsLive) {
                                arr.splice(idx, 1);
                                if (!arr.length) delete this.trash[sub][chap];
                                if (!Object.keys(this.trash[sub] || {}).length) delete this.trash[sub];
                                this.persistTrash();
                                return;
                            }
                            alert('无法恢复：题库「' + gsub + ' - ' + gchap + '」中已存在相同 ID 的另一道题目。\n\n为避免全局 ID 冲突，本次恢复已取消，题目仍安全保留在回收站中。可先处理那条题目（删除或改 ID）后再来恢复。');
                            return;
                        }
                    }

                    if (!this.bank[targetSub]) this.bank[targetSub] = {};
                    if (!Array.isArray(this.bank[targetSub][targetChap])) this.bank[targetSub][targetChap] = [];
                    // 同 ID 冲突处理：内容相同 → 跳过恢复；内容不同 → 旧题让位进回收站，恢复的题入列
                    const dupIdx = this.bank[targetSub][targetChap].findIndex(x => x && x.id === id);
                    if (dupIdx !== -1) {
                        const dup = this.bank[targetSub][targetChap][dupIdx];
                        const same = dup.type === cleanQ.type && dup.q === cleanQ.q && JSON.stringify(dup.o || []) === JSON.stringify(cleanQ.o || []) && dup.a === cleanQ.a;
                        if (same) {
                            // 题库中已有同内容题，回收站这份直接销毁（避免重复 ID）
                            arr.splice(idx, 1);
                            if (!arr.length) delete this.trash[sub][chap];
                            if (!Object.keys(this.trash[sub] || {}).length) delete this.trash[sub];
                            this.persistTrash();
                            return;
                        }
                        this._moveToTrash(targetSub, targetChap, [dup], 'restore-conflict');
                        this.bank[targetSub][targetChap].splice(dupIdx, 1);
                    }
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

                // 回收站里的题目总数（多处都要用到，统一成一个方法避免各写一遍遍历）
                getTrashCount() {
                    const trash = this.trash;
                    if (!trash || typeof trash !== 'object') return 0;
                    let n = 0;
                    for (const sub of Object.keys(trash)) {
                        const chapDict = trash[sub];
                        if (!chapDict || typeof chapDict !== 'object') continue;
                        for (const chap of Object.keys(chapDict)) {
                            const arr = chapDict[chap];
                            if (Array.isArray(arr)) n += arr.length;
                        }
                    }
                    return n;
                },

                // 清空回收站
                emptyTrash() {
                    if (!confirm("确定要清空回收站中的所有题目吗？该操作不可恢复。")) return;
                    this.trash = {};
                    this.persistTrash();
                    if (window.App && App.ui && typeof App.ui.openTrashModal === 'function') {
                        App.ui.openTrashModal();
                    }
                    if (window.App && App.router && typeof App.router.refresh === 'function') {
                        App.router.refresh();
                    }
                },

                _idCounter: 0,

                generateQuestionId() {
                    if (typeof this._idCounter !== 'number') this._idCounter = 0;
                    return `q-${Date.now()}-${(this._idCounter++).toString(36)}-${Math.random().toString(36).slice(2, 4)}`;
                },

                // 清理变空的章节/科目容器（避免 UI 里出现空章节）。
                // 注意：必须在写入目标容器【之后】调用，否则会误删刚要用到的位置。
                _pruneEmptyContainers() {
                    for (const sub in this.bank) {
                        const chapDict = this.bank[sub];
                        if (!chapDict || typeof chapDict !== 'object') { delete this.bank[sub]; continue; }
                        for (const chap in chapDict) {
                            const arr = chapDict[chap];
                            if (!Array.isArray(arr) || arr.length === 0) delete chapDict[chap];
                        }
                        if (Object.keys(chapDict).length === 0) delete this.bank[sub];
                    }
                },

                // 按 id 合并两个题目数组（后者覆盖前者）。
                // 重命名合并到已存在的同名科目/章节时用它去重，避免出现重复题目。
                _mergeById(existing, incoming) {
                    const out = new Map();
                    for (const q of (Array.isArray(existing) ? existing : [])) {
                        if (q && typeof q.id === 'string') out.set(q.id, q);
                    }
                    for (const q of (Array.isArray(incoming) ? incoming : [])) {
                        if (q && typeof q.id === 'string') out.set(q.id, q);
                    }
                    return Array.from(out.values());
                },

                upsertQuestion(question) {
                    const q = { ...question };
                    if (!q.id || typeof q.id !== 'string') {
                        q.id = this.generateQuestionId();
                    }

                    // 先摘除同 id 的旧题，但【不要】在这里删掉变空的章节/科目——
                    // 否则当被编辑的题恰好是所在章节的唯一一题时，下面 push 的目标容器
                    // 已经被删掉，会抛 TypeError 并把这道题从内存里抹掉。
                    let isEdit = false;
                    for (const sub in this.bank) {
                        const chapDict = this.bank[sub];
                        if (!chapDict || typeof chapDict !== 'object') continue;
                        for (const chap in chapDict) {
                            const arr = chapDict[chap];
                            if (!Array.isArray(arr)) continue;
                            const idx = arr.findIndex(x => x && x.id === q.id);
                            if (idx !== -1) { arr.splice(idx, 1); isEdit = true; }
                        }
                    }
                    // 编辑已有题时记录编辑时间：详情抽屉据此提示「早于该时间的
                    // 作答记录可能对应旧版题目内容」（历史没有题目版本号，只能到这个粒度）
                    if (isEdit) q._editedAt = Date.now();

                    // 摘除之后再确保目标容器存在，然后写入
                    if (!this.bank[q.sub]) this.bank[q.sub] = {};
                    if (!Array.isArray(this.bank[q.sub][q.chap])) this.bank[q.sub][q.chap] = [];
                    this.bank[q.sub][q.chap].push(q);

                    // 清理残留的空容器
                    this._pruneEmptyContainers();
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
                    if (changed) {
                        this._pruneEmptyContainers();
                        this.persistBank();
                    }
                },

                getSubjects() { return Object.keys(this.bank); },
                getChapters(sub) { return this.bank[sub] ? Object.keys(this.bank[sub]) : []; },

                getStats() {
                    const all = this.getQuestions();
                    // 读路径也要防护：getStats 是首页每次渲染都会调的函数，
                    // 一旦 history 里混进 null / 非法时间戳，new Date(x.t).toISOString()
                    // 会抛 RangeError 导致整个首页白屏。这里统一过一遍校验。
                    const h = this.sanitizeHistory(this.history);
                    // ===== 单遍聚合：一次遍历同时算出错题频次/日桶/科目/题型/用时分布 =====
                    // 旧实现每个统计各扫一遍 history（日报 30 遍、连续天数最多 365 遍），
                    // 记录多时首页每次渲染都是几十万次比较级别。结果与旧逻辑完全一致。
                    const activeIds = this._activeQuestionIds();
                    const qInfo = new Map();                    // id -> { sub, type }
                    for (const q of all) {
                        if (q && q.id) qInfo.set(q.id, { sub: q.sub, type: q.type });
                    }

                    const errFreq = {};
                    const byDay = new Map();                    // 本地日 -> { a, c }
                    const subAgg = new Map();                   // 科目 -> { a, c }
                    const typeStats = { mcq: { a: 0, c: 0 }, tf: { a: 0, c: 0 }, multi: { a: 0, c: 0 }, fill: { a: 0, c: 0 } };
                    let corr = 0, durSum = 0, durCount = 0;
                    const durBuckets = [0, 0, 0, 0, 0];

                    for (const x of h) {
                        if (x.r) corr++;
                        const info = qInfo.get(x.id);
                        // 错题只统计：在库、未被「移出错题本」的题（回收站/已删除不计入口径）
                        if (!x.r && info && activeIds.has(x.id) && !this.isMistakeHidden(x.id)) {
                            errFreq[x.id] = (errFreq[x.id] || 0) + 1;
                        }
                        // 日桶（本地日历日）
                        const dk = utils.localDayKey(x.t);
                        const day = byDay.get(dk) || { a: 0, c: 0 };
                        day.a++;
                        if (x.r) day.c++;
                        byDay.set(dk, day);
                        // 科目
                        if (info && info.sub) {
                            const s = subAgg.get(info.sub) || { a: 0, c: 0 };
                            s.a++;
                            if (x.r) s.c++;
                            subAgg.set(info.sub, s);
                        }
                        // 题型
                        if (info && typeStats[info.type]) {
                            typeStats[info.type].a++;
                            if (x.r) typeStats[info.type].c++;
                        }
                        // 用时
                        if (x.d > 0) {
                            durSum += x.d;
                            durCount++;
                            const sec = x.d / 1000;
                            if (sec < 5) durBuckets[0]++;
                            else if (sec < 15) durBuckets[1]++;
                            else if (sec < 30) durBuckets[2]++;
                            else if (sec < 60) durBuckets[3]++;
                            else durBuckets[4]++;
                        }
                    }

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
                        const s = subAgg.get(sub) || { a: 0, c: 0 };
                        subjectStats[sub] = {
                            attempts: s.a,
                            correct: s.c,
                            acc: s.a ? Math.round(s.c / s.a * 100) : 0
                        };
                    });

                    Object.keys(typeStats).forEach(t => {
                        typeStats[t].acc = typeStats[t].a ? Math.round(typeStats[t].c / typeStats[t].a * 100) : 0;
                    });

                    const daily30 = [];
                    for (let i = 29; i >= 0; i--) {
                        const d = new Date(); d.setDate(d.getDate() - i);
                        const ds = utils.localDayKey(d);
                        const recs = byDay.get(ds);
                        daily30.push({
                            date: ds,
                            label: `${d.getMonth() + 1}/${d.getDate()}`,
                            attempts: recs ? recs.a : 0,
                            correct: recs ? recs.c : 0,
                            acc: recs && recs.a ? Math.round(recs.c / recs.a * 100) : null
                        });
                    }

                    const avgDuration = durCount ? Math.round(durSum / durCount / 1000) : null;

                    let streak = 0;
                    // 今天还没刷不影响连续天数：从昨天开始回溯（今天刷了则含今天）
                    const todayKey = utils.localDayKey(new Date());
                    const startOffset = byDay.has(todayKey) ? 0 : 1;
                    for (let i = startOffset; i <= 365; i++) {
                        const d = new Date(); d.setDate(d.getDate() - i);
                        if (!byDay.has(utils.localDayKey(d))) break;
                        streak++;
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
                // 恢复全部被「移出错题本」的题：清空隐藏名单，让它们重新按错误记录出现在错题本里
                restoreHiddenMistakes() {
                    if (!Array.isArray(this.hiddenMistakeIds) || !this.hiddenMistakeIds.length) return;
                    this.hiddenMistakeIds = [];
                    this._errFreqCache = null;
                    this._isHistoryDirty = true;
                    this.saveHistory();   // hiddenMistakeIds 随全量/增量同步上云（partialFields 白名单已含）
                    if (window.App && App.router && typeof App.router.refresh === 'function') {
                        App.router.refresh();
                    }
                },

                // ===== 间隔复习（SM-2 遗忘曲线，Anki 同款思路）=====
                // 状态全部由作答记录按时间顺序推导，不新增存储结构——
                // history 本身已云端同步，SRS 状态随之在多设备间天然一致。
                _srsFromRecords(recs) {
                    let ef = 2.5;          // easiness factor（1.3 ~ 2.8）
                    let interval = 0;      // 当前复习间隔（天）
                    let rep = 0;           // 连续答对次数
                    let lastT = null;
                    for (const rec of recs) {
                        lastT = rec.t;
                        if (rec.r) {
                            rep += 1;
                            interval = rep === 1 ? 1 : (rep === 2 ? 6 : Math.max(1, Math.round(interval * ef)));
                            if (interval > 365) interval = 365;
                            ef = Math.min(ef + 0.1, 2.8);
                        } else {
                            rep = 0;
                            interval = 0;   // 答错：当天即到期，重新开始
                            ef = Math.max(ef - 0.2, 1.3);
                        }
                    }
                    // 到期时间 = 最后一次作答 + 间隔天数；答错（interval=0）当场到期
                    const dueAt = lastT == null ? null : lastT + interval * 86400000;
                    return { ef, interval, rep, lastT, dueAt };
                },

                // 今日到期（含已过期）的复习队列：只含有作答记录的题，按到期时间排序
                getReviewQueue() {
                    const h = this.getSafeHistory();
                    if (!h.length) return [];
                    const byId = new Map();
                    for (const rec of h) {
                        if (!byId.has(rec.id)) byId.set(rec.id, []);
                        byId.get(rec.id).push(rec);
                    }
                    const endOfDay = (() => {
                        const d = new Date();
                        d.setHours(23, 59, 59, 999);
                        return d.getTime();
                    })();
                    const due = [];
                    for (const [id, recs] of byId) {
                        if (!recs.length) continue;
                        const srs = this._srsFromRecords(recs);
                        if (srs.dueAt != null && srs.dueAt <= endOfDay) {
                            const q = this.getQuestionById(id);
                            if (q) due.push({ ...q, _srs: srs });
                        }
                    }
                    due.sort((a, b) => a._srs.dueAt - b._srs.dueAt);
                    return due;
                },

                getDueCount() {
                    return this.getReviewQueue().length;
                },

                _histRev: 0,
                _sanitizedCache: null,
                _sanitizedCacheRev: -1,

                record(id, res, duration = 0) {
                    // 时间戳必须严格单调递增：增量同步用 (id|t) 做去重键，
                    // 若同一毫秒产生两条记录，会有一条被判为「已存在」而永久丢掉。
                    const now = Math.max(Date.now(), (this._lastRecordTs || 0) + 1);
                    this._lastRecordTs = now;
                    // 稳定记录 ID：跨设备/去重/排序都以它为准，不再依赖毫秒时间戳
                    const rid = crypto.randomUUID ? crypto.randomUUID() : (now.toString(36) + Math.random().toString(36).slice(2, 10));
                    // 用时达到上限（300s 截断）打标记：展示层据此显示「≥5分」而不是假装精确计时
                    const capped = duration >= 300000;
                    const entry = capped
                        ? { id, r: res, t: now, d: 300000, rid, x: 1 }
                        : { id, r: res, t: now, d: duration, rid };
                    this.history.push(entry);
                    this.bumpHistoryRev();
                    // 增量同步：同时追加到 buffer，供下次 save 时发送
                    this._historyAppendBuffer.push(entry);
                    // 又答错了 → 取消「移除错题」的隐藏，让这道题重新回到错题本。
                    // 否则用户点了移除之后，即使再次做错也永远看不到它。
                    if (res === false && this.isMistakeHidden(id)) {
                        this.hiddenMistakeIds = this.hiddenMistakeIds.filter(x => x !== id);
                    }
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

                    // Reset classes on dot and button（与 HTML 头部保持一致的响应式：手机端只显示状态点）
                    btn.className = "h-8 flex items-center gap-1.5 px-2 sm:gap-2 sm:px-3 rounded-lg border text-[11px] sm:text-xs font-medium transition-all duration-200 active:scale-95 border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50";
                    icon.className = "w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full transition-all duration-300";
                    
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
                                    <div class="text-[11px] uppercase tracking-wider text-[var(--sub)]">同步诊断</div>
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
                            const time = (() => { const d = App.utils.parseUtcDate(l.created_at); return d ? d.toLocaleString() : ''; })();
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
                                <div class="text-[11px] text-[var(--sub)]">
                                    题库变化 ${qd >= 0 ? '+' : ''}${qd}，记录变化 ${hd >= 0 ? '+' : ''}${hd}${td ? `，回收站变化 ${td >= 0 ? '+' : ''}${td}` : ''}
                                </div>
                                ${l.error ? `<div class="text-[11px] text-red-500">错误：${App.utils.escapeHTML(l.error)}</div>` : ''}
                            `;
                            list.appendChild(line);
                        });
                    }
                    if (modal._closeTimer) { clearTimeout(modal._closeTimer); modal._closeTimer = null; }
                    modal.classList.remove('hidden');
                    void modal.offsetWidth;
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
                    modal._closeTimer = setTimeout(() => {
                        modal.classList.add('hidden');
                        modal._closeTimer = null;
                    }, 200);
                },
                startAutoPull(intervalMs) {
                    // Bug #16 fix: 轮询回退机制，当实时推送网关不可用时定期拉取更新
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