import { useCallback, useEffect, useState } from 'react';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import RefreshIcon from '@mui/icons-material/Refresh';
import type { AssetDelivery } from '@agentfleet/shared';
import { assetsApi } from '../../api/assets';
import { Card } from '../common/Card';

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: '待补发', cls: 'bg-[#F1F5F9] text-[#475569]' },
  confirmed: { label: '已确认', cls: 'bg-[#EEF2FF] text-[#4F46E5]' },
  sending: { label: '发送中', cls: 'bg-[#FEF3C7] text-[#B45309]' },
  delivered: { label: '已送达', cls: 'bg-[#D1FAE5] text-[#047857]' },
  failed: { label: '失败', cls: 'bg-[#FEE2E2] text-[#B91C1C]' },
};

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

/**
 * 资产分发记录：可折叠区域，展示 assetId → deviceId、状态、时间、错误。
 */
export function DeliveryRecords({ refreshKey }: { refreshKey: number }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [deliveries, setDeliveries] = useState<AssetDelivery[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRecords = useCallback((): void => {
    setLoading(true);
    setError(null);
    assetsApi
      .listDeliveries()
      .then((r) => setDeliveries(r.data))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords, refreshKey]);

  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b border-[#E2E8F0] px-4 py-3">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 text-sm font-semibold text-[#0F172A]"
        >
          {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          分发记录（{deliveries.length}）
        </button>
        <button
          onClick={fetchRecords}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[#4F46E5] hover:bg-[#EEF2FF]"
        >
          <RefreshIcon fontSize="small" /> 刷新
        </button>
      </div>

      {open && (
        <div className="overflow-x-auto">
          {error && <div className="px-4 py-3 text-xs text-[#B91C1C]">{error}</div>}
          {!error && loading && (
            <div className="px-4 py-4 text-center text-sm text-[#94A3B8]">加载中…</div>
          )}
          {!error && !loading && (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-[#F8FAFC] text-left text-xs text-[#64748B]">
                  <th className="px-4 py-2 font-medium">资产 ID</th>
                  <th className="px-4 py-2 font-medium">设备 ID</th>
                  <th className="px-4 py-2 font-medium">版本</th>
                  <th className="px-4 py-2 font-medium">状态</th>
                  <th className="px-4 py-2 font-medium">创建时间</th>
                  <th className="px-4 py-2 font-medium">错误</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-[#94A3B8]">
                      暂无分发记录
                    </td>
                  </tr>
                ) : (
                  deliveries.map((d) => {
                    const meta = STATUS_META[d.status] ?? {
                      label: d.status,
                      cls: 'bg-[#F1F5F9] text-[#475569]',
                    };
                    return (
                      <tr key={d.id} className="border-t border-[#E2E8F0]">
                        <td className="px-4 py-2 font-mono text-xs text-[#334155]">{d.assetId}</td>
                        <td className="px-4 py-2 font-mono text-xs text-[#334155]">{d.deviceId}</td>
                        <td className="px-4 py-2 text-[#334155]">v{d.assetVersion}</td>
                        <td className="px-4 py-2">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.cls}`}>
                            {meta.label}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-[#64748B]">{fmtTime(d.createdAt)}</td>
                        <td className="px-4 py-2 text-[#B91C1C]">{d.error ?? '—'}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Card>
  );
}
