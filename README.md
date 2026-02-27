# Question Site - Flexible Edition (LMS Genesis)

## 📖 项目概述 (Project Overview)

这是一个**现代化、无服务器架构 (Serverless) 的在线题库与刷题平台**。它专为个人学习者和小型团队设计，提供灵活的题库管理、智能刷题练习、错题分析以及多端实时同步功能。

项目采用 **前后端分离 (Decoupled)** 架构，前端为纯静态单页应用 (SPA)，后端基于 Vercel Serverless Functions，数据库使用 Supabase (PostgreSQL)，并集成 Ably 实现实时通信。

---

## 🏗️ 系统架构 (Architecture)

```mermaid
graph TD
    User[用户 (Browser/Mobile)] -->|HTTPS| Frontend[前端 (GitHub Pages)]
    Frontend -->|REST API| Backend[后端 API (Vercel Functions)]
    Frontend -->|WebSocket| Ably[Ably Realtime (实时同步)]
    Backend -->|SQL| DB[(Supabase PostgreSQL)]
    Backend -->|Verify Token| Auth[Supabase Auth (身份验证)]
    Frontend -->|Store| Local[LocalStorage (本地缓存)]
```

### 核心技术栈 (Tech Stack)

*   **前端 (Frontend)**:
    *   **HTML5 / Vanilla JS (ES6+)**: 无构建工具，直接运行，轻量高效。
    *   **Tailwind CSS (CDN)**: 原子化 CSS 框架，快速构建响应式 UI。
    *   **Alpine.js (Implicit)**: 借鉴其思想的原生响应式实现。
    *   **Ably Realtime**: 实现多设备数据实时同步推送。
*   **后端 (Backend)**:
    *   **Vercel Serverless Functions**: Node.js 运行时，提供 RESTful API。
    *   **pg (node-postgres)**: 连接 PostgreSQL 数据库。
    *   **jose / jsonwebtoken**: 处理 JWT 身份验证与 JWKS 校验。
*   **数据库 & 鉴权 (DB & Auth)**:
    *   **Supabase Auth**: 管理用户注册、登录及 Token 分发。
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
    *   **实时推送**: 一端更新，多端自动收到通知并拉取最新数据。
    *   **离线支持**: 优先读写本地 LocalStorage，网络恢复后自动同步。

4.  **AI 辅助学习 (AI Integration)**
    *   集成 DeepSeek / OpenAI / Gemini 等大模型。
    *   **AI 题目解析**: 自动分析错题原因。
    *   **AI 文档导入**: 自动识别非结构化文档中的题目并转为 JSON。

---

## 📂 项目结构 (Project Structure)

### 前端 (Root Directory)
| 文件名 | 描述 (Description) |
| :--- | :--- |
| `index.html` | **项目主入口**。包含所有 UI 结构、业务逻辑 (App 对象)、路由和样式。 |
| `config.js` | **配置文件**。定义后端 API 地址、Supabase URL 和 Key。 |
| `README.md` | 项目说明文档。 |

### 后端 API (`/api`)
| 文件名 | 描述 (Description) |
| :--- | :--- |
| `save-question-set.js` | **核心保存接口**。处理题库数据的事务性保存、版本检查和去重。 |
| `load-question-set.js` | **核心加载接口**。获取最新题库，包含自动数据清洗逻辑。 |
| `ably-auth.js` | **实时鉴权接口**。生成 Ably Token Request，保障 WebSocket 连接安全。 |
| `sync-logs.js` | **日志查询接口**。提供同步历史记录，用于前端诊断面板。 |
| `_auth.js` | **鉴权中间件**。验证 Supabase JWT Token (支持 Secret 和 JWKS)。 |
| `_db.js` | **数据库工具**。管理 PostgreSQL 连接池 (Connection Pool)。 |
| `_cors.js` | **跨域工具**。统一处理 CORS 响应头和 Preflight 请求。 |

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
    *   `ABLY_API_KEY`: Ably Realtime 的 API Key。
    *   `CORS_ORIGIN`: 允许的前端域名 (如 `https://your-github-page.io`)。

### 3. 前端部署 (GitHub Pages)
1.  修改 `config.js` 中的 `API_BASE` 为 Vercel 分配的后端域名。
2.  开启 GitHub Pages 服务，指向根目录。

---

## ⚠️ 开发者注意事项 (Developer Notes)

*   **不要直接修改 `index.html` 中的逻辑**，除非你完全理解 `saveToCloud` 的并发锁机制。
*   **数据库连接**：后端使用了 `pg` 连接池，请确保 Vercel 函数并未长时间占用连接，推荐使用 Supabase 的 PgBouncer (Transaction Mode)。
*   **版本控制**：前端与后端的版本号 (`version`) 必须严格匹配，否则会触发 `409 Conflict` 错误。

---

*Generated by Senior Engineer Assistant | 2026*
