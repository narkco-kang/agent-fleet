import { useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import type { PlatformModelBinding } from '@agentfleet/shared';
import { routingApi } from '../../api/routing';
import type { DeviceAgentSelection } from './DevicePlatformList';

/**
 * 平台模型绑定编辑器：为「设备 + agent 平台」配置经网关执行的模型。
 */
export function ModelEditorPanel({
  selected,
  bindings,
  onChanged,
}: {
  selected: DeviceAgentSelection | null;
  bindings: PlatformModelBinding[];
  onChanged: () => void;
}): JSX.Element {
  const [model, setModel] = useState('');
  const [fallbacks, setFallbacks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [switchTarget, setSwitchTarget] = useState('');

  const binding = selected
    ? bindings.find((b) => b.deviceId === selected.deviceId && b.agentType === selected.agentType)
    : undefined;

  useEffect(() => {
    setModel(binding?.model ?? '');
    setFallbacks((binding?.fallbacks ?? []).join(', '));
    setSwitchTarget(binding?.activeModel ?? '');
    setError(null);
  }, [selected, binding?.deviceId, binding?.agentType, binding?.model, binding?.activeModel]);

  if (!selected) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-[#94A3B8]">
        请在左侧选择「设备 + 平台」
      </div>
    );
  }

  const known = binding ? Array.from(new Set([binding.model, ...binding.fallbacks])) : [];

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const fallbackList = fallbacks
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      await routingApi.bindPlatformModel(selected.deviceId, selected.agentType, model.trim(), fallbackList);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const unbind = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await routingApi.unbindPlatformModel(selected.deviceId, selected.agentType);
      setModel('');
      setFallbacks('');
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-xs text-[#94A3B8]">绑定对象</div>
        <div className="text-sm font-semibold text-[#0F172A]">
          {selected.deviceId} / {selected.agentType}
        </div>
        {binding && (
          <div className="mt-1 text-xs text-[#64748B]">
            当前生效：{binding.activeModel} · 状态：{binding.state === 'ok' ? '健康' : '已降级'}
          </div>
        )}
      </div>

      <TextField
        label="主模型 ref（经 modelgateway 透传）"
        size="small"
        value={model}
        onChange={(e) => setModel(e.target.value)}
        placeholder="如 kimi/k3"
        fullWidth
      />
      <TextField
        label="兜底模型（逗号分隔）"
        size="small"
        value={fallbacks}
        onChange={(e) => setFallbacks(e.target.value)}
        placeholder="如 deepseek-chat, qwen-max"
        fullWidth
      />

      <div className="flex flex-wrap gap-2">
        <Button size="small" variant="contained" onClick={save} disabled={busy || !model.trim()}>
          保存绑定
        </Button>
        <Button size="small" color="error" onClick={unbind} disabled={busy || !binding}>
          解绑
        </Button>
        {binding && binding.state !== 'ok' && (
          <Button size="small" color="inherit" onClick={() => act(() => routingApi.resetPlatformModel(selected.deviceId, selected.agentType))} disabled={busy}>
            恢复健康
          </Button>
        )}
      </div>

      {known.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#64748B]">手动切换：</span>
          <select
            value={switchTarget}
            onChange={(e) => setSwitchTarget(e.target.value)}
            className="rounded-md border border-[#E2E8F0] px-2 py-1 text-sm text-[#334155]"
          >
            {known.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <Button
            size="small"
            color="inherit"
            disabled={busy || !switchTarget}
            onClick={() => act(() => routingApi.switchPlatformModel(selected.deviceId, selected.agentType, switchTarget))}
          >
            切换
          </Button>
        </div>
      )}

      {error && <div className="rounded-md bg-[#FEE2E2] px-3 py-2 text-xs text-[#B91C1C]">{error}</div>}
    </div>
  );
}
