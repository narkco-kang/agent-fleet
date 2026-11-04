import { describe, expect, it } from 'vitest';
import { parseProvider } from '../src/services/routing/freeSourceCrawler.js';

/**
 * 免费源抓取：parseProvider 解析 registry.json 单条 provider。
 */

describe('免费源抓取（parseProvider）', () => {
  it('解析合法 provider（含 format/category/models）', () => {
    const p = parseProvider({
      id: 'kilo',
      name: 'Kilo.ai',
      category: 'free-tier',
      format: 'openai-chat',
      baseUrl: 'https://api.kilo.ai/api/gateway/v1',
      models: [
        { id: 'kilo-auto/free', name: 'Auto Free' },
        { id: 'nvidia/nemotron', name: null },
      ],
      notes: 'free pool',
      website: 'https://kilo.ai',
    });
    expect(p).not.toBeNull();
    expect(p!.sourceId).toBe('kilo');
    expect(p!.category).toBe('free-tier');
    expect(p!.format).toBe('openai-chat');
    expect(p!.models).toEqual([{ id: 'kilo-auto/free', name: 'Auto Free' }, { id: 'nvidia/nemotron', name: undefined }]);
  });

  it('拒绝非法 provider（缺 id/baseUrl/format）', () => {
    expect(parseProvider({ name: 'x', baseUrl: 'http://a/v1', format: 'openai-chat' })).toBeNull();
    expect(parseProvider({ id: 'x', name: 'x', format: 'openai-chat' })).toBeNull();
    expect(parseProvider({ id: 'x', name: 'x', baseUrl: 'http://a/v1' })).toBeNull();
  });

  it('解析 anthropic-messages 协议源', () => {
    const p = parseProvider({
      id: 'glm',
      name: 'GLM',
      category: 'apikey',
      format: 'anthropic-messages',
      baseUrl: 'https://api.z.ai/api/anthropic/v1',
      models: [{ id: 'glm-5', name: 'GLM 5' }],
    });
    expect(p!.format).toBe('anthropic-messages');
  });
});
