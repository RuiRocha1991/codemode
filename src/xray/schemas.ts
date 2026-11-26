import { z } from "zod";

/**
 * Esquemas zod das entradas da API xray. Todas as funções validam a entrada antes de chegar
 * à API GraphQL, venham do código na sandbox ou das ferramentas clássicas.
 */

export const MAX_TESTS_PER_REQUEST = 5000;
export const MAX_CREATE_PER_CALL = 500;

/** Chave de projeto Jira (DEMO) ou ID numérico (10001). Validado para poder ir para JQL sem risco. */
export const ProjectRef = z
  .string()
  .regex(/^([A-Z][A-Z0-9_]{0,49}|\d{1,18})$/, "use a chave do projeto (ex. DEMO) ou o ID numérico");

/** Caminho de pasta no Test Repository: "/", "/A", "/A/B". */
export const FolderPath = z
  .string()
  .transform((p) => normalizeFolderPath(p))
  .pipe(
    z
      .string()
      .max(1000)
      .refine((p) => p === "/" || p.split("/").slice(1).every((s) => s.length > 0 && s.length <= 255), {
        message: "caminho de pasta inválido",
      }),
  );

export function normalizeFolderPath(path: string): string {
  const parts = path
    .trim()
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return "/" + parts.join("/");
}

export const IssueId = z.string().regex(/^\d+$/, "issueId é numérico (use test.issueId, não a key)");
export const IssueIds = z.array(IssueId);

export const GetTestsInput = z.object({
  jql: z.string().min(1).max(5000),
  max: z.number().int().min(1).max(MAX_TESTS_PER_REQUEST).default(100),
});
export type GetTestsInput = z.input<typeof GetTestsInput>;

export const Labels = z.array(z.string().regex(/^\S{1,255}$/, "etiquetas sem espaços")).max(50);
export const FixVersions = z.array(z.string().min(1).max(255)).max(20);

const TestBase = z.object({
  project: ProjectRef.refine((p) => !/^\d+$/.test(p), "createTests precisa da chave do projeto (ex. DEMO)"),
  summary: z.string().min(1).max(255),
  folderPath: FolderPath.optional(),
  labels: Labels.optional(),
  fixVersions: FixVersions.optional(),
});

export const ManualStep = z.object({
  action: z.string().min(1),
  data: z.string().optional(),
  result: z.string().optional(),
});

export const CreateTestInput = z.discriminatedUnion("type", [
  TestBase.extend({ type: z.literal("Manual"), steps: z.array(ManualStep).max(200).default([]) }),
  TestBase.extend({ type: z.literal("Cucumber"), gherkin: z.string().min(1) }),
  TestBase.extend({ type: z.literal("Generic"), definition: z.string().min(1) }),
]);
export type CreateTestInput = z.input<typeof CreateTestInput>;

export const CreateTestsInput = z.array(CreateTestInput).min(1).max(MAX_CREATE_PER_CALL);

export const CreateFolderInput = z.object({
  project: ProjectRef,
  path: FolderPath.refine((p) => p !== "/", "não se pode criar a raiz"),
  testIssueIds: IssueIds.optional(),
});
export type CreateFolderInput = z.input<typeof CreateFolderInput>;

export const AddTestsToFolderInput = z.object({
  project: ProjectRef,
  path: FolderPath.refine((p) => p !== "/", "use uma pasta, não a raiz"),
  testIssueIds: IssueIds.min(1),
});
export type AddTestsToFolderInput = z.input<typeof AddTestsToFolderInput>;

export const GetFolderTreeInput = z.object({
  project: ProjectRef,
  path: FolderPath.default("/"),
});
export type GetFolderTreeInput = z.input<typeof GetFolderTreeInput>;

export const CountTestsInFolderInput = z.object({
  project: ProjectRef,
  path: FolderPath,
  includeDescendants: z.boolean().default(false),
});
export type CountTestsInFolderInput = z.input<typeof CountTestsInFolderInput>;

export const CreateTestPlanInput = z.object({
  project: ProjectRef.refine((p) => !/^\d+$/.test(p), "createTestPlan precisa da chave do projeto (ex. DEMO)"),
  summary: z.string().min(1).max(255),
  /** Versões Jira (têm de existir no projeto), ex. ["v1.0"]. */
  fixVersions: FixVersions.optional(),
  labels: Labels.optional(),
  testIssueIds: IssueIds.max(100).optional(),
});
export type CreateTestPlanInput = z.input<typeof CreateTestPlanInput>;

export const AddTestsToTestPlanInput = z.object({
  issueId: IssueId,
  testIssueIds: IssueIds.min(1),
});
export type AddTestsToTestPlanInput = z.input<typeof AddTestsToTestPlanInput>;

export const GetTestPlanTestsInput = z.object({
  issueId: IssueId,
  max: z.number().int().min(1).max(MAX_TESTS_PER_REQUEST).default(100),
});
export type GetTestPlanTestsInput = z.input<typeof GetTestPlanTestsInput>;

export const CleanupInput = z.object({
  project: ProjectRef.refine((p) => !/^\d+$/.test(p), "cleanup precisa da chave do projeto (ex. DEMO)"),
  /** Etiqueta a limpar; tem de começar por mcp-seed-. Por omissão a de hoje. */
  label: z
    .string()
    .regex(/^mcp-seed-[A-Za-z0-9._-]{1,200}$/, "só se limpam etiquetas mcp-seed-… (as que o servidor põe)")
    .optional(),
  /** Pastas adicionais a apagar (com as subpastas). Nunca a raiz. */
  folders: z.array(FolderPath.refine((p) => p !== "/", "não se apaga a raiz")).max(100).optional(),
  /** Só conta o que apagaria. */
  dryRun: z.boolean().optional(),
});
export type CleanupInput = z.input<typeof CleanupInput>;

export const GraphQLInput = z.object({
  query: z.string().min(1).max(100_000),
  variables: z.record(z.string(), z.unknown()).default({}),
});
export type GraphQLInput = z.input<typeof GraphQLInput>;

export class XrayValidationError extends Error {
  override name = "XrayValidationError";
}

export function parseInput<S extends z.ZodType>(fn: string, schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new XrayValidationError(`${fn}: entrada inválida\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
