/**
 * Teste de integração contra um ambiente real (local ou staging): corre os cenários A e B,
 * verifica-os pela leitura da API e limpa tudo no fim, confirmando que o projeto ficou como estava.
 *
 *   XRAY_ENV=local   npm run integration -- --project DEMO
 *   XRAY_ENV=staging npm run integration -- --project DEMO
 *
 * Pré-requisitos: as versões v1.0, v1.1 e v2.0 existem no projeto Jira (docs/mcp-jira.md).
 * Escreve dados reais no ambiente; só corre em ambientes de teste (produção está bloqueada no código).
 * Sai com código 1 se algo falhar.
 */
import { parseArgs } from "node:util";
import { runScenarioA, verifyScenarioA } from "../src/scenarios/scenario-a.js";
import { runScenarioB, verifyScenarioB } from "../src/scenarios/scenario-b.js";
import { XrayApi } from "../src/xray/api.js";
import { connect } from "./lib/connect.js";

const { values } = parseArgs({
  options: { project: { type: "string" }, versions: { type: "string" }, "keep-data": { type: "boolean", default: false } },
});
if (!values.project) {
  console.error("Uso: XRAY_ENV=local npm run integration -- --project DEMO [--versions v1.0,v1.1,v2.0] [--keep-data]");
  process.exit(2);
}
const project = values.project;
const { env, client } = connect();
const xray = new XrayApi(client);
const failures: string[] = [];
const step = (ok: boolean, name: string, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};
const timed = async <T>(fn: () => Promise<T>): Promise<[T, string]> => {
  const t = Date.now();
  const r = await fn();
  return [r, `${((Date.now() - t) / 1000).toFixed(1)}s`];
};
const count = async () => (await xray.getTests({ jql: `project = ${project}`, max: 5000 })).length;

console.log(`Integração em ${env.name} (${env.baseUrl}), projeto ${project}\n`);
const initial = await count();

try {
  // Cenário A: precisa de 200 testes; cria os que faltarem (com a etiqueta, para a limpeza os apanhar).
  if (initial < 200) {
    await xray.createTests(
      Array.from({ length: 200 - initial }, (_, i) => ({ type: "Generic" as const, project, summary: `Integração ${i + 1}`, definition: "x" })),
    );
  }
  const [a, tA] = await timed(() => runScenarioA(xray, { project }));
  const vA = verifyScenarioA(a, { folders: 10, tests: 200 });
  step(vA.ok, "Cenário A: 10 pastas, 200 testes", `${tA}${vA.ok ? "" : "; " + vA.problems.join("; ")}`);
  if (parseFloat(tA) > 120) step(false, "Cenário A em menos de 2 minutos", tA);

  const [b, tB] = await timed(() =>
    runScenarioB(xray, { project, ...(values.versions ? { versions: values.versions.split(",").map((v) => v.trim()) } : {}) }),
  );
  const vB = await verifyScenarioB(xray, b, project);
  step(vB.ok, "Cenário B: pastas por versão e tipo, 3 Test Plans", `${tB}${vB.ok ? "" : "; " + vB.problems.join("; ")}`);
} catch (err) {
  step(false, "Execução dos cenários", err instanceof Error ? err.message : String(err));
} finally {
  if (values["keep-data"]) {
    console.log("\n--keep-data: dados deixados no ambiente. Limpe com xray.cleanup (etiqueta " + xray.seedLabel + ").");
  } else {
    const cleaned = await xray.cleanup({ project });
    console.log(`\nLimpeza: ${cleaned.tests} testes, ${cleaned.testPlans} planos, ${cleaned.folders.length} pastas`);
    const after = await count();
    step(after === initial, "Limpeza: o projeto ficou com o mesmo número de testes", `${initial} → ${after}`);
  }
}
console.log(failures.length ? `\n✗ ${failures.length} falha(s)` : "\n✓ Integração passou");
process.exit(failures.length ? 1 : 0);
