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

## Como funciona

| Passo | Detalhe |
| --- | --- |
| API gerada | `mcp.<servidor>.<ferramenta>(input)`; o JSON Schema de cada ferramenta vira TypeScript com comentários; anotações `destructiveHint`/`readOnlyHint` aparecem no comentário |
| Resultados | `isError` lança (o código pode apanhar); `structuredContent` devolve-se tal e qual; um texto JSON é analisado; o resto vem como texto/lista |
| Nomes | Nomes de ferramentas e esquemas vêm de servidores externos e são **dados não confiáveis**: viram identificadores seguros (`create-version` → `create_version`), `constructor`/`prototype` ficam de fora, descrições não conseguem fechar comentários nem injetar código |
| Sandbox | A mesma do `@codemode/core`: sem rede, ficheiros, `process`; só o objeto `mcp` congelado. As credenciais ficam no processo do gateway, nunca na sandbox |

## Limites conhecidos

- **OAuth da Atlassian** (servidor remoto oficial) exige sessão interativa e **não está implementado**: use um servidor com token de API
  (por exemplo `mcp-atlassian`) ou envie o token em `headers` num servidor `http`. Os nomes das ferramentas do `mcp-atlassian` no exemplo não foram verificados.
- O servidor Xray atual só expõe `describe`/`execute`/`whoami`; para o gateway é preciso expô-lo também como ferramentas clássicas (XMCM-27).
- Só ferramentas MCP (não recursos nem prompts).
