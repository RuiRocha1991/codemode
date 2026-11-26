import { describe, expect, it } from "vitest";
import { runInSandbox, type ApiFunctions } from "../src/codemode/sandbox.js";

/**
 * XMCM-24 — código que tenta usar rede, ficheiros, process, ler segredos ou correr para além
 * do tempo limite tem de falhar. Corre em cada alteração.
 *
 * O segredo vive no processo host (variável de ambiente e fecho da função); nada disso pode
 * ser visível na sandbox.
 */
const SECRET = "SEGREDO-NAO-PODE-SAIR";
process.env.XRAY_LOCAL_CLIENT_SECRET = SECRET;
const hostState = { secret: SECRET, writes: 0 };

const api: ApiFunctions = {
  read: () => "ok",
  write: () => {
    hostState.writes++;
    return "escrito";
  },
  slowWrite: () => new Promise((r) => setTimeout(() => r(hostState.writes++), 300)),
};
const run = (code: string, extra = {}) => runInSandbox(code, { apiName: "xray", functions: api, ...extra });

/** Executa e exige que o segredo nunca apareça no resultado nem nos registos. */
async function runAndCheckNoLeak(code: string, extra = {}) {
  const r = await run(code, extra);
  expect(JSON.stringify(r)).not.toContain(SECRET);
  return r;
}

describe("sandbox: o que não existe", () => {
  it.each([
    "process",
    "require",
    "module",
    "exports",
    "__dirname",
    "Buffer",
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "setTimeout",
    "setInterval",
    "setImmediate",
    "queueMicrotask",
    "import",
    "__bridge",
    "__log",
    "__fnNames",
  ])("%s não está definido", async (name) => {
    const r = await runAndCheckNoLeak(`return typeof ${name === "import" ? "globalThis.import" : name}`);
    expect(r).toMatchObject({ ok: true, value: "undefined" });
  });

  it("não há acesso a rede", async () => {
    const r = await runAndCheckNoLeak(`const r = await fetch("http://127.0.0.1:1/"); return r.status`);
    expect(r).toMatchObject({ ok: false, kind: "error" });
  });

  it("não há acesso a ficheiros", async () => {
    const r = await runAndCheckNoLeak(`const fs = require("fs"); return fs.readFileSync("/etc/passwd","utf8")`);
    expect(r).toMatchObject({ ok: false, kind: "error" });
    const dyn = await runAndCheckNoLeak(`const fs = await import("node:fs"); return fs.readFileSync("/etc/passwd","utf8")`);
    expect(dyn).toMatchObject({ ok: false, kind: "error" });
  });

  it("não lê variáveis de ambiente nem segredos", async () => {
    const r = await runAndCheckNoLeak(`return process.env.XRAY_LOCAL_CLIENT_SECRET`);
    expect(r).toMatchObject({ ok: false, kind: "error" });
    const g = await runAndCheckNoLeak(`return Object.getOwnPropertyNames(globalThis)`);
    expect(JSON.stringify((g as { value: unknown }).value)).not.toMatch(/process|require|SECRET/i);
  });
});

describe("sandbox: tentativas de fuga", () => {
  it("o construtor de Function não dá acesso ao host", async () => {
    const r = await runAndCheckNoLeak(
      `const F = (async()=>{}).constructor; const f = new F("return typeof process"); return await f()`,
    );
    expect(r).toMatchObject({ ok: true, value: "undefined" });
  });

  it("sobe pela cadeia de protótipos sem chegar ao host", async () => {
    const r = await runAndCheckNoLeak(
      `const p = this.constructor.constructor("return this")(); return [typeof p.process, typeof p.require]`,
    );
    expect(r).toMatchObject({ ok: true, value: ["undefined", "undefined"] });
  });

  it("a função de API não expõe o fecho do host", async () => {
    const src = await runAndCheckNoLeak(`return xray.read.toString()`);
    expect(JSON.stringify(src)).not.toContain("hostState");
    expect(JSON.stringify(src)).not.toContain("functions");
    // Em modo estrito, .caller e .arguments estão vedados.
    const caller = await runAndCheckNoLeak(`return xray.read.caller`);
    expect(caller.ok).toBe(false);
  });

  it("o objeto da API é imutável", async () => {
    const assign = await runAndCheckNoLeak(`xray.write = () => "falso"; return "alterado"`);
    expect(assign.ok).toBe(false);
    const del = await runAndCheckNoLeak(`delete xray.write; return "apagado"`);
    expect(del.ok).toBe(false);
    const add = await runAndCheckNoLeak(`xray.nova = 1; return "acrescentado"`);
    expect(add.ok).toBe(false);
    // E a função original continua a funcionar.
    expect(await runAndCheckNoLeak(`return await xray.read()`)).toMatchObject({ ok: true, value: "ok" });
  });

  it("subir pelo objeto da API não leva ao host", async () => {
    const r = await runAndCheckNoLeak(
      `const G = xray.constructor.constructor("return this")(); return [typeof G.process, typeof G.require, typeof G.__bridge]`,
    );
    expect(r).toMatchObject({ ok: true, value: ["undefined", "undefined", "undefined"] });
  });

  it("não consegue chamar funções que não foram expostas", async () => {
    const r = await runAndCheckNoLeak(`return [typeof xray.hasOwnProperty, typeof xray.delete, typeof xray.exec, typeof xray.shell]`);
    expect(r).toMatchObject({ ok: true, value: ["function", "undefined", "undefined", "undefined"] });
    // hasOwnProperty é do Object da sandbox, não da ponte para o host.
    expect(hostState.writes).toBe(0);
  });

  it("os argumentos passam por JSON: funções e protótipos não atravessam", async () => {
    const fns: ApiFunctions = { inspect: (a: any) => ({ tipo: typeof a, chaves: a && Object.keys(a) }) };
    const r = await runInSandbox(`return await x.inspect({ f: () => 1, n: 2 })`, { apiName: "x", functions: fns });
    expect(r).toMatchObject({ ok: true, value: { tipo: "object", chaves: ["n"] } });
  });

  it("nomes herdados do Object não são funções da API", async () => {
    const r = await runInSandbox(`return typeof x.toString === "function" ? "tem" : "nao"`, { apiName: "x", functions: {} });
    expect(r.ok).toBe(true);
    // Mesmo que exista, chamar não chega ao host.
    const call = await runInSandbox(`return await x.__call__?.()`, { apiName: "x", functions: {} });
    expect(call.ok).toBe(true);
  });
});

describe("sandbox: limites", () => {
  it("um ciclo infinito síncrono é terminado ao tempo limite", async () => {
    const t = Date.now();
    const r = await run(`while (true) {}`, { timeoutMs: 400 });
    expect(r).toMatchObject({ ok: false, kind: "timeout" });
    expect(Date.now() - t).toBeLessThan(3000);
  });

  it("uma espera infinita assíncrona é terminada ao tempo limite", async () => {
    const r = await run(`await new Promise(() => {}); return 1`, { timeoutMs: 400 });
    expect(r).toMatchObject({ ok: false, kind: "timeout" });
  });

  it("depois do tempo limite nenhuma escrita nova chega à API", async () => {
    hostState.writes = 0;
    const r = await run(
      `await xray.slowWrite(); await xray.write(); await xray.write(); return "fim"`,
      { timeoutMs: 100 },
    );
    expect(r).toMatchObject({ ok: false, kind: "timeout" });
    await new Promise((res) => setTimeout(res, 600));
    // A slowWrite que já estava em curso pode terminar (1); as chamadas seguintes não.
    expect(hostState.writes).toBeLessThanOrEqual(1);
  });

  it("estoirar a memória termina a execução", async () => {
    const r = await run(`const a = []; while (true) a.push(new Array(1e5).fill(1))`, { memoryMb: 32 });
    expect(r).toMatchObject({ ok: false, kind: "memory" });
  });

  it("uma string gigante não passa do limite de resultado", async () => {
    const r = await run(`return "x".repeat(5e6)`, { maxResultChars: 10_000 });
    expect(r).toMatchObject({ ok: false, kind: "result-too-large" });
  });

  it("o processo host sobrevive e continua a servir depois de um abuso", async () => {
    await run(`while (true) {}`, { timeoutMs: 200 });
    await run(`const a = []; while (true) a.push(new Array(1e5).fill(1))`, { memoryMb: 32 });
    expect(await run(`return await xray.read()`)).toMatchObject({ ok: true, value: "ok" });
  });

  it("execuções diferentes não partilham estado", async () => {
    await run(`globalThis.sujo = 42; return 1`);
    expect(await run(`return typeof globalThis.sujo`)).toMatchObject({ ok: true, value: "undefined" });
  });
});
