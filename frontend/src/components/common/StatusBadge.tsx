import type { ReactNode } from 'react';
import type { TaskStatus, DeviceStatus, AgentStatus } from '@agentfleet/shared';

/**
 * 状态徽标（04 §3.2）：语义色映射统一（03 §6.5）。
 */
export type BadgeStatus = TaskStatus | DeviceStatus | AgentStatus | 'success' | 'error';

const STATUS_META: Record<string, { bg: string; fg: string; dot: string; label: string }> = {
  online: { bg: 'var(--success-soft)', fg: 'var(--success-fg)', dot: 'var(--success)', label: '在线' },
  completed: { bg: 'var(--success-soft)', fg: 'var(--success-fg)', dot: 'var(--success)', label: '完成' },
  success: { bg: 'var(--success-soft)', fg: 'var(--success-fg)', dot: 'var(--success)', label: '成功' },
  available: { bg: 'var(--success-soft)', fg: 'var(--success-fg)', dot: 'var(--success)', label: '空闲' },
  running: { bg: 'var(--warning-soft)', fg: 'var(--warning-fg)', dot: 'var(--warning)', label: '运行中' },
  busy: { bg: 'var(--warning-soft)', fg: 'var(--warning-fg)', dot: 'var(--warning)', label: '忙碌' },
  queued: { bg: 'var(--bg-subtle)', fg: 'var(--text-muted)', dot: 'var(--offline)', label: '排队' },
  waiting: { bg: 'var(--bg-subtle)', fg: 'var(--text-muted)', dot: 'var(--offline)', label: '等待' },
  blocked: { bg: 'var(--bg-subtle)', fg: 'var(--text-muted)', dot: 'var(--offline)', label: '待决策' },
  offline: { bg: 'var(--bg-subtle)', fg: 'var(--text-muted)', dot: 'var(--offline)', label: '离线' },
  failed: { bg: 'var(--danger-soft)', fg: 'var(--danger-fg)', dot: 'var(--danger)', label: '失败' },
  error: { bg: 'var(--danger-soft)', fg: 'var(--danger-fg)', dot: 'var(--danger)', label: '异常' },
  interrupted: { bg: 'var(--danger-soft)', fg: 'var(--danger-fg)', dot: 'var(--danger)', label: '中断' },
  cancelled: { bg: 'var(--danger-soft)', fg: 'var(--danger-fg)', dot: 'var(--danger)', label: '已取消' },
};

export function StatusBadge({ status }: { status: BadgeStatus }): ReactNode {
  const meta = STATUS_META[status] ?? STATUS_META.offline;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ background: meta.bg, color: meta.fg }}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: meta.dot }} />
      {meta.label}
    </span>
  );
}
