#!/usr/bin/env bash
# ============================================================================
# question-site-mirror 独立部署脚本
#
# 用途：把本项目部署成一套【完全独立】的环境 —— 自己的 Worker、自己的 D1 数据库、
#       自己的 Pages 站点。与原始的 question-site 环境互不影响。
#
# 前置条件：
#   1. 已登录 Cloudflare：npx wrangler login（或已有有效凭据）
#   2. 网络能访问 api.cloudflare.com（wrangler 的所有操作都依赖它）
#
# 用法：
#   bash deploy-mirror.sh
#
# 脚本会改动 3 个文件（这是独立部署的必然结果）：
#   worker/wrangler.json  → Worker 名 + D1 绑定
#   config.js             → 前端指向的新 API 地址
#   package.json          → Pages 部署脚本里的项目名
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")"

# wrangler 调用方式。默认用 npx；
# 若你的网络需要绕行（例如 api.cloudflare.com 被解析到不可达的网段），
# 可以配合本地改道代理使用：
#   HTTPS_PROXY=http://127.0.0.1:18080 HTTP_PROXY=http://127.0.0.1:18080 \
#   WRANGLER="node /path/to/node_modules/wrangler/bin/wrangler.js" bash deploy-mirror.sh
WRANGLER="${WRANGLER:-npx wrangler}"

WORKER_NAME="question-site-mirror2-api"
D1_NAME="question-site-mirror2-db"
PAGES_PROJECT="question-site-mirror2"

step() { echo ""; echo "── $* ────────────────────────────────────────"; }

step "0. 检查能否访问 Cloudflare API"
# 注意：不要用 -o /dev/null —— 在 Git Bash + 代理组合下会误报 curl(23) 写入错误
if ! curl -sS --max-time 15 -o /tmp/cf-reach.json -w '%{http_code}' \
      https://api.cloudflare.com/client/v4/user >/tmp/cf-reach.code 2>/tmp/cf-reach.err; then
  echo "✗ 无法访问 api.cloudflare.com。"
  echo "  wrangler 的所有操作都需要它。请先解决网络问题（换网络/代理）后重跑本脚本。"
  echo "  错误信息：$(cat /tmp/cf-reach.err 2>/dev/null | head -2)"
  exit 1
fi
CODE=$(cat /tmp/cf-reach.code 2>/dev/null)
if [ "$CODE" = "000" ] || [ -z "$CODE" ]; then
  echo "✗ api.cloudflare.com 无响应（HTTP 000）。请检查网络后重跑。"
  exit 1
fi
echo "✓ api.cloudflare.com 可达（HTTP $CODE）"

step "1. 创建独立的 D1 数据库"
$WRANGLER d1 create "$D1_NAME" 2>&1 | tee /tmp/d1-create.log

DB_ID=$(grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' /tmp/d1-create.log | head -1)
if [ -z "$DB_ID" ]; then
  echo "✗ 没能从输出里解析出 database_id，请手动把 ID 填进 worker/wrangler.json 后重跑。"
  exit 1
fi
echo "✓ database_id = $DB_ID"

step "2. 改写 worker/wrangler.json（Worker 名 + D1 绑定）"
node -e "
const fs=require('fs');
const p='worker/wrangler.json';
const j=JSON.parse(fs.readFileSync(p,'utf8'));
j.name='$WORKER_NAME';
j.d1_databases[0].database_name='$D1_NAME';
j.d1_databases[0].database_id='$DB_ID';
fs.writeFileSync(p, JSON.stringify(j,null,2)+'\n');
console.log('已更新 '+p);
"

step "3. 对新的 D1 执行建表迁移"
(cd worker && $WRANGLER d1 migrations apply "$D1_NAME" --remote)

step "4. 设置新的 JWT 签名密钥"
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
(cd worker && printf '%s' "$JWT_SECRET" | $WRANGLER secret put JWT_SECRET)
echo "✓ 已写入 JWT_SECRET（48 字节随机值，未落盘到仓库）"

step "5. 部署新的 Worker"
(cd worker && $WRANGLER deploy)

step "6. 改写 config.js 指向新的 Worker"
API_BASE="https://${WORKER_NAME}.combodevy-9b0.workers.dev"
node -e "
const fs=require('fs');
const p='config.js';
let s=fs.readFileSync(p,'utf8');
s=s.replace(/window\.API_BASE\s*=\s*\"[^\"]*\"/, 'window.API_BASE = \"$API_BASE\"');
fs.writeFileSync(p,s);
console.log('已更新 '+p+' → '+'$API_BASE');
"

step "7. 改写 package.json 里的 Pages 项目名"
node -e "
const fs=require('fs');
const p='package.json';
const j=JSON.parse(fs.readFileSync(p,'utf8'));
j.scripts['deploy:pages']=j.scripts['deploy:pages'].replace(/--project-name \S+/, '--project-name $PAGES_PROJECT');
fs.writeFileSync(p, JSON.stringify(j,null,2)+'\n');
console.log('已更新 '+p);
"

step "8. 创建并部署新的 Pages 站点"
$WRANGLER pages project create "$PAGES_PROJECT" --production-branch main 2>&1 | tail -3 || true
node scripts/stage-pages.mjs
$WRANGLER pages deploy .pages-dist --project-name "$PAGES_PROJECT" --commit-dirty

echo ""
echo "════════════════════════════════════════════════════════════════"
echo " 部署完成"
echo "   前端： https://${PAGES_PROJECT}.pages.dev"
echo "   后端： https://${WORKER_NAME}.combodevy-9b0.workers.dev"
echo "   数据库：$D1_NAME ($DB_ID)"
echo ""
echo " ⚠️ 新数据库是空的。请立刻打开上面的前端地址注册管理员用户名"
echo "    （默认是 admin，对应 worker/wrangler.json 里的 ADMIN_USERNAMES），"
echo "    否则可能被他人抢注。"
echo "════════════════════════════════════════════════════════════════"
