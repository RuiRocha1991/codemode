# Operações GraphQL do Xray usadas pela API xray

Estado: **a confirmar contra o schema local** com `XRAY_ENV=local npm run introspect` (XMCM-12).
A lista vive em `src/xray/schema-contract.ts`; o script compara-a com o schema real, aponta
operações ou argumentos em falta e guarda o schema resumido em `docs/schema/<ambiente>.json`.

Os nomes abaixo seguem a API GraphQL pública do Xray Cloud (v2). Ficaram por confirmar na
sessão em que foram escritos, porque a documentação web não estava acessível: é o primeiro
passo a correr com credenciais.

| Função xray | Operação GraphQL | Argumentos usados | Nota |
| --- | --- | --- | --- |
| getTests | `getTests` | jql, projectId, folder, limit, start | `limit` entre 1 e 100; a função pagina com `start` |
| createTests | `createTest` | testType, steps, gherkin, unstructured, folderPath, jira | Uma mutação por teste, concorrência 5, com retry |
| createFolder | `createFolder` | projectId, path, testIssueIds | Cria e enche numa chamada; cria os antecessores em falta |
| addTestsToFolder | `addTestsToFolder` | projectId, path, testIssueIds | Por lotes de 100 |
| getFolderTree | `getFolder` | projectId, path | O campo `folders` é JSON com a subárvore |
| createTestPlan | `createTestPlan` | testIssueIds, jira | A versão vai em `jira.fields.fixVersions` |
| addTestsToTestPlan | `addTestsToTestPlan` | issueId, testIssueIds | Por lotes de 100 |
| getTestPlanTests | `getTestPlan` | issueId | Verificação do cenário B |
| cleanup | `deleteTest`, `deleteTestPlan`, `deleteFolder`, `getTestPlans` | — | Limpeza por etiqueta (XMCM-28) |

## Autenticação

`POST {baseUrl}/api/v2/authenticate` com `{ "client_id", "client_secret" }` devolve o token
como string JSON. Os pedidos GraphQL vão para `POST {baseUrl}/api/v2/graphql` com
`Authorization: Bearer <token>`. Os dois caminhos podem mudar por ambiente em
`config/environments.json` (`authPath`, `graphqlPath`) se o local ou o staging forem diferentes.
