import { describe, expect, it } from 'vitest';
import { canonicalize } from '../src/crypto/canonical';

describe('canonicalize', () => {
  it('is deterministic across key insertion order', () => {
    const a = { b: 2, a: 1, c: { z: 26, y: 25 } };
    const b = { c: { y: 25, z: 26 }, a: 1, b: 2 };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('does not escape non-ASCII characters', () => {
    expect(canonicalize({ label: '中文' })).toBe('{"label":"中文"}');
  });

  it('serializes integers without scientific notation', () => {
    expect(canonicalize({ n: 123 })).toBe('{"n":123}');
    expect(canonicalize({ n: 1000000000000000 })).toBe('{"n":1000000000000000}');
    expect(canonicalize({ n: 0 })).toBe('{"n":0}');
  });

  it('sorts object keys recursively by code point', () => {
    expect(canonicalize({ z: 1, a: { m: 1, a: 2 } })).toBe(
      '{"a":{"a":2,"m":1},"z":1}',
    );
  });

  it('drops undefined object values', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('preserves array order and standard JSON scalars', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalize({ a: null, b: true, c: false })).toBe(
      '{"a":null,"b":true,"c":false}',
    );
  });

  it('normalizes -0 to 0', () => {
    expect(canonicalize({ n: -0 })).toBe('{"n":0}');
  });
});
