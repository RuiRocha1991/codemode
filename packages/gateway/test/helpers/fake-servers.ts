import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ClientConnection } from "../../src/connection.js";

/** Liga um servidor MCP real (em memória) e devolve a ligação do gateway. */
export async function connectFake(name: string, setup: (server: McpServer) => void): Promise<ClientConnection> {
  const server = new McpServer({ name, version: "0.0.0" });
  setup(server);
  const client = new Client({ name: "gateway-test", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return new ClientConnection(name, client);
}

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v) }] });

export interface JiraState {
  versions: { project: string; name: string }[];
  deleted: string[];
}

/** Jira falso: criar versões, ler issues, apagar issues (destrutivo), uma ferramenta que falha. */
export function jiraFake(state: JiraState) {
  return (s: McpServer) => {
    s.registerTool(
      "createVersion",
      { description: "Cria uma versão (fixVersion) num projeto Jira", inputSchema: { project: z.string().describe("Chave do projeto"), name: z.string() } },
      ({ project, name }) => {
        state.versions.push({ project, name });
        return json({ id: String(state.versions.length), project, name });
      },
    );
    s.registerTool(
      "getIssue",
      { description: "Lê uma issue", inputSchema: { key: z.string() }, annotations: { readOnlyHint: true } },
      ({ key }) => ({ content: [{ type: "text", text: `Issue ${key}: texto simples, não JSON` }] }),
    );
    s.registerTool(
      "getInfo",
      { description: "Info com saída estruturada", inputSchema: {}, outputSchema: { site: z.string(), versions: z.number() } },
      () => ({ content: [{ type: "text", text: "{}" }], structuredContent: { site: "teste", versions: state.versions.length } }),
    );
    s.registerTool(
      "deleteIssue",
      { description: "Apaga uma issue", inputSchema: { key: z.string() }, annotations: { destructiveHint: true } },
      ({ key }) => {
        state.deleted.push(key);
        return json({ deleted: key });
      },
    );
    s.registerTool("explode", { description: "Falha sempre", inputSchema: {} }, () => ({
      isError: true,
      content: [{ type: "text", text: "o Jira disse não" }],
    }));
  };
}

export interface XrayState {
  plans: { project: string; summary: string; fixVersions: string[] }[];
}

/** Xray falso (ferramentas MCP clássicas) para o exemplo Jira + Xray. */
export function xrayFake(state: XrayState) {
  return (s: McpServer) => {
    s.registerTool(
      "createTestPlan",
      {
        description: "Cria um Test Plan com versão",
        inputSchema: { project: z.string(), summary: z.string(), fixVersions: z.array(z.string()).optional() },
      },
      ({ project, summary, fixVersions }) => {
        state.plans.push({ project, summary, fixVersions: fixVersions ?? [] });
        return json({ key: `${project}-${100 + state.plans.length}`, summary });
      },
    );
  };
}
