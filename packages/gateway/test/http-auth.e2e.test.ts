import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { buildHttpHeaders, parseConfig } from "../src/config.js";
import { connectServer } from "../src/connection.js";

/** Servidor MCP HTTP real (stateless) que só aceita o Authorization esperado. */
let http: Server;
let url: string;
const seen: (string | undefined)[] = [];
const EXPECTED = `Bearer segredo-123`;
const BASIC = `Basic ${Buffer.from("ana@x.pt:tok-api").toString("base64")}`;

beforeAll(async () => {
  http = createServer(async (req, res) => {
    seen.push(req.headers.authorization);
    const auth = req.headers.authorization;
    if (auth !== EXPECTED && auth !== BASIC) {
      // Corpo opaco de propósito: a deteção tem de usar o estado HTTP, não o texto.
      res.writeHead(401, { "content-type": "application/json" }).end("{}");
      return;
    }
    const server = new McpServer({ name: "http-fake", version: "0.0.0" });
    server.registerTool("ping", { description: "Responde pong", inputSchema: { n: z.number() } }, ({ n }) => ({
      content: [{ type: "text", text: JSON.stringify({ pong: n }) }],
    }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => void transport.close());
    await server.connect(transport);
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    await transport.handleRequest(req, res, chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined);
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
});
afterAll(() => new Promise<void>((r) => http.close(() => r())));

const cfg = (extra: Record<string, unknown>) => parseConfig({ servers: { jira: { transport: "http", url, ...extra } } }).servers.jira!;

describe("autenticação por servidor HTTP", () => {
  it("bearer: o token vem do ambiente e chega ao servidor", async () => {
    const conn = await connectServer("jira", cfg({ auth: { type: "bearer", token: "${JIRA_TOKEN}" } }), { JIRA_TOKEN: "segredo-123" });
    expect((await conn.listTools()).map((t) => t.name)).toEqual(["ping"]);
    const r = await conn.callTool("ping", { n: 7 });
    expect(r.content?.[0]?.text).toBe('{"pong":7}');
    expect(seen.at(-1)).toBe(EXPECTED);
    await conn.close();
  });

  it("basic: utilizador + token de API", async () => {
    const conn = await connectServer("jira", cfg({ auth: { type: "basic", username: "${U}", password: "${T}" } }), { U: "ana@x.pt", T: "tok-api" });
    expect((await conn.listTools()).length).toBe(1);
    await conn.close();
  });

  it("token errado: erro claro, sem revelar o token", async () => {
    const err = await connectServer("jira", cfg({ auth: { type: "bearer", token: "${T}" } }), { T: "errado-999" }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/recusou as credenciais/);
    expect((err as Error).message).toMatch(/OAuth não é suportado/);
    expect((err as Error).message).not.toContain("errado-999");
  });

  it("sem credenciais: também é explicado", async () => {
    const err = await connectServer("jira", cfg({}), {}).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/recusou as credenciais/);
  });

  it("variável em falta: diz o NOME, não liga", async () => {
    const err = await connectServer("jira", cfg({ auth: { type: "bearer", token: "${NAO_DEFINIDA}" } }), {}).catch((e: Error) => e);
    expect((err as Error).message).toContain("NAO_DEFINIDA");
  });
});

describe("config de auth", () => {
  it("auth e Authorization em headers são mutuamente exclusivos (qualquer capitalização)", () => {
    expect(() => parseConfig({ servers: { a: { transport: "http", url: "http://x.test", auth: { type: "bearer", token: "t" }, headers: { authorization: "Bearer y" } } } })).toThrow(/auth/);
  });
  it("tipo desconhecido é rejeitado", () => {
    expect(() => parseConfig({ servers: { a: { transport: "http", url: "http://x.test", auth: { type: "oauth" } } } })).toThrow();
  });
  it("headers sem auth continuam a funcionar e auth não altera os outros cabeçalhos", () => {
    const c = cfg({ headers: { "X-Org": "${ORG}" }, auth: { type: "bearer", token: "t" } });
    expect(buildHttpHeaders(c as never, { ORG: "acme" }, "jira")).toEqual({ "X-Org": "acme", Authorization: "Bearer t" });
  });
});
