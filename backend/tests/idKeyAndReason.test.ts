import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  canonical,
  key,
  parseReason,
  reasonJson,
  reasonOf,
  reasonText,
  said,
  sha256Hex,
} from '@agentfleet/shared';

/**
 * DSH 架构融合：内容派生幂等 ID + 结构化原因码（docs/29）。
 * 纯函数，不依赖 DB / 网络。
 */
describe('内容派生幂等 ID（key / canonical / sha256Hex）', () => {
  it('纯 JS SHA-256 与 node:crypto 结果完全一致（含空串/中文/emoji/跨块）', () => {
    const cases = [
      '',
      'abc',
      'hello world',
      '多设备智能体舰队 🚀',
      'x'.repeat(55),
      'x'.repeat(56),
      'x'.repeat(64),
      'x'.repeat(1000),
    ];
    for (const s of cases) {
      expect(sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
    }
    // 已知标准向量
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('canonical 对象键排序，等价输入得到相同序列化', () => {
    expect(canonical({ b: 2, a: 1 })).toBe(canonical({ a: 1, b: 2 }));
    expect(canonical({ a: undefined })).toBe(canonical({ a: null }));
    expect(canonical({ a: Number.NaN })).toBe('{"a":null}');
    expect(canonical([1, 'x', true])).toBe('[1,"x",true]');
  });

  it('key 相等输入必得相等 32 位 ID；命名空间/参数不同则不同', () => {
    const a = key('action', 'deploy', { ref: 'b1' });
    const b = key('action', 'deploy', { ref: 'b1' });
    expect(a).toBe(b);
    expect(a).toHaveLength(32);
    expect(/^[0-9a-f]{32}$/.test(a)).toBe(true);
    expect(key('effect', 'deploy', { ref: 'b1' })).not.toBe(a);
    expect(key('action', 'uninstall', { ref: 'b1' })).not.toBe(a);
    expect(key('action', 'deploy', { ref: 'b2' })).not.toBe(a);
  });
});

describe('结构化原因码（Reason）', () => {
  it('模板渲染 + 未提供的占位符原样保留（不丢信息）', () => {
    expect(reasonText(reasonOf('effectFailed', { attempts: 2, detail: 'SSH timeout' }))).toContain(
      '第 2 次',
    );
    expect(reasonText(reasonOf('effectFailed', { attempts: 2 }))).toContain('{detail}');
  });

  it('taskId 会附加追溯后缀，便于按 code 聚合而不丢上下文', () => {
    const text = reasonText(reasonOf('deviceOffline', { deviceId: 'dev-1' }, { taskId: 't-9' }));
    expect(text).toContain('[task=t-9]');
  });

  it('JSON 往返 + 历史自由文本兼容降级为 said()', () => {
    const r = reasonOf('revalidateDenied', { kind: 'deploy' });
    expect(parseReason(reasonJson(r))).toEqual(r);
    expect(parseReason('旧的中文错误说明')).toEqual(said('旧的中文错误说明'));
    expect(parseReason(null).code).toBe('said');
    expect(parseReason('{"broken"')).toEqual(said('{"broken"'));
  });

  it('未知私有 code 直接返回 code，可判定、可扩展', () => {
    expect(reasonText(reasonOf('myModuleCustomCode'))).toBe('myModuleCustomCode');
    expect(reasonOf('myModuleCustomCode').code).toBe('myModuleCustomCode');
  });
});
