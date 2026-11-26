import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorResult, jsonResult } from "../server.js";
import type { XrayApi } from "./api.js";
import {
  AddTestsToFolderInput,
  AddTestsToTestPlanInput,
  CleanupInput,
  CountTestsInFolderInput,
  CreateFolderInput,
  CreateTestPlanInput,
  CreateTestsInput,
  GetFolderTreeInput,
  GetTestPlanTestsInput,
  GetTestsInput,
} from "./schemas.js";

/**
 * As mesmas funções da API xray como ferramentas MCP clássicas (XMCM-27).
 * Servem para clientes que não usam Code Mode, e para o gateway, que as chama como mcp.xray.<nome>().
 * A validação é a mesma (zod) porque as ferramentas usam os esquemas da API.
 */
type Annotations = { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };

export const CLASSIC_TOOL_NAMES = [
  "getTests",
  "createTests",
  "createFolder",
  "addTestsToFolder",
  "getFolderTree",
  "countTestsInFolder",
  "createTestPlan",
  "addTestsToTestPlan",
  "getTestPlanTests",
  "cleanup",
] as const;

export function registerClassicTools(server: McpServer, api: XrayApi): void {
  const tool = <Shape extends z.ZodRawShape>(
    name: (typeof CLASSIC_TOOL_NAMES)[number],
    description: string,
    shape: Shape,
    annotations: Annotations,
    run: (input: z.infer<z.ZodObject<Shape>>) => Promise<unknown>,
  ) => {
    // O SDK já validou a entrada com o esquema da ferramenta; o XrayApi volta a validar (barato e idempotente).
    const handler = async (input: Record<string, unknown>) => {
      try {
        return jsonResult(await run(input as z.infer<z.ZodObject<Shape>>));
      } catch (err) {
        return errorResult(err);
      }
    };
    server.registerTool(
      name,
      { description, inputSchema: shape as z.ZodRawShape, annotations: { openWorldHint: true, ...annotations } },
      handler,
    );
  };

  tool(
    "getTests",
    "Testes por JQL (paginado por dentro). Devolve até `max` (por omissão 100, máximo 5000) com issueId, key, tipo, pasta e etiquetas.",
    GetTestsInput.shape,
    { readOnlyHint: true },
    (i) => api.getTests(i),
  );
  tool(
    "createTests",
    "Cria testes em lote (até 500): Manual (steps), Cucumber (gherkin) ou Generic (definition). Devolve issueId e key pela ordem da entrada. A pasta, se indicada, tem de existir; as versões têm de existir no Jira.",
    { tests: CreateTestsInput },
    {},
    (i) => api.createTests(i.tests),
  );
  tool(
    "createFolder",
    "Cria uma pasta no Test Repository e, se testIssueIds vier, coloca lá esses testes. A pasta-mãe tem de existir: crie /A antes de /A/B.",
    CreateFolderInput.shape,
    {},
    (i) => api.createFolder(i),
  );
  tool(
    "addTestsToFolder",
    "Move testes existentes (testIssueIds, os IDs numéricos) para uma pasta. Devolve o total de testes na pasta.",
    AddTestsToFolderInput.shape,
    { idempotentHint: true },
    (i) => api.addTestsToFolder(i),
  );
  tool(
    "getFolderTree",
    "Árvore de pastas a partir de `path` (por omissão /), com testsCount por pasta. Serve para verificar.",
    GetFolderTreeInput.shape,
    { readOnlyHint: true },
    (i) => api.getFolderTree(i),
  );
  tool(
    "countTestsInFolder",
    "Número de testes numa pasta; com includeDescendants também nas subpastas.",
    CountTestsInFolderInput.shape,
    { readOnlyHint: true },
    (i) => api.countTestsInFolder(i),
  );
  tool(
    "createTestPlan",
    "Cria um Test Plan. fixVersions é a versão Jira (tem de existir no projeto); testIssueIds (até 100) enche-o já na criação.",
    CreateTestPlanInput.shape,
    {},
    (i) => api.createTestPlan(i),
  );
  tool(
    "addTestsToTestPlan",
    "Acrescenta testes a um Test Plan (issueId é o do plano). Devolve os IDs realmente acrescentados.",
    AddTestsToTestPlanInput.shape,
    { idempotentHint: true },
    (i) => api.addTestsToTestPlan(i),
  );
  tool(
    "getTestPlanTests",
    "Lê um Test Plan e os seus testes (até max). Serve para verificar.",
    GetTestPlanTestsInput.shape,
    { readOnlyHint: true },
    (i) => api.getTestPlanTests(i),
  );
  tool(
    "cleanup",
    "APAGA os testes e Test Plans com a etiqueta mcp-seed-… (por omissão a de hoje) e as pastas mcp-seed*. Só aceita etiquetas mcp-seed-…. Use dryRun: true para ver o que apagaria.",
    CleanupInput.shape,
    { destructiveHint: true },
    (i) => api.cleanup(i),
  );
}
