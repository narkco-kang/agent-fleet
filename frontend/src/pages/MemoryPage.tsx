import { useCallback, useEffect, useState } from 'react';
import SearchIcon from '@mui/icons-material/Search';
import { memoryApi, type MemorySummary, type MemorySearchHit, type MemoryFacts } from '../api/memory';
import { Card } from '../components/common/Card';

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { hour12: false });
}

/**
 * 团队记忆页：账本摘要（区块/记忆条数/链头/完整性）+ 语义检索。
 */
export default function MemoryPage(): JSX.Element {
  const [summary, setSummary] = useState<MemorySummary | null>(null);
  const [facts, setFacts] = useState<MemoryFacts | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MemorySearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const refreshSummary = useCallback((): void => {
    memoryApi
      .summary()
      .then(setSummary)
      .catch(() => setSummary(null));
    memoryApi
      .facts()
      .then(setFacts)
      .catch(() => setFacts(null));
  }, []);

  useEffect(() => {
    refreshSummary();
    const timer = setInterval(refreshSummary, 5000);
    return () => clearInterval(timer);
  }, [refreshSummary]);

  const doSearch = async (): Promise<void> => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const r = await memoryApi.search(q, 20);
      setResults(r.data.data);
      setSearched(true);
    } catch (err) {
      window.alert((err as Error).message);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-[#0F172A]">团队记忆</h1>
        <p className="mt-1 text-sm text-[#64748B]">
          跨设备同步的记忆账本 —— 每台设备做过的任务、得出的结论，在这里可检索、可复用。
        </p>
      </div>

      {/* 账本摘要 */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs text-[#64748B]">区块数</div>
          <div className="text-2xl font-semibold text-[#0F172A]">{summary?.blocks ?? '—'}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-[#64748B]">记忆条数</div>
          <div className="text-2xl font-semibold text-[#0F172A]">{summary?.changes ?? '—'}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-[#64748B]">链头区块</div>
          <div className="text-2xl font-semibold text-[#0F172A]">#{summary?.tipIndex ?? '—'}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-[#64748B]">账本完整性</div>
          <div
            className={`text-lg font-semibold ${
              summary == null
                ? 'text-[#94A3B8]'
                : summary.healthy
                  ? 'text-[#059669]'
                  : 'text-[#DC2626]'
            }`}
          >
            {summary == null ? '加载中' : summary.healthy ? '健康 ✓' : '异常 ✗'}
          </div>
        </Card>
      </div>

      {summary?.error && (
        <div className="mb-4 rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-sm text-[#B91C1C]">
          账本校验异常：{summary.error}
        </div>
      )}

      {/* 记忆洞察（四层整合的 Semantic 层：统计事实 + 失败教训） */}
      {facts && facts.total > 0 && (
        <div className="mb-4 grid gap-3 md:grid-cols-2">
          <Card className="p-4">
            <div className="mb-2 text-sm font-semibold text-[#0F172A]">任务成功率</div>
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-semibold text-[#4F46E5]">
                {facts.successRate != null ? `${(facts.successRate * 100).toFixed(0)}%` : '—'}
              </span>
              <span className="text-xs text-[#64748B]">
                成功 {facts.completed} · 失败 {facts.failed} · 共 {facts.total}
              </span>
            </div>
            {Object.keys(facts.byAgent).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {Object.entries(facts.byAgent).map(([agent, n]) => (
                  <span
                    key={agent}
                    className="rounded-full bg-[#EEF2FF] px-2 py-0.5 text-xs text-[#4F46E5]"
                  >
                    {agent} ×{n}
                  </span>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-4">
            <div className="mb-2 text-sm font-semibold text-[#0F172A]">失败教训（可复用）</div>
            {facts.lessons.length === 0 ? (
              <div className="py-4 text-center text-xs text-[#94A3B8]">暂无失败记录</div>
            ) : (
              <div className="space-y-1.5">
                {facts.lessons.map((l, i) => (
                  <div
                    key={i}
                    className="rounded border border-[#FEE2E2] bg-[#FEF2F2] px-2.5 py-1.5 text-xs text-[#B91C1C]"
                  >
                    {l.note}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* 检索 */}
      <Card className="p-4">
        <div className="mb-3 flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void doSearch();
            }}
            placeholder="搜索团队记忆（任务、结论、教训…）"
            className="flex-1 rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm text-[#0F172A] outline-none focus:border-[#4F46E5]"
          />
          <button
            onClick={() => void doSearch()}
            disabled={searching}
            className="inline-flex items-center gap-1 rounded-lg bg-[#4F46E5] px-4 py-2 text-sm font-medium text-white hover:bg-[#4338CA] disabled:opacity-50"
          >
            <SearchIcon fontSize="small" /> {searching ? '搜索中' : '搜索'}
          </button>
        </div>

        {searched && (
          <div className="text-sm text-[#64748B]">找到 {results.length} 条相关记忆</div>
        )}

        <div className="mt-2 space-y-2">
          {results.length === 0 && searched && (
            <div className="py-8 text-center text-[#94A3B8]">没有匹配的记忆</div>
          )}
          {results.map((hit, i) => (
            <div
              key={`${hit.change.id}-${i}`}
              className="rounded-lg border border-[#E2E8F0] p-3 transition-colors hover:bg-[#F8FAFC]"
            >
              <div className="text-sm text-[#334155]">{hit.change.note}</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[#64748B]">
                {hit.change.status && (
                  <span className="rounded bg-[#EEF2FF] px-1.5 py-0.5 text-[#4F46E5]">
                    {hit.change.status}
                  </span>
                )}
                <span>{hit.change.by}</span>
                <span>{fmtTime(hit.change.at)}</span>
                <span className="ml-auto">相关度 {(hit.score * 100).toFixed(0)}%</span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
