import type { z } from "zod";
import type { GraphQLClient } from "./graphql.js";
import {
  AddTestsToFolderInput,
  AddTestsToTestPlanInput,
  CreateTestPlanInput,
  GetTestPlanTestsInput,
  CountTestsInFolderInput,
  CreateFolderInput,
  CreateTestInput,
  CreateTestsInput,
  GetFolderTreeInput,
  GetTestsInput,
  GraphQLInput,
  parseInput,
  normalizeFolderPath,
  ProjectRef,
  XrayValidationError,
} from "./schemas.js";

/** Teste tal como a API xray o devolve. */
export interface TestSummary {
  issueId: string;
  key: string;
  summary: string;
  testType: string;
  projectId: string;
  folderPath: string | null;
  labels: string[];
}

/** Máximo que a API GraphQL aceita em `limit`. */
export const PAGE_SIZE = 100;

interface RawTest {
  issueId: string;
  projectId: string;
  testType?: { name?: string } | null;
  folder?: { path?: string } | null;
  jira?: { key?: string; summary?: string; labels?: string[] } | null;
}

interface RawTestPlan {
  issueId: string;
  jira?: { key?: string; summary?: string; labels?: string[]; fixVersions?: ({ name?: string } | string)[] } | null;
  tests?: TestResults | null;
}

interface TestResults {
  total: number;
  start: number;
  limit: number;
  results: RawTest[];
}

const GET_TESTS = /* GraphQL */ `
  query GetTests($jql: String, $projectId: String, $folder: FolderSearchInput, $limit: Int!, $start: Int) {
    getTests(jql: $jql, projectId: $projectId, folder: $folder, limit: $limit, start: $start) {
      total
      start
      limit
      results {
        issueId
        projectId
        testType { name }
        folder { path }
        jira(fields: ["key", "summary", "labels"])
      }
    }
  }
`;

const CREATE_TEST = /* GraphQL */ `
  mutation CreateTest(
    $testType: UpdateTestTypeInput
    $steps: [CreateStepInput]
    $gherkin: String
    $unstructured: String
    $folderPath: String
    $jira: JSON!
  ) {
    createTest(
      testType: $testType
      steps: $steps
      gherkin: $gherkin
      unstructured: $unstructured
      folderPath: $folderPath
      jira: $jira
    ) {
      test {
        issueId
        projectId
        testType { name }
        jira(fields: ["key"])
      }
      warnings
    }
  }
`;

export interface CreatedTest {
  issueId: string;
  key: string;
  type: "Manual" | "Cucumber" | "Generic";
  projectId: string;
}

/** Alguns testes do lote falharam depois dos retries. Os criados ficam em `created`. */
export class CreateTestsError extends Error {
  override name = "CreateTestsError";
  constructor(
    readonly created: CreatedTest[],
    readonly failed: { index: number; summary: string; error: string }[],
  ) {
    const sample = failed
      .slice(0, 5)
      .map((f) => `#${f.index} "${f.summary}": ${f.error}`)
      .join("\n");
    super(
      `createTests: ${failed.length} de ${created.length + failed.length} falharam; ` +
        `${created.length} foram criados (${created.map((c) => c.key).slice(0, 10).join(", ")}${created.length > 10 ? ", …" : ""}).\n${sample}`,
    );
  }
}

const CREATE_TEST_PLAN = /* GraphQL */ `
  mutation CreateTestPlan($testIssueIds: [String], $jira: JSON!) {
    createTestPlan(testIssueIds: $testIssueIds, jira: $jira) {
      testPlan {
        issueId
        jira(fields: ["key"])
      }
      warnings
    }
  }
`;

const ADD_TESTS_TO_TEST_PLAN = /* GraphQL */ `
  mutation AddTestsToTestPlan($issueId: String!, $testIssueIds: [String]!) {
    addTestsToTestPlan(issueId: $issueId, testIssueIds: $testIssueIds) {
      addedTests
      warning
    }
  }
`;

const GET_TEST_PLAN = /* GraphQL */ `
  query GetTestPlan($issueId: String!, $limit: Int!, $start: Int) {
    getTestPlan(issueId: $issueId) {
      issueId
      jira(fields: ["key", "summary", "labels", "fixVersions"])
      tests(limit: $limit, start: $start) {
        total
        start
        limit
        results {
          issueId
          projectId
          testType { name }
          folder { path }
          jira(fields: ["key", "summary", "labels"])
        }
      }
    }
  }
`;

export interface CreatedTestPlan {
  issueId: string;
  key: string;
}

export interface TestPlanDetails {
  issueId: string;
  key: string;
  summary: string;
  labels: string[];
  fixVersions: string[];
  tests: TestSummary[];
  /** Total de testes no plano (pode ser maior que tests.length se max for menor). */
  totalTests: number;
}

const CREATE_FOLDER = /* GraphQL */ `
  mutation CreateFolder($projectId: String!, $path: String!, $testIssueIds: [String]) {
    createFolder(projectId: $projectId, path: $path, testIssueIds: $testIssueIds) {
      folder { name path testsCount }
      warnings
    }
  }
`;

const ADD_TESTS_TO_FOLDER = /* GraphQL */ `
  mutation AddTestsToFolder($projectId: String!, $path: String!, $testIssueIds: [String]!) {
    addTestsToFolder(projectId: $projectId, path: $path, testIssueIds: $testIssueIds) {
      folder { name path testsCount }
      warnings
    }
  }
`;

const GET_FOLDER = /* GraphQL */ `
  query GetFolder($projectId: String!, $path: String!) {
    getFolder(projectId: $projectId, path: $path) {
      name
      path
      testsCount
      folders
    }
  }
`;

/** Pasta do Test Repository. `folders` são as subpastas diretas, com a mesma forma. */
export interface FolderNode {
  name: string;
  path: string;
  /** Testes diretamente nesta pasta (sem subpastas). */
  testsCount: number;
  folders: FolderNode[];
}

/** Máximo de testes por pedido addTestsToFolder / addTestsToTestPlan. */
export const IDS_PER_REQUEST = 100;

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Soma `testsCount` da pasta e de todas as subpastas. */
export function sumTests(node: FolderNode): number {
  return node.testsCount + node.folders.reduce((n, f) => n + sumTests(f), 0);
}

/** Todas as pastas da árvore, sem a raiz pedida, em profundidade. */
export function flattenFolders(node: FolderNode): FolderNode[] {
  return node.folders.flatMap((f) => [f, ...flattenFolders(f)]);
}

function toFolderNode(raw: unknown): FolderNode {
  const r = (raw ?? {}) as { name?: string; path?: string; testsCount?: number; folders?: unknown };
  let children: unknown = r.folders;
  // Na API real `folders` pode vir como JSON em texto.
  if (typeof children === "string") {
    try {
      children = JSON.parse(children);
    } catch {
      children = [];
    }
  }
  return {
    name: r.name ?? "",
    path: r.path ?? "/",
    testsCount: r.testsCount ?? 0,
    folders: Array.isArray(children) ? children.map(toFolderNode) : [],
  };
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function toTestSummary(raw: RawTest): TestSummary {
  return {
    issueId: raw.issueId,
    key: raw.jira?.key ?? "",
    summary: raw.jira?.summary ?? "",
    testType: raw.testType?.name ?? "",
    projectId: raw.projectId,
    folderPath: raw.folder?.path ?? null,
    labels: raw.jira?.labels ?? [],
  };
}

/**
 * Núcleo da API xray: funções tipadas, validadas e sem estado visível.
 * É o objeto que o Code Mode expõe na sandbox como `xray` e que o plano B expõe como ferramentas.
 */
export class XrayApi {
  /** chave do projeto → projectId, aprendido com getTests e createTests. */
  private readonly projectIds = new Map<string, string>();

  constructor(private readonly client: GraphQLClient) {}

  get environment(): string {
    return this.client.envName;
  }

  /**
   * Testes por JQL, com paginação: pede páginas de até 100 até chegar a `max` ou ao fim.
   */
  async getTests(input: GetTestsInput): Promise<TestSummary[]> {
    const { jql, max } = parseInput("getTests", GetTestsInput, input);
    return this.paginateTests({ jql }, max);
  }

  /**
   * Cria testes em lote (Manual, Cucumber ou Generic): uma mutação createTest por teste,
   * em paralelo até ao limite do cliente (5), com retry. Devolve os testes na ordem da entrada.
   * Se algum falhar, lança CreateTestsError com os criados e os que falharam.
   */
  async createTests(inputs: CreateTestInput[]): Promise<CreatedTest[]> {
    const parsed = parseInput("createTests", CreateTestsInput, inputs);
    const settled = await Promise.allSettled(parsed.map((t) => this.createOne(t)));
    const created: CreatedTest[] = [];
    const failed: { index: number; summary: string; error: string }[] = [];
    settled.forEach((r, index) => {
      if (r.status === "fulfilled") created.push(r.value);
      else failed.push({ index, summary: parsed[index]!.summary, error: errorMessage(r.reason) });
    });
    if (failed.length) throw new CreateTestsError(created, failed);
    return created;
  }

  private async createOne(t: z.output<typeof CreateTestInput>): Promise<CreatedTest> {
    const fields: Record<string, unknown> = { summary: t.summary, project: { key: t.project } };
    const labels = this.labelsFor(t.labels);
    if (labels.length) fields.labels = labels;
    if (t.fixVersions?.length) fields.fixVersions = t.fixVersions.map((name) => ({ name }));
    const variables: Record<string, unknown> = { testType: { name: t.type }, jira: { fields } };
    if (t.type === "Manual") variables.steps = t.steps;
    if (t.type === "Cucumber") variables.gherkin = t.gherkin;
    if (t.type === "Generic") variables.unstructured = t.definition;
    if (t.folderPath && t.folderPath !== "/") variables.folderPath = t.folderPath;

    const { createTest } = await this.client.request<{ createTest: { test: RawTest; warnings?: string[] } }>(
      CREATE_TEST,
      variables,
    );
    const key = createTest.test.jira?.key ?? "";
    const created: CreatedTest = {
      issueId: createTest.test.issueId,
      key,
      type: t.type,
      projectId: createTest.test.projectId,
    };
    this.rememberProject(created);
    return created;
  }

  /**
   * Cria uma pasta e, se `testIssueIds` vier, enche-a numa chamada.
   * A pasta-mãe tem de existir; para criar uma cadeia use createFolder por ordem
   * (/A, depois /A/B). Mais de 100 testes: cria e distribui o resto por lotes.
   */
  async createFolder(input: CreateFolderInput): Promise<{ path: string; testsCount: number }> {
    const { project, path, testIssueIds = [] } = parseInput("createFolder", CreateFolderInput, input);
    const projectId = await this.resolveProjectId(project);
    const [first = [], ...rest] = chunk(testIssueIds, IDS_PER_REQUEST);
    const { createFolder } = await this.client.request<{ createFolder: { folder: FolderNode } }>(CREATE_FOLDER, {
      projectId,
      path,
      testIssueIds: first,
    });
    let testsCount = createFolder.folder.testsCount;
    for (const ids of rest) testsCount = (await this.addBatch(projectId, path, ids)).testsCount;
    return { path: createFolder.folder.path, testsCount };
  }

  /** Move testes existentes para uma pasta, por lotes de 100. Devolve o total de testes na pasta. */
  async addTestsToFolder(input: AddTestsToFolderInput): Promise<{ path: string; testsCount: number }> {
    const { project, path, testIssueIds } = parseInput("addTestsToFolder", AddTestsToFolderInput, input);
    const projectId = await this.resolveProjectId(project);
    let last = { path, testsCount: 0 };
    for (const ids of chunk(testIssueIds, IDS_PER_REQUEST)) last = await this.addBatch(projectId, path, ids);
    return last;
  }

  private async addBatch(projectId: string, path: string, ids: string[]) {
    const { addTestsToFolder } = await this.client.request<{ addTestsToFolder: { folder: FolderNode } }>(
      ADD_TESTS_TO_FOLDER,
      { projectId, path, testIssueIds: ids },
    );
    return { path: addTestsToFolder.folder.path, testsCount: addTestsToFolder.folder.testsCount };
  }

  /**
   * Árvore de pastas a partir de `path` (por omissão "/"), com testsCount por pasta.
   * Serve para verificar: sumTests(tree) é o total de testes na árvore.
   */
  async getFolderTree(input: GetFolderTreeInput): Promise<FolderNode> {
    const { project, path } = parseInput("getFolderTree", GetFolderTreeInput, input);
    const projectId = await this.resolveProjectId(project);
    const { getFolder } = await this.client.request<{ getFolder: unknown }>(GET_FOLDER, { projectId, path });
    return toFolderNode(getFolder);
  }

  /** Quantos testes há numa pasta (e opcionalmente nas subpastas), sem os trazer. */
  async countTestsInFolder(input: CountTestsInFolderInput): Promise<number> {
    const { project, path, includeDescendants } = parseInput("countTestsInFolder", CountTestsInFolderInput, input);
    const projectId = await this.resolveProjectId(project);
    return this.countTests({ projectId, folder: { path: normalizeFolderPath(path), includeDescendants } });
  }

  /**
   * Cria um Test Plan. A versão vai em `fixVersions` (a versão tem de existir no projeto Jira);
   * `testIssueIds` (até 100) enche-o já na criação, o resto com addTestsToTestPlan.
   */
  async createTestPlan(input: CreateTestPlanInput): Promise<CreatedTestPlan> {
    const t = parseInput("createTestPlan", CreateTestPlanInput, input);
    const fields: Record<string, unknown> = { summary: t.summary, project: { key: t.project } };
    const labels = this.labelsFor(t.labels);
    if (labels.length) fields.labels = labels;
    if (t.fixVersions?.length) fields.fixVersions = t.fixVersions.map((name) => ({ name }));
    const { createTestPlan } = await this.client.request<{
      createTestPlan: { testPlan: { issueId: string; jira?: { key?: string } } };
    }>(CREATE_TEST_PLAN, { testIssueIds: t.testIssueIds ?? [], jira: { fields } });
    return { issueId: createTestPlan.testPlan.issueId, key: createTestPlan.testPlan.jira?.key ?? "" };
  }

  /** Acrescenta testes a um Test Plan por lotes de 100. Devolve os IDs realmente acrescentados. */
  async addTestsToTestPlan(input: AddTestsToTestPlanInput): Promise<{ added: string[] }> {
    const { issueId, testIssueIds } = parseInput("addTestsToTestPlan", AddTestsToTestPlanInput, input);
    const added: string[] = [];
    for (const ids of chunk(testIssueIds, IDS_PER_REQUEST)) {
      const { addTestsToTestPlan } = await this.client.request<{ addTestsToTestPlan: { addedTests?: string[] } }>(
        ADD_TESTS_TO_TEST_PLAN,
        { issueId, testIssueIds: ids },
      );
      added.push(...(addTestsToTestPlan.addedTests ?? []));
    }
    return { added };
  }

  /** Lê um Test Plan e os seus testes (paginado), para verificação. */
  async getTestPlanTests(input: GetTestPlanTestsInput): Promise<TestPlanDetails> {
    const { issueId, max } = parseInput("getTestPlanTests", GetTestPlanTestsInput, input);
    const tests: TestSummary[] = [];
    let header: { key: string; summary: string; labels: string[]; fixVersions: string[] } | undefined;
    let total = 0;
    let start = 0;
    while (tests.length < max || !header) {
      const limit = Math.min(PAGE_SIZE, Math.max(1, max - tests.length));
      const { getTestPlan } = await this.client.request<{ getTestPlan: RawTestPlan | null }>(GET_TEST_PLAN, {
        issueId,
        limit,
        start,
      });
      if (!getTestPlan) throw new XrayValidationError(`getTestPlanTests: o Test Plan ${issueId} não existe`);
      header ??= {
        key: getTestPlan.jira?.key ?? "",
        summary: getTestPlan.jira?.summary ?? "",
        labels: getTestPlan.jira?.labels ?? [],
        fixVersions: (getTestPlan.jira?.fixVersions ?? []).map((v) => (typeof v === "string" ? v : (v.name ?? ""))),
      };
      total = getTestPlan.tests?.total ?? 0;
      const page = getTestPlan.tests?.results ?? [];
      for (const raw of page) {
        const test = toTestSummary(raw);
        this.rememberProject(test);
        tests.push(test);
      }
      start += page.length;
      if (page.length === 0 || start >= total) break;
    }
    return { issueId, ...header!, tests, totalTests: total };
  }

  /** Etiquetas a aplicar a uma issue criada. Ponto de extensão para a etiqueta automática (XMCM-28). */
  protected labelsFor(labels: string[] | undefined): string[] {
    return labels ?? [];
  }

  /** Executa uma query ou mutação GraphQL arbitrária, com variáveis. Para o que a API tipada não cobre. */
  async graphql<T = unknown>(input: GraphQLInput): Promise<T> {
    const { query, variables } = parseInput("graphql", GraphQLInput, input);
    return this.client.request<T>(query, variables);
  }

  protected async paginateTests(
    filter: { jql?: string; projectId?: string; folder?: { path: string; includeDescendants: boolean } },
    max: number,
  ): Promise<TestSummary[]> {
    const out: TestSummary[] = [];
    let start = 0;
    while (out.length < max) {
      const limit = Math.min(PAGE_SIZE, max - out.length);
      const { getTests: page } = await this.client.request<{ getTests: TestResults }>(GET_TESTS, {
        ...filter,
        limit,
        start,
      });
      for (const raw of page.results) {
        const test = toTestSummary(raw);
        this.rememberProject(test);
        out.push(test);
      }
      start += page.results.length;
      if (page.results.length === 0 || start >= page.total) break;
    }
    return out;
  }

  /** Total de testes que um filtro devolve, sem os trazer. */
  protected async countTests(filter: {
    jql?: string;
    projectId?: string;
    folder?: { path: string; includeDescendants: boolean };
  }): Promise<number> {
    const { getTests } = await this.client.request<{ getTests: TestResults }>(GET_TESTS, {
      ...filter,
      limit: 1,
      start: 0,
    });
    return getTests.total;
  }

  protected rememberProject(test: { key: string; projectId: string }): void {
    const projectKey = test.key.split("-")[0];
    if (projectKey && test.projectId) this.projectIds.set(projectKey, test.projectId);
  }

  /**
   * Aceita a chave (DEMO) ou o ID numérico do projeto e devolve o ID, que as operações
   * de pastas exigem. A chave resolve-se pelo primeiro teste do projeto.
   */
  async resolveProjectId(project: string): Promise<string> {
    const ref = parseInput("project", ProjectRef, project);
    if (/^\d+$/.test(ref)) return ref;
    const cached = this.projectIds.get(ref);
    if (cached) return cached;
    // A chave já foi validada por ProjectRef (só [A-Z0-9_]), por isso pode ir para JQL.
    const [first] = await this.paginateTests({ jql: `project = ${ref}` }, 1);
    if (!first) {
      throw new XrayValidationError(
        `Não encontrei testes no projeto ${ref} para descobrir o projectId. Crie um teste primeiro (createTests) ou passe o ID numérico do projeto.`,
      );
    }
    return first.projectId;
  }
}
