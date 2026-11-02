import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import { initDatabase, closeDatabase } from './db/database.js';
import { config } from './config.js';
import { registerDeviceRoutes } from './routes/devices.js';
import { registerTaskRoutes } from './routes/tasks.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerMemoryRoutes } from './routes/memory.js';
import { registerRoutingRoutes } from './routes/routing.js';
import { registerPlatformModelRoutes } from './routes/platformModels.js';
import { registerAssetRoutes } from './routes/assets.js';
import { registerDeployRoutes } from './routes/deploy.js';
import { registerTeamRoutes } from './routes/teams.js';
import { registerLoopRoutes } from './routes/loop.js';
import {
  handleConnection,
  setTaskBridge,
  setRelayForward,
  setSnapshotProvider,
  setDevicePatchBuilder,
  setAssetAckHandler,
} from './transport/wsServer.js';
import { startLanDiscovery, stopLanDiscovery } from './transport/lanDiscovery.js';
import { createRelayServer } from './transport/relayServer.js';
import { buildSnapshot, buildDevicePatch } from './services/snapshot.js';
import {
  connectRelay,
  relaySend,
  setRelayMessageHandler,
} from './services/relayClient.js';
import { deviceRegistry } from './services/deviceRegistry.js';
import { initTaskRunner, onDeviceTaskEvent, onDeviceTaskResult, onDeviceDisconnected } from './services/taskRunner.js';
import { memoryLedger } from './services/memoryLedger.js';
import { startDispatchLoop } from './services/scheduler.js';
import { roleRouteStore } from './services/routing/roleRouteStore.js';
import { registerDeployExecutor } from './services/deploy/deployService.js';
import {
  registerDeliveryExecutor,
  startDeliverySweeper,
  handleAssetDeliverAck,
} from './services/assets/deliveryService.js';
import { loopScheduler, registerLoopExecutor } from './services/loop/loopScheduler.js';
import { startCheckinLoop } from './services/routing/checkinService.js';
import { registerGatewayRoutes } from './routes/gateway.js';
import { gatewayManager } from './services/gateway/gatewayManager.js';
import { MESSAGE_TYPES } from '@agentfleet/shared';

/**
 * 后端协调服务入口：
 * HTTP(Fastify) + WS(ws) + mDNS 浏览 + 中继（可选同进程）+ 调度/任务编排。
 */

async function main(): Promise<void> {
  initDatabase();
  console.log('[backend] SQLite 数据库就绪（14 张表，含 9 张新表）:', config.dbPath);

  // 团队记忆账本（group="team"）：启动即加载，任务终态自动记账
  await memoryLedger.init();
  console.log('[backend] 团队记忆账本就绪（group=team）');

  // 角色路由表：重载 + 可选导入 agent-role-routes.json + 空表播种默认角色
  roleRouteStore.reload();
  if (config.roleRoutesJsonPath) {
    try {
      const n = roleRouteStore.importFromJsonFile(config.roleRoutesJsonPath);
      console.log(`[backend] 已从 ${config.roleRoutesJsonPath} 导入 ${n} 条角色路由`);
    } catch (err) {
      console.warn('[backend] 角色路由 JSON 导入失败（跳过）:', (err as Error).message);
    }
  }
  const seeded = roleRouteStore.seedDefaults();
  if (seeded > 0) console.log(`[backend] 已播种 ${seeded} 条默认角色路由`);

  // 对外动作执行器注册（确认 → 执行）+ 资产 ack 桥接 + 补发/loop 定时器
  registerDeployExecutor();
  registerDeliveryExecutor();
  registerLoopExecutor();
  setAssetAckHandler(handleAssetDeliverAck);
  startDeliverySweeper();
  loopScheduler.startTicker();
  startCheckinLoop();

  // 装配任务桥接 + 中继转发
  setTaskBridge({
    onDeviceTaskEvent,
    onDeviceTaskResult,
    onDeviceDisconnected,
  });
  setRelayForward((deviceId, envelope) => relaySend(deviceId, envelope));
  // 看板快照 + 设备 patch 装配（避免 wsServer 与 scheduler 循环 import）
  setSnapshotProvider(buildSnapshot);
  setDevicePatchBuilder(buildDevicePatch);
  initTaskRunner();
  deviceRegistry.startSweeper();
  startDispatchLoop();

  const app = Fastify({ logger: false });

  // CORS（看板 Vite dev 跨端口调用）
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return reply.code(204).send();
    }
    return undefined;
  });

  await app.register(websocket);
  await app.register(multipart);

  // WS 入口：/ws?type=device|dashboard|gateway
  app.get('/ws', { websocket: true }, (conn, req) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    handleConnection(conn as unknown as import('ws').WebSocket, {
      type: url.searchParams.get('type') ?? 'device',
      deviceId: url.searchParams.get('deviceId') ?? undefined,
    });
  });

  registerSystemRoutes(app);
  registerDeviceRoutes(app);
  registerTaskRoutes(app);
  registerMemoryRoutes(app);
  registerRoutingRoutes(app);
  registerPlatformModelRoutes(app);
  registerAssetRoutes(app);
  registerDeployRoutes(app);
  registerTeamRoutes(app);
  registerLoopRoutes(app);
  registerGatewayRoutes(app);

  await app.listen({ host: config.host, port: config.port });
  console.log(`[backend] AgentFleet 协调服务已启动 http://${config.host}:${config.port}`);

  // 内置 modelgateway：MODELGATEWAY_AUTO_START=1 时后端启动后自动 spawn（默认手动）
  void gatewayManager.maybeAutoStart().catch((err) => {
    console.warn('[backend] modelgateway 自动启动失败:', (err as Error).message);
  });

  // mDNS 局域网发现
  startLanDiscovery();

  // 中继（同进程，供本地兜底测试）+ 出站连中继（若配置）
  if (process.env.RELAY_IN_PROCESS === '1') {
    const { wss } = createRelayServer();
    wss.on('listening', () =>
      console.log(`[backend] 同进程中继已启动 ws://0.0.0.0:${config.relayPort}`),
    );
  }
  setRelayMessageHandler((env) => {
    if (env.type === MESSAGE_TYPES.DEVICE_RELAY_ONLINE) {
      const { deviceId } = env.payload as { deviceId: string };
      deviceRegistry.register(deviceId, deviceId, 'relay');
    } else if (env.type === MESSAGE_TYPES.DEVICE_RELAY_OFFLINE) {
      const { deviceId } = env.payload as { deviceId: string };
      const entry = deviceRegistry.get(deviceId);
      if (entry?.kind === 'relay') deviceRegistry.remove(deviceId);
    }
    // 设备经中继上报的任务事件/结果复用协调 WS 分发
    if (env.type === MESSAGE_TYPES.TASK_EVENT) onDeviceTaskEvent(env.payload as never);
    if (env.type === MESSAGE_TYPES.TASK_RESULT) onDeviceTaskResult(env.payload as never);
    // 资产分发 ack（经中继）
    if (env.type === MESSAGE_TYPES.ASSET_DELIVER_ACK) handleAssetDeliverAck(env.payload as never);
  });
  connectRelay();

  // 优雅退出
  const shutdown = async (): Promise<void> => {
    console.log('\n[backend] 正在关闭...');
    stopLanDiscovery();
    deviceRegistry.stopSweeper();
    await app.close();
    closeDatabase();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[backend] 启动失败:', err);
  process.exit(1);
});
