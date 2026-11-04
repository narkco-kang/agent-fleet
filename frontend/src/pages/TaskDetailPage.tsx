import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useTaskStore } from '../store/taskStore';
import { StatusBadge } from '../components/common/StatusBadge';
import { MessageTimeline } from '../components/task/MessageTimeline';
import { http } from '../api/http';
import type { TaskEvent } from '@agentfleet/shared';

/**
 * 任务详情页（04 §6.2）：元信息 + 消息流时间线 + 操作。
 */
export default function TaskDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const task = useTaskStore((s) => s.tasks.find((t) => t.taskId === id));
  const events = useTaskStore((s) => (id ? s.events[id] : undefined)) ?? [];
  const setEvents = useTaskStore((s) => s.setEvents);

  useEffect(() => {
    if (!id) return;
    http
      .getTask(id)
      .then((res) => setEvents(id, res.data.messages as TaskEvent[]))
      .catch(() => {
        /* 后端离线时沿用 store/mock 数据 */
      });
  }, [id, setEvents]);

  if (!task) {
    return (
      <div className="p-6">
        <button onClick={() => navigate('/tasks')} className="mb-4 flex items-center gap-1 text-sm text-[#4F46E5]">
          <ArrowBackIcon fontSize="small" /> 返回
        </button>
        <div className="text-[var(--text-muted)]">任务不存在</div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <button onClick={() => navigate('/tasks')} className="mb-4 flex items-center gap-1 text-sm text-[#4F46E5]">
        <ArrowBackIcon fontSize="small" /> 返回任务列表
      </button>

      <div className="mb-1 flex items-center gap-3">
        <h1 className="text-xl font-semibold text-[var(--text-strong)]">{task.prompt?.slice(0, 50) ?? ''}</h1>
        <StatusBadge status={task.status} />
      </div>
      <div className="mb-4 text-xs text-[var(--text-muted)]">
        目标：{task.targetDeviceId ?? 'auto'} · {task.targetAgentType ?? 'auto'} · 发起：
        {task.origin === 'dashboard' ? '看板' : task.origin === 'wechat_work' ? '企业微信' : '个人微信'}
        {task.durationMs != null && ` · 耗时 ${fmtDuration(task.durationMs)}`}
      </div>

      <div className="mb-4 flex gap-2">
        {(task.status === 'running' || task.status === 'queued' || task.status === 'waiting' || task.status === 'blocked') && (
          <button
            onClick={() => void http.cancelTask(task.taskId)}
            className="rounded-lg border border-[#EF4444] px-3 py-1.5 text-sm text-[#EF4444] hover:bg-[var(--danger-soft)]"
          >
            取消任务
          </button>
        )}
        {(task.status === 'failed' || task.status === 'interrupted' || task.status === 'cancelled') && (
          <button
            onClick={() => void http.retryTask(task.taskId)}
            className="rounded-lg border border-[#0891B2] px-3 py-1.5 text-sm text-[#0891B2] hover:bg-[#ECFEFF]"
          >
            重试
          </button>
        )}
      </div>

      <div className="rounded-card border border-[var(--border)] bg-[var(--surface)] p-4">
        <MessageTimeline events={events} />
      </div>
    </div>
  );
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${s % 60}s`;
}
