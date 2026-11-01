import { useCallback, useEffect, useState } from 'react';
import BuildIcon from '@mui/icons-material/Build';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import HealthAndSafetyIcon from '@mui/icons-material/HealthAndSafety';
import { gatewayApi, type GatewayComponentStatus } from '../../api/gateway';
import { Card } from '../common/Card';

/**
 * 协调器组件（内置 modelgateway）部署面板：状态 + build/start/stop/health。
 * 进度轮询 4s（决策已定，不新增 WS）。
 */

const STATE_META: Record<string, { label: string; color: string }> = {
  stopped: { label: '未启动', color: '#94A3B8' },
  building: { label: '编译中', color: '#F59E0B' },
  starting: { label: '启动中', color: '#F59E0B' },
  running: { label: '运行中', color: '#10B981' },
  failed: { label: '失败', color: '#EF4444' },
};

export function GatewayComponentPanel(): JSX.Element {
  const [status, setStatus] = useState<GatewayComponentStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    gatewayApi
      .status()
      .then((r) => setStatus(r.data))
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 4000);
    return () => clearInterval(timer);
  }, [refresh]);

  const act = async (fn: () => Promise<{ data: GatewayComponentStatus }>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      setStatus(r.data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const meta = STATE_META[status?.state ?? 'stopped'] ?? STATE_META.stopped;

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[#0F172A]">协调器组件（内置 modelgateway）</span>
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
            style={{ background: `${meta.color}1A`, color: meta.color }}
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
            {meta.label}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => act(() => gatewayApi.build())}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1.5 text-xs font-medium text-[#334155] hover:bg-[#F8FAFC] disabled:opacity-50"
          >
            <BuildIcon fontSize="small" /> 编译
          </button>
          <button
            onClick={() => act(() => gatewayApi.start())}
            disabled={busy || status?.state === 'running'}
            className="inline-flex items-center gap-1 rounded-lg bg-[#10B981] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#059669] disabled:opacity-50"
          >
            <PlayArrowIcon fontSize="small" /> 启动
          </button>
          <button
            onClick={() => act(() => gatewayApi.stop())}
            disabled={busy || status?.state !== 'running'}
            className="inline-flex items-center gap-1 rounded-lg bg-[#EF4444] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#DC2626] disabled:opacity-50"
          >
            <StopIcon fontSize="small" /> 停止
          </button>
          <button
            onClick={() => act(() => gatewayApi.health())}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1.5 text-xs font-medium text-[#334155] hover:bg-[#F8FAFC] disabled:opacity-50"
          >
            <HealthAndSafetyIcon fontSize="small" /> 健康
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
        <Info label="PID" value={status?.pid != null ? String(status.pid) : '—'} />
        <Info label="已编译" value={status?.built ? '✅ 是' : '否'} />
        <Info label="健康" value={status?.healthy ? '✅ 是' : '否'} />
        <Info label="Provider 数" value={status ? String(status.providerCount) : '—'} />
        <Info label="版本" value={status?.version ?? '0.1.0'} />
      </div>

      {status?.lastError && (
        <div className="mt-2 rounded-md bg-[#FEE2E2] px-3 py-2 text-xs text-[#B91C1C]">
          {status.lastError}
        </div>
      )}
      {error && (
        <div className="mt-2 rounded-md bg-[#FEE2E2] px-3 py-2 text-xs text-[#B91C1C]">{error}</div>
      )}
    </Card>
  );
}

function Info({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <div className="text-xs text-[#94A3B8]">{label}</div>
      <div className="mt-0.5 text-[#334155]">{value}</div>
    </div>
  );
}
