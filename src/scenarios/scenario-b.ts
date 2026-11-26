import type { XrayApi } from "../xray/api.js";
import type { Verification } from "./scenario-a.js";

export const TEST_TYPES = ["Manual", "Cucumber", "Generic"] as const;
export type ScenarioTestType = (typeof TEST_TYPES)[number];

export interface ScenarioBOptions {
  project: string;
  /** Versões Jira (têm de existir no projeto). Por omissão v1.0, v1.1, v2.0. */
  versions?: string[];
  /** Testes por combinação versão × tipo. Por omissão 4. */
  testsPerCombo?: number;
  /** Raiz sob a qual criar as pastas, para não colidir com pastas existentes. */
  rootFolder?: string;
  seed?: number;
}

export interface ScenarioBResult {
  rootFolder: string;
  label: string;
  versions: string[];
  /** versão → tipo → issueIds dos testes criados. */
  tests: Record<string, Record<ScenarioTestType, string[]>>;
  /** versão → Test Plan. */
  plans: Record<string, { issueId: string; key: string }>;
}

const GHERKIN = (name: string) => `Feature: ${name}\n  Scenario: ${name}\n    Given um estado inicial\n    When algo acontece\n    Then o resultado é o esperado`;

/**
 * Cenário B: testes Manual, Cucumber e Generic; um Test Plan por versão com os testes dessa
 * versão; uma pasta por versão com uma subpasta por tipo (ex. /v1.0/Cucumber).
 */
export async function runScenarioB(xray: XrayApi, options: ScenarioBOptions): Promise<ScenarioBResult> {
  const { project, versions = ["v1.0", "v1.1", "v2.0"], testsPerCombo = 4, seed = Date.now() } = options;
  const rootFolder = options.rootFolder ?? `/mcp-seed-cenarioB-${seed}`;
  const label = `cenarioB-${seed}`;

  // 1. Pastas: raiz, uma por versão, uma por tipo (pais antes dos filhos).
  await ensureTestExists(xray, project, label);
  await xray.createFolder({ project, path: rootFolder });
  for (const v of versions) {
    await xray.createFolder({ project, path: `${rootFolder}/${v}` });
    for (const t of TEST_TYPES) await xray.createFolder({ project, path: `${rootFolder}/${v}/${t}` });
  }

  // 2. Testes: cada um na pasta da sua versão e tipo, com a versão e a etiqueta do cenário.
  const tests: ScenarioBResult["tests"] = {};
  for (const v of versions) {
    tests[v] = { Manual: [], Cucumber: [], Generic: [] };
    const inputs = TEST_TYPES.flatMap((type) =>
      Array.from({ length: testsPerCombo }, (_, i) => {
        const summary = `${v} ${type} ${i + 1}`;
        const common = { project, summary, folderPath: `${rootFolder}/${v}/${type}`, labels: [label], fixVersions: [v] };
        if (type === "Manual") return { ...common, type, steps: [{ action: `Executar ${summary}`, result: "Passa" }] };
        if (type === "Cucumber") return { ...common, type, gherkin: GHERKIN(summary) };
        return { ...common, type, definition: `Verificar ${summary}` };
      }),
    );
    const created = await xray.createTests(inputs);
    for (const c of created) tests[v]![c.type].push(c.issueId);
  }

  // 3. Test Plans: um por versão, com os testes dessa versão.
  const plans: ScenarioBResult["plans"] = {};
  for (const v of versions) {
    const ids = TEST_TYPES.flatMap((t) => tests[v]![t]);
    const plan = await xray.createTestPlan({ project, summary: `Plano ${v} (${label})`, fixVersions: [v], labels: [label], testIssueIds: ids.slice(0, 100) });
    if (ids.length > 100) await xray.addTestsToTestPlan({ issueId: plan.issueId, testIssueIds: ids.slice(100) });
    plans[v] = plan;
  }
  return { rootFolder, label, versions, tests, plans };
}

/** Garante que o projeto tem pelo menos um teste (as pastas precisam do projectId). */
async function ensureTestExists(xray: XrayApi, project: string, label: string): Promise<void> {
  const [first] = await xray.getTests({ jql: `project = ${project}`, max: 1 });
  if (!first) {
    await xray.createTests([{ type: "Generic", project, summary: `Teste inicial (${label})`, definition: "Cria o projectId", labels: [label] }]);
  }
}

/**
 * Verificação: cada plano tem os testes certos e cada pasta (ex. /v1.0/Cucumber) só tem testes
 * desse tipo e dessa versão. Lê tudo de volta da API; não confia no que o script criou.
 */
export async function verifyScenarioB(xray: XrayApi, result: ScenarioBResult, project: string): Promise<Verification> {
  const problems: string[] = [];
  const all = await xray.getTests({ jql: `project = ${project} AND labels = ${result.label}`, max: 5000 });
  const byId = new Map(all.map((t) => [t.issueId, t]));

  for (const v of result.versions) {
    // Planos
    const plan = await xray.getTestPlanTests({ issueId: result.plans[v]!.issueId, max: 5000 });
    const expected = TEST_TYPES.flatMap((t) => result.tests[v]![t]).sort();
    const actual = plan.tests.map((t) => t.issueId).sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      problems.push(`plano ${v}: esperava ${expected.length} testes, tem ${actual.length} (ou são outros)`);
    }
    if (!plan.fixVersions.includes(v)) problems.push(`plano ${v}: versão em falta (tem ${plan.fixVersions.join(", ") || "nenhuma"})`);

    // Pastas por tipo
    for (const type of TEST_TYPES) {
      const path = `${result.rootFolder}/${v}/${type}`;
      const want = result.tests[v]![type];
      const inFolder = all.filter((t) => t.folderPath === path);
      if (inFolder.length !== want.length) problems.push(`${path}: esperava ${want.length} testes, tem ${inFolder.length}`);
      for (const t of inFolder) {
        if (t.testType !== type) problems.push(`${path}: ${t.key} é ${t.testType}, não ${type}`);
        if (!want.includes(t.issueId)) problems.push(`${path}: ${t.key} não é desta versão`);
      }
      for (const id of want) if (!byId.has(id)) problems.push(`${path}: o teste ${id} não foi encontrado`);
    }
  }
  return { ok: problems.length === 0, problems };
}
