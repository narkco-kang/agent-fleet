import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { parseReason, reasonText } from '@agentfleet/shared';
import {
  http,
  type AttentionSummary,
  type EffectRowView,
  type HealthEntryView,
  type ProbeRecordView,
} from '../api/http';
import { useT } from '../i18n';

/**
 * 系统健康页（DSH 架构融合的可观测面）。
 *
 * 设计原则直接来自 dsh-superagent-prototype：
 *   - 「只把需要人的东西摆到人面前」：正常条目折叠为一行汇总，故障/待人工项才展开明细
 *   - 「诚实报告」：副作用失败原因用结构化 Reason 解码后展示，不吞错、不假装成功
 *   - 「少占注意力」：不自动轮询刷屏，仅手动刷新 + 顶栏摘要条被动提示
 */
export default function SystemHealthPage(): JSX.Element {
  const t = useT();
  const [attention, setAttention] = useState<AttentionSummary | null>(null);
  const [entries, setEntries] = useState<HealthEntryView[]>([]);
  const [effects, setEffects] = useState<EffectRowView[]>([]);
  const [effectStats, setEffectStats] = useState({ pending: 0, dead: 0, running: 0, kinds: 0 });
  const [probes, setProbes] = useState<ProbeRecordView[]>([]);
  const [version, setVersion] = useState('');
  const [notices, setNotices] = useState<Array<{ id: string; kind: string; policyNotice?: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const [a, h, e, p, n] = await Promise.allSettled([
      http.getAttention(),
      http.getHealthComponents(),
      http.getEffects(),
      http.getModelProbes(),
      http.getPolicyNotices(),
    ]);
    if (a.status === 'fulfilled') setAttention(a.value.data);
    if (h.status === 'fulfilled') setEntries(h.value.data.entries);
    if (e.status === 'fulfilled') {
      setEffects(e.value.data.rows);
      setEffectStats(e.value.data.stats);
    }
    if (p.status === 'fulfilled') setProbes(p.value.data);
    if (n.status === 'fulfilled') {
      setVersion(n.value.data.version);
      setNotices(n.value.data.notices);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runProbe = async (): Promise<void> => {
    setBusy(true);
    setMessage('');
    try {
      const r = await http.runModelProbe();
      setMessage(`${r.data.ok}/${r.data.total} ${t('health.probes')} · ${r.data.reason}`);
      await load();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const retry = async (row: EffectRowView): Promise<void> => {
    try {
      await http.retryEffect(row.kind, row.effectKey);
      await load();
    } catch (err) {
      setMessage((err as Error).message);
    }
  };

  const problems =
    (attention?.healthErrors ?? 0) + (attention?.deadEffects ?? 0) + (attention?.policyNotices ?? 0);

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-strong)]">{t('health.title')}</h1>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{t('health.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={runProbe}
            disabled={busy}
            className="rounded-lg bg-[#4F46E5] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#4338CA] disabled:opacity-50"
          >
            {t('health.runProbe')}
          </button>
          <button
            onClick={() => void load()}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[var(--bg-subtle)]"
          >
            {t('health.refresh')}
          </button>
        </div>
      </div>

      {message && (
        <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2 text-xs text-[var(--text)]">
          {message}
        </div>
      )}

      {/* 健康态折叠：一切正常时只显示一行，不占用注意力 */}
      <div className="mb-4 flex flex-wrap gap-3 text-xs">
        <span className={problems > 0 ? 'font-medium text-[#B91C1C]' : 'text-[var(--text-muted)]'}>
          {problems > 0 ? `⚠ ${problems}` : '✓ 0'} · {t('layout.pending')}
        </span>
        <span className="text-[var(--text-muted)]">
          {t('health.pending')} {effectStats.pending} · {t('health.running')} {effectStats.running} ·{' '}
          {t('health.dead')} {effectStats.dead}
        </span>
        {attention && attention.failedProbes > 0 && (
          <span className="text-[#B45309]">
            {t('health.probes')} {attention.failedProbes}
          </span>
        )}
      </div>

      <div className="grid max-w-5xl grid-cols-1 gap-4">
        <Section title={t('health.components')} extra={`${entries.length}`}>
          {entries.length === 0 ? (
            <Empty />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[var(--text-muted)]">
                  <tr>
                    <th className="py-1.5 pr-3">name</th>
                    <th className="py-1.5 pr-3">state</th>
                    <th className="py-1.5 pr-3">{t('health.owner')}</th>
                    <th className="py-1.5 pr-3">{t('health.failures')}</th>
                    <th className="py-1.5 pr-3">detail</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.name} className="border-t border-[var(--border)]">
                      <td className="py-1.5 pr-3 font-medium text-[var(--text-strong)]">{e.name}</td>
                      <td className="py-1.5 pr-3">
                        <span className={stateClass(e.state)}>{t(`health.state.${e.state}`)}</span>
                      </td>
                      <td className="py-1.5 pr-3 text-[var(--text-muted)]">{e.owner}</td>
                      <td className="py-1.5 pr-3">{e.failures}</td>
                      <td className="py-1.5 pr-3 text-[var(--text-muted)]">{e.lastError || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section
          title={t('health.effects')}
          extra={`${effectStats.pending} ${t('health.pending')} / ${effectStats.dead} ${t('health.dead')}`}
        >
          {effects.length === 0 ? (
            <Empty />
          ) : (
            <div className="flex flex-col gap-1.5">
              {effects.map((row) => (
                <div
                  key={`${row.kind}:${row.effectKey}`}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-xs"
                >
                  <span className="font-medium text-[var(--text-strong)]">{row.kind}</span>
                  <span className="text-[var(--text-muted)]">{row.effectKey.slice(0, 12)}…</span>
                  <span className={row.status === 'dead' ? 'text-[#B91C1C]' : 'text-[#B45309]'}>
                    {row.status === 'dead' ? t('health.dead') : t('health.pending')} #{row.attempts}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[var(--text-muted)]">
                    {row.lastError ? reasonText(parseReason(row.lastError)) : '—'}
                  </span>
                  {row.status === 'dead' && (
                    <button
                      onClick={() => void retry(row)}
                      className="rounded border border-[var(--border)] px-2 py-0.5 text-[#4F46E5] hover:bg-[var(--brand-soft)]"
                    >
                      {t('health.retry')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title={t('health.probes')} extra={`${probes.length}`}>
          {probes.length === 0 ? (
            <Empty />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[var(--text-muted)]">
                  <tr>
                    <th className="py-1.5 pr-3">model</th>
                    <th className="py-1.5 pr-3">state</th>
                    <th className="py-1.5 pr-3">{t('health.latency')}</th>
                    <th className="py-1.5 pr-3">{t('health.checkedAt')}</th>
                    <th className="py-1.5 pr-3">detail</th>
                  </tr>
                </thead>
                <tbody>
                  {probes.map((p) => (
                    <tr key={p.model} className="border-t border-[var(--border)]">
                      <td className="py-1.5 pr-3 font-medium text-[var(--text-strong)]">{p.model}</td>
                      <td className="py-1.5 pr-3">
                        <span className={p.ok ? 'text-[#15803D]' : 'text-[#B91C1C]'}>
                          {p.ok ? 'ok' : 'failed'}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3">{p.latencyMs} ms</td>
                      <td className="py-1.5 pr-3 text-[var(--text-muted)]">
                        {new Date(p.checkedAt).toLocaleTimeString()}
                      </td>
                      <td className="py-1.5 pr-3 text-[var(--text-muted)]">{p.detail || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title={t('health.policy')} extra={version ? version.slice(0, 12) : ''}>
          <div className="text-xs text-[var(--text-muted)]">
            {t('health.policyVersion')}: <span className="font-mono">{version || '—'}</span>
          </div>
          {notices.length === 0 ? (
            <div className="mt-2"><Empty /></div>
          ) : (
            <ul className="mt-2 flex flex-col gap-1 text-xs">
              {notices.map((n) => (
                <li key={n.id} className="rounded border border-[var(--border)] px-2 py-1">
                  <span className="font-medium">{n.kind}</span>{' '}
                  <span className="text-[var(--text-muted)]">
                    {n.policyNotice ? reasonText(parseReason(n.policyNotice)) : n.id}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  extra,
  children,
}: {
  title: string;
  extra?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--text-strong)]">{title}</h2>
        {extra && <span className="text-xs text-[var(--text-muted)]">{extra}</span>}
      </div>
      {children}
    </section>
  );
}

function Empty(): JSX.Element {
  const t = useT();
  return <div className="py-3 text-xs text-[var(--text-muted)]">— {t('health.empty')} —</div>;
}

function stateClass(state: HealthEntryView['state']): string {
  if (state === 'error') return 'text-[#B91C1C]';
  if (state === 'degraded') return 'text-[#B45309]';
  return 'text-[#15803D]';
}
