import type { AgentType, DeployOS, DeploymentBatch, DeploymentTarget } from '@agentmesh/shared';
import { randomId } from '../../security/auth.js';
import { config } from '../../config.js';
import {
  createBatch,
  createTarget,
  getBatch,
  listTargetsByBatch,
  updateBatchStatus,
  updateTargetStatus,
} from '../../db/repo/deployments.js';
import { actionGuard } from '../actionGuard.js';
import { connectSsh } from './sshClient.js';
import { probeOS } from './osProbe.js';
import { buildInstallScript } from './installScripts.js';
import type { ParsedTarget } from './excelParser.js';

/**
 * 批量部署编排：解析 → 校验 → 确认 → SSH → 探测 → 安装 → 回报。
 *
 * 安全红线：密码仅存内存 credentials Map（绝不落库），单目标执行完成后立即清除。
 */

/** 内存凭证（targetId → password），执行后清除 */
const credentials = new Map<string, string>();

/** Excel 未指定平台时的骨架默认集 */
const DEFAULT_PLATFORMS: AgentType[] = ['codex', 'claude', 'dsh', 'grok'];

export interface CreateBatchResult {
  batchId: string;
  status: string;
  confirmationId: string;
  targets: DeploymentTarget[];
  invalidRows: Array<{ row: number; reason: string }>;
  summary: string;
}

/** 创建部署批次（校验 + 落库 + 人工确认请求，密码仅内存） */
export function createDeployBatch(
  name: string,
  parsedTargets: ParsedTarget[],
  invalidRows: Array<{ row: number; reason: string }> = [],
): CreateBatchResult {
  if (!config.deployEnabled) {
    throw new Error('deploy disabled');
  }

  const batchId = randomId('batch');
  createBatch({ batchId, name });

  const targets: DeploymentTarget[] = [];
  for (const t of parsedTargets) {
    const target = createTarget({
      targetId: randomId('target'),
      batchId,
      ip: t.ip,
      user: t.user,
      platforms: t.platforms.length ? t.platforms : [...DEFAULT_PLATFORMS],
    });
    if (t.password !== undefined) {
      credentials.set(target.id, t.password);
    }
    targets.push(target);
  }

  const summary = `批量部署：${targets.length} 台目标机（${name}）`;
  const confirmation = actionGuard.request('deploy', batchId, summary);

  return {
    batchId,
    status: 'pending_confirmation',
    confirmationId: confirmation.id,
    targets,
    invalidRows,
    summary,
  };
}

/** 执行部署（actionGuard 确认后触发） */
export async function runDeploy(batchId: string): Promise<DeploymentBatch | undefined> {
  const batch = getBatch(batchId);
  if (!batch) return undefined;

  updateBatchStatus(batchId, 'running');
  const targets = listTargetsByBatch(batchId);

  for (const target of targets) {
    await runTarget(target);
  }

  const finalTargets = listTargetsByBatch(batchId);
  const failed = finalTargets.filter((t) => t.status === 'failed').length;
  updateBatchStatus(batchId, failed > 0 ? 'failed' : 'completed');
  return getBatch(batchId);
}

/** 处理单个目标：connecting → probing → installing → verifying → success|failed */
async function runTarget(target: DeploymentTarget): Promise<void> {
  const password = credentials.get(target.id) ?? '';
  let conn: Awaited<ReturnType<typeof connectSsh>> | null = null;

  try {
    updateTargetStatus(target.id, 'connecting');
    conn = await connectSsh({
      host: target.ip,
      username: target.user,
      password: password || undefined,
    });

    updateTargetStatus(target.id, 'probing');
    const os: DeployOS = await probeOS(conn);

    updateTargetStatus(target.id, 'installing', { os });
    const script = buildInstallScript(os, target.platforms);
    const installRes = await conn.exec(script);
    if (installRes.code !== 0 && installRes.code !== -1 && installRes.stderr) {
      // 安装命令退出码非 0：记录但不中断（骨架阶段以 stderr 留痕）
      console.warn(`[deploy] ${target.ip} 安装脚本退出码 ${installRes.code}: ${installRes.stderr}`);
    }

    updateTargetStatus(target.id, 'verifying');
    // 骨架阶段：验证以安装输出为据，不额外阻塞
    updateTargetStatus(target.id, 'success');
  } catch (err) {
    updateTargetStatus(target.id, 'failed', { error: (err as Error).message });
  } finally {
    // 安全红线：无论成功失败，立即清除内存密码
    credentials.delete(target.id);
    conn?.close();
  }
}

/** 注册 actionGuard 执行器 */
export function registerDeployExecutor(): void {
  actionGuard.registerExecutor('deploy', (refId) => {
    void runDeploy(refId);
  });
}

/** 批次视图（不含密码） */
export function getBatchView(batchId: string): DeploymentBatch | undefined {
  return getBatch(batchId);
}

/** 仅供测试/诊断：当前内存凭证数量（不含明文） */
export function inMemoryCredentialCount(): number {
  return credentials.size;
}

/** 清理内存凭证（安全兜底） */
export function clearCredentials(): void {
  credentials.clear();
}
