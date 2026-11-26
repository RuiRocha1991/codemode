import { describe, expect, it } from "vitest";
import { XrayApi } from "../src/xray/api.js";
import { XrayValidationError } from "../src/xray/schemas.js";
import { fakeFetch, makeClient } from "./helpers/fake-xray.js";
import { MemoryXray } from "./helpers/memory-xray.js";

function setup() {
  const mem = new MemoryXray({ OTHER: "10001" });
  const fake = fakeFetch(mem.handle);
  return { mem, fake, api: new XrayApi(makeClient(fake.fetch)) };
}

describe("xray.getTests", () => {
  it("devolve 200 testes num pedido max: 200, em páginas de 100", async () => {
    const { mem, fake, api } = setup();
    mem.seedTests("DEMO", 250);
    const tests = await api.getTests({ jql: "project = DEMO", max: 200 });
    expect(tests).toHaveLength(200);
    expect(new Set(tests.map((t) => t.issueId)).size).toBe(200);
    const pages = fake.calls.map((c) => c.variables);
    expect(pages).toEqual([
      expect.objectContaining({ jql: "project = DEMO", limit: 100, start: 0 }),
      expect.objectContaining({ limit: 100, start: 100 }),
    ]);
  });

  it("para no fim dos resultados", async () => {
    const { mem, fake, api } = setup();
    mem.seedTests("DEMO", 130);
    const tests = await api.getTests({ jql: "project = DEMO", max: 500 });
    expect(tests).toHaveLength(130);
    expect(fake.calls).toHaveLength(2);
  });

  it("pede só o que falta na última página", async () => {
    const { mem, fake, api } = setup();
    mem.seedTests("DEMO", 300);
    await api.getTests({ jql: "project = DEMO", max: 150 });
    expect(fake.calls.map((c) => c.variables.limit)).toEqual([100, 50]);
  });

  it("devolve testes com key, tipo, projeto e pasta", async () => {
    const { mem, api } = setup();
    mem.seedTests("DEMO", 1, "Cucumber", ["x"]);
    const [t] = await api.getTests({ jql: "project = DEMO" });
    expect(t).toEqual({
      issueId: expect.stringMatching(/^\d+$/),
      key: "DEMO-1",
      summary: "Teste 1",
      testType: "Cucumber",
      projectId: "10000",
      folderPath: "/",
      labels: ["x"],
    });
  });

  it("o max por omissão é 100", async () => {
    const { mem, api } = setup();
    mem.seedTests("DEMO", 120);
    expect(await api.getTests({ jql: "project = DEMO" })).toHaveLength(100);
  });

  it("valida a entrada", async () => {
    const { api } = setup();
    await expect(api.getTests({ jql: "" })).rejects.toThrow(XrayValidationError);
    await expect(api.getTests({ jql: "x", max: 0 })).rejects.toThrow(/max/);
    await expect(api.getTests({ jql: "x", max: 1.5 })).rejects.toThrow(XrayValidationError);
  });
});

describe("resolveProjectId", () => {
  it("aceita o ID numérico sem pedidos", async () => {
    const { fake, api } = setup();
    expect(await api.resolveProjectId("10001")).toBe("10001");
    expect(fake.calls).toHaveLength(0);
  });

  it("resolve a chave pelo primeiro teste e guarda em cache", async () => {
    const { mem, fake, api } = setup();
    mem.seedTests("OTHER", 1);
    expect(await api.resolveProjectId("OTHER")).toBe("10001");
    expect(await api.resolveProjectId("OTHER")).toBe("10001");
    expect(fake.calls).toHaveLength(1);
  });

  it("explica o que fazer num projeto sem testes", async () => {
    const { api } = setup();
    await expect(api.resolveProjectId("OTHER")).rejects.toThrow(/passe o ID numérico/);
  });

  it("recusa chaves que podiam injetar JQL", async () => {
    const { api } = setup();
    await expect(api.resolveProjectId("DEMO OR 1=1")).rejects.toThrow(XrayValidationError);
  });
});

describe("xray.graphql", () => {
  it("passa query e variáveis", async () => {
    const { mem, api } = setup();
    mem.seedTests("DEMO", 3);
    const data = await api.graphql<{ getTests: { total: number } }>({
      query: "query GetTests($jql: String, $limit: Int!) { getTests(jql: $jql, limit: $limit) { total } }",
      variables: { jql: "project = DEMO", limit: 1 },
    });
    expect(data.getTests.total).toBe(3);
  });
});
