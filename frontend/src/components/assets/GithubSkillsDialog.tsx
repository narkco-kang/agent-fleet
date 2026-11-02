import { useEffect, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import SearchIcon from '@mui/icons-material/Search';
import type { Asset } from '@agentfleet/shared';
import { assetsApi, type GithubSkillRepo } from '../../api/assets';

/** 数字格式化：295289 → 295.3k */
function fmtStars(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * GitHub Skills 抓取对话框：实时搜索最多星 skills 仓库 → 多选 → 批量导入为 skill 资产。
 */
export function GithubSkillsDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [repos, setRepos] = useState<GithubSkillRepo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ created: Asset[]; skipped: string[] } | null>(null);

  useEffect(() => {
    if (!open) return;
    setRepos([]);
    setSelected(new Set());
    setError(null);
    setImportResult(null);
    setQuery('');
    // 打开即拉一次默认结果（热门 skills 关键词）
    void search('');
  }, [open]);

  const search = async (q: string): Promise<void> => {
    setLoading(true);
    setError(null);
    setImportResult(null);
    setSelected(new Set());
    try {
      const r = await assetsApi.searchGithubSkills(q.trim() || undefined, 30);
      setRepos(r.data);
      if (r.data.length === 0) setError('未找到匹配的 skills 仓库，换个关键词试试');
    } catch (err) {
      setError((err as Error).message);
      setRepos([]);
    } finally {
      setLoading(false);
    }
  };

  const toggle = (fullName: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fullName)) next.delete(fullName);
      else next.add(fullName);
      return next;
    });
  };

  const selectAll = (): void => setSelected(new Set(repos.map((r) => r.fullName)));
  const clearAll = (): void => setSelected(new Set());

  const importSelected = async (): Promise<void> => {
    if (selected.size === 0) return;
    setBusy(true);
    setError(null);
    setImportResult(null);
    try {
      const picked = repos.filter((r) => selected.has(r.fullName));
      const r = await assetsApi.importGithubSkills(
        picked.map((p) => ({
          fullName: p.fullName,
          description: p.description,
          url: p.url,
          topics: p.topics,
        })),
      );
      setImportResult(r.data);
      onImported();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle className="text-[#0F172A]">从 GitHub 抓取 Skills</DialogTitle>
      <DialogContent>
        <div className="mt-1 flex flex-col gap-3">
          <div className="flex gap-2">
            <TextField
              size="small"
              fullWidth
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void search(query);
              }}
              placeholder="搜索关键词，例如：claude skills / agent skills"
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
            <Button variant="contained" onClick={() => void search(query)} disabled={loading}>
              {loading ? '搜索中…' : '搜索'}
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-[#64748B]">
              已选 {selected.size} / {repos.length} 个仓库（按 star 数排序）
            </span>
            <div className="flex gap-2">
              <button type="button" onClick={selectAll} className="text-xs text-[#4F46E5] hover:underline">
                全选
              </button>
              <button type="button" onClick={clearAll} className="text-xs text-[#4F46E5] hover:underline">
                清空
              </button>
            </div>
          </div>

          <div className="max-h-80 overflow-auto rounded-md border border-[#E2E8F0]">
            {loading ? (
              <div className="px-3 py-8 text-center text-sm text-[#94A3B8]">抓取 GitHub 中…</div>
            ) : repos.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-[#94A3B8]">
                暂无结果，点击「搜索」获取 GitHub 最多星 skills 仓库
              </div>
            ) : (
              repos.map((r) => {
                const checked = selected.has(r.fullName);
                return (
                  <label
                    key={r.fullName}
                    className={`flex cursor-pointer items-start gap-2 border-b border-[#E2E8F0] px-2 py-2 last:border-b-0 ${
                      checked ? 'bg-[#EEF2FF]' : 'bg-white'
                    }`}
                  >
                    <Checkbox
                      size="small"
                      checked={checked}
                      onChange={() => toggle(r.fullName)}
                      sx={{ padding: '2px' }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-[#0F172A]">{r.fullName}</span>
                        {r.language && (
                          <span className="shrink-0 rounded bg-[#F1F5F9] px-1.5 py-0.5 text-[10px] text-[#64748B]">
                            {r.language}
                          </span>
                        )}
                      </div>
                      {r.description && (
                        <div className="mt-0.5 line-clamp-2 text-xs text-[#64748B]">{r.description}</div>
                      )}
                      <div className="mt-0.5 text-[11px] text-[#94A3B8]">
                        ★ {fmtStars(r.stars)}
                        {r.topics.length > 0 && ` · ${r.topics.slice(0, 4).map((t) => `#${t}`).join(' ')}`}
                      </div>
                    </div>
                  </label>
                );
              })
            )}
          </div>

          {importResult && (
            <div className="rounded-md border border-[#D1FAE5] bg-[#ECFDF5] px-3 py-2 text-xs text-[#047857]">
              导入完成：新增 {importResult.created.length} 个 skill
              {importResult.skipped.length > 0 && `，跳过已存在 ${importResult.skipped.length} 个`}
            </div>
          )}

          {error && (
            <div className="rounded-md bg-[#FEE2E2] px-3 py-2 text-xs text-[#B91C1C]">{error}</div>
          )}
        </div>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit">
          关闭
        </Button>
        <Button onClick={() => void importSelected()} disabled={busy || selected.size === 0} variant="contained">
          {busy ? '导入中…' : `导入选中（${selected.size}）`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
