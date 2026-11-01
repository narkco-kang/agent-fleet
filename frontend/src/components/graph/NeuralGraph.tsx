import { useEffect, useMemo, useRef, useState } from 'react';
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type Simulation,
} from 'd3-force';
import { useGraphData, type GraphNode, type GraphLink } from '../../hooks/useGraphData';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { GraphLegend } from './GraphLegend';
import { GraphLinks, ArrowMarkers, layoutLinks } from './GraphLink';
import { FlowParticles } from './FlowParticle';
import { NodeShape } from './GraphNode';
import type { NodeLens } from './GraphToolbar';
import type { DetailTarget } from '../drawer/DetailDrawer';

/**
 * 动态神经图（d3-force）——核心主视觉。
 *
 * 四类节点：设备圆 / agent 圆角方 / 任务菱形 / 消息流光点。
 * 四类连线：call / return / stream / belongs。
 * 动画：脉冲（在线设备/运行中任务）、流动光点（stream）、入场上浮、聚焦高亮。
 * 交互：缩放 0.3×–4×、拖拽、悬停 Tooltip、点击聚焦+邻接高亮、空白复位、图例。
 * 深化交互（增量叠加）：透镜 Lens（节点 type 维度）、路径漫游（任务节点沿 call/stream 逐跳）。
 * <768px 降级只读（仅缩放/悬停）。
 */

export type SimNode = GraphNode & {
  x: number;
  y: number;
  vx: number;
  vy: number;
};

export type SimLink = Omit<GraphLink, 'source' | 'target'> & {
  source: string | SimNode;
  target: string | SimNode;
};

export function NeuralGraph({
  onSelect,
  lens = 'all',
  walk = false,
}: {
  onSelect?: (target: DetailTarget | null) => void;
  lens?: NodeLens;
  walk?: boolean;
}): JSX.Element {
  const data = useGraphData();
  const { isMobile } = useBreakpoint();

  const containerRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const [nodes, setNodes] = useState<SimNode[]>([]);
  const [links, setLinks] = useState<SimLink[]>([]);
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: GraphNode } | null>(null);
  const [walkPath, setWalkPath] = useState<SimLink[]>([]);
  const [walkHop, setWalkHop] = useState(0);

  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const panRef = useRef<{ x: number; y: number; k: number; startX: number; startY: number } | null>(null);

  // 初始化 / 更新力导向仿真
  useEffect(() => {
    const w = containerRef.current?.clientWidth ?? 800;
    const h = containerRef.current?.clientHeight ?? 600;

    const simNodes: SimNode[] = data.nodes.map((n) => ({ ...n, x: w / 2 + (Math.random() - 0.5) * 200, y: h / 2 + (Math.random() - 0.5) * 200, vx: 0, vy: 0 }));
    const simLinks: SimLink[] = data.links.map((l) => ({ ...l }));

    const simulation = forceSimulation<SimNode>(simNodes)
      .force(
        'link',
        forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance((l) => (l.kind === 'belongs' ? 70 : 110))
          .strength((l) => (l.kind === 'belongs' ? 0.4 : 0.7)),
      )
      .force('charge', forceManyBody().strength(-220))
      .force('center', forceCenter(w / 2, h / 2))
      .force('collide', forceCollide<SimNode>().radius((d) => (d.type === 'device' ? 34 : 24)))
      .alpha(1)
      .alphaDecay(0.03);

    simulation.on('tick', () => {
      setNodes([...simNodes]);
      setLinks([...simLinks]);
    });

    simRef.current = simulation;
    setNodes(simNodes);
    setLinks(simLinks);

    return () => {
      simulation.stop();
    };
  }, [data]);

  // 节点坐标存取
  const nodeMap = useMemo(() => {
    const m = new Map<string, SimNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  // 邻接集合（聚焦高亮）
  const adjacent = useMemo(() => {
    if (!focus) return null;
    const set = new Set<string>([focus]);
    for (const l of links) {
      const s = typeof l.source === 'string' ? l.source : l.source.id;
      const t = typeof l.target === 'string' ? l.target : l.target.id;
      if (s === focus) set.add(t);
      if (t === focus) set.add(s);
    }
    return set;
  }, [focus, links]);

  // 路径漫游：当前 hop 的连线 id
  const walkActiveId = walk && walkPath.length > 0 ? walkPath[walkHop % walkPath.length]?.id ?? null : null;

  // 路径漫游节点集（用于弱化无关节点）
  const walkNodeIds = useMemo(() => {
    if (!walk || walkPath.length === 0) return null;
    const set = new Set<string>(focus ? [focus] : []);
    for (const l of walkPath) {
      const s = typeof l.source === 'string' ? l.source : l.source.id;
      const t = typeof l.target === 'string' ? l.target : l.target.id;
      set.add(s);
      set.add(t);
    }
    return set;
  }, [walk, walkPath, focus]);

  // 路径漫游逐跳推进
  useEffect(() => {
    if (!walk || walkPath.length === 0) return;
    const timer = setInterval(() => setWalkHop((h) => h + 1), 900);
    return () => clearInterval(timer);
  }, [walk, walkPath.length]);

  const isDimmed = (n: GraphNode): boolean => {
    if (adjacent && !adjacent.has(n.id)) return true;
    if (lens !== 'all' && n.type !== lens) return true;
    if (walkNodeIds && !walkNodeIds.has(n.id)) return true;
    return false;
  };

  // 缩放
  const onWheel = (e: React.WheelEvent): void => {
    const next = Math.max(0.3, Math.min(4, transform.k * (e.deltaY < 0 ? 1.1 : 0.9)));
    setTransform({ ...transform, k: next });
  };

  // 空白拖拽平移
  const onPointerDown = (e: React.PointerEvent): void => {
    if ((e.target as Element).closest('[data-node]')) return;
    panRef.current = { ...transform, startX: e.clientX, startY: e.clientY };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent): void => {
    if (panRef.current) {
      const dx = e.clientX - panRef.current.startX;
      const dy = e.clientY - panRef.current.startY;
      setTransform({ ...panRef.current, x: panRef.current.x + dx, y: panRef.current.y + dy });
    }
    if (dragRef.current) {
      const n = nodeMap.get(dragRef.current.id);
      if (n) {
        n.x = e.clientX - dragRef.current.dx;
        n.y = e.clientY - dragRef.current.dy;
        setNodes([...nodes]);
      }
    }
  };
  const onPointerUp = (): void => {
    panRef.current = null;
    dragRef.current = null;
  };

  // 节点拖拽
  const startNodeDrag = (e: React.PointerEvent, node: GraphNode): void => {
    if (isMobile) return; // 移动端只读，隐藏拖拽
    const n = nodeMap.get(node.id);
    if (!n) return;
    dragRef.current = { id: node.id, dx: e.clientX - n.x, dy: e.clientY - n.y };
    e.stopPropagation();
  };

  // 悬停 tooltip
  const showTooltip = (e: React.MouseEvent, node: GraphNode): void => {
    setTooltip({ x: e.clientX, y: e.clientY, node });
  };

  // 点击聚焦 / 路径漫游起点
  const clickNode = (node: GraphNode): void => {
    if (walk && node.type === 'task') {
      setFocus(node.id);
      setWalkPath(computeWalkPath(node.id, links));
      setWalkHop(0);
      return;
    }
    if (focus === node.id) {
      setFocus(null);
      onSelect?.(null);
    } else {
      setFocus(node.id);
      onSelect?.(toDetail(node));
    }
  };

  const blankClick = (): void => {
    setFocus(null);
    setWalkPath([]);
    onSelect?.(null);
  };

  return (
    <div ref={containerRef} className="graph-canvas relative h-full w-full overflow-hidden">
      <svg
        className="h-full w-full"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onClick={blankClick}
      >
        <ArrowMarkers />
        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
          {/* 连线 */}
          <LinkLayer links={links} nodeMap={nodeMap} focus={focus} adjacent={adjacent} walkActiveId={walkActiveId} />
          {/* 节点 */}
          {nodes.map((n) => (
            <NodeShape
              key={n.id}
              node={n}
              dimmed={isDimmed(n)}
              focused={focus === n.id}
              lensActive={lens !== 'all' && n.type === lens}
              onMouseEnter={(e) => {
                setHover(n.id);
                showTooltip(e, n);
              }}
              onMouseLeave={() => {
                setHover(null);
                setTooltip(null);
              }}
              onClick={(e) => {
                e.stopPropagation();
                clickNode(n);
              }}
              onPointerDown={(e) => startNodeDrag(e, n)}
            />
          ))}
        </g>
      </svg>

      {/* 图例 */}
      <GraphLegend />

      {/* Tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none fixed z-30 rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs shadow-lg"
          style={{ left: tooltip.x + 14, top: tooltip.y + 14, maxWidth: 220 }}
        >
          <NodeTooltip node={tooltip.node} />
        </div>
      )}

      {/* hover 状态提示（辅助） */}
      {hover && !tooltip && <span className="hidden">{hover}</span>}
    </div>
  );
}

/** 计算任务节点的漫游路径：先 call（task→agent），再 stream（agent→task） */
function computeWalkPath(taskId: string, links: SimLink[]): SimLink[] {
  const calls = links.filter((l) => {
    const s = typeof l.source === 'string' ? l.source : l.source.id;
    return s === taskId && l.kind === 'call';
  });
  const streams = links.filter((l) => {
    const t = typeof l.target === 'string' ? l.target : l.target.id;
    return t === taskId && l.kind === 'stream';
  });
  return [...calls, ...streams];
}

/** 连线层：实线/虚线/箭头 + stream 流动光点 + 漫游 trace */
function LinkLayer({
  links,
  nodeMap,
  adjacent,
  focus,
  walkActiveId,
}: {
  links: SimLink[];
  nodeMap: Map<string, SimNode>;
  adjacent: Set<string> | null;
  focus: string | null;
  walkActiveId: string | null;
}): JSX.Element {
  const positioned = layoutLinks(links, nodeMap, adjacent, focus, walkActiveId);
  return (
    <g>
      <GraphLinks links={positioned} />
      <FlowParticles links={positioned} traceLinks={positioned.filter((l) => l.trace)} />
    </g>
  );
}

/** 把节点转换为抽屉详情目标 */
function toDetail(node: GraphNode): DetailTarget {
  if (node.type === 'device') {
    return { kind: 'device', id: node.data.deviceId, title: node.data.name };
  }
  if (node.type === 'agent') {
    return { kind: 'agent', id: node.id, title: node.data.displayName, deviceId: node.deviceId };
  }
  if (node.type === 'task') {
    return { kind: 'task', id: node.data.taskId, title: node.data.prompt.slice(0, 40) };
  }
  return { kind: 'message', id: node.id, title: `消息 #${node.seq}` };
}

function NodeTooltip({ node }: { node: GraphNode }): JSX.Element {
  switch (node.type) {
    case 'device':
      return (
        <div>
          <div className="font-semibold text-[#0F172A]">{node.data.name}</div>
          <div className="text-[#64748B]">{node.data.deviceId}</div>
          <div className="mt-1 text-[#334155]">
            状态：{node.data.status} · 负载 {Math.round(node.data.load.cpu * 100)}%
          </div>
        </div>
      );
    case 'agent':
      return (
        <div>
          <div className="font-semibold text-[#0F172A]">{node.data.displayName}</div>
          <div className="text-[#64748B]">v{node.data.version}</div>
          <div className="mt-1 text-[#334155]">
            状态：{node.data.status} · 占用 {node.data.busyCount}/{node.data.maxConcurrency}
          </div>
        </div>
      );
    case 'task':
      return (
        <div>
          <div className="font-semibold text-[#0F172A]">{node.data.prompt.slice(0, 30)}</div>
          <div className="mt-1 text-[#334155]">状态：{node.data.status}</div>
        </div>
      );
    case 'message':
      return (
        <div>
          <div className="font-semibold text-[#0F172A]">消息流 #{node.seq}</div>
          <div className="text-[#64748B]">{node.eventType}</div>
        </div>
      );
  }
}
