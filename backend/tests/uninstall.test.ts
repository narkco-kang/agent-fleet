import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initDatabase, closeDatabase, getDb } from '../src/db/database.js';
import { config } from '../src/config.js';
import { actionGuard } from '../src/services/actionGuard.js';
import { parseTargetsFromObjects } from '../src/services/deploy/excelParser.js';
import {
  clearCredentials,
  createUninstallBatch,
  getBatchView,
  inMemoryCredentialCount,
  registerDeployExecutor,
  runUninstall,
} from '../src/services/deploy/deployService.js';
import {
  buildUninstallPlanStep,
  buildUninstallScript,
  parseUninstallVerification,
} from '../src/services/deploy/installScripts.js';

let tmpDir: string;
const flush = (ms = 60) => new Promise<void>((resolve) => setTimeout(resolve, ms));

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentmesh-uninstall-'));
  config.dbPath = path.join(tmpDir, 'test.db');
  config.deployEnabled = true;
  config.actionGuardEnabled = true;
  config.sshConnectTimeoutMs = 800;
  initDatabase();
});

afterAll(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('一键卸载脚本（OS 自适应）', () => {
  it('Linux：npm/pipx 卸载命令 + 卸载后 removed 验证标记', () => {
    const script = buildUninstallScript('linux', ['codex', 'aider']);
    expect(script).toContain("npm uninstall -g '@openai/codex'");
    expect(script).toContain("pipx uninstall 'aider-chat'");
    expect(script).toContain('[agentmesh:unverify]');
    expect(script).not.toContain('example.com');
  });

  it('Windows：Encoded PowerShell + winget 卸载 GUI 平台', () => {
    const script = buildUninstallScript('windows', ['cursor']);
    expect(script).toMatch(/^powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand /);
    const encoded = script.split(' ').pop() as string;
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(decoded).toContain('winget uninstall --id Anysphere.Cursor --exact');
    expect(decoded).toContain('[agentmesh:unverify] platform=cursor');
  });

  it('macOS GUI 平台走 brew uninstall --cask', () => {
    const step = buildUninstallPlanStep('macos', 'windsurf');
    expect(step.method).toBe('brew-cask');
    expect(step.command).toContain('brew uninstall --cask');
  });

  it('无公开卸载器的平台标记 manual_required_uninstall', () => {
    expect(buildUninstallPlanStep('linux', 'dsh').command).toContain('manual_required_uninstall dsh');
    expect(buildUninstallPlanStep('linux', 'grok').command).toContain('manual_required_uninstall grok');
  });

  it('解析卸载验证：removed / still_present', () => {
    const out = [
      '[agentmesh:unverify] platform=codex status=removed',
      '[agentmesh:unverify] platform=aider status=still_present',
    ].join('\n');
    const res = parseUninstallVerification(out);
    expect(res).toHaveLength(2);
    expect(res.find((r) => r.platform === 'codex')?.removed).toBe(true);
    expect(res.find((r) => r.platform === 'aider')?.removed).toBe(false);
  });
});

describe('一键卸载批次（安全红线 + 执行）', () => {
  it('创建卸载批次：kind=uninstall、走 actionGuard、密码仅内存', () => {
    clearCredentials();
    const parsed = parseTargetsFromObjects([
      { ip: '127.0.0.1', user: 'root', password: 'topsecret', platforms: 'codex' },
    ]);
    const res = createUninstallBatch('qa-uninstall', parsed.targets, parsed.invalidRows);

    expect(res.status).toBe('pending_confirmation');
    expect(inMemoryCredentialCount()).toBe(1);
    expect(actionGuard.isConfirmed('uninstall', res.batchId)).toBe(false);
    expect(actionGuard.list({ kind: 'uninstall', refId: res.batchId })).toHaveLength(1);
    expect(getBatchView(res.batchId)?.kind).toBe('uninstall');

    const cols = (getDb().prepare('PRAGMA table_info(deployment_targets)').all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(cols).not.toContain('password');
  });

  it('runUninstall 回环执行：不崩溃、终态明确、执行后清除内存密码', async () => {
    clearCredentials();
    const parsed = parseTargetsFromObjects([
      { ip: '127.0.0.1', user: 'nobody', password: 'topsecret', platforms: 'codex' },
    ]);
    const res = createUninstallBatch('qa-uninstall-run', parsed.targets, parsed.invalidRows);
    const batch = await runUninstall(res.batchId);
    expect(batch).toBeDefined();
    expect(['completed', 'failed']).toContain(batch?.status);
    expect(['success', 'failed']).toContain(batch?.targets[0]?.status);
    expect(inMemoryCredentialCount()).toBe(0);
  });

  it('确认卸载批次触发 uninstall 执行器', async () => {
    registerDeployExecutor();
    clearCredentials();
    const parsed = parseTargetsFromObjects([
      { ip: '127.0.0.1', user: 'nobody', password: 'pw', platforms: 'codex' },
    ]);
    const res = createUninstallBatch('qa-uninstall-confirm', parsed.targets, parsed.invalidRows);
    const conf = actionGuard.confirm(res.confirmationId, 'qa');
    expect(conf?.status).toBe('executed');
    await flush(120);
    const batch = getBatchView(res.batchId);
    expect(['running', 'completed', 'failed']).toContain(batch?.status);
  });
});
