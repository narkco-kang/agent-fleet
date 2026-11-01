import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/crypto/hash';

describe('sha256Hex', () => {
  it('matches the known empty-string vector', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('matches the known "abc" vector', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('accepts Buffer input identically to string input', () => {
    expect(sha256Hex(Buffer.from('abc', 'utf8'))).toBe(sha256Hex('abc'));
  });

  it('always returns 64 lowercase hex characters', () => {
    expect(sha256Hex('agentmesh-memory')).toMatch(/^[0-9a-f]{64}$/);
  });
});
