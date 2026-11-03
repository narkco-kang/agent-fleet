import { useEffect, useState } from 'react';
import type { PositionedLink } from './GraphLink';

/**
 * 流动粒子动画：形象化任务流向。
 *  - call  连线（task→agent）：橙色粒子 = 任务正在下发到该 agent
 *  - stream 连线（agent→task）：青色粒子 = 结果正在回流到任务
 * 每个粒子带渐隐拖尾，方向一目了然。路径漫游时额外渲染高亮 trace。
 */
export function FlowParticles({
  links,
  traceLinks = [],
}: {
  links: PositionedLink[];
  traceLinks?: PositionedLink[];
}): JSX.Element {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number): void => {
      const dt = now - last;
      last = now;
      setPhase((p) => (p + dt / 1000) % 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const callLinks = links.filter((l) => l.kind === 'call');
  const streamLinks = links.filter((l) => l.kind === 'stream');
  const traces = traceLinks.filter((l) => !l.dimmed);

  /** 渲染单条连线上的流动粒子（主粒子 + 三段渐隐拖尾） */
  const renderParticle = (
    l: PositionedLink,
    key: string,
    color: string,
    r: number,
  ): JSX.Element => {
    const t = phase;
    const x = l.x1 + (l.x2 - l.x1) * t;
    const y = l.y1 + (l.y2 - l.y1) * t;
    const baseOpacity = l.dimmed ? 0.15 : 1;
    const tail = [0.14, 0.28, 0.42].map((offset) => {
      const tt = Math.max(0, t - offset);
      const tx = l.x1 + (l.x2 - l.x1) * tt;
      const ty = l.y1 + (l.y2 - l.y1) * tt;
      return (
        <circle
          key={`${key}-tail-${offset}`}
          cx={tx}
          cy={ty}
          r={r * 0.72}
          fill={color}
          opacity={baseOpacity * 0.35 * (1 - offset / 0.6)}
        />
      );
    });
    return (
      <g key={key}>
        {tail}
        <circle cx={x} cy={y} r={r} fill={color} opacity={baseOpacity * 0.95}>
          <animate attributeName="opacity" values="0.4;1;0.4" dur="1.1s" repeatCount="indefinite" />
        </circle>
      </g>
    );
  };

  return (
    <g>
      {/* 任务下发（call）：橙色，task → agent */}
      {callLinks.map((l) => renderParticle(l, `call-${l.id}`, '#F59E0B', 3.6))}
      {/* 结果回流（stream）：青色，agent → task */}
      {streamLinks.map((l) => renderParticle(l, `stream-${l.id}`, '#0891B2', 3))}
      {/* 路径漫游 trace：靛蓝高亮 */}
      {traces.map((l) => renderParticle(l, `trace-${l.id}`, '#4F46E5', 4.5))}
    </g>
  );
}
