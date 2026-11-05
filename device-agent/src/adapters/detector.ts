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
  /** 按 OS 分组的候选路径（对齐 EchoBird paths.json；优先于 defaultDirs，支持 ~ 与 %VAR% 展开） */
  pathsByOS?: { win32?: string[]; darwin?: string[]; linux?: string[] };
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

  // 2) 按 OS 分组路径（优先于通用 defaultDirs，对齐 EchoBird paths.json 的 win32/darwin/linux）
  const osKey = os.platform() === 'win32' ? 'win32' : os.platform() === 'darwin' ? 'darwin' : 'linux';
  for (const p of probe.pathsByOS?.[osKey] ?? []) {
    const full = expandPath(p);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      return { found: true, executable: full, version: probeVersion(full, probe), detectMethod: 'default_dir' };
    }
  }

  // 3) 约定目录
  for (const dir of probe.defaultDirs) {
    const full = path.isAbsolute(dir) ? dir : path.join(os.homedir(), dir);
    const candidates = [full, path.join(full, probe.commands[0] ?? '')];
    for (const c of candidates) {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) {
        return { found: true, executable: c, version: probeVersion(c, probe), detectMethod: 'default_dir' };
      }
    }
  }

  // 4) npm 全局包
  for (const pkg of probe.npmPackages ?? []) {
    const found = findNpmGlobal(pkg, probe.commands[0] ?? '');
    if (found) {
      return { found: true, executable: found, version: probeVersion(found, probe), detectMethod: 'npm' };
    }
  }

  // 5) macOS /Applications（含 ~/Applications）
  for (const app of probe.appNames ?? []) {
    const found = findApp(app);
    if (found) {
      return { found: true, executable: found, version: readAppVersion(found), detectMethod: 'app' };
    }
  }

  return { found: false, executable: '', version: '', detectMethod: 'path' };
}

/** 展开路径里的 ~（home）与 %VAR%（Windows 环境变量，如 %APPDATA%） */
export function expandPath(p: string): string {
  let s = p;
  if (s === '~' || s.startsWith('~/')) s = path.join(os.homedir(), s.slice(2));
  if (os.platform() === 'win32') {
    s = s.replace(/%([^%]+)%/g, (_m, name: string) => process.env[name] ?? `%${name}%`);
  }
  return s;
}

/** which 探测（Windows 用 where，Unix 用 which） */
function tryWhich(cmd: string): string | null {
  try {
    const whichCmd = os.platform() === 'win32' ? 'where' : 'which';
    const out = execFileSync(whichCmd, [cmd], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (!out) return null;
    return preferExecutable(out.split(/\r?\n/), os.platform() === 'win32');
  } catch {
    return null;
  }
}

/**
 * 从 where/which 的多行输出里挑可执行文件。
 * Windows 的 where 会同时返回「无扩展名（Unix shell 脚本）」和「.cmd（Windows 批处理）」，
 * 必须优先 .cmd/.bat/.exe，否则 spawn 无扩展名脚本会 ENOENT（真实多机 benchmark 踩过）。
 */
export function preferExecutable(lines: string[], isWindows: boolean): string | null {
  const clean = lines.map((l) => l.trim()).filter(Boolean);
  if (clean.length === 0) return null;
  if (isWindows) {
    const exec = clean.find((l) => /\.(cmd|bat|exe)$/i.test(l));
    if (exec) return exec;
  }
  return clean[0];
}

/** npm 全局包探测：返回可执行文件路径 */
function findNpmGlobal(pkg: string, binName: string): string | null {
  try {
    const prefix = execFileSync('npm', ['prefix', '-g'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const pkgDir = path.join(root, pkg);
    if (!fs.existsSync(pkgDir) || !fs.statSync(pkgDir).isDirectory()) return null;
    // Unix：全局 bin 目录（prefix/bin/name）
    const exe = path.join(prefix, 'bin', binName);
    if (fs.existsSync(exe) && fs.statSync(exe).isFile()) return exe;
    // Windows：npm 全局 bin 是 prefix 下的 name.cmd / name（无 bin 子目录）
    if (os.platform() === 'win32') {
      const winCmd = path.join(prefix, `${binName}.cmd`);
      if (fs.existsSync(winCmd) && fs.statSync(winCmd).isFile()) return winCmd;
      const winExe = path.join(prefix, binName);
      if (fs.existsSync(winExe) && fs.statSync(winExe).isFile()) return winExe;
    }
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
    // Windows 的 .cmd/.bat 不能直接 execFileSync（会 ENOENT），须经 cmd.exe /c 包装
    // （与 cliRunner spawn 的坑一致，真机验证：否则版本显示 'unknown'）
    const isWindowsBatch = os.platform() === 'win32' && /\.(cmd|bat)$/i.test(executable);
    const out = (
      isWindowsBatch
        ? execFileSync('cmd.exe', ['/d', '/s', '/c', executable, ...probe.versionArgs], {
            encoding: 'utf-8',
            timeout: 5_000,
            stdio: ['ignore', 'pipe', 'ignore'],
          })
        : execFileSync(executable, probe.versionArgs, {
            encoding: 'utf-8',
            timeout: 5_000,
            stdio: ['ignore', 'pipe', 'ignore'],
          })
    )
      .toString()
      .trim();
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
