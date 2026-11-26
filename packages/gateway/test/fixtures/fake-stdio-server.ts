/** Servidor MCP por stdio, para o teste e2e: diz que variáveis de ambiente recebeu. */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "fixture", version: "0.0.0" });
server.registerTool("whoami", { description: "Devolve o TOKEN recebido e os nomes das variáveis visíveis", inputSchema: {} }, () => ({
  content: [{ type: "text", text: JSON.stringify({ token: process.env.TOKEN, envNames: Object.keys(process.env).sort() }) }],
}));
await server.connect(new StdioServerTransport());
