#!/usr/bin/env node
/**
 * 安装 WorkBuddy 网关桥接插件。
 *
 * 桥接是一个最小 MCP stdio server（workbuddy-bridge.mjs），被 WorkBuddy 主进程 spawn 时
 * 继承 CODEBUDDY_GATEWAY_PASSWORD + CODEBUDDY_SERVICE_PROXY_URL，写入
 * ~/.workbuddy-ai/gateway-bridge.json，供 device-agent（独立进程）读取。
 *
 * 本脚本把桥接注册为 WorkBuddy 插件（defer_loading:false = 启动即 spawn），
 * 安装完成后需重启 WorkBuddy 桌面应用生效。
 */
import { writeFileSync, readFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_NAME = 'agentfleet-bridge';
const MARKETPLACE = 'agentfleet';
const VERSION = '1.0.0';
const BRIDGE_SRC = join(__dirname, 'workbuddy-bridge.mjs');

const pluginDir = join(
  homedir(),
  '.codebuddy',
  'plugins',
  'cache',
  MARKETPLACE,
  PLUGIN_NAME,
  VERSION,
);
const metaDir = join(pluginDir, '.codebuddy-plugin');

function writeJson(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

// 1. 复制桥接脚本 + 写 plugin.json
mkdirSync(pluginDir, { recursive: true });
if (!existsSync(BRIDGE_SRC)) {
  console.error(`未找到桥接脚本: ${BRIDGE_SRC}`);
  process.exit(1);
}
copyFileSync(BRIDGE_SRC, join(pluginDir, 'bridge.mjs'));
writeJson(join(metaDir, 'plugin.json'), {
  name: PLUGIN_NAME,
  version: VERSION,
  description: 'AgentFleet WorkBuddy 网关桥接：把动态 gateway password 搬运给 device-agent',
  mcpServers: {
    [PLUGIN_NAME]: {
      command: 'node',
      args: ['${CODEBUDDY_PLUGIN_ROOT}/bridge.mjs'],
      defer_loading: false,
    },
  },
});

// 2. 注册到 installed_plugins.json
const installedFile = join(homedir(), '.codebuddy', 'plugins', 'installed_plugins.json');
const installed = readJson(installedFile, { version: 2, plugins: {} });
const key = `${PLUGIN_NAME}@${MARKETPLACE}`;
const entry = {
  scope: 'user',
  installPath: pluginDir,
  version: VERSION,
  installedAt: new Date().toISOString(),
  lastUpdated: new Date().toISOString(),
};
installed.plugins = installed.plugins || {};
const existing = installed.plugins[key] || [];
installed.plugins[key] = [entry, ...existing.filter((e) => e.version !== VERSION)];
writeJson(installedFile, installed);

// 3. 注册到 configured-plugins.json（启用）
const configuredFile = join(homedir(), '.workbuddy-ai', 'plugins', 'configured-plugins.json');
const configured = readJson(configuredFile, { version: 1, builtInMarketPlugins: [] });
const list = configured.builtInMarketPlugins || [];
if (!list.some((p) => p.name === PLUGIN_NAME)) {
  list.push({ name: PLUGIN_NAME, marketplaceName: MARKETPLACE, scope: 'user' });
}
configured.builtInMarketPlugins = list;
writeJson(configuredFile, configured);

console.log(`✅ 桥接插件已安装到: ${pluginDir}`);
console.log('⚠️  请完全退出并重新打开 WorkBuddy 桌面应用，使桥接生效。');
console.log('   之后 device-agent 将能从 ~/.workbuddy-ai/gateway-bridge.json 读取动态 password。');
