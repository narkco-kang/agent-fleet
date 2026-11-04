import { del, get, post, type ApiOk } from './http';

/**
 * MCP 工具网关 API（P2-9）。
 */
export interface McpServerStatus {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  status: 'connected' | 'error';
  toolCount: number;
  error?: string;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export const mcpApi = {
  list: () => get<ApiOk<McpServerStatus[]>>('/api/mcp/servers'),
  register: (body: { name: string; command?: string; args?: string[]; url?: string }) =>
    post<ApiOk<McpServerStatus>>('/api/mcp/servers', body),
  tools: (id: string) => get<ApiOk<McpTool[]>>(`/api/mcp/servers/${id}/tools`),
  call: (id: string, tool: string, args: Record<string, unknown>) =>
    post<ApiOk<{ tool: string; result: string }>>(`/api/mcp/servers/${id}/tools/call`, { tool, arguments: args }),
  remove: (id: string) => del<ApiOk<unknown>>(`/api/mcp/servers/${id}`),
};
