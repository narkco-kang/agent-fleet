import { useCallback, useEffect, useState } from 'react';
import AddIcon from '@mui/icons-material/Add';
import SendIcon from '@mui/icons-material/Send';
import type { Asset, AssetKind } from '@agentmesh/shared';
import { assetsApi } from '../api/assets';
import { Card } from '../components/common/Card';
import { AssetEditorDialog } from '../components/assets/AssetEditorDialog';
import { DeliverDialog } from '../components/assets/DeliverDialog';
import { DeliveryRecords } from '../components/assets/DeliveryRecords';

const KIND_LABEL: Record<AssetKind, string> = {
  rule: '规则',
  knowledge: '资料库',
  skill: 'skills',
};

type KindFilter = AssetKind | 'all';

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

/**
 * 资产管理页：规则 / 资料库 / skills 的 CRUD + 分发（人工确认）+ 分发记录。
 */
export default function AssetsPage(): JSX.Element {
  const [kind, setKind] = useState<KindFilter>('all');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [deliverFor, setDeliverFor] = useState<Asset | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback((): void => {
    assetsApi
      .list(kind === 'all' ? undefined : kind)
      .then((r) => setAssets(r.data))
      .catch(() => setAssets([]));
  }, [kind]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const openCreate = (): void => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (a: Asset): void => {
    setEditing(a);
    setEditorOpen(true);
  };
  const openDeliver = (a: Asset | null): void => {
    setDeliverFor(a);
    setDeliverOpen(true);
  };

  const onDelete = async (a: Asset): Promise<void> => {
    if (!window.confirm(`确认删除资产「${a.name}」？`)) return;
    try {
      await assetsApi.remove(a.id);
      refresh();
    } catch (err) {
      window.alert((err as Error).message);
    }
  };

  const tabs: Array<[KindFilter, string]> = [
    ['all', '全部'],
    ['rule', '规则'],
    ['knowledge', '资料库'],
    ['skill', 'skills'],
  ];

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#0F172A]">资产管理</h1>
        <div className="flex gap-2">
          <button
            onClick={() => openDeliver(null)}
            className="inline-flex items-center gap-1 rounded-lg border border-[#4F46E5] bg-white px-3 py-1.5 text-sm font-medium text-[#4F46E5] hover:bg-[#EEF2FF]"
          >
            <SendIcon fontSize="small" /> 分发
          </button>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1 rounded-lg bg-[#4F46E5] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#4338CA]"
          >
            <AddIcon fontSize="small" /> 新建资产
          </button>
        </div>
      </div>

      <div className="mb-3 flex gap-2">
        {tabs.map(([v, label]) => (
          <button
            key={v}
            onClick={() => setKind(v)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              kind === v ? 'bg-[#EEF2FF] text-[#4F46E5]' : 'text-[#334155] hover:bg-[#F8FAFC]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <Card className="p-0">
        <div className="border-b border-[#E2E8F0] px-4 py-3 text-sm font-semibold text-[#0F172A]">
          资产列表（{assets.length}）
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-[#F8FAFC] text-left text-xs text-[#64748B]">
                <th className="px-4 py-2 font-medium">名称</th>
                <th className="px-4 py-2 font-medium">类型</th>
                <th className="px-4 py-2 font-medium">版本</th>
                <th className="px-4 py-2 font-medium">标签</th>
                <th className="px-4 py-2 font-medium">更新时间</th>
                <th className="px-4 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {assets.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[#94A3B8]">
                    暂无资产，点击右上角「新建资产」开始创建
                  </td>
                </tr>
              ) : (
                assets.map((a) => (
                  <tr
                    key={a.id}
                    className="border-t border-[#E2E8F0] transition-colors hover:bg-[#F8FAFC]"
                    style={{ height: 48 }}
                  >
                    <td className="px-4 py-2 text-[#334155]">{a.name}</td>
                    <td className="px-4 py-2 text-[#334155]">{KIND_LABEL[a.kind]}</td>
                    <td className="px-4 py-2 text-[#334155]">v{a.version}</td>
                    <td className="px-4 py-2 text-[#64748B]">
                      {a.tags.length ? a.tags.map((t) => `#${t}`).join(' ') : '—'}
                    </td>
                    <td className="px-4 py-2 text-[#64748B]">{fmtTime(a.updatedAt)}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEdit(a)}
                          className="rounded px-2 py-1 text-xs text-[#4F46E5] hover:bg-[#EEF2FF]"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => openDeliver(a)}
                          className="rounded px-2 py-1 text-xs text-[#0891B2] hover:bg-[#ECFEFF]"
                        >
                          分发
                        </button>
                        <button
                          onClick={() => onDelete(a)}
                          className="rounded px-2 py-1 text-xs text-[#B91C1C] hover:bg-[#FEE2E2]"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-4">
        <DeliveryRecords refreshKey={refreshKey} />
      </div>

      <AssetEditorDialog
        open={editorOpen}
        kind={kind === 'all' ? undefined : kind}
        asset={editing}
        onClose={() => setEditorOpen(false)}
        onSaved={() => refresh()}
      />
      <DeliverDialog
        open={deliverOpen}
        initialAssetId={deliverFor?.id}
        onClose={() => setDeliverOpen(false)}
        onDelivered={() => {
          refresh();
          setRefreshKey((k) => k + 1);
        }}
      />
    </div>
  );
}
