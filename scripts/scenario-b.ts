/**
 * Cenário B sem IA: testes Manual, Cucumber e Generic; um Test Plan por versão; pasta por versão
 * com subpastas por tipo. As versões TÊM de existir no projeto Jira (ver docs/mcp-jira.md).
 *
 *   XRAY_ENV=local npm run scenario:b -- --project DEMO [--versions v1.0,v1.1,v2.0] [--seed 42]
 *
 * Sai com código 1 se a verificação falhar.
 */
import { parseArgs } from "node:util";
import { runScenarioB, verifyScenarioB } from "../src/scenarios/scenario-b.js";
import { XrayApi } from "../src/xray/api.js";
import { connect } from "./lib/connect.js";

const { values } = parseArgs({
  options: { project: { type: "string" }, versions: { type: "string" }, seed: { type: "string" } },
});
if (!values.project) {
  console.error("Uso: XRAY_ENV=local npm run scenario:b -- --project DEMO [--versions v1.0,v1.1,v2.0] [--seed N]");
  process.exit(2);
}
const { env, client } = connect();
const xray = new XrayApi(client);
console.log(`Cenário B em ${env.name} (${env.baseUrl}), projeto ${values.project}`);

const t0 = Date.now();
const result = await runScenarioB(xray, {
  project: values.project,
  ...(values.versions ? { versions: values.versions.split(",").map((v) => v.trim()) } : {}),
  ...(values.seed ? { seed: Number(values.seed) } : {}),
});
const verification = await verifyScenarioB(xray, result, values.project);
console.log(`Raiz: ${result.rootFolder}`);
for (const [v, plan] of Object.entries(result.plans)) console.log(`  ${v}: plano ${plan.key}`);
console.log(`\n${verification.ok ? "✓ Verificação passou" : "✗ Verificação falhou"} em ${((Date.now() - t0) / 1000).toFixed(1)}s`);
for (const p of verification.problems) console.log(`  - ${p}`);
process.exit(verification.ok ? 0 : 1);
