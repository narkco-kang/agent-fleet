/**
 * 蜂群间上下文断裂测试（真实后端 + WS 模拟设备）
 *
 * 前置：AgentFleet backend 已启动（本机 :4173）。
 * 运行：node tests/memory-fracture.test.mjs
 *
 * 覆盖：
 *   F-1 全新设备接入：上报链头(0) → 收到 block_response 补齐现有全部区块
 *   F-2 设备离线期间后端继续出块（记忆不因设备掉线而中断）
 *   F-3 设备重新上线：上报旧链头 → 补同步离线期间缺失块，tip 收敛
 *   F-4 补同步块 index 连续、无重复、无遗漏（记忆完整）
 *   F-5 出块广播：在线设备实时收到 memory.block_broadcast
 */
import WebSocket from 'ws';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4173';
const WS_URL = process.env.WS_URL ?? 'ws://127.0.0.1:4173/ws';

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, msg = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; failures.push({ name, msg }); console.error(`  ❌ ${name}: ${msg}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeClient() {
  const ws = new WebSocket(`${WS_URL}?type=device`);
  const queue = [];
  const waiters = [];
  ws.on('message', (d) => {
    let env;
    try { env = JSON.parse(d.toString('utf-8')); } catch { return; }
    queue.push(env);
    for (const w of [...waiters]) {
      if (w.pred(env)) { clearTimeout(w.timer); waiters.splice(waiters.indexOf(w), 1); w.resolve(env); }
    }
  });
  const open = () => new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  const waitFor = (pred, timeout = 8000, label = 'msg') => new Promise((res, rej) => {
    const f = queue.find(pred); if (f) return res(f);
    const w = { pred, resolve: res };
    w.timer = setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); rej(new Error(`timeout waiting ${label}`)); }, timeout);
    waiters.push(w);
  });
  return { ws, open, waitFor, send: (e) => ws.send(JSON.stringify(e)), close: () => ws.close(), queue };
}

const env = (type, payload, from, to) => ({ v: 1, type, id: `m-${Math.random().toString(36).slice(2)}`, ts: Date.now(), from, to, payload });
const regPayload = (deviceId) => ({ deviceId, name: deviceId, hostname: 'h', os: { platform: 'linux', arch: 'x64', release: 'r' }, version: '0.1.0', token: 't' });
const chainSummary = (tip_index, tip_hash, from) => env('memory.chain_summary', { summary: { tip_index, tip_hash, group: 'team' } }, from, 'coordinator');

async function api(path, opts = {}) {
  const headers = {};
  if (opts.body != null) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { headers, ...opts });
  return res.json();
}
async function record(note) {
  return api('/api/memory/record', { method: 'POST', body: JSON.stringify({ note, status: 'completed' }) });
}

/** 收集 block_response 里的 blocks index 集合 */
function blockIndexes(envs) {
  const idx = [];
  for (const e of envs) {
    if (e.type === 'memory.block_response') {
      for (const b of (e.payload?.blocks ?? [])) idx.push(b.index);
    }
    if (e.type === 'memory.block_broadcast') {
      idx.push(e.payload?.block?.index);
    }
  }
  return idx.sort((a, b) => a - b);
}

async function main() {
  console.log('== 蜂群间上下文断裂测试（真实后端 + WS 模拟设备）==\n');

  // ── F-1 全新设备接入：上报链头(0) → 补齐现有全部区块 ──
  const c1 = makeClient();
  await c1.open();
  c1.send(env('device.register', regPayload('sim-fracture-1'), 'sim-fracture-1', 'coordinator'));
  await c1.waitFor((e) => e.type === 'device.register_ack', 8000, 'register_ack');

  const before = await api('/api/memory/summary');
  const tipBefore = before.tipIndex;
  c1.send(chainSummary(0, 'genesis-hash-placeholder', 'sim-fracture-1'));
  const resp1 = await c1.waitFor((e) => e.type === 'memory.block_response', 8000, 'block_response (初始补齐)');
  const got1 = (resp1.payload?.blocks ?? []).map((b) => b.index).sort((a, b) => a - b);
  check(`F-1 全新设备接入补齐现有块（tip=${tipBefore}），收到块 [${got1.join(',')}]`, got1.length === tipBefore && got1[got1.length - 1] === tipBefore, JSON.stringify(got1));

  // ── F-2/F-3 设备离线 → 后端继续出块 → 重连补同步 ──
  // 模拟离线：关闭连接
  c1.close();
  await sleep(300);

  // 后端在设备离线期间出 3 块
  const offlineNotes = ['离线期间块A-部署成功', '离线期间块B-任务完成', '离线期间块C-路由切换'];
  for (const note of offlineNotes) {
    await record(note);
  }
  const mid = await api('/api/memory/summary');
  const tipMid = mid.tipIndex;
  check(`F-2 设备离线期间后端继续出 3 块（tip ${tipBefore}→${tipMid}）`, tipMid === tipBefore + 3, `tip=${tipMid}`);

  // 重新上线：新连接 + 注册 + 上报旧链头(tipBefore)
  const c2 = makeClient();
  await c2.open();
  c2.send(env('device.register', regPayload('sim-fracture-1'), 'sim-fracture-1', 'coordinator'));
  await c2.waitFor((e) => e.type === 'device.register_ack', 8000, 'register_ack (重连)');

  c2.send(chainSummary(tipBefore, 'stale-hash', 'sim-fracture-1'));
  const resp2 = await c2.waitFor((e) => e.type === 'memory.block_response', 8000, 'block_response (补同步)');
  const got2 = (resp2.payload?.blocks ?? []).map((b) => b.index).sort((a, b) => a - b);
  check(`F-3 设备重连补同步 3 块 [${got2.join(',')}]`, got2.length === 3 && got2[0] === tipBefore + 1 && got2[2] === tipMid, JSON.stringify(got2));

  // ── F-4 补同步块连续无遗漏 ──
  const all = blockIndexes([resp1, resp2]);
  const unique = [...new Set(all)];
  const continuous = unique.every((v, i) => i === 0 || v === unique[i - 1] + 1);
  check(`F-4 补同步块 index 连续无重复（收到 ${unique.length} 个唯一块）`, continuous && unique.length === tipMid, JSON.stringify(unique));

  // ── F-5 出块广播：在线设备实时收到 block_broadcast ──
  c2.send(chainSummary(tipMid, 'synced-hash', 'sim-fracture-1')); // 先对齐
  await sleep(200);
  await record('F-5 广播验证块');
  let broadcastGot = null;
  try {
    broadcastGot = await c2.waitFor((e) => e.type === 'memory.block_broadcast', 5000, 'block_broadcast');
  } catch { /* 未收到 */ }
  check('F-5 在线设备实时收到 memory.block_broadcast', !!broadcastGot && broadcastGot.payload?.block?.index === tipMid + 1, JSON.stringify(broadcastGot?.payload?.block?.index));

  c2.close();

  console.log(`\n== 结果: ${passed} 通过, ${failed} 失败 ==`);
  if (failed) {
    console.error('失败项:', failures);
    process.exit(1);
  }
  process.exit(0);
}

const safety = setTimeout(() => { console.error('\n[安全超时] 测试超 60s 强制退出'); process.exit(3); }, 60_000);
safety.unref();

main().catch((e) => { console.error('脚本异常:', e); process.exit(2); });
