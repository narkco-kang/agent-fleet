import type { ParsedCommand } from '@agentfleet/shared';

/**
 * LLM 兜底解析（接口预留）。
 * Q8 待确认：本期默认「规则优先（/命令）」，LLM 兜底接口就绪但未接入。
 */
export interface LlmParser {
  parse(content: string, origin: 'wechat_personal' | 'wechat_work'): Promise<ParsedCommand>;
}

export const llmParser: LlmParser = {
  async parse(content, origin) {
    // 未接入 LLM：退化为规则解析
    const { parseCommand } = await import('./commandParser.js');
    return parseCommand(content, origin);
  },
};
