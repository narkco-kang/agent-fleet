import { config } from './config.js';
import { ProviderPool } from './providers.js';
import { GatewayServer } from './server.js';

/**
 * 内置 modelgateway 入口：读配置 → 建 provider 池 → 建 server → listen。
 * 默认手动启动；backend 可通过 MODELGATEWAY_AUTO_START=1 自动 spawn。
 */
async function main(): Promise<void> {
  const pool = new ProviderPool(config.paidProviders);
  const server = new GatewayServer(pool);
  await server.start();
  console.log(
    `[modelgateway] 内置网关已启动 http://${config.host}:${config.port}` +
      `（providers=${pool.list().length}, paid=${config.paidProviders.length}, default=${pool.defaultModel()}）`,
  );

  // 优雅退出：SIGINT/SIGTERM 触发 server.stop()，3s 兜底强制退出避免挂起
  const shutdown = (): void => {
    console.log('\n[modelgateway] 正在关闭...');
    const forceTimer = setTimeout(() => process.exit(0), 3000);
    forceTimer.unref();
    void server.stop().finally(() => {
      clearTimeout(forceTimer);
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[modelgateway] 启动失败:', err);
  process.exit(1);
});
