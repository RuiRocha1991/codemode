import ts from "typescript";
import { describe, expect, it } from "vitest";
import { XrayApi } from "../src/xray/api.js";
import { XRAY_DECLARATIONS, XRAY_EXAMPLE } from "../src/xray/declarations.js";
import { XRAY_FUNCTION_NAMES, xrayFunctions } from "../src/xray/functions.js";
import { fakeFetch, makeClient } from "./helpers/fake-xray.js";

/** Compila `source` em memória, com a biblioteca padrão e sem tipos do Node (como na sandbox). */
function diagnostics(source: string): string[] {
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2023, strict: true, noEmit: true, types: [], lib: ["lib.es2023.d.ts"] };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, lang, ...rest) =>
    name === "/virtual/main.ts" ? ts.createSourceFile(name, source, lang) : original(name, lang, ...rest);
  host.fileExists = (n) => n === "/virtual/main.ts" || ts.sys.fileExists(n);
  host.readFile = (n) => (n === "/virtual/main.ts" ? source : ts.sys.readFile(n));
  const program = ts.createProgram(["/virtual/main.ts"], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .map((d) => `${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
}

describe("declarações do describe", () => {
  it("são TypeScript válido", () => {
    expect(diagnostics(XRAY_DECLARATIONS + "\nexport {};")).toEqual([]);
  });

  it("o exemplo do cenário A compila contra elas", () => {
    const src = `${XRAY_DECLARATIONS}\nexport async function main() {\n${XRAY_EXAMPLE}\n}`;
    expect(diagnostics(src)).toEqual([]);
  });

  it("apanham erros de uso: argumentos errados não compilam", () => {
    const bad = `${XRAY_DECLARATIONS}\nexport async function main() { await xray.getFolderTree("/"); await xray.createTests([{ type: "Cucumber", project: "DEMO", summary: "x" }]); }`;
    expect(diagnostics(bad).length).toBeGreaterThanOrEqual(2);
  });

  it("declaram exatamente as funções expostas na sandbox", () => {
    const declared = [...XRAY_DECLARATIONS.matchAll(/^ {2}(\w+)[<(]/gm)].map((m) => m[1]);
    expect(declared.sort()).toEqual([...XRAY_FUNCTION_NAMES].sort());
  });

  it("cada função exposta existe no XrayApi", () => {
    const api = new XrayApi(makeClient(fakeFetch(() => ({})).fetch));
    const fns = xrayFunctions(api);
    expect(Object.keys(fns).sort()).toEqual([...XRAY_FUNCTION_NAMES].sort());
    for (const n of XRAY_FUNCTION_NAMES) expect(typeof api[n]).toBe("function");
  });

  it("todas as funções têm comentário para o Claude", () => {
    for (const name of XRAY_FUNCTION_NAMES) {
      const idx = XRAY_DECLARATIONS.indexOf(`  ${name}`);
      const before = XRAY_DECLARATIONS.slice(Math.max(0, idx - 400), idx);
      expect(before.trimEnd().endsWith("*/"), `${name} sem comentário`).toBe(true);
    }
  });
});
