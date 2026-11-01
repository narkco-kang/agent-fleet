import { useRef, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import type { DeploymentKind } from '@agentmesh/shared';
import { deployApi } from '../../api/deploy';

/**
 * 新建部署/卸载批次：Excel 上传（multipart）或 JSON targets 直传。
 */
export function NewBatchDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (summary: string) => void;
}): JSX.Element {
  const [name, setName] = useState('deploy-batch');
  const [kind, setKind] = useState<DeploymentKind>('deploy');
  const [targetsJson, setTargetsJson] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const file = fileRef.current?.files?.[0];
      let result;
      if (file) {
        result =
          kind === 'uninstall'
            ? await deployApi.createUninstallExcel(file, name)
            : await deployApi.createExcel(file, name);
      } else if (targetsJson.trim()) {
        let targets: unknown[];
        try {
          const parsed = JSON.parse(targetsJson) as unknown;
          targets = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          setError('JSON 解析失败');
          return;
        }
        result = await deployApi.createFromTargets(name, targets, kind);
      } else {
        setError('请选择 Excel 文件，或填写 JSON targets');
        return;
      }
      onCreated(result.data.summary);
      reset();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reset = (): void => {
    setName('deploy-batch');
    setKind('deploy');
    setTargetsJson('');
    setError(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle className="text-[#0F172A]">新建部署批次</DialogTitle>
      <DialogContent>
        <div className="mt-1 flex flex-col gap-3">
          <TextField
            label="批次名称"
            size="small"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
          />
          <TextField
            label="类型"
            size="small"
            select
            value={kind}
            onChange={(e) => setKind(e.target.value as DeploymentKind)}
            fullWidth
          >
            <MenuItem value="deploy">一键部署</MenuItem>
            <MenuItem value="uninstall">一键卸载</MenuItem>
          </TextField>
          <div>
            <div className="mb-1 text-xs text-[#64748B]">上传 Excel（.xlsx / .xls / .csv）</div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="text-sm" />
          </div>
          <div>
            <div className="mb-1 text-xs text-[#64748B]">
              或直接粘贴 JSON targets（可选，优先使用上传文件）
            </div>
            <TextField
              placeholder='[{"ip":"192.168.1.10","user":"root","port":22,"platforms":["claude"]}]'
              size="small"
              multiline
              minRows={3}
              value={targetsJson}
              onChange={(e) => setTargetsJson(e.target.value)}
              fullWidth
            />
          </div>
          {error && <div className="rounded-md bg-[#FEE2E2] px-3 py-2 text-xs text-[#B91C1C]">{error}</div>}
        </div>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit">
          取消
        </Button>
        <Button onClick={submit} disabled={busy} variant="contained">
          {busy ? '提交中…' : '创建'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
