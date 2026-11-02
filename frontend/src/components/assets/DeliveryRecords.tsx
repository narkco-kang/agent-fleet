import { useCallback, useEffect, useState } from 'react';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import RefreshIcon from '@mui/icons-material/Refresh';
import type { AssetDelivery } from '@agentfleet/shared';
import { assetsApi } from '../../api/assets';
import { Card } from '../common/Card';
import { useT, useLanguageStore } from '../../i18n';

const STATUS_KEY: Record<string, string> = {
  pending: 'records.status.pending',
  confirmed: 'records.status.confirmed',
  sending: 'records.status.sending',
  delivered: 'records.status.delivered',
  failed: 'records.status.failed',
};

const STATUS_CLS: Record<string, string> = {
  pending: 'bg-[#F1F5F9] text-[#475569]',
  confirmed: 'bg-[#EEF2FF] text-[#4F46E5]',
  sending: 'bg-[#FEF3C7] text-[#B45309]',
  delivered: 'bg-[#D1FAE5] text-[#047857]',
  failed: 'bg-[#FEE2E2] text-[#B91C1C]',
};

function fmtTime(ts: number, language: 'zh' | 'en'): string {
  return new Date(ts).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US', { hour12: false });
}

/**
 * 资产分发记录：可折叠区域，展示 assetId → deviceId、状态、时间、错误。
 */
export function DeliveryRecords({ refreshKey }: { refreshKey: number }): JSX.Element {
  const t = useT();
  const language = useLanguageStore((s) => s.language);
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
          {t('records.title')}（{deliveries.length}）
        </button>
        <button
          onClick={fetchRecords}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[#4F46E5] hover:bg-[#EEF2FF]"
        >
          <RefreshIcon fontSize="small" /> {t('records.refresh')}
        </button>
      </div>

      {open && (
        <div className="overflow-x-auto">
          {error && <div className="px-4 py-3 text-xs text-[#B91C1C]">{error}</div>}
          {!error && loading && (
            <div className="px-4 py-4 text-center text-sm text-[#94A3B8]">{t('common.loading')}</div>
          )}
          {!error && !loading && (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-[#F8FAFC] text-left text-xs text-[#64748B]">
                  <th className="px-4 py-2 font-medium">{t('records.assetId')}</th>
                  <th className="px-4 py-2 font-medium">{t('records.deviceId')}</th>
                  <th className="px-4 py-2 font-medium">{t('records.version')}</th>
                  <th className="px-4 py-2 font-medium">{t('records.status')}</th>
                  <th className="px-4 py-2 font-medium">{t('records.createdAt')}</th>
                  <th className="px-4 py-2 font-medium">{t('records.error')}</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-[#94A3B8]">
                      {t('records.empty')}
                    </td>
                  </tr>
                ) : (
                  deliveries.map((d) => {
                    const cls = STATUS_CLS[d.status] ?? 'bg-[#F1F5F9] text-[#475569]';
                    const labelKey = STATUS_KEY[d.status] ?? d.status;
                    return (
                      <tr key={d.id} className="border-t border-[#E2E8F0]">
                        <td className="px-4 py-2 font-mono text-xs text-[#334155]">{d.assetId}</td>
                        <td className="px-4 py-2 font-mono text-xs text-[#334155]">{d.deviceId}</td>
                        <td className="px-4 py-2 text-[#334155]">v{d.assetVersion}</td>
                        <td className="px-4 py-2">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
                            {t(labelKey)}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-[#64748B]">{fmtTime(d.createdAt, language)}</td>
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
