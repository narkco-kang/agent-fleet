import { useEffect, useState } from 'react';
import { http } from '../api/http';

/**
 * 设置页（04 §F）：通信 / 微信绑定 / 权限 / 关于。
 */
export default function SettingsPage(): JSX.Element {
  const [status, setStatus] = useState<{ devicesOnline?: number; relayConnected?: boolean } | null>(null);
  const [memory, setMemory] = useState<{
    group?: string;
    schema?: string;
    blocks?: number;
    changes?: number;
    tipIndex?: number;
    tipHash?: string;
    healthy?: boolean;
  } | null>(null);

  useEffect(() => {
    http
      .getStatus()
      .then((r) => setStatus(r.data))
      .catch(() => setStatus(null));
    http
      .getMemorySummary()
      .then((r) => setMemory(r))
      .catch(() => setMemory(null));
  }, []);

  return (
    <div className="p-4 md:p-6">
      <h1 className="mb-4 text-xl font-semibold text-[#0F172A]">设置</h1>

      <div className="grid max-w-3xl grid-cols-1 gap-4">
        <Section title="通信">
          <Row label="局域网发现" value="mDNS (_agentfleet._tcp)" />
          <Row label="协调服务" value="ws://127.0.0.1:4173" />
          <Row label="中继服务" value={status?.relayConnected ? '已连接' : '未连接（可配置 RELAY_URL）'} />
          <Row label="在线设备" value={status ? String(status.devicesOnline ?? 0) : '—'} />
        </Section>

        <Section title="团队记忆账本（区块链式）">
          <Row label="空间" value={memory ? `team（${memory.schema}）` : '—'} />
          <Row label="区块数" value={memory ? String(memory.blocks ?? 0) : '—'} />
          <Row label="记忆条数" value={memory ? String(memory.changes ?? 0) : '—'} />
          <Row label="链头" value={memory ? `#${memory.tipIndex ?? 0}` : '—'} />
          <Row
            label="哈希链健康"
            value={
              memory === null
                ? '后端未连接'
                : memory.healthy
                  ? '✅ 完整（prev_hash 环环相扣）'
                  : '⚠️ 断裂'
            }
          />
        </Section>

        <Section title="微信绑定">
          <Row label="企业微信" value="需配置 corpId / corpSecret / token / aesKey（见 .env.example）" />
          <Row label="个人微信" value="接口预留，未接入（降级提示）" />
        </Section>

        <Section title="权限">
          <Row label="工具过滤" value="P0 不拦截（P2 引入 allow/deny）" />
          <Row label="危险操作确认" value="P0 不拦截（P2 引入）" />
        </Section>

        <Section title="关于">
          <Row label="版本" value="AgentFleet v0.1.0" />
          <Row label="架构" value="局域网优先 + 云端中继兜底" />
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="rounded-card border border-[#E2E8F0] bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-[#0F172A]">{title}</h2>
      <div className="divide-y divide-[#F1F5F9]">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex justify-between py-2 text-sm">
      <span className="text-[#64748B]">{label}</span>
      <span className="text-[#334155]">{value}</span>
    </div>
  );
}
