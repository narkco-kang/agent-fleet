import { useEffect, useRef } from 'react';
import type { TaskEvent } from '@agentmesh/shared';

/**
 * 消息流时间线（04 §6.2）：四类气泡（用户/agent/工具调用/系统事件），流式滚动。
 */
export function MessageTimeline({ events }: { events: TaskEvent[] }): JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  if (events.length === 0) {
    return <div className="py-12 text-center text-[#94A3B8]">暂无消息流</div>;
  }

  return (
    <div className="space-y-3">
      {events.map((e) => (
        <Bubble key={`${e.taskId}-${e.seq}`} event={e} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

function Bubble({ event }: { event: TaskEvent }): JSX.Element {
  const isUser = event.eventType === 'system' && event.data?.message?.startsWith('用户');
  const isTool = event.eventType === 'tool_call' || event.eventType === 'tool_result';
  const isAgent = event.eventType === 'text' || event.eventType === 'thinking';
  const isSystem = event.eventType === 'system' || event.eventType === 'status';

  const align = isUser ? 'justify-end' : 'justify-start';
  const bg = isUser ? '#EEF2FF' : isTool ? '#ECFEFF' : isAgent ? '#FFFFFF' : '#F8FAFC';
  const border = isUser ? '#C7D2FE' : isTool ? '#A5F3FC' : isAgent ? '#E2E8F0' : '#E2E8F0';

  const icon = isUser ? '👤' : isTool ? '🔧' : isAgent ? '🤖' : 'ℹ️';

  return (
    <div className={`flex ${align}`}>
      <div
        className="max-w-[80%] rounded-lg border px-3 py-2 text-sm"
        style={{ background: bg, borderColor: border }}
      >
        <div className="mb-1 flex items-center gap-1.5 text-xs text-[#64748B]">
          <span>{icon}</span>
          <span>{bubbleTitle(event)}</span>
          <span>{new Date(event.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div className="whitespace-pre-wrap break-words text-[#334155]">{bubbleText(event)}</div>
      </div>
    </div>
  );
}

function bubbleTitle(event: TaskEvent): string {
  switch (event.eventType) {
    case 'tool_call':
      return `工具调用 · ${event.data?.toolName ?? ''}`;
    case 'tool_result':
      return '工具返回';
    case 'thinking':
      return '思考';
    case 'text':
      return 'agent';
    case 'status':
      return '状态';
    default:
      return '系统';
  }
}

function bubbleText(event: TaskEvent): string {
  const d = event.data ?? {};
  if (event.eventType === 'tool_call') return `${d.toolName ?? ''} ${JSON.stringify(d.toolInput ?? {})}`;
  if (event.eventType === 'tool_result') return String(d.toolOutput ?? '');
  return String(d.text ?? d.delta ?? d.message ?? '');
}
