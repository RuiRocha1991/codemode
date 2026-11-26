import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * Arranca o servidor real (src/index.ts) por stdio, como o Claude Code faz,
 * contra um Xray falso em HTTP local. Não sai da máquina.
 */
let http: Server;
let baseUrl: string;
const seen: { auth: number; graphql: number; authorization?: string } = { auth: 0, graphql: 0 };

beforeAll(async () => {
  http = createHttpServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      if (req.url === "/api/v2/authenticate") {
        seen.auth++;
        const creds = JSON.parse(body) as { client_id: string; client_secret: string };
        const ok = creds.client_id === "e2e-id" && creds.client_secret === "e2e-secret";
        res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
        res.end(ok ? JSON.stringify("e2e-token") : "{}");
        return;
      }
      if (req.url === "/api/v2/graphql") {
        seen.graphql++;
        seen.authorization = req.headers.authorization;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: { __typename: "Query" } }));
        return;
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => http.close(() => r())));

function spawnClient(env: Record<string, string>) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/index.ts"],
    env: { PATH: process.env.PATH ?? "", ...env },
    stderr: "pipe",
  });
  const client = new Client({ name: "e2e", version: "0.0.0" });
  return { transport, client };
}

describe("servidor por stdio", () => {
  it("o whoami em xray-local devolve o ambiente com autenticação válida", async () => {
    const { transport, client } = spawnClient({
      XRAY_ENV: "local",
      XRAY_BASE_URL: baseUrl,
      XRAY_LOCAL_CLIENT_ID: "e2e-id",
      XRAY_LOCAL_CLIENT_SECRET: "e2e-secret",
    });
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("whoami");
    const result = await client.callTool({ name: "whoami", arguments: {} });
    const content = result.content as { text: string }[];
    expect(JSON.parse(content[0]!.text)).toMatchObject({ environment: "local", authenticated: true });
    expect(seen.authorization).toBe("Bearer e2e-token");
    await client.close();
  }, 20_000);

  it("não arranca num ambiente de produção", async () => {
    const { transport, client } = spawnClient({
      XRAY_ENV: "prod-us",
      XRAY_CLIENT_ID: "x",
      XRAY_CLIENT_SECRET: "y",
    });
    let stderr = "";
    transport.stderr?.on("data", (c: Buffer) => (stderr += c.toString()));
    await expect(client.connect(transport)).rejects.toThrow();
    expect(stderr).toMatch(/produção/);
  }, 20_000);
});
