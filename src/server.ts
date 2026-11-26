import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const SERVER_NAME = "xray";
export const SERVER_VERSION = "0.1.0";

/** Cria o servidor MCP. As ferramentas são registadas pelos módulos que as definem. */
export function createServer(): McpServer {
  return new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
}
