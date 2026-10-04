// i18n：双语言（纯中文 / 纯英文）+ 偏好设置
// 设计：
// - UI 字符串在源码里大多是「中文 (English)」混合形态，t() 按当前语言
//   自动剥离/提取括注；纯中文串和特殊混合串走字典精确匹配。
// - 只翻译「我们自己生成的 UI 字符串」；用户题库内容（题干/选项/科目名）
//   永不经过 t()，DOM walker 也只对精确命中字典的文本节点动手，杜绝误伤。
export const i18n = {
    lang: 'zh',   // 'zh' | 'en'

    // ============ 字典：key 为源码中的原串 ============
    // zh: 纯中文形态；en: 纯英文形态。缺失条目按括注规则回退。
    dict: {
        // ---- 顶栏 / 导航 ----
        '账户': { en: 'Account' },
        '登录': { en: 'Sign in' },
        '返回主页': { en: 'Home' },
        '同步状态（点击查看同步记录）': { en: 'Sync status (click for sync log)' },
        '已同步': { en: 'Synced' },
        '同步中...': { en: 'Syncing...' },
        '同步失败': { en: 'Sync failed' },
        '未登录': { en: 'Signed out' },
        '未连接': { en: 'Offline' },
        '最近同步：成功': { en: 'Last sync: success' },
        '最近同步：失败': { en: 'Last sync: failed' },
        '实时通道未连接': { en: 'Realtime channel offline' },
        '切换深色/浅色主题': { en: 'Toggle dark/light theme' },
        '回收站': { en: 'Trash' },
        '设置': { en: 'Settings' },
        '返回首页': { en: 'Back to home' },
        '关闭': { en: 'Close' },

        // ---- 账户菜单 ----
        '个人空间': { en: 'Profile' },
        '学习分析报告': { en: 'Analytics' },
        '导入题库': { en: 'Import questions' },
        '导出全部题库': { en: 'Export bank (JSON)' },
        '导出 PDF（打印版题库）': { en: 'Export PDF (printable)' },
        '同步记录': { en: 'Sync log' },
        '修改密码': { en: 'Change password' },
        '退出登录': { en: 'Sign out' },
        '注销账号（删除全部数据）': { en: 'Delete account (all data)' },
        '题': { en: '' },
        '天': { en: 'd' },

        // ---- 认证 ----
        '请先登录': { en: 'Sign in required' },
        '为了在所有设备间同步题库与学习数据，使用前需要先登录账号。': { en: 'Sign in to sync your question bank and study data across devices.' },
        '登录 / 注册': { en: 'Sign in / Sign up' },
        '账号登录': { en: 'Sign in' },
        '关闭登录弹窗': { en: 'Close' },
        '用户名': { en: 'Username' },
        '密码': { en: 'Password' },
        '注册': { en: 'Sign up' },
        '请输入用户名和密码': { en: 'Username and password are required' },
        '登录中...': { en: 'Signing in...' },
        '注册中...': { en: 'Signing up...' },
        '登录成功': { en: 'Signed in' },
        '注册成功，可以直接使用该用户名登录': { en: 'Account created. You can sign in now.' },
        '服务器暂时不可用，请稍后重试': { en: 'Server temporarily unavailable. Try again later.' },
        '服务器未返回登录凭证，请稍后重试': { en: 'Server did not return a token. Try again later.' },
        '服务器未返回注册凭证，请稍后重试': { en: 'Server did not return a token. Try again later.' },
        '该用户名已被注册': { en: 'Username already taken' },
        '注册失败': { en: 'Sign up failed' },
        '登录失败': { en: 'Sign in failed' },

        // ---- 练习配置 ----
        '练习配置': { en: 'Practice setup' },
        '开始练习': { en: 'Start' },
        '开始刷题': { en: 'Start practice' },
        '提交答卷': { en: 'Submit' },
        '下一题': { en: 'Next' },
        '全选': { en: 'All' },
        '取消全选': { en: 'None' },
        '选择科目 (Select Subjects):': { en: 'Select subjects:' },
        '请至少勾选一个章节再开始练习。': { en: 'Select at least one chapter first.' },
        '当前题库为空，请先在设置中导入题库文件。': { en: 'The bank is empty. Import a JSON file first.' },
        '选中的章节下没有符合的题目。': { en: 'No questions in the selected chapters.' },
        '此筛选条件下没有符合的题目。请更改条件后重试。': { en: 'No questions match your filter. Adjust and retry.' },
        '太棒了！您的题库中暂无错题。': { en: 'Great job! No mistakes recorded.' },
        '今日没有到期的复习题目。': { en: 'Nothing due for review today.' },
        '先完成一轮练习，复习计划会随后出现。': { en: 'Finish a round first; the review plan will appear.' },

        // ---- 答题 ----
        '单选': { en: 'Single' },
        '多选': { en: 'Multiple' },
        '判断': { en: 'True/False' },
        '填空': { en: 'Fill-in' },
        '单选题': { en: 'Single choice' },
        '多选题': { en: 'Multiple select' },
        '判断题': { en: 'True/False' },
        '填空题': { en: 'Fill-in-the-blank' },
        '退出': { en: 'Exit' },
        '提交答卷': { en: 'Submit' },
        '下一题': { en: 'Next' },
        '请至少选择一个选项！(Select at least one option)': { en: 'Select at least one option!' },
        '请先输入你的答案。(Please type your answer)': { en: 'Type your answer first.' },
        '回答正确！': { en: 'Correct!' },
        '回答错误 (Incorrect)': { en: 'Incorrect' },
        '太棒了，完全匹配。': { en: 'Perfect match.' },
        '太棒了，与系统答案完全一致。': { en: 'Exactly right.' },
        '正确答案是：': { en: 'Correct answer: ' },
        '正确答案：': { en: 'Correct answer: ' },
        '你的答案：': { en: 'Your answer: ' },
        '回答正确。系统答案：': { en: 'Correct. Accepted answer: ' },
        '练习还在进行中，确定要退出吗？': { en: 'Quit this practice session?' },
        '已作答的题目会保留并同步，未作答的部分将丢弃。': { en: 'Answered questions are kept and synced; the rest are discarded.' },

        // ---- 结果页 ----
        '评估完成': { en: 'Session complete' },
        '答对 Correct': { zh: '答对', en: 'Correct' },
        '答错 Mistakes': { zh: '答错', en: 'Mistakes' },
        '未作答 Unanswered': { zh: '未作答', en: 'Unanswered' },
        '再练一组': { en: 'Practice again' },

        // ---- 首页 ----
        '错题本': { en: 'Mistake book' },
        '错题突击': { en: 'Mistake drill' },
        '七日趋势': { en: '7-day trend' },
        '排名': { en: '#' },
        '题目与正确答案': { en: 'Question & correct answer' },
        '错误次数': { en: 'Wrong count' },
        '暂无错题数据，太棒了！': { en: 'No mistakes yet. Keep it up!' },
        '题库还是空的，先导入一份题目开始练习吧。': { en: 'The bank is empty — import questions to start.' },
        '平均单题用时': { en: 'Avg time / question' },
        '今日复习到期': { en: 'Due for review today' },
        '开始复习': { en: 'Start review' },
        '今日目标': { en: 'Daily goal' },
        '今日已练': { en: 'Practiced today' },
        '已达成': { en: 'Done!' },

        // ---- 题库页 ----
        '题库': { en: 'Bank' },
        '收藏': { en: 'Starred' },
        '错题': { en: 'Mistakes' },
        '收藏模式取消收藏后该行会移出列表': { en: '' },
        '答案：': { en: 'Answer: ' },
        '此题为填空题，作答时输入答案。': { en: 'Fill-in question — type the answer when practicing.' },
        '此题为判断题。': { en: 'True/False question.' },
        '选项数据缺失': { en: 'Options missing' },
        '已显示': { en: 'Showing' },
        '继续下滑加载更多…': { en: 'scroll for more…' },

        // ---- 分析页 ----
        '学习分析': { en: 'Analytics' },
        '当前科目暂无练习数据。': { en: 'No practice data for this subject.' },
        '平均用时约': { en: 'Avg ~' },
        '总用时': { en: 'Total' },
        '秒': { en: 's' },

        // ---- 个人空间 ----
        '注册于': { en: 'Joined' },
        '连续天数': { en: 'Day streak' },
        '题库总量': { en: 'Questions' },
        '累计作答': { en: 'Attempts' },
        '总正确率': { en: 'Accuracy' },
        '平均用时': { en: 'Avg time' },
        '成就': { en: 'Badges' },
        '科目掌握': { en: 'Subject mastery' },
        '最近动态': { en: 'Recent activity' },
        '成就墙': { en: 'Badges' },
        '账户操作': { en: 'Account actions' },
        '还没有科目数据。': { en: 'No subject data yet.' },
        '还没有作答记录，去练习一轮吧。': { en: 'No attempts yet — go practice a round.' },
        '复制': { en: 'Copy' },
        '已复制': { en: 'Copied' },
        '已点亮': { en: 'Unlocked' },
        '未作答': { en: 'Unanswered' },
        '答对': { en: 'Correct' },
        '答错': { en: 'Mistake' },
        '题目已删除': { en: 'Question deleted' },
        '请先登录查看': { en: 'Sign in to view' },
        '登录后即可查看你的学习数据、趋势与成就。': { en: 'Sign in to see your stats, trends and badges.' },
        '导出备份 JSON': { en: 'Export backup (JSON)' },
        '导出 PDF 打印版': { en: 'Export printable PDF' },
        '注销账号（删除全部数据） ': { en: 'Delete account' },

        // ---- 成就 ----
        '初来乍到': { en: 'First steps' },
        '注册账号': { en: 'Create an account' },
        '小试牛刀': { en: 'First attempt' },
        '完成第 1 次作答': { en: 'Answer your first question' },
        '百题斩': { en: 'Century' },
        '累计作答 ≥ 100 次': { en: '100 total attempts' },
        '千题斩': { en: 'Grand slam' },
        '累计作答 ≥ 1000 次': { en: '1000 total attempts' },
        '三日坚持': { en: '3-day streak' },
        '连续练习 ≥ 3 天': { en: 'Practice 3 days in a row' },
        '七日之约': { en: '7-day streak' },
        '连续练习 ≥ 7 天': { en: 'Practice 7 days in a row' },
        '三十而立': { en: '30-day streak' },
        '连续练习 ≥ 30 天': { en: 'Practice 30 days in a row' },
        '神射手': { en: 'Sharpshooter' },
        '≥50 次作答且正确率 ≥ 85%': { en: '50+ attempts with 85%+ accuracy' },
        '完美一日': { en: 'Perfect day' },
        '单日作答 ≥ 20 次且全部正确': { en: '20+ correct answers in one day' },
        '收藏家': { en: 'Collector' },
        '收藏 ≥ 10 题': { en: 'Star 10 questions' },
        '题库建筑师': { en: 'Architect' },
        '题库 ≥ 50 题': { en: 'Bank of 50+ questions' },
        '全科探索': { en: 'Explorer' },
        '在 ≥ 3 个科目作答过': { en: 'Practice in 3+ subjects' },

        // ---- 系统配置弹窗 ----
        '系统配置': { en: 'Settings' },
        '题库管理': { en: 'Question bank' },
        '科目 / 章节管理': { en: 'Subjects / chapters' },
        '疑似相似题审查': { en: 'Similar question review' },
        '清空当前题库': { en: 'Clear the bank' },
        '偏好设置': { en: 'Preferences' },
        '界面语言 (Language)': { zh: '界面语言', en: 'Language' },
        '简体中文': { en: '中文 (Simplified)' },
        'English': { zh: '英语 (English)', en: 'English' },
        '每日目标（题）': { zh: '每日目标（题）', en: 'Daily goal (questions)' },
        '关闭目标': { zh: '关闭', en: 'Off' },
        '自定义': { zh: '自定义', en: 'Custom' },
        '默认练习题数': { zh: '默认练习题数', en: 'Default questions per session' },
        '保存偏好': { zh: '保存', en: 'Save' },
        '偏好已保存，页面即将刷新…': { en: 'Saved. Reloading…' },
        '每日目标（题）': { en: 'Daily goal (questions)' },
        '0 = 不设目标': { en: '0 = off' },
        '默认练习题数': { en: 'Default questions per session' },
        '界面语言': { en: 'Language' },
        '保存': { en: 'Save' },

        // ---- 常见提示（无括注的 alert/confirm）----
        '确定要退出登录吗？': { en: 'Sign out?' },
        '本地缓存会清空，题库和学习记录都保留在云端，下次登录自动恢复。': { en: 'Local cache is cleared; the bank and history stay in the cloud and return on next sign-in.' },
        '请先选择 JSON 文件并完成预览解析。': { en: 'Pick a JSON file and preview it first.' },
        '打印窗口被浏览器拦截了。': { en: 'The print window was blocked.' },
        '请允许本站弹出窗口后重试（地址栏右侧一般会有拦截提示）。': { en: 'Allow pop-ups for this site and retry.' },
        '题库为空，没有可导出的内容。': { en: 'The bank is empty — nothing to export.' },
        '该用户名被保留，请换一个 (Username reserved)': { en: 'That username is reserved.' },
        '原密码不正确': { en: 'Current password is incorrect' },
        '两次输入的新密码不一致。': { en: 'New passwords do not match.' },
        '新密码不能与原密码相同。': { en: 'New password must differ from the current one.' },
        '密码修改成功，下次登录请使用新密码。': { en: 'Password changed. Use the new password next time.' },
        '确定清空题库吗？该操作不会清空您的做题记录。': { en: 'Clear the whole bank? Practice history is kept.' },
        '确定清空所有刷题记录吗？': { en: 'Clear all practice history?' },
        '确定要永久删除这道题吗？此操作不可恢复。': { en: 'Permanently delete this question? This cannot be undone.' },
        '确定要退出吗？': { en: 'Exit?' },
        '请输入你的答案 (Please type your answer)': { en: 'Type your answer first.' }
    },

    // 读取当前语言与偏好
    loadPrefs() {
        try {
            this.lang = localStorage.getItem('qs_lang') === 'en' ? 'en' : 'zh';
        } catch (e) { this.lang = 'zh'; }
        return this.lang;
    },

    // ============ 核心：UI 字符串翻译 ============
    // 只用于「应用自己生成的字符串」。规则：
    // 1) 字典精确命中 → 对应语言值（zh 可能是纯中文剥离形态）
    // 2) 尾部 ASCII 括注「 (English…)」→ zh 剥离 / en 提取
    // 3) 原样返回
    t(s) {
        if (s == null) return s;
        const str = String(s);
        const hit = this.dict[str];
        if (hit) {
            if (this.lang === 'en') return hit.en !== undefined ? hit.en : str;
            return hit.zh !== undefined ? hit.zh : str;
        }
        // 尾部括注：半角/全角括号，内容必须全是 ASCII（英文/标点/数字/空白）
        const m = str.match(/([\s]?)([(（])([\x20-\x7E]+)([)）])$/);
        if (m && m[3].length > 1) {
            const head = str.slice(0, m.index);
            if (this.lang === 'en') {
                // 主体含中文 → 括注就是它的英文翻译；主体本就是英文/字母 → 原样
                return /[\u4e00-\u9fa5]/.test(head) ? m[3] : str;
            }
            return head;   // zh：剥掉英文括注
        }
        return str;
    },

    // ============ DOM 静态文本 walker ============
    // 只处理「整节点文本精确命中字典」或「整节点命中尾括注模式」的文本节点，
    // 且跳过所有题库内容容器——用户内容零风险。
    skipSelector: '#q-text, #fb-desc, #lib-list, #insight-drawer, #modal-dup-review, .stem, .qt, #print-root, #setup-options, #smart-subjects-list, .qe-opt-row, #import-json-list, #import-json-struct, textarea, input, #res-score, #am-stats, #profile-root',
    walk(root) {
        const walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: (n) => {
                if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                const p = n.parentElement;
                if (!p) return NodeFilter.FILTER_REJECT;
                // data-i18n 白名单：显式标记的 UI 按钮优先于 skip 区域
                if (!p.closest('[data-i18n]') && p.closest(this.skipSelector)) return NodeFilter.FILTER_REJECT;
                if (p.closest('script,style')) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        for (const node of nodes) {
            const raw = node.nodeValue;
            const trimmed = raw.trim();
            const hit = this.dict[trimmed];
            let replacement = null;
            if (hit) {
                const val = this.lang === 'en' ? hit.en : (hit.zh !== undefined ? hit.zh : trimmed);
                if (val !== undefined && val !== trimmed) {
                    replacement = raw.replace(trimmed, val);
                }
            } else if (this.lang === 'en') {
                // 整节点为「中文 (English)」混合形态
                const m = trimmed.match(/^([\s\S]+)([\s]?)([(（])([\x20-\x7E]{2,})([)）])$/);
                if (m && /[\u4e00-\u9fa5]/.test(m[1])) {
                    replacement = raw.replace(trimmed, m[4].trim());
                }
            } else {
                // zh 模式：剥掉主体为中文的英文尾括注（「…。(Minutes ago)」→「…。」）
                const m = trimmed.match(/^([\s\S]+)([\s]?)([(（])([\x20-\x7E]{2,})([)）])$/);
                if (m && /[\u4e00-\u9fa5]/.test(m[1]) && !/[\u4e00-\u9fa5]/.test(m[4])) {
                    replacement = raw.replace(trimmed, m[1].trim());
                }
            }
            if (replacement !== null) node.nodeValue = replacement;
        }
    },

    // 翻译 title/aria-label/placeholder 属性
    walkAttrs(root) {
        const sel = '[title], [aria-label], [placeholder]';
        const els = (root || document).querySelectorAll(sel);
        for (const el of els) {
            if (el.closest(this.skipSelector)) continue;
            for (const attr of ['title', 'aria-label', 'placeholder']) {
                const v = el.getAttribute && el.getAttribute(attr);
                if (!v) continue;
                const t = v.trim();
                const hit = this.dict[t];
                if (hit) {
                    const val = this.lang === 'en' ? hit.en : (hit.zh !== undefined ? hit.zh : t);
                    if (val !== undefined && val !== t) el.setAttribute(attr, val);
                } else if (this.lang === 'en') {
                    const m = t.match(/^([\s\S]+)([\s]?)([(（])([\x20-\x7E]{2,})([)）])$/);
                    if (m && /[\u4e00-\u9fa5]/.test(m[1])) el.setAttribute(attr, m[4].trim());
                }
            }
        }
    },

    // 兼容入口：语言切换按钮历史上曾指向 App.i18n.pickLang——代理到 prefs
    pickLang(lang) {
        if (window.App && App.prefs && typeof App.prefs.pickLang === 'function') {
            App.prefs.pickLang(lang);
        } else {
            try { localStorage.setItem('qs_lang', lang); } catch (e) { }
            location.reload();
        }
    },

    // boot：应用语言（monkey-patch alert/confirm + 全 DOM 翻译）
    apply() {
        this.loadPrefs();
        document.documentElement.lang = this.lang === 'en' ? 'en' : 'zh-CN';
        const origAlert = window.alert.bind(window);
        const origConfirm = window.confirm.bind(window);
        window.alert = (s) => origAlert(s == null ? s : this.t(s));
        window.confirm = (s) => origConfirm(s == null ? s : this.t(s));
        this.walk(document.body);
        this.walkAttrs(document);
    }
};
