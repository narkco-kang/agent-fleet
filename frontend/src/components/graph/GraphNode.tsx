import type { SimNode } from './NeuralGraph';

/**
 * 节点渲染（04 §4.2）：
 * 设备圆(Indigo) / agent 圆角方(Violet) / 任务菱形(Cyan/状态色) / 消息流光点。
 * 在线设备与运行中任务外圈脉冲。
 */
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
  /** 透镜命中的类别节点：叠加虚线高亮环 */
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

  const stroke = focused ? '#4F46E5' : 'transparent';
  const strokeWidth = focused ? 3 : 0;
  const lensRadius = node.type === 'device' ? 26 : node.type === 'agent' ? 20 : 17;

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
        <circle
          cx={node.x}
          cy={node.y}
          r={lensRadius}
          fill="none"
          stroke="#4F46E5"
          strokeWidth={1.5}
          strokeDasharray="3 3"
          opacity={0.7}
        />
      )}
      {node.type === 'device' && (
        <DeviceGlyph node={node} pulse={pulse} stroke={stroke} strokeWidth={strokeWidth} />
      )}
      {node.type === 'agent' && (
        <AgentGlyph node={node} stroke={stroke} strokeWidth={strokeWidth} />
      )}
      {node.type === 'task' && (
        <TaskGlyph node={node} pulse={pulse} stroke={stroke} strokeWidth={strokeWidth} />
      )}
      {node.type === 'message' && <MessageGlyph node={node} />}
    </g>
  );
}

function DeviceGlyph({ node, pulse, stroke, strokeWidth }: { node: SimNode; pulse: boolean; stroke: string; strokeWidth: number }): JSX.Element {
  const statusColor =
    node.type === 'device'
      ? node.data.status === 'online'
        ? '#10B981'
        : node.data.status === 'busy'
          ? '#F59E0B'
          : '#94A3B8'
      : '#4F46E5';
  return (
    <g>
      {pulse && (
        <circle cx={node.x} cy={node.y} r={22} fill="none" stroke={statusColor} className="pulse-ring" />
      )}
      <circle cx={node.x} cy={node.y} r={22} fill="#4F46E5" stroke={statusColor} strokeWidth={2.5} />
      <circle cx={node.x} cy={node.y} r={22} fill="none" stroke={stroke} strokeWidth={strokeWidth} />
      <text x={node.x} y={node.y + 5} textAnchor="middle" fill="#fff" fontSize="13">
        💻
      </text>
    </g>
  );
}

function AgentGlyph({ node, stroke, strokeWidth }: { node: SimNode; stroke: string; strokeWidth: number }): JSX.Element {
  const busy = node.type === 'agent' && node.data.status === 'busy';
  const error = node.type === 'agent' && node.data.status === 'error';
  const needsLogin =
    node.type === 'agent' && (node.data.status === 'needs_login' || !(node.data.activated as boolean | undefined));
  const fill = busy ? '#F59E0B' : error ? '#EF4444' : needsLogin ? '#94A3B8' : '#7C3AED';
  const size = 28;
  return (
    <g>
      {/* 处理中：黄色脉冲外框 */}
      {busy && (
        <rect
          x={node.x - size / 2 - 5}
          y={node.y - size / 2 - 5}
          width={size + 10}
          height={size + 10}
          rx={9}
          fill="none"
          stroke="#F59E0B"
          strokeWidth={1.6}
        >
          <animate attributeName="opacity" values="0.85;0.15;0.85" dur="1.3s" repeatCount="indefinite" />
        </rect>
      )}
      {/* 异常：红色闪烁警示框 */}
      {error && (
        <rect
          x={node.x - size / 2 - 4}
          y={node.y - size / 2 - 4}
          width={size + 8}
          height={size + 8}
          rx={8}
          fill="none"
          stroke="#EF4444"
          strokeWidth={1.6}
          strokeDasharray="3 3"
        >
          <animate attributeName="opacity" values="1;0.35;1" dur="0.8s" repeatCount="indefinite" />
        </rect>
      )}
      <rect
        x={node.x - size / 2}
        y={node.y - size / 2}
        width={size}
        height={size}
        rx={7}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      <text x={node.x} y={node.y + 5} textAnchor="middle" fill="#fff" fontSize="12" fontWeight={600}>
        {node.type === 'agent' ? agentInitial(node.data.agentType) : ''}
      </text>
    </g>
  );
}

function TaskGlyph({ node, pulse, stroke, strokeWidth }: { node: SimNode; pulse: boolean; stroke: string; strokeWidth: number }): JSX.Element {
  const failed =
    node.type === 'task' &&
    (node.data.status === 'failed' || node.data.status === 'interrupted' || node.data.status === 'cancelled');
  const color =
    node.type === 'task'
      ? node.data.status === 'running'
        ? '#F59E0B'
        : node.data.status === 'completed'
          ? '#10B981'
          : failed
            ? '#EF4444'
            : '#94A3B8'
      : '#0891B2';
  const r = 12;
  const pts = `${node.x},${node.y - r} ${node.x + r},${node.y} ${node.x},${node.y + r} ${node.x - r},${node.y}`;
  return (
    <g>
      {pulse && <circle cx={node.x} cy={node.y} r={16} fill="none" stroke={color} className="pulse-ring" />}
      {/* 失败任务：红色闪烁警示环 */}
      {failed && (
        <circle cx={node.x} cy={node.y} r={17} fill="none" stroke="#EF4444" strokeWidth={1.5} strokeDasharray="3 3">
          <animate attributeName="opacity" values="1;0.3;1" dur="0.9s" repeatCount="indefinite" />
        </circle>
      )}
      <polygon points={pts} fill={color} stroke={stroke} strokeWidth={strokeWidth} />
      <text x={node.x} y={node.y + 4} textAnchor="middle" fill="#fff" fontSize="9">
        ◆
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
    default:
      return '?';
  }
}
