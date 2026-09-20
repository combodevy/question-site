# LMS Genesis · 在线刷题小站

导入自己的题库，随时随地刷题、复盘错题，多设备数据自动同步。整站跑在 Cloudflare 免费套餐上，数据都在自己账号里。

**在线地址**：<https://question-site-front.pages.dev>

## 能做什么

- **题库管理**：JSON 文件一键导入，导入前先预览，确认无误再入库；科目和章节随意划分，删掉的题先进回收站，随时能找回。
- **多种刷法**：顺序练习、随机抽题、错题突击，题目数量和范围自己定。单选、多选、判断题都支持。
- **错题本**：做错的题自动收进错题本，按错误次数排好序，方便集中攻克。
- **学习统计**：正确率、连续学习天数、答题时长分布、30 天学习热力图，刷题情况一目了然。
- **多设备同步**：手机上刷的题，电脑上打开接着刷。断网也能照常用，联网后自动同步。

## 怎么用

1. 注册一个账号，用户名加密码就行，不需要邮箱。
2. 点右上角的导入按钮，选择 JSON 题库文件，预览确认后导入（格式模板可以直接下载）。
3. 回到首页，选一种练习方式开始刷题。

## 部署一份自己的

整站只依赖 Cloudflare 免费套餐，自己搭一份只要几分钟。

准备工作：装好 Node.js，运行 `npx wrangler login` 登录你的 Cloudflare 账号。

**第一步，建数据库、部署后端：**

```bash
cd worker
npx wrangler d1 create question-site-db   # 把输出的 database_id 填进 worker/wrangler.json
npx wrangler d1 migrations apply question-site-db --remote
npx wrangler secret put JWT_SECRET        # 随便设一串足够长的随机字符
npm run deploy:worker
```

**第二步，部署前端：**

把部署后端时得到的域名填进根目录的 `config.js`，然后：

```bash
npm run deploy:pages
```

**第三步，注册管理员：**

打开 `admin.html`，用 `admin` 这个用户名注册（部署后尽快注册，防止被别人占用）。管理后台可以查看用户、修改任何人的题库、给指定用户或所有人推送新题库。

## 本地开发

```bash
cd worker
npx wrangler d1 migrations apply question-site-db --local
npx wrangler dev --port 8787
```

另开一个终端：

```bash
node scripts/stage-pages.mjs
npx wrangler pages dev .pages-dist --port 8788
```

把 `config.js` 里的接口地址临时改成 `http://localhost:8787` 即可联调（别把这个改动提交上去）。
