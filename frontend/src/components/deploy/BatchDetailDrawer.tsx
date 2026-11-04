import { useState } from 'react';
import Drawer from '@mui/material/Drawer';
import Button from '@mui/material/Button';
import CloseIcon from '@mui/icons-material/Close';
import type { DeploymentBatch } from '@agentfleet/shared';
import { deployApi } from '../../api/deploy';

/**
 * 批次详情抽屉：目标清单 + 确认/取消执行。
 */
const TARGET_STATUS_LABEL: Record<string, string> = {
  pending: '待执行',
  connecting: '连接中',
  probing: '探测 OS',
  installing: '安装中',
  verifying: '验证中',
  success: '成功',
  failed: '失败',
};

export function BatchDetailDrawer({
  batch,
  onClose,
  onChanged,
}: {
  batch: DeploymentBatch | null;
  onClose: () => void;
  onChanged: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      anchor="right"
      open={!!batch}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', sm: 520 } } }}
    >
      {batch && (
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-[var(--text-strong)]">{batch.name}</div>
              <div className="text-xs text-[var(--text-muted)]">
                {batch.kind === 'uninstall' ? '一键卸载' : '一键部署'} · {batch.id}
              </div>
            </div>
            <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-strong)]">
              <CloseIcon fontSize="small" />
            </button>
          </div>

          <div className="flex-1 overflow-auto p-4">
            <div className="mb-3 flex gap-2">
              <Button
                size="small"
                variant="contained"
                disabled={busy || batch.status !== 'pending_confirmation'}
                onClick={() => act(() => deployApi.confirm(batch.id))}
              >
                确认执行
              </Button>
              <Button
                size="small"
                color="inherit"
                disabled={busy || batch.status === 'running' || batch.status === 'completed'}
                onClick={() => act(() => deployApi.cancel(batch.id))}
              >
                取消批次
              </Button>
            </div>
            {error && <div className="mb-3 rounded-md bg-[var(--danger-soft)] px-3 py-2 text-xs text-[#B91C1C]">{error}</div>}

            <div className="mb-2 text-xs font-semibold text-[var(--text-strong)]">目标机（{batch.targets?.length ?? 0}）</div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-[var(--bg-subtle)] text-left text-xs text-[var(--text-muted)]">
                    <th className="px-3 py-2 font-medium">IP</th>
                    <th className="px-3 py-2 font-medium">用户</th>
                    <th className="px-3 py-2 font-medium">OS</th>
                    <th className="px-3 py-2 font-medium">平台</th>
                    <th className="px-3 py-2 font-medium">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.targets?.length ? (
                    batch.targets.map((t) => (
                      <tr key={t.id} className="border-t border-[var(--border)]">
                        <td className="px-3 py-2 text-[var(--text)]">{t.ip}:{t.port ?? 22}</td>
                        <td className="px-3 py-2 text-[var(--text)]">{t.user}</td>
                        <td className="px-3 py-2 text-[var(--text)]">{t.os ?? '—'}</td>
                        <td className="px-3 py-2 text-[var(--text)]">{(t.platforms ?? []).join(', ')}</td>
                        <td className="px-3 py-2 text-[var(--text)]">{TARGET_STATUS_LABEL[t.status] ?? t.status}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-[var(--text-muted)]">
                        无目标
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
}
