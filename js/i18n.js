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

        // ---- 打印工具栏 ----
        '在打印对话框的「目标打印机」中选择「另存为 PDF」，即可导出 PDF 文件': { en: 'Choose "Save as PDF" as the destination printer in the print dialog to export a PDF file.' },

        // ---- 打印 v2 ----
        '我的答案：': { en: 'My answer: ' },
        '打印 / 保存为 PDF': { en: 'Print / Save as PDF' },
        '参考答案': { en: 'Answer key' },
        '题号': { en: 'No.' },
        '出处': { en: 'Source' },
        '答案': { en: 'Answer' },
        '导出于': { en: 'Exported on' },

        // ---- 第三波（单科面板/遗忘曲线）----
        '当前科目作答次数': { en: 'Attempts in subject' },
        '当前科目正确率': { en: 'Subject accuracy' },
        '累计作答总时长': { en: 'Total time spent' },
        '涉及题目数量': { en: 'Questions involved' },
        '最近活跃天数': { en: 'Active days' },
        '1-3天': { en: '1-3d' },
        '4-7天': { en: '4-7d' },
        '8-14天': { en: '8-14d' },
        '>14天': { en: '>14d' },

        // ---- 第二轮补齐（analytics/弹窗/同步状态）----
        '暂无科目作答数据': { en: 'No subject data yet' },
        '暂无作答时长数据': { en: 'No time data yet' },
        '暂无充足的练习数据，建议先多做几题。': { en: 'Not enough data yet — answer a few more questions.' },
        '暂无数据，无法估计遗忘趋势。': { en: 'Not enough data to estimate the forgetting curve.' },
        '标准答案：': { en: 'Standard answer: ' },
        '（未设置）': { en: '(not set)' },
        '判分时忽略大小写与空格': { en: 'Case and spaces are ignored when grading' },
        '；多个可接受答案任一命中即算对': { en: '; any accepted answer counts as correct' },
        '今天': { en: 'Today' },
        '取消收藏': { en: 'Unstar' },
        '用户': { en: 'User' },
        '单选题只能有一个正确选项。': { en: 'A single-choice question must have exactly one correct option.' },
        '请为判断题选择正确答案。': { en: 'Please choose the correct answer for the true/false question.' },
        '请填写填空题的正确答案。': { en: 'Please enter the correct answer for the fill-in question.' },
        '请至少勾选一个正确选项。': { en: 'Select at least one correct option.' },
        '选项内容不能为空，并且至少两项。': { en: 'Options cannot be empty and there must be at least two.' },
        '科目和章节不能为空。': { en: 'Subject and chapter are required.' },
        '确定删除这道题吗？': { en: 'Delete this question?' },
        '题目会进入回收站，可随时恢复。': { en: 'It goes to the trash and can be restored anytime.' },
        '新增题目': { en: 'New question' },
        '提交中…': { en: 'Submitting…' },
        '请填写完整三个密码框。': { en: 'Please fill in all three password fields.' },
        '密码不能为空。': { en: 'Password cannot be empty.' },
        '登录状态已失效，请刷新页面后重试。': { en: 'Session expired. Refresh and try again.' },
        '登录状态已失效，请重新登录后再试。': { en: 'Session expired. Sign in again and retry.' },
        '网络异常，请稍后重试。': { en: 'Network error. Try again later.' },
        '网络异常，注销未完成。': { en: 'Network error — account deletion not completed.' },
        '账号已注销。所有数据已删除，感谢使用。': { en: 'Account deleted. All data removed. Thanks for using LMS Genesis.' },
        '用户名不匹配，注销已取消。': { en: 'Username mismatch — deletion cancelled.' },
        '最后一步：输入账号密码以确认注销': { en: 'Final step: enter your password to confirm deletion' },
        '防呆确认：请输入你的用户名「': { en: 'Confirmation: type your username "' },
        '」以继续': { en: '" to continue' },
        '我的题库': { en: 'My bank' },
        '未知': { en: 'Unknown' },
        '正确': { en: 'True' },
        '错误': { en: 'False' },
        '作答次数': { en: 'Attempts' },
        '正确次数': { en: 'Correct' },
        '错误率': { en: 'Error rate' },
        '导入完成。': { en: 'Import finished.' },
        '导入流程异常': { en: 'Import process error' },
        '已取消导入操作。文件预览仍保留，可随时重新点击导入。': { en: 'Import cancelled. The preview is kept — click import again anytime.' },
        '复制失败，请长按手动复制': { en: 'Copy failed — long-press to copy manually' },
        '在原位置未找到对应题目，无法调整。': { en: 'The question was not found at its original place; cannot adjust.' },
        '原科目/章节中未找到该题，可能结构已被修改。': { en: 'The question was not found in its original subject/chapter; the structure may have changed.' },
        '格式要求：': { en: 'Format requirements:' },
        '输出示例（结构与「下载格式模板」完全一致）：': { en: 'Output example (same structure as the downloadable template):' },
        '点击右上角同步状态按钮可查看详情并重试。': { en: 'Click the sync status button (top right) for details and retry.' },
        '登录后题库与学习数据自动同步': { en: 'Sign in to sync your bank and study data' },
        '失败': { en: 'failed' },
        '成功': { en: 'success' },
        '未知错误': { en: 'Unknown error' },
        '登录已过期': { en: 'Session expired' },
        '登录已过期，请重新登录。': { en: 'Session expired. Sign in again.' },
        '，请重新登录。': { en: '. Please sign in again.' },
        '网络错误或无法连接服务器': { en: 'Network error or server unreachable' },
        '网络异常，数据已保存在本地，恢复后自动重试上传': { en: 'Network error — data saved locally and will upload when back online' },
        '合并失败：无法读取云端最新数据。本地修改已全部保留，请稍后重试或先在账户菜单「导出全部题库」备份': { en: 'Merge failed: could not read the latest cloud data. Your local changes are kept — retry later or export a backup first.' },
        '多设备修改冲突，已保留双方数据；请稍后重试或导出备份': { en: 'Conflict between devices: both versions kept. Retry later or export a backup.' },
        '自动备份失败（继续清空）': { en: 'Auto backup failed (clearing anyway)' },
        '获取同步记录失败': { en: 'Failed to load sync log' },
        '解析同步记录失败': { en: 'Failed to parse sync log' },
        '解析服务器响应失败': { en: 'Failed to parse server response' },
        '请输入新的科目名称': { en: 'Enter the new subject name' },
        '刷题记录备份_': { en: 'Practice history backup_' },
        '注册凭证无法解析，请稍后重试': { en: 'Could not parse signup token. Try again later.' },
        '登录凭证无法解析，请稍后重试': { en: 'Could not parse login token. Try again later.' },
        '用户名不能为空': { en: 'Username cannot be empty' },
        '网络连接失败': { en: 'Network connection failed' },
        '（如需永久备份，请先在账户菜单中「导出全部题库」）': { en: '(For a permanent backup, use "Export bank (JSON)" in the account menu first.)' },
        'JSON 解析失败：': { en: 'JSON parse failed: ' },
        '文件里没有找到有效的 JSON 内容。': { en: 'No valid JSON content found in the file.' },
        '文件过大': { en: 'File too large' },
        '结构校验失败：': { en: 'Schema validation failed: ' },
        '导入过程出现异常：': { en: 'Import process error: ' },
        '云端同步失败': { en: 'Cloud sync failed' },
        '数据已安全保存在本机，不会丢失。': { en: 'Data is safe on this device and will not be lost.' },
        '数据已保存在本机；云端将在下次联网时自动同步。': { en: 'Saved locally; it will sync to the cloud automatically when back online.' },
        '本地题库已回滚到导入前状态。请检查 JSON 后重试，或先「导出全部题库」备份。': { en: 'The bank was rolled back to its pre-import state. Check the JSON and retry, or export a backup first.' },
        '请在下方预览确认科目/章节归属，然后点击右下角「导入预览中的题目」。': { en: 'Preview the subjects/chapters below, then click "Import previewed questions".' },
        '请对照「下载格式模板」调整 JSON 后重新选择文件。': { en: 'Adjust the JSON against the downloadable template and pick the file again.' },
        '请检查 JSON 内容——问答题等主观题会被自动忽略。': { en: 'Check the JSON — essay/subjective questions are ignored automatically.' },
        '正在同步到云端…': { en: 'Syncing to cloud…' },
        '已同步到云端 ✓': { en: 'Synced to cloud ✓' },
        '本地与云端的题库现在完全一致，可以关闭此窗口开始刷题了。': { en: 'Local and cloud banks are now identical. Close this window and start practicing.' },
        '解析完成，但': { en: 'Parsed, but ' },
        '未检测到任何符合条件的题目': { en: 'no eligible questions detected' },
        '（单选/多选/判断/填空）。': { en: ' (single/multi/TF/fill).' },
        '未检测到任何符合条件的题目（单选/多选/判断/填空）。': { en: 'No eligible questions detected (single/multi/TF/fill).' },
        'MB）。请上传 5MB 以内的题库文件。': { en: 'MB). Please use a bank file under 5MB.' },

        // ---- 全量 DOM 扫描补齐（自动清单）----
        '管理员': { en: 'Admin' },
        '今日待复习': { en: 'Due today' },
        '基于遗忘曲线安排的复习计划': { en: 'Review plan based on the forgetting curve' },
        '智能练习': { en: 'Smart practice' },
        '可视化数据面板': { en: 'Visual analytics panel' },
        '高频错题': { en: 'Frequent mistakes' },
        '收藏 ★': { en: 'Starred ★' },
        '收藏★': { en: 'Starred ★' },
        '错题突击 →': { en: 'Mistake drill →' },
        '总题库': { en: 'Total questions' },
        '全科目': { en: 'All subjects' },
        '全题型': { en: 'All types' },
        '默认': { en: 'Default' },
        '错率↓': { en: 'Errors ↓' },
        '答案A-Z': { en: 'Answer A-Z' },
        '已选': { en: 'Selected' },
        '删除': { en: 'Delete' },
        '导出': { en: 'Export' },
        '键盘 A–D / 1–4 作答 · Enter 提交': { en: 'Keys A–D / 1–4 to answer · Enter to submit' },
        '多项选择，请选出所有正确选项后提交': { en: 'Multiple select — choose all correct options, then submit' },
        '提交': { en: 'Submit' },
        '提前交卷': { en: 'Submit early' },
        '题型:': { en: 'Type:' },
        '题型：': { en: 'Type:' },
        '全部': { en: 'All' },
        '题数:': { en: 'Count:' },
        '题数：': { en: 'Count:' },
        '总览': { en: 'Overview' },
        '单科分析': { en: 'Single subject' },
        '总作答次数': { en: 'Total attempts' },
        '综合正确率': { en: 'Overall accuracy' },
        '连续学习天数': { en: 'Study streak (days)' },
        '平均作答时长': { en: 'Avg time per answer' },
        '科目视图': { en: 'Subject view' },
        '全部科目': { en: 'All subjects' },
        '30天学习热力图': { en: '30-day study heatmap' },
        '少': { en: 'Less' },
        '多': { en: 'More' },
        '各科目正确率': { en: 'Accuracy by subject' },
        '题型正确率对比': { en: 'Accuracy by type' },
        '作答时长分布': { en: 'Time distribution' },
        '科目概况': { en: 'Subject overview' },
        '科目细节分析': { en: 'Subject details' },
        '当前视图：全部科目': { en: 'Current view: all subjects' },
        '耗时题目排行（点击题目查看详情）': { en: 'Slowest questions (click for details)' },
        '遗忘曲线（30 天正确率）': { en: 'Forgetting curve (30-day accuracy)' },
        '近期作答记录 (Recent Attempts)': { en: 'Recent attempts' },
        '原密码': { en: 'Current password' },
        '新密码（至少 6 位，建议字母+数字混合）': { en: 'New password (6+ chars, letters+numbers recommended)' },
        '确认新密码': { en: 'Confirm new password' },
        '确认修改': { en: 'Confirm change' },
        '云同步记录': { en: 'Cloud sync log' },
        '智能练习配置': { en: 'Smart practice setup' },
        '选择题型 (Question Type):': { en: 'Question type:' },
        '题目数量 (Question Limit):': { en: 'Question limit:' },
        '10 题': { en: '10' },
        '20 题': { en: '20' },
        '50 题': { en: '50' },
        '100 题': { en: '100' },
        '全部 (Max)': { en: 'All (max)' },
        '重置刷题记录': { en: 'Reset practice history' },
        '题库导入中心': { en: 'Import center' },
        '先在此处预览题库结构和每一道题的归属，再决定是否真正导入到当前题库。': { en: 'Preview the bank structure and where each question goes before importing.' },
        '选择 JSON 文件…': { en: 'Choose JSON file…' },
        '下载格式模板': { en: 'Download template' },
        '尚未选择文件': { en: 'No file chosen' },
        '想用 AI 整理题库？复制这段提示词，连同你的资料一起发给它': { en: 'Want AI to build your bank? Copy this prompt and send it with your material' },
        '复制提示词': { en: 'Copy prompt' },
        '把下面的提示词连同你的资料（笔记 / 大纲 / 文档内容）一起发给任意 AI， 它输出的 JSON 直接选择文件或拖进本窗口即可导入。': { en: 'Send the prompt below with your material (notes / outlines / documents) to any AI, then import the JSON it outputs via file picker or drag-drop.' },
        '检测到题目': { en: 'Questions detected' },
        '科目数量': { en: 'Subjects' },
        '章节数量': { en: 'Chapters' },
        '判断 + 填空': { en: 'TF + Fill' },
        '按科目 / 章节分布': { en: 'By subject / chapter' },
        '请选择 JSON 文件后查看科目和章节分布。': { en: 'Pick a JSON file to see subjects and chapters.' },
        '题目预览（最多展示前 50 道）': { en: 'Question preview (first 50 shown)' },
        '暂无预览，请先选择 JSON 文件。': { en: 'Nothing to preview — choose a JSON file first.' },
        '导入预览中的题目': { en: 'Import previewed questions' },
        '编辑题目': { en: 'Edit question' },
        '科目': { en: 'Subject' },
        '优先使用右侧输入的新科目，否则使用下拉框当前选中项。': { en: 'A new subject typed on the right takes priority over the dropdown.' },
        '章节': { en: 'Chapter' },
        '优先使用右侧输入的新章节，否则使用下拉框当前选中项。': { en: 'A new chapter typed on the right takes priority over the dropdown.' },
        '题型': { en: 'Type' },
        '题干': { en: 'Question text' },
        '选项': { en: 'Options' },
        '+ 新增选项': { en: '+ Add option' },
        '不要在这里写 A. / B. 前缀，系统会自动加字母。': { en: 'No "A. / B." prefixes here — letters are added automatically.' },
        '正确答案': { en: 'Correct answer' },
        '正确答案（多个可接受答案用 | 分隔）': { en: 'Correct answer (separate alternatives with |)' },
        '删除题目': { en: 'Delete question' },
        '取消': { en: 'Cancel' },
        '清空': { en: 'Clear' },
        '应用当前选择': { en: 'Apply selection' },
        '√ (正确/True)': { en: '√ (True)' },
        '× (错误/False)': { en: '× (False)' },
        '0天': { en: '0d' },
        '1天': { en: '1d' },
        '1秒': { en: '1s' },
        '<5秒': { en: '<5s' },
        '5-15秒': { en: '5-15s' },
        '15-30秒': { en: '15-30s' },
        '30-60秒': { en: '30-60s' },
        '>60秒': { en: '>60s' },
        '最强科目': { en: 'Best subject' },
        '近 30 天作答趋势': { en: 'Last 30 days' },
        '英语 (English)': { en: 'English' },
        '次 · 未作答': { en: ' attempts · none' },
        '秒/题': { en: 's / q' },
        '秒/次': { en: 's / attempt' },
        '共': { en: 'Total' },
        '次': { en: '' },
        '同步状态': { en: 'Sync status' },
        '进入个人空间': { en: 'Open profile' },
        '展开 / 收起全部详情': { en: 'Expand / collapse all details' },
        '展开或收起全部题目详情': { en: 'Expand or collapse all question details' },
        '多选模式（批量选择 / 删除 / 导出）': { en: 'Multi-select mode (batch select / delete / export)' },
        '进入或退出管理模式': { en: 'Enter or exit manage mode' },
        '搜索题目、选项、章节... (Search)': { en: 'Search questions, options, chapters...' },
        '清空搜索关键词': { en: 'Clear search' },
        '回到顶部': { en: 'Back to top' },
        '在此输入你的答案…': { en: 'Type your answer…' },
        '关闭题目详情': { en: 'Close question details' },
        '关闭修改密码弹窗': { en: 'Close change-password dialog' },
        '显示/隐藏密码': { en: 'Show / hide password' },
        '关闭同步记录': { en: 'Close sync log' },
        '返回设置': { en: 'Back to settings' },
        '关闭题库管理': { en: 'Close bank manager' },
        '关闭智能练习配置': { en: 'Close smart practice setup' },
        '关闭设置': { en: 'Close settings' },
        '关闭导入中心': { en: 'Close import center' },
        '关闭题目编辑器': { en: 'Close question editor' },
        '自定义科目': { en: 'Custom subject' },
        '自定义章节': { en: 'Custom chapter' },
        '请输入题目内容': { en: 'Enter the question text' },
        '例如：TCP|传输控制协议': { en: 'e.g. TCP|Transmission Control Protocol' },
        '关闭回收站': { en: 'Close trash' },
        '关闭相似题审查': { en: 'Close similar review' },
        '详情与作答记录': { en: 'Details & attempt history' },
        '进入或退出收藏模式': { en: 'Enter or exit starred mode' },

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
        // 查字典的兜底顺序：原文 → 空白归一 → 剥装饰尾缀（★ → 等 UI 符号）
        const look = (t) => {
            let hit = this.dict[t];
            if (hit) return { hit, core: t };
            const norm = t.replace(/\s+/g, ' ').trim();
            hit = this.dict[norm];
            if (hit) return { hit, core: norm };
            const deco = norm.match(/^([\s\S]+?)\s*([★☆→←↑↓✦✧]+)$/);
            if (deco && this.dict[deco[1].trim()]) {
                return { hit: this.dict[deco[1].trim()], core: this.dict[deco[1].trim()] && deco[1].trim(), suffix: deco[2] };
            }
            return { hit: null, core: t };
        };
        for (const node of nodes) {
            const raw = node.nodeValue;
            const trimmed = raw.trim();
            const { hit, suffix } = look(trimmed);
            let replacement = null;
            if (hit) {
                const val = this.lang === 'en' ? hit.en : (hit.zh !== undefined ? hit.zh : trimmed);
                if (val !== undefined && val !== trimmed) {
                    replacement = (suffix !== undefined) ? (val ? (val + ' ' + suffix) : suffix) : raw.replace(trimmed, val);
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
            // placeholder/title/aria 是 UI 机制属性，不会携带题库内容——不做 skip 豁免
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
        // 动态渲染兜底：任何 DOM 增删后自动翻译新增部分（轮询 refresh、弹窗、抽屉……）
        let timer = null;
        const pending = new Set();
        const obs = new MutationObserver((muts) => {
            for (const m of muts) {
                for (const n of m.addedNodes) {
                    if (n.nodeType === 1) pending.add(n);
                }
            }
            if (pending.size && !timer) {
                timer = setTimeout(() => {
                    timer = null;
                    for (const el of pending) {
                        if (!el.isConnected) continue;
                        this.walk(el);
                        this.walkAttrs(el);
                    }
                    pending.clear();
                }, 120);
            }
        });
        obs.observe(document.body, { childList: true, subtree: true });
    }
};
