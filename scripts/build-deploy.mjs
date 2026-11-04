#!/usr/bin/env node
/**
 * 打包「可部署单文件产物」：device-agent 守护 + relay 中继。
 *
 * 目标：让 device-agent / relay 脱离 monorepo 源码，作为单个 .cjs 文件部署到
 * 真实服务器（真实设备测试）。所有纯 JS 依赖（shared/memory/ws/dotenv/
 * bonjour-service/multicast-dns）打进单文件；无原生模块（better-sqlite3 等），
 * 因此远程只需一个 Node.js 运行时即可启动。
 *
 * 用法：npm run build:deploy   （产物 dist/device-agent.cjs + dist/relay.cjs）
 */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

/** @agentfleet/* 是 workspace 源码（TS），esbuild 直接从源码 bundle，不依赖 dist */
const alias = {
  '@agentfleet/shared': './shared/src/index.ts',
  '@agentfleet/memory': './memory/src/index.ts',
};

const base = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: false,
  minify: false,
  logLevel: 'info',
  alias,
};

async function main() {
  await build({
    ...base,
    entryPoints: ['device-agent/src/index.ts'],
    outfile: 'dist/device-agent.cjs',
  });
  await build({
    ...base,
    entryPoints: ['backend/src/relayEntry.ts'],
    outfile: 'dist/relay.cjs',
  });
  console.log('\n✅ 打包完成：dist/device-agent.cjs + dist/relay.cjs');
}

main().catch((err) => {
  console.error('打包失败:', err);
  process.exit(1);
});
