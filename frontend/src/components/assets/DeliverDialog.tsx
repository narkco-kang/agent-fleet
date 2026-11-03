import { useEffect, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import type { AgentSnapshot, Asset, AssetKind, DeviceSnapshot } from '@agentfleet/shared';
import { assetsApi, type DeliveryRequestResult } from '../../api/assets';
import { http } from '../../api/http';
import { useT } from '../../i18n';

const KIND_KEY: Record<AssetKind, string> = {
  rule: 'assets.kind.rule',
  knowledge: 'assets.kind.knowledge',
  skill: 'assets.kind.skill',
  prompt: 'assets.kind.prompt',
};

type DeviceWithAgents = DeviceSnapshot & { agents: AgentSnapshot[] };

function deviceStatusClass(status: DeviceSnapshot['status']): string {
  if (status === 'online') return 'bg-[#D1FAE5] text-[#047857]';
  if (status === 'busy') return 'bg-[#FEF3C7] text-[#B45309]';
  return 'bg-[#F1F5F9] text-[#475569]';
}

function deviceStatusKey(status: DeviceSnapshot['status']): string {
  return status === 'online' ? 'deliver.online' : status === 'busy' ? 'deliver.busy' : 'deliver.offline';
}

/**
 * 资产分发对话框：第 1 步选资产（多选）→ 第 2 步选目标设备（多选，离线可排队）
 * → 提交生成分发请求 → 提示并确认执行。
 */
export function DeliverDialog({
  open,
  initialAssetId,
  onClose,
  onDelivered,
}: {
  open: boolean;
  /** 从单条资产行进入时预选该资产；顶部入口为 undefined */
  initialAssetId?: string;
  onClose: () => void;
  onDelivered: () => void;
}): JSX.Element {
  const t = useT();
  const [step, setStep] = useState<1 | 2>(1);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [devices, setDevices] = useState<DeviceWithAgents[]>([]);
  const [selectedAssets, setSelectedAssets] = useState<Set<string>>(new Set());
  const [selectedDevices, setSelectedDevices] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DeliveryRequestResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setStep(1);
    Promise.all([assetsApi.list(), http.getDevices()])
      .then(([a, d]) => {
        setAssets(a.data);
        setDevices(d.data);
        setSelectedAssets(initialAssetId ? new Set([initialAssetId]) : new Set());
        setSelectedDevices(new Set());
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [open, initialAssetId]);

  const toggleAsset = (id: string): void => {
    setSelectedAssets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleDevice = (id: string): void => {
    setSelectedDevices((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllAssets = (): void => setSelectedAssets(new Set(assets.map((a) => a.id)));
  const clearAssets = (): void => setSelectedAssets(new Set());
  const selectAllDevices = (): void => setSelectedDevices(new Set(devices.map((d) => d.deviceId)));
  const clearDevices = (): void => setSelectedDevices(new Set());

  const submit = async (): Promise<void> => {
    if (selectedAssets.size === 0) {
      setError(t('deliver.needAsset'));
      return;
    }
    if (selectedDevices.size === 0) {
      setError(t('deliver.needDevice'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await assetsApi.deliver(Array.from(selectedAssets), Array.from(selectedDevices));
      setResult(r.data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (): Promise<void> => {
    if (!result) return;
    setBusy(true);
    setError(null);
    try {
      await assetsApi.confirmDelivery(result.deliveryId);
      onDelivered();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle className="text-[#0F172A]">{t('deliver.title')}</DialogTitle>
      <DialogContent>
        <div className="mt-1 flex flex-col gap-3">
          {loading && <div className="text-sm text-[#64748B]">{t('common.loading')}</div>}

          {!loading && !result && (
            <>
              <div className="flex gap-1 rounded-lg bg-[#F1F5F9] p-1">
                {([1, 2] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStep(s)}
                    className={`flex-1 rounded-md px-2 py-1 text-sm ${
                      step === s
                        ? 'bg-white text-[#4F46E5] shadow-sm'
                        : 'text-[#64748B] hover:text-[#334155]'
                    }`}
                  >
                    {s === 1 ? t('deliver.stepAssets') : t('deliver.stepDevices')}
                  </button>
                ))}
              </div>

              {step === 1 && (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs text-[#64748B]">
                      {t('deliver.selectAssets')}（{selectedAssets.size}）
                    </span>
                    <div className="flex gap-2">
                      <button type="button" onClick={selectAllAssets} className="text-xs text-[#4F46E5] hover:underline">
                        {t('deliver.selectAll')}
                      </button>
                      <button type="button" onClick={clearAssets} className="text-xs text-[#4F46E5] hover:underline">
                        {t('deliver.clear')}
                      </button>
                    </div>
                  </div>
                  <div className="max-h-64 overflow-auto rounded-md border border-[#E2E8F0]">
                    {assets.length === 0 ? (
                      <div className="px-3 py-6 text-center text-sm text-[#94A3B8]">{t('deliver.noAssets')}</div>
                    ) : (
                      assets.map((a) => {
                        const checked = selectedAssets.has(a.id);
                        return (
                          <label
                            key={a.id}
                            className={`flex cursor-pointer items-center gap-2 border-b border-[#E2E8F0] px-2 py-1.5 last:border-b-0 ${
                              checked ? 'bg-[#EEF2FF]' : 'bg-white'
                            }`}
                          >
                            <Checkbox
                              size="small"
                              checked={checked}
                              onChange={() => toggleAsset(a.id)}
                              sx={{ padding: '2px' }}
                            />
                            <span className="truncate text-sm text-[#0F172A]">{a.name}</span>
                            <span className="ml-auto shrink-0 rounded bg-[#F1F5F9] px-1.5 py-0.5 text-[10px] leading-4 text-[#64748B]">
                              {t(KIND_KEY[a.kind])} · v{a.version}
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {step === 2 && (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs text-[#64748B]">
                      {t('deliver.selectDevices')}（{selectedDevices.size}）
                    </span>
                    <div className="flex gap-2">
                      <button type="button" onClick={selectAllDevices} className="text-xs text-[#4F46E5] hover:underline">
                        {t('deliver.selectAll')}
                      </button>
                      <button type="button" onClick={clearDevices} className="text-xs text-[#4F46E5] hover:underline">
                        {t('deliver.clear')}
                      </button>
                    </div>
                  </div>
                  <div className="mb-2 text-xs text-[#94A3B8]">{t('deliver.offlineHint')}</div>
                  <div className="max-h-64 overflow-auto rounded-md border border-[#E2E8F0]">
                    {devices.length === 0 ? (
                      <div className="px-3 py-6 text-center text-sm text-[#94A3B8]">{t('deliver.noDevices')}</div>
                    ) : (
                      devices.map((d) => {
                        const checked = selectedDevices.has(d.deviceId);
                        return (
                          <label
                            key={d.deviceId}
                            className={`flex cursor-pointer items-center gap-2 border-b border-[#E2E8F0] px-2 py-1.5 last:border-b-0 ${
                              checked ? 'bg-[#EEF2FF]' : 'bg-white'
                            }`}
                          >
                            <Checkbox
                              size="small"
                              checked={checked}
                              onChange={() => toggleDevice(d.deviceId)}
                              sx={{ padding: '2px' }}
                            />
                            <div className="min-w-0">
                              <div className="truncate text-sm text-[#0F172A]">{d.name || d.hostname}</div>
                              <div className="truncate text-xs text-[#64748B]">
                                {d.deviceId} · {d.osPlatform}
                              </div>
                            </div>
                            <span className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-4 ${deviceStatusClass(d.status)}`}>
                              {t(deviceStatusKey(d.status))}
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {result && (
            <div className="rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-3">
              <div className="mb-1 text-sm font-semibold text-[#0F172A]">{t('deliver.requestCreated')}</div>
              <div className="text-xs text-[#64748B]">{result.summary}</div>
              <div className="mt-1 text-xs text-[#64748B]">
                {t('deliver.pendingStatus')}：{result.deliveryId}
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-md bg-[#FEE2E2] px-3 py-2 text-xs text-[#B91C1C]">{error}</div>
          )}
        </div>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit">
          {t('deliver.close')}
        </Button>
        {!result && step === 1 && (
          <Button onClick={() => setStep(2)} disabled={selectedAssets.size === 0} variant="contained">
            {t('deliver.next')}
          </Button>
        )}
        {!result && step === 2 && (
          <Button onClick={submit} disabled={busy || selectedDevices.size === 0} variant="contained">
            {busy ? t('deliver.submitting') : t('deliver.submit')}
          </Button>
        )}
        {result && (
          <Button onClick={confirm} disabled={busy} variant="contained">
            {busy ? t('deliver.confirming') : t('deliver.confirm')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
