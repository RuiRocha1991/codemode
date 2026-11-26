import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { MemoryXray } from "./helpers/memory-xray.js";

/**
 * Ponta a ponta com processos reais:
 *   cliente MCP (stdio) → gateway (main.ts)
 *        ├─ Jira falso: servidor MCP por HTTP, exige "Authorization: Bearer <token>"
 *        └─ Xray: o nosso servidor (src/index.ts, XRAY_MODE=tools) por stdio → Xray falso em HTTP
 * Nada sai da máquina. Prova a integração; NÃO prova o Jira nem o Xray reais.
 */
const JIRA_TOKEN = "jira-token-e2e";
let xrayHttp: Server;
let jiraHttp: Server;
let xrayUrl: string;
let jiraUrl: string;
const mem = new MemoryXray({ DEMO: "10000" });
const jiraVersions: { project: string; name: string }[] = [];
const jiraAuth: (string | undefined)[] = [];

const readBody = async (req: import("node:http").IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString();
};

beforeAll(async () => {
  mem.seedTests("DEMO", 1); // o Xray precisa de um teste para conhecer o projeto
  xrayHttp = createServer(async (req, res) => {
    const body = await readBody(req);
    if (req.url === "/api/v2/authenticate") return void res.writeHead(200).end(JSON.stringify("tok-e2e"));
    if (req.url === "/api/v2/graphql") {
      const { query, variables } = JSON.parse(body) as { query: string; variables: Record<string, unknown> };
      const out = mem.handle({ query, variables, token: "tok-e2e" });
      if (out instanceof Response) return void res.writeHead(200, { "content-type": "application/json" }).end(await out.text());
      return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: out }));
    }
    res.writeHead(404).end();
  });
  jiraHttp = createServer(async (req, res) => {
    jiraAuth.push(req.headers.authorization);
    if (req.headers.authorization !== `Bearer ${JIRA_TOKEN}`) return void res.writeHead(401).end("{}");
    const server = new McpServer({ name: "jira-fake", version: "0.0.0" });
    server.registerTool(
      "createVersion",
      { description: "Cria uma versão (fixVersion) num projeto Jira", inputSchema: { project: z.string(), name: z.string() } },
      ({ project, name }) => {
        jiraVersions.push({ project, name });
        return { content: [{ type: "text", text: JSON.stringify({ id: String(jiraVersions.length), project, name }) }] };
      },
    );
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => void transport.close());
    await server.connect(transport);
    const body = await readBody(req);
    await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
  });
  await Promise.all([
    new Promise<void>((r) => xrayHttp.listen(0, "127.0.0.1", r)),
    new Promise<void>((r) => jiraHttp.listen(0, "127.0.0.1", r)),
  ]);
  xrayUrl = `http://127.0.0.1:${(xrayHttp.address() as AddressInfo).port}`;
  jiraUrl = `http://127.0.0.1:${(jiraHttp.address() as AddressInfo).port}/mcp`;
});
afterAll(async () => {
  await Promise.all([xrayHttp, jiraHttp].map((s) => new Promise<void>((r) => { s.close(() => r()); s.closeAllConnections(); })));
});

function gatewayConfig(jiraAuthConfig: Record<string, unknown>) {
  const path = join(mkdtempSync(join(tmpdir(), "gw-jx-")), "gateway.config.json");
  writeFileSync(
    path,
    JSON.stringify({
      servers: {
        xray: {
          transport: "stdio",
          command: process.execPath,
          args: ["--import", "tsx", "src/index.ts"],
          env: {
            XRAY_ENV: "local",
            XRAY_MODE: "tools",
            XRAY_BASE_URL: "${XRAY_TEST_URL}",
            XRAY_LOCAL_CLIENT_ID: "${XRAY_LOCAL_CLIENT_ID}",
            XRAY_LOCAL_CLIENT_SECRET: "${XRAY_LOCAL_CLIENT_SECRET}",
          },
        },
        jira: { transport: "http", url: jiraUrl, ...jiraAuthConfig },
      },
    }),
  );
  return path;
}

async function startGateway(jiraAuthConfig: Record<string, unknown>, env: Record<string, string> = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "packages/gateway/src/main.ts"],
    env: {
      PATH: process.env.PATH ?? "",
      GATEWAY_CONFIG: gatewayConfig(jiraAuthConfig),
      XRAY_TEST_URL: xrayUrl,
      XRAY_LOCAL_CLIENT_ID: "id",
      XRAY_LOCAL_CLIENT_SECRET: "secret",
      ...env,
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "e2e", version: "0.0.0" });
  await client.connect(transport);
  return client;
}
const text = (r: unknown) => (r as { content: { text: string }[] }).content[0]!.text;

describe("gateway: Jira (HTTP + bearer) + Xray (stdio, ferramentas clássicas)", () => {
  it("o exemplo examples/gateway-jira-xray.js corre numa única chamada execute", async () => {
    const client = await startGateway({ auth: { type: "bearer", token: "${JIRA_TOKEN}" } }, { JIRA_TOKEN });
    const desc = JSON.parse(text(await client.callTool({ name: "describe", arguments: {} })));
    expect(desc.servers.map((s: { server: string; status: string }) => `${s.server}:${s.status}`).sort()).toEqual(["jira:ok", "xray:ok"]);
    expect(desc.declarations).toContain("createVersion");
    expect(desc.declarations).toContain("createTestPlan");

    const code = readFileSync("examples/gateway-jira-xray.js", "utf8");
    const r = await client.callTool({ name: "execute", arguments: { code } });
    expect(r.isError, text(r)).toBeFalsy();
    const out = JSON.parse(text(r)) as { value: Record<string, { plano: string; testes: string[] }> };
    expect(Object.keys(out.value)).toEqual(["v1.0", "v1.1"]);
    for (const v of ["v1.0", "v1.1"]) {
      expect(out.value[v]!.testes).toHaveLength(3);
      expect(out.value[v]!.plano).toMatch(/^DEMO-/);
    }
    // Jira: as duas versões foram criadas, e só com o token certo.
    expect(jiraVersions).toEqual([{ project: "DEMO", name: "v1.0" }, { project: "DEMO", name: "v1.1" }]);
    expect(jiraAuth.every((a) => a === `Bearer ${JIRA_TOKEN}`)).toBe(true);
    // Xray: os Test Plans têm a fixVersion e as pastas existem.
    expect(mem.tests.size).toBeGreaterThanOrEqual(7); // 1 inicial + 6 criados
    expect(mem.ops).toEqual(expect.arrayContaining(["CreateTestPlan", "CreateFolder", "CreateTest"]));
    await client.close();
  }, 90_000);

  it("token do Jira errado: o Jira aparece com erro, o Xray continua a funcionar", async () => {
    const client = await startGateway({ auth: { type: "bearer", token: "${JIRA_TOKEN}" } }, { JIRA_TOKEN: "errado" });
    const desc = JSON.parse(text(await client.callTool({ name: "describe", arguments: {} })));
    expect(desc.servers.find((s: { server: string }) => s.server === "jira")).toMatchObject({ status: "error", error: expect.stringContaining("credenciais") });
    expect(desc.servers.find((s: { server: string }) => s.server === "xray")).toMatchObject({ status: "ok" });
    expect(JSON.stringify(desc)).not.toContain('"errado"');
    const r = await client.callTool({ name: "execute", arguments: { code: "return (await mcp.xray.getTests({ jql: 'project = DEMO', max: 1 })).length" } });
    expect(JSON.parse(text(r)).value).toBeGreaterThanOrEqual(1);
    await client.close();
  }, 90_000);
});
