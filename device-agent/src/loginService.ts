import { spawn, type ChildProcess } from 'node:child_process';
import type { AgentType, DeviceLoginChallenge, DeviceLoginResult } from '@agentfleet/shared';
import { findPlatformDef, type LoginSpec } from './adapters/platformCatalog.js';
import { findAdapter } from './adapters/index.js';

/**
 * 设备端登录授权服务（Device Auth Flow）。
 *
 * 看板授权中心的核心：协调器下发 device.login_request → 本服务在设备上执行平台的
 * device-auth 登录命令（headless，如 `codex login --device-auth`）→ 从 stdout 捕获
 * 浏览器授权 URL + 一次性 code → 回传 device.login_challenge → 用户在看板浏览器完成
 * 授权 → 进程轮询到授权成功（exit 0）→ 回传 device.login_result。
 *
 * 这样用户无需 SSH 到每台设备、也无需在设备上开浏览器，全部在看板统一完成。
 */

/** 通用 URL 提取（https 链接） */
const URL_RE = /(https?:\/\/[^\s"'`<>]+)/;
/** 通用一次性 code 提取（形如 XXXX-XXXXX，大写字母数字；不加 i 避免误匹配 command-line 之类小写单词） */
const CODE_RE = /([A-Z0-9]{4,}-[A-Z0-9]{4,})/;
/** code 15 分钟过期，超时即终止登录 */
const LOGIN_TIMEOUT_MS = 15 * 60 * 1000;

/** 从 CLI device-auth 输出中解析授权 URL + 一次性 code（供测试与 runLoginProcess 复用） */
export function parseLoginChallenge(
  text: string,
  urlPattern?: RegExp,
  codePattern?: RegExp,
): { url?: string; code?: string } {
  const url = (text.match(urlPattern ?? URL_RE) ?? [])[1];
  const code = (text.match(codePattern ?? CODE_RE) ?? [])[1];
  return { url, code };
}

/** 专用 Adapter 平台的登录规格（不在 platformCatalog 里，如 grok） */
const DEDICATED_LOGIN_SPEC: Record<string, LoginSpec> = {
  // grok 在项目里 = 「grok bot」（云端 agent 队友，专用 GrokAdapter 走 ACP `grok agent stdio`）。
  // 登录 = 网页授权（device-auth）：`grok login --device-auth` 输出授权 URL + 一次性码，
  // 用户从任意浏览器打开授权（看板展示 URL+code），登录后 grok 缓存 cached_token。
  // 注意：headless 可选 XAI_API_KEY 只是「替代认证」，不是 grok bot 的主要登录方式（用户明确纠正）。
  grok: { args: ['login', '--device-auth'], note: 'grok bot 网页授权登录：grok login --device-auth 输出授权 URL + 一次性码，浏览器授权后激活' },
};

export interface LoginHandle {
  cancel(): void;
}

export function startDeviceLogin(
  input: { deviceId: string; agentType: AgentType },
  onChallenge: (c: DeviceLoginChallenge) => void,
  onResult: (r: DeviceLoginResult) => void,
): LoginHandle {
  const def = findPlatformDef(input.agentType);
  const loginSpec = def?.loginSpec ?? DEDICATED_LOGIN_SPEC[input.agentType];
  const base = { deviceId: input.deviceId, agentType: input.agentType };

  console.log(`[login] 收到登录授权请求 ${input.deviceId}/${input.agentType}`);
  // 无 loginSpec（或仅 api-key 说明、无 device-auth args）→ 不支持看板授权
  if (!loginSpec?.args?.length) {
    onResult({ ...base, status: 'failed', message: loginSpec?.note ?? `该平台不支持登录授权（无 loginSpec）` });
    return { cancel: () => undefined };
  }

  // 探测可执行文件（登录只支持 catalog 平台；专用 Adapter 的登录方式另配）
  const adapter = findAdapter(input.agentType);
  const detection = adapter?.detect();
  if (!detection) {
    onResult({ ...base, status: 'failed', message: '未找到该平台的 Adapter' });
    return { cancel: () => undefined };
  }

  void detection.then((d) => {
    if (!d.found || !d.executable) {
      onResult({ ...base, status: 'failed', message: `未检测到 ${def?.displayName ?? input.agentType} 可执行文件` });
      return;
    }
    runLoginProcess(input, d.executable, loginSpec, onChallenge, onResult);
  });

  return { cancel: () => undefined };
}

function runLoginProcess(
  input: { deviceId: string; agentType: AgentType },
  executable: string,
  loginSpec: LoginSpec,
  onChallenge: (c: DeviceLoginChallenge) => void,
  onResult: (r: DeviceLoginResult) => void,
): void {
  const base = { deviceId: input.deviceId, agentType: input.agentType };
  let child: ChildProcess;
  try {
    child = spawn(executable, loginSpec.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    onResult({ ...base, status: 'failed', message: `启动登录失败: ${(err as Error).message}` });
    return;
  }

  let stdoutBuf = '';
  let challengeSent = false;
  let settled = false;

  const settle = (r: DeviceLoginResult): void => {
    if (settled) return;
    settled = true;
    onResult(r);
  };

  child.stdout?.on('data', (chunk: Buffer) => {
    stdoutBuf += chunk.toString('utf-8');
    if (challengeSent) return;
    const { url, code } = parseLoginChallenge(stdoutBuf, loginSpec.urlPattern, loginSpec.codePattern);
    if (url && code) {
      challengeSent = true;
      console.log(`[login] 已捕获授权挑战 ${url} code=${code}`);
      onChallenge({ ...base, url, code });
    }
  });

  child.on('error', (err) => {
    settle({ ...base, status: 'failed', message: `登录进程错误: ${err.message}` });
  });

  child.on('close', (exitCode) => {
    if (settled) return;
    // device-auth 授权成功后 CLI 保存凭据并 exit 0；非 0 = 授权失败/被拒
    if (exitCode === 0) {
      settle({ ...base, status: 'success' });
    } else {
      settle({ ...base, status: 'failed', message: `登录进程退出码 ${exitCode}` });
    }
  });

  const timer = setTimeout(() => {
    if (settled) return;
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    settle({ ...base, status: 'timeout', message: '授权超时（一次性码 15 分钟过期）' });
  }, LOGIN_TIMEOUT_MS);
  timer.unref();

  // 进程退出即清超时
  child.on('close', () => clearTimeout(timer));
}
