# @codemode/gateway

Gateway **Code Mode** para vários servidores MCP. Liga-se a servidores MCP normais (stdio ou HTTP), gera uma API TypeScript
a partir dos esquemas das ferramentas deles e corre o código do assistente na sandbox do `@codemode/core`. Um só script
pode usar vários servidores:

```js
const versoes = ["v1.0", "v1.1", "v2.0"];
await Promise.all(versoes.map((name) => mcp.jira.createVersion({ project: "DEMO", name })));
for (const v of versoes) await mcp.xray.createTestPlan({ project: "DEMO", summary: "Plano " + v, fixVersions: [v] });
```

> Esta parte vive na branch `release/gateway-code-mode` e **não vai para o `main`**.

## Usar

```bash
npm run build
cp packages/gateway/gateway.config.example.json gateway.config.json   # editar
export JIRA_URL=… JIRA_USERNAME=… JIRA_API_TOKEN=… XRAY_LOCAL_CLIENT_ID=… XRAY_LOCAL_CLIENT_SECRET=…
claude mcp add gateway -e GATEWAY_CONFIG=$(pwd)/gateway.config.json -- node $(pwd)/packages/gateway/dist/main.js
```

Ferramentas expostas: `describe` (servidores, ferramentas e declarações; aceita `servers` para ver um de cada vez) e `execute`.

## Configuração

- **Sem segredos no ficheiro.** `"${NOME}"` é substituído pela variável de ambiente do gateway; se faltar, esse servidor aparece
  com erro no `describe` (com o *nome* da variável) e os outros continuam.
- Cada servidor `stdio` recebe **só** as variáveis seguras por omissão e as que declara em `env`: não herda os segredos dos outros.
- `tools.allow` / `tools.deny` (com `*`): `deny` ganha. **Esconda as ferramentas destrutivas** (`"*delete*"`); o código nem as vê.
- `timeoutMs`: limite por chamada a uma ferramenta (60 s por omissão); o `execute` tem os seus 120 s.
- Nomes de servidores: letras, dígitos e `_` (viram `mcp.<nome>`).

## Autenticação por servidor

Sem OAuth: o gateway só envia o token que lhe der. Num servidor `http`:

```json
"jira": { "transport": "http", "url": "https://mcp.exemplo.com/mcp", "auth": { "type": "bearer", "token": "${JIRA_TOKEN}" } }
"outro": { "transport": "http", "url": "…", "auth": { "type": "basic", "username": "${U}", "password": "${API_TOKEN}" } }
```

- `auth` e um cabeçalho `Authorization` em `headers` são mutuamente exclusivos (a configuração é recusada se vierem os dois). Outros cabeçalhos continuam em `headers`.
- Se o servidor responder 401/403, o servidor aparece no `describe` com o erro «recusou as credenciais», sem o token, e os outros continuam a funcionar.
- Servidores `stdio` recebem o segredo por `env` (`"JIRA_API_TOKEN": "${JIRA_API_TOKEN}"`).

## Exemplo Jira + Xray

[`examples/gateway-jira-xray.js`](../../examples/gateway-jira-xray.js) cria versões no Jira e, para cada uma, pasta, testes e Test Plan no Xray, numa só
`execute`. Com o Xray em `XRAY_MODE=tools` (ver `gateway.config.example.json`). O teste
[`test/gateway-jira-xray.e2e.test.ts`](../../test/gateway-jira-xray.e2e.test.ts) corre-o com processos reais (gateway, Xray por stdio, Jira falso por HTTP com bearer,
Xray falso): prova a integração, **não** o Jira nem o Xray reais.

## Como funciona

| Passo | Detalhe |
| --- | --- |
| API gerada | `mcp.<servidor>.<ferramenta>(input)`; o JSON Schema de cada ferramenta vira TypeScript com comentários; anotações `destructiveHint`/`readOnlyHint` aparecem no comentário |
| Resultados | `isError` lança (o código pode apanhar); `structuredContent` devolve-se tal e qual; um texto JSON é analisado; o resto vem como texto/lista |
| Nomes | Nomes de ferramentas e esquemas vêm de servidores externos e são **dados não confiáveis**: viram identificadores seguros (`create-version` → `create_version`), `constructor`/`prototype` ficam de fora, descrições não conseguem fechar comentários nem injetar código |
| Sandbox | A mesma do `@codemode/core`: sem rede, ficheiros, `process`; só o objeto `mcp` congelado. As credenciais ficam no processo do gateway, nunca na sandbox |

## Limites conhecidos

- **OAuth da Atlassian** (servidor remoto oficial) exige sessão interativa e **não está implementado**: use um servidor com token de API
  (por exemplo `mcp-atlassian`) ou `auth`/`headers` num servidor `http`. Os nomes das ferramentas do `mcp-atlassian` e o formato exato do seu `auth` **não foram verificados** contra o servidor real.
- O Xray tem de correr com `XRAY_MODE=tools` (ou `both`) para o gateway ver as suas ferramentas; no modo por omissão só há `describe`/`execute`/`whoami`.
- Só ferramentas MCP (não recursos nem prompts).
