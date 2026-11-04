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
          label="估算成本"
          value={summary ? `$${summary.totalCost.toFixed(4)}` : '—'}
        />
      </div>

      {/* 按 Provider 成本明细（P2-11：钱花在哪个 Provider） */}
      {summary && Object.keys(summary.byProvider).length > 0 && (
        <Card className="p-0">
          <div className="border-b border-[#E2E8F0] px-4 py-3 text-sm font-semibold text-[#0F172A]">
            按 Provider 用量与成本
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-[#F8FAFC] text-left text-xs text-[#64748B]">
                  <th className="px-3 py-2 font-medium">Provider</th>
                  <th className="px-3 py-2 font-medium">记录数</th>
                  <th className="px-3 py-2 font-medium">输入 tokens</th>
                  <th className="px-3 py-2 font-medium">输出 tokens</th>
                  <th className="px-3 py-2 font-medium">估算成本</th>
                  <th className="px-3 py-2 font-medium">占比</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(summary.byProvider)
                  .sort((a, b) => b[1].cost - a[1].cost)
                  .map(([provider, p]) => {
                    const share = summary.totalCost > 0 ? (p.cost / summary.totalCost) * 100 : 0;
                    return (
                      <tr key={provider} className="border-t border-[#E2E8F0]">
                        <td className="px-3 py-2 font-mono text-xs text-[#334155]">{provider}</td>
                        <td className="px-3 py-2 text-[#334155]">{p.records}</td>
                        <td className="px-3 py-2 text-[#334155]">{p.tokensIn}</td>
                        <td className="px-3 py-2 text-[#334155]">{p.tokensOut}</td>
                        <td className="px-3 py-2 font-medium text-[#4F46E5]">${p.cost.toFixed(4)}</td>
                        <td className="px-3 py-2 text-[#64748B]">{share.toFixed(1)}%</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

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
                <th className="px-3 py-2 font-medium">成本</th>
                <th className="px-3 py-2 font-medium">时间</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-[#94A3B8]">
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
                    <td className="px-3 py-2 text-[#334155]">
                      {r.cost != null ? `$${r.cost.toFixed(4)}` : '—'}
                    </td>
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
