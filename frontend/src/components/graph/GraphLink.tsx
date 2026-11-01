import type { SimNode } from './NeuralGraph';
import type { GraphLinkKind, GraphLink } from '../../hooks/useGraphData';

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
}

export function layoutLinks(
  links: Array<{ id: string; kind: GraphLinkKind; source: string | SimNode; target: string | SimNode }>,
  nodeMap: Map<string, SimNode>,
  adjacent: Set<string> | null,
  focus: string | null,
): PositionedLink[] {
  const out: PositionedLink[] = [];
  for (const l of links) {
    const s = typeof l.source === 'string' ? nodeMap.get(l.source) : l.source;
    const t = typeof l.target === 'string' ? nodeMap.get(l.target) : l.target;
    if (!s || !t) continue;
    out.push({
      id: l.id,
      kind: l.kind,
      x1: s.x,
      y1: s.y,
      x2: t.x,
      y2: t.y,
      dimmed: !!adjacent && focus !== null && !(adjacent.has(s.id) && adjacent.has(t.id)),
      active: !focus || !!(adjacent?.has(s.id) && adjacent.has(t.id)),
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
            strokeWidth={style.width}
            strokeDasharray={style.dash}
            opacity={opacity}
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
