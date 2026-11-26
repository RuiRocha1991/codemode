# MCP Jira para o site de testes (XMCM-13)

O Jira entra por um MCP separado; este servidor só fala com o Xray. O cenário B precisa de
3 versões no projeto Jira de testes (por exemplo `v1.0`, `v1.1`, `v2.0`).

## Teste de 15 minutos: MCP oficial da Atlassian (Rovo)

```bash
claude mcp add --transport http atlassian https://mcp.atlassian.com/v1/mcp
```

No Claude Code, autenticar com `/mcp` (OAuth) escolhendo o **site Jira de testes**, e pedir:

> Lê a issue <CHAVE-1> do site <site-de-testes>.atlassian.net

- **Passa:** fica registado; confirmar também se consegue criar versões
  (“cria a versão v1.0 no projeto <CHAVE>”). Se não conseguir, criar as 3 versões à mão uma vez.
- **Falha** (o site não aparece, ou o OAuth não deixa escolher o site): usar o MCP da comunidade.

## Alternativa: MCP Jira da comunidade com token de API

[`sooperset/mcp-atlassian`](https://github.com/sooperset/mcp-atlassian) aceita URL e token:

```bash
claude mcp add jira-testes \
  -e JIRA_URL=https://<site-de-testes>.atlassian.net \
  -e JIRA_USERNAME=<email> \
  -e JIRA_API_TOKEN=$JIRA_TESTES_TOKEN \
  -- uvx mcp-atlassian
```

O token cria-se em https://id.atlassian.com/manage-profile/security/api-tokens e fica só na
shell, nunca no repositório.

## Registo do resultado

| Data | MCP | Lê issue | Cria versões | Notas |
| --- | --- | --- | --- | --- |
| _por preencher_ | | | | |
