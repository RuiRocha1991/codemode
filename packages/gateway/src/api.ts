import type { ApiFunctions } from "@codemode/core";
import { isAllowed, type GatewayConfig } from "./config.js";
import type { McpTool, McpToolResult, ServerConnection } from "./connection.js";
import { cleanComment, schemaToTs } from "./schema-to-ts.js";

export interface GatewayTool {
  /** Nome na API TypeScript, por exemplo `createVersion`. */
  fn: string;
  /** Nome original no servidor MCP. */
  tool: string;
  description: string;
  readOnly: boolean;
  destructive: boolean;
}

export interface GatewayServerInfo {
  name: string;
  status: "ok" | "error";
  error?: string;
  tools: GatewayTool[];
  /** Ferramentas escondidas por allow/deny ou com nome inutilizável. */
  hidden: { tool: string; reason: string }[];
  declarations: string;
}

export interface GatewayApi {
  /** Nome do objeto global na sandbox. */
  name: "mcp";
  functions: ApiFunctions;
  servers: GatewayServerInfo[];
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const RESERVED = new Set(["__proto__", "prototype", "constructor"]);

/** Nome de ferramenta → identificador seguro e único. Nomes de servidores externos são dados não confiáveis. */
export function toIdentifier(tool: string, taken: Set<string>): string | undefined {
  let id = tool.replace(/[^A-Za-z0-9_$]+/g, "_").replace(/^_+|_+$/g, "");
  if (/^[0-9]/.test(id)) id = "_" + id;
  if (!id || !IDENT.test(id) || RESERVED.has(id)) return undefined;
  let candidate = id;
  for (let n = 2; taken.has(candidate); n++) candidate = `${id}_${n}`;
  taken.add(candidate);
  return candidate;
}

/**
 * Resultado MCP → valor que o código recebe:
 * - isError → lança com o texto, para o código poder apanhar o erro;
 * - structuredContent → esse objeto;
 * - um só texto → JSON se o for, senão o texto;
 * - outros conteúdos → a lista (texto, imagens com o tipo).
 */
export function mapToolResult(server: string, tool: string, result: McpToolResult): unknown {
  const texts = (result.content ?? []).filter((c) => c.type === "text" && typeof c.text === "string").map((c) => c.text as string);
  if (result.isError) throw new Error(`${server}.${tool}: ${texts.join("\n") || "erro sem mensagem"}`);
  if (result.structuredContent !== undefined && result.structuredContent !== null) return result.structuredContent;
  const content = result.content ?? [];
  if (content.length === 1 && texts.length === 1) {
    try {
      return JSON.parse(texts[0]!) as unknown;
    } catch {
      return texts[0];
    }
  }
  if (content.length === 0) return null;
  return content.map((c) => (c.type === "text" ? c.text : { type: c.type }));
}

function declarationsFor(server: string, tools: { t: GatewayTool; schema: unknown }[]): string {
  const members = tools.map(({ t, schema }) => {
    const tags = [t.destructive ? "[pode apagar ou alterar dados]" : "", t.readOnly ? "[só leitura]" : ""].filter(Boolean).join(" ");
    const doc = cleanComment(`${tags} ${t.description}`.trim(), 500);
    const input = schemaToTs(schema, undefined, 0, "    ");
    const hasRequired = Array.isArray((schema as { required?: unknown })?.required) && ((schema as { required: unknown[] }).required.length > 0);
    const param = input === "{}" ? "" : `input${hasRequired ? "" : "?"}: ${input}`;
    return `${doc ? `    /** ${doc} */\n` : ""}    ${t.fn}(${param}): Promise<unknown>;`;
  });
  return `  ${server}: {\n${members.join("\n")}\n  };`;
}

/** Lê as ferramentas de cada servidor e monta as funções e as declarações TypeScript. */
export async function buildGatewayApi(
  connections: ServerConnection[],
  config: GatewayConfig,
  failures: Record<string, string> = {},
): Promise<GatewayApi> {
  const functions: ApiFunctions = {};
  const servers: GatewayServerInfo[] = [];

  for (const [name, error] of Object.entries(failures)) {
    servers.push({ name, status: "error", error, tools: [], hidden: [], declarations: "" });
  }

  for (const conn of connections) {
    const policy = config.servers[conn.name]?.tools ?? {};
    let raw: McpTool[];
    try {
      raw = await conn.listTools();
    } catch (err) {
      servers.push({ name: conn.name, status: "error", error: err instanceof Error ? err.message : String(err), tools: [], hidden: [], declarations: "" });
      continue;
    }
    const taken = new Set<string>();
    const tools: { t: GatewayTool; schema: unknown }[] = [];
    const hidden: GatewayServerInfo["hidden"] = [];
    for (const tool of raw) {
      if (!isAllowed(policy, tool.name)) {
        hidden.push({ tool: tool.name, reason: "bloqueada pela configuração (allow/deny)" });
        continue;
      }
      const fn = toIdentifier(tool.name, taken);
      if (!fn) {
        hidden.push({ tool: tool.name, reason: "nome inutilizável como identificador" });
        continue;
      }
      const gt: GatewayTool = {
        fn,
        tool: tool.name,
        description: tool.description ?? "",
        readOnly: tool.annotations?.readOnlyHint === true,
        destructive: tool.annotations?.destructiveHint === true,
      };
      tools.push({ t: gt, schema: tool.inputSchema });
      functions[`${conn.name}.${fn}`] = async (arg) => {
        const args = arg === undefined || arg === null ? {} : arg;
        if (typeof args !== "object" || Array.isArray(args)) throw new Error(`${conn.name}.${fn}: o argumento tem de ser um objeto`);
        return mapToolResult(conn.name, tool.name, await conn.callTool(tool.name, args as Record<string, unknown>));
      };
    }
    servers.push({ name: conn.name, status: "ok", tools: tools.map((x) => x.t), hidden, declarations: declarationsFor(conn.name, tools) });
  }
  servers.sort((a, b) => a.name.localeCompare(b.name));
  return { name: "mcp", functions, servers };
}

/** Declarações TypeScript do objeto global `mcp` para os servidores pedidos (todos, se não houver filtro). */
export function renderDeclarations(api: GatewayApi, only?: string[]): string {
  const chosen = api.servers.filter((s) => s.status === "ok" && (!only || only.includes(s.name)));
  return `declare const mcp: {\n${chosen.map((s) => s.declarations).join("\n")}\n};`;
}
