import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { buildGatewayApi } from "../src/api.js";
import { parseConfig } from "../src/config.js";
import { createGatewayServer, MAX_DECLARATION_CHARS } from "../src/server.js";
import { connectFake, jiraFake, xrayFake, type JiraState, type XrayState } from "./helpers/fake-servers.js";

const config = parseConfig({
  servers: {
    jira: { transport: "stdio", command: "x", tools: { deny: ["delete*"] } },
    xray: { transport: "stdio", command: "x" },
  },
});

async function connect(failures: Record<string, string> = {}) {
  const jira: JiraState = { versions: [], deleted: [] };
  const xray: XrayState = { plans: [] };
  const conns = [await connectFake("jira", jiraFake(jira)), await connectFake("xray", xrayFake(xray))];
  const api = await buildGatewayApi(conns, config, failures);
  const server = createGatewayServer(api, { timeoutMs: 5000 });
  const client = new Client({ name: "teste", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, jira, xray, api };
}

type R = Awaited<ReturnType<Client["callTool"]>>;
const body = (r: R) => JSON.parse((r.content as { text: string }[])[0]!.text) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("gateway: describe", () => {
  it("lista servidores, ferramentas e declarações", async () => {
    const { client } = await connect();
    const out = body(await client.callTool({ name: "describe", arguments: {} }));
    expect(out.servers.map((s: { server: string }) => s.server)).toEqual(["jira", "xray"]);
    expect(out.servers[0].tools).toContain("createVersion");
    expect(out.servers[0].hidden).toEqual([{ tool: "deleteIssue", reason: expect.any(String) }]);
    expect(out.declarations).toContain("declare const mcp");
    expect(out.declarations).toContain("createTestPlan");
    expect(out.usage).toContain("mcp.<servidor>.<ferramenta>");
  });

  it("filtra por servidor e avisa de servidores desconhecidos", async () => {
    const { client } = await connect();
    const out = body(await client.callTool({ name: "describe", arguments: { servers: ["xray", "nao-existe"] } }));
    expect(out.declarations).toContain("xray: {");
    expect(out.declarations).not.toContain("jira: {");
    expect(out.unknownServers).toEqual(["nao-existe"]);
  });

  it("mostra servidores que falharam, com o erro", async () => {
    const { client } = await connect({ confluence: "spawn uvx ENOENT" });
    const out = body(await client.callTool({ name: "describe", arguments: {} }));
    expect(out.servers.find((s: { server: string }) => s.server === "confluence")).toMatchObject({ status: "error", error: "spawn uvx ENOENT", tools: [] });
  });

  it("com muitas ferramentas devolve só o índice e pede um servidor de cada vez", async () => {
    const big = await connectFake("grande", (s) => {
      for (let i = 0; i < 400; i++) {
        s.registerTool(`tool${i}`, { description: "d".repeat(300), inputSchema: {} }, () => ({ content: [{ type: "text", text: "1" }] }));
      }
    });
    const api = await buildGatewayApi([big], parseConfig({ servers: { grande: { transport: "stdio", command: "x" } } }));
    const server = createGatewayServer(api);
    const client = new Client({ name: "t", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const all = body(await client.callTool({ name: "describe", arguments: {} }));
    expect(all.declarations).toBeUndefined();
    expect(all.note).toContain('servers: ["nome"]');
    const one = body(await client.callTool({ name: "describe", arguments: { servers: ["grande"] } }));
    expect(one.declarations.length).toBeGreaterThan(MAX_DECLARATION_CHARS);
  });
});

describe("gateway: execute (Jira + Xray num só script)", () => {
  const SCRIPT = `
    // Cria as 3 versões no Jira e um Test Plan por versão no Xray — tudo num só execute.
    const versoes = ["v1.0", "v1.1", "v2.0"];
    await Promise.all(versoes.map((name) => mcp.jira.createVersion({ project: "DEMO", name })));
    const planos = [];
    for (const v of versoes) {
      const plano = await mcp.xray.createTestPlan({ project: "DEMO", summary: "Plano " + v, fixVersions: [v] });
      planos.push(plano.key);
    }
    const info = await mcp.jira.getInfo();
    return { planos, versoesNoJira: info.versions };
  `;

  it("um só execute usa os dois servidores", async () => {
    const { client, jira, xray } = await connect();
    const r = await client.callTool({ name: "execute", arguments: { code: SCRIPT } });
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
    const out = body(r);
    expect(out.value).toEqual({ planos: ["DEMO-101", "DEMO-102", "DEMO-103"], versoesNoJira: 3 });
    expect(out.apiCalls).toBe(3 + 3 + 1);
    expect(jira.versions.map((v) => v.name).sort()).toEqual(["v1.0", "v1.1", "v2.0"]);
    // As versões foram criadas no Jira ANTES de os planos as usarem no Xray.
    expect(xray.plans.map((p) => p.fixVersions[0])).toEqual(["v1.0", "v1.1", "v2.0"]);
  });

  it("erros das ferramentas chegam ao assistente com a causa", async () => {
    const { client } = await connect();
    const r = await client.callTool({ name: "execute", arguments: { code: "await mcp.jira.explode()" } });
    expect(r.isError).toBe(true);
    expect(body(r).error).toContain("o Jira disse não");
  });

  it("ferramentas bloqueadas e segredos ficam fora da sandbox", async () => {
    const { client, jira } = await connect();
    const r = await client.callTool({ name: "execute", arguments: { code: `return [typeof mcp.jira.deleteIssue, typeof process, typeof fetch, typeof require]` } });
    expect(body(r).value).toEqual(["undefined", "undefined", "undefined", "undefined"]);
    expect(jira.deleted).toEqual([]);
  });

  it("depois de um tempo limite nenhuma chamada nova chega aos servidores", async () => {
    const { client, jira } = await connect();
    const code = `await new Promise(() => {}); await mcp.jira.createVersion({ project: "X", name: "tarde" })`;
    const r = await client.callTool({ name: "execute", arguments: { code } });
    expect(body(r).kind).toBe("timeout");
    expect(jira.versions).toEqual([]);
  }, 20_000);
});
