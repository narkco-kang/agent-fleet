import type { ReactNode } from 'react';
import Drawer from '@mui/material/Drawer';
import CloseIcon from '@mui/icons-material/Close';
import { useDeviceStore } from '../../store/deviceStore';
import { useTaskStore } from '../../store/taskStore';
import { StatusBadge } from '../common/StatusBadge';

/**
 * 右侧详情抽屉（04 §3.6）：点神经图节点后展开该节点详情。
 */
export type DetailTarget =
  | { kind: 'device'; id: string; title: string }
  | { kind: 'agent'; id: string; title: string; deviceId: string }
  | { kind: 'task'; id: string; title: string }
  | { kind: 'message'; id: string; title: string };

export function DetailDrawer({
  target,
  onClose,
}: {
  target: DetailTarget | null;
  onClose: () => void;
}): JSX.Element {
  return (
    <Drawer
      anchor="right"
      open={!!target}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', sm: 360 } } }}
    >
      {target && <DetailContent target={target} onClose={onClose} />}
    </Drawer>
  );
}

function DetailContent({ target, onClose }: { target: DetailTarget; onClose: () => void }): ReactNode {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[#E2E8F0] px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-[#0F172A]">{target.title}</div>
          <div className="text-xs text-[#64748B]">{target.kind}</div>
        </div>
        <button onClick={onClose} className="text-[#64748B] hover:text-[#0F172A]">
          <CloseIcon fontSize="small" />
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {target.kind === 'device' && <DeviceDetail deviceId={target.id} />}
        {target.kind === 'task' && <TaskDetail taskId={target.id} />}
        {target.kind === 'agent' && <AgentDetail target={target} />}
        {target.kind === 'message' && (
          <div className="text-sm text-[#334155]">消息流节点：{target.title}</div>
        )}
      </div>
    </div>
  );
}

function DeviceDetail({ deviceId }: { deviceId: string }): ReactNode {
  const device = useDeviceStore((s) => s.devices.find((d) => d.deviceId === deviceId));
  if (!device) return <div className="text-sm text-[#94A3B8]">设备不存在</div>;
  return (
    <div className="space-y-3">
      <StatusBadge status={device.status} />
      <InfoRow label="设备 ID" value={device.deviceId} />
      <InfoRow label="主机名" value={device.hostname} />
      <InfoRow label="系统" value={`${device.osPlatform}/${device.osArch}`} />
      <InfoRow label="CPU 负载" value={`${Math.round(device.load.cpu * 100)}%`} />
      <InfoRow label="内存负载" value={`${Math.round(device.load.mem * 100)}%`} />
      <div className="text-xs font-semibold text-[#0F172A]">已装 agent</div>
      {device.agents.map((a) => (
        <div key={a.agentType} className="flex items-center justify-between rounded-md border border-[#E2E8F0] px-3 py-2">
          <span className="text-sm">{a.displayName}</span>
          <StatusBadge status={a.status} />
        </div>
      ))}
    </div>
  );
}

function TaskDetail({ taskId }: { taskId: string }): ReactNode {
  const task = useTaskStore((s) => s.tasks.find((t) => t.taskId === taskId));
  if (!task) return <div className="text-sm text-[#94A3B8]">任务不存在</div>;
  return (
    <div className="space-y-3">
      <StatusBadge status={task.status} />
      <InfoRow label="提示词" value={task.prompt} />
      <InfoRow label="目标" value={`${task.targetDeviceId ?? 'auto'} / ${task.targetAgentType ?? 'auto'}`} />
      <InfoRow label="发起" value={task.origin} />
    </div>
  );
}

function AgentDetail({ target }: { target: { deviceId: string; title: string } }): ReactNode {
  const device = useDeviceStore((s) => s.devices.find((d) => d.deviceId === target.deviceId));
  const agent = device?.agents.find((a) => a.displayName === target.title);
  if (!agent) return <div className="text-sm text-[#94A3B8]">Agent 不存在</div>;
  return (
    <div className="space-y-3">
      <StatusBadge status={agent.status} />
      <InfoRow label="平台" value={agent.agentType} />
      <InfoRow label="版本" value={agent.version} />
      <InfoRow label="可执行" value={agent.executable} />
      <InfoRow label="能力" value={agent.capabilities.join(', ')} />
      <InfoRow label="并发" value={`${agent.busyCount}/${agent.maxConcurrency}`} />
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div>
      <div className="text-xs text-[#94A3B8]">{label}</div>
      <div className="break-all text-sm text-[#334155]">{value}</div>
    </div>
  );
}
