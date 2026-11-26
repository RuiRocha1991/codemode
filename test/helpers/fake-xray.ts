import { TokenProvider } from "../../src/xray/auth.js";
import { GraphQLClient } from "../../src/xray/graphql.js";

export const AUTH_URL = "http://xray.test/api/v2/authenticate";
export const GRAPHQL_URL = "http://xray.test/api/v2/graphql";

export interface GraphQLCall {
  query: string;
  variables: Record<string, unknown>;
  token: string | undefined;
}

export type GraphQLHandler = (call: GraphQLCall) => Response | Promise<Response> | unknown;

/**
 * fetch simulado que responde à autenticação e encaminha os pedidos GraphQL para um handler.
 * O handler pode devolver um Response (para simular HTTP 429, 401, ...) ou o objeto data.
 */
export function fakeFetch(handler: GraphQLHandler, opts: { token?: () => string } = {}) {
  const calls: GraphQLCall[] = [];
  let authCount = 0;
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url === AUTH_URL) {
      authCount++;
      return new Response(JSON.stringify(opts.token ? opts.token() : "tok"));
    }
    if (url === GRAPHQL_URL) {
      const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
      const headers = new Headers(init?.headers);
      const call: GraphQLCall = {
        query: body.query,
        variables: body.variables,
        token: headers.get("authorization")?.replace(/^Bearer /, ""),
      };
      calls.push(call);
      const out = await handler(call);
      if (out instanceof Response) return out;
      return new Response(JSON.stringify({ data: out }), { headers: { "content-type": "application/json" } });
    }
    throw new Error(`URL inesperado no teste: ${url}`);
  };
  return {
    fetch: fetchImpl,
    calls,
    get authCount() {
      return authCount;
    },
  };
}

export function makeClient(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  const tokens = new TokenProvider({
    envName: "teste",
    authUrl: AUTH_URL,
    clientId: "id",
    clientSecret: "secret",
    fetch: fetchImpl,
  });
  return new GraphQLClient({ envName: "teste", graphqlUrl: GRAPHQL_URL, tokens, fetch: fetchImpl });
}
