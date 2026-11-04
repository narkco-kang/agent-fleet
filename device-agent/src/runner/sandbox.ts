/**
 * 三态沙箱 runner（P0-2）：默认关，按高危子角色开。
 *
 * - none：不套沙箱（默认，不拖慢日常任务）
 * - readonly：只读文件系统（可执行，禁止写）
 * - isolated：只读 + 网络隔离（高危命令）
 *
 * 机制按 OS：
 * - macOS：`sandbox-exec -p <Seatbelt profile>`
 * - Linux：`bwrap`（bubblewrap）namespace（--ro-bind 只读 + --unshare-net 隔离网络）
 * - Windows：受限令牌 + NTFS ACL（复杂，MVP 返回原样并提示，后续补）
 *
 * 铁律：沙箱是执行隔离，不是权限授权——deploy/uninstall/asset_deliver 仍必过 actionGuard。
 */

import type { SandboxProfile } from '@agentfleet/shared';

export type { SandboxProfile };

/** macOS Seatbelt 只读 profile */
const DARWIN_READONLY = '(version 1)(allow default)(deny file-write*)';

/** macOS Seatbelt 只读 + 网络隔离 profile */
const DARWIN_ISOLATED = '(version 1)(allow default)(deny file-write*)(deny network*)';

/** 包裹命令：按 OS + profile 返回 { cmd, args }（none 原样返回） */
export function buildSandboxCommand(
  profile: SandboxProfile,
  cmd: string,
  args: string[],
): { cmd: string; args: string[] } {
  if (profile === 'none') return { cmd, args };

  const platform = process.platform;

  if (platform === 'darwin') {
    const sb = profile === 'isolated' ? DARWIN_ISOLATED : DARWIN_READONLY;
    return { cmd: '/usr/bin/sandbox-exec', args: ['-p', sb, cmd, ...args] };
  }

  if (platform === 'linux') {
    const bwrap: string[] = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc'];
    if (profile === 'isolated') bwrap.push('--unshare-net');
    return { cmd: 'bwrap', args: [...bwrap, '--', cmd, ...args] };
  }

  // Windows：受限令牌 + NTFS ACL（待补）；MVP 原样返回
  return { cmd, args };
}

/** 是否系统支持该 profile 的沙箱（sandbox-exec / bwrap 存在性，调用方可用它降级） */
export function isSandboxSupported(profile: SandboxProfile): boolean {
  if (profile === 'none') return true;
  return process.platform === 'darwin' || process.platform === 'linux';
}
