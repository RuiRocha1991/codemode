// Jira + Xray numa só chamada `execute` do gateway:
// cria as versões no Jira e, para cada uma, uma pasta, testes e um Test Plan no Xray com essa fixVersion.
const project = "DEMO";
const versoes = ["v1.0", "v1.1"];
const raiz = "/mcp-seed-jira-xray";

// O Xray precisa de pelo menos um teste no projeto para as pastas saberem o projeto.
const existentes = await mcp.xray.getTests({ jql: `project = ${project}`, max: 1 });
if (existentes.length === 0) await mcp.xray.createTests({ tests: [{ type: "Generic", project, summary: "Teste inicial", definition: "x" }] });

await mcp.xray.createFolder({ project, path: raiz });
const resultado = {};
for (const v of versoes) {
  await mcp.jira.createVersion({ project, name: v });
  await mcp.xray.createFolder({ project, path: `${raiz}/${v}` });
  const criados = await mcp.xray.createTests({
    tests: [1, 2, 3].map((i) => ({ type: "Generic", project, summary: `${v} teste ${i}`, definition: `Verificar ${v} ${i}`, folderPath: `${raiz}/${v}`, fixVersions: [v] })),
  });
  const plano = await mcp.xray.createTestPlan({ project, summary: `Plano ${v}`, fixVersions: [v], testIssueIds: criados.map((t) => t.issueId) });
  resultado[v] = { plano: plano.key, testes: criados.map((t) => t.key) };
}
return resultado;
