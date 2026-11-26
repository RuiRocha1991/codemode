import { describe, expect, it } from "vitest";
import { CreateTestsError, XrayApi } from "../src/xray/api.js";
import { XrayValidationError } from "../src/xray/schemas.js";
import { fakeFetch, makeClient } from "./helpers/fake-xray.js";
import { MemoryXray } from "./helpers/memory-xray.js";

function setup() {
  const mem = new MemoryXray();
  const fake = fakeFetch(mem.handle);
  return { mem, fake, api: new XrayApi(makeClient(fake.fetch), { now: () => new Date('2026-11-26T10:00:00Z') }) };
}

describe("xray.createTests", () => {
  it("cria um lote misto e devolve issueIds e keys pela ordem da entrada", async () => {
    const { mem, api } = setup();
    const out = await api.createTests([
      { type: "Manual", project: "DEMO", summary: "M1", steps: [{ action: "a", data: "d", result: "r" }] },
      { type: "Cucumber", project: "DEMO", summary: "C1", gherkin: "Feature: x" },
      { type: "Generic", project: "DEMO", summary: "G1", definition: "def" },
    ]);
    expect(out.map((t) => t.type)).toEqual(["Manual", "Cucumber", "Generic"]);
    expect(out.map((t) => t.key)).toEqual(["DEMO-1", "DEMO-2", "DEMO-3"]);
    expect(out.every((t) => /^\d+$/.test(t.issueId))).toBe(true);
    expect([...mem.tests.values()].map((t) => t.type).sort()).toEqual(["Cucumber", "Generic", "Manual"]);
  });

  it("envia os campos certos por tipo, com variáveis", async () => {
    const { fake, api } = setup();
    await api.createTests([
      { type: "Manual", project: "DEMO", summary: "M", steps: [{ action: "a" }], labels: ["l1"], fixVersions: ["v1.0"] },
      { type: "Cucumber", project: "DEMO", summary: "C", gherkin: "Feature: x" },
      { type: "Generic", project: "DEMO", summary: "G", definition: "def" },
    ]);
    const byType = Object.fromEntries(fake.calls.map((c) => [(c.variables.testType as { name: string }).name, c.variables]));
    expect(byType.Manual).toMatchObject({
      steps: [{ action: "a" }],
      jira: { fields: { summary: "M", project: { key: "DEMO" }, labels: ["l1", "mcp-seed-2026-11-26"], fixVersions: [{ name: "v1.0" }] } },
    });
    expect(byType.Cucumber).toMatchObject({ gherkin: "Feature: x" });
    expect(byType.Generic).toMatchObject({ unstructured: "def" });
    expect(fake.calls.every((c) => !c.query.includes("Feature"))).toBe(true);
  });

  it("cria na pasta indicada", async () => {
    const { mem, api } = setup();
    mem.folders.get("10000")!.add("/v1.0");
    const [t] = await api.createTests([{ type: "Generic", project: "DEMO", summary: "G", definition: "d", folderPath: "v1.0/" }]);
    expect(mem.folderOfTest(t!.issueId)).toBe("/v1.0");
  });

  it("cria 500 testes respeitando a concorrência de 5", async () => {
    const { mem, fake, api } = setup();
    const out = await api.createTests(
      Array.from({ length: 500 }, (_, i) => ({ type: "Generic" as const, project: "DEMO", summary: `T${i}`, definition: "d" })),
    );
    expect(out).toHaveLength(500);
    expect(mem.tests.size).toBe(500);
    expect(fake.calls).toHaveLength(500);
  });

  it("devolve criados e falhados quando parte do lote falha", async () => {
    const { api } = setup();
    const err = await api
      .createTests([
        { type: "Generic", project: "DEMO", summary: "bom", definition: "d" },
        { type: "Generic", project: "DEMO", summary: "mau", definition: "d", folderPath: "/nao-existe" },
      ])
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CreateTestsError);
    const e = err as CreateTestsError;
    expect(e.created).toHaveLength(1);
    expect(e.failed).toEqual([expect.objectContaining({ index: 1, summary: "mau" })]);
    expect(e.message).toContain("1 de 2 falharam");
  });

  it("valida a entrada antes de chamar a API", async () => {
    const { fake, api } = setup();
    await expect(api.createTests([])).rejects.toThrow(XrayValidationError);
    await expect(api.createTests([{ type: "Cucumber", project: "DEMO", summary: "x" } as never])).rejects.toThrow(/gherkin/);
    await expect(api.createTests([{ type: "Outro", project: "DEMO", summary: "x" } as never])).rejects.toThrow(XrayValidationError);
    await expect(api.createTests([{ type: "Generic", project: "10000", summary: "x", definition: "d" }])).rejects.toThrow(/chave/);
    expect(fake.calls).toHaveLength(0);
  });
});

describe("etiqueta automática", () => {
  it("tudo o que se cria leva mcp-seed-<data>", async () => {
    const { mem, api } = setup();
    const out = await api.createTests([{ type: "Generic", project: "DEMO", summary: "G", definition: "d" }]);
    expect(mem.tests.get(out[0]!.issueId)?.labels).toEqual(["mcp-seed-2026-11-26"]);
    expect(api.seedLabel).toBe("mcp-seed-2026-11-26");
  });

  it("não duplica se já foi pedida", async () => {
    const { mem, api } = setup();
    const out = await api.createTests([{ type: "Generic", project: "DEMO", summary: "G", definition: "d", labels: ["mcp-seed-2026-11-26", "x"] }]);
    expect(mem.tests.get(out[0]!.issueId)?.labels).toEqual(["mcp-seed-2026-11-26", "x"]);
  });
});
