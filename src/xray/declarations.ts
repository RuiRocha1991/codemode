/**
 * Declarações TypeScript da API xray, tal como o Claude as vê no `describe`.
 * Têm de estar alinhadas com src/xray/api.ts: test/declarations.test.ts compila-as e
 * verifica que cada função exposta está declarada.
 */
export const XRAY_DECLARATIONS = `
type TestType = "Manual" | "Cucumber" | "Generic";

interface TestSummary {
  /** ID numérico da issue. É este que as funções de pastas e planos pedem (testIssueIds). */
  issueId: string;
  /** Chave Jira, por exemplo "DEMO-12". */
  key: string;
  summary: string;
  testType: string;
  projectId: string;
  /** Pasta do Test Repository, por exemplo "/Alfa/Beta"; "/" é a raiz. */
  folderPath: string | null;
  labels: string[];
}

interface CreatedTest { issueId: string; key: string; type: TestType; projectId: string }

interface ManualStep { action: string; data?: string; result?: string }

interface TestCommon {
  /** Chave do projeto Jira, por exemplo "DEMO" (não o ID numérico). */
  project: string;
  summary: string;
  /** Pasta onde criar o teste. A pasta tem de existir. */
  folderPath?: string;
  labels?: string[];
  /** Versões Jira (têm de existir no projeto). */
  fixVersions?: string[];
}

type NewTest =
  | (TestCommon & { type: "Manual"; steps?: ManualStep[] })
  | (TestCommon & { type: "Cucumber"; gherkin: string })
  | (TestCommon & { type: "Generic"; definition: string });

interface FolderNode {
  name: string;
  /** Caminho completo, por exemplo "/Alfa/Beta". */
  path: string;
  /** Testes diretamente nesta pasta, sem contar subpastas. */
  testsCount: number;
  folders: FolderNode[];
}

interface TestPlanDetails {
  issueId: string;
  key: string;
  summary: string;
  labels: string[];
  fixVersions: string[];
  tests: TestSummary[];
  /** Total de testes no plano, mesmo que tests traga menos por causa de max. */
  totalTests: number;
}

declare const xray: {
  /**
   * Testes por JQL, paginado por dentro. Devolve até max (por omissão 100, máximo 5000).
   * Exemplo: await xray.getTests({ jql: "project = DEMO", max: 200 })
   */
  getTests(input: { jql: string; max?: number }): Promise<TestSummary[]>;

  /**
   * Cria testes em lote (até 500 por chamada), em paralelo e com retry. Devolve-os pela ordem da entrada.
   * Se alguns falharem lança um erro que diz quais e quais foram criados.
   */
  createTests(tests: NewTest[]): Promise<CreatedTest[]>;

  /**
   * Cria uma pasta no Test Repository e, se testIssueIds vier, coloca lá esses testes.
   * A pasta-mãe TEM de existir: crie /A antes de /A/B.
   */
  createFolder(input: { project: string; path: string; testIssueIds?: string[] }): Promise<{ path: string; testsCount: number }>;

  /** Move testes existentes para uma pasta (por lotes de 100 por dentro). Devolve o total de testes na pasta. */
  addTestsToFolder(input: { project: string; path: string; testIssueIds: string[] }): Promise<{ path: string; testsCount: number }>;

  /** Árvore de pastas a partir de path (por omissão "/"), com testsCount por pasta. Serve para verificar. */
  getFolderTree(input: { project: string; path?: string }): Promise<FolderNode>;

  /** Número de testes numa pasta; com includeDescendants também nas subpastas. */
  countTestsInFolder(input: { project: string; path: string; includeDescendants?: boolean }): Promise<number>;

  /**
   * Cria um Test Plan. fixVersions é a versão Jira (tem de existir no projeto).
   * testIssueIds (até 100) enche-o já na criação.
   */
  createTestPlan(input: { project: string; summary: string; fixVersions?: string[]; labels?: string[]; testIssueIds?: string[] }): Promise<{ issueId: string; key: string }>;

  /** Acrescenta testes a um Test Plan (por lotes de 100). issueId é o do plano. Devolve os IDs acrescentados. */
  addTestsToTestPlan(input: { issueId: string; testIssueIds: string[] }): Promise<{ added: string[] }>;

  /** Lê um Test Plan e os seus testes (até max). Serve para verificar o cenário. */
  getTestPlanTests(input: { issueId: string; max?: number }): Promise<TestPlanDetails>;

  /** Query ou mutação GraphQL do Xray, sempre com variáveis. Para o que as funções acima não cobrem. */
  graphql<T = unknown>(input: { query: string; variables?: Record<string, unknown> }): Promise<T>;
};
`.trim();

export const XRAY_EXAMPLE = `
// Cenário A: 10 pastas com vários níveis e 200 testes espalhados por elas.
const project = "DEMO";
const testes = await xray.getTests({ jql: "project = DEMO", max: 200 });
const pastas = ["/Alfa", "/Alfa/Beta", "/Alfa/Beta/Gama", "/Delta", "/Delta/Eta"];
for (const path of pastas) await xray.createFolder({ project, path }); // pais antes dos filhos
for (const [i, path] of pastas.entries()) {
  const lote = testes.slice(i * 40, i * 40 + 40).map((t) => t.issueId);
  await xray.addTestsToFolder({ project, path, testIssueIds: lote });
}
const arvore = await xray.getFolderTree({ project, path: "/" });
return arvore;
`.trim();
