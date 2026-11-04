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
import { assetsApi, type GithubSkillRepo, type RepoSkill } from '../../api/assets';
import { useT, useLanguageStore } from '../../i18n';

/** 数字格式化：295289 → 295.3k */
function fmtStars(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** 描述按语言取：中文优先 descriptionZh（缺省回退英文） */
function descOf(d: { description: string; descriptionZh: string }, language: 'zh' | 'en'): string {
  return language === 'zh' ? d.descriptionZh || d.description : d.description;
}

/**
 * GitHub Skills 抓取对话框：实时搜索最多星 skills 仓库 → 多选 → 批量导入为 skill 资产。
 * 支持展开仓库查看其内部具体子 skill（解析 SKILL.md），单独勾选导入。
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
  const t = useT();
  const language = useLanguageStore((s) => s.language);
  const [query, setQuery] = useState('');
  const [repos, setRepos] = useState<GithubSkillRepo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ created: Asset[]; skipped: string[] } | null>(null);

  // 子 skill 展开
  const [expandedRepo, setExpandedRepo] = useState<string | null>(null);
  const [repoSkills, setRepoSkills] = useState<RepoSkill[]>([]);
  const [selectedSub, setSelectedSub] = useState<Set<string>>(new Set());
  const [loadingSub, setLoadingSub] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRepos([]);
    setSelected(new Set());
    setError(null);
    setImportResult(null);
    setQuery('');
    setExpandedRepo(null);
    setRepoSkills([]);
    setSelectedSub(new Set());
    // 打开即拉一次默认结果（热门 skills 关键词）
    void search('');
  }, [open]);

  const search = async (q: string): Promise<void> => {
    setLoading(true);
    setError(null);
    setImportResult(null);
    setSelected(new Set());
    setExpandedRepo(null);
    setRepoSkills([]);
    setSelectedSub(new Set());
    try {
      const r = await assetsApi.searchGithubSkills(q.trim() || undefined, 30);
      setRepos(r.data);
      if (r.data.length === 0) setError(t('github.noMatch'));
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

  const toggleRepo = async (fullName: string): Promise<void> => {
    if (expandedRepo === fullName) {
      setExpandedRepo(null);
      setRepoSkills([]);
      setSelectedSub(new Set());
      return;
    }
    setExpandedRepo(fullName);
    setLoadingSub(true);
    setRepoSkills([]);
    setSelectedSub(new Set());
    try {
      const [owner, repo] = fullName.split('/');
      const r = await assetsApi.listRepoSkills(owner, repo);
      setRepoSkills(r.data);
    } catch (err) {
      setError((err as Error).message);
      setRepoSkills([]);
    } finally {
      setLoadingSub(false);
    }
  };

  const toggleSub = (path: string): void => {
    setSelectedSub((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const selectAll = (): void => setSelected(new Set(repos.map((r) => r.fullName)));
  const clearAll = (): void => setSelected(new Set());

  const importSelected = async (): Promise<void> => {
    if (selected.size === 0 && selectedSub.size === 0) return;
    setBusy(true);
    setError(null);
    setImportResult(null);
    try {
      let created: Asset[] = [];
      let skipped: string[] = [];
      // 1. 导入整库
      if (selected.size > 0) {
        const picked = repos.filter((r) => selected.has(r.fullName));
        const r = await assetsApi.importGithubSkills(
          picked.map((p) => ({ fullName: p.fullName, description: p.description, url: p.url, topics: p.topics })),
        );
        created = created.concat(r.data.created);
        skipped = skipped.concat(r.data.skipped);
      }
      // 2. 导入展开仓库的勾选子 skill
      if (selectedSub.size > 0 && expandedRepo) {
        const [owner, repo] = expandedRepo.split('/');
        const pickedSub = repoSkills.filter((s) => selectedSub.has(s.path));
        const r = await assetsApi.importRepoSkills(
          owner,
          repo,
          pickedSub.map((s) => ({ name: s.name, description: s.description, path: s.path })),
        );
        created = created.concat(r.data.created);
        skipped = skipped.concat(r.data.skipped);
      }
      setImportResult({ created, skipped });
      setSelected(new Set());
      setSelectedSub(new Set());
      onImported();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle className="text-[var(--text-strong)]">{t('github.title')}</DialogTitle>
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
              placeholder={t('github.searchPlaceholder')}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
            <Button variant="contained" onClick={() => void search(query)} disabled={loading}>
              {loading ? t('github.searching') : t('github.search')}
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)]">
              {t('github.selected')} {selected.size + selectedSub.size} / {repos.length} {t('github.repos')}
            </span>
            <div className="flex gap-2">
              <button type="button" onClick={selectAll} className="text-xs text-[#4F46E5] hover:underline">
                {t('deliver.selectAll')}
              </button>
              <button type="button" onClick={clearAll} className="text-xs text-[#4F46E5] hover:underline">
                {t('deliver.clear')}
              </button>
            </div>
          </div>

          <div className="max-h-80 overflow-auto rounded-md border border-[var(--border)]">
            {loading ? (
              <div className="px-3 py-8 text-center text-sm text-[var(--text-muted)]">{t('github.fetching')}</div>
            ) : repos.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-[var(--text-muted)]">{t('github.noResult')}</div>
            ) : (
              repos.map((r) => {
                const checked = selected.has(r.fullName);
                const expanded = expandedRepo === r.fullName;
                return (
                  <div key={r.fullName} className="border-b border-[var(--border)] last:border-b-0">
                    <label
                      className={`flex cursor-pointer items-start gap-2 px-2 py-2 ${checked ? 'bg-[var(--brand-soft)]' : 'bg-[var(--surface)]'}`}
                    >
                      <Checkbox
                        size="small"
                        checked={checked}
                        onChange={() => toggle(r.fullName)}
                        sx={{ padding: '2px' }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-[var(--text-strong)]">{r.fullName}</span>
                          {r.language && (
                            <span className="shrink-0 rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                              {r.language}
                            </span>
                          )}
                        </div>
                        {r.description && (
                          <div className="mt-0.5 line-clamp-2 text-xs text-[var(--text-muted)]">{descOf(r, language)}</div>
                        )}
                        <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                          ★ {fmtStars(r.stars)}
                          {r.topics.length > 0 && ` · ${r.topics.slice(0, 4).map((t) => `#${t}`).join(' ')}`}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          void toggleRepo(r.fullName);
                        }}
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-[#4F46E5] hover:bg-[var(--brand-soft)]"
                      >
                        {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                      </button>
                    </label>

                    {expanded && (
                      <div className="border-t border-[var(--border)] bg-[var(--bg-subtle)] px-2 py-1">
                        {loadingSub ? (
                          <div className="px-2 py-2 text-xs text-[var(--text-muted)]">{t('github.fetching')}</div>
                        ) : repoSkills.length === 0 ? (
                          <div className="px-2 py-2 text-xs text-[var(--text-muted)]">{t('github.noResult')}</div>
                        ) : (
                          repoSkills.map((s) => {
                            const subChecked = selectedSub.has(s.path);
                            return (
                              <label
                                key={s.path}
                                className={`flex cursor-pointer items-start gap-2 rounded px-1 py-1 ${subChecked ? 'bg-[var(--brand-soft)]' : ''}`}
                              >
                                <Checkbox
                                  size="small"
                                  checked={subChecked}
                                  onChange={() => toggleSub(s.path)}
                                  sx={{ padding: '2px' }}
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs font-medium text-[var(--text-strong)]">{s.name}</div>
                                  {s.description && (
                                    <div className="line-clamp-1 text-[11px] text-[var(--text-muted)]">{descOf(s, language)}</div>
                                  )}
                                </div>
                                <span className="shrink-0 text-[10px] text-[var(--text-muted)]">{s.path}</span>
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
            <div className="rounded-md border border-[#D1FAE5] bg-[var(--success-soft)] px-3 py-2 text-xs text-[#047857]">
              {t('github.importDone')} {importResult.created.length} {t('assets.kind.skill')}
              {importResult.skipped.length > 0 && `${t('github.importDoneSkipped')} ${importResult.skipped.length} ${t('assets.batchImportedSuffix')}`}
            </div>
          )}

          {error && (
            <div className="rounded-md bg-[var(--danger-soft)] px-3 py-2 text-xs text-[#B91C1C]">{error}</div>
          )}
        </div>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit">
          {t('deliver.close')}
        </Button>
        <Button
          onClick={() => void importSelected()}
          disabled={busy || (selected.size === 0 && selectedSub.size === 0)}
          variant="contained"
        >
          {busy ? t('github.importing') : `${t('github.importSelected')}（${selected.size + selectedSub.size}）`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
