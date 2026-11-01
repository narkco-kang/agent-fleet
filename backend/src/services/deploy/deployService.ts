import type { DeployOS, DeploymentBatch, DeploymentTarget } from '@agentmesh/shared';
import { randomId } from '../../security/auth.js';
import { config } from '../../config.js';
import {
  createBatch,
  createTarget,
  getBatch,
  listTargetsByBatch,
  updateBatchStatus,
  updateTargetPlan,
  updateTargetStatus,
} from '../../db/repo/deployments.js';
import { actionGuard } from '../actionGuard.js';
import { connectSsh } from './sshClient.js';
import { probeOS } from './osProbe.js';
import {
  adaptPlatformsForOS,
  buildInstallScript,
  buildUninstallScript,
  parseInstallVerification,
  parseUninstallVerification,
} from './installScripts.js';
import type { ParsedTarget } from './excelParser.js';
import { bindPlatformModels } from '../routing/platformModelService.js';

/**
 * 批量部署编排：解析 → 校验 → 确认 → SSH → 探测 → 安装 → 回报。
 *
 * 安全红线：密码仅存内存 credentials Map（绝不落库），单目标执行完成后立即清除。
 */

/** 内存凭证（targetId → password），执行后清除 */
const credentials = new Map<string, string>();

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
      port: t.port,
      deviceId: t.deviceId,
      platforms: t.platforms,
      modelConfigs: t.modelConfigs,
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

/** 创建卸载批次（同样密码仅内存、需人工确认） */
export function createUninstallBatch(
  name: string,
  parsedTargets: ParsedTarget[],
  invalidRows: Array<{ row: number; reason: string }> = [],
): CreateBatchResult {
  if (!config.deployEnabled) {
    throw new Error('deploy disabled');
  }

  const batchId = randomId('batch');
  createBatch({ batchId, name, kind: 'uninstall' });

  const targets: DeploymentTarget[] = [];
  for (const t of parsedTargets) {
    const target = createTarget({
      targetId: randomId('target'),
      batchId,
      ip: t.ip,
      user: t.user,
      port: t.port,
      deviceId: t.deviceId,
      platforms: t.platforms,
    });
    if (t.password !== undefined) credentials.set(target.id, t.password);
    targets.push(target);
  }

  const summary = `批量卸载：${targets.length} 台目标机（${name}）`;
  const confirmation = actionGuard.request('uninstall', batchId, summary);
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
  return runBatch(batchId, 'deploy');
}

/** 执行卸载（actionGuard 确认后触发） */
export async function runUninstall(batchId: string): Promise<DeploymentBatch | undefined> {
  return runBatch(batchId, 'uninstall');
}

async function runBatch(
  batchId: string,
  mode: 'deploy' | 'uninstall',
): Promise<DeploymentBatch | undefined> {
  const batch = getBatch(batchId);
  if (!batch) return undefined;

  updateBatchStatus(batchId, 'running');
  const targets = listTargetsByBatch(batchId);

  for (const target of targets) {
    await runTarget(target, mode);
  }

  const finalTargets = listTargetsByBatch(batchId);
  const failed = finalTargets.filter((t) => t.status === 'failed').length;
  updateBatchStatus(batchId, failed > 0 ? 'failed' : 'completed');
  return getBatch(batchId);
}

/** 处理单个目标：connecting → probing → installing → verifying → success|failed */
async function runTarget(
  target: DeploymentTarget,
  mode: 'deploy' | 'uninstall' = 'deploy',
): Promise<void> {
  const password = credentials.get(target.id) ?? '';
  let conn: Awaited<ReturnType<typeof connectSsh>> | null = null;

  try {
    updateTargetStatus(target.id, 'connecting');
    conn = await connectSsh({
      host: target.ip,
      port: target.port,
      username: target.user,
      password: password || undefined,
    });

    updateTargetStatus(target.id, 'probing');
    const os: DeployOS = await probeOS(conn);
    const adaptedPlatforms = adaptPlatformsForOS(os, target.platforms);
    updateTargetPlan(target.id, os, adaptedPlatforms);

    updateTargetStatus(target.id, 'installing', { os });
    const script =
      mode === 'uninstall'
        ? buildUninstallScript(os, adaptedPlatforms)
        : buildInstallScript(os, adaptedPlatforms);
    const execRes = await conn.exec(script);
    const combinedOutput = [execRes.stdout, execRes.stderr].filter(Boolean).join('\n');
    if (execRes.code !== 0 && execRes.code !== -1 && execRes.stderr) {
      // 命令退出码非 0：不中断，最终以逐平台 verify 标记为准。
      console.warn(
        `[${mode}] ${target.ip} 脚本退出码 ${execRes.code}: ${execRes.stderr}`,
      );
    }

    updateTargetStatus(target.id, 'verifying');
    const okSet = new Set(
      mode === 'uninstall'
        ? parseUninstallVerification(combinedOutput)
            .filter((v) => v.removed)
            .map((v) => v.platform)
        : parseInstallVerification(combinedOutput)
            .filter((v) => v.ok)
            .map((v) => v.platform),
    );
    const failed = adaptedPlatforms.filter((platform) => !okSet.has(platform));
    if (failed.length > 0) {
      updateTargetStatus(target.id, 'failed', {
        error:
          mode === 'uninstall'
            ? `still present: ${failed.join(', ')}`
            : `verification failed: ${failed.join(', ')}`,
      });
      return;
    }
    updateTargetStatus(target.id, 'success');

    // 部署完成即用：把「设备 + agent 平台」绑定到路由网关模型
    if (mode === 'deploy' && target.deviceId && target.modelConfigs?.length) {
      const bound = bindPlatformModels(target.deviceId, target.modelConfigs);
      if (bound > 0) {
        console.log(`[deploy] 已为 ${target.deviceId} 绑定 ${bound} 条平台模型（部署完成即用）`);
      }
    }
  } catch (err) {
    updateTargetStatus(target.id, 'failed', { error: (err as Error).message });
  } finally {
    // 安全红线：无论成功失败，立即清除内存密码
    credentials.delete(target.id);
    conn?.close();
  }
}

/** 注册 actionGuard 执行器（部署 + 卸载） */
export function registerDeployExecutor(): void {
  actionGuard.registerExecutor('deploy', (refId) => {
    void runDeploy(refId);
  });
  actionGuard.registerExecutor('uninstall', (refId) => {
    void runUninstall(refId);
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
