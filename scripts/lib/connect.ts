import { loadEnvironment, publicView } from "../../src/config/environments.js";
import { stderrLogger } from "../../src/log.js";
import { TokenProvider } from "../../src/xray/auth.js";
import { GraphQLClient } from "../../src/xray/graphql.js";

/** Liga ao ambiente de XRAY_ENV com as mesmas regras do servidor (produção bloqueada). */
export function connect() {
  const env = loadEnvironment(process.env);
  const tokens = new TokenProvider({
    envName: env.name,
    authUrl: env.authUrl,
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    logger: stderrLogger,
  });
  const client = new GraphQLClient({ envName: env.name, graphqlUrl: env.graphqlUrl, tokens, logger: stderrLogger });
  return { env: publicView(env), client };
}
