import { describe, expect, it } from "vitest";
import { XrayApi } from "../src/xray/api.js";
import { runScenarioA, verifyScenarioA } from "../src/scenarios/scenario-a.js";
import { fakeFetch, makeClient } from "./helpers/fake-xray.js";
import { MemoryXray } from "./helpers/memory-xray.js";

function setup(tests = 200) {
  const mem = new MemoryXray();
  mem.seedTests("DEMO", tests);
  const fake = fakeFetch(mem.handle);
  return { mem, api: new XrayApi(makeClient(fake.fetch)) };
}

describe("cenário A", () => {
  it("cria 10 pastas com vários níveis e distribui 200 testes; a verificação passa", async () => {
    const { mem, api } = setup();
    const result = await runScenarioA(api, { project: "DEMO", seed: 42 });
    expect(result.folderPaths).toHaveLength(10);
    expect(new Set(result.folderPaths.map((p) => p.split("/").pop())).size).toBe(10);
    expect(verifyScenarioA(result, { folders: 10, tests: 200 })).toEqual({ ok: true, problems: [] });
    // Confirmado no "servidor": 200 testes dentro das pastas do cenário, nenhum na raiz.
    const inFolders = [...mem.tests.values()].filter((t) => t.folderPath.startsWith(result.rootFolder + "/"));
    expect(inFolders).toHaveLength(200);
  });

  it("é repetível com a mesma seed e diferente com outra", async () => {
    const a = await runScenarioA(setup().api, { project: "DEMO", seed: 7 });
    const b = await runScenarioA(setup().api, { project: "DEMO", seed: 7 });
    const c = await runScenarioA(setup().api, { project: "DEMO", seed: 8 });
    expect(a.folderPaths).toEqual(b.folderPaths);
    expect(a.folderPaths).not.toEqual(c.folderPaths);
  });

  it("tem vários níveis em várias seeds", async () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = await runScenarioA(setup().api, { project: "DEMO", seed });
      expect(verifyScenarioA(r, { folders: 10, tests: 200 }).ok).toBe(true);
    }
  });

  it("a verificação aponta testes em falta", async () => {
    const { api } = setup();
    const result = await runScenarioA(api, { project: "DEMO", seed: 3 });
    const bad = verifyScenarioA(result, { folders: 10, tests: 201 });
    expect(bad.ok).toBe(false);
    expect(bad.problems[0]).toContain("201");
  });

  it("explica quando o projeto não tem testes suficientes", async () => {
    const { api } = setup(50);
    await expect(runScenarioA(api, { project: "DEMO" })).rejects.toThrow(/tem só 50 testes/);
  });

  it("500 testes (10× a carga) também funciona", async () => {
    const { api } = setup(500);
    const r = await runScenarioA(api, { project: "DEMO", tests: 500, seed: 9 });
    expect(verifyScenarioA(r, { folders: 10, tests: 500 }).ok).toBe(true);
  });
});
