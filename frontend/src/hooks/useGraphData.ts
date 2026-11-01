import { useMemo } from 'react';
import { useDeviceStore, type DeviceRecord } from '../store/deviceStore';
import { useTaskStore } from '../store/taskStore';
import type { AgentSnapshot, DeviceSnapshot, TaskSnapshot } from '@agentmesh/shared';

/**
 * 把 store 中的设备/agent/任务/消息流映射为 d3-force 的 nodes/links。
 *
 * 节点四类：device（圆）/ agent（圆角方）/ task（菱形）/ message（流光点）。
 * 连线四类：call / return / stream / belongs。
 */
export type GraphNodeType = 'device' | 'agent' | 'task' | 'message';
export type GraphLinkKind = 'call' | 'return' | 'stream' | 'belongs';

export interface GraphDeviceNode {
  id: string;
  type: 'device';
  data: DeviceSnapshot;
}
export interface GraphAgentNode {
  id: string;
  type: 'agent';
  data: AgentSnapshot;
  deviceId: string;
}
export interface GraphTaskNode {
  id: string;
  type: 'task';
  data: TaskSnapshot;
}
export interface GraphMessageNode {
  id: string;
  type: 'message';
  taskId: string;
  seq: number;
  eventType: string;
}

export type GraphNode = GraphDeviceNode | GraphAgentNode | GraphTaskNode | GraphMessageNode;

export interface GraphLink {
  id: string;
  source: string;
  target: string;
  kind: GraphLinkKind;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

/** 消息流节点：仅保留每个运行中任务最近一条事件 */
function messageNodes(tasks: TaskSnapshot[], events: Record<string, unknown[]>): GraphMessageNode[] {
  const out: GraphMessageNode[] = [];
  for (const t of tasks) {
    if (t.status !== 'running') continue;
    const evs = (events[t.taskId] ?? []) as Array<{ seq: number; eventType: string }>;
    const latest = evs[evs.length - 1];
    if (latest) {
      out.push({
        id: `msg-${t.taskId}-${latest.seq}`,
        type: 'message',
        taskId: t.taskId,
        seq: latest.seq,
        eventType: latest.eventType,
      });
    }
  }
  return out;
}

export function useGraphData(): GraphData {
  const devices = useDeviceStore((s) => s.devices);
  const tasks = useTaskStore((s) => s.tasks);
  const events = useTaskStore((s) => s.events);

  return useMemo(() => {
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];

    // 设备节点
    for (const d of devices) {
      nodes.push({ id: d.deviceId, type: 'device', data: d });
    }

    // agent 节点 + belongs（设备↔agent）
    const agentByKey = new Map<string, AgentSnapshot>();
    for (const d of devices) {
      for (const a of d.agents) {
        const key = `${d.deviceId}:${a.agentType}`;
        const id = `agent-${key}`;
        agentByKey.set(key, a);
        nodes.push({ id, type: 'agent', data: a, deviceId: d.deviceId });
        links.push({ id: `belongs-${d.deviceId}-${id}`, source: d.deviceId, target: id, kind: 'belongs' });
      }
    }

    // 任务节点 + belongs（agent↔任务）+ call/return/stream
    for (const t of tasks) {
      const id = t.taskId;
      nodes.push({ id, type: 'task', data: t });
      const agentNodeId = t.targetDeviceId && t.targetAgentType
        ? `agent-${t.targetDeviceId}:${t.targetAgentType}`
        : null;
      if (agentNodeId && nodes.some((n) => n.id === agentNodeId)) {
        links.push({ id: `belongs-${agentNodeId}-${id}`, source: agentNodeId, target: id, kind: 'belongs' });
        if (t.status === 'running') {
          links.push({ id: `call-${id}-${agentNodeId}`, source: id, target: agentNodeId, kind: 'call' });
          links.push({ id: `stream-${agentNodeId}-${id}`, source: agentNodeId, target: id, kind: 'stream' });
        } else if (t.status === 'completed') {
          links.push({ id: `return-${agentNodeId}-${id}`, source: agentNodeId, target: id, kind: 'return' });
        } else if (t.status === 'queued') {
          links.push({ id: `call-${id}-${agentNodeId}`, source: id, target: agentNodeId, kind: 'call' });
        }
      }
    }

    // 消息流光点节点
    const msgNodes = messageNodes(tasks, events as Record<string, unknown[]>);
    nodes.push(...msgNodes);

    return { nodes, links };
  }, [devices, tasks, events]);
}
