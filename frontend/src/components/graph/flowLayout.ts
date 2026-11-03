import type { GraphNode } from '../../hooks/useGraphData';

/**
 * 流程图布局（确定性，替代 d3-force 力导向）。
 *
 * 三层泳道：设备(左) → agent(中) → 任务(右)。
 *  - 设备垂直居中于其 agents 行块；
 *  - 每个 agent 占一行，其任务依次排在该 agent 下方（右列）；
 *  - 任务流向（call 右→左、stream 左→右）与粒子方向天然清晰。
 * 位置完全确定，数据刷新不抖动、连线不交叉乱窜。
 */

/** 节点卡片半宽/半高（连线端点偏移 + 列间距用） */
export const NODE_SIZE: Record<string, { hw: number; hh: number }> = {
  device: { hw: 96, hh: 26 },
  agent: { hw: 84, hh: 22 },
  task: { hw: 136, hh: 19 },
  message: { hw: 5, hh: 5 },
};

/** 三列卡片中心 x */
const COL_X = { device: 116, agent: 352, task: 668 } as const;

/** 行高、上下留白 */
const ROW_H = 72;
const PAD_TOP = 48;
const PAD_BOTTOM = 56;
const PAD_RIGHT = 64;

export interface FlowLayout {
  positions: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
}

export function computeFlowLayout(nodes: GraphNode[]): FlowLayout {
  const positions = new Map<string, { x: number; y: number }>();

  const devices = nodes.filter((n) => n.type === 'device').sort((a, b) => a.id.localeCompare(b.id));
  const agents = nodes.filter((n) => n.type === 'agent');
  const tasks = nodes.filter((n) => n.type === 'task');
  const messages = nodes.filter((n) => n.type === 'message');

  // agent 按所属设备分组；task 按目标 agent 分组
  const agentsByDevice = new Map<string, typeof agents>();
  for (const a of agents) {
    if (!agentsByDevice.has(a.deviceId)) agentsByDevice.set(a.deviceId, []);
    agentsByDevice.get(a.deviceId)!.push(a);
  }
  const tasksByAgent = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const key =
      t.data.targetDeviceId && t.data.targetAgentType
        ? `agent-${t.data.targetDeviceId}:${t.data.targetAgentType}`
        : '';
    if (!tasksByAgent.has(key)) tasksByAgent.set(key, []);
    tasksByAgent.get(key)!.push(t);
  }

  const placed = new Set<string>();
  let row = 0;

  const placeDevice = (device: (typeof devices)[number]): void => {
    const deviceAgents = (agentsByDevice.get(device.id) ?? []).sort((a, b) => a.id.localeCompare(b.id));
    if (deviceAgents.length === 0) {
      positions.set(device.id, { x: COL_X.device, y: PAD_TOP + row * ROW_H });
      placed.add(device.id);
      row += 1;
      return;
    }
    const agentRows: number[] = [];
    for (const agent of deviceAgents) {
      agentRows.push(row);
      positions.set(agent.id, { x: COL_X.agent, y: PAD_TOP + row * ROW_H });
      placed.add(agent.id);
      row += 1;
      const agentTasks = (tasksByAgent.get(agent.id) ?? []).sort(
        (a, b) => (a.data.createdAt ?? 0) - (b.data.createdAt ?? 0),
      );
      for (const t of agentTasks) {
        positions.set(t.id, { x: COL_X.task, y: PAD_TOP + row * ROW_H });
        placed.add(t.id);
        row += 1;
      }
    }
    // 设备垂直居中于其 agents（不含任务），设备↔agent 归属关系更清晰
    const firstAgentRow = agentRows[0];
    const lastAgentRow = agentRows[agentRows.length - 1];
    positions.set(device.id, {
      x: COL_X.device,
      y: PAD_TOP + ((firstAgentRow + lastAgentRow) / 2) * ROW_H,
    });
    placed.add(device.id);
    row += 1; // 设备间空一行，分隔泳道
  };

  for (const d of devices) placeDevice(d);

  // 孤儿 agent / task（无关联设备或 agent）兜底排到末尾
  for (const a of agents) {
    if (placed.has(a.id)) continue;
    positions.set(a.id, { x: COL_X.agent, y: PAD_TOP + row * ROW_H });
    placed.add(a.id);
    row += 1;
  }
  for (const t of tasks) {
    if (placed.has(t.id)) continue;
    positions.set(t.id, { x: COL_X.task, y: PAD_TOP + row * ROW_H });
    placed.add(t.id);
    row += 1;
  }

  // 消息流点：贴在对应任务右侧
  for (const m of messages) {
    const tp = positions.get(m.taskId);
    if (tp) {
      positions.set(m.id, { x: tp.x + NODE_SIZE.task.hw + 14, y: tp.y });
    } else {
      positions.set(m.id, { x: COL_X.task + NODE_SIZE.task.hw + 14, y: PAD_TOP + row * ROW_H });
      row += 1;
    }
  }

  const height = PAD_TOP + Math.max(row, 1) * ROW_H + PAD_BOTTOM;
  const width = COL_X.task + NODE_SIZE.task.hw + PAD_RIGHT;

  return { positions, width, height };
}
