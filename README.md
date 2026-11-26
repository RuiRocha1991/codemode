# xray-mcp-codemode

Servidor MCP do **Xray Cloud** em **Code Mode**, para ambientes de desenvolvimento (**local** e **staging**).
Um assistente de IA cria e organiza dados de teste (testes, pastas, Test Plans) em linguagem natural: em vez
de dezenas de chamadas de ferramentas, escreve **código** contra uma API `xray` tipada e o servidor corre-o
numa sandbox isolada. Uma chamada `execute` faz o trabalho de ~200.

- Jira: projeto **XMCM**
- Fora de âmbito (e bloqueado no código): produção dos clientes (`prod-us`, `prod-eu`)

## Requisitos

- **Node 22 ou superior** (o `isolated-vm`, que isola o código gerado, exige Node 22+)
- Um utilizador de serviço do Xray com **API Key** (client_id e client_secret) **por ambiente**, com o mínimo de permissões
- Um projeto Jira de testes. Para o cenário B, as versões `v1.0`, `v1.1` e `v2.0` têm de existir (ver [docs/mcp-jira.md](docs/mcp-jira.md))

## Instalar

```bash
git clone https://github.com/RuiRocha1991/codemode.git
cd codemode
npm ci
npm run build
```

`isolated-vm` é um módulo nativo: traz binários prontos para Node 22+ nas plataformas comuns; se não houver,
compila com `node-gyp` (precisa de Python e de um compilador C++).

## Configurar ambientes

Os URLs ficam em [`config/environments.json`](config/environments.json) (no repositório, **sem segredos**):

| Ambiente | Estado | Nota |
| --- | --- | --- |
| `local` | ligado | `http://localhost:3001` (API REST do Xray local; sobreponha com `XRAY_BASE_URL`) |
| `staging` | ligado | URL marcador — **ponha o URL real** |
| `prod-us`, `prod-eu` | **desligados e bloqueados** | o código recusa arrancar; um URL `*.xray.cloud.getxray.app` é recusado mesmo vindo de `XRAY_BASE_URL` |

Se o local ou o staging tiverem caminhos diferentes da API pública, defina `authPath` e `graphqlPath` na entrada
(por omissão `/api/v2/authenticate` e `/api/v2/graphql`).

**Segredos só em variáveis de ambiente** (nunca no repositório; `.env` está no `.gitignore`, veja `.env.example`):

```bash
export XRAY_LOCAL_CLIENT_ID=…    XRAY_LOCAL_CLIENT_SECRET=…
export XRAY_STAGING_CLIENT_ID=…  XRAY_STAGING_CLIENT_SECRET=…
```

## Registar no Claude Code

Uma instância por ambiente: o ambiente está sempre visível e é impossível escrever no errado.

```bash
claude mcp add xray-local   -e XRAY_ENV=local   -- node "$(pwd)/dist/index.js"
claude mcp add xray-staging -e XRAY_ENV=staging -- node "$(pwd)/dist/index.js"
```

Os segredos têm de chegar ao processo do servidor como variáveis de ambiente. Confirme com `whoami` que chegam; se
o Claude Code não as herdar da sua shell, passe-as no registo com `-e XRAY_LOCAL_CLIENT_ID=… -e XRAY_LOCAL_CLIENT_SECRET=…`
(ficam na configuração do Claude Code, fora do repositório). Para o Jira (criar versões, ler issues), registe um MCP Jira
separado: [docs/mcp-jira.md](docs/mcp-jira.md).

**Remover:** `claude mcp remove xray-local` e `claude mcp remove xray-staging`. Os dados de teste criados
saem com a limpeza por etiqueta (abaixo).

## Verificar que funciona

No Claude Code: «Em que ambiente estás?» → a ferramenta `whoami` devolve `local` com autenticação válida.

Primeira vez num ambiente novo: confirme os nomes das operações GraphQL contra o schema real:

```bash
XRAY_ENV=local npm run introspect
```

## Usar

Peça em linguagem natural. O assistente chama `describe` (declarações TypeScript da API) e depois **uma**
`execute` com o código. Exemplos em [docs/cenarios.md](docs/cenarios.md):

> «No projeto DEMO, cria 10 pastas com vários níveis e nomes aleatórios e espalha 200 testes por elas.»
>
> «Cria testes Manual, Cucumber e Generic, 3 Test Plans (um por versão) e uma pasta por versão com subpastas por tipo.»

### Ferramentas MCP

| Ferramenta | O que faz |
| --- | --- |
| `describe` | Devolve as declarações TypeScript da API `xray` e o ambiente da instância |
| `execute` | Corre código na sandbox com o objeto `xray` já autenticado; devolve só o valor final |
| `whoami` | Ambiente da instância e confirmação de que a autenticação funciona |

### Modos (`XRAY_MODE`)

| Valor | Ferramentas expostas |
| --- | --- |
| `codemode` (omissão) | `describe`, `execute`, `whoami` |
| `tools` | `whoami` + uma ferramenta MCP clássica por operação (`getTests`, `createTests`, `createFolder`, `addTestsToFolder`, `getFolderTree`, `countTestsInFolder`, `createTestPlan`, `addTestsToTestPlan`, `getTestPlanTests`, `cleanup`) |
| `both` | Tudo |

`tools` é o que o [gateway](docs/gateway.md) usa: ele liga-se ao Xray como a qualquer servidor MCP e gera a API a partir
dos esquemas. `cleanup` vem marcada como destrutiva. As ferramentas clássicas usam a mesma `XrayApi`, por isso mantêm
a etiqueta automática `mcp-seed-…` e o bloqueio da produção. Um valor inválido impede o arranque.

### API `xray` na sandbox

`getTests` (JQL, paginado) · `createTests` (Manual, Cucumber, Generic; lote até 500) · `createFolder` ·
`addTestsToFolder` · `getFolderTree` · `countTestsInFolder` · `createTestPlan` · `addTestsToTestPlan` ·
`getTestPlanTests` · `cleanup` · `graphql` (para o resto da API).

Tudo o que o servidor cria leva a etiqueta `mcp-seed-AAAA-MM-DD`. **Limpeza:** `xray.cleanup({ project: "DEMO" })`
apaga os testes e planos com essa etiqueta e as pastas `/mcp-seed*`; `dryRun: true` só conta. Só aceita etiquetas
`mcp-seed-…`, por isso não toca em dados que o servidor não criou.

## Cenários sem IA e testes

```bash
npm run scenario:a -- --project DEMO --create-tests   # 10 pastas, 200 testes
npm run scenario:b -- --project DEMO                  # versões × tipos, 3 Test Plans
XRAY_ENV=staging npm run integration -- --project DEMO  # A + B + limpeza, em qualquer ambiente de teste
```

| Comando | O que faz |
| --- | --- |
| `npm run check` | typecheck, lint, testes, build e `npm audit` (corre em cada alteração, também no CI) |
| `npm test` | Testes unitários (vitest, sem rede) |
| `npm run introspect` | Compara as operações usadas com o schema real do ambiente |

## Segurança

- Segredos só em variáveis de ambiente; nunca em registos, erros nem na sandbox.
- **Produção bloqueada no código:** ambientes `production`/desligados e URLs de produção do Xray Cloud são recusados no arranque.
- Todas as entradas validadas com zod; variáveis GraphQL, nunca texto concatenado (as chaves de projeto que vão para JQL são validadas).
- **Sandbox** (`isolated-vm`): sem rede, ficheiros, `process`, `require` nem timers; só o objeto `xray` (congelado); tempo
  limite de 120 s, 128 MB de memória e resultado limitado. Depois de um timeout, nenhuma chamada nova chega à API.
  Detalhe e riscos aceites em [docs/decisao-sandbox.md](docs/decisao-sandbox.md).
- Corre código gerado por um assistente **em ambientes de teste**; não é um isolamento para código de terceiros não confiáveis.
- Dependências com versões fixas e `npm audit` em cada alteração.
- Registos (ambiente, operação, duração) vão para **stderr**; o stdout é do protocolo MCP.

## Decisões de arquitetura (Fase 3)

| Decisão | Porquê | Consequência |
| --- | --- | --- |
| Code Mode desde a primeira versão | Os cenários mexem em centenas de testes | Uma chamada por pedido; os dados não passam pelo contexto do modelo; exige sandbox |
| Code Mode dentro do servidor, num módulo separado (agora o pacote `packages/codemode-core`) | Fica pronto a 2/12 sem montar um gateway | O módulo recebe um objeto de API qualquer e não sabe que é o Xray: extrair para um gateway é mover código |
| Construir de raiz em TypeScript | Sem acesso ao código do MCP oficial | Mais trabalho; controlo total e sem terceiros com acesso aos segredos |
| Uma instância por ambiente | Evitar escrever no ambiente errado | Duas entradas no Claude Code |
| API tipada de primitivas; o assistente planeia | Cada pedido organiza os dados de forma diferente | Menos código; pedidos novos sem mexer no servidor |
| Produção bloqueada no código | Os clientes podem vir a usar produção | Abrir produção exige modo de simulação e confirmação (XMCM-34/35) |

Estrutura: `src/config` (ambientes) · `src/xray` (autenticação, cliente GraphQL, API tipada, declarações) ·
`packages/codemode-core` (**pacote `@codemode/core`**: sandbox, describe/execute, genérico, sem Xray) · `src/scenarios` · `scripts` · `examples` (código que o assistente escreve).

## Problemas comuns

- **`whoami` falha com HTTP 401/403:** client_id/secret errados para esse ambiente, ou o servidor local usa outro caminho de autenticação (`authPath`).
- **«Não encontrei testes no projeto X»:** as operações de pastas precisam do `projectId`; crie um teste primeiro (`createTests`) ou passe o ID numérico.
- **«The parent folder … does not exist»:** crie as pastas por ordem (`/A` antes de `/A/B`).
- **Falha a criar com versão:** a versão Jira tem de existir no projeto.
- **`npm ci` falha em `isolated-vm`:** falta Python/compilador C++ (ou Node < 22).
