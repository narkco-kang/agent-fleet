import { describe, expect, it } from 'vitest';
import { parseLoginChallenge } from '../src/loginService.js';

/**
 * 设备登录授权服务（Device Auth Flow）的 URL/code 解析。
 * 看板授权中心的核心：从 CLI device-auth 输出捕获浏览器授权 URL + 一次性码。
 */

const CODEX_OUTPUT = `Welcome to Codex [v0.166.0]
OpenAI's command-line coding agent

Follow these steps to sign in with ChatGPT using device code authorization:

1. Open this link in your browser and sign in to your account
   https://auth.openai.com/codex/device

2. Enter this one-time code (expires in 15 minutes)
   ZE5G-DV22A

Continue only if you started this login in Codex.`;

describe('登录授权解析（parseLoginChallenge）', () => {
  it('解析 codex device-auth 输出的 URL + code', () => {
    const r = parseLoginChallenge(CODEX_OUTPUT);
    expect(r.url).toBe('https://auth.openai.com/codex/device');
    expect(r.code).toBe('ZE5G-DV22A');
  });

  it('解析任意 https URL + XXXX-XXXX 短码', () => {
    const r = parseLoginChallenge(
      '请在浏览器打开 https://auth.example.com/login 并输入码 ABCD-1234',
    );
    expect(r.url).toBe('https://auth.example.com/login');
    expect(r.code).toBe('ABCD-1234');
  });

  it('自定义 pattern 覆盖（非标准 URL/码格式）', () => {
    const r = parseLoginChallenge(
      'open: http://custom.io/go code=XYZ987',
      /(http:\/\/\S+)/,
      /code=([A-Z0-9]+)/i,
    );
    expect(r.url).toBe('http://custom.io/go');
    expect(r.code).toBe('XYZ987');
  });

  it('无 URL/code 时返回空', () => {
    const r = parseLoginChallenge('已登录，无需授权');
    expect(r.url).toBeUndefined();
    expect(r.code).toBeUndefined();
  });
});
