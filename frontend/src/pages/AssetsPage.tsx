import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import AddIcon from '@mui/icons-material/Add';
import SendIcon from '@mui/icons-material/Send';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import UploadIcon from '@mui/icons-material/Upload';
import type { Asset, AssetKind, AssetSource } from '@agentfleet/shared';
import { assetsApi } from '../api/assets';
import { Card } from '../components/common/Card';
import { AssetEditorDialog } from '../components/assets/AssetEditorDialog';
import { DeliverDialog } from '../components/assets/DeliverDialog';
import { DeliveryRecords } from '../components/assets/DeliveryRecords';
import { GithubSkillsDialog } from '../components/assets/GithubSkillsDialog';
import { PromptCatalogDialog } from '../components/assets/PromptCatalogDialog';
import { useT, useLanguageStore } from '../i18n';

const KIND_KEY: Record<AssetKind, string> = {
  rule: 'assets.kind.rule',
  knowledge: 'assets.kind.knowledge',
  skill: 'assets.kind.skill',
  prompt: 'assets.kind.prompt',
};

const SOURCE_KEY: Record<AssetSource, string> = {
  manual: 'assets.source.manual',
  github: 'assets.source.github',
  imported: 'assets.source.imported',
};

type KindFilter = AssetKind | 'all';

function fmtTime(ts: number, language: 'zh' | 'en'): string {
  return new Date(ts).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US', { hour12: false });
}

/** 概述按语言取：中文优先 descriptionZh（缺省回退英文原文），英文直接 description */
function descOf(a: Asset, language: 'zh' | 'en'): string {
  return language === 'zh' ? a.descriptionZh || a.description : a.description;
}

/**
 * 资产管理页：规则 / 资料库 / skills 的 CRUD + 分发（人工确认）+ 分发记录。
 */
export default function AssetsPage(): JSX.Element {
  const t = useT();
  const language = useLanguageStore((s) => s.language);
  const [kind, setKind] = useState<KindFilter>('all');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [deliverFor, setDeliverFor] = useState<Asset | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [githubOpen, setGithubOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const batchFileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback((): void => {
    assetsApi
      .list(kind === 'all' ? undefined : kind)
      .then((r) => setAssets(r.data))
      .catch(() => setAssets([]));
  }, [kind]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const openCreate = (): void => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (a: Asset): void => {
    setEditing(a);
    setEditorOpen(true);
  };
  const openDeliver = (a: Asset | null): void => {
    setDeliverFor(a);
    setDeliverOpen(true);
  };

  /** 批量上传多文件（当前 tab 的 kind，all 时默认 skill） */
  const onBatchUpload = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    const targetKind: AssetKind = kind === 'all' ? 'skill' : kind;
    setUploading(true);
    try {
      const r = await assetsApi.batchUpload(targetKind, files);
      window.alert(`${t('assets.batchImported')} ${r.data.count} ${t('assets.batchImportedSuffix')}「${t(KIND_KEY[targetKind])}」`);
      refresh();
    } catch (err) {
      window.alert((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const onDelete = async (a: Asset): Promise<void> => {
    if (!window.confirm(`${t('assets.confirmDelete')}「${a.name}」？`)) return;
    try {
      await assetsApi.remove(a.id);
      refresh();
    } catch (err) {
      window.alert((err as Error).message);
    }
  };

  const tabs: Array<[KindFilter, string]> = [
    ['all', t('assets.all')],
    ['rule', t('assets.kind.rule')],
    ['knowledge', t('assets.kind.knowledge')],
    ['skill', t('assets.kind.skill')],
    ['prompt', t('assets.kind.prompt')],
  ];

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--text-strong)]">{t('assets.title')}</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setGithubOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-[#0891B2] bg-[var(--surface)] px-3 py-1.5 text-sm font-medium text-[#0891B2] hover:bg-[#ECFEFF]"
          >
            <CloudDownloadIcon fontSize="small" /> {t('assets.fetchGithub')}
          </button>
          <button
            onClick={() => setPromptOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-[#0891B2] bg-[var(--surface)] px-3 py-1.5 text-sm font-medium text-[#0891B2] hover:bg-[#ECFEFF]"
          >
            <CloudDownloadIcon fontSize="small" /> {t('assets.fetchPrompts')}
          </button>
          <button
            onClick={() => batchFileRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1 rounded-lg border border-[#4F46E5] bg-[var(--surface)] px-3 py-1.5 text-sm font-medium text-[#4F46E5] hover:bg-[var(--brand-soft)]"
          >
            <UploadIcon fontSize="small" /> {uploading ? t('assets.uploading') : t('assets.batchUpload')}
          </button>
          <input
            ref={batchFileRef}
            type="file"
            multiple
            onChange={(e) => void onBatchUpload(e)}
            className="hidden"
          />
          <button
            onClick={() => openDeliver(null)}
            className="inline-flex items-center gap-1 rounded-lg border border-[#4F46E5] bg-[var(--surface)] px-3 py-1.5 text-sm font-medium text-[#4F46E5] hover:bg-[var(--brand-soft)]"
          >
            <SendIcon fontSize="small" /> {t('assets.deliver')}
          </button>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1 rounded-lg bg-[#4F46E5] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#4338CA]"
          >
            <AddIcon fontSize="small" /> {t('assets.newAsset')}
          </button>
        </div>
      </div>

      <div className="mb-3 flex gap-2">
        {tabs.map(([v, label]) => (
          <button
            key={v}
            onClick={() => setKind(v)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              kind === v ? 'bg-[var(--brand-soft)] text-[#4F46E5]' : 'text-[var(--text)] hover:bg-[var(--bg-subtle)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <Card className="p-0">
        <div className="border-b border-[var(--border)] px-4 py-3 text-sm font-semibold text-[var(--text-strong)]">
          {t('assets.list')}（{assets.length}）
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-[var(--bg-subtle)] text-left text-xs text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">{t('assets.col.name')}</th>
                <th className="px-4 py-2 font-medium">{t('assets.col.overview')}</th>
                <th className="px-4 py-2 font-medium">{t('assets.col.kind')}</th>
                <th className="px-4 py-2 font-medium">{t('assets.col.source')}</th>
                <th className="px-4 py-2 font-medium">{t('assets.col.version')}</th>
                <th className="px-4 py-2 font-medium">{t('assets.col.tags')}</th>
                <th className="px-4 py-2 font-medium">{t('assets.col.updated')}</th>
                <th className="px-4 py-2 font-medium">{t('assets.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {assets.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    {t('assets.empty')}
                  </td>
                </tr>
              ) : (
                assets.map((a) => (
                  <tr
                    key={a.id}
                    className="border-t border-[var(--border)] transition-colors hover:bg-[var(--bg-subtle)]"
                    style={{ height: 48 }}
                  >
                    <td className="px-4 py-2 text-[var(--text)]">{a.name}</td>
                    <td className="max-w-[280px] truncate px-4 py-2 text-[var(--text-muted)]" title={descOf(a, language)}>
                      {descOf(a, language) || '—'}
                    </td>
                    <td className="px-4 py-2 text-[var(--text)]">{t(KIND_KEY[a.kind])}</td>
                    <td className="px-4 py-2 text-[var(--text)]">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] ${
                          a.source === 'github'
                            ? 'bg-[#ECFEFF] text-[#0891B2]'
                            : a.source === 'imported'
                              ? 'bg-[var(--warning-soft)] text-[#B45309]'
                              : 'bg-[var(--bg-subtle)] text-[var(--text-muted)]'
                        }`}
                      >
                        {t(SOURCE_KEY[a.source] ?? 'assets.source.manual')}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-[var(--text)]">v{a.version}</td>
                    <td className="px-4 py-2 text-[var(--text-muted)]">
                      {a.tags.length ? a.tags.map((t) => `#${t}`).join(' ') : '—'}
                    </td>
                    <td className="px-4 py-2 text-[var(--text-muted)]">{fmtTime(a.updatedAt, language)}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEdit(a)}
                          className="rounded px-2 py-1 text-xs text-[#4F46E5] hover:bg-[var(--brand-soft)]"
                        >
                          {t('assets.edit')}
                        </button>
                        <button
                          onClick={() => openDeliver(a)}
                          className="rounded px-2 py-1 text-xs text-[#0891B2] hover:bg-[#ECFEFF]"
                        >
                          {t('assets.deliver')}
                        </button>
                        <button
                          onClick={() => onDelete(a)}
                          className="rounded px-2 py-1 text-xs text-[#B91C1C] hover:bg-[var(--danger-soft)]"
                        >
                          {t('assets.delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-4">
        <DeliveryRecords refreshKey={refreshKey} />
      </div>

      <AssetEditorDialog
        open={editorOpen}
        kind={kind === 'all' ? undefined : kind}
        asset={editing}
        onClose={() => setEditorOpen(false)}
        onSaved={() => refresh()}
      />
      <DeliverDialog
        open={deliverOpen}
        initialAssetId={deliverFor?.id}
        onClose={() => setDeliverOpen(false)}
        onDelivered={() => {
          refresh();
          setRefreshKey((k) => k + 1);
        }}
      />
      <GithubSkillsDialog
        open={githubOpen}
        onClose={() => setGithubOpen(false)}
        onImported={() => refresh()}
      />
      <PromptCatalogDialog
        open={promptOpen}
        onClose={() => setPromptOpen(false)}
        onImported={() => refresh()}
      />
    </div>
  );
}
