import { useCallback, useEffect, useState } from 'react';
import AddIcon from '@mui/icons-material/Add';
import type { DeploymentBatch, DeploymentKind } from '@agentfleet/shared';
import { deployApi } from '../api/deploy';
import { GatewayComponentPanel } from '../components/deploy/GatewayComponentPanel';
import { BatchList } from '../components/deploy/BatchList';
import { NewBatchDialog } from '../components/deploy/NewBatchDialog';
import { BatchDetailDrawer } from '../components/deploy/BatchDetailDrawer';

/**
 * 部署管理页：协调器组件（内置 modelgateway）+ 13 平台 SSH 批量部署。
 */
export default function DeployPage(): JSX.Element {
  const [kind, setKind] = useState<DeploymentKind | 'all'>('all');
  const [batches, setBatches] = useState<DeploymentBatch[]>([]);
  const [selected, setSelected] = useState<DeploymentBatch | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const refresh = useCallback(() => {
    deployApi
      .list(kind === 'all' ? undefined : kind)
      .then((r) => setBatches(r.data))
      .catch(() => setBatches([]));
  }, [kind]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 4000);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--text-strong)]">部署管理</h1>
        <button
          onClick={() => setNewOpen(true)}
          className="inline-flex items-center gap-1 rounded-lg bg-[#4F46E5] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#4338CA]"
        >
          <AddIcon fontSize="small" /> 新建批次
        </button>
      </div>

      <div className="mb-4">
        <GatewayComponentPanel />
      </div>

      <div className="mb-3 flex gap-2">
        {(
          [
            ['all', '全部'],
            ['deploy', '部署'],
            ['uninstall', '卸载'],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setKind(v)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              kind === v
                ? 'bg-[var(--brand-soft)] text-[#4F46E5]'
                : 'text-[var(--text)] hover:bg-[var(--bg-subtle)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <BatchList
        batches={batches}
        onOpen={(b) => setSelected(b)}
      />

      <NewBatchDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={() => refresh()}
      />
      <BatchDetailDrawer
        batch={selected}
        onClose={() => setSelected(null)}
        onChanged={() => {
          refresh();
          const id = selected?.id;
          if (id) deployApi.get(id).then((r) => setSelected(r.data)).catch(() => undefined);
        }}
      />
    </div>
  );
}
