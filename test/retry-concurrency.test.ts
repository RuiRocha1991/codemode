import { describe, expect, it, vi } from "vitest";
import { Limiter } from "../src/xray/limiter.js";
import { isRetryable, XrayGraphQLError, XrayHttpError } from "../src/xray/graphql.js";
import { fakeFetch, makeClient } from "./helpers/fake-xray.js";

const tick = () => new Promise((r) => setTimeout(r, 1));

describe("Limiter", () => {
  it("nunca passa do máximo e corre tudo", async () => {
    const limiter = new Limiter(3);
    let active = 0;
    let peak = 0;
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        limiter.run(async () => {
          active++;
          peak = Math.max(peak, active);
          await tick();
          active--;
          return i;
        }),
      ),
    );
    expect(peak).toBe(3);
    expect(results).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(limiter.running).toBe(0);
  });

  it("liberta o lugar quando a tarefa falha", async () => {
    const limiter = new Limiter(1);
    await expect(limiter.run(async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    await expect(limiter.run(async () => "ok")).resolves.toBe("ok");
  });

  it("recusa máximos inválidos", () => {
    expect(() => new Limiter(0)).toThrow(RangeError);
  });
});

describe("GraphQLClient: concorrência", () => {
  it("faz no máximo 5 pedidos em paralelo por omissão", async () => {
    let active = 0;
    let peak = 0;
    const fake = fakeFetch(async () => {
      active++;
      peak = Math.max(peak, active);
      await tick();
      active--;
      return { ok: true };
    });
    const client = makeClient(fake.fetch);
    await Promise.all(Array.from({ length: 30 }, () => client.request("query X { a }")));
    expect(peak).toBe(5);
    expect(fake.calls).toHaveLength(30);
  });
});

describe("GraphQLClient: retry", () => {
  it("repete 429 e 5xx com espera crescente", async () => {
    const statuses = [429, 503, 502];
    const fake = fakeFetch(() => {
      const s = statuses.shift();
      return s ? new Response("busy", { status: s }) : { ok: true };
    });
    const sleep = vi.fn(async () => {});
    const client = makeClient(fake.fetch, { sleep, retry: { baseDelayMs: 100 } });
    await expect(client.request("query X { a }")).resolves.toEqual({ ok: true });
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([100, 200, 400]);
  });

  it("respeita o Retry-After quando é maior que a espera calculada", async () => {
    let first = true;
    const fake = fakeFetch(() => {
      if (!first) return { ok: true };
      first = false;
      return new Response("slow down", { status: 429, headers: { "retry-after": "3" } });
    });
    const sleep = vi.fn(async () => {});
    await makeClient(fake.fetch, { sleep, retry: { baseDelayMs: 100 } }).request("query X { a }");
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it("limita a espera ao máximo configurado", async () => {
    let n = 0;
    const fake = fakeFetch(() => (++n <= 3 ? new Response("x", { status: 500 }) : { ok: true }));
    const sleep = vi.fn(async () => {});
    await makeClient(fake.fetch, { sleep, retry: { baseDelayMs: 1000, maxDelayMs: 1500 } }).request("query X { a }");
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([1000, 1500, 1500]);
  });

  it("repete falhas de rede", async () => {
    let n = 0;
    const base = fakeFetch(() => ({ ok: true }));
    const flaky = async (url: string, init?: RequestInit) => {
      if (url.endsWith("/graphql") && ++n === 1) throw new TypeError("fetch failed");
      return base.fetch(url, init);
    };
    await expect(makeClient(flaky).request("query X { a }")).resolves.toEqual({ ok: true });
  });

  it("desiste depois do número máximo de tentativas", async () => {
    const fake = fakeFetch(() => new Response("x", { status: 503 }));
    const client = makeClient(fake.fetch, { retry: { retries: 2 } });
    await expect(client.request("query X { a }")).rejects.toThrow(XrayHttpError);
    expect(fake.calls).toHaveLength(3);
  });

  it("não repete erros GraphQL nem 4xx", async () => {
    const gql = fakeFetch(() => new Response(JSON.stringify({ errors: [{ message: "mau" }] })));
    await expect(makeClient(gql.fetch).request("query X { a }")).rejects.toThrow(XrayGraphQLError);
    expect(gql.calls).toHaveLength(1);

    const bad = fakeFetch(() => new Response("x", { status: 400 }));
    await expect(makeClient(bad.fetch).request("query X { a }")).rejects.toThrow(XrayHttpError);
    expect(bad.calls).toHaveLength(1);
  });

  it("classifica os erros", () => {
    expect(isRetryable(new XrayHttpError("op", 429))).toBe(true);
    expect(isRetryable(new XrayHttpError("op", 500))).toBe(true);
    expect(isRetryable(new XrayHttpError("op", 404))).toBe(false);
    expect(isRetryable(new XrayGraphQLError("op", [{ message: "x" }]))).toBe(false);
    expect(isRetryable(new TypeError("fetch failed"))).toBe(true);
    expect(isRetryable(new Error("outro"))).toBe(false);
  });
});
