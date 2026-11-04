import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { McpClient } from '../src/services/mcp/mcpClient.js';
import { mcpRegistry } from '../src/services/mcp/mcpRegistry.js';

/**
 * P2-9 通用 MCP client：stdio + http 双传输 + registry 注册/发现/调用。
 */

/** mock MCP stdio server（node -e 内联，读 stdin 每行 JSON-RPC 回响应） */
const MOCK_SERVER_SCRIPT = [
  "const rl=require('readline').createInterface({input:process.stdin});",
  "rl.on('line',(l)=>{try{const r=JSON.parse(l);let res;",
  "if(r.method==='initialize')res={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'mock',version:'1.0'}};",
  "else if(r.method==='tools/list')res={tools:[{name:'echo',description:'echo back',inputSchema:{type:'object'}}]};",
  "else if(r.method==='tools/call')res={content:[{type:'text',text:JSON.stringify(r.params.arguments)}]};",
  "if(res)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result:res})+'\\n');}catch(e){}});",
].join('');

describe('通用 MCP client（P2-9）', () => {
  describe('stdio 传输', () => {
    it('initialize → listTools → callTool 闭环', async () => {
      const client = new McpClient({
        id: 'mock-stdio',
        name: 'mock',
        command: process.execPath,
        args: ['-e', MOCK_SERVER_SCRIPT],
      });
      try {
        await client.initialize();
        const tools = await client.listTools();
        expect(tools).toHaveLength(1);
        expect(tools[0]!.name).toBe('echo');

        const result = await client.callTool('echo', { hello: 'world' });
        expect(JSON.parse(result)).toEqual({ hello: 'world' });
      } finally {
        client.close();
      }
    });

    it('command 不存在 → initialize 报错', async () => {
      const client = new McpClient({ id: 'bad', name: 'bad', command: '/no/such/cmd' });
      await expect(client.initialize()).rejects.toThrow();
      client.close();
    });
  });

  describe('http 传输（Streamable HTTP）', () => {
    let server: http.Server;
    let baseUrl = '';

    beforeAll(async () => {
      server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => (raw += c.toString()));
        req.on('end', () => {
          const r = JSON.parse(raw) as { id: number; method: string; params?: { arguments?: unknown } };
          let result: unknown;
          if (r.method === 'initialize') {
            res.setHeader('Mcp-Session-Id', 'sess-1');
            result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'http-mock', version: '1.0' } };
          } else if (r.method === 'tools/list') {
            result = { tools: [{ name: 'sum', description: 'sum numbers', inputSchema: { type: 'object' } }] };
          } else if (r.method === 'tools/call') {
            result = { content: [{ type: 'text', text: JSON.stringify(r.params?.arguments) }] };
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ jsonrpc: '2.0', id: r.id, result }));
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('http 端点 initialize + listTools + callTool', async () => {
      const client = new McpClient({ id: 'mock-http', name: 'http-mock', url: baseUrl });
      try {
        await client.initialize();
        const tools = await client.listTools();
        expect(tools[0]!.name).toBe('sum');
        const result = await client.callTool('sum', { a: 1, b: 2 });
        expect(JSON.parse(result)).toEqual({ a: 1, b: 2 });
      } finally {
        client.close();
      }
    });
  });

  describe('mcpRegistry 注册表', () => {
    it('register → list → getTools → callTool → remove', async () => {
      const status = await mcpRegistry.register({
        id: 'reg-1',
        name: 'mock',
        command: process.execPath,
        args: ['-e', MOCK_SERVER_SCRIPT],
      });
      expect(status.status).toBe('connected');
      expect(status.toolCount).toBe(1);

      const list = mcpRegistry.list();
      expect(list.some((s) => s.id === 'reg-1')).toBe(true);

      expect(mcpRegistry.getTools('reg-1')[0]!.name).toBe('echo');
      const out = await mcpRegistry.callTool('reg-1', 'echo', { x: 1 });
      expect(JSON.parse(out)).toEqual({ x: 1 });

      expect(mcpRegistry.remove('reg-1')).toBe(true);
      expect(mcpRegistry.list()).toHaveLength(0);
    });

    it('调用不存在的 server 报错', async () => {
      await expect(mcpRegistry.callTool('nope', 'echo', {})).rejects.toThrow('mcp_server_not_found');
    });
  });
});
