import { useEffect, useMemo, useRef, useState } from 'react';
import { useGraphData, type GraphNode, type GraphLink } from '../../hooks/useGraphData';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { GraphLegend } from './GraphLegend';
import { GraphLinks, ArrowMarkers, layoutLinks } from './GraphLink';
import { FlowParticles } from './FlowParticle';
import { NodeShape } from './GraphNode';
import { computeFlowLayout } from './flowLayout';
import type { NodeLens } from './GraphToolbar';
import type { DetailTarget } from '../drawer/DetailDrawer';

/**
 * 智能体流程图（确定性三层泳道布局，替代 d3-force 力导向）。
 *
 * 三层泳道：设备(左) → agent(中) → 任务(右)。
 * 位置完全确定：数据刷新不抖动、连线不交叉乱窜，一眼看清「任务流向哪个 agent、哪些在处理、哪里有问题」。
 *
 * 动画：脉冲（在线设备/运行中任务）、流动粒子（call 橙=下发 / stream 青=回流）、聚焦高亮。
 * 交互：缩放 0.2×–2×、平移、悬停 Tooltip、点击聚焦+邻接高亮、空白复位、图例、透镜、路径漫游。
 * 流程图模式下禁用节点拖拽（保持确定性布局）。
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
  const [nodes, setNodes] = useState<SimNode[]>([]);
  const [links, setLinks] = useState<SimLink[]>([]);
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: GraphNode } | null>(null);
  const [walkPath, setWalkPath] = useState<SimLink[]>([]);
  const [walkHop, setWalkHop] = useState(0);

  const panRef = useRef<{ x: number; y: number; k: number; startX: number; startY: number } | null>(null);
  // 结构签名缓存：节点/连线 id 集合，判断是否需要重新布局
  const structureKeyRef = useRef<string>('');
  // 初始视角已适配标记：首次布局后居中+缩放一次，之后交给用户
  const viewFittedRef = useRef(false);

  // 确定性流程图布局。
  // 结构（节点/连线 id 集合）未变时只同步节点属性，不重新布局 → 彻底消除跳动。
  useEffect(() => {
    const w = containerRef.current?.clientWidth ?? 800;
    const h = containerRef.current?.clientHeight ?? 600;

    const nodeIds = data.nodes.map((n) => n.id).sort().join('\u0001');
    const linkIds = data.links.map((l) => l.id).sort().join('\u0001');
    const structureKey = nodeIds + '\u0002' + linkIds;

    // 结构未变：仅同步节点 data 属性（状态/负载等），保留坐标
    if (structureKeyRef.current === structureKey && structureKeyRef.current !== '') {
      const fresh = new Map<string, GraphNode>(data.nodes.map((n) => [n.id, n]));
      setNodes((prev) =>
        prev.map((sn) => {
          const f = fresh.get(sn.id);
          if (!f) return sn;
          return { ...f, x: sn.x, y: sn.y, vx: 0, vy: 0 } as SimNode;
        }),
      );
      setLinks(data.links.map((l) => ({ ...l })));
      return;
    }
    structureKeyRef.current = structureKey;

    // 结构变化：重新计算确定性布局
    const layout = computeFlowLayout(data.nodes);
    const simNodes: SimNode[] = data.nodes.map((n) => {
      const p = layout.positions.get(n.id) ?? { x: w / 2, y: h / 2 };
      return { ...n, x: p.x, y: p.y, vx: 0, vy: 0 };
    });
    const simLinks: SimLink[] = data.links.map((l) => ({ ...l }));

    setNodes(simNodes);
    setLinks(simLinks);

    // 首次布局后：内容居中 + 缩放适配，之后交给用户手动缩放
    if (!viewFittedRef.current) {
      viewFittedRef.current = true;
      const margin = 48;
      // 延迟一帧：h-full 容器首次渲染可能尚未测量到真实尺寸
      requestAnimationFrame(() => {
        const cw = containerRef.current?.clientWidth ?? w;
        const ch = containerRef.current?.clientHeight ?? h;
        const raw = Math.min(1, (cw - margin * 2) / layout.width, (ch - margin * 2) / layout.height);
        const k = Math.max(0.25, Math.min(1, raw));
        setTransform({ x: (cw - layout.width * k) / 2, y: (ch - layout.height * k) / 2, k });
      });
    }
  }, [data]);

  // 节点坐标索引
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

  // 路径漫游节点集（弱化无关节点）
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
    const next = Math.max(0.2, Math.min(2, transform.k * (e.deltaY < 0 ? 1.1 : 0.9)));
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
  };
  const onPointerUp = (): void => {
    panRef.current = null;
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
              onPointerDown={() => {
                /* 流程图确定性布局：禁用节点拖拽 */
                if (isMobile) return;
              }}
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
          style={{ left: tooltip.x + 14, top: tooltip.y + 14, maxWidth: 240 }}
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
    return { kind: 'agent', id: node.id, title: node.data.displayName, deviceId: node.deviceId, agentType: node.data.agentType };
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
