import { describe, expect, it } from "vitest";
import { flattenFolders, sumTests, XrayApi } from "../src/xray/api.js";
import { XrayGraphQLError } from "../src/xray/graphql.js";
import { XrayValidationError } from "../src/xray/schemas.js";
import { fakeFetch, makeClient } from "./helpers/fake-xray.js";
import { MemoryXray } from "./helpers/memory-xray.js";

function setup() {
  const mem = new MemoryXray();
  const fake = fakeFetch(mem.handle);
  return { mem, fake, api: new XrayApi(makeClient(fake.fetch)) };
}

describe("pastas", () => {
  it("cria pastas aninhadas e a árvore lida de volta confere", async () => {
    const { mem, api } = setup();
    mem.seedTests("DEMO", 6);
    const ids = [...mem.tests.keys()];
    await api.createFolder({ project: "DEMO", path: "/Alfa", testIssueIds: ids.slice(0, 2) });
    await api.createFolder({ project: "DEMO", path: "/Alfa/Beta", testIssueIds: ids.slice(2, 5) });
    await api.createFolder({ project: "DEMO", path: "/Gama" });

    const tree = await api.getFolderTree({ project: "DEMO", path: "/" });
    expect(flattenFolders(tree).map((f) => f.path)).toEqual(["/Alfa", "/Alfa/Beta", "/Gama"]);
    expect(tree.folders.find((f) => f.path === "/Alfa")?.testsCount).toBe(2);
    expect(sumTests(tree)).toBe(5 + 1); // 5 em pastas + 1 que ficou na raiz
  });

  it("createFolder cria e enche numa chamada", async () => {
    const { mem, fake, api } = setup();
    mem.seedTests("DEMO", 3);
    const out = await api.createFolder({ project: "DEMO", path: "A", testIssueIds: [...mem.tests.keys()] });
    expect(out).toEqual({ path: "/A", testsCount: 3 });
    expect(fake.ops()).not.toContain("AddTestsToFolder");
  });

  it("createFolder com mais de 100 testes distribui o resto por lotes", async () => {
    const { mem, api } = setup();
    mem.seedTests("DEMO", 250);
    const out = await api.createFolder({ project: "DEMO", path: "/Grande", testIssueIds: [...mem.tests.keys()] });
    expect(out.testsCount).toBe(250);
    expect(mem.ops.filter((o) => o === "AddTestsToFolder")).toHaveLength(2);
  });

  it("addTestsToFolder distribui testes existentes por lotes de 100", async () => {
    const { mem, api } = setup();
    mem.seedTests("DEMO", 230);
    await api.createFolder({ project: "DEMO", path: "/X" });
    const out = await api.addTestsToFolder({ project: "DEMO", path: "/X", testIssueIds: [...mem.tests.keys()] });
    expect(out.testsCount).toBe(230);
    expect(mem.ops.filter((o) => o === "AddTestsToFolder")).toHaveLength(3);
  });

  it("falha com a mensagem da API se a pasta-mãe não existe", async () => {
    const { mem, api } = setup();
    mem.seedTests("DEMO", 1);
    const err = await api.createFolder({ project: "DEMO", path: "/A/B" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(XrayGraphQLError);
    expect(String(err)).toContain("parent folder");
  });

  it("countTestsInFolder conta a pasta e, se pedido, as subpastas", async () => {
    const { mem, api } = setup();
    mem.seedTests("DEMO", 5);
    const ids = [...mem.tests.keys()];
    await api.createFolder({ project: "DEMO", path: "/A", testIssueIds: ids.slice(0, 2) });
    await api.createFolder({ project: "DEMO", path: "/A/B", testIssueIds: ids.slice(2, 5) });
    expect(await api.countTestsInFolder({ project: "DEMO", path: "/A" })).toBe(2);
    expect(await api.countTestsInFolder({ project: "DEMO", path: "/A", includeDescendants: true })).toBe(5);
  });

  it("valida caminhos e IDs", async () => {
    const { fake, api } = setup();
    await expect(api.createFolder({ project: "DEMO", path: "/" })).rejects.toThrow(XrayValidationError);
    await expect(api.addTestsToFolder({ project: "DEMO", path: "/A", testIssueIds: [] })).rejects.toThrow(XrayValidationError);
    await expect(api.addTestsToFolder({ project: "DEMO", path: "/A", testIssueIds: ["DEMO-1"] })).rejects.toThrow(/issueId é numérico/);
    expect(fake.calls).toHaveLength(0);
  });
});
