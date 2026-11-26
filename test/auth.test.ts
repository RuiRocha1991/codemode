import { describe, expect, it, vi } from "vitest";
import { AuthenticationError, TokenProvider } from "../src/xray/auth.js";
import type { Logger } from "../src/log.js";

function provider(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, logger?: Logger) {
  return new TokenProvider({
    envName: "local",
    authUrl: "http://localhost:8080/api/v2/authenticate",
    clientId: "o-meu-id",
    clientSecret: "o-meu-segredo",
    fetch: fetchImpl,
    logger,
  });
}

describe("TokenProvider", () => {
  it("obtém o token com client_id e client_secret", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify("tok-1")));
    const token = await provider(fetchMock).getToken();
    expect(token).toBe("tok-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:8080/api/v2/authenticate");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ client_id: "o-meu-id", client_secret: "o-meu-segredo" });
  });

  it("aceita o token sem aspas", async () => {
    const token = await provider(async () => new Response("tok-sem-aspas")).getToken();
    expect(token).toBe("tok-sem-aspas");
  });

  it("reutiliza o token em cache", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify("tok-1")));
    const p = provider(fetchMock);
    await p.getToken();
    await p.getToken();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("pedidos simultâneos partilham uma única autenticação", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify("tok-1")));
    const p = provider(fetchMock);
    const tokens = await Promise.all([p.getToken(), p.getToken(), p.getToken()]);
    expect(tokens).toEqual(["tok-1", "tok-1", "tok-1"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("renova o token depois de invalidate", async () => {
    let n = 0;
    const p = provider(async () => new Response(JSON.stringify(`tok-${++n}`)));
    expect(await p.getToken()).toBe("tok-1");
    p.invalidate("tok-1");
    expect(await p.getToken()).toBe("tok-2");
  });

  it("não descarta um token já renovado por outro pedido", async () => {
    let n = 0;
    const p = provider(async () => new Response(JSON.stringify(`tok-${++n}`)));
    await p.getToken();
    p.invalidate("tok-1");
    await p.getToken();
    p.invalidate("tok-1"); // pedido atrasado com o token antigo
    expect(await p.getToken()).toBe("tok-2");
  });

  it("falha com mensagem clara e sem segredos em 401", async () => {
    const p = provider(async () => new Response("Unauthorized", { status: 401 }));
    const err = await p.getToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthenticationError);
    expect((err as AuthenticationError).status).toBe(401);
    expect(String(err)).not.toContain("o-meu-segredo");
    expect(String(err)).not.toContain("o-meu-id");
  });

  it("depois de uma falha volta a tentar no pedido seguinte", async () => {
    let n = 0;
    const p = provider(async () => (++n === 1 ? new Response("x", { status: 500 }) : new Response('"tok"')));
    await expect(p.getToken()).rejects.toThrow(AuthenticationError);
    await expect(p.getToken()).resolves.toBe("tok");
  });

  it("falha em erro de rede", async () => {
    const p = provider(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(p.getToken()).rejects.toThrow(/Não foi possível contactar/);
  });

  it("nunca regista o token nem os segredos", async () => {
    const lines: string[] = [];
    const logger: Logger = (level, msg, fields) => lines.push(JSON.stringify({ level, msg, fields }));
    await provider(async () => new Response('"tok-secreto"'), logger).getToken();
    const all = lines.join("\n");
    expect(lines.length).toBeGreaterThan(0);
    expect(all).not.toContain("tok-secreto");
    expect(all).not.toContain("o-meu-segredo");
  });
});
