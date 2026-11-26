import ts from "typescript";
import { describe, expect, it } from "vitest";
import { cleanComment, schemaToTs } from "../src/schema-to-ts.js";

/** Compila `type T = <ts>` para garantir que o que geramos é TypeScript válido. */
function compiles(type: string): string[] {
  const src = `type T = ${type};\nexport type { T };`;
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2023, strict: true, noEmit: true, types: [], lib: ["lib.es2023.d.ts"] };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (n, l, ...r) => (n === "/v/t.ts" ? ts.createSourceFile(n, src, l) : original(n, l, ...r));
  host.fileExists = (n) => n === "/v/t.ts" || ts.sys.fileExists(n);
  host.readFile = (n) => (n === "/v/t.ts" ? src : ts.sys.readFile(n));
  return ts.getPreEmitDiagnostics(ts.createProgram(["/v/t.ts"], options, host)).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

describe("schemaToTs", () => {
  it.each([
    [{ type: "string" }, "string"],
    [{ type: "integer" }, "number"],
    [{ type: "boolean" }, "boolean"],
    [{ type: ["string", "null"] }, "string | null"],
    [{ type: "string", nullable: true }, "string | null"],
    [{ enum: ["a", "b"] }, '"a" | "b"'],
    [{ const: 3 }, "3"],
    [{ type: "array", items: { type: "string" } }, "string[]"],
    [{ type: "array", items: { enum: ["x", "y"] } }, '("x" | "y")[]'],
    [{ anyOf: [{ type: "string" }, { type: "number" }] }, "string | number"],
    [{}, "unknown"],
    [true, "unknown"],
    [false, "never"],
  ])("%j → %s", (schema, expected) => {
    expect(schemaToTs(schema)).toBe(expected);
    expect(compiles(schemaToTs(schema))).toEqual([]);
  });

  it("objetos: obrigatórios, opcionais e comentários", () => {
    const out = schemaToTs({
      type: "object",
      properties: { name: { type: "string", description: "Nome da versão" }, released: { type: "boolean" } },
      required: ["name"],
    });
    expect(out).toContain("/** Nome da versão */");
    expect(out).toContain("name: string;");
    expect(out).toContain("released?: boolean;");
    expect(compiles(out)).toEqual([]);
  });

  it("aninhados e arrays de objetos compilam", () => {
    const out = schemaToTs({
      type: "object",
      properties: { fields: { type: "object", properties: { labels: { type: "array", items: { type: "string" } } } }, list: { type: "array", items: { type: "object", properties: { id: { type: "number" } }, required: ["id"] } } },
    });
    expect(compiles(out)).toEqual([]);
  });

  it("resolve $ref dentro do esquema e ignora referências externas", () => {
    const schema = { type: "object", properties: { v: { $ref: "#/$defs/Versao" }, x: { $ref: "http://evil/x.json" } }, $defs: { Versao: { type: "string" } } };
    const out = schemaToTs(schema);
    expect(out).toContain("v?: string;");
    expect(out).toContain("x?: unknown;");
  });

  it("não entra em ciclo com $ref recursivo", () => {
    const schema = { $defs: { N: { type: "object", properties: { next: { $ref: "#/$defs/N" } } } }, $ref: "#/$defs/N" };
    expect(compiles(schemaToTs(schema))).toEqual([]);
  });

  it("nomes de propriedades perigosos saem entre aspas", () => {
    const out = schemaToTs({ type: "object", properties: { "a-b": { type: "string" }, "x; evil(): void; y": { type: "string" }, 'q"uote': { type: "string" } } });
    expect(out).toContain('"a-b"?: string;');
    expect(out).toContain('"x; evil(): void; y"?: string;');
    expect(compiles(out)).toEqual([]);
  });

  it("descrições não fecham o comentário nem injetam código", () => {
    const out = schemaToTs({ type: "object", properties: { a: { type: "string", description: "bom */ type Evil = 1; /* mau\nlinha 2" } } });
    expect(out).not.toMatch(/\*\/ type Evil/);
    expect(compiles(out)).toEqual([]);
    expect(cleanComment("x".repeat(1000), 50)).toHaveLength(50);
  });

  it("additionalProperties", () => {
    expect(schemaToTs({ type: "object", additionalProperties: { type: "number" } })).toContain("[key: string]: number;");
    expect(schemaToTs({ type: "object" })).toContain("[key: string]: unknown;");
    // O SDK emite properties: {} para ferramentas sem argumentos.
    expect(schemaToTs({ type: "object", properties: {} })).toBe("{}");
  });
});
