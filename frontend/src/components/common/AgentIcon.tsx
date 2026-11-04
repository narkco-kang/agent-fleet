import type { ReactNode } from 'react';
import type { AgentType } from '@agentfleet/shared';

/**
 * 平台图标元信息（首字母/简称 + 品牌色）。
 */
const AGENT_META: Record<AgentType, { label: string; bg: string; fg: string }> = {
  codex: { label: 'C', bg: '#0F172A', fg: '#FFFFFF' },
  claude: { label: 'Cℓ', bg: '#7C3AED', fg: '#FFFFFF' },
  dsh: { label: 'D', bg: '#0891B2', fg: '#FFFFFF' },
  grok: { label: 'GB', bg: '#F8FAFC', fg: '#0F172A' },
  cursor: { label: 'Cu', bg: '#000000', fg: '#FFFFFF' },
  aider: { label: 'A', bg: '#16A085', fg: '#FFFFFF' },
  gemini: { label: 'Ge', bg: '#4285F4', fg: '#FFFFFF' },
  cody: { label: 'Co', bg: '#0F172A', fg: '#FFFFFF' },
  qwen: { label: 'Q', bg: '#615CED', fg: '#FFFFFF' },
  doubao: { label: '豆', bg: '#3370FF', fg: '#FFFFFF' },
  kimi: { label: 'K', bg: '#111827', fg: '#FFFFFF' },
  opencode: { label: 'Op', bg: '#334155', fg: '#FFFFFF' },
  windsurf: { label: 'W', bg: '#2563EB', fg: '#FFFFFF' },
  workbuddy: { label: 'WB', bg: '#2563EB', fg: '#FFFFFF' },
};

export function AgentIcon({ agentType, size = 24 }: { agentType: AgentType; size?: number }): ReactNode {
  const meta = AGENT_META[agentType] ?? { label: '?', bg: '#94A3B8', fg: '#fff' };
  return (
    <span
      className="inline-flex items-center justify-center rounded-md font-semibold"
      style={{
        width: size,
        height: size,
        background: meta.bg,
        color: meta.fg,
        fontSize: meta.label.length > 1 ? size * 0.4 : size * 0.5,
        border: agentType === 'grok' ? '1px solid #E2E8F0' : 'none',
      }}
      title={agentType}
    >
      {meta.label}
    </span>
  );
}
