#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildGatewayApi } from "./api.js";
import { readConfig } from "./config.js";
import { connectServer, type ServerConnection } from "./connection.js";
import { createGatewayServer } from "./server.js";

const log = (msg: string, fields: Record<string, unknown> = {}) =>
  process.stderr.write(JSON.stringify({ t: new Date().toISOString(), msg, ...fields }) + "\n");

async function main(): Promise<void> {
  const path = process.env.GATEWAY_CONFIG ?? "gateway.config.json";
  const config = readConfig(path);

  // Um servidor que falha não impede os outros: aparece no describe com o erro.
  const connections: ServerConnection[] = [];
  const failures: Record<string, string> = {};
  await Promise.all(
    Object.entries(config.servers).map(async ([name, cfg]) => {
      try {
        connections.push(await connectServer(name, cfg));
        log("servidor ligado", { server: name });
      } catch (err) {
        failures[name] = err instanceof Error ? err.message : String(err);
        log("servidor falhou", { server: name, error: failures[name] });
      }
    }),
  );

  const api = await buildGatewayApi(connections, config, failures);
  const server = createGatewayServer(api);
  await server.connect(new StdioServerTransport());
  log("gateway a correr em stdio", { servers: api.servers.map((s) => `${s.name}:${s.status}:${s.tools.length}`) });

  const shutdown = () => void Promise.allSettled(connections.map((c) => c.close())).then(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  log("falha no arranque", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
