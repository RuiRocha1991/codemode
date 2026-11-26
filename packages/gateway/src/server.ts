import { CodeMode, registerExecuteTool, toolText } from "@codemode/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { renderDeclarations, type GatewayApi } from "./api.js";

/** Acima disto o describe sem filtro devolve só o índice, para não encher o contexto do modelo. */
export const MAX_DECLARATION_CHARS = 40_000;

export interface GatewayServerOptions {
  timeoutMs?: number;
}

export function createGatewayServer(api: GatewayApi, options: GatewayServerOptions = {}): McpServer {
  const server = new McpServer(
    { name: "codemode-gateway", version: "0.1.0" },
    {
      instructions:
        "Gateway Code Mode: liga a vários servidores MCP. Chame `describe` para ver os servidores e as funções " +
        "`mcp.<servidor>.<ferramenta>()` e depois `execute` com código que as usa; um só script pode usar vários servidores.",
    },
  );

  const codeMode = new CodeMode({
    api: { name: api.name, functions: api.functions, declarations: renderDeclarations(api) },
    ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
  });

  server.registerTool(
    "describe",
    {
      title: "Descrever os servidores e a API",
      description:
        "Lista os servidores MCP ligados e devolve as declarações TypeScript de `mcp.<servidor>.<ferramenta>()`. " +
        "Com `servers` só descreve esses; sem filtro, se houver muitas ferramentas, devolve só o índice e deve repetir com `servers`.",
      inputSchema: { servers: z.array(z.string()).max(50).optional().describe("Nomes dos servidores a descrever") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ servers }) => {
      const unknown = (servers ?? []).filter((s) => !api.servers.some((x) => x.name === s));
      const overview = api.servers.map((s) => ({
        server: s.name,
        status: s.status,
        ...(s.error && { error: s.error }),
        tools: s.tools.map((t) => t.fn),
        hidden: s.hidden.length ? s.hidden : undefined,
      }));
      const declarations = renderDeclarations(api, servers);
      const tooBig = !servers && declarations.length > MAX_DECLARATION_CHARS;
      return toolText({
        usage:
          "Escreva o corpo de uma função async. Use `mcp.<servidor>.<ferramenta>(input)`; cada função devolve o resultado da ferramenta " +
          "(objeto, texto ou lista) e lança se a ferramenta falhar. Pode usar vários servidores no mesmo código, Promise.all para paralelismo " +
          "e `return` para o resultado final (pequeno). Sem rede, ficheiros nem process.",
        servers: overview,
        ...(unknown.length && { unknownServers: unknown }),
        declarations: tooBig ? undefined : declarations,
        ...(tooBig && { note: `As declarações têm ${declarations.length} caracteres. Chame describe com { servers: ["nome"] } para ver um servidor de cada vez.` }),
      });
    },
  );

  registerExecuteTool(server, codeMode);
  return server;
}
