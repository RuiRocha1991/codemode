# Cenários A e B com o Claude (XMCM-25)

Critério de saída do M1: cada cenário corre **com uma chamada `execute`** no Claude Code com
`xray-local`, e a verificação passa.

## Preparar

```bash
npm run build
export XRAY_LOCAL_CLIENT_ID=… XRAY_LOCAL_CLIENT_SECRET=…
claude mcp add xray-local -e XRAY_ENV=local -- node "$(pwd)/dist/index.js"   # segredos: ver README
```

Projeto de testes (por exemplo `DEMO`) com pelo menos 200 testes para o cenário A
(`npm run scenario:a -- --project DEMO --create-tests` cria-os) e as versões `v1.0`, `v1.1`
e `v2.0` criadas no Jira para o cenário B.

## Pedidos em linguagem natural

**A.** «No projeto DEMO, cria 10 pastas com vários níveis e nomes aleatórios no Test Repository
e espalha 200 testes por elas. Verifica lendo a árvore de volta.»

**B.** «No projeto DEMO, cria testes Manual, Cucumber e Generic. Cria 3 Test Plans, um por
versão (v1.0, v1.1, v2.0), com alguns testes cada. Cria uma pasta por versão com subpastas por
tipo, por exemplo /v1.0/Cucumber, e põe lá os testes certos. Verifica que cada pasta só tem
testes desse tipo e dessa versão.»

O Claude deve: chamar `describe` uma vez, escrever **uma** chamada `execute` e devolver só números.

## O que o Claude escreve

`examples/cenario-a.js` e `examples/cenario-b.js` são o código típico para cada pedido. Os testes
(`test/scenario-b.test.ts`) correm-nos contra o servidor MCP real com um Xray em memória:
cenário A com ~25 chamadas à API numa só `execute` (em vez de ~210 chamadas de ferramentas).

## Sem IA (para comparar e para teste de integração)

```bash
XRAY_ENV=local npm run scenario:a -- --project DEMO --create-tests
XRAY_ENV=local npm run scenario:b -- --project DEMO
```

## Registo do resultado (a preencher no local)

| Data | Ambiente | Cenário | 1 execute? | Verificação | Duração | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| _por preencher_ | local | A | | | | |
| _por preencher_ | local | B | | | | |
