import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTaskStore } from '../../store/taskStore';
import { DataTable, type Column } from '../common/DataTable';
import { StatusBadge } from '../common/StatusBadge';
import { AgentIcon } from '../common/AgentIcon';
import { http } from '../../api/http';
import type { TaskSnapshot } from '@agentfleet/shared';

/**
 * 任务列表（04 §C）：状态徽标 + 筛选 + 操作（详情/取消/重试）。
 */
export function TaskTable(): JSX.Element {
  const tasks = useTaskStore((s) => s.tasks);
  const navigate = useNavigate();
  const [filter, setFilter] = useState<string>('all');

  const filtered = filter === 'all' ? tasks : tasks.filter((t) => t.status === filter);

  const columns: Column<TaskSnapshot>[] = [
    {
      key: 'prompt',
      header: '任务',
      render: (t) => <span className="max-w-[260px] truncate font-medium text-[#0F172A]">{t.prompt}</span>,
    },
    { key: 'status', header: '状态', render: (t) => <StatusBadge status={t.status} /> },
    {
      key: 'target',
      header: '目标',
      render: (t) =>
        t.targetAgentType ? (
          <span className="flex items-center gap-1.5">
            <AgentIcon agentType={t.targetAgentType} size={20} />
            <span className="text-xs">{t.targetDeviceId?.slice(0, 10) ?? 'auto'}</span>
          </span>
        ) : (
          <span className="text-xs text-[#94A3B8]">auto</span>
        ),
    },
    {
      key: 'origin',
      header: '发起',
      render: (t) => (
        <span className="text-xs">{t.origin === 'dashboard' ? '看板' : t.origin === 'wechat_work' ? '企业微信' : '个人微信'}</span>
      ),
    },
    {
      key: 'duration',
      header: '耗时',
      render: (t) => <span className="text-xs">{t.durationMs != null ? fmtDuration(t.durationMs) : '—'}</span>,
    },
    {
      key: 'actions',
      header: '操作',
      render: (t) => (
        <div className="flex gap-1">
          <button className="text-xs text-[#4F46E5] hover:underline" onClick={() => navigate(`/tasks/${t.taskId}`)}>
            详情
          </button>
          {(t.status === 'running' || t.status === 'queued') && (
            <button
              className="text-xs text-[#EF4444] hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                void http.cancelTask(t.taskId);
              }}
            >
              取消
            </button>
          )}
          {(t.status === 'failed' || t.status === 'interrupted' || t.status === 'cancelled') && (
            <button
              className="text-xs text-[#0891B2] hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                void http.retryTask(t.taskId);
              }}
            >
              重试
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-3 flex gap-2">
        {['all', 'queued', 'running', 'completed', 'failed', 'interrupted'].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded-full px-3 py-1 text-xs ${
              filter === s ? 'bg-[#EEF2FF] text-[#4F46E5]' : 'bg-[#F1F5F9] text-[#475569]'
            }`}
          >
            {s === 'all' ? '全部' : s}
          </button>
        ))}
      </div>
      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(t) => t.taskId}
        onRowClick={(t) => navigate(`/tasks/${t.taskId}`)}
      />
    </div>
  );
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${s % 60}s`;
}
