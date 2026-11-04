import { describe, expect, it } from 'vitest';
import { toChange, toSemantic } from '../src/adapters/amg-mapper.js';
import type { MemoryChange } from '../src/types/block.js';

/**
 * docs/25 写入溯源（provenance 链）：change 携带源任务/会话/设备，检索可追溯。
 */

describe('写入溯源（provenance）', () => {
  it('toChange 透传 provenance', () => {
    const change = toChange({
      op: 'add-node',
      target: 'n1',
      by: 'coordinator',
      at: new Date().toISOString(),
      rev: 1,
      note: '',
      node: {
        id: 'n1',
        type: 'artifact',
        label: '登录接口',
        status: 'done',
        source: 'task',
        evidence: [],
      },
      provenance: { taskId: 'task-1', deviceId: 'dev-a', agentType: 'codex' },
    });

    expect(change.provenance).toEqual({ taskId: 'task-1', deviceId: 'dev-a', agentType: 'codex' });
  });

  it('toSemantic 反向透传 provenance', () => {
    const change: MemoryChange = {
      id: 'c1',
      op: 'set_status',
      target: 'task:task-1',
      by: 'coordinator',
      at: new Date().toISOString(),
      rev: 1,
      note: '完成',
      status: 'completed',
      provenance: { taskId: 'task-1', sessionId: 'sess-1' },
    };

    const op = toSemantic(change);
    expect(op.provenance).toEqual({ taskId: 'task-1', sessionId: 'sess-1' });
  });

  it('无 provenance 时字段缺省，不影响现有 change', () => {
    const change = toChange({
      op: 'set-status',
      target: 'task:1',
      by: 'coordinator',
      at: new Date().toISOString(),
      rev: 1,
      note: '',
      status: 'done',
    });
    expect(change.provenance).toBeUndefined();
  });
});
