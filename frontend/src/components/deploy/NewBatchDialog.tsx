import { useEffect, useRef, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Checkbox from '@mui/material/Checkbox';
import type { DeploymentKind } from '@agentfleet/shared';
import { deployApi, type PlatformCatalogItem, type ProbeResult } from '../../api/deploy';

type CreateMode = 'manual' | 'excel' | 'json';

const MODE_LABELS: Record<CreateMode, string> = {
  manual: '手动目标',
  excel: 'Excel 批量',
  json: 'JSON 批量',
};

/** 解析端口输入：非法/越界返回 undefined */
function parsePort(raw: string): number | undefined {
  const n = parseInt(raw.trim(), 10);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : undefined;
}

/**
 * 新建部署/卸载批次：手动目标（平台批量勾选 + 已装识别）/ Excel 上传 / JSON 直传。
 */
export function NewBatchDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (summary: string) => void;
}): JSX.Element {
  const [mode, setMode] = useState<CreateMode>('manual');
  const [name, setName] = useState('deploy-batch');
  const [kind, setKind] = useState<DeploymentKind>('deploy');

  // 手动目标字段
  const [ip, setIp] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [port, setPort] = useState('22');

  // 平台目录 + 勾选
  const [platforms, setPlatforms] = useState<PlatformCatalogItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 探测结果
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);

  const [targetsJson, setTargetsJson] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    deployApi
      .listPlatforms()
      .then((r) => setPlatforms(r.data))
      .catch((err) => setError((err as Error).message));
  }, [open]);

  const togglePlatform = (p: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const selectAll = (): void => setSelected(new Set(platforms.map((p) => p.platform)));
  const clearAll = (): void => setSelected(new Set());
  const selectUninstalled = (): void => {
    const installedSet = new Set(probeResult?.installed ?? []);
    setSelected(new Set(platforms.filter((p) => !installedSet.has(p.platform)).map((p) => p.platform)));
  };

  const runProbe = async (): Promise<void> => {
    if (!ip.trim() || !user.trim()) {
      setProbeError('请先填写 IP 和用户名');
      return;
    }
    setProbing(true);
    setProbeError(null);
    try {
      const r = await deployApi.probeTarget({
        ip: ip.trim(),
        user: user.trim(),
        password: password || undefined,
        port: parsePort(port),
      });
      setProbeResult(r.data);
    } catch (err) {
      setProbeError((err as Error).message);
    } finally {
      setProbing(false);
    }
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'manual') {
        if (!ip.trim() || !user.trim()) {
          setError('请填写 IP 和用户名');
          return;
        }
        if (selected.size === 0) {
          setError('请至少勾选 1 个平台');
          return;
        }
        const targets = [
          {
            ip: ip.trim(),
            user: user.trim(),
            password: password || undefined,
            port: parsePort(port),
            platforms: Array.from(selected),
          },
        ];
        const result = await deployApi.createFromTargets(name, targets, kind);
        onCreated(result.data.summary);
        reset();
        onClose();
        return;
      }

      if (mode === 'excel') {
        const file = fileRef.current?.files?.[0];
        if (!file) {
          setError('请选择 Excel 文件');
          return;
        }
        const result =
          kind === 'uninstall'
            ? await deployApi.createUninstallExcel(file, name)
            : await deployApi.createExcel(file, name);
        onCreated(result.data.summary);
        reset();
        onClose();
        return;
      }

      // JSON 批量
      if (!targetsJson.trim()) {
        setError('请填写 JSON targets');
        return;
      }
      let targets: unknown[];
      try {
        const parsed = JSON.parse(targetsJson) as unknown;
        targets = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        setError('JSON 解析失败');
        return;
      }
      // 单个 target 未指定 platforms 时，用当前勾选的平台兜底填入
      const withFallback = targets.map((t) => {
        if (t && typeof t === 'object' && !Array.isArray(t)) {
          const obj = t as Record<string, unknown>;
          const hasPlatforms = Array.isArray(obj.platforms) && obj.platforms.length > 0;
          if (!hasPlatforms && selected.size > 0) {
            return { ...obj, platforms: Array.from(selected) };
          }
        }
        return t;
      });
      const result = await deployApi.createFromTargets(name, withFallback, kind);
      onCreated(result.data.summary);
      reset();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reset = (): void => {
    setName('deploy-batch');
    setKind('deploy');
    setMode('manual');
    setIp('');
    setUser('');
    setPassword('');
    setPort('22');
    setSelected(new Set());
    setProbeResult(null);
    setProbeError(null);
    setTargetsJson('');
    setError(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const platformGrid = (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-[#64748B]">选择平台</span>
        <div className="flex gap-2">
          <button type="button" onClick={selectAll} className="text-xs text-[#4F46E5] hover:underline">
            全选
          </button>
          <button type="button" onClick={clearAll} className="text-xs text-[#4F46E5] hover:underline">
            清空
          </button>
          {kind === 'deploy' && (
            <button
              type="button"
              onClick={selectUninstalled}
              className="text-xs text-[#4F46E5] hover:underline"
            >
              仅选未安装
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {platforms.map((p) => {
          const checked = selected.has(p.platform);
          const isInstalled = probeResult?.installed.includes(p.platform) ?? false;
          return (
            <label
              key={p.platform}
              className={`flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 ${
                checked ? 'border-[#4F46E5] bg-[#EEF2FF]' : 'border-[#E2E8F0] bg-white'
              }`}
            >
              <Checkbox
                size="small"
                checked={checked}
                onChange={() => togglePlatform(p.platform)}
                sx={{ padding: '2px' }}
              />
              <span className="truncate text-sm text-[#0F172A]">{p.displayName}</span>
              {isInstalled && (
                <span className="ml-auto rounded bg-[#DCFCE7] px-1.5 py-0.5 text-[10px] leading-4 text-[#15803D]">
                  已装
                </span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle className="text-[#0F172A]">新建部署批次</DialogTitle>
      <DialogContent>
        <div className="mt-1 flex flex-col gap-3">
          <div className="flex gap-1 rounded-lg bg-[#F1F5F9] p-1">
            {(Object.keys(MODE_LABELS) as CreateMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex-1 rounded-md px-2 py-1 text-sm ${
                  mode === m
                    ? 'bg-white text-[#4F46E5] shadow-sm'
                    : 'text-[#64748B] hover:text-[#334155]'
                }`}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>

          <TextField
            label="批次名称"
            size="small"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
          />
          <TextField
            label="类型"
            size="small"
            select
            value={kind}
            onChange={(e) => setKind(e.target.value as DeploymentKind)}
            fullWidth
          >
            <MenuItem value="deploy">一键部署</MenuItem>
            <MenuItem value="uninstall">一键卸载</MenuItem>
          </TextField>

          {mode === 'manual' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <TextField
                  label="IP"
                  size="small"
                  value={ip}
                  onChange={(e) => setIp(e.target.value)}
                  fullWidth
                />
                <TextField
                  label="用户名"
                  size="small"
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  fullWidth
                />
                <TextField
                  label="密码"
                  size="small"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  fullWidth
                />
                <TextField
                  label="端口"
                  size="small"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  fullWidth
                />
              </div>

              <div className="flex items-center gap-2">
                <Button size="small" variant="outlined" onClick={runProbe} disabled={probing}>
                  {probing ? '识别中…' : '自动识别已装平台'}
                </Button>
                {probeResult && (
                  <span className="text-xs text-[#64748B]">
                    目标 OS：{probeResult.os} · 已装 {probeResult.installed.length} 个
                  </span>
                )}
              </div>
              {probeError && (
                <div className="rounded-md bg-[#FEE2E2] px-3 py-2 text-xs text-[#B91C1C]">
                  {probeError}
                </div>
              )}

              {platformGrid}
            </>
          )}

          {mode === 'excel' && (
            <div>
              <div className="mb-1 text-xs text-[#64748B]">上传 Excel（.xlsx / .xls / .csv）</div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="text-sm" />
            </div>
          )}

          {mode === 'json' && (
            <>
              <div>
                <div className="mb-1 text-xs text-[#64748B]">
                  粘贴 JSON targets（单个 target 未填 platforms 时，将用下方勾选的平台兜底）
                </div>
                <TextField
                  placeholder='[{"ip":"192.168.1.10","user":"root","port":22,"platforms":["claude"]}]'
                  size="small"
                  multiline
                  minRows={4}
                  value={targetsJson}
                  onChange={(e) => setTargetsJson(e.target.value)}
                  fullWidth
                />
              </div>
              {platformGrid}
            </>
          )}

          {error && (
            <div className="rounded-md bg-[#FEE2E2] px-3 py-2 text-xs text-[#B91C1C]">{error}</div>
          )}
        </div>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit">
          取消
        </Button>
        <Button onClick={submit} disabled={busy} variant="contained">
          {busy ? '提交中…' : '创建'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
