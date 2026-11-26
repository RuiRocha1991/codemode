import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer, parseMode, type ServerMode } from "../src/server.js";
import { CLASSIC_TOOL_NAMES } from "../src/xray/classic-tools.js";
import { XrayApi } from "../src/xray/api.js";
import { fakeFetch, makeClient } from "./helpers/fake-xray.js";
import { MemoryXray } from "./helpers/memory-xray.js";

async function connect(mode: ServerMode, mem = new MemoryXray()) {
  const fake = fakeFetch(mem.handle);
  const graphql = makeClient(fake.fetch);
  const server = createServer({ env: { name: "local", baseUrl: "http://localhost:3001" }, client: graphql, xray: new XrayApi(graphql, { now: () => new Date("2026-11-26T10:00:00Z") }), mode });
  const client = new Client({ name: "teste", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, mem };
}
type R = Awaited<ReturnType<Client["callTool"]>>;
const body = (r: R) => JSON.parse((r.content as { text: string }[])[0]!.text) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("modos do servidor", () => {
  it("codemode (por omissão): describe, execute, whoami", async () => {
    const { client } = await connect("codemode");
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual(["describe", "execute", "whoami"]);
  });

  it("tools: whoami + as ferramentas clássicas, sem execute", async () => {
    const { client } = await connect("tools");
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual([...CLASSIC_TOOL_NAMES, "whoami"].sort());
  });

  it("both: tudo", async () => {
    const { client } = await connect("both");
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["describe", "execute", "whoami", "createFolder"]));
  });

  it("parseMode", () => {
    expect(parseMode(undefined)).toBe("codemode");
    expect(parseMode(" Tools ")).toBe("tools");
    expect(() => parseMode("tudo")).toThrow(/XRAY_MODE inválido/);
  });
});

describe("ferramentas clássicas", () => {
  it("todas têm esquema JSON válido, descrição e anotações", async () => {
    const { client } = await connect("tools");
    const tools = (await client.listTools()).tools.filter((t) => t.name !== "whoami");
    expect(tools).toHaveLength(CLASSIC_TOOL_NAMES.length);
    for (const t of tools) {
      expect(t.description?.length, t.name).toBeGreaterThan(20);
      expect(t.inputSchema.type, t.name).toBe("object");
      expect(JSON.stringify(t.inputSchema), t.name).not.toContain("undefined");
    }
    const cleanup = tools.find((t) => t.name === "cleanup")!;
    expect(cleanup.annotations?.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === "getTests")!.annotations?.readOnlyHint).toBe(true);
    // Os campos obrigatórios chegam ao esquema (o assistente vê-os).
    expect(tools.find((t) => t.name === "createFolder")!.inputSchema.required).toEqual(expect.arrayContaining(["project", "path"]));
    expect(tools.find((t) => t.name === "createTests")!.inputSchema.required).toEqual(["tests"]);
  });

  it("o fluxo do cenário B com ferramentas clássicas: testes, pastas e Test Plan", async () => {
    const { client, mem } = await connect("tools");
    mem.seedTests("DEMO", 1);
    await client.callTool({ name: "createFolder", arguments: { project: "DEMO", path: "/v1.0" } });
    await client.callTool({ name: "createFolder", arguments: { project: "DEMO", path: "/v1.0/Cucumber" } });
    const created = body(await client.callTool({
      name: "createTests",
      arguments: { tests: [{ type: "Cucumber", project: "DEMO", summary: "C1", gherkin: "Feature: x", folderPath: "/v1.0/Cucumber", fixVersions: ["v1.0"] }] },
    })) as { issueId: string; key: string }[];
    expect(created).toHaveLength(1);
    const plan = body(await client.callTool({
      name: "createTestPlan",
      arguments: { project: "DEMO", summary: "Plano v1.0", fixVersions: ["v1.0"], testIssueIds: [created[0]!.issueId] },
    }));
    expect(plan.key).toMatch(/^DEMO-/);
    const tree = body(await client.callTool({ name: "getFolderTree", arguments: { project: "DEMO" } }));
    expect(tree.folders[0]).toMatchObject({ path: "/v1.0", folders: [{ path: "/v1.0/Cucumber", testsCount: 1 }] });
    const back = body(await client.callTool({ name: "getTestPlanTests", arguments: { issueId: plan.issueId } }));
    expect(back).toMatchObject({ fixVersions: ["v1.0"], totalTests: 1 });
  });

  it("a entrada é validada e o erro diz o que corrigir", async () => {
    const { client } = await connect("tools");
    const bad = await client.callTool({ name: "createTests", arguments: { tests: [{ type: "Cucumber", project: "DEMO", summary: "x" }] } });
    expect(bad.isError).toBe(true);
    const noSchema = await client.callTool({ name: "createFolder", arguments: { project: "DEMO" } });
    expect(noSchema.isError).toBe(true);
  });

  it("os erros da API chegam como isError com a causa", async () => {
    const { client, mem } = await connect("tools");
    mem.seedTests("DEMO", 1);
    const r = await client.callTool({ name: "createFolder", arguments: { project: "DEMO", path: "/A/B" } });
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0]!.text).toContain("parent folder");
  });

  it("cleanup: dryRun conta sem apagar", async () => {
    const { client, mem } = await connect("tools");
    mem.seedTests("DEMO", 2);
    await client.callTool({ name: "createTests", arguments: { tests: [{ type: "Generic", project: "DEMO", summary: "g", definition: "d" }] } });
    const dry = body(await client.callTool({ name: "cleanup", arguments: { project: "DEMO", dryRun: true } }));
    expect(dry).toMatchObject({ dryRun: true, tests: 1 });
    expect(mem.tests.size).toBe(3);
    const real = body(await client.callTool({ name: "cleanup", arguments: { project: "DEMO" } }));
    expect(real.tests).toBe(1);
    expect(mem.tests.size).toBe(2);
  });
});
