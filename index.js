/**
 * 无限云盘 (web.wxyunpan.com) 自动签到
 * 同一份代码同时兼容 Node.js（GitHub Actions）和 Cloudflare Workers Cron
 *
 * 需要的配置（环境变量 / Workers Secret）:
 *   WXY_ACCOUNT  登录账号（手机号或邮箱）
 *   WXY_PASSWORD 登录密码
 *   PUSH_TOKEN   可选，PushPlus token，用于把结果推送到微信
 */

const BASE_URL = 'https://api.xbapi.com/v1/app';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// 后端约定：code === 200 成功；500 业务错误；60001 登录过期
const isOk = (r) => !!r && r.code === 200;

async function api(path, { method = 'GET', token, body } = {}) {
  const headers = { 'User-Agent': UA, Referer: 'https://web.wxyunpan.com/' };
  if (token) headers.thirdSession = token; // 站点用 thirdSession 头鉴权
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const resp = await fetch(BASE_URL + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${path} 返回非 JSON (HTTP ${resp.status}): ${text.slice(0, 200)}`);
  }
}

async function login(account, password) {
  const res = await api('/m/user/login', { method: 'POST', body: { account, password } });
  if (!isOk(res)) throw new Error(`登录失败: ${res.msg || JSON.stringify(res)}`);

  const token = res.data && (res.data.sessionKey || res.data.token);
  if (!token) throw new Error(`登录成功但未拿到 sessionKey: ${JSON.stringify(res)}`);
  return token;
}

const getSignInfo = (token) => api('/m/sign/info', { token });
const doSign = (token) => api('/m/sign/add', { method: 'POST', token, body: {} });

async function pushNotify(pushToken, title, content) {
  if (!pushToken) return;
  try {
    await fetch('https://www.pushplus.plus/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pushToken, title, content, template: 'txt' }),
    });
  } catch (e) {
    console.log('推送失败(不影响签到):', e.message);
  }
}

const mask = (a) => (a.length <= 5 ? a[0] + '***' : `${a.slice(0, 3)}****${a.slice(-2)}`);

const stat = (d) =>
  d ? `连续 ${d.connectNum || 0} 天 / 累计积分 ${d.totalPoints || 0}` : '无数据';

/** 执行一次完整签到流程，cfg 可直接传 process.env 或 Workers 的 env */
export async function run(cfg) {
  const account = cfg.WXY_ACCOUNT;
  const password = cfg.WXY_PASSWORD;
  if (!account || !password) {
    throw new Error('缺少配置: WXY_ACCOUNT / WXY_PASSWORD');
  }

  const lines = [];
  const log = (s) => {
    console.log(s);
    lines.push(s);
  };

  log(`账号 ${mask(account)} 开始签到`);

  const token = await login(account, password);
  log('登录成功');

  const before = await getSignInfo(token);
  log(`签到前: ${stat(isOk(before) ? before.data : null)}`);

  const signRes = await doSign(token);
  let ok = isOk(signRes);
  if (ok) {
    const points = (signRes.data && signRes.data.points) || 1;
    log(`签到成功，获得 ${points} 积分`);
  } else if (signRes && /已签到|重复/.test(signRes.msg || '')) {
    ok = true; // 今日已签到，视为正常结果
    log(`今日已签到: ${signRes.msg}`);
  } else {
    log(`签到未成功: ${(signRes && signRes.msg) || JSON.stringify(signRes)}`);
  }

  const after = await getSignInfo(token);
  log(`签到后: ${stat(isOk(after) ? after.data : null)}`);

  const summary = lines.join('\n');
  await pushNotify(cfg.PUSH_TOKEN, ok ? '无限云盘签到成功' : '无限云盘签到失败', summary);

  return { ok, summary };
}

// ---------- Cloudflare Workers 入口 ----------
export default {
  // Cron 定时触发
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env).catch((e) => console.error('签到异常:', e.message)));
  },
  // 浏览器访问 Worker 域名可手动触发一次，便于调试
  async fetch(request, env) {
    try {
      const r = await run(env);
      return new Response(r.summary, {
        status: r.ok ? 200 : 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    } catch (e) {
      return new Response('签到异常: ' + e.message, {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  },
};

// ---------- Node.js 入口（GitHub Actions / 本地）----------
// Workers 环境没有 process.release，因此这段只在 Node 下执行
if (typeof process !== 'undefined' && process.release && process.release.name === 'node') {
  run(process.env)
    .then((r) => {
      if (!r.ok) process.exit(1);
    })
    .catch((e) => {
      console.error('签到异常:', e.message);
      process.exit(1);
    });
}