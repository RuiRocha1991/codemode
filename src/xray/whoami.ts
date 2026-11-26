import type { PublicEnvironment } from "../config/environments.js";
import type { GraphQLClient } from "./graphql.js";

export interface WhoAmI {
  environment: string;
  baseUrl: string;
  authenticated: true;
  latencyMs: number;
}

/**
 * Confirma que a instância autentica e que a API GraphQL responde.
 * A API do Xray não tem uma query "viewer"; __typename é a query mais barata
 * que obriga a passar pela autenticação.
 */
export async function whoami(client: GraphQLClient, env: PublicEnvironment): Promise<WhoAmI> {
  const started = Date.now();
  await client.request<{ __typename: string }>("query WhoAmI { __typename }");
  return { environment: env.name, baseUrl: env.baseUrl, authenticated: true, latencyMs: Date.now() - started };
}
