import { describe, expect, it } from 'vitest';
import { collectFreeSourceRefs, isFreeSourceRef } from '../src/services/routing/freeSourceService.js';
import type { RoleRoute } from '@agentfleet/shared';

describe('freeSourceService 免费源收集', () => {
  it('识别 free/kilo-auto/free/中文免费 等免费源 ref', () => {
    expect(isFreeSourceRef('free-models/kilo-auto/free')).toBe(true);
    expect(isFreeSourceRef('provider/免费模型')).toBe(true);
    expect(isFreeSourceRef('kimi/k3')).toBe(false);
  });

  it('从 role_routes 的 primary/model/fallback 收集免费源并去重', () => {
    const routes: RoleRoute[] = [
      {
        role: 'free-tier',
        primary: 'free-models/kilo-auto/free',
        fallback: ['free-models/kilo-auto/free', 'free-models/backup/free'],
        capability: 'chat',
        bots: ['Free仔'],
        enabled: true,
      },
      {
        role: 'research',
        primary: 'kimi/k3',
        fallback: [],
        capability: 'chat',
        bots: [],
        enabled: true,
      },
    ];
    expect(collectFreeSourceRefs(routes)).toEqual(['free-models/kilo-auto/free', 'free-models/backup/free']);
  });
});
