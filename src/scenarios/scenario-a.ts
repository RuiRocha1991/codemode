import { flattenFolders, sumTests, type FolderNode, type XrayApi } from "../xray/api.js";
import { makeRng, pick, uniqueNames } from "./random.js";

export interface ScenarioAOptions {
  project: string;
  /** Pastas a criar. Por omissão 10. */
  folders?: number;
  /** Testes a distribuir. Por omissão 200. */
  tests?: number;
  /** Profundidade máxima das pastas. Por omissão 4. */
  maxDepth?: number;
  /** Raiz sob a qual criar a árvore, para não colidir com pastas existentes. */
  rootFolder?: string;
  seed?: number;
}

export interface ScenarioAResult {
  rootFolder: string;
  folderPaths: string[];
  testsDistributed: number;
  perFolder: Record<string, number>;
  tree: FolderNode;
}

export interface Verification {
  ok: boolean;
  problems: string[];
}

/**
 * Cenário A: cria `folders` pastas com vários níveis e nomes aleatórios no Test Repository
 * e espalha `tests` testes já existentes do projeto por elas.
 */
export async function runScenarioA(xray: XrayApi, options: ScenarioAOptions): Promise<ScenarioAResult> {
  const { project, folders = 10, tests = 200, maxDepth = 4, seed = Date.now() } = options;
  const rng = makeRng(seed);
  const rootFolder = options.rootFolder ?? `/cenarioA-${seed}`;

  const found = await xray.getTests({ jql: `project = ${project}`, max: tests });
  if (found.length < tests) {
    throw new Error(`O projeto ${project} tem só ${found.length} testes; o cenário precisa de ${tests}. Crie mais com createTests.`);
  }

  // Árvore aleatória: cada nova pasta fica na raiz ou debaixo de uma já criada (até maxDepth).
  const names = uniqueNames(rng, folders);
  const paths: string[] = [];
  for (const name of names) {
    const parents = [rootFolder, ...paths.filter((p) => p.slice(rootFolder.length).split("/").length - 1 < maxDepth)];
    paths.push(`${pick(rng, parents)}/${name}`);
  }

  await xray.createFolder({ project, path: rootFolder });
  for (const path of paths) await xray.createFolder({ project, path }); // pais antes dos filhos, por construção

  // Espalha os testes pelas pastas ao acaso.
  const buckets = new Map<string, string[]>(paths.map((p) => [p, []]));
  for (const t of found) buckets.get(pick(rng, paths))!.push(t.issueId);
  for (const [path, ids] of buckets) {
    if (ids.length) await xray.addTestsToFolder({ project, path, testIssueIds: ids });
  }

  const tree = await xray.getFolderTree({ project, path: rootFolder });
  return {
    rootFolder,
    folderPaths: paths,
    testsDistributed: found.length,
    perFolder: Object.fromEntries([...buckets].map(([p, ids]) => [p, ids.length])),
    tree,
  };
}

/** Lê a árvore de volta: N pastas e a soma dos testes por pasta dá o total distribuído. */
export function verifyScenarioA(result: ScenarioAResult, expected: { folders: number; tests: number }): Verification {
  const problems: string[] = [];
  const nodes = flattenFolders(result.tree);
  if (nodes.length !== expected.folders) problems.push(`pastas: esperava ${expected.folders}, a árvore tem ${nodes.length}`);
  const total = sumTests(result.tree);
  if (total !== expected.tests) problems.push(`testes: esperava ${expected.tests}, a soma por pasta dá ${total}`);
  for (const n of nodes) {
    const want = result.perFolder[n.path];
    if (want !== undefined && want !== n.testsCount) problems.push(`${n.path}: esperava ${want} testes, tem ${n.testsCount}`);
  }
  const depth = Math.max(...nodes.map((n) => n.path.slice(result.rootFolder.length).split("/").length - 1));
  if (expected.folders >= 3 && depth < 2) problems.push("a árvore ficou toda num só nível");
  return { ok: problems.length === 0, problems };
}
