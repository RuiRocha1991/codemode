import { describe, expect, it } from "vitest";
import { CodeMode } from "../src/codemode/codemode.js";
import { runInSandbox, type ApiFunctions } from "../src/codemode/sandbox.js";

// Uma API de exemplo, sem nada do Xray: prova que o módulo é genérico.
const calc: ApiFunctions = {
  add: ({ a, b }: any) => a + b,
  sleep: ({ ms }: any) => new Promise((r) => setTimeout(() => r(ms), ms)),
  fail: () => Promise.reject(new Error("a API disse não")),
  nothing: () => undefined,
  big: ({ n }: any) => "x".repeat(n),
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
