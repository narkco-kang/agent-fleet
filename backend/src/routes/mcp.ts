import type { FastifyInstance } from 'fastify';
import type { McpServerConfig } from '../services/mcp/mcpClient.js';
import { mcpRegistry } from '../services/mcp/mcpRegistry.js';
import { randomId } from '../security/auth.js';

/**
 * MCP 工具网关 REST 出口（P2-9）：注册/列出 MCP server、发现/调用其工具。
 */
export function registerMcpRoutes(app: FastifyInstance): void {
  /** 列出已注册 MCP server 状态 */
  app.get('/api/mcp/servers', async () => {
    return { ok: true, data: mcpRegistry.list() };
  });

  /** 注册并连接一个 MCP server（stdio: command+args / http: url） */
  app.post<{ Body: { name?: string; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string> } }>(
    '/api/mcp/servers',
    async (req, reply) => {
      const body = req.body ?? {};
      if (!body.name) return reply.code(400).send({ ok: false, error: 'name required' });
      if (!body.command && !body.url) {
        return reply.code(400).send({ ok: false, error: 'command 或 url 必填其一' });
      }
      const config: McpServerConfig = {
        id: randomId('mcp'),
        name: body.name,
        command: body.command,
        args: body.args,
        env: body.env,
        url: body.url,
        headers: body.headers,
      };
      try {
        const status = await mcpRegistry.register(config);
        return { ok: true, data: status };
      } catch (err) {
        return reply.code(502).send({ ok: false, error: (err as Error).message });
      }
    },
  );

  /** 某 server 的工具列表 */
  app.get<{ Params: { id: string } }>('/api/mcp/servers/:id/tools', async (req, reply) => {
    if (!mcpRegistry.list().some((s) => s.id === req.params.id)) {
      return reply.code(404).send({ ok: false, error: 'mcp_server_not_found' });
    }
    return { ok: true, data: mcpRegistry.getTools(req.params.id) };
  });

  /** 调用某 server 的某个工具 */
  app.post<{ Params: { id: string }; Body: { tool?: string; arguments?: Record<string, unknown> } }>(
    '/api/mcp/servers/:id/tools/call',
    async (req, reply) => {
      const tool = req.body?.tool;
      if (!tool) return reply.code(400).send({ ok: false, error: 'tool required' });
      try {
        const result = await mcpRegistry.callTool(req.params.id, tool, req.body?.arguments ?? {});
        return { ok: true, data: { tool, result } };
      } catch (err) {
        const msg = (err as Error).message;
        return reply.code(msg === 'mcp_server_not_found' ? 404 : 502).send({ ok: false, error: msg });
      }
    },
  );

  /** 断开并移除 server */
  app.delete<{ Params: { id: string } }>('/api/mcp/servers/:id', async (req, reply) => {
    if (!mcpRegistry.remove(req.params.id)) {
      return reply.code(404).send({ ok: false, error: 'mcp_server_not_found' });
    }
    return { ok: true };
  });
}
