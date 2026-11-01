import { useEffect, useState } from 'react';
import type { PositionedLink } from './GraphLink';

/**
 * 流动光点动画：沿 stream 连线方向移动的光点（04 §4.4）。
 */
export function FlowParticles({ links }: { links: PositionedLink[] }): JSX.Element {
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

  const streamLinks = links.filter((l) => l.kind === 'stream');

  return (
    <g>
      {streamLinks.map((l) => {
        const t = phase;
        const x = l.x1 + (l.x2 - l.x1) * t;
        const y = l.y1 + (l.y2 - l.y1) * t;
        return (
          <circle key={`p-${l.id}`} cx={x} cy={y} r={3} fill="#0891B2" opacity={l.dimmed ? 0.15 : 0.9}>
            <animate attributeName="opacity" values="0.3;1;0.3" dur="1.2s" repeatCount="indefinite" />
          </circle>
        );
      })}
    </g>
  );
}
