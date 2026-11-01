/**
 * amg MCP client（P1 骨架）：spawn 子进程 + stdio JSON-RPC 2.0。
 *
 * amg 自带 MCP server（stdio、无网络暴露）。本客户端按行（换行符分隔）收发
 * JSON-RPC，提供 initialize / tools/list 两个基础方法，供 P1 对接完整语义。
 */
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';

/** JSON-RPC 2.0 请求。 */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

/** JSON-RPC 2.0 响应。 */
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface Pending {
  resolve: (value: JsonRpcResponse) => void;
  reject: (reason: Error) => void;
}

/**
 * amg MCP stdio 客户端骨架。
 * 用法：client.start() → await client.initialize() → await client.listTools() → client.stop()。
 */
export class AmgMcpClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<string | number, Pending>();
  private buffer = '';
  private requestCounter = 0;

  constructor(
    private readonly command: string,
    private readonly args: string[] = [],
  ) {}

  /** 启动 amg MCP server 子进程并挂接 stdio 按行解析。 */
  start(): void {
    if (this.proc) return;
    this.proc = spawn(this.command, this.args, { stdio: ['pipe', 'pipe', 'pipe'] });

    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk: string) => this.onData(chunk));

    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (chunk: string) => {
      // stderr 仅用于诊断，不参与协议。
      process.stderr.write(`[amg-mcp stderr] ${chunk}`);
    });

    this.proc.on('error', (err) => {
      this.rejectAll(new Error(`amg MCP spawn failed: ${err.message}`));
    });

    this.proc.on('exit', (code) => {
      this.rejectAll(new Error(`amg MCP exited with code ${code ?? 'unknown'}`));
      this.proc = null;
    });
  }

  /** 停止子进程。 */
  stop(): void {
    if (!this.proc) return;
    this.proc.kill();
    this.proc = null;
    this.rejectAll(new Error('amg MCP client stopped'));
  }

  /** 发送一条 JSON-RPC 请求并等待响应。 */
  async request(method: string, params?: unknown): Promise<unknown> {
    this.start();
    const id = ++this.requestCounter;
    const req: JsonRpcRequest = { jsonrpc: '2.0', id, method };
    if (params !== undefined) req.params = params;

    const response = await new Promise<JsonRpcResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc!.stdin.write(JSON.stringify(req) + '\n');
    });

    if (response.error) {
      throw new Error(
        `amg MCP error ${response.error.code}: ${response.error.message}`,
      );
    }
    return response.result;
  }

  /** MCP initialize 握手。 */
  async initialize(): Promise<unknown> {
    return this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'agentmesh-memory', version: '0.1.0' },
    });
  }

  /** 列出可用工具。 */
  async listTools(): Promise<unknown> {
    return this.request('tools/list');
  }

  /** 调用一个工具。 */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.request('tools/call', { name, arguments: args });
  }

  /** 按行累积 stdout 缓冲并解析 JSON-RPC 响应。 */
  private onData(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.handleLine(line);
      newline = this.buffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    let parsed: JsonRpcResponse;
    try {
      parsed = JSON.parse(line) as JsonRpcResponse;
    } catch {
      return; // 忽略非 JSON 行（诊断输出等）。
    }
    const pending = this.pending.get(parsed.id);
    if (!pending) return;
    this.pending.delete(parsed.id);
    pending.resolve(parsed);
  }

  private rejectAll(err: Error): void {
    for (const pending of this.pending.values()) pending.reject(err);
    this.pending.clear();
  }
}
