import { config } from './config.js';
import { loadRegistry } from './registry.js';
import { startLanServer } from './lanServer.js';
import { startDiscovery } from './discovery.js';
import { startHeartbeat } from './heartbeat.js';
import { connectRelay } from './relayClient.js';
import { connectCoordinator } from './coordinatorClient.js';
import { detectAllAgents } from './adapters/index.js';
import { memoryClient } from './memory/memoryClient.js';

/**
 * 设备守护进程入口：
 * 读配置 → 起本地 WS Server → mDNS 广播 → 探测能力 → 出站连中继兜底 → 心跳。
 */
async function main(): Promise<void> {
  const { deviceId } = loadRegistry();
  console.log(`[device-agent] 设备 ID: ${deviceId}`);
  console.log(`[device-agent] 设备名: ${config.deviceName} (v${config.version})`);

  // 初始化本地团队记忆账本（follower，接收 backend 广播同步）
  await memoryClient.init();

  // 启动本地 WS Server（协调服务直连入口）
  const lan = await startLanServer();
  console.log(`[device-agent] 本地 WS Server 已启动 ws://0.0.0.0:${lan.port}`);

  // mDNS 广播（沙箱受限自动降级为配置直连）
  const discovery = startDiscovery(lan.port);

  // 能力探测（grok 真接 + codex/claude/dsh 骨架）
  const agents = await detectAllAgents();
  if (agents.length > 0) {
    console.log('[device-agent] 已探测到平台:');
    for (const a of agents) {
      console.log(`  - ${a.displayName} (${a.agentType}) v${a.version} @ ${a.executable}`);
    }
  } else {
    console.log('[device-agent] 未探测到任何 agent 平台（能力为空）');
  }

  // 心跳（10s）
  startHeartbeat();

  // 云端中继兜底（若配置）
  connectRelay();

  // 协调服务出站直连（mDNS 不可用时的降级通道，若配置）
  connectCoordinator();

  console.log('[device-agent] 守护进程运行中，Ctrl+C 退出');

  const shutdown = (): void => {
    console.log('\n[device-agent] 正在关闭...');
    discovery.stop();
    lan.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[device-agent] 启动失败:', err);
  process.exit(1);
});
