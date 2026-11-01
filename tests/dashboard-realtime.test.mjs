/**
 * 看板实时性回归测试（Gap #2）：dashboard.snapshot + 设备 dashboard.patch
 * 前置：后端已启动（AGENTMESH_SKIP_AUTH=1 + 独立 DB）。
 * 运行：node tests/dashboard-realtime.test.mjs
 */
import WebSocket from 'ws';

const WS_URL = process.env.WS_URL ?? 'ws://127.0.0.1:4173/ws';
let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, msg = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; failures.push({ name, msg }); console.error(`  ❌ ${name}: ${msg}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeClient(url) {
  const ws = new WebSocket(url);
  const queue = [];
  const waiters = [];
  ws.on('message', (d) => {
    const env = JSON.parse(d.toString());
    queue.push(env);
    for (const w of [...waiters]) {
      if (w.pred(env)) { clearTimeout(w.timer); waiters.splice(waiters.indexOf(w), 1); w.resolve(env); }
    }
  });
  const open = () => new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  const waitFor = (pred, timeout = 5000, label = 'msg') => new Promise((res, rej) => {
    const f = queue.find(pred); if (f) return res(f);
    const w = { pred, resolve: res };
    w.timer = setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); rej(new Error(`timeout waiting ${label}`)); }, timeout);
    waiters.push(w);
  });
  return { ws, open, waitFor, send: (e) => ws.send(JSON.stringify(e)), close: () => ws.close() };
}
const env = (type, payload, from, to) => ({ v: 1, type, id: `d-${Math.random().toString(36).slice(2)}`, ts: Date.now(), from, to, payload });
const regPayload = (deviceId) => ({ deviceId, name: deviceId, hostname: 'h', os: { platform: 'darwin', arch: 'arm64', release: 'r' }, version: '0.1.0', token: 't' });

async function main() {
  console.log('== 看板实时性回归（Gap #2）==\n');

  // 1. 看板连接 → 立即收到 snapshot
  const dash = makeClient(`${WS_URL}?type=dashboard`);
  await dash.open();
  const snap = await dash.waitFor((e) => e.type === 'dashboard.snapshot', 5000, 'snapshot');
  check('看板连接后收到 dashboard.snapshot', !!snap, '未收到 snapshot');
  check('snapshot 含 devices/agents/tasks 数组', Array.isArray(snap?.payload?.devices) && Array.isArray(snap?.payload?.agents) && Array.isArray(snap?.payload?.tasks), JSON.stringify(snap?.payload));

  // 2. 设备注册 → 看板收到设备 patch
  const dev = makeClient(`${WS_URL}?type=device`);
  await dev.open();
  dev.send(env('device.register', regPayload('rt-dev-1'), 'rt-dev-1', 'coordinator'));
  await dev.waitFor((e) => e.type === 'device.register_ack', 5000, 'register_ack');
  const regPatch = await dash.waitFor((e) => e.type === 'dashboard.patch' && (e.payload?.devices ?? []).some((x) => x.deviceId === 'rt-dev-1'), 5000, 'register device patch');
  check('设备 register → 看板收到 device patch', !!regPatch, '未收到 register patch');

  // 3. 设备心跳 → 看板收到 patch（负载刷新）
  dev.send(env('device.heartbeat', { deviceId: 'rt-dev-1', load: { cpu: 0.77, mem: 0.5 }, busyAgents: 0, ts: Date.now() }, 'rt-dev-1', 'coordinator'));
  const hbPatch = await dash.waitFor((e) => e.type === 'dashboard.patch' && (e.payload?.devices ?? []).some((x) => x.deviceId === 'rt-dev-1' && Math.abs(x.load.cpu - 0.77) < 1e-6), 5000, 'heartbeat patch');
  check('设备 heartbeat → 看板收到负载 patch(cpu=0.77)', !!hbPatch, '未收到 heartbeat patch');

  // 4. 设备断线 → 看板收到 patch（offline）
  dev.close();
  const offlinePatch = await dash.waitFor((e) => e.type === 'dashboard.patch' && (e.payload?.devices ?? []).some((x) => x.deviceId === 'rt-dev-1'), 5000, 'disconnect patch');
  check('设备断线 → 看板收到 patch', !!offlinePatch, '未收到 disconnect patch');

  dash.close();
  console.log(`\n== 结果：${passed} 通过 / ${failed} 失败 ==`);
  if (failed) { for (const f of failures) console.error(`  - ${f.name}: ${f.msg}`); process.exitCode = 1; }
  else console.log('全部通过 ✅');
}
main().catch((e) => { console.error('异常:', e); process.exit(2); });
