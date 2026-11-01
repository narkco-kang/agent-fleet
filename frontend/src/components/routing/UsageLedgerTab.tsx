import { useCallback, useEffect, useState } from 'react';
import { routingApi, type UsageRecordRow, type UsageSummary } from '../../api/routing';
import { Card } from '../common/Card';

/**
 * token 台账：总量摘要 + 明细记录。
 */
export function UsageLedgerTab(): JSX.Element {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [records, setRecords] = useState<UsageRecordRow[]>([]);

  const load = useCallback(() => {
    routingApi
      .usageSummary()
      .then((r) => setSummary(r.data))
      .catch(() => setSummary(null));
    routingApi
      .usageRecords()
      .then((r) => setRecords(r.data))
      .catch(() => setRecords([]));
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 8000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <StatCard label="记录数" value={summary ? String(summary.totalRecords) : '—'} />
        <StatCard label="输入 tokens" value={summary ? String(summary.totalTokensIn) : '—'} />
        <StatCard label="输出 tokens" value={summary ? String(summary.totalTokensOut) : '—'} />
        <StatCard
          label="Provider 数"
          value={summary ? String(Object.keys(summary.byProvider).length) : '—'}
        />
      </div>

      <Card className="p-0">
        <div className="border-b border-[#E2E8F0] px-4 py-3 text-sm font-semibold text-[#0F172A]">
          台账明细（最近 {records.length} 条）
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-[#F8FAFC] text-left text-xs text-[#64748B]">
                <th className="px-3 py-2 font-medium">Provider</th>
                <th className="px-3 py-2 font-medium">模型</th>
                <th className="px-3 py-2 font-medium">输入</th>
                <th className="px-3 py-2 font-medium">输出</th>
                <th className="px-3 py-2 font-medium">时间</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-[#94A3B8]">
                    暂无台账记录
                  </td>
                </tr>
              ) : (
                records.map((r) => (
                  <tr key={r.record_id} className="border-t border-[#E2E8F0]">
                    <td className="px-3 py-2 text-[#334155]">{r.provider ?? '—'}</td>
                    <td className="px-3 py-2 text-[#334155]">{r.model ?? '—'}</td>
                    <td className="px-3 py-2 text-[#334155]">{r.tokens_in ?? '—'}</td>
                    <td className="px-3 py-2 text-[#334155]">{r.tokens_out ?? '—'}</td>
                    <td className="px-3 py-2 text-[#64748B]">
                      {new Date(r.created_at).toLocaleString('zh-CN', { hour12: false })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <Card className="p-4">
      <div className="text-xs text-[#94A3B8]">{label}</div>
      <div className="mt-1 text-xl font-semibold text-[#0F172A]">{value}</div>
    </Card>
  );
}
