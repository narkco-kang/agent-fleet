import { describe, expect, it } from 'vitest';
import { extractText, mapStatus } from '../src/routes/a2a.js';

describe('A2A extractText', () => {
  it('joins multiple parts', () => {
    const text = extractText({ parts: [{ text: 'hello' }, { text: 'world' }] });
    expect(text).toBe('hello\nworld');
  });

  it('returns empty for missing message', () => {
    expect(extractText(undefined)).toBe('');
    expect(extractText({ parts: [] })).toBe('');
  });
});

describe('A2A mapStatus', () => {
  it('maps queued -> submitted', () => {
    expect(mapStatus('queued')).toBe('submitted');
  });
  it('maps running -> working', () => {
    expect(mapStatus('running')).toBe('working');
  });
  it('maps completed -> completed', () => {
    expect(mapStatus('completed')).toBe('completed');
  });
  it('maps terminal failures -> failed', () => {
    expect(mapStatus('failed')).toBe('failed');
    expect(mapStatus('interrupted')).toBe('failed');
    expect(mapStatus('cancelled')).toBe('failed');
  });
});
