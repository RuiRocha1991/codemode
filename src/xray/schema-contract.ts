/**
 * Operações GraphQL de que a API xray depende, com os argumentos que usa.
 * `npm run introspect` compara esta lista com o schema real de um ambiente (XMCM-12).
 * Se a introspeção mostrar outro nome ou argumento, corrige-se aqui e no módulo src/xray/api.ts.
 */
export interface ExpectedOperation {
  kind: "query" | "mutation";
  name: string;
  args: string[];
  usedBy: string;
}

export const EXPECTED_OPERATIONS: ExpectedOperation[] = [
  { kind: "query", name: "getTests", args: ["jql", "projectId", "folder", "limit", "start"], usedBy: "getTests, countTestsInFolder" },
  { kind: "query", name: "getFolder", args: ["projectId", "path"], usedBy: "getFolderTree" },
  { kind: "query", name: "getTestPlans", args: ["jql", "limit", "start"], usedBy: "cleanup" },
  { kind: "query", name: "getTestPlan", args: ["issueId"], usedBy: "getTestPlanTests" },
  {
    kind: "mutation",
    name: "createTest",
    args: ["testType", "steps", "gherkin", "unstructured", "folderPath", "jira"],
    usedBy: "createTests",
  },
  { kind: "mutation", name: "createFolder", args: ["projectId", "path", "testIssueIds"], usedBy: "createFolder" },
  { kind: "mutation", name: "addTestsToFolder", args: ["projectId", "path", "testIssueIds"], usedBy: "addTestsToFolder" },
  { kind: "mutation", name: "deleteFolder", args: ["projectId", "path"], usedBy: "cleanup" },
  { kind: "mutation", name: "createTestPlan", args: ["testIssueIds", "jira"], usedBy: "createTestPlan" },
  { kind: "mutation", name: "addTestsToTestPlan", args: ["issueId", "testIssueIds"], usedBy: "addTestsToTestPlan" },
  { kind: "mutation", name: "deleteTest", args: ["issueId"], usedBy: "cleanup" },
  { kind: "mutation", name: "deleteTestPlan", args: ["issueId"], usedBy: "cleanup" },
];

export const INTROSPECTION_QUERY = /* GraphQL */ `
  query Introspect {
    __schema {
      queryType { fields { name args { name } } }
      mutationType { fields { name args { name } } }
    }
  }
`;

export interface IntrospectionResult {
  __schema: {
    queryType: { fields: { name: string; args: { name: string }[] }[] } | null;
    mutationType: { fields: { name: string; args: { name: string }[] }[] } | null;
  };
}

export interface ContractCheck {
  operation: ExpectedOperation;
  found: boolean;
  missingArgs: string[];
  extraArgs: string[];
}

export function checkContract(schema: IntrospectionResult, expected = EXPECTED_OPERATIONS): ContractCheck[] {
  const index = {
    query: new Map((schema.__schema.queryType?.fields ?? []).map((f) => [f.name, f.args.map((a) => a.name)])),
    mutation: new Map((schema.__schema.mutationType?.fields ?? []).map((f) => [f.name, f.args.map((a) => a.name)])),
  };
  return expected.map((operation) => {
    const args = index[operation.kind].get(operation.name);
    if (!args) return { operation, found: false, missingArgs: operation.args, extraArgs: [] };
    return {
      operation,
      found: true,
      missingArgs: operation.args.filter((a) => !args.includes(a)),
      extraArgs: args.filter((a) => !operation.args.includes(a)),
    };
  });
}
