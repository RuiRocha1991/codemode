// Cenário A — o que o Claude escreve para: "cria 10 pastas com vários níveis e nomes
// aleatórios e espalha 200 testes por elas". Uma única chamada execute.
const project = "DEMO";
const root = "/mcp-seed-cenarioA-claude";
const nomes = ["Alfa", "Beta", "Gama", "Delta", "Epsilon", "Zeta", "Eta", "Theta", "Iota", "Kappa"]
  .sort(() => Math.random() - 0.5);

// Estrutura em árvore com vários níveis: cada pasta fica na raiz ou debaixo de uma anterior.
const caminhos = [];
for (const nome of nomes) {
  const pais = [root, ...caminhos.filter((c) => c.split("/").length < root.split("/").length + 3)];
  caminhos.push(`${pais[Math.floor(Math.random() * pais.length)]}/${nome}`);
}

const testes = await xray.getTests({ jql: `project = ${project}`, max: 200 });
if (testes.length < 200) throw new Error(`Só há ${testes.length} testes no projeto`);

await xray.createFolder({ project, path: root });
for (const path of caminhos) await xray.createFolder({ project, path }); // pais antes dos filhos

const lotes = new Map(caminhos.map((c) => [c, []]));
for (const t of testes) lotes.get(caminhos[Math.floor(Math.random() * caminhos.length)]).push(t.issueId);
await Promise.all([...lotes].filter(([, ids]) => ids.length).map(([path, testIssueIds]) =>
  xray.addTestsToFolder({ project, path, testIssueIds })));

// Verificação: lê a árvore de volta e devolve só números.
const soma = (n) => n.testsCount + n.folders.reduce((s, f) => s + soma(f), 0);
const conta = (n) => n.folders.reduce((s, f) => s + 1 + conta(f), 0);
const arvore = await xray.getFolderTree({ project, path: root });
return { pastas: conta(arvore), testes: soma(arvore), caminhos };
