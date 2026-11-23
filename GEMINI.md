# Project Operating Guidelines: question-site

## 1. 核心架构与部署环境
- **双模架构驱动**: 前端原生 ES6+ Modules + 静态预编译 Tailwind CSS + PWA 离线冷启动；后端纯原生 Web API Cloudflare Workers (可运行于 Cloudflare 边缘环境或本地 Node workerd 守护进程)。
- **本地工作目录**: `C:\Users\22636\.gemini\antigravity\scratch\question-site`
- **GitHub 远端仓库**: `https://github.com/combodevy/question-site.git` (主分支: `main`)
- **官方独立生产服务器**:
  - IP: `47.111.142.133` (Ubuntu 24.04 LTS, 用户: `root`)
  - 生产主域名: `https://quiz.devy.cc.cd`
  - 管理后台: `https://quiz.devy.cc.cd/admin.html`
  - 部署路径: `/opt/question-site/app`
  - 运维与服务管理: `/opt/question-site/manage.sh` (API 守护服务: `question-site-api.service`)

---

## 2. 代码交付与线上发布工作流 (Workflow Checklist)
每次在 `question-site` 完成代码开发、优化或文档更新后，**必须同步严格执行以下四步**：

1. **本地契约与质量自检**:
   ```bash
   node scripts/check-dom-contract.mjs
   node scripts/check-i18n.mjs
   node scripts/validate-keys.mjs
   node scripts/check-deploy-target.mjs
   ```
2. **Git 提交并推送远端**:
   ```bash
   git add <modified-files>
   git commit -m "<type>(scope): <description>"
   git push origin main
   ```
3. **生产服务器 (`quiz.devy.cc.cd`) 实时同步与服务重启**:
   - 自动调用 `/opt/question-site/manage.sh backup` 创建数据与密钥快照；
   - 在服务器端拉取 GitHub 最新代码并保持 `wrangler.json` 本地密钥不受影响；
   - 若涉及后端 Worker（`worker/` 目录）或系统服务变更，执行 `/opt/question-site/manage.sh restart`；
   - 验证服务状态与健康检查（`GET /` -> 200, `GET /admin.html` -> 200, `GET /api/auth/me` -> 401 正常鉴权响应）。

---

## 3. 秒级无损回滚机制 (Rollback Guarantee)
- 每次发布前在远端和服务器自动标记前一版本的稳定 commit hash 和备份快照（如 `pre-deploy-<hash>`）；
- 若用户对任何修改提出回退要求，可在数秒内同步回滚：
  1. 本地与 GitHub 仓库回退至指定 commit 并推送；
  2. 生产服务器执行 `git reset --hard <target-commit>`；
  3. 执行 `/opt/question-site/manage.sh restart` 重启服务并恢复数据。
