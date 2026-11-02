/**
 * 中继透传端到端测试（QA 严过关）
 * 前置：中继已启动（npm run relay --workspace backend，端口 4174）。
 * 运行：node tests/relay-e2e.test.mjs
 */
import WebSocket from 'ws';

const RELAY = 'ws://127.0.0.1:4174/ws';
let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, msg = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; failures.push({ name, msg }); console.error(`  ❌ ${name}: ${msg}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(url) {
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
  const waitFor = (pred, timeout = 5000) => new Promise((res, rej) => {
    const f = queue.find(pred); if (f) return res(f);
    const w = { pred, resolve: res };
    w.timer = setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); rej(new Error('timeout')); }, timeout);
    waiters.push(w);
  });
  return { ws, open, waitFor, send: (e) => ws.send(JSON.stringify(e)), close: () => ws.close() };
}

const env = (type, payload, from, to) => ({ v: 1, type, id: `r-${Math.random().toString(36).slice(2)}`, ts: Date.now(), from, to, payload });

async function main() {
  console.log('== AgentFleet 中继透传测试 ==\n');
  const device = connect(`${RELAY}?role=device&deviceId=relay-dev-1`);
  const coord = connect(`${RELAY}?role=coordinator`);
  await device.open();
  await coord.open();
  await sleep(300);
  check('T8 中继接受设备连接（role=device）', device.ws.readyState === WebSocket.OPEN);
  check('T8 中继接受协调服务连接（role=coordinator）', coord.ws.readyState === WebSocket.OPEN);

  // 协调 → 设备（to=deviceId）
  coord.send(env('task.submit', { taskId: 'relay-task-1', prompt: 'hi' }, 'coordinator', 'relay-dev-1'));
  const gotSubmit = await device.waitFor((e) => e.type === 'task.submit' && e.payload?.taskId === 'relay-task-1', 5000);
  check('T8 协调→设备 透传（按 to 路由）', !!gotSubmit, '设备未收到 task.submit');

  // 设备 → 协调（to=coordinator）
  device.send(env('task.result', { taskId: 'relay-task-1', status: 'completed', result: { text: 'ok', exitCode: 0, durationMs: 1 }, logs: [], finishedAt: Date.now() }, 'relay-dev-1', 'coordinator'));
  const gotResult = await coord.waitFor((e) => e.type === 'task.result' && e.payload?.taskId === 'relay-task-1', 5000);
  check('T8 设备→协调 透传（to=coordinator）', !!gotResult, '协调未收到 task.result');

  device.close();
  coord.close();
  console.log(`\n== 结果：${passed} 通过 / ${failed} 失败 ==`);
  if (failed) { for (const f of failures) console.error(`  - ${f.name}: ${f.msg}`); process.exitCode = 1; }
  else console.log('全部通过 ✅');
}
main().catch((e) => { console.error('异常:', e); process.exit(2); });
