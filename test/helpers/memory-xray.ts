import { operationName } from "../../src/xray/graphql.js";
import type { GraphQLCall } from "./fake-xray.js";

/**
 * Xray em memória para testes: responde às operações GraphQL que a API xray usa,
 * com as regras que importam (limit 1–100, pasta-mãe tem de existir, pasta duplicada falha).
 * Não pretende ser fiel em tudo; os testes de integração contra o local é que confirmam.
 */
interface MemTest {
  issueId: string;
  key: string;
  projectId: string;
  type: string;
  summary: string;
  labels: string[];
  fixVersions: string[];
  folderPath: string;
}

interface MemPlan {
  issueId: string;
  key: string;
  projectId: string;
  summary: string;
  labels: string[];
  fixVersions: string[];
  tests: string[];
}

class GraphQLFailure extends Error {}

export class MemoryXray {
  readonly projects = new Map<string, string>([["DEMO", "10000"]]);
  readonly tests = new Map<string, MemTest>();
  readonly plans = new Map<string, MemPlan>();
  /** projectId → caminhos de pastas existentes (sempre com "/"). */
  readonly folders = new Map<string, Set<string>>();
  readonly ops: string[] = [];
  private nextId = 20000;
  private keyCounters = new Map<string, number>();

  constructor(projects?: Record<string, string>) {
    if (projects) for (const [k, v] of Object.entries(projects)) this.projects.set(k, v);
    for (const id of this.projects.values()) this.folders.set(id, new Set(["/"]));
  }

  /** Handler para fakeFetch: devolve data ou um Response com erros GraphQL. */
  handle = (call: GraphQLCall): unknown => {
    const op = operationName(call.query);
    this.ops.push(op);
    try {
      return this.dispatch(op, call.variables, call.query);
    } catch (err) {
      if (err instanceof GraphQLFailure) {
        return new Response(JSON.stringify({ errors: [{ message: err.message }] }), {
          headers: { "content-type": "application/json" },
        });
      }
      throw err;
    }
  };

  private dispatch(op: string, v: Record<string, unknown>, query: string): unknown {
    switch (op) {
      case "WhoAmI":
        return { __typename: "Query" };
      case "GetTests":
        return { getTests: this.getTests(v) };
      case "CreateTest":
        return { createTest: this.createTest(v) };
      case "CreateFolder":
        return { createFolder: this.createFolder(v) };
      case "AddTestsToFolder":
        return { addTestsToFolder: this.addTestsToFolder(v) };
      case "GetFolder":
        return { getFolder: this.getFolder(v) };
      case "DeleteFolder":
        return { deleteFolder: this.deleteFolder(v) };
      case "CreateTestPlan":
        return { createTestPlan: this.createTestPlan(v) };
      case "AddTestsToTestPlan":
        return { addTestsToTestPlan: this.addTestsToTestPlan(v) };
      case "GetTestPlan":
        return { getTestPlan: this.getTestPlan(v) };
      case "GetTestPlans":
        return { getTestPlans: this.getTestPlans(v) };
      case "DeleteTest":
        return { deleteTest: this.deleteIssue(this.tests, v) };
      case "DeleteTestPlan":
        return { deleteTestPlan: this.deleteIssue(this.plans, v) };
      default:
        throw new GraphQLFailure(`operação desconhecida no Xray em memória: ${op} (${query.slice(0, 60)})`);
    }
  }

  // ---------- ajudas ----------

  projectIdOf(key: string): string {
    const id = this.projects.get(key);
    if (!id) throw new GraphQLFailure(`projeto ${key} não existe`);
    return id;
  }

  private projectKeyOf(projectId: string): string {
    for (const [k, v] of this.projects) if (v === projectId) return k;
    throw new GraphQLFailure(`projeto ${projectId} não existe`);
  }

  private newIssue(projectKey: string): { issueId: string; key: string } {
    const n = (this.keyCounters.get(projectKey) ?? 0) + 1;
    this.keyCounters.set(projectKey, n);
    return { issueId: String(this.nextId++), key: `${projectKey}-${n}` };
  }

  private foldersOf(projectId: string): Set<string> {
    const set = this.folders.get(projectId);
    if (!set) throw new GraphQLFailure(`projeto ${projectId} não existe`);
    return set;
  }

  private checkLimit(v: Record<string, unknown>): { limit: number; start: number } {
    const limit = Number(v.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new GraphQLFailure("limit must be between 1 and 100");
    return { limit, start: Number(v.start ?? 0) };
  }

  /** JQL mínimo: project = X, labels = X, key in (A, B), issue in (...), ligados por AND. */
  private matchesJql(issue: { key: string; projectId: string; labels: string[] }, jql: string): boolean {
    return jql.split(/\s+AND\s+/i).every((clause) => {
      let m = /^\s*project\s*=\s*"?([A-Z0-9_]+)"?\s*$/i.exec(clause);
      if (m) return this.projects.get(m[1]!) === issue.projectId;
      m = /^\s*labels\s*=\s*"?([^"\s]+)"?\s*$/i.exec(clause);
      if (m) return issue.labels.includes(m[1]!);
      m = /^\s*(key|issue)\s+in\s*\(([^)]*)\)\s*$/i.exec(clause);
      if (m) return m[2]!.split(",").map((s) => s.trim().replace(/"/g, "")).includes(issue.key);
      throw new GraphQLFailure(`JQL não suportado no Xray em memória: ${clause}`);
    });
  }

  private rawTest(t: MemTest) {
    return {
      issueId: t.issueId,
      projectId: t.projectId,
      testType: { name: t.type },
      folder: { path: t.folderPath },
      jira: { key: t.key, summary: t.summary, labels: t.labels },
    };
  }

  private page<T>(items: T[], v: Record<string, unknown>) {
    const { limit, start } = this.checkLimit(v);
    return { total: items.length, start, limit, results: items.slice(start, start + limit) };
  }

  private jiraFields(v: Record<string, unknown>) {
    const jira = v.jira as { fields?: Record<string, unknown> } | undefined;
    const f = jira?.fields;
    if (!f) throw new GraphQLFailure("jira.fields é obrigatório");
    const projectKey = (f.project as { key?: string } | undefined)?.key;
    if (!projectKey) throw new GraphQLFailure("jira.fields.project.key é obrigatório");
    if (typeof f.summary !== "string") throw new GraphQLFailure("jira.fields.summary é obrigatório");
    return {
      projectKey,
      summary: f.summary,
      labels: (f.labels as string[] | undefined) ?? [],
      fixVersions: ((f.fixVersions as { name: string }[] | undefined) ?? []).map((x) => x.name),
    };
  }

  // ---------- operações ----------

  private getTests(v: Record<string, unknown>) {
    let list = [...this.tests.values()];
    if (typeof v.jql === "string") list = list.filter((t) => this.matchesJql(t, v.jql as string));
    if (typeof v.projectId === "string") list = list.filter((t) => t.projectId === v.projectId);
    const folder = v.folder as { path: string; includeDescendants?: boolean } | undefined;
    if (folder) {
      if (typeof v.projectId !== "string") throw new GraphQLFailure("folder exige projectId");
      list = list.filter((t) =>
        folder.includeDescendants
          ? t.folderPath === folder.path || t.folderPath.startsWith(folder.path === "/" ? "/" : folder.path + "/")
          : t.folderPath === folder.path,
      );
    }
    return this.page(list.map((t) => this.rawTest(t)), v);
  }

  private createTest(v: Record<string, unknown>) {
    const f = this.jiraFields(v);
    const projectId = this.projectIdOf(f.projectKey);
    const type = (v.testType as { name?: string } | undefined)?.name ?? "Manual";
    if (!["Manual", "Cucumber", "Generic"].includes(type)) throw new GraphQLFailure(`tipo de teste ${type} inválido`);
    if (type === "Cucumber" && typeof v.gherkin !== "string") throw new GraphQLFailure("gherkin em falta");
    if (type === "Generic" && typeof v.unstructured !== "string") throw new GraphQLFailure("unstructured em falta");
    const folderPath = (v.folderPath as string | undefined) ?? "/";
    if (!this.foldersOf(projectId).has(folderPath)) throw new GraphQLFailure(`a pasta ${folderPath} não existe`);
    const { issueId, key } = this.newIssue(f.projectKey);
    const test: MemTest = { issueId, key, projectId, type, summary: f.summary, labels: f.labels, fixVersions: f.fixVersions, folderPath };
    this.tests.set(issueId, test);
    return { test: { issueId, projectId, testType: { name: type }, jira: { key } }, warnings: [] };
  }

  private folderResult(projectId: string, path: string) {
    const name = path === "/" ? "" : path.slice(path.lastIndexOf("/") + 1);
    const testsCount = [...this.tests.values()].filter((t) => t.projectId === projectId && t.folderPath === path).length;
    return { name, path, testsCount };
  }

  private moveTests(projectId: string, path: string, ids: string[]) {
    for (const id of ids) {
      const t = this.tests.get(id);
      if (!t || t.projectId !== projectId) throw new GraphQLFailure(`teste ${id} não existe no projeto`);
      t.folderPath = path;
    }
  }

  private createFolder(v: Record<string, unknown>) {
    const projectId = String(v.projectId);
    const path = String(v.path);
    const set = this.foldersOf(projectId);
    if (set.has(path)) throw new GraphQLFailure(`A folder with the path ${path} already exists`);
    const parent = path.slice(0, path.lastIndexOf("/")) || "/";
    if (!set.has(parent)) throw new GraphQLFailure(`The parent folder ${parent} does not exist`);
    set.add(path);
    this.moveTests(projectId, path, (v.testIssueIds as string[] | undefined) ?? []);
    return { folder: this.folderResult(projectId, path), warnings: [] };
  }

  private addTestsToFolder(v: Record<string, unknown>) {
    const projectId = String(v.projectId);
    const path = String(v.path);
    if (!this.foldersOf(projectId).has(path)) throw new GraphQLFailure(`a pasta ${path} não existe`);
    const ids = v.testIssueIds as string[];
    if (ids.length > 100) throw new GraphQLFailure("no máximo 100 testes por pedido");
    this.moveTests(projectId, path, ids);
    return { folder: this.folderResult(projectId, path), warnings: [] };
  }

  private subtree(projectId: string, path: string): unknown[] {
    const prefix = path === "/" ? "/" : path + "/";
    return [...this.foldersOf(projectId)]
      .filter((p) => p !== path && p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
      .sort()
      .map((p) => ({ ...this.folderResult(projectId, p), folders: this.subtree(projectId, p) }));
  }

  private getFolder(v: Record<string, unknown>) {
    const projectId = String(v.projectId);
    const path = String(v.path);
    if (!this.foldersOf(projectId).has(path)) throw new GraphQLFailure(`a pasta ${path} não existe`);
    return { ...this.folderResult(projectId, path), folders: this.subtree(projectId, path) };
  }

  private deleteFolder(v: Record<string, unknown>) {
    const projectId = String(v.projectId);
    const path = String(v.path);
    const set = this.foldersOf(projectId);
    if (!set.has(path) || path === "/") throw new GraphQLFailure(`a pasta ${path} não existe`);
    for (const p of [...set]) if (p === path || p.startsWith(path + "/")) set.delete(p);
    for (const t of this.tests.values()) {
      if (t.projectId === projectId && (t.folderPath === path || t.folderPath.startsWith(path + "/"))) t.folderPath = "/";
    }
    return "ok";
  }

  private createTestPlan(v: Record<string, unknown>) {
    const f = this.jiraFields(v);
    const projectId = this.projectIdOf(f.projectKey);
    const { issueId, key } = this.newIssue(f.projectKey);
    const tests = (v.testIssueIds as string[] | undefined) ?? [];
    this.plans.set(issueId, { issueId, key, projectId, summary: f.summary, labels: f.labels, fixVersions: f.fixVersions, tests: [...tests] });
    return { testPlan: { issueId, jira: { key } }, warnings: [] };
  }

  private addTestsToTestPlan(v: Record<string, unknown>) {
    const plan = this.plans.get(String(v.issueId));
    if (!plan) throw new GraphQLFailure(`test plan ${String(v.issueId)} não existe`);
    const ids = v.testIssueIds as string[];
    const added = ids.filter((id) => !plan.tests.includes(id));
    plan.tests.push(...added);
    return { addedTests: added, warning: null };
  }

  private getTestPlan(v: Record<string, unknown>) {
    const plan = this.plans.get(String(v.issueId));
    if (!plan) return null;
    const tests = plan.tests.map((id) => this.tests.get(id)).filter((t): t is MemTest => !!t);
    return {
      issueId: plan.issueId,
      jira: { key: plan.key, summary: plan.summary, labels: plan.labels, fixVersions: plan.fixVersions.map((name) => ({ name })) },
      tests: this.page(tests.map((t) => this.rawTest(t)), v),
    };
  }

  private getTestPlans(v: Record<string, unknown>) {
    let list = [...this.plans.values()];
    if (typeof v.jql === "string") list = list.filter((p) => this.matchesJql(p, v.jql as string));
    return this.page(
      list.map((p) => ({ issueId: p.issueId, jira: { key: p.key, summary: p.summary, labels: p.labels } })),
      v,
    );
  }

  private deleteIssue(map: Map<string, unknown>, v: Record<string, unknown>) {
    const id = String(v.issueId);
    if (!map.delete(id)) throw new GraphQLFailure(`issue ${id} não existe`);
    return "ok";
  }

  // ---------- semear ----------

  /** Cria testes diretamente, para preparar cenários. */
  seedTests(projectKey: string, n: number, type = "Manual", labels: string[] = []): MemTest[] {
    const projectId = this.projectIdOf(projectKey);
    return Array.from({ length: n }, (_, i) => {
      const { issueId, key } = this.newIssue(projectKey);
      const t: MemTest = { issueId, key, projectId, type, summary: `Teste ${i + 1}`, labels, fixVersions: [], folderPath: "/" };
      this.tests.set(issueId, t);
      return t;
    });
  }

  folderOfTest(issueId: string): string | undefined {
    return this.tests.get(issueId)?.folderPath;
  }

  projectKeyFor(projectId: string): string {
    return this.projectKeyOf(projectId);
  }
}
