import { describe, it, expect } from 'vitest';
import { extractStreamText, detectToolUse } from '../src/adapters/cliRunner.js';

/**
 * stream-json 解析（claude --output-format stream-json 真机格式）：
 * 修复「claude 的 assistant/result 事件把整个 JSON 当 status 输出」的展示缺陷。
 */
describe('cliRunner stream-json 解析', () => {
  it('claude assistant 事件：message.content text blocks → 提取文本', () => {
    const j = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'OK' }] },
    };
    expect(extractStreamText(j)).toBe('OK');
  });

  it('claude assistant 事件：多 text block 拼接', () => {
    const j = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'World' }] },
    };
    expect(extractStreamText(j)).toBe('Hello World');
  });

  it('claude result 事件：result 字段（最终纯文本）→ 提取文本（不再是 tool_call）', () => {
    const j = { type: 'result', subtype: 'success', result: 'OK', is_error: false };
    expect(extractStreamText(j)).toBe('OK');
  });

  it('顶层 text（codex 等）→ 提取文本', () => {
    const j = { type: 'event', text: 'hello' };
    expect(extractStreamText(j)).toBe('hello');
  });

  it('message 是字符串（status 类）→ 不提取文本', () => {
    const j = { type: 'system', message: '初始化中' };
    expect(extractStreamText(j)).toBe('');
  });

  it('tool_use block → detectToolUse 识别工具名与入参', () => {
    const j = {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Bash', input: { cmd: 'ls' } }] },
    };
    const tool = detectToolUse(j);
    expect(tool?.name).toBe('Bash');
    expect((tool?.input as { cmd: string }).cmd).toBe('ls');
  });

  it('assistant 纯文本事件 → detectToolUse 返回 null（不误判为工具）', () => {
    const j = { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } };
    expect(detectToolUse(j)).toBeNull();
  });
});
