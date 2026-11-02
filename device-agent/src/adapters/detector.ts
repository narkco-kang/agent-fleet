import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentType, DetectMethod } from '@agentfleet/shared';

/**
 * 平台探测器：which/PATH → 约定目录 → npm 全局包 → macOS /Applications，
 * 逐级探测，命中即返回。版本探测失败不抛错（返回 'unknown'）。
 */
export interface DetectResult {
  found: boolean;
  executable: string;
  version: string;
  detectMethod: DetectMethod;
}

/** 各平台探测配置（由 platformCatalog 提供） */
export interface PlatformProbe {
  agentType: AgentType;
  /** 命令名（which/PATH 探测） */
  commands: string[];
  /** 约定目录候选（相对 home 或绝对路径） */
  defaultDirs: string[];
  /** npm 全局包名（如 @anthropic-ai/claude-code） */
  npmPackages?: string[];
  /** /Applications 下的 .app 名（不含 .app 后缀） */
  appNames?: string[];
  /** 版本探测参数 */
  versionArgs: string[];
  /** 版本输出解析 */
  parseVersion?: (stdout: string) => string;
}

/** 探测单平台（按 which → 目录 → npm → app 顺序） */
export function detectPlatform(probe: PlatformProbe): DetectResult {
  // 1) which / PATH
  for (const cmd of probe.commands) {
    const found = tryWhich(cmd);
    if (found) {
      return { found: true, executable: found, version: probeVersion(found, probe), detectMethod: 'which' };
    }
  }

  // 2) 约定目录
  for (const dir of probe.defaultDirs) {
    const full = path.isAbsolute(dir) ? dir : path.join(os.homedir(), dir);
    const candidates = [full, path.join(full, probe.commands[0] ?? '')];
    for (const c of candidates) {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) {
        return { found: true, executable: c, version: probeVersion(c, probe), detectMethod: 'default_dir' };
      }
    }
  }

  // 3) npm 全局包
  for (const pkg of probe.npmPackages ?? []) {
    const found = findNpmGlobal(pkg, probe.commands[0] ?? '');
    if (found) {
      return { found: true, executable: found, version: probeVersion(found, probe), detectMethod: 'npm' };
    }
  }

  // 4) macOS /Applications（含 ~/Applications）
  for (const app of probe.appNames ?? []) {
    const found = findApp(app);
    if (found) {
      return { found: true, executable: found, version: readAppVersion(found), detectMethod: 'app' };
    }
  }

  return { found: false, executable: '', version: '', detectMethod: 'path' };
}

/** which 探测 */
function tryWhich(cmd: string): string | null {
  try {
    const out = execFileSync('which', [cmd], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return out || null;
  } catch {
    return null;
  }
}

/** npm 全局包探测：返回可执行文件路径 */
function findNpmGlobal(pkg: string, binName: string): string | null {
  try {
    const prefix = execFileSync('npm', ['prefix', '-g'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const pkgDir = path.join(root, pkg);
    if (!fs.existsSync(pkgDir) || !fs.statSync(pkgDir).isDirectory()) return null;
    // 全局 bin 目录下的可执行文件
    const exe = path.join(prefix, 'bin', binName);
    if (fs.existsSync(exe) && fs.statSync(exe).isFile()) return exe;
    // 兜底 which（bin 目录可能不在当前 PATH 映射）
    return tryWhich(binName);
  } catch {
    return null;
  }
}

/** macOS 应用扫描（/Applications + ~/Applications） */
function findApp(appName: string): string | null {
  const candidates = [
    path.join('/Applications', `${appName}.app`),
    path.join(os.homedir(), 'Applications', `${appName}.app`),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/** 读 .app 版本（Info.plist CFBundleShortVersionString） */
function readAppVersion(appPath: string): string {
  try {
    const plist = path.join(appPath, 'Contents', 'Info.plist');
    const out = execFileSync('defaults', ['read', plist, 'CFBundleShortVersionString'], {
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || 'unknown';
  } catch {
    return 'unknown';
  }
}

/** 版本探测（失败返回 'unknown'，不抛错） */
function probeVersion(executable: string, probe: PlatformProbe): string {
  try {
    const out = execFileSync(executable, probe.versionArgs, {
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (probe.parseVersion) return probe.parseVersion(out);
    // 默认提取第一个 semver（形如 "codex 0.31.0" / "aider v0.75.0"）
    const m = out.match(/\d+\.\d+(\.\d+)?/);
    return m ? m[0] : firstLine(out);
  } catch {
    return 'unknown';
  }
}

function firstLine(s: string): string {
  return s.split('\n')[0]?.trim() ?? 'unknown';
}
