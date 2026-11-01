import { useParams, useNavigate } from 'react-router-dom';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useDeviceStore } from '../store/deviceStore';
import { StatusBadge } from '../components/common/StatusBadge';
import { AgentIcon } from '../components/common/AgentIcon';

/**
 * 设备详情页（04 §E）。
 */
export default function DeviceDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const device = useDeviceStore((s) => s.devices.find((d) => d.deviceId === id));

  if (!device) {
    return (
      <div className="p-6">
        <button onClick={() => navigate('/devices')} className="mb-4 flex items-center gap-1 text-sm text-[#4F46E5]">
          <ArrowBackIcon fontSize="small" /> 返回
        </button>
        <div className="text-[#94A3B8]">设备不存在</div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <button onClick={() => navigate('/devices')} className="mb-4 flex items-center gap-1 text-sm text-[#4F46E5]">
        <ArrowBackIcon fontSize="small" /> 返回设备列表
      </button>

      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-semibold text-[#0F172A]">{device.name}</h1>
        <StatusBadge status={device.status} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-card border border-[#E2E8F0] bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-[#0F172A]">设备信息</h2>
          <Meta label="设备 ID" value={device.deviceId} />
          <Meta label="主机名" value={device.hostname} />
          <Meta label="系统" value={`${device.osPlatform} / ${device.osArch}`} />
          <Meta label="局域网地址" value={device.lanAddr ?? '—'} />
          <Meta label="CPU 负载" value={`${Math.round(device.load.cpu * 100)}%`} />
          <Meta label="内存负载" value={`${Math.round(device.load.mem * 100)}%`} />
          <Meta
            label="最后心跳"
            value={device.lastHeartbeat ? new Date(device.lastHeartbeat).toLocaleString('zh-CN') : '—'}
          />
        </div>

        <div className="rounded-card border border-[#E2E8F0] bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-[#0F172A]">已装 agent</h2>
          {device.agents.length === 0 ? (
            <div className="text-sm text-[#94A3B8]">暂无 agent</div>
          ) : (
            <div className="space-y-2">
              {device.agents.map((a) => (
                <div key={a.agentType} className="flex items-center justify-between rounded-md border border-[#E2E8F0] px-3 py-2">
                  <div className="flex items-center gap-2">
                    <AgentIcon agentType={a.agentType} />
                    <div>
                      <div className="text-sm font-medium text-[#0F172A]">{a.displayName}</div>
                      <div className="text-xs text-[#64748B]">v{a.version} · {a.capabilities.join(', ')}</div>
                    </div>
                  </div>
                  <StatusBadge status={a.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex justify-between border-b border-[#F1F5F9] py-2 text-sm">
      <span className="text-[#64748B]">{label}</span>
      <span className="break-all text-[#334155]">{value}</span>
    </div>
  );
}
