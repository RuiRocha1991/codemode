import type { Logger } from "../log.js";
import { silentLogger } from "../log.js";
import type { FetchLike, TokenProvider } from "./auth.js";

export interface GraphQLClientOptions {
  envName: string;
  graphqlUrl: string;
  tokens: TokenProvider;
  fetch?: FetchLike;
  logger?: Logger;
}

export interface GraphQLErrorEntry {
  message: string;
  path?: (string | number)[];
}

/** A API respondeu, mas com erros GraphQL (pedido inválido, permissões, dados em falta). Não se repete. */
export class XrayGraphQLError extends Error {
  override name = "XrayGraphQLError";
  constructor(
    readonly operation: string,
    readonly errors: GraphQLErrorEntry[],
  ) {
    super(`${operation}: ${errors.map((e) => e.message).join("; ")}`);
  }
}

/** Erro HTTP da API GraphQL. */
export class XrayHttpError extends Error {
  override name = "XrayHttpError";
  constructor(
    readonly operation: string,
    readonly status: number,
    readonly retryAfterMs?: number,
  ) {
    super(`${operation}: HTTP ${status}`);
  }
}

/** Nome da operação para registos: o nome declarado na query, ou "anonymous". */
export function operationName(query: string): string {
  const match = /\b(query|mutation)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(query);
  return match?.[2] ?? "anonymous";
}

/**
 * Cliente GraphQL do Xray: autentica, envia sempre variáveis (nunca texto concatenado
 * na query), renova o token uma vez em 401 e regista ambiente, operação e duração.
 */
export class GraphQLClient {
  protected readonly fetchImpl: FetchLike;
  protected readonly logger: Logger;

  constructor(protected readonly options: GraphQLClientOptions) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.logger = options.logger ?? silentLogger;
  }

  get envName(): string {
    return this.options.envName;
  }

  async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    return this.send<T>(query, variables);
  }

  /** Um envio, com uma renovação de token em 401. */
  protected async send<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const op = operationName(query);
    for (let attempt = 0; ; attempt++) {
      const token = await this.options.tokens.getToken();
      const started = Date.now();
      const res = await this.fetchImpl(this.options.graphqlUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query, variables }),
      });
      this.logger(res.ok ? "info" : "warn", "graphql", {
        env: this.options.envName,
        op,
        status: res.status,
        ms: Date.now() - started,
      });

      if (res.status === 401 && attempt === 0) {
        this.options.tokens.invalidate(token);
        continue;
      }
      if (!res.ok) {
        throw new XrayHttpError(op, res.status, parseRetryAfter(res.headers.get("retry-after")));
      }
      const body = (await res.json()) as { data?: T; errors?: GraphQLErrorEntry[] };
      if (body.errors?.length) throw new XrayGraphQLError(op, body.errors);
      if (body.data === undefined) throw new XrayGraphQLError(op, [{ message: "resposta sem data" }]);
      return body.data;
    }
  }
}

export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}
