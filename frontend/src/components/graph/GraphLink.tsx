import type { SimNode } from './NeuralGraph';
import type { GraphLinkKind, GraphLink } from '../../hooks/useGraphData';
import { NODE_SIZE } from './flowLayout';

/**
 * 连线渲染（04 §4.3）：
 * call 实线+箭头(brand) / return 虚线+箭头(success) / stream 流动虚线+光点(accent) / belongs 细实线无箭头(border)。
 */
export interface PositionedLink {
  id: string;
  kind: GraphLinkKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  dimmed: boolean;
  active: boolean;
  /** 路径漫游当前 hop（高亮 + 流动 trace） */
  trace: boolean;
}

export function layoutLinks(
  links: Array<{ id: string; kind: GraphLinkKind; source: string | SimNode; target: string | SimNode }>,
  nodeMap: Map<string, SimNode>,
  adjacent: Set<string> | null,
  focus: string | null,
  walkActiveId: string | null = null,
): PositionedLink[] {
  const out: PositionedLink[] = [];
  for (const l of links) {
    const s = typeof l.source === 'string' ? nodeMap.get(l.source) : l.source;
    const t = typeof l.target === 'string' ? nodeMap.get(l.target) : l.target;
    if (!s || !t) continue;
    const trace = walkActiveId != null && l.id === walkActiveId;
    // 端点偏移到卡片边缘，避免箭头/粒子被卡片遮挡
    const ss = NODE_SIZE[s.type] ?? { hw: 6, hh: 6 };
    const ts = NODE_SIZE[t.type] ?? { hw: 6, hh: 6 };
    let x1 = s.x;
    let y1 = s.y;
    let x2 = t.x;
    let y2 = t.y;
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      // 水平连线
      if (dx >= 0) {
        x1 = s.x + ss.hw;
        x2 = t.x - ts.hw;
      } else {
        x1 = s.x - ss.hw;
        x2 = t.x + ts.hw;
      }
    } else {
      // 垂直连线
      if (dy >= 0) {
        y1 = s.y + ss.hh;
        y2 = t.y - ts.hh;
      } else {
        y1 = s.y - ss.hh;
        y2 = t.y + ts.hh;
      }
    }
    out.push({
      id: l.id,
      kind: l.kind,
      x1,
      y1,
      x2,
      y2,
      dimmed: !!adjacent && focus !== null && !(adjacent.has(s.id) && adjacent.has(t.id)) && !trace,
      active: trace || !focus || !!(adjacent?.has(s.id) && adjacent.has(t.id)),
      trace,
    });
  }
  return out;
}

const KIND_STYLE: Record<GraphLinkKind, { stroke: string; dash: string | undefined; width: number; arrow: boolean }> = {
  call: { stroke: '#4F46E5', dash: undefined, width: 1.8, arrow: true },
  return: { stroke: '#10B981', dash: '6 4', width: 1.6, arrow: true },
  stream: { stroke: '#0891B2', dash: '4 4', width: 1.6, arrow: false },
  belongs: { stroke: '#E2E8F0', dash: undefined, width: 1, arrow: false },
};

export function GraphLinks({ links }: { links: PositionedLink[] }): JSX.Element {
  return (
    <g>
      {links.map((l) => {
        const style = KIND_STYLE[l.kind];
        const opacity = l.dimmed ? 0.15 : 0.9;
        return (
          <line
            key={l.id}
            x1={l.x1}
            y1={l.y1}
            x2={l.x2}
            y2={l.y2}
            stroke={style.stroke}
            strokeWidth={l.trace ? style.width + 1.6 : style.width}
            strokeDasharray={style.dash}
            opacity={l.trace ? 1 : opacity}
            markerEnd={style.arrow ? `url(#arrow-${l.kind})` : undefined}
          />
        );
      })}
    </g>
  );
}

/** 连线箭头标记定义 */
export function ArrowMarkers(): JSX.Element {
  return (
    <defs>
      <marker id="arrow-call" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#4F46E5" />
      </marker>
      <marker id="arrow-return" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#10B981" />
      </marker>
    </defs>
  );
}

export type { GraphLink };
