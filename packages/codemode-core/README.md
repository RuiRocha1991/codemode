# @codemode/core

Code Mode genérico: recebe um objeto de API qualquer (funções que trocam JSON) e as suas declarações TypeScript,
e oferece `describe` e `execute`, com o código gerado a correr numa sandbox `isolated-vm` (sem rede, ficheiros,
`process` nem `require`). **Não sabe nada do Xray**: é usado pelo servidor `xray-mcp-codemode` e pelo gateway.

```ts
const codeMode = new CodeMode({ api: { name: "calc", functions: { add: ({ a, b }) => a + b }, declarations } });
const result = await codeMode.execute("return await calc.add({ a: 1, b: 2 })"); // { ok: true, value: 3, ... }
registerCodeModeTools(mcpServer, codeMode); // regista as ferramentas MCP describe e execute
```

Segurança e limites: ver `docs/decisao-sandbox.md` na raiz. Testes em `test/`.
