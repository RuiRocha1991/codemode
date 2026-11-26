# Segunda parte: gateway Code Mode (XMCM-32)

> **Branch de release: `release/gateway-code-mode`.** Todo o trabalho desta parte tem os PRs com base
> nesta branch e **nunca é juntado ao `main`**. O `main` fica com a versão de 2/12 (servidor Xray em Code Mode).

## Objetivo

Um gateway que liga a **servidores MCP normais** (Xray, Jira, outros), gera uma API TypeScript a partir dos esquemas
das suas ferramentas e corre o código do assistente **na mesma sandbox**. Assim um só script faz, por exemplo,
as versões no Jira e os Test Plans no Xray.

## Estrutura (workspaces npm)

| Pacote | Papel |
| --- | --- |
| `packages/codemode-core` (`@codemode/core`) | Sandbox, `CodeMode` (describe/execute) e registo das ferramentas MCP. **Não sabe nada do Xray.** |
| `src/` (`xray-mcp-codemode`) | Servidor MCP do Xray em Code Mode (versão de 2/12); usa o core |
| `packages/gateway` (`@codemode/gateway`) | Cliente MCP + geração da API TypeScript + servidor gateway (`describe`/`execute`) |

## Passos (um PR por passo, base `release/gateway-code-mode`)

1. ✅ **Extrair o core para um pacote** — sem mudar comportamento (PR #5).
2. ✅ **Gateway**: ligar a servidores MCP (stdio e HTTP), gerar declarações TS a partir dos JSON Schemas, expor
   `servers.<nome>.<ferramenta>()` na sandbox, ferramentas `describe`/`execute` do gateway.
3. **Autenticação por servidor, Xray como ferramentas clássicas (XMCM-27)** (variáveis de ambiente, cabeçalhos, OAuth da Atlassian), exemplo Jira + Xray num
   só script e documentação.

## Riscos a ter presentes

- Cada MCP tem a sua autenticação; o OAuth da Atlassian exige uma sessão interativa.
- O gateway executa ferramentas de **vários** sistemas num só código gerado: o raio de ação é maior. A sandbox
  continua sem rede nem segredos; as credenciais ficam só no processo do gateway.
- Os nomes e esquemas das ferramentas vêm de servidores externos: tratar como dados não confiáveis (nomes
  validados antes de virarem identificadores).
