import { useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import { http } from '../../api/http';

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
  const [mode, setMode] = useState<'auto' | 'device' | 'agent'>('auto');
  const [agentType, setAgentType] = useState('grok');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async (): Promise<void> => {
    if (!prompt.trim()) {
      setError('请输入任务描述');
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
            onChange={(e) => setMode(e.target.value as 'auto' | 'device' | 'agent')}
          >
            <MenuItem value="auto">自动（空闲优先 + 能力匹配）</MenuItem>
            <MenuItem value="device">指定设备</MenuItem>
            <MenuItem value="agent">指定 agent 平台</MenuItem>
          </TextField>
          {mode === 'agent' && (
            <TextField
              fullWidth
              select
              label="agent 平台"
              value={agentType}
              onChange={(e) => setAgentType(e.target.value)}
            >
              <MenuItem value="grok">Grok</MenuItem>
              <MenuItem value="codex">Codex</MenuItem>
              <MenuItem value="claude">Claude Code</MenuItem>
              <MenuItem value="dsh">DSH</MenuItem>
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
