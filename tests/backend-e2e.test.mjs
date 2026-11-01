/**
 * AgentMesh 后端核心链路端到端集成测试（QA 严过关）
 *
 * 前置：后端已启动（Node v24 + AGENTMESH_SKIP_AUTH=1 + 独立 DB）。
 * 运行：node tests/backend-e2e.test.mjs
 *
 * 覆盖：健康检查 / WS 设备注册 / 能力上报 / 任务下发 / 状态机
 *       / max_agents 限流 / 取消 / 断线中断 / 指定路由 / 边界。
 */
import WebSocket from 'ws';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4173';
const WS_URL = process.env.WS_URL ?? 'ws://127.0.0.1:4173/ws';

let passed = 0;
let failed = 0;
const failures = [];

function ok(name) {
  passed++;
  console.log(`  ✅ ${name}`);
}
function bad(name, msg) {
  failed++;
  failures.push({ name, msg });
  console.error(`  ❌ ${name}: ${msg}`);
}
function check(name, cond, msg = 'assertion failed') {
  if (cond) ok(name);
  else bad(name, msg);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 消息客户端封装 ──────────────────────────────────────────────
function makeClient(url) {
  const ws = new WebSocket(url);
  const queue = [];
  const waiters = [];
  ws.on('message', (data) => {
    let env;
    try {
      env = JSON.parse(data.toString('utf-8'));
    } catch {
      return;
    }
    queue.push(env);
    for (const w of [...waiters]) {
      if (w.pred(env)) {
        clearTimeout(w.timer);
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(env);
      }
    }
  });
  const waitFor = (pred, timeout = 8000, label = 'message') =>
    new Promise((resolve, reject) => {
      const found = queue.find(pred);
      if (found) return resolve(found);
      const w = { pred, resolve };
      w.timer = setTimeout(() => {
        const i = waiters.indexOf(w);
        if (i >= 0) waiters.splice(i, 1);
        reject(new Error(`timeout waiting for ${label}`));
      }, timeout);
      waiters.push(w);
    });
  const send = (env) => ws.send(JSON.stringify(env));
  const open = () =>
    new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
  const close = () => ws.close();
  return { ws, send, waitFor, open, close, queue };
}

const env = (type, payload, from = 'coordinator', to = 'device') => ({
  v: 1,
  type,
  id: `t-${Math.random().toString(36).slice(2)}`,
  ts: Date.now(),
  from,
  to,
  payload,
});

const deviceRegisterPayload = (deviceId, name, token) => ({
  deviceId,
  name,
  hostname: `${deviceId}.local`,
  os: { platform: 'darwin', arch: 'arm64', release: '24.0.0' },
  version: '0.1.0',
  token,
});

async function api(path, opts = {}) {
  const headers = {};
  if (opts.body != null) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { headers, ...opts });
  return res.json();
}

/** 设备侧：完整跑一个任务（发送 text 事件 + completed 结果） */
async function completeTask(client, taskId, text) {
  client.send(env('task.event', { taskId, seq: 1, eventType: 'text', data: { text }, ts: Date.now() }, 'dev-1', 'coordinator'));
  client.send(env('task.result', { taskId, status: 'completed', result: { text, exitCode: 0, durationMs: 200 }, logs: [], finishedAt: Date.now() }, 'dev-1', 'coordinator'));
  await sleep(250);
}

async function main() {
  // 全局安全兜底：超时直接退出，避免悬挂
  const safety = setTimeout(() => {
    console.error('\n[安全超时] 测试超过 45s 未结束，强制退出');
    process.exit(3);
  }, 45_000);
  safety.unref();

  console.log('== AgentMesh 后端 E2E 测试 ==\n');

  // ── T1.1 健康检查 ──────────────────────────────────────────────
  {
    const r = await api('/api/system/health');
    check('T1.1 GET /api/system/health → ok:true', r.ok === true, JSON.stringify(r));
  }

  // ── 边界 空设备列表不崩 ────────────────────────────────────────
  {
    const r = await api('/api/devices');
    check('边界 空设备列表 GET /api/devices 不崩且 data 为数组', r.ok === true && Array.isArray(r.data), JSON.stringify(r));
  }

  // ── 边界 无设备下发任务 → queued；随后取消（顺带验证取消 queued） ──
  let orphanTaskId;
  {
    const r = await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ prompt: '边界测试：无设备时应保持 queued', target: { mode: 'auto' } }),
    });
    orphanTaskId = r.data?.taskId;
    check('边界 无设备下发任务 → 返回 queued', r.ok === true && r.data?.status === 'queued', JSON.stringify(r));
    await sleep(300);
    const d = await api(`/api/tasks/${orphanTaskId}`);
    check('边界 无设备任务落库 status=queued', d.data?.status === 'queued', JSON.stringify(d.data));

    // 取消这个 queued 任务（避免后续设备上线后被自动派发干扰）
    const c = await api(`/api/tasks/${orphanTaskId}/cancel`, { method: 'POST' });
    check('T4.6 取消 queued 任务 → ok', c.ok === true, JSON.stringify(c));
    await sleep(200);
    const d2 = await api(`/api/tasks/${orphanTaskId}`);
    check('T4.6 取消后 → status=cancelled', d2.data?.status === 'cancelled', JSON.stringify(d2.data));
  }

  // ── T1.4 设备注册（register→ack→落库） ─────────────────────────
  const dev1 = makeClient(`${WS_URL}?type=device`);
  await dev1.open();
  dev1.send(env('device.register', deviceRegisterPayload('dev-1', 'QA-Mac', 'qa-token-1'), 'dev-1', 'coordinator'));
  {
    const ack = await dev1.waitFor((e) => e.type === 'device.register_ack', 8000, 'register_ack');
    check('T1.4 设备注册 → register_ack accepted=true', ack?.payload?.accepted === true, JSON.stringify(ack));
  }
  {
    await sleep(200);
    const r = await api('/api/devices');
    const d = r.data?.find((x) => x.deviceId === 'dev-1');
    check('T1.4 设备注册 → devices 表落库', !!d, JSON.stringify(r.data));
    check('T1.4 设备落库 status=online', d?.status === 'online', JSON.stringify(d));
  }

  // ── T1.5 能力上报 → agents 落库 ────────────────────────────────
  {
    dev1.send(env('device.capabilities', {
      deviceId: 'dev-1',
      agents: [
        { agentType: 'grok', displayName: 'Grok', version: '1.0.62', executable: '/tmp/grok', status: 'available', detectMethod: 'default_dir', capabilities: ['coding', 'shell', 'reasoning'], maxConcurrency: 1 },
        { agentType: 'claude', displayName: 'Claude Code', version: '1.0.29', executable: '/tmp/claude', status: 'available', detectMethod: 'which', capabilities: ['coding'], maxConcurrency: 1 },
      ],
      ts: Date.now(),
    }, 'dev-1', 'coordinator'));
    await sleep(300);
    const r = await api('/api/devices/dev-1');
    check('T1.5 能力上报 → agents 落库（grok+claude）', (r.data?.agents ?? []).length === 2, JSON.stringify(r.data?.agents));
  }

  // ── T1.6 心跳 ──────────────────────────────────────────────────
  {
    dev1.send(env('device.heartbeat', { deviceId: 'dev-1', load: { cpu: 0.2, mem: 0.5 }, busyAgents: 0, ts: Date.now() }, 'dev-1', 'coordinator'));
    await sleep(200);
    const r = await api('/api/devices/dev-1');
    check('T1.6 心跳更新 last_heartbeat', !!r.data?.lastHeartbeat, JSON.stringify(r.data));
  }

  // ── T4.1 auto 路由：空闲优先 + 能力匹配 ────────────────────────
  let taskA;
  {
    const r = await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ prompt: '写一个排序算法', target: { mode: 'auto' } }),
    });
    taskA = r.data?.taskId;
    check('T4.1 auto 下发 → 返回 queued(taskId)', r.ok === true && !!taskA, JSON.stringify(r));
    const submit = await dev1.waitFor((e) => e.type === 'task.submit' && e.payload?.taskId === taskA, 8000, 'taskA submit');
    check('T4.1 auto 路由 → 设备收到 task.submit', !!submit, 'dev-1 未收到 taskA 的 task.submit');
    check('T4.1 auto 路由 → target_device_id=dev-1', submit?.payload?.target?.deviceId === 'dev-1', JSON.stringify(submit?.payload?.target));
    check('T4.1 auto 路由 → target.agentType 被填充', !!submit?.payload?.target?.agentType, JSON.stringify(submit?.payload?.target));
    await sleep(300);
    const d = await api(`/api/tasks/${taskA}`);
    check('T4.1 auto 任务状态流转 → running', d.data?.status === 'running', JSON.stringify(d.data));
  }

  // ── T4.2 流式事件 + 结果 → completed ───────────────────────────
  {
    for (const s of [1, 2, 3]) {
      dev1.send(env('task.event', { taskId: taskA, seq: s, eventType: 'text', data: { text: `chunk-${s} ` }, ts: Date.now() }, 'dev-1', 'coordinator'));
    }
    await sleep(200);
    dev1.send(env('task.result', { taskId: taskA, status: 'completed', result: { text: 'chunk-1 chunk-2 chunk-3 ', exitCode: 0, durationMs: 1200 }, logs: [], finishedAt: Date.now() }, 'dev-1', 'coordinator'));
    await sleep(400);
    const d = await api(`/api/tasks/${taskA}`);
    check('T4.2 任务结果 → status=completed', d.data?.status === 'completed', JSON.stringify(d.data));
    check('T4.2 结果文本落库', d.data?.resultText === 'chunk-1 chunk-2 chunk-3 ', JSON.stringify(d.data?.resultText));
    check('T4.2 消息流落库（>=4 条：3 text + 结果 system）', (d.data?.messages ?? []).length >= 4, `messages=${d.data?.messages?.length}`);
  }

  // ── T4.3 max_agents 限流（grok maxConcurrency=1） ──────────────
  let taskB, taskC;
  {
    const rb = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ prompt: '任务B', target: { mode: 'agent', agentType: 'grok' } }) });
    taskB = rb.data?.taskId;
    const submitB = await dev1.waitFor((e) => e.type === 'task.submit' && e.payload?.taskId === taskB, 8000, 'taskB submit');
    check('T4.3 任务B（grok）→ 派发 running', !!submitB, '未收到 taskB submit');

    const rc = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ prompt: '任务C', target: { mode: 'agent', agentType: 'grok' } }) });
    taskC = rc.data?.taskId;
    await sleep(500);
    const dc = await api(`/api/tasks/${taskC}`);
    check('T4.3 max_agents=1 → 第二个任务保持 queued', dc.data?.status === 'queued', `taskC status=${dc.data?.status}`);

    // 完成 B → 释放 → C 自动派发
    await completeTask(dev1, taskB, 'B done');
    const submitC = await dev1.waitFor((e) => e.type === 'task.submit' && e.payload?.taskId === taskC, 8000, 'taskC submit');
    check('T4.3 前一任务结束 → 排队任务自动派发', !!submitC, 'taskC 未被自动派发');
    await sleep(300);
    const dc2 = await api(`/api/tasks/${taskC}`);
    check('T4.3 派发后 taskC → running', dc2.data?.status === 'running', JSON.stringify(dc2.data));
    await completeTask(dev1, taskC, 'C done');
  }

  // ── T4.4 device 指定路由 ───────────────────────────────────────
  {
    const r = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ prompt: '指定设备任务', target: { mode: 'device', deviceId: 'dev-1' } }) });
    const id = r.data?.taskId;
    const submit = await dev1.waitFor((e) => e.type === 'task.submit' && e.payload?.taskId === id, 8000, 'device-spec submit');
    check('T4.4 device 指定路由 → 派发到 dev-1', !!submit, '未收到 device 指定任务');
    await sleep(200);
    const d = await api(`/api/tasks/${id}`);
    check('T4.4 device 指定 → target_device_id 落库', d.data?.targetDeviceId === 'dev-1', JSON.stringify(d.data));
    await completeTask(dev1, id, 'dev spec done');
  }

  // ── 边界 指定不存在的设备 → 保持 queued ────────────────────────
  {
    const r = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ prompt: '不存在设备', target: { mode: 'device', deviceId: 'dev-ghost' } }) });
    await sleep(300);
    const d = await api(`/api/tasks/${r.data?.taskId}`);
    check('边界 device 指定不存在设备 → 保持 queued', d.data?.status === 'queued', JSON.stringify(d.data));
  }

  // ── 边界 agent 指定不存在平台 → 保持 queued ─────────────────────
  {
    const r = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ prompt: '无 dsh 平台', target: { mode: 'agent', agentType: 'dsh' } }) });
    await sleep(300);
    const d = await api(`/api/tasks/${r.data?.taskId}`);
    check('边界 agent 指定不存在平台 → 保持 queued', d.data?.status === 'queued', JSON.stringify(d.data));
  }

  // ── T4.7 断线 → running 任务标记 interrupted ───────────────────
  {
    const r = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ prompt: '断线中断任务', target: { mode: 'agent', agentType: 'grok' } }) });
    const id = r.data?.taskId;
    const submit = await dev1.waitFor((e) => e.type === 'task.submit' && e.payload?.taskId === id, 8000, 'interrupt submit');
    check('T4.7 断线前任务派发 running', !!submit, '未收到断线任务 submit');
    await sleep(300);
    dev1.close();
    await sleep(800);
    const d = await api(`/api/tasks/${id}`);
    check('T4.7 设备断线 → status=interrupted', d.data?.status === 'interrupted', `status=${d.data?.status}`);
  }

  // ── 边界 非法信封类型 → 回 system 事件（不静默） ───────────────
  {
    const devGhost = makeClient(`${WS_URL}?type=device`);
    await devGhost.open();
    devGhost.send(env('device.register', deviceRegisterPayload('dev-ghost2', 'Ghost', 'ghost-token'), 'dev-ghost2', 'coordinator'));
    await devGhost.waitFor((e) => e.type === 'device.register_ack', 5000, 'ghost register_ack');
    devGhost.send(env('no.such.type', { foo: 1 }, 'dev-ghost2', 'coordinator'));
    const sysEvt = await devGhost.waitFor((e) => e.type === 'task.event' && e.payload?.eventType === 'system', 5000, 'system error echo');
    check('边界 非法信封类型 → 回 system 事件（不静默）', !!sysEvt, '未收到 system 错误回传');
    devGhost.close();
  }

  // ── 汇总 ───────────────────────────────────────────────────────
  clearTimeout(safety);
  console.log(`\n== 结果：${passed} 通过 / ${failed} 失败 ==`);
  if (failures.length) {
    console.error('失败明细：');
    for (const f of failures) console.error(`  - ${f.name}: ${f.msg}`);
    process.exitCode = 1;
  } else {
    console.log('全部通过 ✅');
  }
}

main().catch((err) => {
  console.error('测试脚本异常:', err);
  process.exit(2);
});
