import type { z } from "zod";
import type { GraphQLClient } from "./graphql.js";
import {
  CreateTestInput,
  CreateTestsInput,
  GetTestsInput,
  GraphQLInput,
  parseInput,
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
