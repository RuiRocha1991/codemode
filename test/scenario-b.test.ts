import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { verifyScenarioA } from "../src/scenarios/scenario-a.js";
import { runScenarioB, verifyScenarioB, TEST_TYPES } from "../src/scenarios/scenario-b.js";
import { createServer } from "../src/server.js";
import { XrayApi } from "../src/xray/api.js";
import { fakeFetch, makeClient } from "./helpers/fake-xray.js";
import { MemoryXray } from "./helpers/memory-xray.js";

function setup(seed = 0) {
  const mem = new MemoryXray();
  if (seed) mem.seedTests("DEMO", seed);
  const fake = fakeFetch(mem.handle);
  const graphql = makeClient(fake.fetch);
  return { mem, fake, graphql, api: new XrayApi(graphql) };
}

describe("cenário B (função)", () => {
  it("cria testes, planos e pastas e a verificação passa", async () => {
    const { mem, api } = setup();
    const result = await runScenarioB(api, { project: "DEMO", seed: 1 });
    expect(await verifyScenarioB(api, result, "DEMO")).toEqual({ ok: true, problems: [] });
    // 3 versões × 3 tipos × 4 testes + o teste inicial
    expect(mem.tests.size).toBe(36 + 1);
    expect(mem.plans.size).toBe(3);
    for (const v of result.versions) for (const t of TEST_TYPES) {
      const path = `${result.rootFolder}/${v}/${t}`;
      const inFolder = [...mem.tests.values()].filter((x) => x.folderPath === path);
      expect(inFolder).toHaveLength(4);
      expect(inFolder.every((x) => x.type === t && x.fixVersions.includes(v))).toBe(true);
    }
  });

  it("a verificação apanha um teste na pasta errada", async () => {
    const { mem, api } = setup();
    const result = await runScenarioB(api, { project: "DEMO", seed: 2 });
    const wrong = [...mem.tests.values()].find((t) => t.type === "Cucumber" && t.folderPath.endsWith("/Cucumber"))!;
    wrong.folderPath = `${result.rootFolder}/v1.0/Manual`;
    const v = await verifyScenarioB(api, result, "DEMO");
    expect(v.ok).toBe(false);
    expect(v.problems.join("\n")).toMatch(/Cucumber|Manual/);
  });

  it("a verificação apanha um plano com testes a menos", async () => {
    const { mem, api } = setup();
    const result = await runScenarioB(api, { project: "DEMO", seed: 3 });
    const plan = mem.plans.get(result.plans["v2.0"]!.issueId)!;
    plan.tests.pop();
    const v = await verifyScenarioB(api, result, "DEMO");
    expect(v.ok).toBe(false);
    expect(v.problems[0]).toContain("plano v2.0");
  });
});

/** O que o Claude escreve (examples/*.js) corre numa única chamada execute e passa a verificação. */
describe("exemplos do Claude via execute (XMCM-25)", () => {
  async function connect(mem: MemoryXray, graphql: ReturnType<typeof makeClient>) {
    const server = createServer({ env: { name: "local", baseUrl: "http://localhost:8080" }, client: graphql, xray: new XrayApi(graphql) });
    const client = new Client({ name: "teste", version: "0.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    return client;
  }
  const out = (r: Awaited<ReturnType<Client["callTool"]>>) =>
    JSON.parse((r.content as { text: string }[])[0]!.text) as { value: any; apiCalls: number; error?: string }; // eslint-disable-line @typescript-eslint/no-explicit-any

  it("cenário A: uma chamada execute, 10 pastas e 200 testes", async () => {
    const { mem, graphql, api } = setup(200);
    const client = await connect(mem, graphql);
    const r = await client.callTool({ name: "execute", arguments: { code: readFileSync("examples/cenario-a.js", "utf8") } });
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
    const body = out(r);
    expect(body.value).toMatchObject({ pastas: 10, testes: 200 });
    expect(body.apiCalls).toBeLessThan(40); // vs ~210 chamadas de ferramentas clássicas
    const tree = await api.getFolderTree({ project: "DEMO", path: "/mcp-seed-cenarioA-claude" });
    expect(verifyScenarioA({ rootFolder: "/mcp-seed-cenarioA-claude", folderPaths: [], testsDistributed: 200, perFolder: {}, tree }, { folders: 10, tests: 200 }).ok).toBe(true);
  });

  it("cenário B: uma chamada execute, pastas por versão e tipo e 3 planos", async () => {
    const { mem, graphql } = setup();
    const client = await connect(mem, graphql);
    const r = await client.callTool({ name: "execute", arguments: { code: readFileSync("examples/cenario-b.js", "utf8") } });
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
    const body = out(r);
    expect(body.value.erros).toEqual([]);
    expect(body.value.testes).toBe(36);
    expect(Object.keys(body.value.planos)).toEqual(["v1.0", "v1.1", "v2.0"]);
    expect(mem.plans.size).toBe(3);
    for (const plan of mem.plans.values()) expect(plan.tests).toHaveLength(12);
  });
});
