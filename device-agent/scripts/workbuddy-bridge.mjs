#!/usr/bin/env node
/**
 * WorkBuddy 网关桥接进程（AgentFleet workbuddy adapter 的 password 搬运工）。
 *
 * 背景：WorkBuddy 的 gateway password 是主进程每次启动随机生成（randomBytes 32）、
 * 不落盘、只通过环境变量注入给「主进程 spawn 的子进程」。device-agent 是独立进程，
 * 拿不到该 password。
 *
 * 本进程作为 MCP stdio server 被 WorkBuddy 主进程 spawn（继承 CODEBUDDY_GATEWAY_PASSWORD
 * + CODEBUDDY_SERVICE_PROXY_URL），启动时把 password + 端口写入
 * ~/.workbuddy-ai/gateway-bridge.json，供 device-agent 读取。随后实现最小 MCP 协议
 * 保持运行（避免被主进程判定为崩溃）。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import readline from 'node:readline';

const BRIDGE_FILE = join(homedir(), '.workbuddy-ai', 'gateway-bridge.json');

function writeBridge() {
  const password = process.env.CODEBUDDY_GATEWAY_PASSWORD ?? '';
  const proxyUrl = process.env.CODEBUDDY_SERVICE_PROXY_URL ?? '';
  const port = Number(proxyUrl.match(/127\.0\.0\.1:(\d+)/)?.[1] ?? 0);
  try {
    mkdirSync(join(homedir(), '.workbuddy-ai'), { recursive: true });
    writeFileSync(BRIDGE_FILE, JSON.stringify({ password, port, updatedAt: Date.now() }));
  } catch {
    /* 写入失败不致命 */
  }
  return { password, port };
}

const info = writeBridge();
process.stderr.write(
  `[agentfleet-bridge] gateway password=${info.password ? 'ok' : 'MISSING'} port=${info.port}\n`,
);

// 最小 MCP stdio 协议：响应 initialize / tools/list，其余忽略，保持运行。
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const reply = (result) => {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n`);
  };
  if (msg.method === 'initialize') {
    reply({
      protocolVersion: '2024-11-05',
      capabilities: {},
      serverInfo: { name: 'agentfleet-bridge', version: '1.0.0' },
    });
  } else if (msg.method === 'tools/list') {
    reply({ tools: [] });
  } else if (msg.method === 'tools/call') {
    reply({ content: [], isError: false });
  }
  // notifications/initialized、ping 等通知无需响应
});
