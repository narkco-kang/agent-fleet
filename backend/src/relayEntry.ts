import { WebSocketServer } from 'ws';
import { createRelayServer } from './transport/relayServer.js';

/**
 * 中继独立进程入口（npm run relay / npm run dev:relay）。
 * 仅启动 relayServer，不启动协调服务 / 数据库。
 */
const { wss, close } = createRelayServer();

wss.on('listening', () => {
  console.log(`[relay] AgentMesh 中继服务已启动 ws://0.0.0.0:${wss.options.port}`);
});

wss.on('error', (err: Error) => {
  console.error('[relay] 启动失败:', err.message);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\n[relay] 正在关闭...');
  close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  close();
  process.exit(0);
});
