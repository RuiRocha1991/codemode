import type { GraphQLClient } from "./graphql.js";
import {
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
