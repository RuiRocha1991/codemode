import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { CodeMode } from "./codemode.js";

const MAX_CODE_CHARS = 100_000;

function text(value: unknown, isError = false): CallToolResult {
  return { ...(isError && { isError: true }), content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

/**
 * Regista as duas ferramentas do Code Mode: `describe` e `execute`.
 * São as únicas que o assistente precisa; o resto vai no código que ele escreve.
 */
export function registerCodeModeTools(server: McpServer, codeMode: CodeMode): void {
  server.registerTool(
    "describe",
    {
      title: "Descrever a API xray",
      description:
        "Devolve as declarações TypeScript da API `xray` (funções, argumentos, tipos), como usá-la e o ambiente desta instância. " +
        "Chame antes de escrever código para `execute`.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => text(codeMode.describe()),
  );

  server.registerTool(
    "execute",
    {
      title: "Executar código contra a API xray",
      description:
        "Corre código JavaScript numa sandbox isolada (sem rede, ficheiros nem process) com o objeto `xray` já autenticado e " +
        "preso ao ambiente desta instância. O código é o corpo de uma função async: use await e `return` para o resultado final. " +
        "Faça o trabalho todo numa só chamada (ciclos, Promise.all) e devolva só o que precisa (contagens, chaves, amostras). " +
        "Tempo limite de 120 s. Escreve dados reais no ambiente: confirme o ambiente com `describe`.",
      inputSchema: { code: z.string().min(1).max(MAX_CODE_CHARS).describe("Corpo da função async a executar") },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ code }) => {
      const result = await codeMode.execute(code);
      if (result.ok) {
        return text({ value: result.value ?? null, logs: result.logs, apiCalls: result.apiCalls, durationMs: result.durationMs });
      }
      return text({ error: result.message, kind: result.kind, logs: result.logs, apiCalls: result.apiCalls, durationMs: result.durationMs }, true);
    },
  );
}
