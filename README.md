# Question Site - Flexible Edition (LMS Genesis)

## 📖 项目概述 (Project Overview)

这是一个**现代化、无服务器架构 (Serverless) 的在线题库与刷题平台**。它专为个人学习者和小型团队设计，提供灵活的题库管理、智能刷题练习、错题分析以及多端实时同步功能。

项目采用 **前后端分离 (Decoupled)** 架构，前端为纯静态单页应用 (SPA)，后端基于 Vercel Serverless Functions + Supabase (PostgreSQL)，并通过 **Cloudflare Workers WebSocket 网关** 实现多设备实时同步（可选集成 Ably 作为备用通道）。

---

## 🏗️ 系统架构 (Architecture)

```mermaid
graph TD
    User[User (Browser/Mobile)] -->|HTTPS| Frontend[Frontend (GitHub Pages)]
    Frontend -->|REST API| Backend[Backend (Vercel Functions)]
    Frontend -->|WebSocket| Realtime[Realtime Gateway (Cloudflare Workers)]
    Realtime -->|Event: set-updated| Frontend
    Backend -->|SQL| DB[Supabase PostgreSQL]
    Backend -->|Verify Token| Auth[Supabase Auth]
    Frontend -->|Store| Local[LocalStorage]
```

### 核心技术栈 (Tech Stack)

*   **前端 (Frontend)**:
    *   **HTML5 / Vanilla JS (ES6+)**: 无构建工具，直接运行，轻量高效。
    *   **Tailwind CSS (CDN)**: 原子化 CSS 框架，快速构建响应式 UI。
    *   **Alpine.js (Implicit)**: 借鉴其思想的原生响应式实现。
    *   **WebSocket Realtime**: 通过 Cloudflare Workers 网关实现多设备实时同步；在未配置网关时可回退到 Ably。
*   **后端 (Backend)**:
    *   **Vercel Serverless Functions**: Node.js 运行时，提供 RESTful API（保存 / 加载题库、Admin 接口等）。
    *   **Cloudflare Workers + Durable Objects**: 作为自建 Realtime Gateway，按 userId 维护 WebSocket 连接并广播更新事件。
    *   **pg (node-postgres)**: 连接 PostgreSQL 数据库。
    *   **jose / jsonwebtoken**: 处理 JWT 身份验证与 JWKS 校验。
*   **数据库 & 鉴权 (DB & Auth)**:
    *   **Supabase Auth**: 管理用户注册、登录及 Token 分发（支持“用户名 + 密码”登录，内部映射为虚拟邮箱）。
    *   **Supabase PostgreSQL**: 存储题库数据、版本号及同步日志。

---

## ✨ 核心功能 (Key Features)

1.  **智能题库管理 (Question Bank Management)**
    *   支持无限层级的 **科目 (Subject) -> 章节 (Chapter)** 结构。
    *   支持 **单选 (MCQ)**、**多选 (Multi)**、**判断 (True/False)** 三种题型。
    *   支持 JSON 文件导入/导出，以及 AI 辅助文档导入 (Word/PDF/Txt)。

2.  **多模式刷题 (Practice Modes)**
    *   **顺序练习**: 按章节顺序刷题。
    *   **随机练习**: 全库或指定科目随机抽取。
    *   **智能推荐**: 基于艾宾浩斯遗忘曲线或错题频率推荐题目。
    *   **模拟考试**: 限时模拟，自动评分。

3.  **云端同步与冲突解决 (Cloud Sync & Conflict Resolution)**
    *   **增量同步**: 仅传输变更数据，节省流量。
    *   **乐观锁 (Optimistic Locking)**: 基于版本号 (Version) 防止多设备并发覆盖。
    *   **实时推送**: 一端更新，多端自动收到通知并拉取最新数据（Cloudflare Workers 网关广播 `set-updated` 事件，前端自动触发 `load-from-cloud`）。
    *   **离线支持**: 优先读写本地 LocalStorage，网络恢复后自动同步。

4.  **AI 辅助学习 (AI Integration)**
    *   集成 DeepSeek / OpenAI / Gemini 等大模型。
    *   **AI 题目解析**: 自动分析错题原因。
    *   **AI 文档导入**: 自动识别非结构化文档中的题目并转为 JSON。

5.  **高级管理面板 (Admin Panel)**
    *   **用户管理**: 查看所有用户，支持多选、批量删除和一键添加用户。
    *   **题库透视**: 可视化查看和编辑任意用户的题库内容，支持实时修改题干和选项。
    *   **全局广播 (Broadcast)**: 批量向指定用户或全员推送题库，支持从 Word/PDF/TXT 智能导入题目。
    *   **系统日志**: 实时监控系统同步状态、IP 来源和异常信息。

---

### 👤 用户注册与登录 (Auth Behavior)

*   前端登录 / 注册界面只要求输入「用户名 + 密码」，不会提示或发送任何邮件。
*   系统内部会将用户名映射为虚拟邮箱（例如 `alice` → `alice@user.local`），以利用 Supabase 的 email 唯一约束。
*   同一个用户名只能注册一次；重复注册会返回“用户名已被注册”的提示。
*   管理后台 (`admin.html`) 也使用同一套 Supabase Auth 机制，支持管理员账号的用户名登录。

---

## 📂 项目结构 (Project Structure)

### 前端 (Root Directory)
| 文件名 | 描述 (Description) |
| :--- | :--- |
| `index.html` | **用户主应用**。包含刷题、题库管理、AI 助手等核心功能。 |
| `admin.html` | **管理后台**。提供用户管理、全局推送、日志监控和可视化编辑器。 |
| `config.js` | **配置文件**。定义后端 API 地址、Supabase URL 和 Key。 |
| `README.md` | 项目说明文档。 |

### 后端 API (`/api`)
| 文件名 | 描述 (Description) |
| :--- | :--- |
| `save-question-set.js` | **核心保存接口**。处理题库数据的事务性保存、版本检查和去重。 |
| `load-question-set.js` | **核心加载接口**。获取最新题库，包含自动数据清洗逻辑。 |
| `ably-auth.js` | **Ably 鉴权接口 (可选)**。生成 Ably Token Request，在未启用自建网关时为前端提供实时通道。 |
| `sync-logs.js` | **日志查询接口**。提供同步历史记录，用于前端诊断面板。 |
| `_auth.js` | **鉴权中间件**。验证 Supabase JWT Token (支持 Secret 和 JWKS)。 |
| `_db.js` | **数据库工具**。管理 PostgreSQL 连接池 (Connection Pool)。 |
| `_cors.js` | **跨域工具**。统一处理 CORS 响应头和 Preflight 请求。 |
| **Admin API** | 位于 `/api/admin/` 下，包含 `users-list`, `push-broadcast`, `system-logs` 等管理接口。 |

---

## 🚀 部署指南 (Deployment)

### 1. 数据库设置 (Supabase)
在 Supabase SQL Editor 中执行以下建表语句（后端 API 会自动尝试创建，但建议手动初始化）：

```sql
-- 题库主表
create table question_sets (
    id serial primary key,
    user_id text not null,
    name text not null,
    created_at timestamptz default now(),
    version integer not null default 0,
    state jsonb
);

-- 题目详情表
create table questions (
    id serial primary key,
    question_set_id integer not null references question_sets(id) on delete cascade,
    content jsonb not null
);

-- 同步日志表
create table sync_logs (
    id serial primary key,
    user_id text not null,
    delta jsonb,
    status text not null,
    error text,
    created_at timestamptz default now()
);
```

### 2. 后端部署 (Vercel)
1.  将项目导入 Vercel。
2.  配置 **Environment Variables**:
    *   `SUPABASE_URL`: Supabase 项目地址。
    *   `SUPABASE_ANON_KEY`: Supabase 公钥。
    *   `SUPABASE_DB_URL`: PostgreSQL 连接字符串 (建议使用 Transaction Pooler, Port 6543)。
    *   `SUPABASE_JWT_SECRET`: (可选) 用于快速本地验证 JWT。
    *   `ABLY_API_KEY`: (可选) Ably Realtime 的 API Key，用于在未配置 WebSocket 网关时提供备用实时通道。
    *   `REALTIME_NOTIFY_URL`: (可选) Cloudflare Workers 网关的 `/notify` 地址，用于后端在保存 / 管理员更新题库后主动推送事件。
    *   `REALTIME_NOTIFY_SECRET`: (可选) 与网关约定的鉴权密钥；若网关未开启鉴权，可留空。
    *   `CORS_ORIGIN`: 允许的前端域名 (如 `https://your-github-page.io`)。

### 3. 前端部署 (GitHub Pages)
1.  修改 `config.js` 中的 `API_BASE` 为 Vercel 分配的后端域名，并根据需要设置 `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `REALTIME_WS_URL`。
2.  开启 GitHub Pages 服务，指向根目录。

### 4. 实时网关部署 (可选，Cloudflare Workers)

1. 在 Cloudflare 中创建一个 Workers 项目（推荐模板：`Worker + Durable Objects`），主入口为 `src/index.js`。
2. 在 `wrangler.jsonc` 中配置：
    * `durable_objects.bindings = [{ "name": "USER_ROOM", "class_name": "UserRoom" }]`
    * `migrations = [{ "tag": "v1", "new_sqlite_classes": ["UserRoom"] }]`
3. 运行 `wrangler deploy` 部署后，记下分配的域名，例如:  
   `https://qs-realtime-v2.xxx.workers.dev`
4. 在前端 `config.js` 中配置：
    * `window.REALTIME_WS_URL = "wss://qs-realtime-v2.xxx.workers.dev/realtime"`
5. 在 Vercel 环境变量中配置：
    * `REALTIME_NOTIFY_URL = "https://qs-realtime-v2.xxx.workers.dev/notify"`
    * 如需鉴权，可在 Worker 中开启 Authorization 校验，并在 Vercel 同步 `REALTIME_NOTIFY_SECRET`。

---

## ⚠️ 开发者注意事项 (Developer Notes)

*   **不要直接修改 `index.html` 中的逻辑**，除非你完全理解 `saveToCloud` 的并发锁机制。
*   **数据库连接**：后端使用了 `pg` 连接池，请确保 Vercel 函数并未长时间占用连接，推荐使用 Supabase 的 PgBouncer (Transaction Mode)。
*   **版本控制**：前端与后端的版本号 (`version`) 必须严格匹配，否则会触发 `409 Conflict` 错误。

---

*Generated by Senior Engineer Assistant | 2026*
