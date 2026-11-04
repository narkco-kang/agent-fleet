import { McpClient, type McpServerConfig, type McpTool } from './mcpClient.js';

/**
 * MCP server 注册表（P2-9）：管理多个 MCP server 连接 + 工具发现 + 工具调用。
 *
 * 内存态（进程内生效，重启后需重新注册），供调度器/网关任务调用外部工具。
 */

export interface McpServerStatus {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  status: 'connected' | 'error';
  toolCount: number;
  error?: string;
}

interface Entry {
  config: McpServerConfig;
  client: McpClient;
  tools: McpTool[];
  status: 'connected' | 'error';
  error?: string;
}

class McpRegistry {
  private readonly servers = new Map<string, Entry>();

  /** 注册并连接一个 MCP server（initialize + tools/list） */
  async register(config: McpServerConfig): Promise<McpServerStatus> {
    const client = new McpClient(config);
    try {
      await client.initialize();
      const tools = await client.listTools();
      this.servers.set(config.id, { config, client, tools, status: 'connected' });
    } catch (err) {
      client.close();
      const error = (err as Error).message;
      this.servers.set(config.id, { config, client, tools: [], status: 'error', error });
      throw new Error(`MCP ${config.name} 连接失败: ${error}`);
    }
    return this.statusOf(config.id)!;
  }

  /** 列出已注册 server 状态 */
  list(): McpServerStatus[] {
    return Array.from(this.servers.values()).map((e) => this.toStatus(e));
  }

  /** 某 server 的工具列表 */
  getTools(id: string): McpTool[] {
    return this.servers.get(id)?.tools ?? [];
  }

  /** 调用某 server 的工具 */
  async callTool(id: string, name: string, args: Record<string, unknown>): Promise<string> {
    const entry = this.servers.get(id);
    if (!entry) throw new Error('mcp_server_not_found');
    return entry.client.callTool(name, args);
  }

  /** 断开并移除 server */
  remove(id: string): boolean {
    const entry = this.servers.get(id);
    if (!entry) return false;
    entry.client.close();
    this.servers.delete(id);
    return true;
  }

  /** 断开全部（进程退出前清理） */
  closeAll(): void {
    for (const entry of this.servers.values()) entry.client.close();
    this.servers.clear();
  }

  private statusOf(id: string): McpServerStatus | undefined {
    const entry = this.servers.get(id);
    return entry ? this.toStatus(entry) : undefined;
  }

  private toStatus(e: Entry): McpServerStatus {
    return {
      id: e.config.id,
      name: e.config.name,
      transport: e.client.transport,
      status: e.status,
      toolCount: e.tools.length,
      error: e.error,
    };
  }
}

/** 全局单例 */
export const mcpRegistry = new McpRegistry();
