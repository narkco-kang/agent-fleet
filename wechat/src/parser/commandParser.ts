import type { AgentType, Origin, ParsedCommand } from '@agentfleet/shared';

/**
 * 规则解析：/status、/cancel #id、/help、裸文本（转任务）。
 */
export function parseCommand(content: string, origin: Origin = 'wechat_work'): ParsedCommand {
  const trimmed = content.trim();

  if (trimmed === '/status' || trimmed.startsWith('/status')) {
    return { kind: 'status', origin };
  }
  if (trimmed === '/help' || trimmed.startsWith('/help')) {
    return { kind: 'help', origin };
  }
  const cancelMatch = trimmed.match(/^\/cancel\s+#?(\S+)/i);
  if (cancelMatch) {
    return { kind: 'cancel', taskId: cancelMatch[1], origin };
  }

  // 裸文本 → 任务（可选 agent 前缀：@grok / @codex）
  const agentMatch = trimmed.match(/^@(grok|codex|claude|dsh)\s+(.+)$/i);
  if (agentMatch) {
    return {
      kind: 'task',
      prompt: agentMatch[2],
      target: { mode: 'agent', agentType: agentMatch[1].toLowerCase() as AgentType },
      origin,
    };
  }

  return { kind: 'task', prompt: trimmed, target: { mode: 'auto' }, origin };
}
