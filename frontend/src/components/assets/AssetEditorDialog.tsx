import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import type { Asset, AssetKind } from '@agentmesh/shared';
import { assetsApi } from '../../api/assets';

const KIND_OPTIONS: Array<{ value: AssetKind; label: string }> = [
  { value: 'rule', label: '规则' },
  { value: 'knowledge', label: '资料库' },
  { value: 'skill', label: 'skills' },
];

/** 标签解析：支持中英文逗号与换行分隔，去空白去重（保持顺序） */
function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  return raw
    .split(/[,，\n]/)
    .map((t) => t.trim())
    .filter((t) => {
      if (t.length === 0 || seen.has(t)) return false;
      seen.add(t);
      return true;
    });
}

/**
 * 新建 / 编辑资产对话框：名称 + 内容（多行文本）+ 标签 + 文件上传（读取为文本）。
 */
export function AssetEditorDialog({
  open,
  kind,
  asset,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** 创建时从当前 tab 带入的 kind；编辑时忽略 */
  kind?: AssetKind;
  /** 编辑目标；为 null 表示新建 */
  asset: Asset | null;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');
  const [kindValue, setKindValue] = useState<AssetKind>('rule');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    if (asset) {
      setName(asset.name);
      setContent(asset.content);
      setTags(asset.tags.join(', '));
      setKindValue(asset.kind);
    } else {
      setName('');
      setContent('');
      setTags('');
      setKindValue(kind ?? 'rule');
    }
    setError(null);
    if (fileRef.current) fileRef.current.value = '';
  }, [open, asset, kind]);

  const onPickFile = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setContent(String(reader.result ?? ''));
      // 名称留空时用文件名（去扩展名）兜底
      setName((prev) => (prev.trim() ? prev : file.name.replace(/\.[^.]+$/, '')));
    };
    reader.onerror = () => setError(`读取文件失败：${file.name}`);
    reader.readAsText(file);
    e.target.value = '';
  };

  /** 二进制包上传：multipart 直传，后端存 base64 + contentType=file，不进入编辑框 */
  const onPickBinaryFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await assetsApi.createFile(kindValue, file);
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

  const submit = async (): Promise<void> => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('请填写资产名称');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const tagList = parseTags(tags);
      if (asset) {
        await assetsApi.update(asset.id, { name: trimmedName, content, tags: tagList });
      } else {
        await assetsApi.create({
          kind: kindValue,
          name: trimmedName,
          content,
          contentType: 'text',
          tags: tagList,
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle className="text-[#0F172A]">{asset ? '编辑资产' : '新建资产'}</DialogTitle>
      <DialogContent>
        <div className="mt-1 flex flex-col gap-3">
          <TextField
            label="类型"
            size="small"
            select
            value={kindValue}
            onChange={(e) => setKindValue(e.target.value as AssetKind)}
            disabled={!!asset}
            fullWidth
          >
            {KIND_OPTIONS.map((k) => (
              <MenuItem key={k.value} value={k.value}>
                {k.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="名称"
            size="small"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
          />
          <TextField
            label="内容"
            size="small"
            multiline
            minRows={10}
            maxRows={20}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            fullWidth
            placeholder="规则 / 资料 / skill 的文本内容"
          />
          <TextField
            label="标签（逗号分隔）"
            size="small"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            fullWidth
            placeholder="例如：安全, 默认, v1"
          />
          <div>
            <div className="mb-1 text-xs text-[#64748B]">
              上传文件（读取为文本填入内容框，可继续编辑；支持 .md/.txt/.json/.yaml/.yml/.js/.ts/.toml）
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".md,.txt,.json,.yaml,.yml,.js,.ts,.toml"
              onChange={onPickFile}
              className="text-sm"
            />
          </div>
          {!asset && (
            <div>
              <div className="mb-1 text-xs text-[#64748B]">
                上传二进制包（skills 包 / 压缩文件，直接上传不编辑；支持 .zip/.tar/.gz/.tgz/.whl/.py/.sh）
              </div>
              <input
                type="file"
                accept=".zip,.tar,.gz,.tgz,.whl,.py,.sh"
                onChange={onPickBinaryFile}
                disabled={busy}
                className="text-sm"
              />
            </div>
          )}
          {error && (
            <div className="rounded-md bg-[#FEE2E2] px-3 py-2 text-xs text-[#B91C1C]">{error}</div>
          )}
        </div>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit">
          取消
        </Button>
        <Button onClick={submit} disabled={busy} variant="contained">
          {busy ? '保存中…' : '保存'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
