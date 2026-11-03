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
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import type { Asset } from '@agentfleet/shared';
import { assetsApi, type GithubPromptRepo, type RepoPrompt } from '../../api/assets';
import { useT } from '../../i18n';

/** 数字格式化：295289 → 295.3k */
function fmtStars(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * 提示词库抓取对话框：实时搜索最多星提示词仓库 → 展开仓库查看具体提示词 →
 * 勾选 → 批量导入为 prompt 资产（含中英文注释）。
 */
export function PromptCatalogDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}): JSX.Element {
  const t = useT();
  const [query, setQuery] = useState('');
  const [repos, setRepos] = useState<GithubPromptRepo[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ created: Asset[]; skipped: string[] } | null>(null);

  // 展开仓库 → 提示词条目
  const [expandedRepo, setExpandedRepo] = useState<string | null>(null);
  const [repoPrompts, setRepoPrompts] = useState<RepoPrompt[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingPrompts, setLoadingPrompts] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRepos([]);
    setError(null);
    setImportResult(null);
    setQuery('');
    setExpandedRepo(null);
    setRepoPrompts([]);
    setSelected(new Set());
    void search('');
  }, [open]);

  const search = async (q: string): Promise<void> => {
    setLoading(true);
    setError(null);
    setImportResult(null);
    setExpandedRepo(null);
    setRepoPrompts([]);
    setSelected(new Set());
    try {
      const r = await assetsApi.searchGithubPrompts(q.trim() || undefined, 30);
      setRepos(r.data);
      if (r.data.length === 0) setError(t('github.noMatch'));
    } catch (err) {
      setError((err as Error).message);
      setRepos([]);
    } finally {
      setLoading(false);
    }
  };

  const toggleRepo = async (fullName: string): Promise<void> => {
    if (expandedRepo === fullName) {
      setExpandedRepo(null);
      setRepoPrompts([]);
      setSelected(new Set());
      return;
    }
    setExpandedRepo(fullName);
    setLoadingPrompts(true);
    setRepoPrompts([]);
    setSelected(new Set());
    try {
      const [owner, repo] = fullName.split('/');
      const r = await assetsApi.listRepoPrompts(owner, repo);
      setRepoPrompts(r.data);
    } catch (err) {
      setError((err as Error).message);
      setRepoPrompts([]);
    } finally {
      setLoadingPrompts(false);
    }
  };

  const toggle = (name: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const selectAll = (): void => setSelected(new Set(repoPrompts.map((p) => p.name)));
  const clearAll = (): void => setSelected(new Set());

  const importSelected = async (): Promise<void> => {
    if (selected.size === 0 || !expandedRepo) return;
    setBusy(true);
    setError(null);
    setImportResult(null);
    try {
      const [owner, repo] = expandedRepo.split('/');
      const picked = repoPrompts.filter((p) => selected.has(p.name));
      const r = await assetsApi.importRepoPrompts(
        owner,
        repo,
        picked.map((p) => ({ name: p.name, content: p.content })),
      );
      setImportResult(r.data);
      setSelected(new Set());
      onImported();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle className="text-[#0F172A]">提示词库 · GitHub 抓取</DialogTitle>
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
              placeholder="搜索提示词仓库（如 chatgpt prompts / claude prompts）"
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
              {expandedRepo ? `已选 ${selected.size} / ${repoPrompts.length} 条提示词` : `${repos.length} 个仓库 · 点击展开查看提示词`}
            </span>
            {expandedRepo && (
              <div className="flex gap-2">
                <button type="button" onClick={selectAll} className="text-xs text-[#4F46E5] hover:underline">
                  {t('deliver.selectAll')}
                </button>
                <button type="button" onClick={clearAll} className="text-xs text-[#4F46E5] hover:underline">
                  {t('deliver.clear')}
                </button>
              </div>
            )}
          </div>

          <div className="max-h-96 overflow-auto rounded-md border border-[#E2E8F0]">
            {loading ? (
              <div className="px-3 py-8 text-center text-sm text-[#94A3B8]">{t('github.fetching')}</div>
            ) : repos.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-[#94A3B8]">{t('github.noResult')}</div>
            ) : (
              repos.map((r) => {
                const expanded = expandedRepo === r.fullName;
                return (
                  <div key={r.fullName} className="border-b border-[#E2E8F0] last:border-b-0">
                    <label className="flex cursor-pointer items-start gap-2 px-2 py-2 hover:bg-[#F8FAFC]">
                      <div className="min-w-0 flex-1" onClick={() => void toggleRepo(r.fullName)}>
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-[#0F172A]">{r.fullName}</span>
                          <span className="shrink-0 rounded bg-[#F1F5F9] px-1.5 py-0.5 text-[10px] text-[#94A3B8]">
                            ★ {fmtStars(r.stars)}
                          </span>
                        </div>
                        {r.description && (
                          <div className="mt-0.5 line-clamp-2 text-xs text-[#64748B]">{r.description}</div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => void toggleRepo(r.fullName)}
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-[#4F46E5] hover:bg-[#EEF2FF]"
                      >
                        {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                      </button>
                    </label>

                    {expanded && (
                      <div className="border-t border-[#E2E8F0] bg-[#F8FAFC] px-2 py-1">
                        {loadingPrompts ? (
                          <div className="px-2 py-2 text-xs text-[#94A3B8]">{t('github.fetching')}</div>
                        ) : repoPrompts.length === 0 ? (
                          <div className="px-2 py-2 text-xs text-[#94A3B8]">{t('github.noResult')}</div>
                        ) : (
                          repoPrompts.map((p) => {
                            const checked = selected.has(p.name);
                            return (
                              <label
                                key={p.name}
                                className={`flex cursor-pointer items-start gap-2 rounded px-1 py-1.5 ${checked ? 'bg-[#EEF2FF]' : ''}`}
                              >
                                <Checkbox
                                  size="small"
                                  checked={checked}
                                  onChange={() => toggle(p.name)}
                                  sx={{ padding: '2px' }}
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs font-medium text-[#0F172A]">{p.name}</div>
                                  <div className="line-clamp-2 text-[11px] text-[#64748B]">{p.content}</div>
                                </div>
                              </label>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {importResult && (
            <div className="rounded-md border border-[#D1FAE5] bg-[#ECFDF5] px-3 py-2 text-xs text-[#047857]">
              {t('github.importDone')} {importResult.created.length} 条提示词
              {importResult.skipped.length > 0 && `，跳过 ${importResult.skipped.length} 条（已存在）`}
            </div>
          )}

          {error && <div className="rounded-md bg-[#FEE2E2] px-3 py-2 text-xs text-[#B91C1C]">{error}</div>}
        </div>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit">
          {t('deliver.close')}
        </Button>
        <Button
          onClick={() => void importSelected()}
          disabled={busy || selected.size === 0}
          variant="contained"
        >
          {busy ? t('github.importing') : `导入提示词（${selected.size}）`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
