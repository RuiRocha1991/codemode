#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { stderrLogger } from "./log.js";

async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  stderrLogger("info", "servidor MCP xray a correr em stdio");
}

main().catch((err: unknown) => {
  stderrLogger("error", "falha no arranque", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
