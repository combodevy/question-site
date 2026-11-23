# Project Rules: question-site

## 核心配置与架构要点
- **零运行时第三方依赖**: 前端原生 ES6+ Modules + 编译期静态 Tailwind CSS；后端 Cloudflare Workers 运行时纯原生 Web API。
- **本地代码目录**: `C:\Users\22636\.gemini\antigravity\scratch\question-site`
- **GitHub 远端**: `https://github.com/combodevy/question-site.git` (分支: `main`)
- **生产服务器**:
  - 服务器: `47.111.142.133` (Ubuntu, `root`)
  - 生产域名: `https://quiz.devy.cc.cd`
  - 路径: `/opt/question-site/app`
  - 运维脚本: `/opt/question-site/manage.sh`

## 每次修改代码后的发布工作流 (Workflow Checklist)
1. **本地质量核验**:
   ```bash
   node scripts/check-dom-contract.mjs
   node scripts/check-i18n.mjs
   node scripts/validate-keys.mjs
   ```
2. **Git 提交并推送**:
   ```bash
   git add <modified-files>
   git commit -m "feat/fix: <description>"
   git push origin main
   ```
3. **线上生产环境同步 (`quiz.devy.cc.cd`)**:
   - 部署前自动记录快照点，确保可回退；
   - 同步最新代码至服务器 `/opt/question-site/app`；
   - 如修改了 Worker 代码或配置，重启 API: `/opt/question-site/manage.sh restart`；
   - 验证网站状态: `curl -sk -o /dev/null -w "%{http_code}" https://127.0.0.1/version.json`。

## 可随时回滚承诺 (Rollback Strategy)
- 每次交付均基于明确、原子性的 commit，保留部署前的状态基准；
- 用户只要表示不满意或需要撤销，立即自动执行回滚：
  1. GitHub 与本地仓库 `git revert` / `git reset`；
  2. 服务器生产代码同步检出回上一个稳定 commit 并重启服务；
  3. 确保 0 风险、随时可反悔、业务数据完整无损。
