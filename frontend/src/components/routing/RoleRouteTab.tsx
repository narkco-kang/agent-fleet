import { useCallback, useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import type { RoleRoute } from '@agentfleet/shared';
import { routingApi } from '../../api/routing';
import { Card } from '../common/Card';

/**
 * 角色路由表：角色 → 主/兜底 ref + 能力 + 模型。
 */
const EMPTY: RoleRoute = {
  role: '',
  primary: '',
  fallback: [],
  capability: 'chat',
  bots: [],
  model: '',
  enabled: true,
};

export function RoleRouteTab(): JSX.Element {
  const [routes, setRoutes] = useState<RoleRoute[]>([]);
  const [editing, setEditing] = useState<RoleRoute | null>(null);
  const [importJson, setImportJson] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    routingApi
      .roles()
      .then((r) => setRoutes(r.data))
      .catch(() => setRoutes([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (role: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await routingApi.deleteRole(role);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async (): Promise<void> => {
    if (!editing || !editing.role || !editing.primary) {
      setError('role 与 primary 必填');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await routingApi.saveRole(editing);
      setEditing(null);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doImport = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await routingApi.importRoles(importJson);
      setImportJson('');
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-[#0F172A]">角色路由（{routes.length}）</span>
        <div className="flex gap-2">
          <Button size="small" variant="outlined" onClick={() => setEditing({ ...EMPTY })}>
            新增
          </Button>
          <Button size="small" color="inherit" onClick={doImport} disabled={busy || !importJson.trim()}>
            导入 JSON
          </Button>
        </div>
      </div>

      <TextField
        size="small"
        placeholder="粘贴 JSON（单条或数组）后点「导入 JSON」"
        value={importJson}
        onChange={(e) => setImportJson(e.target.value)}
        fullWidth
        multiline
        minRows={2}
        className="mb-3"
      />

      {error && <div className="mb-2 rounded-md bg-[#FEE2E2] px-3 py-2 text-xs text-[#B91C1C]">{error}</div>}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-[#F8FAFC] text-left text-xs text-[#64748B]">
              <th className="px-3 py-2 font-medium">角色</th>
              <th className="px-3 py-2 font-medium">主路由</th>
              <th className="px-3 py-2 font-medium">兜底</th>
              <th className="px-3 py-2 font-medium">能力</th>
              <th className="px-3 py-2 font-medium">模型</th>
              <th className="px-3 py-2 font-medium">启用</th>
              <th className="px-3 py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {routes.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-[#94A3B8]">
                  暂无角色路由
                </td>
              </tr>
            ) : (
              routes.map((r) => (
                <tr key={r.role} className="border-t border-[#E2E8F0]">
                  <td className="px-3 py-2 text-[#334155]">{r.role}</td>
                  <td className="px-3 py-2 text-[#334155]">{r.primary}</td>
                  <td className="px-3 py-2 text-[#64748B]">{r.fallback?.join(', ') || '—'}</td>
                  <td className="px-3 py-2 text-[#334155]">{r.capability}</td>
                  <td className="px-3 py-2 text-[#334155]">{r.model ?? '—'}</td>
                  <td className="px-3 py-2 text-[#334155]">{r.enabled ? '是' : '否'}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <button onClick={() => setEditing({ ...r, fallback: [...(r.fallback ?? [])] })} className="text-[#4F46E5]">
                        <EditIcon fontSize="small" />
                      </button>
                      <button onClick={() => remove(r.role)} className="text-[#EF4444]">
                        <DeleteIcon fontSize="small" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={!!editing} onClose={() => setEditing(null)} maxWidth="sm" fullWidth>
        <DialogTitle className="text-[#0F172A]">{editing && routes.some((r) => r.role === editing.role) ? '编辑角色路由' : '新增角色路由'}</DialogTitle>
        <DialogContent>
          {editing && (
            <div className="mt-1 flex flex-col gap-3">
              <TextField
                label="角色名"
                size="small"
                value={editing.role}
                onChange={(e) => setEditing({ ...editing, role: e.target.value })}
                fullWidth
              />
              <TextField
                label="主路由 ref"
                size="small"
                value={editing.primary}
                onChange={(e) => setEditing({ ...editing, primary: e.target.value })}
                fullWidth
              />
              <TextField
                label="兜底 ref（逗号分隔）"
                size="small"
                value={(editing.fallback ?? []).join(', ')}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    fallback: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                  })
                }
                fullWidth
              />
              <TextField
                label="能力"
                size="small"
                select
                value={editing.capability}
                onChange={(e) => setEditing({ ...editing, capability: e.target.value as RoleRoute['capability'] })}
                fullWidth
              >
                <MenuItem value="chat">chat</MenuItem>
                <MenuItem value="decision-only">decision-only</MenuItem>
              </TextField>
              <TextField
                label="模型 ref（经 modelgateway）"
                size="small"
                value={editing.model ?? ''}
                onChange={(e) => setEditing({ ...editing, model: e.target.value })}
                fullWidth
              />
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#334155]">启用</span>
                <Switch
                  checked={editing.enabled}
                  onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
                />
              </div>
            </div>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)} color="inherit">
            取消
          </Button>
          <Button onClick={save} disabled={busy} variant="contained">
            保存
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
