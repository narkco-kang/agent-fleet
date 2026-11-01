import { useCallback, useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import type { DirectFreeSource } from '@agentmesh/shared';
import { routingApi, type AllFreeSourcesReport, type CheckinResult } from '../../api/routing';
import { Card } from '../common/Card';

/**
 * 免费源：直连目录 + 综合探测（网关 + 直连）+ 签到。
 */
const RATING_COLOR: Record<string, string> = {
  excellent: '#10B981',
  medium: '#F59E0B',
  poor: '#EF4444',
};

export function FreeSourceTab(): JSX.Element {
  const [catalog, setCatalog] = useState<DirectFreeSource[]>([]);
  const [report, setReport] = useState<AllFreeSourcesReport | null>(null);
  const [checkin, setCheckin] = useState<CheckinResult[] | null>(null);
  const [checkinStatus, setCheckinStatus] = useState<Array<{ id: string; name: string; enabled: boolean; note: string; last?: { status?: string; detail?: string; checked_at?: number } | null }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    routingApi
      .freeSourceCatalog()
      .then((r) => setCatalog(r.data))
      .catch(() => setCatalog([]));
    routingApi
      .checkinStatus()
      .then((r) => setCheckinStatus(r.data.sources as typeof checkinStatus))
      .catch(() => setCheckinStatus([]));
  }, []);

  const probeAll = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await routingApi.probeAll();
      setReport(r.data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  const doCheckin = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await routingApi.checkin();
      setCheckin(r.data);
      const s = await routingApi.checkinStatus();
      setCheckinStatus(s.data.sources as typeof checkinStatus);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Button size="small" variant="contained" onClick={probeAll} disabled={busy}>
          {busy ? '探测中…' : '综合探测（网关 + 直连）'}
        </Button>
        <Button size="small" color="inherit" onClick={doCheckin} disabled={busy}>
          手动签到
        </Button>
      </div>
      {error && <div className="rounded-md bg-[#FEE2E2] px-3 py-2 text-xs text-[#B91C1C]">{error}</div>}

      <Card className="p-4">
        <div className="mb-2 text-sm font-semibold text-[#0F172A]">自动签到源</div>
        <div className="grid gap-2 md:grid-cols-2">
          {checkinStatus.map((s) => (
            <div key={s.id} className="rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium text-[#334155]">{s.name}</span>
                <span className={s.enabled ? 'text-[#10B981]' : 'text-[#94A3B8]'}>{s.enabled ? '启用' : '未配置'}</span>
              </div>
              <div className="mt-1 text-xs text-[#64748B]">{s.note}</div>
              <div className="mt-1 text-xs text-[#64748B]">
                最近：{s.last ? `${s.last.status} · ${s.last.detail ?? ''}` : '暂无记录'}
              </div>
            </div>
          ))}
          {checkinStatus.length === 0 && <div className="text-sm text-[#94A3B8]">暂无签到源状态</div>}
        </div>
      </Card>

      {report && (
        <Card className="p-4">
          <div className="mb-2 text-sm font-semibold text-[#0F172A]">
            可用源（仅优/中，优在前）· 共 {report.usable.length} 条可用
          </div>
          {report.ranked.length === 0 ? (
            <div className="text-sm text-[#94A3B8]">暂无可保留（优/中）的免费源</div>
          ) : (
            <div className="flex flex-col gap-2">
              {report.ranked.map((r) => (
                <div key={r.key} className="flex items-center gap-2 rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: RATING_COLOR[r.rating] }} />
                  <span className="text-[#334155]">{r.label}</span>
                  <span className="text-xs text-[#64748B]">({r.kind})</span>
                  <span className="text-xs text-[#64748B]">{r.latencyMs}ms</span>
                  <span className="ml-auto text-xs font-medium" style={{ color: RATING_COLOR[r.rating] }}>
                    {r.ratingLabel}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <Card className="p-4">
        <div className="mb-2 text-sm font-semibold text-[#0F172A]">直连免费源目录</div>
        <div className="flex flex-col gap-3">
          {catalog.map((s) => (
            <div key={s.id} className="rounded-lg border border-[#E2E8F0] px-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-semibold text-[#0F172A]">{s.label}</span>
                <span className="text-xs text-[#64748B]">{s.id}</span>
                <span className="ml-auto text-xs text-[#64748B]">
                  {s.auth === 'bearer-public' ? 'Bearer public' : '免 Key'}
                </span>
              </div>
              <div className="mt-1 text-xs text-[#64748B]">
                模型：{s.models.join(', ')} · 基础地址：{s.baseUrl}
              </div>
              <div className="mt-1 text-xs text-[#64748B]">{s.note}</div>
            </div>
          ))}
        </div>
      </Card>

      {checkin && (
        <Card className="p-4">
          <div className="mb-2 text-sm font-semibold text-[#0F172A]">签到结果</div>
          {checkin.map((c) => (
            <div key={c.sourceId} className="flex items-center justify-between py-1 text-sm">
              <span className="text-[#334155]">{c.name}</span>
              <span className={c.ok ? 'text-[#10B981]' : 'text-[#EF4444]'}>
                {c.ok ? '✅' : '❌'} {c.detail}
              </span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
