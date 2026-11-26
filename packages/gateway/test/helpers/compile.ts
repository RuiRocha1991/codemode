import ts from "typescript";

/** Compila `source` em memória (lib ES2023, sem tipos do Node) e devolve os erros. */
export function diagnostics(source: string): string[] {
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2023, strict: true, noEmit: true, types: [], lib: ["lib.es2023.d.ts"] };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (n, l, ...r) => (n === "/v/main.ts" ? ts.createSourceFile(n, source, l) : original(n, l, ...r));
  host.fileExists = (n) => n === "/v/main.ts" || ts.sys.fileExists(n);
  host.readFile = (n) => (n === "/v/main.ts" ? source : ts.sys.readFile(n));
  return ts.getPreEmitDiagnostics(ts.createProgram(["/v/main.ts"], options, host)).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}
