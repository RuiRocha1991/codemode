import type { Logger } from "../log.js";
import { silentLogger } from "../log.js";
import type { FetchLike, TokenProvider } from "./auth.js";
import { Limiter } from "./limiter.js";

export interface RetryOptions {
  /** Número de novas tentativas depois da primeira. */
  retries: number;
  /** Espera antes da primeira nova tentativa; dobra a cada tentativa. */
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY: RetryOptions = { retries: 4, baseDelayMs: 500, maxDelayMs: 10_000 };
export const DEFAULT_CONCURRENCY = 5;

export interface GraphQLClientOptions {
  envName: string;
  graphqlUrl: string;
  tokens: TokenProvider;
  fetch?: FetchLike;
  logger?: Logger;
  /** Pedidos GraphQL em paralelo, no máximo. Por omissão 5. */
  concurrency?: number;
  retry?: Partial<RetryOptions>;
  /** Para testes: substitui a espera real. */
  sleep?: (ms: number) => Promise<void>;
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

/** Erros que vale a pena repetir: limite da API (429), erros do servidor (5xx) e falhas de rede. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof XrayHttpError) return err.status === 429 || err.status >= 500;
  if (err instanceof XrayGraphQLError) return false;
  // fetch lança TypeError em falhas de rede (ECONNRESET, DNS, ...).
  return err instanceof TypeError;
}

/**
 * Cliente GraphQL do Xray:
 * - envia sempre variáveis (nunca texto concatenado na query);
 * - no máximo `concurrency` pedidos em paralelo (5 por omissão);
 * - repete 429, 5xx e falhas de rede com espera crescente (respeita Retry-After);
 * - renova o token uma vez em 401;
 * - regista ambiente, operação, estado e duração para stderr.
 */
export class GraphQLClient {
  protected readonly fetchImpl: FetchLike;
  protected readonly logger: Logger;
  private readonly limiter: Limiter;
  private readonly retry: RetryOptions;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(protected readonly options: GraphQLClientOptions) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.logger = options.logger ?? silentLogger;
    this.limiter = new Limiter(options.concurrency ?? DEFAULT_CONCURRENCY);
    this.retry = { ...DEFAULT_RETRY, ...options.retry };
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get envName(): string {
    return this.options.envName;
  }

  /** Pedidos em curso neste momento (para testes e diagnóstico). */
  get inFlight(): number {
    return this.limiter.running;
  }

  async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const op = operationName(query);
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.limiter.run(() => this.send<T>(query, variables));
      } catch (err) {
        if (attempt >= this.retry.retries || !isRetryable(err)) throw err;
        const backoff = Math.min(this.retry.maxDelayMs, this.retry.baseDelayMs * 2 ** attempt);
        const hinted = err instanceof XrayHttpError ? err.retryAfterMs : undefined;
        const delay = Math.min(this.retry.maxDelayMs, Math.max(backoff, hinted ?? 0));
        this.logger("warn", "graphql retry", {
          env: this.options.envName,
          op,
          attempt: attempt + 1,
          delayMs: delay,
          error: err instanceof Error ? err.message : String(err),
        });
        // A espera acontece fora do limitador, para não ocupar um lugar.
        await this.sleep(delay);
      }
    }
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
