import { Client, type ConnectConfig } from 'ssh2';
import { config } from '../../config.js';

/**
 * ssh2 封装：connect / exec。
 * 连接失败（如本地回环无 SSH 服务）应 reject 而非崩溃，供 deployService 标记 failed。
 */

export interface SshExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface SshConnection {
  exec(command: string, timeoutMs?: number): Promise<SshExecResult>;
  close(): void;
}

export interface SshConnectOptions {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
}

/** 建立 SSH 连接 */
export function connectSsh(
  opts: SshConnectOptions,
  timeoutMs: number = config.sshConnectTimeoutMs,
): Promise<SshConnection> {
  return new Promise<SshConnection>((resolve, reject) => {
    const client = new Client();
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      client.end();
      reject(new Error('ssh_connect_timeout'));
    }, timeoutMs);

    client.on('ready', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exec: (command, execTimeoutMs = config.sshExecTimeoutMs) => execSsh(client, command, execTimeoutMs),
        close: () => client.end(),
      });
    });

    client.on('error', (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    const cfg: ConnectConfig = {
      host: opts.host,
      port: opts.port ?? 22,
      username: opts.username,
      readyTimeout: timeoutMs,
    };
    if (opts.password) cfg.password = opts.password;
    if (opts.privateKey) cfg.privateKey = opts.privateKey;

    client.connect(cfg);
  });
}

/** 在已建立连接上执行命令 */
function execSsh(client: Client, command: string, timeoutMs: number): Promise<SshExecResult> {
  return new Promise<SshExecResult>((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null;
    client.exec(command, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }
      let stdout = '';
      let stderr = '';

      timer = setTimeout(() => {
        stream.close();
        reject(new Error('ssh_exec_timeout'));
      }, timeoutMs);

      stream.on('data', (data: Buffer) => {
        stdout += data.toString('utf-8');
      });
      stream.stderr.on('data', (data: Buffer) => {
        stderr += data.toString('utf-8');
      });
      stream.on('close', (code: number | null) => {
        if (timer) clearTimeout(timer);
        resolve({ code: code ?? -1, stdout, stderr });
      });
      stream.on('error', (e: Error) => {
        if (timer) clearTimeout(timer);
        reject(e);
      });
    });
  });
}
