import type { Logger } from "../log.js";
import { silentLogger } from "../log.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface TokenProviderOptions {
  envName: string;
  authUrl: string;
  clientId: string;
  clientSecret: string;
  fetch?: FetchLike;
  logger?: Logger;
}

export class AuthenticationError extends Error {
  override name = "AuthenticationError";
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/**
 * Troca client_id/client_secret por um token Xray e guarda-o em memória.
 *
 * - Pedidos simultâneos partilham a mesma autenticação em curso.
 * - invalidate() é chamado pelo cliente GraphQL ao receber 401; o pedido seguinte autentica de novo.
 * - O token e os segredos nunca são escritos em registos nem em mensagens de erro.
 */
export class TokenProvider {
  private token: string | undefined;
  private inFlight: Promise<string> | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly logger: Logger;

  constructor(private readonly options: TokenProviderOptions) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.logger = options.logger ?? silentLogger;
  }

  async getToken(): Promise<string> {
    if (this.token) return this.token;
    this.inFlight ??= this.authenticate().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  /** Descarta o token em cache (por exemplo depois de um 401). */
  invalidate(rejected?: string): void {
    // Se outro pedido já renovou o token, não o deitar fora.
    if (rejected === undefined || rejected === this.token) this.token = undefined;
  }

  private async authenticate(): Promise<string> {
    const started = Date.now();
    let res: Response;
    try {
      res = await this.fetchImpl(this.options.authUrl, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ client_id: this.options.clientId, client_secret: this.options.clientSecret }),
      });
    } catch (err) {
      throw new AuthenticationError(
        `Não foi possível contactar ${this.options.authUrl}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.logger("info", "autenticação", {
      env: this.options.envName,
      status: res.status,
      ms: Date.now() - started,
    });
    if (!res.ok) {
      throw new AuthenticationError(
        `A autenticação em ${this.options.envName} falhou com HTTP ${res.status}. Confirme o client_id e o client_secret.`,
        res.status,
      );
    }
    // A API do Xray devolve o token como string JSON ("eyJ...").
    const text = (await res.text()).trim();
    let token: unknown = text;
    try {
      token = JSON.parse(text);
    } catch {
      // Alguns servidores devolvem o token sem aspas.
    }
    if (typeof token !== "string" || token.length === 0) {
      throw new AuthenticationError(`Resposta de autenticação inesperada em ${this.options.envName}.`);
    }
    this.token = token;
    return token;
  }
}
