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

/**
 * 把底层 ssh2 错误映射成面向用户的友好中文提示。
 * 真实云服务器测试暴露：原始错误（如 "All configured authentication methods failed"、
 * "connect ECONNREFUSED x.x.x.x:22"）对普通用户不友好，据此做一次集中翻译。
 */
export function friendlySshError(err: Error, opts: SshConnectOptions): string {
  const msg = err.message ?? '';
  const host = opts.host ?? '';
  const port = opts.port ?? 22;

  if (msg === 'ssh_connect_timeout') {
    return `SSH 连接超时（${host}:${port}）：网络不可达或防火墙拦截`;
  }
  if (/All configured authentication methods failed/i.test(msg)) {
    return `SSH 认证失败（${opts.username}@${host}）：密码错误，或目标机未开启密码认证（PasswordAuthentication）`;
  }
  if (/ECONNREFUSED/i.test(msg)) {
    return `无法连接 SSH 端口 ${port}（${host}）：目标机未开启 SSH 服务。Windows 需先启用 OpenSSH Server，Linux 需安装并启动 openssh-server`;
  }
  if (/Permission denied/i.test(msg)) {
    return `SSH 密码被拒绝（${opts.username}@${host}）：请检查账号密码是否正确`;
  }
  if (/ECONNRESET|ECONNABORTED|socket hang up/i.test(msg)) {
    return `SSH 连接被重置（${host}:${port}）：可能是云安全组未放行 ${port} 端口，或 sshd 配置限制`;
  }
  if (/ENOTFOUND|getaddrinfo/i.test(msg)) {
    return `无法解析主机 ${host}：请检查 IP/域名是否正确`;
  }
  return `SSH 连接失败（${host}:${port}）：${msg}`;
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
