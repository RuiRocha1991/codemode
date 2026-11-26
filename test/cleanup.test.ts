import { describe, expect, it } from "vitest";
import { topMostFolders, XrayApi } from "../src/xray/api.js";
import { runScenarioA } from "../src/scenarios/scenario-a.js";
import { runScenarioB } from "../src/scenarios/scenario-b.js";
import { XrayValidationError } from "../src/xray/schemas.js";
import { fakeFetch, makeClient } from "./helpers/fake-xray.js";
import { MemoryXray } from "./helpers/memory-xray.js";

const DAY = "2026-11-26";
function setup(seed = 0) {
  const mem = new MemoryXray();
  if (seed) mem.seedTests("DEMO", seed);
  const fake = fakeFetch(mem.handle);
  const api = new XrayApi(makeClient(fake.fetch), { now: () => new Date(`${DAY}T10:00:00Z`) });
  return { mem, fake, api };
}

/** Estado observável do "servidor", para comparar antes e depois. */
const snapshot = (mem: MemoryXray) => ({
  tests: [...mem.tests.values()].map((t) => `${t.key}|${t.folderPath}`).sort(),
  plans: [...mem.plans.keys()].sort(),
  folders: [...(mem.folders.get("10000") ?? [])].sort(),
});

describe("limpeza por etiqueta", () => {
  it("correr o cenário A e depois a limpeza deixa o projeto como estava", async () => {
    const { mem, api } = setup(200);
    const before = snapshot(mem);
    const result = await runScenarioA(api, { project: "DEMO", seed: 5 });
    expect(snapshot(mem)).not.toEqual(before);
    const out = await api.cleanup({ project: "DEMO" });
    expect(out.folders).toEqual([result.rootFolder]);
    // Os 200 testes pré-existentes não têm a etiqueta, por isso ficam; as pastas desaparecem.
    expect(snapshot(mem)).toEqual(before);
  });

  it("apaga os testes, planos e pastas do cenário B", async () => {
    const { mem, api } = setup(3);
    const before = snapshot(mem);
    await runScenarioB(api, { project: "DEMO", seed: 6 });
    expect(mem.plans.size).toBe(3);
    const out = await api.cleanup({ project: "DEMO" });
    expect(out).toMatchObject({ label: `mcp-seed-${DAY}`, tests: 36, testPlans: 3, dryRun: false });
    expect(snapshot(mem)).toEqual(before);
  });

  it("dryRun conta sem apagar", async () => {
    const { mem, api } = setup(3);
    await runScenarioB(api, { project: "DEMO", seed: 7 });
    const sizes = { tests: mem.tests.size, plans: mem.plans.size };
    const out = await api.cleanup({ project: "DEMO", dryRun: true });
    expect(out).toMatchObject({ dryRun: true, tests: 36, testPlans: 3 });
    expect({ tests: mem.tests.size, plans: mem.plans.size }).toEqual(sizes);
  });

  it("só apaga o que tem a etiqueta pedida", async () => {
    const { mem, api } = setup(5);
    const [a] = await api.createTests([{ type: "Generic", project: "DEMO", summary: "novo", definition: "d" }]);
    await api.createTests([{ type: "Generic", project: "DEMO", summary: "de outro dia", definition: "d", labels: ["mcp-seed-2026-01-01"] }]);
    const out = await api.cleanup({ project: "DEMO", label: "mcp-seed-2026-01-01" });
    expect(out.tests).toBe(1);
    expect(mem.tests.has(a!.issueId)).toBe(true);
    expect(mem.tests.size).toBe(5 + 1); // 5 originais + o de hoje
  });

  it("apaga pastas na raiz com o prefixo mcp-seed mesmo depois de reiniciar o servidor", async () => {
    const { mem, api } = setup(5);
    await api.createFolder({ project: "DEMO", path: "/mcp-seed-antigo" });
    await api.createFolder({ project: "DEMO", path: "/minha-pasta" });
    const reiniciado = new XrayApi(makeClient(fakeFetch(mem.handle).fetch), { now: () => new Date(`${DAY}T10:00:00Z`) });
    const out = await reiniciado.cleanup({ project: "DEMO" });
    expect(out.folders).toEqual(["/mcp-seed-antigo"]);
    expect(mem.folders.get("10000")!.has("/minha-pasta")).toBe(true);
  });

  it("recusa etiquetas que não são mcp-seed- e a raiz", async () => {
    const { fake, api } = setup(1);
    await expect(api.cleanup({ project: "DEMO", label: "importante" })).rejects.toThrow(XrayValidationError);
    await expect(api.cleanup({ project: "DEMO", label: "mcp-seed-x OR project = DEMO" })).rejects.toThrow(XrayValidationError);
    await expect(api.cleanup({ project: "DEMO", folders: ["/"] })).rejects.toThrow(/raiz/);
    expect(fake.calls).toHaveLength(0);
  });

  it("uma pasta e as suas filhas contam como uma só", () => {
    expect(topMostFolders(["/a/b", "/a", "/a/b/c", "/x", "/ab"])).toEqual(["/a", "/ab", "/x"]);
  });

  it("não falha num projeto sem nada para limpar", async () => {
    const { api } = setup(1);
    expect(await api.cleanup({ project: "DEMO" })).toMatchObject({ tests: 0, testPlans: 0, folders: [] });
  });
});
