import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryXray } from "./helpers/memory-xray.js";

const run = promisify(execFile);

/** Um Xray falso em HTTP (apoiado no MemoryXray) para correr os scripts reais contra ele. */
let http: Server;
let baseUrl: string;
let mem: MemoryXray;

beforeAll(async () => {
  mem = new MemoryXray();
  http = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/v2/authenticate") return void res.end('"tok"');
      if (req.url === "/api/v2/graphql") {
        const { query, variables } = JSON.parse(body) as { query: string; variables: Record<string, unknown> };
        const out = mem.handle({ query, variables, token: req.headers.authorization?.slice(7) });
        if (out instanceof Response) {
          void out.text().then((t) => res.end(t));
          return;
        }
        return void res.end(JSON.stringify({ data: out }));
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => http.close(() => r())));

const env = () => ({
  PATH: process.env.PATH ?? "",
  XRAY_ENV: "local",
  XRAY_BASE_URL: baseUrl,
  XRAY_LOCAL_CLIENT_ID: "id",
  XRAY_LOCAL_CLIENT_SECRET: "secret",
});

describe("scripts reais contra um Xray falso em HTTP", () => {
  it("npm run integration corre A e B, limpa e deixa o projeto como estava", async () => {
    mem.seedTests("DEMO", 50); // menos de 200: o script cria os que faltam
    const { stdout } = await run(process.execPath, ["--import", "tsx", "scripts/integration.ts", "--project", "DEMO"], { env: env(), timeout: 60_000 });
    expect(stdout).toContain("✓ Cenário A: 10 pastas, 200 testes");
    expect(stdout).toContain("✓ Cenário B");
    expect(stdout).toContain("✓ Limpeza: o projeto ficou com o mesmo número de testes — 50 → 50");
    expect(stdout).toContain("✓ Integração passou");
    expect(mem.tests.size).toBe(50);
    expect(mem.plans.size).toBe(0);
    expect([...mem.folders.get("10000")!]).toEqual(["/"]);
  }, 90_000);

  it("recusa correr em produção", async () => {
    const e = { ...env(), XRAY_ENV: "prod-us" };
    await expect(run(process.execPath, ["--import", "tsx", "scripts/integration.ts", "--project", "DEMO"], { env: e })).rejects.toMatchObject({
      stderr: expect.stringContaining("produção"),
    });
  });

  it("scenario:a e scenario:b individuais", async () => {
    mem.seedTests("DEMO", 200);
    const a = await run(process.execPath, ["--import", "tsx", "scripts/scenario-a.ts", "--project", "DEMO", "--seed", "1"], { env: env() });
    expect(a.stdout).toContain("✓ Verificação passou");
    const b = await run(process.execPath, ["--import", "tsx", "scripts/scenario-b.ts", "--project", "DEMO", "--seed", "1"], { env: env() });
    expect(b.stdout).toContain("✓ Verificação passou");
  }, 90_000);
});
