#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadEnvironment, publicView } from "./config/environments.js";
import { stderrLogger } from "./log.js";
import { createServer } from "./server.js";
import { TokenProvider } from "./xray/auth.js";
import { XrayApi } from "./xray/api.js";
import { GraphQLClient } from "./xray/graphql.js";

async function main(): Promise<void> {
  const env = loadEnvironment(process.env);
  const tokens = new TokenProvider({
    envName: env.name,
    authUrl: env.authUrl,
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    logger: stderrLogger,
  });
  const client = new GraphQLClient({ envName: env.name, graphqlUrl: env.graphqlUrl, tokens, logger: stderrLogger });
  const server = createServer({ env: publicView(env), client, xray: new XrayApi(client) });
  await server.connect(new StdioServerTransport());
  stderrLogger("info", "servidor MCP xray a correr em stdio", { env: env.name, baseUrl: env.baseUrl });
}

main().catch((err: unknown) => {
  stderrLogger("error", "falha no arranque", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
