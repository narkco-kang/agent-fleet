import { useMemo, useState, type ReactNode, Children } from 'react';
import { useGraphData, type GraphNode, type GraphAgentNode, type GraphDeviceNode, type GraphTaskNode } from '../../hooks/useGraphData';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import type { NodeLens } from './GraphToolbar';
import type { DetailTarget } from '../drawer/DetailDrawer';

/**
 * 智能体舰队总览（Mission Control 三栏布局，替代 SVG 三层泳道图）。
 *
 * 为什么重构：旧泳道图三列固定坐标、每行 72px、节点卡片 10-12px 小字，
 * 节点少时容器大片空白、无法一眼看清所有设备/agent/任务。
 *
 * 新布局：顶部 KPI 大数字概览 + 设备/Agent/任务三栏高密度卡片，用 CSS grid
 * 填满容器。状态色语义化（在线绿/运行橙/失败红/离线灰），等宽字体标 ID/版本/数字。
 * 点击联动：选设备→高亮其 agent 与任务；选 agent→高亮其任务；选任务→高亮其 agent。
 */

/** 状态 → CSS 变量色（跟随主题） */
const STATUS_VAR: Record<string, string> = {
  online: 'var(--success)',
  busy: 'var(--warning)',
  offline: 'var(--offline)',
  idle: 'var(--agent)',
  error: 'var(--danger)',
  needs_login: 'var(--offline)',
  queued: 'var(--offline)',
  running: 'var(--warning)',
  completed: 'var(--success)',
  failed: 'var(--danger)',
  cancelled: 'var(--danger)',
  interrupted: 'var(--danger)',
};

const STATUS_LABEL: Record<string, string> = {
  online: '在线',
  busy: '忙碌',
  offline: '离线',
  idle: '空闲',
  error: '异常',
  needs_login: '待登录',
  queued: '排队',
  running: '运行中',
  completed: '完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '中断',
};

function truncate(s: string, n: number): string {
  return s && s.length > n ? `${s.slice(0, n - 1)}…` : s ?? '';
}

function agentInitial(agentType: string): string {
  const map: Record<string, string> = {
    codex: 'C', claude: 'Cℓ', dsh: 'D', grok: 'G', cursor: 'Cu', aider: 'A',
    gemini: 'Ge', cody: 'Co', qwen: 'Q', doubao: '豆', kimi: 'K',
    opencode: 'Op', windsurf: 'W', workbuddy: 'Wb',
  };
  return map[agentType] ?? '?';
}

export function NeuralGraph({
  onSelect,
  lens = 'all',
}: {
  onSelect?: (target: DetailTarget | null) => void;
  lens?: NodeLens;
}): JSX.Element {
  const data = useGraphData();
  const { isMobile } = useBreakpoint();
  const [focus, setFocus] = useState<string | null>(null);
  const [taskFilter, setTaskFilter] = useState<string>('all');

  const devices = useMemo(
    () =>
      data.nodes
        .filter((n): n is GraphDeviceNode => n.type === 'device')
        .sort((a, b) => {
          const ao = a.data.status === 'online' || a.data.status === 'busy' ? 1 : 0;
          const bo = b.data.status === 'online' || b.data.status === 'busy' ? 1 : 0;
          return bo - ao; // 在线设备排前面，offline 历史沉底
        }),
    [data],
  );
  const agents = useMemo(
    () =>
      data.nodes
        .filter((n): n is GraphAgentNode => n.type === 'agent')
        .sort((a, b) => {
          const ab = a.data.status === 'busy' ? 1 : 0;
          const bb = b.data.status === 'busy' ? 1 : 0;
          return bb - ab; // 处理中优先，空闲/待登录沉底
        }),
    [data],
  );
  const tasks = useMemo(
    () =>
      data.nodes
        .filter((n): n is GraphTaskNode => n.type === 'task')
        .sort((a, b) => (b.data.createdAt ?? 0) - (a.data.createdAt ?? 0)),
    [data],
  );
  // 任务栏状态筛选（failed 含 cancelled/interrupted）
  const visibleTasks = useMemo(() => {
    if (taskFilter === 'all') return tasks;
    if (taskFilter === 'failed') return tasks.filter((t) => ['failed', 'cancelled', 'interrupted'].includes(t.data.status));
    return tasks.filter((t) => t.data.status === taskFilter);
  }, [tasks, taskFilter]);

  // 归属索引：agentId → deviceId；task 的 agentId
  const agentDevice = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents) m.set(a.id, a.deviceId);
    return m;
  }, [agents]);
  const taskAgent = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tasks) {
      if (t.data.targetDeviceId && t.data.targetAgentType) {
        m.set(t.id, `agent-${t.data.targetDeviceId}:${t.data.targetAgentType}`);
      }
    }
    return m;
  }, [tasks]);

  // 联动高亮集合
  const related = useMemo(() => {
    if (!focus) return null;
    const set = new Set<string>([focus]);
    if (focus.startsWith('agent-')) {
      for (const t of tasks) if (taskAgent.get(t.id) === focus) set.add(t.id);
      const dev = agentDevice.get(focus);
      if (dev) set.add(dev);
    } else if (devices.some((d) => d.id === focus)) {
      for (const a of agents) if (a.deviceId === focus) set.add(a.id);
      for (const t of tasks) if (t.data.targetDeviceId === focus) set.add(t.id);
    } else if (tasks.some((t) => t.id === focus)) {
      const ag = taskAgent.get(focus);
      if (ag) set.add(ag);
    }
    return set;
  }, [focus, tasks, agents, devices, taskAgent, agentDevice]);

  const dim = (id: string): boolean => (related ? !related.has(id) : false);

  // KPI
  const onlineDevices = devices.filter((d) => d.data.status === 'online' || d.data.status === 'busy').length;
  const busyAgents = agents.filter((a) => a.data.status === 'busy').length;
  const runningTasks = tasks.filter((t) => t.data.status === 'running').length;
  const alerts = tasks.filter((t) => t.data.status === 'failed' || t.data.status === 'interrupted' || t.data.status === 'cancelled').length;
  // 状态分布
  const needsLoginAgents = agents.filter((a) => a.data.status === 'needs_login' || (a.data.activated as boolean | undefined) === false).length;
  const idleAgents = agents.length - busyAgents - needsLoginAgents - agents.filter((a) => a.data.status === 'error').length;
  const queuedTasks = tasks.filter((t) => t.data.status === 'queued').length;
  const completedTasks = tasks.filter((t) => t.data.status === 'completed').length;

  const click = (node: GraphNode, target: DetailTarget): void => {
    if (focus === node.id) {
      setFocus(null);
      onSelect?.(null);
    } else {
      setFocus(node.id);
      onSelect?.(target);
    }
  };

  const blank = (): void => {
    setFocus(null);
    onSelect?.(null);
  };

  const lensDim = (type: string): boolean => lens !== 'all' && lens !== type;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden" onClick={blank}>
      {/* 顶部 KPI 概览 + 状态色图例 */}
      <div className="flex shrink-0 items-center gap-6 border-b border-[var(--border)] px-5 pr-[340px]" style={{ background: 'var(--bg)' }}>
        <Kpi value={onlineDevices} total={devices.length} label="在线设备" color="var(--success)" />
        <Kpi value={agents.length} label="Agent" sub={`${busyAgents} 处理中`} color="var(--agent)" />
        <Kpi value={runningTasks} total={tasks.length} label="运行中任务" color="var(--warning)" />
        <Kpi value={alerts} label="告警" color={alerts > 0 ? 'var(--danger)' : 'var(--offline)'} />
      </div>

      {/* 三栏：设备 | Agent | 任务 */}
      <div
        className={`flex-1 overflow-hidden ${isMobile ? 'overflow-y-auto' : ''}`}
        style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'minmax(220px, 300px) minmax(220px, 280px) 1fr',
          gap: 12,
          padding: 16,
          background: 'var(--bg-subtle)',
        }}
      >
        {/* 设备栏 */}
        <Column
          title="设备"
          count={devices.length}
          empty="暂无设备接入"
          statusBar={<StatusBar items={[
            { color: 'var(--success)', count: onlineDevices, label: '在线' },
            { color: 'var(--offline)', count: devices.length - onlineDevices, label: '离线' },
          ]} />}
        >
          {devices.map((d) => {
            const devAgents = agents.filter((a) => a.deviceId === d.id);
            const color = STATUS_VAR[d.data.status] ?? 'var(--offline)';
            const online = d.data.status === 'online' || d.data.status === 'busy';
            const active = focus === d.id;
            return (
              <DeviceCard
                key={d.id}
                name={d.data.name}
                agentCount={devAgents.length}
                load={d.data.load?.cpu ?? 0}
                color={color}
                online={online}
                active={active}
                dimmed={dim(d.id) || lensDim('device')}
                onClick={(e) => { e.stopPropagation(); click(d, { kind: 'device', id: d.data.deviceId, title: d.data.name }); }}
              />
            );
          })}
        </Column>

        {/* Agent 栏 */}
        <Column
          title="Agent"
          count={agents.length}
          empty="设备接入后此处显示 agent 平台"
          statusBar={<StatusBar items={[
            { color: 'var(--warning)', count: busyAgents, label: '处理中' },
            { color: 'var(--agent)', count: idleAgents, label: '空闲' },
            { color: 'var(--offline)', count: needsLoginAgents, label: '待登录' },
          ]} />}
        >
          {agents.map((a) => {
            const color = agentColor(a.data);
            const busy = a.data.status === 'busy';
            const active = focus === a.id;
            return (
              <AgentCard
                key={a.id}
                initial={agentInitial(a.data.agentType)}
                name={a.data.displayName}
                version={a.data.version}
                label={agentLabel(a.data)}
                busy={busy}
                busyCount={a.data.busyCount}
                maxConcurrency={a.data.maxConcurrency}
                color={color}
                active={active}
                dimmed={dim(a.id) || lensDim('agent')}
                onClick={(e) => {
                  e.stopPropagation();
                  click(a, { kind: 'agent', id: a.id, title: a.data.displayName, deviceId: a.deviceId, agentType: a.data.agentType });
                }}
              />
            );
          })}
        </Column>

        {/* 任务栏 */}
        <Column
          title="任务"
          count={tasks.length}
          empty="暂无任务，点右上角「新建任务」下发"
          statusBar={<StatusBar items={[
            { color: 'var(--warning)', count: runningTasks, label: '运行中' },
            { color: 'var(--offline)', count: queuedTasks, label: '排队' },
            { color: 'var(--success)', count: completedTasks, label: '完成' },
            { color: 'var(--danger)', count: alerts, label: '失败' },
          ]} />}
          headerExtra={<TaskFilter value={taskFilter} onChange={setTaskFilter} />}
        >
          {visibleTasks.map((t) => {
            const st = t.data.status;
            const color = STATUS_VAR[st] ?? 'var(--offline)';
            const running = st === 'running';
            const agentId = taskAgent.get(t.id);
            const agentName = agents.find((a) => a.id === agentId)?.data.displayName;
            const active = focus === t.id;
            return (
              <TaskCard
                key={t.id}
                prompt={t.data.prompt}
                resultText={t.data.resultText ?? ''}
                label={STATUS_LABEL[st] ?? st}
                target={agentName ? `${agentName}` : (t.data.targetAgentType ?? '未分配')}
                color={color}
                running={running}
                active={active}
                dimmed={dim(t.id) || lensDim('task')}
                onClick={(e) => { e.stopPropagation(); click(t, { kind: 'task', id: t.data.taskId, title: t.data.prompt.slice(0, 40) }); }}
              />
            );
          })}
        </Column>
      </div>
    </div>
  );
}

/** KPI 单指标（大数字 + 标签，等宽字体） */
function Kpi({ value, total, label, sub, color }: { value: number; total?: number; label: string; sub?: string; color: string }): JSX.Element {
  return (
    <div className="flex items-baseline gap-2 py-3">
      <span className="font-mono text-2xl font-semibold leading-none" style={{ color }}>
        {value}
        {total !== undefined && <span className="text-sm font-normal text-[var(--text-muted)]">/{total}</span>}
      </span>
      <div className="flex flex-col">
        <span className="text-xs font-medium text-[var(--text)]">{label}</span>
        {sub && <span className="text-[11px] text-[var(--text-muted)]">{sub}</span>}
      </div>
    </div>
  );
}

/** 栏容器（标题 + 计数 + 状态分布条 + 可选筛选条 + 可滚动卡片列表） */
function Column({ title, count, empty, statusBar, headerExtra, children }: { title: string; count: number; empty: string; statusBar?: ReactNode; headerExtra?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--border)]" style={{ background: 'var(--surface)' }}>
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text)]">{title}</span>
        <span className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-muted)]">{count}</span>
      </div>
      {statusBar}
      {headerExtra}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2.5">
        {children}
        {Children.count(children) === 0 && (
          <div className="flex flex-1 items-center justify-center px-4 py-8 text-center text-xs text-[var(--text-muted)]">{empty}</div>
        )}
      </div>
    </div>
  );
}

/** 状态分布迷你条：色块按占比 + 计数（一眼看状态构成） */
function StatusBar({ items }: { items: Array<{ color: string; count: number; label: string }> }): JSX.Element | null {
  const total = items.reduce((s, i) => s + i.count, 0);
  const visible = items.filter((i) => i.count > 0);
  if (total === 0 || visible.length === 0) return null;
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-2.5 py-1.5">
      <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--bg-subtle)]">
        {visible.map((i) => (
          <div key={i.label} style={{ width: `${(i.count / total) * 100}%`, background: i.color }} title={`${i.label} ${i.count}`} />
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-2 font-mono text-[10px] text-[var(--text-muted)]">
        {visible.map((i) => (
          <span key={i.label} className="flex items-center gap-1 whitespace-nowrap">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: i.color }} />
            {i.count}
            <span className="opacity-70">{i.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** 任务状态筛选条 */
function TaskFilter({ value, onChange }: { value: string; onChange: (v: string) => void }): JSX.Element {
  const opts: Array<{ v: string; label: string }> = [
    { v: 'all', label: '全部' },
    { v: 'running', label: '运行中' },
    { v: 'queued', label: '排队' },
    { v: 'completed', label: '完成' },
    { v: 'failed', label: '失败' },
  ];
  return (
    <div className="flex shrink-0 flex-wrap gap-1 border-b border-[var(--border)] px-2.5 py-1.5">
      {opts.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
            value === o.v ? 'bg-[var(--brand)] text-white' : 'text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text)]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 状态点（在线/运行中带 ping 扩散） */
function StatusDot({ color, ping }: { color: string; ping?: boolean }): JSX.Element {
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      {ping && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: color }} />}
      <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: color }} />
    </span>
  );
}

function DeviceCard({ name, agentCount, load, color, online, active, dimmed, onClick }: {
  name: string; agentCount: number; load: number; color: string; online: boolean; active: boolean; dimmed: boolean; onClick: (e: React.MouseEvent) => void;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className="group w-full rounded-md border bg-[var(--surface)] px-3 py-2.5 text-left transition-all hover:shadow-sm"
      style={{
        borderColor: active ? 'var(--brand)' : 'var(--border)',
        boxShadow: active ? '0 0 0 1px var(--brand)' : undefined,
        opacity: dimmed ? 0.35 : 1,
        borderLeft: `3px solid ${color}`,
      }}
    >
      <div className="flex items-center gap-2">
        <StatusDot color={color} ping={online} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text-strong)]">{truncate(name, 20)}</span>
        <span className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)]">{agentCount} agent</span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--bg-subtle)]">
          <div className="h-full rounded-full" style={{ width: `${Math.round(load * 100)}%`, background: color }} />
        </div>
        <span className="font-mono text-[10px] text-[var(--text-muted)]">{Math.round(load * 100)}%</span>
      </div>
    </button>
  );
}

function AgentCard({ initial, name, version, label, busy, busyCount, maxConcurrency, color, active, dimmed, onClick }: {
  initial: string; name: string; version: string; label: string; busy: boolean; busyCount: number; maxConcurrency: number; color: string; active: boolean; dimmed: boolean; onClick: (e: React.MouseEvent) => void;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className="group w-full rounded-md border bg-[var(--surface)] px-3 py-2.5 text-left transition-all hover:shadow-sm"
      style={{
        borderColor: active ? 'var(--brand)' : 'var(--border)',
        boxShadow: active ? '0 0 0 1px var(--brand)' : undefined,
        opacity: dimmed ? 0.35 : 1,
        borderLeft: `3px solid ${color}`,
      }}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white" style={{ background: color }}>
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-[var(--text-strong)]">{truncate(name, 18)}</div>
          <div className="font-mono text-[10px] text-[var(--text-muted)]">v{version}</div>
        </div>
        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ color, background: 'var(--bg-subtle)' }}>
          {label}{busy ? ` ${busyCount}/${maxConcurrency}` : ''}
        </span>
      </div>
    </button>
  );
}

function TaskCard({ prompt, resultText, label, target, color, running, active, dimmed, onClick }: {
  prompt: string; resultText: string; label: string; target: string; color: string; running: boolean; active: boolean; dimmed: boolean; onClick: (e: React.MouseEvent) => void;
}): JSX.Element {
  // 完成且有输出 → 主行直接展示输出内容（总览页一眼看到结果），副行展示问题原文
  const showResult = !running && !!resultText;
  const primary = showResult ? resultText : prompt;
  return (
    <button
      onClick={onClick}
      title={prompt + (resultText ? `\n\n${resultText}` : '')}
      className="group w-full rounded-md border bg-[var(--surface)] px-3 py-2.5 text-left transition-all hover:shadow-sm"
      style={{
        borderColor: active ? 'var(--brand)' : 'var(--border)',
        boxShadow: active ? '0 0 0 1px var(--brand)' : undefined,
        opacity: dimmed ? 0.35 : 1,
        borderLeft: `3px solid ${color}`,
      }}
    >
      <div className="flex items-center gap-2">
        <StatusDot color={color} ping={running} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--text)]">{truncate(primary, 48)}</span>
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--text-muted)]">
          {showResult ? truncate(prompt, 24) : truncate(target, 20)}
        </span>
        <span className="shrink-0 text-[10px] font-semibold" style={{ color }}>{label}</span>
      </div>
    </button>
  );
}

/** agent 状态色（busy 橙 / error 红 / 待登录灰 / 空闲紫） */
function agentColor(a: GraphAgentNode['data']): string {
  if (a.status === 'busy') return 'var(--warning)';
  if (a.status === 'error') return 'var(--danger)';
  if (a.status === 'needs_login' || !(a.activated as boolean | undefined)) return 'var(--offline)';
  return 'var(--agent)';
}

function agentLabel(a: GraphAgentNode['data']): string {
  if (a.status === 'busy') return '处理中';
  if (a.status === 'error') return '异常';
  if (a.status === 'needs_login' || !(a.activated as boolean | undefined)) return '待登录';
  return '空闲';
}
