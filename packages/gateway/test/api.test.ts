import { describe, expect, it } from "vitest";
import { buildGatewayApi, mapToolResult, renderDeclarations, toIdentifier } from "../src/api.js";
import { parseConfig } from "../src/config.js";
import type { ServerConnection } from "../src/connection.js";
import { diagnostics } from "./helpers/compile.js";
import { connectFake, jiraFake, xrayFake, type JiraState, type XrayState } from "./helpers/fake-servers.js";
import { runInSandbox } from "@codemode/core";

const config = (extra: Record<string, unknown> = {}) =>
  parseConfig({
    servers: {
      jira: { transport: "stdio", command: "x", tools: { deny: ["delete*"], ...extra } },
      xray: { transport: "stdio", command: "x" },
    },
  });

async function setup(extra = {}) {
  const jira: JiraState = { versions: [], deleted: [] };
  const xray: XrayState = { plans: [] };
  const conns = [await connectFake("jira", jiraFake(jira)), await connectFake("xray", xrayFake(xray))];
  const api = await buildGatewayApi(conns, config(extra));
  return { api, jira, xray, conns };
}
const run = (api: Awaited<ReturnType<typeof setup>>["api"], code: string) => runInSandbox(code, { apiName: "mcp", functions: api.functions });

describe("buildGatewayApi", () => {
  it("lista os servidores e as ferramentas, escondendo as bloqueadas", async () => {
    const { api } = await setup();
    const jira = api.servers.find((s) => s.name === "jira")!;
    expect(jira.status).toBe("ok");
    expect(jira.tools.map((t) => t.fn).sort()).toEqual(["createVersion", "explode", "getInfo", "getIssue"]);
    expect(jira.hidden).toEqual([{ tool: "deleteIssue", reason: expect.stringContaining("allow/deny") }]);
    expect(api.servers.find((s) => s.name === "xray")!.tools.map((t) => t.fn)).toEqual(["createTestPlan"]);
    expect(Object.keys(api.functions).sort()).toEqual(["jira.createVersion", "jira.explode", "jira.getInfo", "jira.getIssue", "xray.createTestPlan"]);
  });

  it("a ferramenta bloqueada não existe para o código", async () => {
    const { api, jira } = await setup();
    const r = await run(api, `return [typeof mcp.jira.deleteIssue, Object.keys(mcp.jira).sort()]`);
    expect(r).toMatchObject({ ok: true, value: ["undefined", ["createVersion", "explode", "getInfo", "getIssue"]] });
    const call = await run(api, `await mcp.jira.deleteIssue({ key: "DEMO-1" })`);
    expect(call.ok).toBe(false);
    expect(jira.deleted).toEqual([]);
  });

  it("allow limita às ferramentas pedidas", async () => {
    const { api } = await setup({ deny: undefined, allow: ["get*"] });
    expect(api.servers.find((s) => s.name === "jira")!.tools.map((t) => t.fn).sort()).toEqual(["getInfo", "getIssue"]);
  });

  it("as declarações são TypeScript válido, com comentários e etiquetas de segurança", async () => {
    const { api } = await setup({ deny: undefined });
    const decl = renderDeclarations(api);
    expect(diagnostics(decl + "\nexport {};")).toEqual([]);
    expect(decl).toContain("createVersion(input: {");
    expect(decl).toContain("/** Chave do projeto */");
    expect(decl).toContain("[pode apagar ou alterar dados]");
    expect(decl).toContain("[só leitura]");
    expect(decl).toContain("getInfo(): Promise<unknown>;");
    const code = `${decl}\nexport async function main() { await mcp.jira.createVersion({ project: "DEMO", name: "v1" }); }`;
    expect(diagnostics(code)).toEqual([]);
    const bad = `${decl}\nexport async function main() { await mcp.jira.createVersion({ project: 1 }); }`;
    expect(diagnostics(bad).length).toBeGreaterThan(0);
  });

  it("renderDeclarations filtra por servidor", async () => {
    const { api } = await setup();
    const only = renderDeclarations(api, ["xray"]);
    expect(only).toContain("xray: {");
    expect(only).not.toContain("jira: {");
  });

  it("um servidor que não responde aparece com erro e não derruba os outros", async () => {
    const conns = [await connectFake("xray", xrayFake({ plans: [] }))];
    const api = await buildGatewayApi(conns, config(), { jira: "spawn ENOENT" });
    expect(api.servers.find((s) => s.name === "jira")).toMatchObject({ status: "error", error: "spawn ENOENT" });
    expect(api.servers.find((s) => s.name === "xray")?.status).toBe("ok");
    expect(renderDeclarations(api)).not.toContain("jira: {");
  });
});

describe("resultados e erros", () => {
  it("texto JSON, texto simples e saída estruturada", async () => {
    const { api } = await setup();
    const r = await run(api, `return [await mcp.jira.createVersion({ project: "DEMO", name: "v1" }), await mcp.jira.getIssue({ key: "DEMO-1" }), await mcp.jira.getInfo()]`);
    expect(r).toMatchObject({
      ok: true,
      value: [{ id: "1", project: "DEMO", name: "v1" }, "Issue DEMO-1: texto simples, não JSON", { site: "teste", versions: 1 }],
    });
  });

  it("isError lança dentro do código e pode ser apanhado", async () => {
    const { api } = await setup();
    const caught = await run(api, `try { await mcp.jira.explode() } catch (e) { return e.message }`);
    expect(caught).toMatchObject({ ok: true, value: "jira.explode: o Jira disse não" });
    const uncaught = await run(api, `await mcp.jira.explode()`);
    expect(uncaught).toMatchObject({ ok: false, kind: "error" });
    expect((uncaught as { message: string }).message).toContain("o Jira disse não");
  });

  it("o argumento tem de ser um objeto", async () => {
    const { api } = await setup();
    const r = await run(api, `await mcp.jira.getIssue("DEMO-1")`);
    expect(r.ok).toBe(false);
    expect((r as { message: string }).message).toContain("tem de ser um objeto");
  });

  it("argumentos inválidos são recusados pelo servidor de destino", async () => {
    const { api } = await setup();
    const r = await run(api, `return await mcp.jira.createVersion({ project: "DEMO" })`);
    expect(r.ok).toBe(false);
  });

  it("mapToolResult", () => {
    expect(mapToolResult("s", "t", { content: [] })).toBeNull();
    expect(mapToolResult("s", "t", { content: [{ type: "text", text: "[1,2]" }] })).toEqual([1, 2]);
    expect(mapToolResult("s", "t", { content: [{ type: "text", text: "olá" }, { type: "image" }] })).toEqual(["olá", { type: "image" }]);
    expect(() => mapToolResult("s", "t", { isError: true, content: [] })).toThrow("erro sem mensagem");
  });
});

describe("servidores hostis: os nomes e esquemas externos são dados não confiáveis", () => {
  it("nomes perigosos de ferramentas viram identificadores seguros ou ficam de fora", () => {
    const taken = new Set<string>();
    expect(toIdentifier("create-version", taken)).toBe("create_version");
    expect(toIdentifier("create_version", taken)).toBe("create_version_2");
    expect(toIdentifier("9lives", taken)).toBe("_9lives");
    expect(toIdentifier("a.b", taken)).toBe("a_b");
    expect(toIdentifier("__proto__", taken)).toBe("proto"); // inofensivo: não é o __proto__
    expect(toIdentifier("constructor", taken)).toBeUndefined();
    expect(toIdentifier("!!!", taken)).toBeUndefined();
    expect(toIdentifier("", taken)).toBeUndefined();
  });

  it("um servidor com ferramentas maliciosas não consegue injetar código nem partir a API", async () => {
    // Ligação à mão: o SDK nem deixa registar alguns destes nomes, mas um servidor real malicioso pode enviá-los.
    const names = ["__proto__", "constructor", "prototype", "x; process.exit()", "ok-tool"];
    const calls: string[] = [];
    const evil: ServerConnection = {
      name: "evil",
      listTools: async () =>
        names.map((name) => ({
          name,
          description: "fecha */ type Evil = 1; /* abre",
          inputSchema: { type: "object", properties: { "a; b": { type: "string", description: "*/ x" } }, required: ["a; b"] },
        })),
      callTool: async (tool) => {
        calls.push(tool);
        return { content: [{ type: "text", text: "1" }] };
      },
      close: async () => {},
    };
    const api = await buildGatewayApi([evil], parseConfig({ servers: { evil: { transport: "stdio", command: "x" } } }));
    const info = api.servers[0]!;
    expect(info.tools.map((t) => t.fn).sort()).toEqual(["ok_tool", "proto", "x_process_exit"]);
    expect(info.hidden.map((h) => h.tool).sort()).toEqual(["constructor", "prototype"]);
    const decl = renderDeclarations(api);
    expect(diagnostics(decl + "\nexport {};")).toEqual([]);
    expect(decl).not.toMatch(/\*\/ type Evil/);
    const r = await run(api, `return [await mcp.evil.ok_tool({ "a; b": "x" }), Object.getPrototypeOf(mcp) === Object.prototype, typeof mcp.evil.constructor]`);
    expect(r).toMatchObject({ ok: true, value: [1, true, "function"] }); // constructor herdado do Object, não uma ferramenta
    expect(calls).toEqual(["ok-tool"]);
  });
});
