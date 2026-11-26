import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { PublicEnvironment } from "./config/environments.js";
import { CodeMode } from "./codemode/codemode.js";
import { registerCodeModeTools } from "./codemode/tools.js";
import type { XrayApi } from "./xray/api.js";
import { XRAY_DECLARATIONS } from "./xray/declarations.js";
import { xrayFunctions } from "./xray/functions.js";
import type { GraphQLClient } from "./xray/graphql.js";
import { whoami } from "./xray/whoami.js";

export const SERVER_NAME = "xray";
export const SERVER_VERSION = "0.1.0";

export interface ServerDeps {
  env: PublicEnvironment;
  client: GraphQLClient;
  xray: XrayApi;
  /** Para testes: tempo limite do execute. */
  executeTimeoutMs?: number;
}

export function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function errorResult(err: unknown): CallToolResult {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** Cria o servidor MCP de um ambiente. Cada instância fica presa ao ambiente com que arrancou. */
export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        `Servidor MCP do Xray Cloud ligado ao ambiente "${deps.env.name}" (${deps.env.baseUrl}). ` +
        `Todas as operações acontecem neste ambiente; para outro ambiente use a outra instância registada. ` +
        `Fluxo: chame describe uma vez, depois execute com código que usa o objeto xray.`,
    },
  );

  server.registerTool(
    "whoami",
    {
      title: "Ambiente e autenticação",
      description:
        "Devolve o ambiente Xray desta instância (por exemplo local ou staging) e confirma que a autenticação funciona.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        return jsonResult(await whoami(deps.client, deps.env));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  const codeMode = new CodeMode({
    api: { name: "xray", functions: xrayFunctions(deps.xray), declarations: XRAY_DECLARATIONS },
    context: () => ({ environment: deps.env.name, baseUrl: deps.env.baseUrl }),
    ...(deps.executeTimeoutMs !== undefined && { timeoutMs: deps.executeTimeoutMs }),
  });
  registerCodeModeTools(server, codeMode);

  return server;
}
