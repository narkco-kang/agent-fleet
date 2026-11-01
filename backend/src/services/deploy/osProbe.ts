import type { DeployOS } from '@agentmesh/shared';
import type { SshConnection } from './sshClient.js';

/**
 * OS 探测：uname -a（Unix）/ ver（Windows）→ DeployOS。
 */

/** 从 uname -a 输出识别 OS（纯函数，便于单测） */
export function detectFromUname(output: string): DeployOS {
  const s = output.toLowerCase();
  if (s.includes('darwin')) return 'macos';
  if (s.includes('linux')) return 'linux';
  if (s.includes('mingw') || s.includes('msys') || s.includes('cygwin') || s.includes('windows')) {
    return 'windows';
  }
  return 'unknown';
}

/** 通过 SSH 连接探测目标 OS */
export async function probeOS(conn: SshConnection): Promise<DeployOS> {
  const uname = await conn.exec('uname -a');
  if (uname.code === 0 && uname.stdout.trim()) {
    return detectFromUname(uname.stdout);
  }
  const ver = await conn.exec('ver');
  if (ver.code === 0 && ver.stdout.trim()) {
    return 'windows';
  }
  return 'unknown';
}
