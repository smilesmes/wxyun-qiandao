# 无限云盘 (web.wxyunpan.com) 自动签到

每天自动完成「个人中心 → 每日签到 → 立即签到」，领取积分。

## 原理

站点前端调用的接口（Base URL `https://api.xbapi.com/v1/app`）：

| 接口 | 方法 | 说明 |
|---|---|---|
| `/m/user/login` | POST | body `{account, password}`，成功返回 `data.sessionKey` |
| `/m/sign/info` | GET | 查询签到状态（连续天数、累计积分） |
| `/m/sign/add` | POST | 执行签到 |

鉴权方式：请求头 `thirdSession: <sessionKey>`。
返回体约定：`code === 200` 成功，`500` 业务错误，`60001` 登录过期。

所以脚本流程就是：登录拿 sessionKey → 查状态 → 调签到 → 再查状态 → 可选推送。

## 方式一：GitHub Actions（推荐，免费且零维护）

1. 在 GitHub 新建一个仓库，建议设为 **Private**（虽然密码放在 Secrets 里，但私有更稳妥）。
2. 把本目录 4 个文件上传到仓库根目录，保持结构：

```
index.js
package.json
wrangler.toml            (只用 Actions 的话可以不要)
.github/workflows/signin.yml
```

3. 仓库页面 → **Settings** → 左侧 **Secrets and variables** → **Actions** → **New repository secret**，添加：

| Name | Value |
|---|---|
| `WXY_ACCOUNT` | 你的登录账号（手机号或邮箱） |
| `WXY_PASSWORD` | 你的登录密码 |
| `PUSH_TOKEN` | 可选，PushPlus token（不需要通知就别加） |

4. 仓库页面 → **Actions** 标签 → 如提示则点 **I understand my workflows, enable them**。
5. 左侧选「无限云盘每日签到」→ 右上 **Run workflow** 手动跑一次，验证是否成功。
6. 之后每天北京时间 08:10 左右自动执行。

查看结果：Actions → 点某次运行 → 点 `signin` job → 展开「执行签到」，日志形如：

```
账号 138****88 开始签到
登录成功
签到前: 连续 0 天 / 累计积分 4
签到成功，获得 1 积分
签到后: 连续 1 天 / 累计积分 5
```

## 方式二：Cloudflare Workers Cron

1. 本地装好 Node，然后 `npm i -g wrangler`
2. `wrangler login`（浏览器授权）
3. 在项目目录设置密钥：

```bash
wrangler secret put WXY_ACCOUNT
wrangler secret put WXY_PASSWORD
wrangler secret put PUSH_TOKEN   # 可选
```

4. 部署：`wrangler deploy`
5. Cron 已在 `wrangler.toml` 里配好（UTC 00:10 = 北京 08:10）。
6. 想手动测一次，直接浏览器打开分配给你的 `*.workers.dev` 域名，会立即执行并返回日志文本。

注意：Worker 的 `fetch` 入口是公开可访问的，任何知道域名的人都能触发一次签到（只会重复签到，不会泄露账号密码）。若不希望被随意触发，部署后可以删掉 `index.js` 里的 `fetch` 方法，只留 `scheduled`。

## 本地手动跑一次

```bash
export WXY_ACCOUNT="你的账号"
export WXY_PASSWORD="你的密码"
node index.js
```

Node 需 18 及以上（要有内置 `fetch`）。

## 修改执行时间

cron 用的是 **UTC 时间**，北京时间减 8 小时。

- 北京 08:10 → `10 0 * * *`
- 北京 09:30 → `30 1 * * *`
- 北京 12:00 → `0 4 * * *`

GitHub Actions 改 `.github/workflows/signin.yml`，Workers 改 `wrangler.toml`。

## 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| `登录失败: 用户不存在` | 账号填错，或该站需要用手机号而非昵称 |
| `登录失败: 密码错误` | 改了密码，更新 Secret |
| `签到未成功: 今日已签到` | 正常，脚本会当成成功 |
| `登录过期，请重新登录` (60001) | sessionKey 失效，脚本每次都会重新登录，一般不会遇到 |
| 到点没跑 | GitHub cron 有延迟；连续无提交的仓库超过 60 天会被暂停 workflow，随便提交一次即可恢复 |
| 返回非 JSON | 接口被改动或被风控挡了，需要重新抓一下前端接口 |

## 免责

仅用于本人账号的日常签到，请勿高频调用或滥用。