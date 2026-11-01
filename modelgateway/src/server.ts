import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from './config.js';
import { ProviderPool } from './providers.js';
import { OpenAIHandler, type ChatBody, type MgHeaders } from './openai.js';

/**
 * node:http 路由网关：
 * - GET  /health                 → { ok, version, uptimeMs, providers, defaultModel }
 * - GET  /v1/models              → 聚合可用模型列表（OpenAI data 结构）
 * - POST /v1/chat/completions    → OpenAIHandler
 * - POST /v1/free/checkin        → { ok: true }（直连源无公开签到端点）
 * - POST /v1/checkin             → { ok: true }（兼容通用端点）
 */

const VERSION = '0.1.0';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json', ...corsHeaders() });
  res.end(body);
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-mg-agent, x-mg-session, x-mg-platform, x-mg-task',
  };
}

export class GatewayServer {
  private readonly pool: ProviderPool;
  private readonly openai: OpenAIHandler;
  private readonly version: string;
  private readonly startedAt: number;
  private server: http.Server | null = null;

  constructor(pool: ProviderPool) {
    this.pool = pool;
    this.openai = new OpenAIHandler(pool);
    this.version = VERSION;
    this.startedAt = Date.now();
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        void this.handleRequest(req, res);
      });
      this.server.listen(config.port, config.host, () => resolve());
    });
  }

  /** 优雅关闭：停止监听并释放 server 句柄（等待既有连接自然结束） */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      const srv = this.server;
      this.server = null;
      if (!srv) {
        resolve();
        return;
      }
      srv.close(() => resolve());
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const baseHeaders = corsHeaders();
    const url = req.url ?? '/';
    const pathname = url.split('?')[0];

    if (req.method === 'OPTIONS') {
      res.writeHead(204, baseHeaders);
      res.end();
      return;
    }

    if (req.method === 'GET' && pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        version: this.version,
        uptimeMs: Date.now() - this.startedAt,
        providers: this.pool.health(),
        defaultModel: this.pool.defaultModel(),
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/v1/models') {
      const data = this.pool.allModels().map((id) => ({
        id,
        object: 'model',
        owned_by: this.ownerOf(id),
      }));
      sendJson(res, 200, { object: 'list', data });
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/chat/completions') {
      let body: ChatBody;
      try {
        const raw = await readBody(req);
        body = raw ? (JSON.parse(raw) as ChatBody) : ({} as ChatBody);
      } catch {
        sendJson(res, 400, { error: { message: 'invalid_json_body', type: 'modelgateway_error' } });
        return;
      }
      const mg: MgHeaders = {
        agent: req.headers['x-mg-agent'] as string | undefined,
        session: req.headers['x-mg-session'] as string | undefined,
        platform: req.headers['x-mg-platform'] as string | undefined,
        task: req.headers['x-mg-task'] as string | undefined,
      };
      await this.openai.handleChat(req, res, body, mg);
      return;
    }

    if (req.method === 'POST' && (pathname === '/v1/free/checkin' || pathname === '/v1/checkin')) {
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not_found' });
  }

  private ownerOf(model: string): string {
    for (const p of this.pool.list()) {
      if (p.models.includes(model)) return p.id;
    }
    return 'unknown';
  }
}
