import type { AgentSnapshot, DeviceSnapshot } from '@agentfleet/shared';

/**
 * Demo / mock 兜底数据：当后端无真实设备接入时，前端注入一组示例
 * 设备/agent，配合 MockEngine 驱动神经图的动态演示。
 * （任务节点由 MockEngine 动态生成，不在此静态定义。）
 */

const now = Date.now();

export const mockDevices: DeviceSnapshot[] = [
  {
    deviceId: 'dev-macbook',
    name: 'MacBook Pro',
    hostname: 'macbook.local',
    osPlatform: 'darwin',
    osArch: 'arm64',
    status: 'online',
    lastHeartbeat: now,
    lanAddr: '192.168.1.10:38412',
    relayOnline: false,
    load: { cpu: 0.32, mem: 0.58 },
    busyAgents: 1,
  },
  {
    deviceId: 'dev-pcwin',
    name: 'PC-Win',
    hostname: 'pc-win.local',
    osPlatform: 'win32',
    osArch: 'x64',
    status: 'online',
    lastHeartbeat: now,
    lanAddr: '192.168.1.21:38920',
    relayOnline: false,
    load: { cpu: 0.18, mem: 0.41 },
    busyAgents: 0,
  },
  {
    deviceId: 'dev-phone',
    name: '手机 · iPhone',
    hostname: 'iphone.local',
    osPlatform: 'ios',
    osArch: 'arm64',
    status: 'offline',
    lastHeartbeat: now - 90_000,
    lanAddr: null,
    relayOnline: false,
    load: { cpu: 0, mem: 0 },
    busyAgents: 0,
  },
];

export const mockAgents: AgentSnapshot[] = [
  {
    deviceId: 'dev-macbook',
    agentType: 'grok',
    displayName: 'Grok Bot',
    version: '1.0.62',
    executable: '~/.grok/bin/grok',
    status: 'busy',
    capabilities: ['coding', 'shell', 'reasoning'],
    maxConcurrency: 1,
    busyCount: 1,
    activated: false,
    bots: [
      { name: 'explore', description: '只读代码研究' },
      { name: 'plan', description: '只出实现方案' },
      { name: 'reviewer', description: '代码评审' },
    ],
  },
  {
    deviceId: 'dev-macbook',
    agentType: 'claude',
    displayName: 'Claude Code',
    version: '1.0.29',
    executable: '~/.local/bin/claude',
    status: 'available',
    capabilities: ['coding', 'reasoning'],
    maxConcurrency: 1,
    busyCount: 0,
    activated: true,
    bots: [],
  },
  {
    deviceId: 'dev-pcwin',
    agentType: 'codex',
    displayName: 'Codex',
    version: '0.31.0',
    executable: 'codex',
    status: 'available',
    capabilities: ['coding'],
    maxConcurrency: 1,
    busyCount: 0,
    activated: true,
    bots: [],
  },
  {
    deviceId: 'dev-pcwin',
    agentType: 'dsh',
    displayName: 'DSH',
    version: '0.9.4',
    executable: 'dsh',
    status: 'available',
    capabilities: ['shell', 'coding'],
    maxConcurrency: 1,
    busyCount: 0,
    activated: false,
    bots: [],
  },
  {
    deviceId: 'dev-macbook',
    agentType: 'workbuddy',
    displayName: 'WorkBuddy',
    version: '5.9.4',
    executable: '/Applications/WorkBuddy AI.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy',
    status: 'available',
    capabilities: ['coding', 'reasoning'],
    maxConcurrency: 1,
    busyCount: 0,
    activated: false,
    bots: [],
  },
];
