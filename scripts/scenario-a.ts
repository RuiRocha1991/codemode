/**
 * XMCM-18 — Cenário A sem IA: 10 pastas com vários níveis e nomes aleatórios, 200 testes distribuídos.
 *
 *   XRAY_ENV=local npm run scenario:a -- --project DEMO [--seed 42] [--create-tests]
 *
 * --create-tests cria primeiro os 200 testes se o projeto não os tiver.
 * Sai com código 1 se a verificação falhar. Serve também de teste de integração.
 */
import { parseArgs } from "node:util";
import { XrayApi } from "../src/xray/api.js";
import { runScenarioA, verifyScenarioA } from "../src/scenarios/scenario-a.js";
import { connect } from "./lib/connect.js";

const { values } = parseArgs({
  options: {
    project: { type: "string" },
    seed: { type: "string" },
    folders: { type: "string", default: "10" },
    tests: { type: "string", default: "200" },
    "create-tests": { type: "boolean", default: false },
  },
});
if (!values.project) {
  console.error("Uso: XRAY_ENV=local npm run scenario:a -- --project DEMO [--seed N] [--create-tests]");
  process.exit(2);
}

const folders = Number(values.folders);
const tests = Number(values.tests);
const { env, client } = connect();
const xray = new XrayApi(client);
console.log(`Cenário A em ${env.name} (${env.baseUrl}), projeto ${values.project}`);

const t0 = Date.now();
if (values["create-tests"]) {
  const have = (await xray.getTests({ jql: `project = ${values.project}`, max: tests })).length;
  if (have < tests) {
    console.log(`A criar ${tests - have} testes Generic…`);
    await xray.createTests(
      Array.from({ length: tests - have }, (_, i) => ({
        type: "Generic" as const,
        project: values.project!,
        summary: `Teste cenário A ${i + 1}`,
        definition: "Criado pelo cenário A",
      })),
    );
  }
}
const result = await runScenarioA(xray, {
  project: values.project,
  folders,
  tests,
  ...(values.seed ? { seed: Number(values.seed) } : {}),
});
const verification = verifyScenarioA(result, { folders, tests });
const seconds = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`Pastas criadas sob ${result.rootFolder}:`);
for (const [path, n] of Object.entries(result.perFolder)) console.log(`  ${path}  (${n} testes)`);
console.log(`\n${verification.ok ? "✓ Verificação passou" : "✗ Verificação falhou"} em ${seconds}s`);
for (const p of verification.problems) console.log(`  - ${p}`);
process.exit(verification.ok ? 0 : 1);
