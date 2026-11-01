import { randomId } from '../../security/auth.js';
import { modelGatewayClient } from './modelGatewayClient.js';
import { listCheckins, lastCheckin, recordCheckin } from '../../db/repo/checkins.js';
import { config } from '../../config.js';

/**
 * 免费源自动签到服务。
 *
 * 对有「签到/打卡领取积分」需求的免费源，维护一个签到源注册表：
 * - `gateway-free`：经 modelgateway 的 /v1/free/checkin（若网关配置了免费线路）
 * - `opencode-quota`：OpenCode 额度刷新（端点未公开，默认关闭，仅占位）
 *
 * 说明：参考项目 dsh-our-free-model 没有公开签到端点，因此这里的 HTTP 签到
 * 端点全部可配置（FREE_OPENCODE_CHECKIN_URL），未配置则跳过。
 */

export interface CheckinSourceDef {
  id: string;
  name: string;
  kind: 'gateway-free' | 'http';
  /** http 类型签到端点（可空 = 未配置，跳过） */
  endpoint?: string;
  method?: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  enabled: boolean;
  note: string;
}

function buildSources(): CheckinSourceDef[] {
  return [
    {
      id: 'gateway-free',
      name: '网关免费线路签到',
      kind: 'gateway-free',
      enabled: modelGatewayClient.isConfigured(),
      note: '经 modelgateway /v1/free/checkin 刷新免费额度',
    },
    {
      id: 'opencode-quota',
      name: 'OpenCode 额度刷新',
      kind: 'http',
      endpoint: process.env.FREE_OPENCODE_CHECKIN_URL || '',
      method: 'POST',
      headers: { Authorization: 'Bearer public', 'Content-Type': 'application/json' },
      body: { action: 'checkin' },
      enabled: Boolean(process.env.FREE_OPENCODE_CHECKIN_URL),
      note: 'OpenCode 未公开签到端点；仅在配置 FREE_OPENCODE_CHECKIN_URL 后启用',
    },
  ];
}

export interface CheckinResult {
  sourceId: string;
  name: string;
  ok: boolean;
  detail: string;
}

/** 执行单个源的签到 */
async function runSource(source: CheckinSourceDef): Promise<CheckinResult> {
  try {
    if (!source.enabled) {
      return { sourceId: source.id, name: source.name, ok: false, detail: 'disabled' };
    }
    if (source.kind === 'gateway-free') {
      const ok = await modelGatewayClient.checkinFreeSource('free-models/kilo-auto/free');
      return { sourceId: source.id, name: source.name, ok, detail: ok ? 'ok' : 'gateway checkin failed' };
    }
    if (!source.endpoint) {
      return { sourceId: source.id, name: source.name, ok: false, detail: 'endpoint not configured' };
    }
    const res = await fetch(source.endpoint, {
      method: source.method ?? 'POST',
      headers: source.headers ?? {},
      body: source.body ? JSON.stringify(source.body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    return { sourceId: source.id, name: source.name, ok: res.ok, detail: `http ${res.status}` };
  } catch (err) {
    return { sourceId: source.id, name: source.name, ok: false, detail: (err as Error).message };
  }
}

/** 执行全部启用源签到并落审计记录 */
export async function runAllCheckins(): Promise<CheckinResult[]> {
  const results: CheckinResult[] = [];
  for (const source of buildSources()) {
    const r = await runSource(source);
    recordCheckin({
      checkinId: randomId('checkin'),
      sourceId: r.sourceId,
      status: r.ok ? 'ok' : 'failed',
      detail: r.detail,
    });
    results.push(r);
  }
  return results;
}

/** 手动触发指定源签到（不指定则全部启用源） */
export async function checkin(sourceId?: string): Promise<CheckinResult[]> {
  const sources = buildSources().filter((s) => (sourceId ? s.id === sourceId : true));
  const results: CheckinResult[] = [];
  for (const source of sources) {
    const r = await runSource(source);
    recordCheckin({
      checkinId: randomId('checkin'),
      sourceId: r.sourceId,
      status: r.ok ? 'ok' : 'failed',
      detail: r.detail,
    });
    results.push(r);
  }
  return results;
}

/** 签到源状态总览 */
export function status() {
  const sources = buildSources().map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    enabled: s.enabled,
    note: s.note,
    last: lastCheckin(s.id) ?? null,
  }));
  return { sources, records: listCheckins(undefined, 50) };
}

/** 启动定时自动签到 */
export function startCheckinLoop(): void {
  if (process.env.FREE_CHECKIN_ENABLED === '0') return;
  const intervalMs = Number(process.env.FREE_CHECKIN_INTERVAL_MS ?? 6 * 60 * 60 * 1000);
  if (process.env.FREE_CHECKIN_ON_START !== '0') {
    const startupTimer = setTimeout(() => {
      void runAllCheckins().catch((err) => console.error('[checkin] 启动后自动签到失败', err));
    }, Number(process.env.FREE_CHECKIN_START_DELAY_MS ?? 5_000));
    startupTimer.unref();
  }
  const timer = setInterval(() => {
    void runAllCheckins().catch((err) => console.error('[checkin] 自动签到失败', err));
  }, intervalMs);
  timer.unref();
}
