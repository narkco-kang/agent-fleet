import { useCallback, useEffect, useMemo, useState } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Chip from '@mui/material/Chip';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import LinkIcon from '@mui/icons-material/Link';
import type { AgentType, RoleTeam, SubRole, SwarmPurpose } from '@agentfleet/shared';
import { AGENT_TYPES } from '@agentfleet/shared';
import { http } from '../api/http';
import { useDeviceStore } from '../store/deviceStore';
import { Card } from '../components/common/Card';

/**
 * 蜂群角色团队管理页：团队/子角色 CRUD + 设备绑定 + 软绑定（子角色 → agent 平台）。
 */

const PURPOSES: SwarmPurpose[] = ['software', 'content', 'security', 'research', 'general'];

function splitComma(s: string): string[] {
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

function splitLines(s: string): string[] {
  return s.split('\n').map((x) => x.trim()).filter(Boolean);
}

/** 子角色表单态（persona/operation 展开为可编辑字段） */
interface SubRoleForm {
  slug: string;
  name: string;
  description: string;
  capabilities: string;
  requiredCapabilities: string;
  preferredAgentType: string;
  identity: string;
  communication: string;
  style: string;
  rules: string;
  mission: string;
  workflow: string;
  deliverables: string;
}

function emptySubRoleForm(): SubRoleForm {
  return {
    slug: '',
    name: '',
    description: '',
    capabilities: '',
    requiredCapabilities: '',
    preferredAgentType: '',
    identity: '',
    communication: '',
    style: '',
    rules: '',
    mission: '',
    workflow: '',
    deliverables: '',
  };
}

function subRoleToForm(s: SubRole): SubRoleForm {
  return {
    slug: s.slug,
    name: s.name,
    description: s.description ?? '',
    capabilities: (s.capabilities ?? []).join(', '),
    requiredCapabilities: (s.requiredCapabilities ?? []).join(', '),
    preferredAgentType: s.preferredAgentType ?? '',
    identity: s.persona?.identity ?? '',
    communication: s.persona?.communication ?? '',
    style: s.persona?.style ?? '',
    rules: (s.persona?.rules ?? []).join('\n'),
    mission: s.operation?.mission ?? '',
    workflow: (s.operation?.workflow ?? []).join('\n'),
    deliverables: (s.operation?.deliverables ?? []).join('\n'),
  };
}

function formToInput(f: SubRoleForm): Omit<SubRole, 'subRoleId' | 'roleTeamId' | 'position'> {
  return {
    slug: f.slug.trim(),
    name: f.name.trim(),
    description: f.description.trim(),
    capabilities: splitComma(f.capabilities),
    requiredCapabilities: splitComma(f.requiredCapabilities),
    preferredAgentType: (f.preferredAgentType || undefined) as AgentType | undefined,
    persona: {
      identity: f.identity.trim(),
      communication: f.communication.trim(),
      style: f.style.trim(),
      rules: splitLines(f.rules),
    },
    operation: {
      mission: f.mission.trim(),
      workflow: splitLines(f.workflow),
      deliverables: splitLines(f.deliverables),
    },
  };
}

export default function SwarmTeamsPage(): JSX.Element {
  const [teams, setTeams] = useState<RoleTeam[]>([]);
  const [detail, setDetail] = useState<(RoleTeam & { subRoles: SubRole[] }) | null>(null);
  const [teamDialog, setTeamDialog] = useState<{ mode: 'create' | 'edit'; team?: RoleTeam } | null>(null);
  const [subRoleDialog, setSubRoleDialog] = useState<{ teamId: string; subRole?: SubRole } | null>(null);
  const [bindTeam, setBindTeam] = useState<RoleTeam | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    http.getSwarmTeams().then((r) => setTeams(r.data)).catch(() => setTeams([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = useCallback(
    (id: string) => {
      http.getSwarmTeam(id).then((r) => setDetail(r.data)).catch(() => setDetail(null));
    },
    [],
  );

  const saveTeam = async (payload: {
    name: string;
    slug?: string;
    description?: string;
    purpose?: SwarmPurpose;
  }): Promise<void> => {
    if (teamDialog?.mode === 'edit' && teamDialog.team) {
      await http.updateSwarmTeam(teamDialog.team.roleTeamId, payload);
    } else {
      await http.createSwarmTeam(payload);
    }
    setTeamDialog(null);
    load();
  };

  const removeTeam = async (team: RoleTeam): Promise<void> => {
    await http.deleteSwarmTeam(team.roleTeamId);
    if (detail?.roleTeamId === team.roleTeamId) setDetail(null);
    load();
  };

  const saveSubRole = async (f: SubRoleForm): Promise<void> => {
    if (!subRoleDialog) return;
    await http.upsertSwarmSubRole(subRoleDialog.teamId, formToInput(f));
    setSubRoleDialog(null);
    openDetail(subRoleDialog.teamId);
  };

  const removeSubRole = async (teamId: string, slug: string): Promise<void> => {
    await http.deleteSwarmSubRole(teamId, slug);
    openDetail(teamId);
  };

  const setLeader = async (teamId: string, slug: string | null): Promise<void> => {
    await http.setSwarmLeader(teamId, slug);
    openDetail(teamId);
  };

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--text-strong)]">蜂群角色团队</h1>
        <Button
          size="small"
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setTeamDialog({ mode: 'create' })}
        >
          新建团队
        </Button>
      </div>

      {error && <div className="mb-3 rounded-md bg-[var(--danger-soft)] px-3 py-2 text-xs text-[#B91C1C]">{error}</div>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-2 text-sm font-semibold text-[var(--text-strong)]">角色团队（{teams.length}）</div>
          <div className="space-y-2">
            {teams.length === 0 && (
              <div className="py-8 text-center text-sm text-[var(--text-muted)]">暂无角色团队，点击右上角新建</div>
            )}
            {teams.map((t) => (
              <div
                key={t.roleTeamId}
                className={`rounded-lg border p-3 ${detail?.roleTeamId === t.roleTeamId ? 'border-[#4F46E5] bg-[var(--brand-soft)]' : 'border-[var(--border)]'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <button className="min-w-0 flex-1 text-left" onClick={() => openDetail(t.roleTeamId)}>
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-[var(--text-strong)]">{t.name}</span>
                      {t.isPreset && <Chip label="预设" size="small" />}
                    </div>
                    <div className="truncate text-xs text-[var(--text-muted)]">
                      {t.slug} · {t.purpose} · {t.subRoleIds.length} 个子角色
                    </div>
                  </button>
                  <div className="flex shrink-0 gap-1">
                    <button title="编辑" onClick={() => setTeamDialog({ mode: 'edit', team: t })} className="text-[#4F46E5]">
                      <EditIcon fontSize="small" />
                    </button>
                    <button title="绑定设备" onClick={() => setBindTeam(t)} className="text-[#4F46E5]">
                      <LinkIcon fontSize="small" />
                    </button>
                    <button title="删除" onClick={() => removeTeam(t)} className="text-[#EF4444]">
                      <DeleteIcon fontSize="small" />
                    </button>
                  </div>
                </div>
                {t.description && <div className="mt-1 text-xs text-[var(--text-muted)]">{t.description}</div>}
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-[var(--text-strong)]">
              {detail ? `子角色（${detail.name}）` : '子角色'}
            </span>
            {detail && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={() => setSubRoleDialog({ teamId: detail.roleTeamId })}
              >
                新增子角色
              </Button>
            )}
          </div>
          {!detail ? (
            <div className="py-8 text-center text-sm text-[var(--text-muted)]">选择左侧团队查看子角色</div>
          ) : (
            <div className="space-y-2">
              {detail.subRoles.length === 0 && (
                <div className="py-8 text-center text-sm text-[var(--text-muted)]">暂无子角色</div>
              )}
              {detail.subRoles.map((s) => (
                <div key={s.subRoleId} className="rounded-lg border border-[var(--border)] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-medium text-[var(--text-strong)]">
                        {s.name}
                        {detail.leaderSlug === s.slug && <Chip label="Leader" size="small" color="primary" />}
                      </div>
                      <div className="truncate text-xs text-[var(--text-muted)]">
                        {s.slug}
                        {s.preferredAgentType ? ` · 偏好 ${s.preferredAgentType}` : ''}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        title={detail.leaderSlug === s.slug ? '取消 Leader' : '设为 Leader（未指定子角色的任务先路由到这里）'}
                        onClick={() => void setLeader(detail.roleTeamId, detail.leaderSlug === s.slug ? null : s.slug)}
                        className="text-[#0891B2]"
                      >
                        {detail.leaderSlug === s.slug ? '取消 Leader' : '设为 Leader'}
                      </button>
                      <button title="编辑" onClick={() => setSubRoleDialog({ teamId: detail.roleTeamId, subRole: s })} className="text-[#4F46E5]">
                        <EditIcon fontSize="small" />
                      </button>
                      <button title="删除" onClick={() => removeSubRole(detail.roleTeamId, s.slug)} className="text-[#EF4444]">
                        <DeleteIcon fontSize="small" />
                      </button>
                    </div>
                  </div>
                  {s.description && <div className="mt-1 text-xs text-[var(--text-muted)]">{s.description}</div>}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {s.capabilities.map((c) => (
                      <Chip key={c} label={c} size="small" variant="outlined" />
                    ))}
                  </div>
                  {s.persona?.identity && (
                    <div className="mt-2 line-clamp-2 text-xs text-[var(--text)]">{s.persona.identity}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {teamDialog && (
        <TeamFormDialog
          mode={teamDialog.mode}
          team={teamDialog.team}
          onClose={() => setTeamDialog(null)}
          onSave={saveTeam}
        />
      )}
      {subRoleDialog && (
        <SubRoleFormDialog
          subRole={subRoleDialog.subRole}
          onClose={() => setSubRoleDialog(null)}
          onSave={saveSubRole}
        />
      )}
      {bindTeam && (
        <BindDevicesDialog
          team={bindTeam}
          onClose={() => setBindTeam(null)}
          onError={setError}
          onSaved={() => {
            setBindTeam(null);
            if (detail?.roleTeamId === bindTeam.roleTeamId) openDetail(bindTeam.roleTeamId);
            load();
          }}
        />
      )}
    </div>
  );
}

/** 团队创建/编辑弹窗 */
function TeamFormDialog({
  mode,
  team,
  onClose,
  onSave,
}: {
  mode: 'create' | 'edit';
  team?: RoleTeam;
  onClose: () => void;
  onSave: (payload: { name: string; slug?: string; description?: string; purpose?: SwarmPurpose }) => Promise<void>;
}): JSX.Element {
  const [name, setName] = useState(team?.name ?? '');
  const [slug, setSlug] = useState(team?.slug ?? '');
  const [description, setDescription] = useState(team?.description ?? '');
  const [purpose, setPurpose] = useState<SwarmPurpose>(team?.purpose ?? 'general');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (): Promise<void> => {
    if (!name.trim()) {
      setError('团队名称必填');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSave({
        name: name.trim(),
        slug: mode === 'create' && slug.trim() ? slug.trim() : undefined,
        description: description.trim(),
        purpose,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{mode === 'create' ? '新建角色团队' : '编辑角色团队'}</DialogTitle>
      <DialogContent>
        <div className="mt-1 flex flex-col gap-3">
          <TextField label="团队名称" size="small" value={name} onChange={(e) => setName(e.target.value)} fullWidth />
          {mode === 'create' && (
            <TextField
              label="slug（可选，留空自动生成）"
              size="small"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              helperText="全局唯一，[a-z0-9-]"
              fullWidth
            />
          )}
          <TextField
            label="用途"
            size="small"
            select
            value={purpose}
            onChange={(e) => setPurpose(e.target.value as SwarmPurpose)}
            fullWidth
          >
            {PURPOSES.map((p) => (
              <MenuItem key={p} value={p}>
                {p}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="描述"
            size="small"
            multiline
            minRows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
          />
          {error && <div className="text-xs text-[#EF4444]">{error}</div>}
        </div>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit">
          取消
        </Button>
        <Button onClick={submit} variant="contained" disabled={busy}>
          保存
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** 子角色创建/编辑弹窗 */
function SubRoleFormDialog({
  subRole,
  onClose,
  onSave,
}: {
  subRole?: SubRole;
  onClose: () => void;
  onSave: (f: SubRoleForm) => Promise<void>;
}): JSX.Element {
  const [f, setF] = useState<SubRoleForm>(subRole ? subRoleToForm(subRole) : emptySubRoleForm());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (patch: Partial<SubRoleForm>): void => setF((prev) => ({ ...prev, ...patch }));

  const submit = async (): Promise<void> => {
    if (!f.slug.trim() || !f.name.trim()) {
      setError('slug 与名称必填');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSave(f);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{subRole ? '编辑子角色' : '新增子角色'}</DialogTitle>
      <DialogContent>
        <div className="mt-1 grid gap-3 md:grid-cols-2">
          <TextField label="slug" size="small" value={f.slug} onChange={(e) => set({ slug: e.target.value })} fullWidth disabled={!!subRole} />
          <TextField label="名称" size="small" value={f.name} onChange={(e) => set({ name: e.target.value })} fullWidth />
          <TextField
            label="描述"
            size="small"
            value={f.description}
            onChange={(e) => set({ description: e.target.value })}
            fullWidth
            className="md:col-span-2"
          />
          <TextField
            label="能力（逗号分隔）"
            size="small"
            value={f.capabilities}
            onChange={(e) => set({ capabilities: e.target.value })}
            fullWidth
          />
          <TextField
            label="兜底能力要求（逗号分隔）"
            size="small"
            value={f.requiredCapabilities}
            onChange={(e) => set({ requiredCapabilities: e.target.value })}
            fullWidth
          />
          <TextField
            label="偏好平台"
            size="small"
            select
            value={f.preferredAgentType}
            onChange={(e) => set({ preferredAgentType: e.target.value })}
            fullWidth
          >
            <MenuItem value="">自动（无偏好）</MenuItem>
            {AGENT_TYPES.map((a) => (
              <MenuItem key={a} value={a}>
                {a}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="身份定位"
            size="small"
            multiline
            minRows={2}
            value={f.identity}
            onChange={(e) => set({ identity: e.target.value })}
            fullWidth
            className="md:col-span-2"
          />
          <TextField
            label="沟通方式"
            size="small"
            multiline
            minRows={2}
            value={f.communication}
            onChange={(e) => set({ communication: e.target.value })}
            fullWidth
            className="md:col-span-2"
          />
          <TextField
            label="行为准则（每行一条）"
            size="small"
            multiline
            minRows={3}
            value={f.rules}
            onChange={(e) => set({ rules: e.target.value })}
            fullWidth
            className="md:col-span-2"
          />
          <TextField
            label="风格"
            size="small"
            value={f.style}
            onChange={(e) => set({ style: e.target.value })}
            fullWidth
            className="md:col-span-2"
          />
          <TextField
            label="任务使命"
            size="small"
            multiline
            minRows={2}
            value={f.mission}
            onChange={(e) => set({ mission: e.target.value })}
            fullWidth
            className="md:col-span-2"
          />
          <TextField
            label="工作流程（每行一步）"
            size="small"
            multiline
            minRows={3}
            value={f.workflow}
            onChange={(e) => set({ workflow: e.target.value })}
            fullWidth
          />
          <TextField
            label="交付物（每行一项）"
            size="small"
            multiline
            minRows={3}
            value={f.deliverables}
            onChange={(e) => set({ deliverables: e.target.value })}
            fullWidth
          />
          {error && <div className="text-xs text-[#EF4444] md:col-span-2">{error}</div>}
        </div>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit">
          取消
        </Button>
        <Button onClick={submit} variant="contained" disabled={busy}>
          保存
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** 设备绑定 + 软绑定弹窗 */
function BindDevicesDialog({
  team,
  onClose,
  onSaved,
  onError,
}: {
  team: RoleTeam;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}): JSX.Element {
  const devices = useDeviceStore((s) => s.devices);
  const [subRoles, setSubRoles] = useState<SubRole[]>([]);
  const [bound, setBound] = useState<Set<string>>(new Set());
  const [soft, setSoft] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState(false);

  const deviceAgentTypes = useMemo(() => {
    const map = new Map<string, AgentType[]>();
    for (const d of devices) map.set(d.deviceId, d.agents.map((a) => a.agentType));
    return map;
  }, [devices]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [detailRes, bindingRes] = await Promise.all([
          http.getSwarmTeam(team.roleTeamId),
          http.getSwarmDeviceBindings(),
        ]);
        if (!alive) return;
        setSubRoles(detailRes.data.subRoles);
        const boundSet = new Set(
          bindingRes.data.filter((b) => b.roleTeamId === team.roleTeamId).map((b) => b.deviceId),
        );
        setBound(boundSet);
        const softMap: Record<string, Record<string, string>> = {};
        for (const deviceId of boundSet) {
          try {
            const sr = await http.getSubRoleBindings(deviceId);
            softMap[deviceId] = sr.data as Record<string, string>;
          } catch {
            softMap[deviceId] = {};
          }
        }
        if (alive) setSoft(softMap);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      alive = false;
    };
  }, [team.roleTeamId]);

  const toggle = (deviceId: string): void => {
    setBound((prev) => {
      const next = new Set(prev);
      if (next.has(deviceId)) next.delete(deviceId);
      else next.add(deviceId);
      return next;
    });
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const toBind = Array.from(bound);
      await http.bindSwarmDevices(team.roleTeamId, toBind);
      // 解绑未选中的设备
      const all = devices.map((d) => d.deviceId);
      const toUnbind = all.filter((id) => !bound.has(id));
      for (const deviceId of toUnbind) {
        await http.unbindSwarmDevice(team.roleTeamId, deviceId).catch(() => undefined);
      }
      // 软绑定：为选中设备逐个写回
      for (const deviceId of toBind) {
        for (const sr of subRoles) {
          const agentType = soft[deviceId]?.[sr.slug] ?? '';
          await http.setSubRoleBinding(deviceId, sr.slug, (agentType || null) as AgentType | null);
        }
      }
      onSaved();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>绑定设备到「{team.name}」</DialogTitle>
      <DialogContent>
        <div className="mt-1 space-y-2">
          {devices.length === 0 && (
            <div className="py-6 text-center text-sm text-[var(--text-muted)]">暂无可绑定的设备</div>
          )}
          {devices.map((d) => {
            const selected = bound.has(d.deviceId);
            const types = deviceAgentTypes.get(d.deviceId) ?? [];
            return (
              <div key={d.deviceId} className={`rounded-lg border p-3 ${selected ? 'border-[#4F46E5] bg-[var(--brand-soft)]' : 'border-[var(--border)]'}`}>
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={selected} onChange={() => toggle(d.deviceId)} />
                  <span className="font-medium text-[var(--text-strong)]">{d.name}</span>
                  <span className="text-xs text-[var(--text-muted)]">{d.deviceId}</span>
                  <span className="text-xs text-[var(--text-muted)]">{d.status}</span>
                </label>
                {selected && subRoles.length > 0 && (
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    {subRoles.map((sr) => (
                      <div key={sr.slug} className="flex items-center gap-2">
                        <span className="w-24 shrink-0 text-xs text-[var(--text)]">{sr.name}</span>
                        <TextField
                          size="small"
                          select
                          fullWidth
                          value={soft[d.deviceId]?.[sr.slug] ?? ''}
                          onChange={(e) =>
                            setSoft((prev) => ({
                              ...prev,
                              [d.deviceId]: { ...(prev[d.deviceId] ?? {}), [sr.slug]: e.target.value },
                            }))
                          }
                        >
                          <MenuItem value="">自动（偏好/能力兜底）</MenuItem>
                          {types.map((t) => (
                            <MenuItem key={t} value={t}>
                              {t}
                            </MenuItem>
                          ))}
                        </TextField>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit">
          取消
        </Button>
        <Button onClick={save} variant="contained" disabled={busy}>
          {busy ? '保存中…' : '保存绑定'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
