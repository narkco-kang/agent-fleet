/**
 * 通用 MCP client（P2-9）：把 amg 专用骨架推广为可连任意 MCP server 的客户端。
 *
 * 支持两种传输：
 *   - stdio：spawn 子进程，按行 JSON-RPC 2.0 收发
 *   - http：POST JSON-RPC 到 Streamable HTTP 端点（兼容 application/json 与 text/event-stream 响应）
 *
 * 方法：initialize / listTools / callTool / close。
 * 这是「调度器可调外部 MCP 工具」的底层能力，配合 mcpRegistry 注册多 server。
 */
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

/** MCP server 连接配置（二选一：command 走 stdio，url 走 http） */
export interface McpServerConfig {
  id: string;
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  /** 可选认证头（http 传输） */
  headers?: Record<string, string>;
}

/** MCP 工具描述（tools/list 返回项） */
export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface Pending {
  resolve: (v: JsonRpcResponse) => void;
  reject: (e: Error) => void;
}

const PROTOCOL_VERSION = '2024-11-05';
const CLIENT_INFO = { name: 'agentfleet', version: '0.1.0' };

export class McpClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<string | number, Pending>();
  private buffer = '';
  private counter = 0;
  private sessionId: string | null = null;
  private closed = false;

  constructor(private readonly config: McpServerConfig) {}

  get transport(): 'stdio' | 'http' {
    return this.config.url ? 'http' : 'stdio';
  }

  /** MCP initialize 握手（幂等：http 重复调用返回 session） */
  async initialize(): Promise<unknown> {
    const result = await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    });
    // stdio 传输需再发 initialized 通知（规范要求）；http 由 session 管理
    if (this.transport === 'stdio') {
      this.notify('notifications/initialized');
    }
    return result;
  }

  /** 列出可用工具 */
  async listTools(): Promise<McpTool[]> {
    const result = (await this.request('tools/list')) as { tools?: McpTool[] };
    return result?.tools ?? [];
  }

  /** 调用一个工具，返回解析后的文本内容 */
  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = (await this.request('tools/call', { name, arguments: args })) as {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };
    const text = (result?.content ?? [])
      .filter((c) => c.type === 'text' && c.text != null)
      .map((c) => c.text)
      .join('\n');
    if (result?.isError) throw new Error(text || `MCP tool ${name} returned error`);
    return text;
  }

  /** 关闭连接 */
  close(): void {
    this.closed = true;
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
    this.rejectAll(new Error('MCP client closed'));
  }

  /** 发送 JSON-RPC 请求并按传输分派 */
  private async request(method: string, params?: unknown): Promise<unknown> {
    if (this.closed) throw new Error('MCP client closed');
    const id = ++this.counter;
    const req = { jsonrpc: '2.0' as const, id, method, ...(params !== undefined ? { params } : {}) };
    if (this.transport === 'http') return this.requestHttp(req);
    return this.requestStdio(req);
  }

  private notify(method: string): void {
    if (this.transport === 'stdio' && this.proc) {
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
    }
  }

  // ===== stdio 传输 =====

  private async requestStdio(req: { jsonrpc: '2.0'; id: number; method: string; params?: unknown }): Promise<unknown> {
    this.startProc();
    const response = await new Promise<JsonRpcResponse>((resolve, reject) => {
      this.pending.set(req.id, { resolve, reject });
      this.proc!.stdin.write(JSON.stringify(req) + '\n');
    });
    return unwrap(response);
  }

  private startProc(): void {
    if (this.proc) return;
    if (!this.config.command) throw new Error('stdio transport requires command');
    this.proc = spawn(this.config.command, this.config.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(this.config.env ?? {}) },
    });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk: string) => this.onData(chunk));
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (chunk: string) => {
      process.stderr.write(`[mcp:${this.config.name} stderr] ${chunk}`);
    });
    this.proc.on('error', (err) => this.rejectAll(new Error(`MCP ${this.config.name} spawn failed: ${err.message}`)));
    this.proc.on('exit', (code) => {
      this.rejectAll(new Error(`MCP ${this.config.name} exited (code ${code ?? 'unknown'})`));
      this.proc = null;
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let nl = this.buffer.indexOf('\n');
    while (nl >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line) this.handleLine(line);
      nl = this.buffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    let parsed: JsonRpcResponse;
    try {
      parsed = JSON.parse(line) as JsonRpcResponse;
    } catch {
      return; // 忽略诊断/非 JSON 行
    }
    const pending = this.pending.get(parsed.id);
    if (!pending) return;
    this.pending.delete(parsed.id);
    pending.resolve(parsed);
  }

  // ===== http（Streamable HTTP）传输 =====

  private async requestHttp(req: { jsonrpc: '2.0'; id: number; method: string; params?: unknown }): Promise<unknown> {
    if (!this.config.url) throw new Error('http transport requires url');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(this.config.headers ?? {}),
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;

    const res = await fetch(this.config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`MCP ${this.config.name} HTTP ${res.status}`);

    // 保存 session id（initialize 响应头返回，后续请求复用）
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;

    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream')) {
      const response = await parseSseResponse(await res.text());
      return unwrap(response);
    }
    return unwrap((await res.json()) as JsonRpcResponse);
  }

  private rejectAll(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}

/** JSON-RPC 响应 → result（error 则抛错） */
function unwrap(res: JsonRpcResponse): unknown {
  if (res.error) throw new Error(`MCP error ${res.error.code}: ${res.error.message}`);
  return res.result;
}

/** 解析 SSE 响应：提取 data: 行，返回最后一个有效 JSON-RPC 响应 */
async function parseSseResponse(body: string): Promise<JsonRpcResponse> {
  let last: JsonRpcResponse | null = null;
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('data:')) continue;
    const payload = t.slice(5).trim();
    if (!payload) continue;
    try {
      const parsed = JSON.parse(payload) as JsonRpcResponse;
      if (parsed.id != null) last = parsed;
    } catch {
      /* 跳过非 JSON data 行 */
    }
  }
  if (!last) throw new Error('MCP SSE 响应无有效 JSON-RPC');
  return last;
}
