/**
 * XMCM-12 — Confirma por introspeção os nomes e argumentos das operações GraphQL.
 *
 *   XRAY_ENV=local npm run introspect
 *
 * Escreve um relatório e guarda o schema resumido em docs/schema/<ambiente>.json.
 * Sai com código 1 se faltar alguma operação ou argumento.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { connect } from "./lib/connect.js";
import { checkContract, INTROSPECTION_QUERY, type IntrospectionResult } from "../src/xray/schema-contract.js";

const { env, client } = connect();
const schema = await client.request<IntrospectionResult>(INTROSPECTION_QUERY);
const checks = checkContract(schema);

console.log(`Schema de ${env.name} (${env.baseUrl})\n`);
let failures = 0;
for (const c of checks) {
  const op = `${c.operation.kind} ${c.operation.name}`;
  if (!c.found) {
    failures++;
    console.log(`✗ ${op} — não existe`);
  } else if (c.missingArgs.length) {
    failures++;
    console.log(`✗ ${op} — faltam argumentos: ${c.missingArgs.join(", ")}`);
  } else {
    console.log(`✓ ${op}${c.extraArgs.length ? `  (outros argumentos: ${c.extraArgs.join(", ")})` : ""}`);
  }
}

mkdirSync("docs/schema", { recursive: true });
const path = `docs/schema/${env.name}.json`;
writeFileSync(path, JSON.stringify(schema, null, 2) + "\n");
console.log(`\nSchema resumido guardado em ${path}`);
console.log(failures ? `\n${failures} diferença(s) face ao contrato.` : "\nContrato confirmado.");
process.exit(failures ? 1 : 0);
