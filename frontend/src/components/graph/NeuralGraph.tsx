import { useMemo, useState, type ReactNode, Children } from 'react';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useGraphData, type GraphAgentNode, type GraphDeviceNode, type GraphTaskNode } from '../../hooks/useGraphData';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import type { NodeLens } from './GraphToolbar';
import type { DetailTarget } from '../drawer/DetailDrawer';

/**
 * 智能体舰队总览（Mission Control 布局，替代 SVG 三层泳道图）。
 *
 * 两栏：左「设备」（内嵌其 agent，可折叠）+ 右「任务」（可折叠）。
 * - 设备头点击折叠/展开其 agent；agent 子卡片点击打开详情（含「打开平台登录」）。
 * - 任务点击折叠/展开输出；右上 info 打开详情。
 * - 运行中节点展示「上流向」数据粒子（光点自下而上流动，示意数据上行）。
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
  waiting: 'var(--offline)',
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
  waiting: '等待',
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
  const [collapsedDevices, setCollapsedDevices] = useState<Set<string>>(new Set());
  const [collapsedTasks, setCollapsedTasks] = useState<Set<string>>(new Set());

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
          return bb - ab;
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
  // 选中项归属的设备 id（点击设备/agent 时，任务列表按该设备过滤，其余不变灰）
  const focusDeviceId = useMemo(() => {
    if (!focus) return null;
    if (devices.some((d) => d.id === focus)) return focus;
    const a = agents.find((x) => x.id === focus);
    if (a) return a.deviceId;
    return null;
  }, [focus, devices, agents]);

  const visibleTasks = useMemo(() => {
    let ts = tasks;
    if (focusDeviceId) ts = ts.filter((t) => t.data.targetDeviceId === focusDeviceId);
    if (taskFilter === 'all') return ts;
    if (taskFilter === 'failed') return ts.filter((t) => ['failed', 'cancelled', 'interrupted'].includes(t.data.status));
    return ts.filter((t) => t.data.status === taskFilter);
  }, [tasks, taskFilter, focusDeviceId]);

  // 归属索引
  const agentsByDevice = useMemo(() => {
    const m = new Map<string, GraphAgentNode[]>();
    for (const a of agents) {
      if (!m.has(a.deviceId)) m.set(a.deviceId, []);
      m.get(a.deviceId)!.push(a);
    }
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

  // （不再做「点击后其它全变灰」的联动高亮——改为选中项 active 高亮 + 任务按设备过滤，见 focusDeviceId）

  // KPI
  const onlineDevices = devices.filter((d) => d.data.status === 'online' || d.data.status === 'busy').length;
  const busyAgents = agents.filter((a) => a.data.status === 'busy').length;
  const runningTasks = tasks.filter((t) => t.data.status === 'running').length;
  const alerts = tasks.filter((t) => t.data.status === 'failed' || t.data.status === 'interrupted' || t.data.status === 'cancelled').length;
  const needsLoginAgents = agents.filter((a) => a.data.status === 'needs_login' || (a.data.activated as boolean | undefined) === false).length;
  const idleAgents = agents.length - busyAgents - needsLoginAgents - agents.filter((a) => a.data.status === 'error').length;
  const queuedTasks = tasks.filter((t) => t.data.status === 'queued' || t.data.status === 'waiting').length;
  const completedTasks = tasks.filter((t) => t.data.status === 'completed').length;

  const select = (target: DetailTarget | null): void => {
    onSelect?.(target);
    setFocus(target ? target.id : null);
  };

  const toggleDevice = (id: string): void => {
    setCollapsedDevices((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleTask = (id: string): void => {
    setCollapsedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const blank = (): void => {
    setFocus(null);
    onSelect?.(null);
  };

  const lensDim = (type: string): boolean => lens !== 'all' && lens !== type;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden" onClick={blank}>
      {/* 顶部 KPI 概览 */}
      <div className="flex shrink-0 items-center gap-6 border-b border-[var(--border)] px-5 pr-[340px]" style={{ background: 'var(--bg)' }}>
        <Kpi value={onlineDevices} total={devices.length} label="在线设备" color="var(--success)" />
        <Kpi value={agents.length} label="Agent" sub={`${busyAgents} 处理中`} color="var(--agent)" />
        <Kpi value={runningTasks} total={tasks.length} label="运行中任务" color="var(--warning)" />
        <Kpi value={alerts} label="告警" color={alerts > 0 ? 'var(--danger)' : 'var(--offline)'} />
      </div>

      {/* 两栏：设备（内嵌 agent 可折叠）| 任务（可折叠） */}
      <div
        className={`flex-1 overflow-hidden ${isMobile ? 'overflow-y-auto' : ''}`}
        style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'minmax(280px, 380px) 1fr',
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
            const devAgents = agentsByDevice.get(d.id) ?? [];
            return (
              <DeviceGroup
                key={d.id}
                device={d}
                agents={devAgents}
                collapsed={collapsedDevices.has(d.id)}
                active={focus === d.id}
                dimmed={lensDim('device')}
                onToggle={() => toggleDevice(d.id)}
                onSelect={() => select({ kind: 'device', id: d.data.deviceId, title: d.data.name })}
                onSelectAgent={(a) =>
                  select({ kind: 'agent', id: a.id, title: a.data.displayName, deviceId: a.deviceId, agentType: a.data.agentType })
                }
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
          headerExtra={
            <>
              <TaskFilter value={taskFilter} onChange={setTaskFilter} />
              {focusDeviceId && (
                <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--brand-soft)] px-2.5 py-1">
                  <span className="text-[11px] text-[#4F46E5]">
                    仅显示 {devices.find((d) => d.id === focusDeviceId)?.data.name ?? '该设备'} 的任务
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setFocus(null); onSelect?.(null); }}
                    className="rounded px-1.5 text-[11px] text-[#4F46E5] hover:bg-[var(--brand-soft)]"
                  >
                    清除
                  </button>
                </div>
              )}
            </>
          }
        >
          {visibleTasks.map((t) => {
            const st = t.data.status;
            const color = STATUS_VAR[st] ?? 'var(--offline)';
            const running = st === 'running';
            const agentId = taskAgent.get(t.id);
            const agentName = agents.find((a) => a.id === agentId)?.data.displayName;
            return (
              <TaskCard
                key={t.id}
                prompt={t.data.prompt}
                resultText={t.data.resultText ?? ''}
                label={STATUS_LABEL[st] ?? st}
                target={agentName ?? (t.data.targetAgentType ?? '未分配')}
                color={color}
                running={running}
                collapsed={collapsedTasks.has(t.id)}
                active={focus === t.id}
                dimmed={lensDim('task')}
                onToggle={() => toggleTask(t.id)}
                onSelect={() => select({ kind: 'task', id: t.data.taskId, title: t.data.prompt.slice(0, 40) })}
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

/** 状态分布迷你条：色块按占比 + 计数 */
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
    { v: 'waiting', label: '等待' },
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

/** 上流向数据粒子：光点自下而上循环流动（运行中/处理中节点展示） */
function FlowParticles({ color }: { color: string }): JSX.Element {
  const dots = [0, 1, 2];
  return (
    <div className="pointer-events-none absolute inset-y-2 left-1.5 w-1" aria-hidden>
      {dots.map((i) => (
        <span
          key={i}
          className="absolute left-0 h-1.5 w-1.5 rounded-full"
          style={{
            top: 0,
            background: color,
            boxShadow: `0 0 4px ${color}`,
            animation: `flow-up ${1.8 + i * 0.5}s linear infinite`,
            animationDelay: `${i * 0.6}s`,
          }}
        />
      ))}
    </div>
  );
}

/** 设备分组：设备头（点击折叠）+ 内嵌 agent 子卡片 */
function DeviceGroup({ device, agents, collapsed, active, dimmed, onToggle, onSelect, onSelectAgent }: {
  device: GraphDeviceNode; agents: GraphAgentNode[]; collapsed: boolean; active: boolean; dimmed: boolean;
  onToggle: () => void; onSelect: () => void; onSelectAgent: (a: GraphAgentNode) => void;
}): JSX.Element {
  const color = STATUS_VAR[device.data.status] ?? 'var(--offline)';
  const online = device.data.status === 'online' || device.data.status === 'busy';
  const load = device.data.load?.cpu ?? 0;
  const busyCount = agents.filter((a) => a.data.status === 'busy').length;
  return (
    <div className="flex flex-col gap-1.5" style={{ opacity: dimmed ? 0.35 : 1 }}>
      <button
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
        className="group w-full rounded-md border bg-[var(--surface)] px-2.5 py-2 text-left transition-all hover:shadow-sm"
        style={{
          borderColor: active ? 'var(--brand)' : 'var(--border)',
          boxShadow: active ? '0 0 0 1px var(--brand)' : undefined,
          borderLeft: `3px solid ${color}`,
        }}
      >
        <div className="flex items-center gap-2">
          <span
            role="button"
            title={collapsed ? '展开 agent' : '折叠 agent'}
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className="shrink-0 rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text)]"
          >
            <ExpandMoreIcon
              fontSize="small"
              className="shrink-0 transition-transform"
              style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
            />
          </span>
          <StatusDot color={color} ping={online} />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text-strong)]">{truncate(device.data.name, 18)}</span>
          <span className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)]">
            {agents.length} agent{busyCount > 0 ? ` · ${busyCount} 忙` : ''}
          </span>
          <span
            role="button"
            title="设备详情"
            onClick={(e) => { e.stopPropagation(); onSelect(); }}
            className="shrink-0 rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--brand)]"
          >
            <InfoOutlinedIcon style={{ fontSize: 16 }} />
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--bg-subtle)]">
            <div className="h-full rounded-full" style={{ width: `${Math.round(load * 100)}%`, background: color }} />
          </div>
          <span className="font-mono text-[10px] text-[var(--text-muted)]">{Math.round(load * 100)}%</span>
        </div>
      </button>

      {!collapsed && (
        <div className="ml-3 flex flex-col gap-1.5 border-l border-[var(--border)] pl-2">
          {agents.length === 0 && (
            <div className="px-2 py-1 text-[11px] text-[var(--text-muted)]">无已装 agent</div>
          )}
          {agents.map((a) => (
            <AgentCard
              key={a.id}
              agent={a}
              dimmed={dimmed}
              onClick={(e) => { e.stopPropagation(); onSelectAgent(a); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentCard({ agent, dimmed, onClick }: {
  agent: GraphAgentNode; dimmed: boolean; onClick: (e: React.MouseEvent) => void;
}): JSX.Element {
  const a = agent.data;
  const color = agentColor(a);
  const busy = a.status === 'busy';
  return (
    <button
      onClick={onClick}
      className="group relative w-full rounded-md border bg-[var(--surface)] px-2.5 py-2 text-left transition-all hover:shadow-sm"
      style={{
        borderColor: 'var(--border)',
        opacity: dimmed ? 0.5 : 1,
        borderLeft: `3px solid ${color}`,
      }}
    >
      {busy && <FlowParticles color={color} />}
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white" style={{ background: color }}>
          {agentInitial(a.agentType)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-[var(--text-strong)]">{truncate(a.displayName, 18)}</div>
          <div className="font-mono text-[10px] text-[var(--text-muted)]">v{a.version}</div>
        </div>
        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ color, background: 'var(--bg-subtle)' }}>
          {agentLabel(a)}{busy ? ` ${a.busyCount}/${a.maxConcurrency}` : ''}
        </span>
      </div>
    </button>
  );
}

function TaskCard({ prompt, resultText, label, target, color, running, collapsed, active, dimmed, onToggle, onSelect }: {
  prompt: string; resultText: string; label: string; target: string; color: string; running: boolean;
  collapsed: boolean; active: boolean; dimmed: boolean; onToggle: () => void; onSelect: () => void;
}): JSX.Element {
  const showResult = !running && !!resultText;
  return (
    <div
      className="relative w-full rounded-md border bg-[var(--surface)] transition-all hover:shadow-sm"
      style={{
        borderColor: active ? 'var(--brand)' : 'var(--border)',
        boxShadow: active ? '0 0 0 1px var(--brand)' : undefined,
        opacity: dimmed ? 0.35 : 1,
        borderLeft: `3px solid ${color}`,
      }}
    >
      {running && <FlowParticles color={color} />}
      <div className="flex items-center gap-1.5 px-2.5 py-2">
        <button onClick={(e) => { e.stopPropagation(); onToggle(); }} className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text)]">
          <ExpandMoreIcon fontSize="small" style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform .15s' }} />
        </button>
        <StatusDot color={color} ping={running} />
        <button onClick={(e) => { e.stopPropagation(); onSelect(); }} className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-[var(--text)]">
          {truncate(showResult ? resultText : prompt, 52)}
        </button>
        <span className="shrink-0 text-[10px] font-semibold" style={{ color }}>{label}</span>
      </div>
      {!collapsed && (
        <div className="flex items-center justify-between border-t border-[var(--border)] px-2.5 py-1.5">
          <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--text-muted)]">
            {showResult ? truncate(prompt, 40) : truncate(target, 20)}
          </span>
          <span
            role="button"
            title="任务详情"
            onClick={(e) => { e.stopPropagation(); onSelect(); }}
            className="shrink-0 rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--brand)]"
          >
            <InfoOutlinedIcon style={{ fontSize: 14 }} />
          </span>
        </div>
      )}
    </div>
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
