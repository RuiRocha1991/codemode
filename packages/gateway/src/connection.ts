import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { buildHttpHeaders, resolveEnvRefs, resolveRecord, type ServerConfig } from "./config.js";

export interface McpTool {
  name: string;
  description?: string | undefined;
  inputSchema: unknown;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } | undefined;
}

/** O que o gateway precisa de um servidor MCP. Permite ligar clientes reais ou de teste. */
export interface ServerConnection {
  readonly name: string;
  listTools(): Promise<McpTool[]>;
  /** Chama a ferramenta e devolve o resultado MCP em bruto. */
  callTool(tool: string, args: Record<string, unknown>): Promise<McpToolResult>;
  close(): Promise<void>;
}

export interface McpToolResult {
  content?: { type: string; text?: string }[];
  structuredContent?: unknown;
  isError?: boolean;
}

export class ClientConnection implements ServerConnection {
  constructor(
    readonly name: string,
    private readonly client: Client,
    private readonly timeoutMs = 60_000,
  ) {}

  async listTools(): Promise<McpTool[]> {
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.client.listTools(cursor ? { cursor } : undefined);
      tools.push(...(page.tools as McpTool[]));
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  }

  async callTool(tool: string, args: Record<string, unknown>): Promise<McpToolResult> {
    return (await this.client.callTool({ name: tool, arguments: args }, undefined, { timeout: this.timeoutMs })) as McpToolResult;
  }

  close(): Promise<void> {
    return this.client.close();
  }
}

/** Liga a um servidor MCP segundo a configuração, resolvendo ${VAR} no momento. */
export async function connectServer(name: string, cfg: ServerConfig, env: NodeJS.ProcessEnv = process.env): Promise<ServerConnection> {
  const client = new Client({ name: `codemode-gateway/${name}`, version: "0.1.0" });
  if (cfg.transport === "stdio") {
    const transport = new StdioClientTransport({
      command: resolveEnvRefs(cfg.command, env, `${name}.command`),
      args: cfg.args.map((a, i) => resolveEnvRefs(a, env, `${name}.args[${i}]`)),
      // Só as variáveis seguras por omissão + as declaradas: o servidor filho não herda os segredos dos outros.
      env: { ...getDefaultEnvironment(), ...resolveRecord(cfg.env, env, `${name}.env`) },
      ...(cfg.cwd && { cwd: cfg.cwd }),
      stderr: "inherit",
    });
    await client.connect(transport);
  } else {
    const transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
      requestInit: { headers: buildHttpHeaders(cfg, env, name) },
    });
    try {
      await client.connect(transport);
    } catch (err) {
      throw explainConnectError(name, err);
    }
  }
  return new ClientConnection(name, client, cfg.timeoutMs);
}

/** 401/403 → mensagem acionável (sem OAuth: o gateway só envia o token configurado). */
function explainConnectError(name: string, err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: unknown } | null)?.code; // o SDK põe aqui o estado HTTP
  if (code === 401 || code === 403 || /\b(401|403)\b|unauthori[sz]ed|forbidden/i.test(msg) || (err instanceof Error && err.name === "UnauthorizedError")) {
    return new Error(
      `${name}: o servidor recusou as credenciais (${msg}). Confirme o token em "auth" ou "headers" e que a variável de ambiente está definida. OAuth não é suportado: use um token de API.`,
    );
  }
  return err instanceof Error ? err : new Error(msg);
}
