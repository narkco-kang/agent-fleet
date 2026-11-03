import type { SimNode } from './NeuralGraph';
import { NODE_SIZE } from './flowLayout';
import type { GraphDeviceNode, GraphAgentNode, GraphTaskNode } from '../../hooks/useGraphData';

type SimDevice = GraphDeviceNode & { x: number; y: number; vx: number; vy: number };
type SimAgent = GraphAgentNode & { x: number; y: number; vx: number; vy: number };
type SimTask = GraphTaskNode & { x: number; y: number; vx: number; vy: number };

/**
 * 流程图卡片式节点（带文字标签，替代纯图标节点）。
 * 设备(圆角卡) / agent(圆角卡+首字母色块) / 任务(圆角卡+状态菱形) / 消息(流光点)。
 * 状态色：在线=绿、忙碌/运行中=黄、异常/失败=红、待登录/离线/排队=灰。
 */

const STATUS_COLOR: Record<string, string> = {
  online: '#10B981',
  busy: '#F59E0B',
  offline: '#94A3B8',
  idle: '#7C3AED',
  error: '#EF4444',
  needs_login: '#94A3B8',
  queued: '#94A3B8',
  running: '#F59E0B',
  completed: '#10B981',
  failed: '#EF4444',
  cancelled: '#EF4444',
  interrupted: '#EF4444',
};

const STATUS_LABEL: Record<string, string> = {
  online: '在线',
  busy: '忙碌',
  offline: '离线',
  idle: '空闲',
  error: '异常',
  needs_login: '待登录',
  queued: '排队',
  running: '运行中',
  completed: '完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '中断',
};

function truncate(s: string, n: number): string {
  return s && s.length > n ? `${s.slice(0, n - 1)}…` : s ?? '';
}

export function NodeShape({
  node,
  dimmed,
  focused,
  lensActive = false,
  onMouseEnter,
  onMouseLeave,
  onClick,
  onPointerDown,
}: {
  node: SimNode;
  dimmed: boolean;
  focused: boolean;
  lensActive?: boolean;
  onMouseEnter: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
  onClick: (e: React.MouseEvent) => void;
  onPointerDown: (e: React.PointerEvent) => void;
}): JSX.Element {
  const opacity = dimmed ? 0.15 : 1;
  const pulse = node.type === 'device'
    ? (node.data.status === 'online' || node.data.status === 'busy')
    : node.type === 'task' && node.data.status === 'running';

  const lensRadius = node.type === 'device' ? NODE_SIZE.device.hw + 6 : node.type === 'agent' ? NODE_SIZE.agent.hw + 6 : NODE_SIZE.task.hw + 6;

  return (
    <g
      data-node={node.id}
      style={{ cursor: 'pointer' }}
      opacity={opacity}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      onPointerDown={onPointerDown}
    >
      {lensActive && (
        <rect
          x={node.x - lensRadius}
          y={node.y - NODE_SIZE[node.type].hh - 4}
          width={lensRadius * 2}
          height={NODE_SIZE[node.type].hh * 2 + 8}
          rx={12}
          fill="none"
          stroke="#4F46E5"
          strokeWidth={1.5}
          strokeDasharray="3 3"
          opacity={0.7}
        />
      )}
      {node.type === 'device' && <DeviceCard node={node} focused={focused} pulse={pulse} />}
      {node.type === 'agent' && <AgentCard node={node} focused={focused} />}
      {node.type === 'task' && <TaskCard node={node} focused={focused} pulse={pulse} />}
      {node.type === 'message' && <MessageGlyph node={node} />}
    </g>
  );
}

function DeviceCard({ node, focused, pulse }: { node: SimDevice; focused: boolean; pulse: boolean }): JSX.Element {
  const s = NODE_SIZE.device;
  const x = node.x;
  const y = node.y;
  const color = STATUS_COLOR[node.data.status] ?? '#94A3B8';
  const label = STATUS_LABEL[node.data.status] ?? node.data.status;
  const stroke = focused ? '#4F46E5' : color;
  return (
    <g>
      {pulse && (
        <rect x={x - s.hw - 4} y={y - s.hh - 4} width={s.hw * 2 + 8} height={s.hh * 2 + 8} rx={14} fill="none" stroke={color} className="pulse-ring" />
      )}
      <rect x={x - s.hw} y={y - s.hh} width={s.hw * 2} height={s.hh * 2} rx={12} fill="#FFFFFF" stroke={stroke} strokeWidth={focused ? 2.5 : 1.5} />
      <circle cx={x - s.hw + 24} cy={y} r={15} fill={color} />
      <text x={x - s.hw + 24} y={y + 5} textAnchor="middle" fontSize="13">
        💻
      </text>
      <text x={x - s.hw + 46} y={y - 3} fill="#0F172A" fontSize="12" fontWeight={600}>
        {truncate(node.data.name, 15)}
      </text>
      <text x={x - s.hw + 46} y={y + 13} fill={color} fontSize="10" fontWeight={500}>
        {label} · {Math.round(node.data.load.cpu * 100)}%
      </text>
    </g>
  );
}

function AgentCard({ node, focused }: { node: SimAgent; focused: boolean }): JSX.Element {
  const s = NODE_SIZE.agent;
  const x = node.x;
  const y = node.y;
  const isBusy = node.data.status === 'busy';
  const isError = node.data.status === 'error';
  const needsLogin = node.data.status === 'needs_login' || !(node.data.activated as boolean | undefined);
  const color = isBusy ? '#F59E0B' : isError ? '#EF4444' : needsLogin ? '#94A3B8' : '#7C3AED';
  const label = isBusy ? '处理中' : isError ? '异常' : needsLogin ? '待登录' : '空闲';
  const stroke = focused ? '#4F46E5' : color;
  return (
    <g>
      {isBusy && (
        <rect x={x - s.hw - 5} y={y - s.hh - 5} width={s.hw * 2 + 10} height={s.hh * 2 + 10} rx={12} fill="none" stroke="#F59E0B" strokeWidth={1.6}>
          <animate attributeName="opacity" values="0.85;0.15;0.85" dur="1.3s" repeatCount="indefinite" />
        </rect>
      )}
      {isError && (
        <rect x={x - s.hw - 4} y={y - s.hh - 4} width={s.hw * 2 + 8} height={s.hh * 2 + 8} rx={11} fill="none" stroke="#EF4444" strokeWidth={1.6} strokeDasharray="3 3">
          <animate attributeName="opacity" values="1;0.35;1" dur="0.8s" repeatCount="indefinite" />
        </rect>
      )}
      <rect x={x - s.hw} y={y - s.hh} width={s.hw * 2} height={s.hh * 2} rx={10} fill="#FFFFFF" stroke={stroke} strokeWidth={focused ? 2.5 : 1.5} />
      <rect x={x - s.hw} y={y - s.hh} width={30} height={s.hh * 2} rx={10} fill={color} />
      <text x={x - s.hw + 15} y={y + 4} textAnchor="middle" fill="#fff" fontSize="12" fontWeight={600}>
        {agentInitial(node.data.agentType)}
      </text>
      <text x={x - s.hw + 40} y={y - 3} fill="#0F172A" fontSize="12" fontWeight={600}>
        {truncate(node.data.displayName, 13)}
      </text>
      <text x={x - s.hw + 40} y={y + 13} fill={color} fontSize="10" fontWeight={500}>
        {label}
        {isBusy ? ` · ${node.data.busyCount}/${node.data.maxConcurrency}` : ''}
      </text>
    </g>
  );
}

function TaskCard({ node, focused, pulse }: { node: SimTask; focused: boolean; pulse: boolean }): JSX.Element {
  const s = NODE_SIZE.task;
  const x = node.x;
  const y = node.y;
  const st = node.data.status;
  const failed = st === 'failed' || st === 'interrupted' || st === 'cancelled';
  const color = STATUS_COLOR[st] ?? '#94A3B8';
  const label = STATUS_LABEL[st] ?? st;
  const stroke = focused ? '#4F46E5' : color;
  return (
    <g>
      {pulse && <circle cx={x - s.hw + 10} cy={y} r={8} fill="none" stroke={color} className="pulse-ring" />}
      {failed && (
        <rect x={x - s.hw - 3} y={y - s.hh - 3} width={s.hw * 2 + 6} height={s.hh * 2 + 6} rx={10} fill="none" stroke="#EF4444" strokeWidth={1.5} strokeDasharray="3 3">
          <animate attributeName="opacity" values="1;0.3;1" dur="0.9s" repeatCount="indefinite" />
        </rect>
      )}
      <rect x={x - s.hw} y={y - s.hh} width={s.hw * 2} height={s.hh * 2} rx={9} fill="#FFFFFF" stroke={stroke} strokeWidth={focused ? 2.5 : 1.4} />
      <polygon
        points={`${x - s.hw + 10},${y - 7} ${x - s.hw + 17},${y} ${x - s.hw + 10},${y + 7} ${x - s.hw + 3},${y}`}
        fill={color}
      />
      <text x={x - s.hw + 26} y={y + 4} fill="#334155" fontSize="11">
        {truncate(node.data.prompt, 26)}
      </text>
      <text x={x + s.hw - 6} y={y + 4} textAnchor="end" fill={color} fontSize="10" fontWeight={600}>
        {label}
      </text>
    </g>
  );
}

function MessageGlyph({ node }: { node: SimNode }): JSX.Element {
  return (
    <g>
      <circle cx={node.x} cy={node.y} r={3.5} fill="#0891B2" className="flow-dot" />
      <circle cx={node.x} cy={node.y} r={6} fill="none" stroke="#0891B2" opacity={0.4} />
    </g>
  );
}

function agentInitial(agentType: string): string {
  switch (agentType) {
    case 'codex':
      return 'C';
    case 'claude':
      return 'Cℓ';
    case 'dsh':
      return 'D';
    case 'grok':
      return 'G';
    case 'cursor':
      return 'Cu';
    case 'aider':
      return 'A';
    case 'gemini':
      return 'Ge';
    case 'cody':
      return 'Co';
    case 'qwen':
      return 'Q';
    case 'doubao':
      return '豆';
    case 'kimi':
      return 'K';
    case 'opencode':
      return 'Op';
    case 'windsurf':
      return 'W';
    case 'workbuddy':
      return 'Wb';
    default:
      return '?';
  }
}
