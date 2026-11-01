import type { ReactNode } from 'react';
import type { TaskStatus, DeviceStatus, AgentStatus } from '@agentmesh/shared';

/**
 * 状态徽标（04 §3.2）：语义色映射统一（03 §6.5）。
 */
export type BadgeStatus = TaskStatus | DeviceStatus | AgentStatus | 'success' | 'error';

const STATUS_META: Record<string, { bg: string; fg: string; dot: string; label: string }> = {
  online: { bg: '#D1FAE5', fg: '#047857', dot: '#10B981', label: '在线' },
  completed: { bg: '#D1FAE5', fg: '#047857', dot: '#10B981', label: '完成' },
  success: { bg: '#D1FAE5', fg: '#047857', dot: '#10B981', label: '成功' },
  available: { bg: '#D1FAE5', fg: '#047857', dot: '#10B981', label: '空闲' },
  running: { bg: '#FEF3C7', fg: '#B45309', dot: '#F59E0B', label: '运行中' },
  busy: { bg: '#FEF3C7', fg: '#B45309', dot: '#F59E0B', label: '忙碌' },
  queued: { bg: '#F1F5F9', fg: '#475569', dot: '#94A3B8', label: '排队' },
  offline: { bg: '#F1F5F9', fg: '#475569', dot: '#94A3B8', label: '离线' },
  failed: { bg: '#FEE2E2', fg: '#B91C1C', dot: '#EF4444', label: '失败' },
  error: { bg: '#FEE2E2', fg: '#B91C1C', dot: '#EF4444', label: '异常' },
  interrupted: { bg: '#FEE2E2', fg: '#B91C1C', dot: '#EF4444', label: '中断' },
  cancelled: { bg: '#FEE2E2', fg: '#B91C1C', dot: '#EF4444', label: '已取消' },
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
