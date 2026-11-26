import { describe, expect, it } from "vitest";
import { CodeMode } from "../src/codemode.js";
import { runInSandbox, type ApiFunctions } from "../src/sandbox.js";

// Uma API de exemplo, sem nada do Xray: prova que o módulo é genérico.
const calc: ApiFunctions = {
  add: (arg) => { const { a, b } = arg as { a: number; b: number }; return a + b; },
  sleep: (arg) => { const { ms } = arg as { ms: number }; return new Promise((r) => setTimeout(() => r(ms), ms)); },
  fail: () => Promise.reject(new Error("a API disse não")),
  nothing: () => undefined,
  big: (arg) => "x".repeat((arg as { n: number }).n),
};
const run = (code: string, extra = {}) => runInSandbox(code, { apiName: "calc", functions: calc, ...extra });

describe("módulo Code Mode genérico", () => {
  it("corre código contra um objeto de API qualquer", async () => {
    const r = await run("const x = await calc.add({a:2,b:3}); return {x}");
    expect(r).toMatchObject({ ok: true, value: { x: 5 }, apiCalls: 1 });
  });

  it("suporta chamadas em paralelo", async () => {
    const t = Date.now();
    const r = await run("const r = await Promise.all(Array.from({length:50},()=>calc.sleep({ms:100}))); return r.length");
    expect(r).toMatchObject({ ok: true, value: 50, apiCalls: 50 });
    expect(Date.now() - t).toBeLessThan(1500); // se fosse em série seriam 5 s
  });

  it("devolve undefined, null, arrays e objetos", async () => {
    expect(await run("return")).toMatchObject({ ok: true, value: undefined });
    expect(await run("return null")).toMatchObject({ ok: true, value: null });
    expect(await run("return await calc.nothing()")).toMatchObject({ ok: true, value: undefined });
    expect(await run("return [1,{a:[2]}]")).toMatchObject({ ok: true, value: [1, { a: [2] }] });
  });

  it("captura console.log", async () => {
    const r = await run("console.log('olá', {a:1}); console.warn('aviso'); return 1");
    expect(r.logs).toEqual(["olá {\"a\":1}", "aviso"]);
  });

  it("devolve erros legíveis ao código e à saída", async () => {
    const caught = await run("try { await calc.fail() } catch (e) { return e.message }");
    expect(caught).toMatchObject({ ok: true, value: "a API disse não" });
    const thrown = await run("await calc.fail()");
    expect(thrown).toMatchObject({ ok: false, kind: "error" });
    expect((thrown as { message: string }).message).toContain("a API disse não");
    const syntax = await run("const = ;");
    expect(syntax).toMatchObject({ ok: false, kind: "error" });
  });

  it("uma função desconhecida falha com mensagem clara", async () => {
    const r = await run("return typeof calc.naoExiste");
    expect(r).toMatchObject({ ok: true, value: "undefined" });
  });

  it("recusa resultados enormes e explica", async () => {
    const r = await run("return await calc.big({n: 5000})", { maxResultChars: 1000 });
    expect(r).toMatchObject({ ok: false, kind: "result-too-large" });
  });

  it("limita as linhas de console", async () => {
    const r = await run("for (let i=0;i<500;i++) console.log(i); return 1", { maxLogLines: 10 });
    expect(r.logs).toHaveLength(11);
    expect(r.logs.at(-1)).toContain("omitidas");
  });

  it("describe devolve declarações, modo de uso e contexto", () => {
    const cm = new CodeMode({
      api: { name: "calc", functions: calc, declarations: "declare const calc: {};" },
      context: () => ({ ambiente: "teste" }),
    });
    expect(cm.describe()).toMatchObject({ api: "calc", declarations: "declare const calc: {};", context: { ambiente: "teste" } });
    expect(cm.describe().usage).toContain("return");
  });

  it("recusa nomes inválidos", async () => {
    await expect(runInSandbox("return 1", { apiName: "a-b", functions: {} })).rejects.toThrow(/apiName/);
    await expect(runInSandbox("return 1", { apiName: "x", functions: { "a b": () => 1 } })).rejects.toThrow(/nome de função/);
  });
});

describe("nomes aninhados (gateway)", () => {
  const nested: ApiFunctions = {
    "jira.createVersion": (a) => ({ criada: (a as { name: string }).name }),
    "jira.getIssue": () => "DEMO-1",
    "xray.createTestPlan": () => ({ key: "DEMO-2" }),
  };
  const go = (code: string) => runInSandbox(code, { apiName: "mcp", functions: nested });

  it("expõe mcp.jira.createVersion() e mcp.xray.createTestPlan()", async () => {
    const r = await go(`return [await mcp.jira.createVersion({name:"v1"}), await mcp.xray.createTestPlan(), Object.keys(mcp)]`);
    expect(r).toMatchObject({ ok: true, value: [{ criada: "v1" }, { key: "DEMO-2" }, ["jira", "xray"]], apiCalls: 2 });
  });

  it("os objetos aninhados também são imutáveis", async () => {
    expect((await go(`mcp.jira.createVersion = () => 1; return 1`)).ok).toBe(false);
    expect((await go(`mcp.jira.novo = () => 1; return 1`)).ok).toBe(false);
    expect((await go(`mcp.outro = {}; return 1`)).ok).toBe(false);
  });

  it("recusa nomes que podiam alterar protótipos ou são ambíguos", async () => {
    for (const bad of ["__proto__.x", "a.constructor", "a.prototype.b", "a..b", ".a", "a."]) {
      await expect(runInSandbox("return 1", { apiName: "mcp", functions: { [bad]: () => 1 } })).rejects.toThrow(/nome de função inválido/);
    }
    await expect(runInSandbox("return 1", { apiName: "mcp", functions: { a: () => 1, "a.b": () => 1 } })).rejects.toThrow(/conflito/);
  });

  it("os nomes simples continuam a funcionar", async () => {
    const r = await runInSandbox("return await x.add({a:1,b:2})", { apiName: "x", functions: { add: (a) => (a as { a: number; b: number }).a + (a as { a: number; b: number }).b } });
    expect(r).toMatchObject({ ok: true, value: 3 });
  });
});
