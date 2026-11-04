import type { DeploymentBatch } from '@agentfleet/shared';
import { Card } from '../common/Card';

/**
 * 部署批次列表（安装/卸载），点击行展开详情。
 */
const STATUS_LABEL: Record<string, string> = {
  pending_confirmation: '待确认',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

export function BatchList({
  batches,
  onOpen,
}: {
  batches: DeploymentBatch[];
  onOpen: (batch: DeploymentBatch) => void;
}): JSX.Element {
  return (
    <Card className="p-0">
      <div className="border-b border-[var(--border)] px-4 py-3 text-sm font-semibold text-[var(--text-strong)]">
        部署批次（13 平台 SSH）
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-[var(--bg-subtle)] text-left text-xs text-[var(--text-muted)]">
              <th className="px-4 py-2 font-medium">名称</th>
              <th className="px-4 py-2 font-medium">类型</th>
              <th className="px-4 py-2 font-medium">状态</th>
              <th className="px-4 py-2 font-medium">目标数</th>
              <th className="px-4 py-2 font-medium">创建时间</th>
            </tr>
          </thead>
          <tbody>
            {batches.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-[var(--text-muted)]">
                  暂无部署批次
                </td>
              </tr>
            ) : (
              batches.map((b) => (
                <tr
                  key={b.id}
                  onClick={() => onOpen(b)}
                  className="cursor-pointer border-t border-[var(--border)] transition-colors hover:bg-[var(--bg-subtle)]"
                  style={{ height: 48 }}
                >
                  <td className="px-4 py-2 text-[var(--text)]">{b.name}</td>
                  <td className="px-4 py-2 text-[var(--text)]">
                    {b.kind === 'uninstall' ? '卸载' : '部署'}
                  </td>
                  <td className="px-4 py-2 text-[var(--text)]">{STATUS_LABEL[b.status] ?? b.status}</td>
                  <td className="px-4 py-2 text-[var(--text)]">{b.targets?.length ?? 0}</td>
                  <td className="px-4 py-2 text-[var(--text-muted)]">{fmtTime(b.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
