import { useCallback, useEffect, useState } from 'react';
import type { PlatformModelBinding } from '@agentfleet/shared';
import { routingApi } from '../../api/routing';
import { Card } from '../common/Card';

/**
 * 网关健康：modelgateway 可用性 + 平台模型绑定总览。
 */
export function GatewayHealthTab(): JSX.Element {
  const [health, setHealth] = useState<{ configured: boolean; available: boolean; healthy: boolean } | null>(null);
  const [bindings, setBindings] = useState<PlatformModelBinding[]>([]);

  const load = useCallback(() => {
    routingApi
      .gatewayHealth()
      .then((r) => setHealth(r.data))
      .catch(() => setHealth(null));
    routingApi
      .platformModels()
      .then((r) => setBindings(r.data))
      .catch(() => setBindings([]));
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  const healthy = health?.healthy === true;

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-sm font-semibold text-[var(--text-strong)]">modelgateway 健康</span>
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
            style={{
              background: healthy ? '#D1FAE5' : '#FEE2E2',
              color: healthy ? '#047857' : '#B91C1C',
            }}
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: healthy ? '#10B981' : '#EF4444' }} />
            {health === null ? '后端未连接' : healthy ? '健康' : '不可用'}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
          <Info label="已配置" value={health ? (health.configured ? '是' : '否') : '—'} />
          <Info label="客户端可用" value={health ? (health.available ? '是' : '否') : '—'} />
          <Info label="健康探测" value={health ? (health.healthy ? '通过' : '失败') : '—'} />
        </div>
      </Card>

      <Card className="p-0">
        <div className="border-b border-[var(--border)] px-4 py-3 text-sm font-semibold text-[var(--text-strong)]">
          平台模型绑定（{bindings.length}）
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-[var(--bg-subtle)] text-left text-xs text-[var(--text-muted)]">
                <th className="px-3 py-2 font-medium">设备</th>
                <th className="px-3 py-2 font-medium">平台</th>
                <th className="px-3 py-2 font-medium">主模型</th>
                <th className="px-3 py-2 font-medium">兜底</th>
                <th className="px-3 py-2 font-medium">生效</th>
                <th className="px-3 py-2 font-medium">状态</th>
              </tr>
            </thead>
            <tbody>
              {bindings.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-[var(--text-muted)]">
                    暂无绑定
                  </td>
                </tr>
              ) : (
                bindings.map((b) => (
                  <tr key={`${b.deviceId}:${b.agentType}`} className="border-t border-[var(--border)]">
                    <td className="px-3 py-2 text-[var(--text)]">{b.deviceId}</td>
                    <td className="px-3 py-2 text-[var(--text)]">{b.agentType}</td>
                    <td className="px-3 py-2 text-[var(--text)]">{b.model}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">{b.fallbacks.join(', ') || '—'}</td>
                    <td className="px-3 py-2 text-[var(--text)]">{b.activeModel}</td>
                    <td className="px-3 py-2 text-[var(--text)]">
                      <span className={b.state === 'ok' ? 'text-[#10B981]' : 'text-[#EF4444]'}>
                        {b.state === 'ok' ? '健康' : '已降级'}
                      </span>
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

function Info({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <div className="text-xs text-[var(--text-muted)]">{label}</div>
      <div className="mt-0.5 text-[var(--text)]">{value}</div>
    </div>
  );
}
