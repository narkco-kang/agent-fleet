import { useEffect, useState, type ReactNode } from 'react';
import Drawer from '@mui/material/Drawer';
import Button from '@mui/material/Button';
import CloseIcon from '@mui/icons-material/Close';
import { useDeviceStore } from '../../store/deviceStore';
import { useTaskStore } from '../../store/taskStore';
import { StatusBadge } from '../common/StatusBadge';
import { http } from '../../api/http';
import { onLogin, type LoginChallengeMsg, type LoginResultMsg } from '../../api/ws';
import { loginMethodFor, type AgentType } from '@agentfleet/shared';

/**
 * 右侧详情抽屉（04 §3.6）：点神经图节点后展开该节点详情。
 * agent 节点额外提供「打开平台应用登录激活」入口。
 */
export type DetailTarget =
  | { kind: 'device'; id: string; title: string }
  | { kind: 'agent'; id: string; title: string; deviceId: string; agentType: string }
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
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-[var(--text-strong)]">{target.title}</div>
          <div className="text-xs text-[var(--text-muted)]">{target.kind}</div>
        </div>
        <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-strong)]">
          <CloseIcon fontSize="small" />
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {target.kind === 'device' && <DeviceDetail deviceId={target.id} />}
        {target.kind === 'task' && <TaskDetail taskId={target.id} />}
        {target.kind === 'agent' && <AgentDetail target={target} />}
        {target.kind === 'message' && (
          <div className="text-sm text-[var(--text)]">消息流节点：{target.title}</div>
        )}
      </div>
    </div>
  );
}

function DeviceDetail({ deviceId }: { deviceId: string }): ReactNode {
  const device = useDeviceStore((s) => s.devices.find((d) => d.deviceId === deviceId));
  if (!device) return <div className="text-sm text-[var(--text-muted)]">设备不存在</div>;
  return (
    <div className="space-y-3">
      <StatusBadge status={device.status} />
      <InfoRow label="设备 ID" value={device.deviceId} />
      <InfoRow label="主机名" value={device.hostname} />
      <InfoRow label="系统" value={`${device.osPlatform}/${device.osArch}`} />
      <InfoRow label="CPU 负载" value={`${Math.round(device.load.cpu * 100)}%`} />
      <InfoRow label="内存负载" value={`${Math.round(device.load.mem * 100)}%`} />
      <div className="text-xs font-semibold text-[var(--text-strong)]">已装 agent</div>
      {device.agents.map((a) => (
        <div key={a.agentType} className="flex items-center justify-between rounded-md border border-[var(--border)] px-3 py-2">
          <span className="text-sm">{a.displayName}</span>
          <StatusBadge status={a.status} />
        </div>
      ))}
    </div>
  );
}

function TaskDetail({ taskId }: { taskId: string }): ReactNode {
  const task = useTaskStore((s) => s.tasks.find((t) => t.taskId === taskId));
  if (!task) return <div className="text-sm text-[var(--text-muted)]">任务不存在</div>;
  return (
    <div className="space-y-3">
      <StatusBadge status={task.status} />
      <InfoRow label="提示词" value={task.prompt} />
      <InfoRow label="目标" value={`${task.targetDeviceId ?? 'auto'} / ${task.targetAgentType ?? 'auto'}`} />
      {task.agentProfile && <InfoRow label="bot" value={task.agentProfile} />}
      <InfoRow label="发起" value={task.origin} />
    </div>
  );
}

function AgentDetail({ target }: { target: { deviceId: string; title: string; agentType: string } }): ReactNode {
  const device = useDeviceStore((s) => s.devices.find((d) => d.deviceId === target.deviceId));
  const agent = device?.agents.find((a) => a.agentType === target.agentType) ?? device?.agents.find((a) => a.displayName === target.title);
  const [opening, setOpening] = useState(false);
  const [openMsg, setOpenMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // 看板授权中心：device-auth 登录挑战（URL + code）与结果
  const [loginChallenge, setLoginChallenge] = useState<LoginChallengeMsg | null>(null);
  const [loginResult, setLoginResult] = useState<LoginResultMsg | null>(null);
  const [requesting, setRequesting] = useState(false);
  const deviceOnline = device?.status === 'online' || device?.status === 'busy';
  // 登录授权方式：device-auth（看板 URL+code）/ app（桌面应用）/ cli（终端）/ api-key（手动配 key）
  const loginMethod = loginMethodFor(target.agentType as AgentType);

  // 监听设备登录授权消息（challenge / result），仅处理当前 agent
  useEffect(() => {
    return onLogin((msg) => {
      if (msg.data.deviceId !== target.deviceId || msg.data.agentType !== target.agentType) return;
      if (msg.kind === 'challenge') {
        setLoginChallenge(msg.data);
        setLoginResult(null);
      } else if (msg.kind === 'result') {
        setLoginResult(msg.data);
        if (msg.data.status === 'success') setLoginChallenge(null);
      }
    });
  }, [target.deviceId, target.agentType]);

  const openPlatform = async (): Promise<void> => {
    setOpening(true);
    setOpenMsg(null);
    try {
      await http.openPlatform(target.deviceId, target.agentType);
      setOpenMsg({ ok: true, text: '已发送打开指令，请在设备上完成登录激活' });
    } catch (err) {
      setOpenMsg({ ok: false, text: (err as Error).message });
    } finally {
      setOpening(false);
    }
  };

  const requestLogin = async (): Promise<void> => {
    setRequesting(true);
    setLoginChallenge(null);
    setLoginResult(null);
    try {
      await http.requestDeviceLogin(target.deviceId, target.agentType);
    } catch (err) {
      setLoginResult({
        deviceId: target.deviceId,
        agentType: target.agentType,
        status: 'failed',
        message: (err as Error).message,
      });
    } finally {
      setRequesting(false);
    }
  };

  if (!agent) return <div className="text-sm text-[var(--text-muted)]">Agent 不存在</div>;
  const activated = agent.activated;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <StatusBadge status={agent.status} />
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${
            activated ? 'bg-[var(--success-soft)] text-[#15803D]' : 'bg-[var(--warning-soft)] text-[#B45309]'
          }`}
        >
          {activated ? '已激活' : '待激活（需登录）'}
        </span>
      </div>
      <InfoRow label="平台" value={agent.agentType} />
      <InfoRow label="版本" value={agent.version} />
      <InfoRow label="可执行" value={agent.executable} />
      <InfoRow label="能力" value={agent.capabilities.join(', ')} />
      {agent.bots && agent.bots.length > 0 && (
        <InfoRow
          label="可用 bot"
          value={agent.bots.map((b) => (b.description ? `${b.name}（${b.description}）` : b.name)).join('、')}
        />
      )}
      <InfoRow label="并发" value={`${agent.busyCount}/${agent.maxConcurrency}`} />

      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
        {!deviceOnline ? (
          <div className="text-xs text-[var(--text-muted)]">
            设备当前离线，无法登录授权。请先让该设备上线（运行 device-agent 并连接协调服务）后再试。
          </div>
        ) : activated ? (
          <div className="text-xs text-[var(--text-muted)]">已激活。如登录态失效需重新登录，可重新发起授权。</div>
        ) : loginMethod === 'device-auth' ? (
          <>
            <div className="text-xs font-semibold text-[var(--text-strong)]">看板授权（无需碰设备）</div>
            <div className="mt-1 text-xs text-[var(--text-muted)]">直接在本看板完成浏览器授权，无需远程登录设备。</div>
            {!loginChallenge && !loginResult && (
              <Button size="small" variant="outlined" fullWidth disabled={requesting} onClick={requestLogin} sx={{ mt: 1.5 }}>
                {requesting ? '发起登录中…' : '发起登录授权'}
              </Button>
            )}
            {loginChallenge && (
              <div className="mt-2 space-y-1.5">
                <div className="text-xs text-[var(--text)]">1. 打开链接并登录你的账号</div>
                <a href={loginChallenge.url} target="_blank" rel="noreferrer" className="block truncate text-xs text-[#4F46E5] underline">
                  {loginChallenge.url}
                </a>
                <div className="text-xs text-[var(--text)]">2. 输入下方一次性授权码</div>
                <div className="flex items-center gap-2">
                  <code className="rounded bg-[var(--brand-soft)] px-2 py-1 text-sm font-bold tracking-widest text-[#4F46E5]">
                    {loginChallenge.code}
                  </code>
                  <button
                    onClick={() => void navigator.clipboard?.writeText(loginChallenge.code)}
                    className="text-xs text-[#4F46E5] hover:underline"
                  >
                    复制
                  </button>
                </div>
                <div className="text-xs text-[var(--text-muted)]">授权成功后自动激活，正在等待…</div>
              </div>
            )}
            {loginResult && (
              <div
                className={`mt-2 rounded-md px-2 py-1.5 text-xs ${
                  loginResult.status === 'success'
                    ? 'bg-[var(--success-soft)] text-[#15803D]'
                    : 'bg-[var(--danger-soft)] text-[#B91C1C]'
                }`}
              >
                {loginResult.status === 'success'
                  ? '授权成功，该 agent 已激活'
                  : loginResult.status === 'timeout'
                    ? '授权超时（一次性码 15 分钟过期），请重新发起'
                    : `登录失败：${loginResult.message ?? loginResult.status}`}
              </div>
            )}
          </>
        ) : loginMethod === 'app' || loginMethod === 'cli' ? (
          <>
            <div className="text-xs text-[var(--text-muted)]">
              {loginMethod === 'app'
                ? '该平台需在桌面应用内登录。点击下方按钮，本设备会弹出对应桌面应用，完成登录后即自动激活。'
                : '该平台需在终端内登录。点击下方按钮，本设备会打开终端运行 CLI，完成登录后即自动激活。'}
            </div>
            <Button size="small" variant="contained" fullWidth disabled={opening} onClick={openPlatform} sx={{ mt: 1.5 }}>
              {opening ? '打开中…' : loginMethod === 'app' ? '打开桌面应用登录' : '打开终端登录'}
            </Button>
            {openMsg && (
              <div
                className={`mt-2 rounded-md px-2 py-1.5 text-xs ${
                  openMsg.ok ? 'bg-[var(--success-soft)] text-[#15803D]' : 'bg-[var(--danger-soft)] text-[#B91C1C]'
                }`}
              >
                {openMsg.text}
              </div>
            )}
          </>
        ) : (
          <div className="text-xs text-[var(--text-muted)]">
            该平台无交互式登录，需在设备上手动配置 API key（环境变量或平台配置）后才能使用。
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div>
      <div className="text-xs text-[var(--text-muted)]">{label}</div>
      <div className="break-all text-sm text-[var(--text)]">{value}</div>
    </div>
  );
}
