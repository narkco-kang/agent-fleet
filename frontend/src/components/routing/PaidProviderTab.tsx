import { useCallback, useEffect, useMemo, useState } from 'react';
import Button from '@mui/material/Button';
import { gatewayApi, type PaidProviderInput, type PaidProviderConfigStatus } from '../../api/gateway';
import { Card } from '../common/Card';

/**
 * 付费 Provider 批量配置：借鉴 EchoBird 的 Model Nexus，把 API Provider 先集中登记，
 * 再由 modelgateway 统一路由给各设备 agent 平台使用。
 */

const SAMPLE: PaidProviderInput[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-...',
    models: ['gpt-4.1', 'gpt-4.1-mini'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-...',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
];

function toEditable(status: PaidProviderConfigStatus | null): string {
  const providers = status?.providers ?? [];
  if (providers.length === 0) return JSON.stringify(SAMPLE, null, 2);
  return JSON.stringify(
    providers.map((p) => ({
      id: p.id,
      label: p.label,
      baseUrl: p.baseUrl,
      apiKey: p.maskedApiKey || '',
      models: p.models,
    })),
    null,
    2,
  );
}

export function PaidProviderTab(): JSX.Element {
  const [status, setStatus] = useState<PaidProviderConfigStatus | null>(null);
  const [json, setJson] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await gatewayApi.providers();
      setStatus(r.data);
      setJson(toEditable(r.data));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const providerCount = status?.providers.length ?? 0;
  const configPath = status?.path ?? '.workbuddy-ai/modelgateway-providers.json';

  const parsedPreview = useMemo(() => {
    try {
      const value = JSON.parse(json) as unknown;
      return Array.isArray(value) ? value.length : 0;
    } catch {
      return null;
    }
  }, [json]);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const providers = JSON.parse(json) as PaidProviderInput[];
      if (!Array.isArray(providers)) throw new Error('JSON 必须是 Provider 数组');
      const r = await gatewayApi.saveProviders(providers);
      setStatus(r.data);
      setJson(toEditable(r.data));
      setMessage('已保存。请重启 modelgateway，使新 Provider 生效。');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [json]);

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-sm font-semibold text-[var(--text-strong)]">付费 Provider 批量配置</div>
            <div className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
              采用 EchoBird「Model Nexus」思路：先把 OpenAI/DeepSeek/Anthropic/自建 Router 等模型源集中登记，
              再在「平台模型」页为不同设备和 agent 平台绑定模型。API Key 仅写入本机已忽略目录，前端只脱敏回显。
            </div>
          </div>
          <div className="shrink-0 text-xs text-[var(--text-muted)]">
            已配置 {providerCount} 个 · 预览 {parsedPreview ?? 'JSON 错误'} 个
          </div>
        </div>
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2 text-xs text-[var(--text-muted)]">
          保存路径：<code>{configPath}</code>。保存后需要重启 modelgateway；环境变量 MG_PAID_PROVIDERS 的同 id 配置优先级更高。
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-[var(--text-strong)]">Provider JSON 数组</span>
          <div className="flex gap-2">
            <Button size="small" color="inherit" onClick={load} disabled={busy}>
              重新加载
            </Button>
            <Button size="small" variant="contained" onClick={save} disabled={busy}>
              {busy ? '保存中…' : '保存批量配置'}
            </Button>
          </div>
        </div>
        <textarea
          value={json}
          onChange={(e) => setJson(e.target.value)}
          spellCheck={false}
          className="min-h-[280px] w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-xs leading-5 text-[var(--text-strong)] outline-none focus:border-[#4F46E5]"
        />
        {message && <div className="mt-2 rounded-md bg-[var(--success-soft)] px-3 py-2 text-xs text-[#047857]">{message}</div>}
        {error && <div className="mt-2 rounded-md bg-[var(--danger-soft)] px-3 py-2 text-xs text-[#B91C1C]">{error}</div>}
      </Card>

      <Card className="p-0">
        <div className="border-b border-[var(--border)] px-4 py-3 text-sm font-semibold text-[var(--text-strong)]">已保存 Provider</div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-[var(--bg-subtle)] text-left text-xs text-[var(--text-muted)]">
                <th className="px-3 py-2 font-medium">ID</th>
                <th className="px-3 py-2 font-medium">名称</th>
                <th className="px-3 py-2 font-medium">Base URL</th>
                <th className="px-3 py-2 font-medium">模型</th>
                <th className="px-3 py-2 font-medium">Key</th>
              </tr>
            </thead>
            <tbody>
              {(status?.providers ?? []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-[var(--text-muted)]">
                    暂无付费 Provider。可粘贴示例 JSON 后保存。
                  </td>
                </tr>
              ) : (
                status?.providers.map((p) => (
                  <tr key={p.id} className="border-t border-[var(--border)]">
                    <td className="px-3 py-2 font-mono text-xs text-[var(--text)]">{p.id}</td>
                    <td className="px-3 py-2 text-[var(--text)]">{p.label}</td>
                    <td className="px-3 py-2 font-mono text-xs text-[var(--text-muted)]">{p.baseUrl}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">{p.models.join(', ')}</td>
                    <td className="px-3 py-2 font-mono text-xs text-[var(--text-muted)]">{p.hasApiKey ? p.maskedApiKey : '未配置'}</td>
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
