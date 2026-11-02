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

/**
 * 宿主管道错误码：父子进程间的 stdout / IPC 管道被关闭时抛出。
 *
 * 背景：在 WorkBuddy、CI runner 等宿主里，Node 会被注入输出管道 shim
 * （如 NODE_OPTIONS 预加载 broker-ipc-client）。宿主侧连接一旦关闭，
 * 该 shim 内部会产生 EPIPE 的 Promise 拒绝并升级为未捕获异常，
 * 直接杀死整个守护进程 —— 但守护进程的核心职责（WS 连接、任务执行）
 * 完全正常，不应该因为「日志管道断了」而整体退出。
 */
const HOST_PIPE_ERROR_CODES = new Set(['EPIPE', 'ECONNRESET', 'ERR_STREAM_DESTROYED']);

/** 判断是否为宿主管道类错误（这类错误可降级为警告） */
function isHostPipeError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' && HOST_PIPE_ERROR_CODES.has(code);
}

/** 安全输出：管道已坏时 console 自身也会抛错，必须兜住 */
function safeWarn(message: string): void {
  try {
    console.warn(message);
  } catch {
    /* 输出通道不可用，静默 */
  }
}

function safeError(message: string, err: unknown): void {
  try {
    console.error(message, err);
  } catch {
    /* 输出通道不可用，静默 */
  }
}

/**
 * 安装崩溃兜底：
 * - 管道类错误 → 降级为警告，守护进程继续运行（日志去重，避免刷屏）
 * - 其他未捕获异常 → 打印完整堆栈后退出码 1，不掩盖真实缺陷
 */
function installCrashGuards(): void {
  let pipeWarnings = 0;

  const handlePipe = (err: unknown): boolean => {
    if (!isHostPipeError(err)) return false;
    // 只在前 3 次告警，之后静默，避免管道故障导致日志风暴
    if (pipeWarnings < 3) {
      pipeWarnings += 1;
      safeWarn(
        `[device-agent] 宿主输出管道不可用（已降级忽略，守护进程继续）: ${(err as Error)?.message ?? err}`,
      );
    }
    return true;
  };

  // 输出流自身也要监听：未监听的 stdout 'error' 会升级为 uncaughtException
  process.stdout.on('error', (err) => {
    handlePipe(err);
  });
  process.stderr.on('error', (err) => {
    handlePipe(err);
  });

  process.on('uncaughtException', (err) => {
    if (handlePipe(err)) return;
    safeError('[device-agent] 未捕获异常，进程退出:', err);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    if (handlePipe(reason)) return;
    safeError('[device-agent] 未处理的 Promise 拒绝:', reason);
  });
}

async function main(): Promise<void> {
  installCrashGuards();
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
