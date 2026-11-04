import { useCallback, useEffect, useState } from 'react';
import ExtensionIcon from '@mui/icons-material/Extension';
import { mcpApi, type McpServerStatus, type McpTool } from '../api/mcp';
import { Card } from '../components/common/Card';

/**
 * MCP 工具网关页（P2-9）：注册外部 MCP server（stdio/HTTP），发现并调用其工具。
 */

export default function McpPage(): JSX.Element {
  const [servers, setServers] = useState<McpServerStatus[]>([]);
  const [selected, setSelected] = useState<McpServerStatus | null>(null);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [callResult, setCallResult] = useState<string | null>(null);
  const [callArgs, setCallArgs] = useState('{}');
  const [activeTool, setActiveTool] = useState<string | null>(null);

  const load = useCallback(() => {
    mcpApi.list().then((r) => setServers(r.data)).catch(() => setServers([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    mcpApi.tools(selected.id).then((r) => setTools(r.data)).catch(() => setTools([]));
  }, [selected]);

  const register = async (): Promise<void> => {
    if (!name.trim()) return;
    if (!command.trim() && !url.trim()) {
      setError('command 或 url 必填其一');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await mcpApi.register({
        name: name.trim(),
        command: command.trim() || undefined,
        args: args.trim() ? args.trim().split(/\s+/) : undefined,
        url: url.trim() || undefined,
      });
      setName('');
      setCommand('');
      setArgs('');
      setUrl('');
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const callTool = async (): Promise<void> => {
    if (!selected || !activeTool) return;
    setBusy(true);
    setCallResult(null);
    setError(null);
    try {
      let argsObj: Record<string, unknown>;
      try {
        argsObj = JSON.parse(callArgs || '{}') as Record<string, unknown>;
      } catch {
        setError('参数必须是合法 JSON');
        setBusy(false);
        return;
      }
      const r = await mcpApi.call(selected.id, activeTool, argsObj);
      setCallResult(r.data.result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-[#0F172A]">MCP 工具网关</h1>
        <p className="mt-1 text-sm text-[#64748B]">
          连接外部 MCP server（stdio 子进程或 HTTP 端点），发现并调用其工具——让蜂群调度时能调用第三方能力。
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        {/* 左：注册 + 列表 */}
        <div className="space-y-3">
          <Card className="p-3">
            <div className="mb-2 text-sm font-semibold text-[#0F172A]">注册 MCP server</div>
            <div className="space-y-2">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="名称（如 filesystem）" className="w-full rounded-lg border border-[#E2E8F0] px-2 py-1.5 text-sm text-[#0F172A] outline-none focus:border-[#4F46E5]" />
              <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="stdio 命令（如 npx）" className="w-full rounded-lg border border-[#E2E8F0] px-2 py-1.5 text-sm text-[#0F172A] outline-none focus:border-[#4F46E5]" />
              <input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="参数（空格分隔，如 -y @modelcontextprotocol/server-filesystem /tmp）" className="w-full rounded-lg border border-[#E2E8F0] px-2 py-1.5 text-sm text-[#0F172A] outline-none focus:border-[#4F46E5]" />
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="或 HTTP 端点（如 http://127.0.0.1:8000/mcp）" className="w-full rounded-lg border border-[#E2E8F0] px-2 py-1.5 text-sm text-[#0F172A] outline-none focus:border-[#4F46E5]" />
              <button onClick={() => void register()} disabled={busy} className="w-full rounded-lg bg-[#4F46E5] px-3 py-1.5 text-sm text-white hover:bg-[#4338CA] disabled:opacity-50">
                {busy ? '连接中…' : '注册并连接'}
              </button>
            </div>
          </Card>

          <Card className="p-0">
            <div className="border-b border-[#E2E8F0] px-3 py-2 text-sm font-semibold text-[#0F172A]">
              已连接 server（{servers.length}）
            </div>
            {servers.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-[#94A3B8]">暂无，先注册一个</div>
            ) : (
              <div className="max-h-[50vh] overflow-auto">
                {servers.map((s) => (
                  <button key={s.id} onClick={() => setSelected(s)} className={`block w-full border-b border-[#F1F5F9] px-3 py-2 text-left ${selected?.id === s.id ? 'bg-[#EEF2FF]' : 'hover:bg-[#F8FAFC]'}`}>
                    <div className="flex items-center justify-between">
                      <span className="truncate text-sm text-[#0F172A]">{s.name}</span>
                      <span className={`ml-2 shrink-0 text-xs ${s.status === 'connected' ? 'text-[#059669]' : 'text-[#DC2626]'}`}>
                        {s.status === 'connected' ? '已连接' : '异常'}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-[#64748B]">
                      {s.transport} · {s.toolCount} 工具
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* 右：工具 + 调用 */}
        <div className="space-y-3">
          {!selected ? (
            <Card className="flex flex-col items-center justify-center p-12 text-[#94A3B8]">
              <ExtensionIcon style={{ fontSize: 48 }} />
              <div className="mt-2 text-sm">选择左侧 server 查看并调用其工具</div>
            </Card>
          ) : (
            <>
              <Card className="p-0">
                <div className="flex items-center justify-between border-b border-[#E2E8F0] px-4 py-2">
                  <span className="text-sm font-semibold text-[#0F172A]">{selected.name} 的工具</span>
                  <button onClick={() => void mcpApi.remove(selected.id).then(() => { setSelected(null); load(); })} className="text-xs text-[#EF4444] hover:underline">移除</button>
                </div>
                {tools.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-[#94A3B8]">无工具</div>
                ) : (
                  <div className="grid gap-2 p-3 sm:grid-cols-2">
                    {tools.map((t) => (
                      <button key={t.name} onClick={() => setActiveTool(t.name)} className={`rounded-lg border p-3 text-left ${activeTool === t.name ? 'border-[#4F46E5] bg-[#EEF2FF]' : 'border-[#E2E8F0] hover:bg-[#F8FAFC]'}`}>
                        <div className="text-sm font-medium text-[#0F172A]">{t.name}</div>
                        <div className="mt-0.5 line-clamp-2 text-xs text-[#64748B]">{t.description ?? '—'}</div>
                      </button>
                    ))}
                  </div>
                )}
              </Card>

              {activeTool && (
                <Card className="p-4">
                  <div className="mb-2 text-sm font-semibold text-[#0F172A]">调用 {activeTool}</div>
                  <textarea value={callArgs} onChange={(e) => setCallArgs(e.target.value)} spellCheck={false} placeholder='{"key": "value"}' className="min-h-[80px] w-full rounded-lg border border-[#CBD5E1] bg-white p-2 font-mono text-xs text-[#0F172A] outline-none focus:border-[#4F46E5]" />
                  <button onClick={() => void callTool()} disabled={busy} className="mt-2 rounded-lg bg-[#4F46E5] px-4 py-1.5 text-sm text-white hover:bg-[#4338CA] disabled:opacity-50">
                    {busy ? '调用中…' : '执行'}
                  </button>
                  {callResult != null && (
                    <pre className="mt-3 max-h-[240px] overflow-auto rounded-lg bg-[#0F172A] p-3 text-xs leading-5 text-[#E2E8F0]">{callResult}</pre>
                  )}
                </Card>
              )}
            </>
          )}
          {error && <div className="rounded-md bg-[#FEE2E2] px-3 py-2 text-xs text-[#B91C1C]">{error}</div>}
        </div>
      </div>
    </div>
  );
}
