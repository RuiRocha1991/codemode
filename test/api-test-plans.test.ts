import { describe, expect, it } from "vitest";
import { XrayApi } from "../src/xray/api.js";
import { XrayValidationError } from "../src/xray/schemas.js";
import { fakeFetch, makeClient } from "./helpers/fake-xray.js";
import { MemoryXray } from "./helpers/memory-xray.js";

function setup() {
  const mem = new MemoryXray();
  const fake = fakeFetch(mem.handle);
  return { mem, fake, api: new XrayApi(makeClient(fake.fetch), { now: () => new Date('2026-11-26T10:00:00Z') }) };
}

describe("Test Plans", () => {
  it("cria um plano com versão e testes e lê-o de volta", async () => {
    const { mem, api } = setup();
    mem.seedTests("DEMO", 5);
    const ids = [...mem.tests.keys()];
    const plan = await api.createTestPlan({ project: "DEMO", summary: "Plano v1.0", fixVersions: ["v1.0"], testIssueIds: ids.slice(0, 3) });
    expect(plan.key).toMatch(/^DEMO-\d+$/);
    const back = await api.getTestPlanTests({ issueId: plan.issueId });
    expect(back).toMatchObject({ summary: "Plano v1.0", fixVersions: ["v1.0"], totalTests: 3 });
    expect(back.tests.map((t) => t.issueId).sort()).toEqual(ids.slice(0, 3).sort());
  });

  it("a versão vai em fixVersions no campo jira", async () => {
    const { fake, api } = setup();
    await api.createTestPlan({ project: "DEMO", summary: "P", fixVersions: ["v2.0"], labels: ["l"] });
    expect(fake.calls[0]?.variables.jira).toEqual({
      fields: { summary: "P", project: { key: "DEMO" }, labels: ["l", "mcp-seed-2026-11-26"], fixVersions: [{ name: "v2.0" }] },
    });
  });

  it("addTestsToTestPlan acrescenta por lotes de 100 e não duplica", async () => {
    const { mem, api } = setup();
    mem.seedTests("DEMO", 230);
    const ids = [...mem.tests.keys()];
    const plan = await api.createTestPlan({ project: "DEMO", summary: "P" });
    const first = await api.addTestsToTestPlan({ issueId: plan.issueId, testIssueIds: ids });
    expect(first.added).toHaveLength(230);
    expect(mem.ops.filter((o) => o === "AddTestsToTestPlan")).toHaveLength(3);
    const again = await api.addTestsToTestPlan({ issueId: plan.issueId, testIssueIds: ids.slice(0, 10) });
    expect(again.added).toHaveLength(0);
  });

  it("getTestPlanTests pagina e respeita max", async () => {
    const { mem, api } = setup();
    mem.seedTests("DEMO", 250);
    const plan = await api.createTestPlan({ project: "DEMO", summary: "P" });
    await api.addTestsToTestPlan({ issueId: plan.issueId, testIssueIds: [...mem.tests.keys()] });
    const all = await api.getTestPlanTests({ issueId: plan.issueId, max: 1000 });
    expect(all.tests).toHaveLength(250);
    const some = await api.getTestPlanTests({ issueId: plan.issueId, max: 120 });
    expect(some.tests).toHaveLength(120);
    expect(some.totalTests).toBe(250);
  });

  it("explica quando o plano não existe", async () => {
    const { api } = setup();
    await expect(api.getTestPlanTests({ issueId: "999" })).rejects.toThrow(/não existe/);
  });

  it("valida a entrada", async () => {
    const { fake, api } = setup();
    await expect(api.createTestPlan({ project: "10000", summary: "x" })).rejects.toThrow(/chave/);
    await expect(api.createTestPlan({ project: "DEMO", summary: "" })).rejects.toThrow(XrayValidationError);
    await expect(api.addTestsToTestPlan({ issueId: "DEMO-1", testIssueIds: ["1"] })).rejects.toThrow(/numérico/);
    expect(fake.calls).toHaveLength(0);
  });
});
