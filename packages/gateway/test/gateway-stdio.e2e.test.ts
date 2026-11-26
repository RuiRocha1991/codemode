import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

/** Arranca o gateway REAL (main.ts) por stdio; ele arranca um servidor MCP filho também por stdio. */
function config(extra: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "gw-"));
  const path = join(dir, "gateway.config.json");
  writeFileSync(
    path,
    JSON.stringify({
      servers: {
        fixture: {
          transport: "stdio",
          command: process.execPath,
          args: ["--import", "tsx", "packages/gateway/test/fixtures/fake-stdio-server.ts"],
          env: { TOKEN: "${FIXTURE_TOKEN}" },
        },
        quebrado: { transport: "stdio", command: "/caminho/que/nao/existe" },
        ...extra,
      },
    }),
  );
  return path;
}

describe("gateway por stdio (processo real)", () => {
  it("liga ao servidor filho, resolve ${VAR} e não passa segredos de outros servidores", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "packages/gateway/src/main.ts"],
      env: {
        PATH: process.env.PATH ?? "",
        GATEWAY_CONFIG: config(),
        FIXTURE_TOKEN: "token-do-fixture",
        SEGREDO_DE_OUTRO_SERVIDOR: "nao-pode-chegar-ao-filho",
      },
      stderr: "pipe",
    });
    const client = new Client({ name: "e2e", version: "0.0.0" });
    await client.connect(transport);

    const describeOut = JSON.parse(((await client.callTool({ name: "describe", arguments: {} })).content as { text: string }[])[0]!.text);
    expect(describeOut.servers.find((s: { server: string }) => s.server === "fixture")).toMatchObject({ status: "ok", tools: ["whoami"] });
    // Um servidor que não arranca aparece com erro e não impede o resto.
    expect(describeOut.servers.find((s: { server: string }) => s.server === "quebrado")).toMatchObject({ status: "error" });

    const r = await client.callTool({ name: "execute", arguments: { code: "return await mcp.fixture.whoami()" } });
    const out = JSON.parse((r.content as { text: string }[])[0]!.text) as { value: { token: string; envNames: string[] } };
    expect(out.value.token).toBe("token-do-fixture");
    expect(out.value.envNames).not.toContain("SEGREDO_DE_OUTRO_SERVIDOR");
    expect(out.value.envNames).not.toContain("GATEWAY_CONFIG");
    await client.close();
  }, 60_000);

  it("falta uma variável referenciada: o servidor aparece com erro que diz o NOME da variável", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "packages/gateway/src/main.ts"],
      env: { PATH: process.env.PATH ?? "", GATEWAY_CONFIG: config() }, // sem FIXTURE_TOKEN
      stderr: "pipe",
    });
    const client = new Client({ name: "e2e", version: "0.0.0" });
    await client.connect(transport);
    const out = JSON.parse(((await client.callTool({ name: "describe", arguments: {} })).content as { text: string }[])[0]!.text);
    expect(out.servers.find((s: { server: string }) => s.server === "fixture")).toMatchObject({
      status: "error",
      error: expect.stringContaining("FIXTURE_TOKEN"),
    });
    await client.close();
  }, 60_000);
});
