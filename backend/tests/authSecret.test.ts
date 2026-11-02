import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

/**
 * 服务端签名密钥持久化回归测试。
 *
 * 背景（真实缺陷）：secret 原本每次进程启动随机生成，导致
 * 「backend 重启 → 所有已配对设备 token 失效 → 注册被拒，
 *  但心跳仍把设备刷成 online」的半失效状态。
 *
 * 修复：secret 落盘到 DB 同目录的 `.server-secret`，重启复用。
 *
 * 注意：auth.ts 在模块级缓存 serverSecret，且 config.dbPath 在导入时求值，
 * 所以每个用例用 vi.resetModules() 重新导入，才能模拟「进程重启」。
 */

const ORIGINAL_ENV = process.env.AGENTMESH_SECRET;

/**
 * 在指定目录下用「新进程」视角加载 auth 模块。
 *
 * 必须先 resetModules：config.dbPath 与 serverSecret 都是模块级求值/缓存，
 * 不复位就会复用上一个用例的路径与密钥。
 */
async function loadAuthWithDbPath(dbPath: string) {
  const { vi } = await import('vitest');
  vi.resetModules();
  process.env.DB_PATH = dbPath;
  const mod = await import('../src/security/auth.js');
  return mod;
}

describe('服务端签名密钥持久化', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-auth-'));
    dbPath = path.join(tmpDir, 'agentfleet.db');
    delete process.env.AGENTMESH_SECRET;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.DB_PATH;
    if (ORIGINAL_ENV === undefined) delete process.env.AGENTMESH_SECRET;
    else process.env.AGENTMESH_SECRET = ORIGINAL_ENV;
  });

  it('首次调用在 DB 同目录生成 .server-secret 且权限为 0600', async () => {
    const { getServerSecret } = await loadAuthWithDbPath(dbPath);
    const secret = getServerSecret();

    expect(secret).toHaveLength(64); // 32 字节 hex
    const file = path.join(tmpDir, '.server-secret');
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, 'utf-8').trim()).toBe(secret);

    // 权限：仅属主可读写（0o600）
    const mode = fs.statSync(file).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('模拟进程重启：新模块实例复用同一 secret（旧 token 不失效）', async () => {
    const first = await loadAuthWithDbPath(dbPath);
    const secret1 = first.getServerSecret();
    const token = first.issueToken('dev-restart');

    // 模拟重启：清模块缓存后重新加载，等同于新进程
    const { vi } = await import('vitest');
    vi.resetModules();
    const second = await loadAuthWithDbPath(dbPath);
    const secret2 = second.getServerSecret();

    expect(secret2).toBe(secret1);
    // 关键断言：重启前签发的 token 在重启后依然有效
    expect(second.verifyToken('dev-restart', token)).toBe(true);
  });

  it('未持久化时（旧行为）token 会在重启后失效 —— 证明修复必要性', async () => {
    // 用两个完全独立的目录模拟「旧实现的每次随机」
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'af-auth-a-'));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'af-auth-b-'));
    try {
      const a = await loadAuthWithDbPath(path.join(dirA, 'db.sqlite'));
      const tokenFromA = a.issueToken('dev-x');

      const { vi } = await import('vitest');
      vi.resetModules();
      const b = await loadAuthWithDbPath(path.join(dirB, 'db.sqlite'));

      // 不同密钥 → 互相不认，这正是「重启后设备全掉线」的机制
      expect(b.verifyToken('dev-x', tokenFromA)).toBe(false);
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });

  it('环境变量 AGENTMESH_SECRET 优先于落盘文件', async () => {
    const { vi } = await import('vitest');
    vi.resetModules();
    process.env.AGENTMESH_SECRET = 'env-secret-should-win-over-file';
    try {
      const { getServerSecret } = await loadAuthWithDbPath(dbPath);
      expect(getServerSecret()).toBe('env-secret-should-win-over-file');
      // 走 env 时不应创建密钥文件
      expect(fs.existsSync(path.join(tmpDir, '.server-secret'))).toBe(false);
    } finally {
      delete process.env.AGENTMESH_SECRET;
    }
  });

  it('密钥文件损坏时重新生成，不抛错', async () => {
    const file = path.join(tmpDir, '.server-secret');
    fs.writeFileSync(file, 'too-short');

    const { getServerSecret } = await loadAuthWithDbPath(dbPath);
    const secret = getServerSecret();

    expect(secret).toHaveLength(64);
    expect(fs.readFileSync(file, 'utf-8').trim()).toBe(secret);
  });

  it('token 签名与校验闭环：错误 deviceId 或篡改签名都不通过', async () => {
    const { issueToken, verifyToken } = await loadAuthWithDbPath(dbPath);
    const token = issueToken('dev-ok');

    expect(verifyToken('dev-ok', token)).toBe(true);
    expect(verifyToken('dev-other', token)).toBe(false);
    expect(verifyToken('dev-ok', `${token}tampered`)).toBe(false);
    expect(verifyToken('dev-ok', '')).toBe(false);
    expect(verifyToken('dev-ok', 'dev-ok')).toBe(false);
  });

  it('签名是 HMAC-SHA256(secret, deviceId) 的 base64url 编码', async () => {
    const { getServerSecret, issueToken } = await loadAuthWithDbPath(dbPath);
    const secret = getServerSecret();
    const token = issueToken('dev-hmac');

    const [id, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', secret).update('dev-hmac').digest('base64url');

    expect(id).toBe('dev-hmac');
    expect(sig).toBe(expected);
  });
});
