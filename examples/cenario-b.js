// Cenário B — o que o Claude escreve para: "cria testes Manual, Cucumber e Generic; 3 Test Plans,
// um por versão; uma pasta por versão com subpastas por tipo". Uma única chamada execute.
const project = "DEMO";
const root = "/mcp-seed-cenarioB-claude";
const label = "cenarioB-claude";
const versoes = ["v1.0", "v1.1", "v2.0"];
const tipos = ["Manual", "Cucumber", "Generic"];

// Precisamos de pelo menos um teste no projeto para as pastas saberem o projeto.
if ((await xray.getTests({ jql: `project = ${project}`, max: 1 })).length === 0) {
  await xray.createTests([{ type: "Generic", project, summary: "Teste inicial", definition: "x" }]);
}

await xray.createFolder({ project, path: root });
for (const v of versoes) {
  await xray.createFolder({ project, path: `${root}/${v}` });
  for (const t of tipos) await xray.createFolder({ project, path: `${root}/${v}/${t}` });
}

const novo = (v, tipo, i) => {
  const base = { project, summary: `${v} ${tipo} ${i}`, folderPath: `${root}/${v}/${tipo}`, labels: [label], fixVersions: [v] };
  if (tipo === "Manual") return { ...base, type: tipo, steps: [{ action: "Executar", result: "Passa" }] };
  if (tipo === "Cucumber") return { ...base, type: tipo, gherkin: `Feature: ${v} ${i}\n  Scenario: ok\n    Given x\n    Then y` };
  return { ...base, type: tipo, definition: `Verificar ${v} ${i}` };
};

const planos = {};
for (const v of versoes) {
  const criados = await xray.createTests(tipos.flatMap((t) => [1, 2, 3, 4].map((i) => novo(v, t, i))));
  const plano = await xray.createTestPlan({
    project, summary: `Plano ${v}`, fixVersions: [v], labels: [label],
    testIssueIds: criados.map((c) => c.issueId),
  });
  planos[v] = plano.key;
}

// Verificação: cada pasta tem só testes do seu tipo e da sua versão; cada plano tem os seus 12.
const todos = await xray.getTests({ jql: `project = ${project} AND labels = ${label}`, max: 500 });
const erros = [];
for (const v of versoes) for (const t of tipos) {
  const path = `${root}/${v}/${t}`;
  const naPasta = todos.filter((x) => x.folderPath === path);
  if (naPasta.length !== 4 || naPasta.some((x) => x.testType !== t || !x.summary.startsWith(v))) erros.push(path);
}
return { planos, testes: todos.length, erros };
