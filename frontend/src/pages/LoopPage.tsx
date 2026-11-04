import { useCallback, useEffect, useMemo, useState } from 'react';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import { loopApi, type Loop, type LoopGraph } from '../api/loop';
import { Card } from '../components/common/Card';

/**
 * Loop 编排页（P2-10 编排可视化）：loop 列表 + 创建 + DAG 依赖图 + 运行时状态 + 决策门。
 */

const STATUS_COLOR: Record<string, string> = {
  idle: '#CBD5E1',
  queued: '#94A3B8',
  running: '#F59E0B',
  completed: '#10B981',
  failed: '#EF4444',
  cancelled: '#EF4444',
  interrupted: '#EF4444',
  blocked: '#3B82F6',
};

const STATUS_LABEL: Record<string, string> = {
  idle: '待执行',
  queued: '排队',
  running: '运行中',
  completed: '完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '中断',
  blocked: '待决策',
};

const OPERATOR_LABEL: Record<string, string> = {
  sequence: '顺序',
  parallel: '并行',
  map: '映射',
  human: '人工',
};

/** 拓扑分层：返回每个节点深度 */
function computeDepth(nodes: LoopGraph['nodes'], edges: LoopGraph['edges']): Record<string, number> {
  const depth: Record<string, number> = {};
  const adj: Record<string, string[]> = {};
  const indeg: Record<string, number> = {};
  for (const n of nodes) {
    adj[n.id] = [];
    indeg[n.id] = 0;
  }
  for (const e of edges) {
    if (adj[e.from]) adj[e.from].push(e.to);
    if (indeg[e.to] !== undefined) indeg[e.to] += 1;
  }
  const queue: Array<{ id: string; d: number }> = [];
  for (const n of nodes) if (indeg[n.id] === 0) queue.push({ id: n.id, d: 0 });
  while (queue.length) {
    const { id, d } = queue.shift()!;
    depth[id] = d;
    for (const to of adj[id] ?? []) {
      depth[to] = Math.max(depth[to] ?? 0, d + 1);
      indeg[to] -= 1;
      if (indeg[to] === 0) queue.push({ id: to, d: depth[to] });
    }
  }
  return depth;
}

function LoopDag({ graph }: { graph: LoopGraph }): JSX.Element {
  const depth = useMemo(() => computeDepth(graph.nodes, graph.edges), [graph]);
  const byDepth = useMemo(() => {
    const m = new Map<number, LoopGraph['nodes']>();
    for (const n of graph.nodes) {
      const d = depth[n.id] ?? 0;
      if (!m.has(d)) m.set(d, []);
      m.get(d)!.push(n);
    }
    return Array.from(m.entries()).sort((a, b) => a[0] - b[0]);
  }, [graph, depth]);

  const NODE_W = 150;
  const NODE_H = 54;
  const GAP_X = 60;
  const GAP_Y = 28;
  const width = Math.max(byDepth.length * (NODE_W + GAP_X) + 40, 320);
  const height = Math.max(
    byDepth.reduce((m, [, ns]) => Math.max(m, ns.length * (NODE_H + GAP_Y)), 1) + 40,
    160,
  );

  const pos: Record<string, { x: number; y: number }> = {};
  byDepth.forEach(([d, ns]) => {
    const totalH = ns.length * (NODE_H + GAP_Y) - GAP_Y;
    const startY = (height - totalH) / 2;
    ns.forEach((n, i) => {
      pos[n.id] = {
        x: 20 + d * (NODE_W + GAP_X),
        y: startY + i * (NODE_H + GAP_Y),
      };
    });
  });

  return (
    <svg width={width} height={height} className="w-full" style={{ minHeight: height }}>
      {/* 边 */}
      {graph.edges.map((e, i) => {
        const a = pos[e.from];
        const b = pos[e.to];
        if (!a || !b) return null;
        return (
          <path
            key={`e-${i}`}
            d={`M ${a.x + NODE_W} ${a.y + NODE_H / 2} C ${a.x + NODE_W + GAP_X / 2} ${a.y + NODE_H / 2}, ${b.x - GAP_X / 2} ${b.y + NODE_H / 2}, ${b.x} ${b.y + NODE_H / 2}`}
            fill="none"
            stroke="#CBD5E1"
            strokeWidth="1.5"
            markerEnd="url(#arrow)"
          />
        );
      })}
      <defs>
        <marker id="arrow" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#CBD5E1" />
        </marker>
      </defs>
      {/* 节点 */}
      {graph.nodes.map((n) => {
        const p = pos[n.id];
        if (!p) return null;
        const color = STATUS_COLOR[n.status] ?? '#CBD5E1';
        const human = n.human || n.status === 'blocked';
        return (
          <g key={n.id} transform={`translate(${p.x},${p.y})`}>
            <rect
              width={NODE_W}
              height={NODE_H}
              rx={8}
              fill={n.status === 'completed' ? '#ECFDF5' : n.status === 'failed' ? '#FEF2F2' : '#FFFFFF'}
              stroke={color}
              strokeWidth={human ? 2 : 1.5}
            />
            <text x={12} y={20} fontSize={12} fontWeight={600} fill="#0F172A">
              {n.name.length > 12 ? `${n.name.slice(0, 12)}…` : n.name}
            </text>
            <text x={12} y={38} fontSize={10} fill="#64748B">
              {OPERATOR_LABEL[n.operator] ?? n.operator}
              {human ? ' · 待决策' : ''}
            </text>
            <circle cx={NODE_W - 12} cy={12} r={5} fill={color} />
          </g>
        );
      })}
    </svg>
  );
}

export default function LoopPage(): JSX.Element {
  const [loops, setLoops] = useState<Loop[]>([]);
  const [selected, setSelected] = useState<Loop | null>(null);
  const [graph, setGraph] = useState<LoopGraph | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    loopApi.list().then((r) => setLoops(r.data)).catch(() => setLoops([]));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    loopApi.graph(selected.id).then((r) => setGraph(r.data)).catch(() => setGraph(null));
    const t = setInterval(() => {
      loopApi.graph(selected.id).then((r) => setGraph(r.data)).catch(() => setGraph(null));
    }, 2000);
    return () => clearInterval(t);
  }, [selected]);

  const create = async (): Promise<void> => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      await loopApi.create({
        name: name.trim(),
        steps: [
          { id: 'step-1', name: '需求分析', template: { prompt: '分析需求', target: { mode: 'auto' }, options: {} }, dependsOn: [], operator: 'sequence' },
          { id: 'step-2', name: '方案设计', template: { prompt: '设计方案', target: { mode: 'auto' }, options: {} }, dependsOn: ['step-1'], operator: 'sequence' },
          { id: 'step-3', name: '实现编码', template: { prompt: '实现代码', target: { mode: 'auto' }, options: {} }, dependsOn: ['step-2'], operator: 'sequence' },
          { id: 'step-4', name: '质量验证', template: { prompt: '验证质量', target: { mode: 'auto' }, options: {} }, dependsOn: ['step-3'], operator: 'sequence' },
        ],
      });
      setName('');
      load();
    } finally {
      setCreating(false);
    }
  };

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn();
      load();
      if (selected) loopApi.graph(selected.id).then((r) => setGraph(r.data)).catch(() => setGraph(null));
    } catch (err) {
      window.alert((err as Error).message);
    }
  };

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-[var(--text-strong)]">Loop 编排</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          用 DAG 依赖图编排多步任务 —— 依赖满足即并行派发，支持顺序/并行/映射/人工算子与决策门。
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* 左：列表 + 创建 */}
        <div className="space-y-3">
          <Card className="p-3">
            <div className="mb-2 text-sm font-semibold text-[var(--text-strong)]">新建 Loop</div>
            <div className="flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Loop 名称"
                className="min-w-0 flex-1 rounded-lg border border-[var(--border)] px-2 py-1.5 text-sm text-[var(--text-strong)] outline-none focus:border-[#4F46E5]"
              />
              <button
                onClick={() => void create()}
                disabled={creating || !name.trim()}
                className="shrink-0 rounded-lg bg-[#4F46E5] px-3 py-1.5 text-sm text-white hover:bg-[#4338CA] disabled:opacity-50"
              >
                {creating ? '创建中' : '创建'}
              </button>
            </div>
          </Card>

          <Card className="p-0">
            <div className="border-b border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--text-strong)]">
              Loop 列表（{loops.length}）
            </div>
            {loops.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-[var(--text-muted)]">暂无 Loop，先创建一个</div>
            ) : (
              <div className="max-h-[60vh] overflow-auto">
                {loops.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => setSelected(l)}
                    className={`block w-full border-b border-[var(--border)] px-3 py-2 text-left transition-colors ${
                      selected?.id === l.id ? 'bg-[var(--brand-soft)]' : 'hover:bg-[var(--bg-subtle)]'
                    }`}
                  >
                    <div className="truncate text-sm text-[var(--text-strong)]">{l.name}</div>
                    <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                      {l.steps.length} 步 · 状态 {l.state}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* 右：DAG 图 + 控制 */}
        <div className="space-y-3">
          {!selected ? (
            <Card className="flex flex-col items-center justify-center p-12 text-[var(--text-muted)]">
              <AccountTreeIcon style={{ fontSize: 48 }} />
              <div className="mt-2 text-sm">选择左侧 Loop 查看编排 DAG 图</div>
            </Card>
          ) : (
            <>
              <Card className="p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-[var(--text-strong)]">{selected.name}</div>
                    <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                      {selected.steps.length} 步 · 第 {graph?.currentRound ?? selected.currentRound} 轮 · 状态{' '}
                      {graph?.state ?? selected.state}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {(graph?.state === 'idle' || !graph || graph.state === 'draft') && (
                      <button
                        onClick={() => void act(() => loopApi.start(selected.id))}
                        className="rounded-lg bg-[#4F46E5] px-3 py-1.5 text-sm text-white hover:bg-[#4338CA]"
                      >
                        启动
                      </button>
                    )}
                    {graph?.state === 'running' && (
                      <button
                        onClick={() => void act(() => loopApi.pause(selected.id))}
                        className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[var(--bg-subtle)]"
                      >
                        暂停
                      </button>
                    )}
                    {graph?.state === 'paused' && (
                      <button
                        onClick={() => void act(() => loopApi.resume(selected.id))}
                        className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[var(--bg-subtle)]"
                      >
                        恢复
                      </button>
                    )}
                    <button
                      onClick={() => void act(() => loopApi.cancel(selected.id))}
                      className="rounded-lg border border-[#EF4444] px-3 py-1.5 text-sm text-[#EF4444] hover:bg-[var(--danger-soft)]"
                    >
                      取消
                    </button>
                    <button
                      onClick={() => void act(() => loopApi.remove(selected.id).then(() => setSelected(null)))}
                      className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-subtle)]"
                    >
                      删除
                    </button>
                  </div>
                </div>

                {/* 图例 */}
                <div className="mb-2 flex flex-wrap gap-2">
                  {['queued', 'running', 'completed', 'failed', 'blocked'].map((s) => (
                    <span key={s} className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLOR[s] }} />
                      {STATUS_LABEL[s]}
                    </span>
                  ))}
                </div>

                {graph && <LoopDag graph={graph} />}

                {/* 人工步骤 / 决策门 */}
                {graph?.nodes.some((n) => n.human || n.status === 'blocked') && (
                  <div className="mt-3 space-y-1.5">
                    {graph.nodes
                      .filter((n) => n.human || n.status === 'blocked')
                      .map((n) => (
                        <div
                          key={n.id}
                          className="flex items-center justify-between rounded border border-[var(--brand-soft)] bg-[var(--brand-soft)] px-3 py-1.5 text-sm"
                        >
                          <span className="text-[#1E40AF]">「{n.name}」等待人工决策</span>
                          <button
                            onClick={() => void act(() => loopApi.resolveStep(selected.id, n.id))}
                            className="rounded bg-[#3B82F6] px-2 py-0.5 text-xs text-white hover:bg-[#2563EB]"
                          >
                            完成
                          </button>
                        </div>
                      ))}
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
