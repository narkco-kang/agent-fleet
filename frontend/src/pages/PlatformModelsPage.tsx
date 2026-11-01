import { useCallback, useEffect, useState } from 'react';
import type { PlatformModelBinding } from '@agentmesh/shared';
import { http } from '../api/http';
import { routingApi } from '../api/routing';
import { Card } from '../components/common/Card';
import {
  DevicePlatformList,
  type DeviceWithAgents,
  type DeviceAgentSelection,
} from '../components/platformmodels/DevicePlatformList';
import { ModelEditorPanel } from '../components/platformmodels/ModelEditorPanel';

/**
 * 平台模型绑定页：设备+平台 → 网关模型（部署完成即用 / 故障切换）。
 */
export default function PlatformModelsPage(): JSX.Element {
  const [devices, setDevices] = useState<DeviceWithAgents[]>([]);
  const [bindings, setBindings] = useState<PlatformModelBinding[]>([]);
  const [selected, setSelected] = useState<DeviceAgentSelection | null>(null);

  const loadBindings = useCallback(() => {
    routingApi
      .platformModels()
      .then((r) => setBindings(r.data))
      .catch(() => setBindings([]));
  }, []);

  useEffect(() => {
    http
      .getDevices()
      .then((r) => setDevices(r.data))
      .catch(() => setDevices([]));
    loadBindings();
  }, [loadBindings]);

  return (
    <div className="p-4 md:p-6">
      <h1 className="mb-4 text-xl font-semibold text-[#0F172A]">平台模型绑定</h1>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-0">
          <div className="border-b border-[#E2E8F0] px-4 py-3 text-sm font-semibold text-[#0F172A]">
            设备与 agent 平台
          </div>
          <DevicePlatformList devices={devices} selected={selected} onSelect={setSelected} />
        </Card>
        <Card className="p-4">
          <div className="mb-3 text-sm font-semibold text-[#0F172A]">模型绑定编辑</div>
          <ModelEditorPanel selected={selected} bindings={bindings} onChanged={loadBindings} />
        </Card>
      </div>
    </div>
  );
}
