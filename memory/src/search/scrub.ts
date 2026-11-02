/**
 * secret 脱敏：写入记忆账本前剥离 API key / token / 私钥 / 卡号等敏感信息。
 *
 * 借鉴 AgentMemory 的 secret scrubbing（它默认对 API keys、PEM 私钥自动脱敏）。
 * 我们的账本 append-only 不可删，所以脱敏必须发生在「写入前」，而非「读取时」。
 */

const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'openai/anthropic sk', re: /sk-[a-zA-Z0-9_-]{16,}/g },
  { name: 'github pat', re: /ghp_[a-zA-Z0-9]{30,}/g },
  { name: 'github fine-grained', re: /github_pat_[a-zA-Z0-9_]{20,}/g },
  { name: 'slack token', re: /xox[baprs]-[a-zA-Z0-9-]{10,}/g },
  { name: 'google api', re: /AIza[0-9A-Za-z_-]{30,}/g },
  { name: 'aws access key', re: /AKIA[0-9A-Z]{16}/g },
  { name: 'bearer token', re: /Bearer\s+[a-zA-Z0-9._-]{20,}/gi },
  { name: 'pem private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: 'card number', re: /\b\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{4}\b/g },
];

/** 是否含疑似 secret。 */
export function hasSecret(text: string): boolean {
  if (!text) return false;
  return SECRET_PATTERNS.some(({ re }) => {
    re.lastIndex = 0;
    return re.test(text);
  });
}

/** 把文本中的 secret 替换为 [REDACTED]。 */
export function scrubSecrets(text: string): string {
  if (!text) return text;
  let out = text;
  for (const { re } of SECRET_PATTERNS) {
    re.lastIndex = 0;
    out = out.replace(re, '[REDACTED]');
  }
  return out;
}
