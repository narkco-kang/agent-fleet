import { useEffect, useMemo, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import type { AgentBot, AgentType, RoleTeam, SubRole } from '@agentfleet/shared';
import { AGENT_TYPES } from '@agentfleet/shared';
import { http } from '../../api/http';
import { useDeviceStore } from '../../store/deviceStore';

/** agent 平台友好名（完整 14 平台，含 workbuddy） */
const AGENT_LABELS: Record<AgentType, string> = {
  codex: 'Codex',
  claude: 'Claude Code',
  dsh: 'DSH',
  grok: 'Grok',
  cursor: 'Cursor',
  aider: 'Aider',
  gemini: 'Gemini CLI',
  cody: 'Cody',
  qwen: 'Qwen Code',
  doubao: 'Doubao',
  kimi: 'Kimi',
  opencode: 'OpenCode',
  windsurf: 'Windsurf',
  workbuddy: 'WorkBuddy',
};

/**
 * 新建任务弹窗（04 §3.6 / §7）。
 */
export function NewTaskDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (taskId: string) => void;
}): JSX.Element {
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<'auto' | 'device' | 'agent' | 'swarm'>('auto');
  const [agentType, setAgentType] = useState('grok');
  const [bot, setBot] = useState('');
  const [swarmTeams, setSwarmTeams] = useState<RoleTeam[]>([]);
  const [roleTeamId, setRoleTeamId] = useState('');
  const [subRoles, setSubRoles] = useState<SubRole[]>([]);
  const [subRole, setSubRole] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const devices = useDeviceStore((s) => s.devices);

  // 加载蜂群角色团队（swarm 下发入口）
  useEffect(() => {
    http.getSwarmTeams().then((r) => setSwarmTeams(r.data)).catch(() => setSwarmTeams([]));
  }, []);

  // 选中团队后加载其子角色
  useEffect(() => {
    if (!roleTeamId) {
      setSubRoles([]);
      setSubRole('');
      return;
    }
    http
      .getSwarmTeam(roleTeamId)
      .then((r) => {
        setSubRoles(r.data.subRoles);
        setSubRole(r.data.subRoles[0]?.slug ?? '');
      })
      .catch(() => setSubRoles([]));
  }, [roleTeamId]);

  // 收集所选 agent 平台在所有在线设备上的 bot 列表（去重）
  const bots: AgentBot[] = useMemo(() => {
    const seen = new Map<string, AgentBot>();
    for (const d of devices) {
      for (const a of d.agents) {
        if (a.agentType !== agentType) continue;
        for (const b of a.bots ?? []) {
          if (b.name && !seen.has(b.name)) seen.set(b.name, b);
        }
      }
    }
    return Array.from(seen.values());
  }, [devices, agentType]);

  const submit = async (): Promise<void> => {
    if (!prompt.trim()) {
      setError('请输入任务描述');
      return;
    }
    if (mode === 'swarm' && !roleTeamId) {
      setError('请选择蜂群角色团队');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await http.createTask({
        prompt: prompt.trim(),
        origin: 'dashboard',
        target: {
          mode,
          agentType: mode === 'agent' ? agentType : undefined,
          agentProfile: mode === 'agent' && bot ? bot : undefined,
          roleTeamId: mode === 'swarm' ? roleTeamId : undefined,
          subRole: mode === 'swarm' ? subRole : undefined,
        },
      });
      onCreated?.(res.data.taskId);
      setPrompt('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>新建任务</DialogTitle>
      <DialogContent>
        <div className="space-y-3 pt-1">
          <TextField
            fullWidth
            multiline
            minRows={3}
            label="任务描述（自然语言）"
            placeholder="例如：修复登录超时的 bug"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <TextField
            fullWidth
            select
            label="路由模式"
            value={mode}
            onChange={(e) => setMode(e.target.value as 'auto' | 'device' | 'agent' | 'swarm')}
          >
            <MenuItem value="auto">自动（空闲优先 + 能力匹配）</MenuItem>
            <MenuItem value="device">指定设备</MenuItem>
            <MenuItem value="agent">指定 agent 平台</MenuItem>
            <MenuItem value="swarm">蜂群角色团队（swarm）</MenuItem>
          </TextField>
          {mode === 'swarm' && (
            <>
              <TextField
                fullWidth
                select
                label="角色团队"
                value={roleTeamId}
                onChange={(e) => setRoleTeamId(e.target.value)}
              >
                <MenuItem value="">选择团队…</MenuItem>
                {swarmTeams.map((t) => (
                  <MenuItem key={t.roleTeamId} value={t.roleTeamId}>
                    {t.name}（{t.slug}）
                  </MenuItem>
                ))}
              </TextField>
              {roleTeamId && (
                <TextField
                  fullWidth
                  select
                  label="子角色"
                  value={subRole}
                  onChange={(e) => setSubRole(e.target.value)}
                >
                  {subRoles.map((s) => (
                    <MenuItem key={s.subRoleId} value={s.slug}>
                      {s.name}（{s.slug}）
                    </MenuItem>
                  ))}
                </TextField>
              )}
            </>
          )}
          {mode === 'agent' && (
            <TextField
              fullWidth
              select
              label="agent 平台"
              value={agentType}
              onChange={(e) => {
                setAgentType(e.target.value);
                setBot('');
              }}
            >
              {AGENT_TYPES.map((t) => (
                <MenuItem key={t} value={t}>
                  {AGENT_LABELS[t]}
                </MenuItem>
              ))}
            </TextField>
          )}
          {mode === 'agent' && bots.length > 0 && (
            <TextField
              fullWidth
              select
              label="bot（grok 内自定义 agent）"
              value={bot}
              onChange={(e) => setBot(e.target.value)}
              helperText="自动委派：由 grok 自行拆分任务给子 agent（explore/plan）并行处理；手动选 = 整个任务强制用该角色"
            >
              <MenuItem value="">自动委派（grok 自行决定，推荐）</MenuItem>
              {bots.map((b) => (
                <MenuItem key={b.name} value={b.name}>
                  {b.name}
                  {b.description ? ` — ${b.description}` : ''}
                </MenuItem>
              ))}
            </TextField>
          )}
          {error && <div className="text-sm text-[#EF4444]">{error}</div>}
        </div>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="outlined">
          取消
        </Button>
        <Button onClick={submit} variant="contained" disabled={submitting}>
          {submitting ? '提交中…' : '下发任务'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
