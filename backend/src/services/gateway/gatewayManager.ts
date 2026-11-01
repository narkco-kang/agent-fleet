import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../../config.js';
import { modelGatewayClient } from '../routing/modelGatewayClient.js';

/**
 * 协调器组件部署：内置 modelgateway 的本机 spawn 生命周期。
 *
 * - build()：spawn `npm run build --workspace modelgateway`（编译校验）
 * - start()：spawn tsx 运行 modelgateway 源码（detached，记 pid）
 * - stop()：SIGTERM 终止进程组
 * - health()：modelGatewayClient.health() + /health JSON 取 providerCount/version
 *
 * 语义分离：本模块只负责「协调器本机组件」，13 平台部署走 SSH（/api/deploy/*）。
 * 运行时用 tsx 运行源码（与 backend/device-agent/wechat 一致），
 * 因 shared exports 指向 src 且内部用 `.js` 扩展名导入，纯 node 无法解析 dist。
 */

export type GatewayComponentState = 'stopped' | 'building' | 'starting' | 'running' | 'failed';

export interface GatewayComponentStatus {
  state: GatewayComponentState;
  pid: number | null;
  built: boolean;
  healthy: boolean;
  providerCount: number;
  version: string;
  lastError: string | null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// backend/src/services/gateway → backend/src/services → backend/src → backend → monorepo 根
const rootDir = path.resolve(__dirname, '..', '..', '..', '..');
const gatewayEntry = path.join(rootDir, 'modelgateway', 'src', 'index.ts');
const tsxCli = path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');

class GatewayManager {
  private state: GatewayComponentState = 'stopped';
  private pid: number | null = null;
  private built = false;
  private healthy = false;
  private providerCount = 0;
  private version = '0.1.0';
  private lastError: string | null = null;
  private child: ChildProcess | null = null;

  getStatus(): GatewayComponentStatus {
    return {
      state: this.state,
      pid: this.pid,
      built: this.built,
      healthy: this.healthy,
      providerCount: this.providerCount,
      version: this.version,
      lastError: this.lastError,
    };
  }

  /** 编译 modelgateway（仅校验，运行时仍走 tsx 源码） */
  async build(): Promise<GatewayComponentStatus> {
    if (this.state === 'building') return this.getStatus();
    this.state = 'building';
    this.lastError = null;
    try {
      await this.runSpawn('npm', ['run', 'build', '--workspace', 'modelgateway']);
      this.built = true;
      this.state = this.healthy ? 'running' : 'stopped';
    } catch (err) {
      this.built = false;
      this.lastError = (err as Error).message;
      this.state = 'failed';
    }
    return this.getStatus();
  }

  /** 启动 modelgateway 子进程（detached，记 pid）并轮询健康 */
  async start(): Promise<GatewayComponentStatus> {
    if (this.state === 'running' || this.state === 'starting') {
      await this.refreshHealth();
      return this.getStatus();
    }
    this.state = 'starting';
    this.lastError = null;
    try {
      const child = spawn(process.execPath, [tsxCli, gatewayEntry], {
        cwd: rootDir,
        detached: true,
        stdio: 'ignore',
        env: process.env,
      });
      const childPid = child.pid ?? null;
      this.child = child;
      this.pid = childPid;

      child.on('exit', (code) => {
        if (this.pid === childPid) {
          this.pid = null;
          this.healthy = false;
          this.child = null;
          this.state = 'stopped';
          if (code !== 0 && code !== null) {
            this.lastError = `modelgateway exited with code ${code}`;
          }
        }
      });
      child.on('error', (err) => {
        this.lastError = err.message;
        this.healthy = false;
        this.state = 'failed';
      });

      await this.waitUntilHealthy(10_000);
      if (this.healthy) {
        this.state = 'running';
      } else {
        this.state = 'failed';
        this.lastError = this.lastError ?? 'modelgateway 启动后健康探测失败';
      }
    } catch (err) {
      this.lastError = (err as Error).message;
      this.state = 'failed';
    }
    return this.getStatus();
  }

  /** 停止 modelgateway 子进程（优先终止进程组） */
  async stop(): Promise<GatewayComponentStatus> {
    const pid = this.pid;
    if (pid) {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          // 进程已退出
        }
      }
    }
    this.pid = null;
    this.healthy = false;
    this.child = null;
    this.state = 'stopped';
    return this.getStatus();
  }

  /** 主动健康探测（刷新 providerCount/version） */
  async health(): Promise<GatewayComponentStatus> {
    await this.refreshHealth();
    return this.getStatus();
  }

  /** 后端启动后自动 spawn（MODELGATEWAY_AUTO_START=1） */
  async maybeAutoStart(): Promise<void> {
    if (process.env.MODELGATEWAY_AUTO_START !== '1') return;
    if (this.state === 'running' || this.state === 'starting') return;
    await this.start();
  }

  private async refreshHealth(): Promise<void> {
    const healthy = await modelGatewayClient.health();
    this.healthy = healthy;
    if (healthy) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), config.modelGatewayTimeoutMs);
        const res = await fetch(`${config.modelGatewayUrl.replace(/\/$/, '')}/health`, {
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
          const json = (await res.json()) as { version?: string; providers?: unknown[] };
          if (typeof json.version === 'string') this.version = json.version;
          if (Array.isArray(json.providers)) this.providerCount = json.providers.length;
        }
      } catch {
        // 保留 modelGatewayClient 探测结果（healthy 布尔）
      }
    }
  }

  private async waitUntilHealthy(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await this.refreshHealth();
      if (this.healthy) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  private runSpawn(cmd: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { cwd: rootDir, stdio: ['ignore', 'pipe', 'pipe'] });
      const stdout: string[] = [];
      const stderr: string[] = [];
      child.stdout?.on('data', (d: Buffer) => stdout.push(d.toString()));
      child.stderr?.on('data', (d: Buffer) => stderr.push(d.toString()));
      child.on('error', (err) => reject(err));
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          const tail = [...stderr, ...stdout].join('\n').trim().slice(-800);
          reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}${tail ? `\n${tail}` : ''}`));
        }
      });
    });
  }
}

/** 全局单例 */
export const gatewayManager = new GatewayManager();
