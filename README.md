

这是一个面向**个人学习 / 小规模教学**场景的题库系统：

- 支持 **单选 / 多选 / 判断题** 的导入、管理和练习  
- 支持基于 **Netlify Identity + Postgres (Neon)** 的账号体系  
- 支持 **多设备实时同步**：在任意设备修改题库和做题，几秒内其他设备自动更新  
- 所有核心逻辑封装在一个 `index.html` 前端文件 + 若干 Netlify Functions 中

> 设计目标：在保证体验的同时，尽量降低部署和维护成本——你只需要一个 Netlify 账号和一个 GitHub 仓库。

---

## 功能概览

- **账号 & 权限**
  - 使用 Netlify Identity 登录/登出
  - 未登录时展示登录遮罩且本地数据清空（不展示任何个人题库或记录）
  - 登出时自动清空本地题库、历史、回收站缓存，保护隐私

- **题库管理**
  - 支持多科目、多章节的题库结构：`{ [科目]: { [章节]: Question[] } }`
  - 科目 / 章节增删改（包括重命名）
  - 回收站（软删除、恢复、彻底删除）
  - 自动保持题目内部的 `sub/chap` 与科目/章节结构一致

- **导入中心**
  - **JSON 导入**
    - 基于题库模板（不改模板）导入完整题库
    - 导入前预览：
      - 总题数、科目数、章节数、题型统计
      - 按科目/章节结构预览
      - 前 50 题预览，可逐题修改“科目 / 章节”
    - 导入逻辑：
      - 按 ID 合并到现有题库
      - 完全重复题跳过
      - 同 ID 不同内容 → 旧题软删到回收站 + 覆盖
      - 自动检测“疑似相似题”，提供后续审查入口
  - **AI 文档导入**
    - 支持 `.txt / .md / .docx / .pdf` 作为原始材料
    - 使用 mammoth / pdf.js 等在浏览器解析文档为纯文本
    - 将文本送入大模型，生成符合 JSON 模板的题库，再走同一套预览 + 导入逻辑

- **练习 & 错题本**
  - 总题库浏览、筛选（科目 / 题型 / 排序 / 搜索）
  - 智能练习、自定义练习（基于题库和错题数据）
  - 错题本视图：
    - 根据 history 过滤出错题
    - 支持逐题从错题本中移除，计数实时更新

- **云同步**
  - 所有题库 / 历史 / 回收站变更都会：
    - 写入浏览器 localStorage
    - 通过 Netlify Function (`/api/save-question-set`) 同步到 Postgres
  - 其他设备登录同一账号后：
    - 首次加载 + 登录时拉取云端状态 (`/api/load-question-set`)
    - 后台轮询（默认 8s 一次）保持接近实时同步

- **同步状态可视化**
  - 左上角圆形按钮：
    - 显示本会话内成功/失败同步次数（0–999）
    - hover 提示最近一次同步时间和变化统计（题库/历史/回收站增减）
  - 点击按钮打开「云同步记录」弹窗：
    - 列出最近 50 次同步（成功/失败、delta、时间等）
    - 点击背景或右上角 × 关闭弹窗

---

## 技术栈与架构

- **前端**
  - 纯 HTML + 原生 JS（单文件 `index.html`）
  - Tailwind 风格的原子类（预编译过的 CSS）
  - 不依赖前端构建工具，静态页面即可运行

- **后端 / 数据库**
  - Netlify Functions：
    - `/api/save-question-set`：保存题库和 state 到 Postgres
    - `/api/load-question-set`：从 Postgres 读取题库和 state
    - `/api/sync-logs`：读取同步日志
  - 数据库：
    - Netlify Database（基于 Neon Postgres）
    - 使用 `@netlify/neon` 直接访问
    - 结构：
      - `question_sets(user_id, name, state jsonb, created_at)`
      - `questions(question_set_id, content jsonb)`
      - `sync_logs(user_id, delta jsonb, status, error, created_at)`

- **身份认证**
  - Netlify Identity
  - 前端通过 `netlify-identity-widget.js` + `window.netlifyIdentity` 管理登录状态
  - Functions 通过 `context.clientContext.user` 或 Authorization Bearer JWT 解出用户信息

---

## 本地开发指南

### 1. 前置条件

- Node.js ≥ 18
- npm 或 pnpm
- Netlify CLI（可选，但推荐，用于本地跑 Functions）：

```bash
npm install -g netlify-cli
```

### 2. 克隆与安装依赖

```bash
git clone https://github.com/<your-name>/<your-repo>.git
cd <your-repo>

npm install
```

> 依赖主要用于数据库迁移（drizzle），前端本身不需要构建。

### 3. 本地静态预览（只看前端，不含云同步）

最简单的办法：直接用浏览器打开 `index.html`。

> 注意：这种方式 **不会** 走 Netlify Functions，也没有云端账号/同步，仅用于快速看 UI。

如果要本地起一个静态服务器（例如避免某些 API 调用的 CORS 问题）：

```bash
# 在项目根目录
npx serve .
# 或者用任意 http server
```

然后浏览器打开 `http://localhost:3000`（端口视你的 server 而定）。

### 4. 本地联调 Functions（推荐）

如果你想在本地完整体验登录 + 云同步，建议使用 Netlify CLI：

1. 确保已经在 Netlify 上创建了站点并配置好 Identity 和 Database（见部署章节）
2. 在本地项目根目录运行：

```bash
netlify dev
```

- CLI 会启动本地开发服务器，自动代理 `/api/*` 到对应的 Functions
- 默认地址类似：`http://localhost:8888`

---

## 部署到 Netlify 教程

### 1. 准备 GitHub 仓库

- 将本项目代码推送到 GitHub
- 确保仓库根目录包含：
  - `index.html`
  - `netlify/functions/*.js`
  - `package.json`

### 2. 在 Netlify 创建站点

1. 登录 Netlify 控制台
2. 选择「Add new site」→ 「Import an existing project」
3. 选择 GitHub 仓库
4. 构建设置：
   - Build command: **留空**
   - Publish directory: `.`（项目根目录，包含 index.html）

> 因为前端是纯静态文件，不需要构建步骤。

### 3. 配置 Netlify Database（Neon）

Netlify 新版 Dashboard 下：

1. 进入站点 → **Storage / Database**（视界面版本）
2. 创建一个 Postgres 数据库（通常一键创建 Neon 实例即可）
3. 获得数据库连接 URL（一般会自动注入为 `NETLIFY_DATABASE_URL` 环境变量）
4. 确认 `NETLIFY_DATABASE_URL` 在当前站点的环境变量里存在：
   - Site settings → Environment variables → `NETLIFY_DATABASE_URL`

本项目的 Functions 使用 `@netlify/neon` 读取该变量，所以只要环境变量存在，就能连上数据库。

### 4. 启用 Netlify Identity

1. 进入站点 → 「Identity」
2. 点击「Enable Identity」
3. 根据需要设置：
   - 注册方式（开放注册 / 仅邀请）
   - 邮件发送配置（可先用默认邮件模板）
4. 前端通过 `https://identity.netlify.com/v1/netlify-identity-widget.js` 自动获取登录弹窗

> 本项目假设 Identity 已启用，且用户可以在前端直接用邮件注册 / 登录。

### 5. Functions 自动部署

- `netlify/functions/saveQuestionSet.js`
- `netlify/functions/loadQuestionSet.js`
- `netlify/functions/syncLogs.js`

只要文件放在 `netlify/functions/` 下，Netlify 会自动识别并部署为 Functions，对应路径为：

- `/.netlify/functions/saveQuestionSet` → 映射到 `/api/save-question-set`
- `/.netlify/functions/loadQuestionSet` → 映射到 `/api/load-question-set`
- `/.netlify/functions/syncLogs` → 映射到 `/api/sync-logs`

（映射由每个文件里的 `export const config = { path: "/api/xxx" }` 决定）

部署完成后，访问你的站点域名即可使用完整功能。

---

## 使用教程（面向最终用户）

### 1. 登录 / 账号

- 打开站点后，首先看到的是一个「需要登录」的遮罩
- 点击中间按钮或右上角头像 → 调出 Netlify Identity 登录框
- 完成注册/登录之后：
  - 遮罩消失
  - 系统会自动从云端拉取你账号下的题库和做题数据

> 未登录时看不到任何个人数据，也不能进行导入、练习等操作。

---

### 2. 导入题库

#### 2.1 使用 JSON 模板导入

1. 点击顶部导航栏中的「导入中心」按钮
2. 在 JSON 页签中：
   - 可以先下载模板（右下角「下载模板」）
   - 根据模板结构准备好你的题库 JSON 文件
3. 上传 JSON 文件：
   - 系统会显示：
     - 总题数
     - 科目数 / 章节数
     - 单选 / 多选 / 判断题数量
     - 科目/章节结构预览
     - 前 50 题的内容预览
4. 如有需要，逐题修改“科目 / 章节”：
   - 在预览列表中，直接修改输入框并点击「应用」
   - 右侧统计会同步更新（题数、科目数等）
5. 点击「导入」或「仅导入选择题」：
   - 系统会将 JSON 合并到现有题库
   - 自动同步到云端

#### 2.2 使用 AI 文档导入

1. 在导入中心的 AI 页签中上传 `.txt / .md / .docx / .pdf` 文件
2. 系统读取并解析文本（PDF/Word 会略慢一点）
3. 检查解析出的原始文本，确认格式正确
4. 点击「AI 识别并导入」：
   - 文本会发送给大模型以生成符合模板的题库 JSON
   - 接下来同样回到 JSON 预览导入流程（统计 + 预览 + 导入）

---

### 3. 多设备同步

- 在任意设备 A 上：
  - 登录账号 → 导入题库 / 做题 / 编辑
  - 每次操作后系统会自动同步到云端
- 在设备 B 上：
  - 登录同一账号：
    - 首次进入时会从云端加载完整题库和历史
    - 之后每隔几秒自动轮询云端更新
- 顶部左上角小圆形计数器：
  - 显示本会话内同步的次数
  - 鼠标悬停显示最近一次同步的时间和变化数量
  - 点击查看详细同步记录（云同步记录面板）

---

### 4. 题库管理 & 回收站

- 「题库管理」可以：
  - 查看所有科目和章节
  - 重命名科目 / 章节（题目内部 `sub/chap` 会自动更新）
  - 删除科目 / 章节（对应题目会随之从题库中移除）
- 回收站：
  - 查看所有被软删的题目（按科目/章节分组）
  - 支持：
    - 恢复（从回收站恢复到原科目/章节）
    - 彻底删除（不可恢复）

---

### 5. 错题本与练习视图

- 错题本：
  - 基于做题历史自动构造错题列表
  - 显示错题次数，支持按错率排序
  - 可以对单题点击「✕ 移除」，从错题本里消除对应题目  
    → 列表和顶部「错题本 (X题)」计数会同步更新
- 练习：
  - 智能练习模式：基于错题和难度选择题目
  - 自定义练习模式：按科目/章节/题型筛选题目进行练习

---

## JSON 题库模板（简要说明）

模板本身未在代码中修改，结构示例如下：

```json
{
  "Subject Example (科目示例)": {
    "Chapter 1 (章节示例)": [
      {
        "id": "demo-001",
        "type": "mcq",               // "mcq" 单选, "multi" 多选, "tf" 判断
        "q": "1 + 1 = ？",
        "o": ["1", "2", "3", "4"],   // 选项数组，判断题可以省略
        "a": "B"                     // 单选：一个字母；多选：多个字母（如 "AC"）
      }
    ]
  }
}
```

> 你只要严格遵守这个结构（科目 → 章节 → 题目数组），导入逻辑就能正常工作。

---

## 常见问题

1. **为什么登出后看不到题库？**  
   - 为了保护隐私和防止错乱，登出时会清空本地 `bank/history/trash` 缓存；
   - 下次登录时会从云端重新加载。

2. **多标签页编辑会不会互相覆盖？**  
   - 会有 storage 事件提醒：当其他标签页修改本地题库时，当前标签会弹窗提醒你是否重新加载；
   - 云端以最后一次成功同步为准。

3. **导入很多题会不会卡？**  
   - 相似题检测对每个章节只抽样最多 500 道旧题参与比较；
   - 上万题时仍可能有感知延迟，但不会长时间卡死或打乱数据。

4. **左上角计数器的数字是什么？**  
   - 是本会话内所有成功/失败同步的次数；
   - 仅用于提示频率，不代表题目总数。

---

