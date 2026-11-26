import { describe, expect, it } from "vitest";
import { operationName, parseRetryAfter, XrayGraphQLError, XrayHttpError } from "../src/xray/graphql.js";
import { fakeFetch, makeClient } from "./helpers/fake-xray.js";

describe("GraphQLClient", () => {
  it("envia a query com variáveis e o token", async () => {
    const fake = fakeFetch(() => ({ ok: true }));
    const client = makeClient(fake.fetch);
    await client.request("query X($jql: String) { a(jql: $jql) }", { jql: 'project = "DEMO"' });
    expect(fake.calls[0]?.variables).toEqual({ jql: 'project = "DEMO"' });
    expect(fake.calls[0]?.query).not.toContain("DEMO");
    expect(fake.calls[0]?.token).toBe("tok");
  });

  it("renova o token uma vez em 401", async () => {
    let n = 0;
    const fake = fakeFetch(
      (call) => (call.token === "tok-1" ? new Response("expired", { status: 401 }) : { ok: true }),
      { token: () => `tok-${++n}` },
    );
    const client = makeClient(fake.fetch);
    await expect(client.request("query X { a }")).resolves.toEqual({ ok: true });
    expect(fake.authCount).toBe(2);
  });

  it("não fica em ciclo se o 401 persistir", async () => {
    const fake = fakeFetch(() => new Response("no", { status: 401 }));
    const client = makeClient(fake.fetch);
    await expect(client.request("query X { a }")).rejects.toThrow(XrayHttpError);
    expect(fake.calls).toHaveLength(2);
  });

  it("converte erros GraphQL em XrayGraphQLError com o nome da operação", async () => {
    const fake = fakeFetch(
      () => new Response(JSON.stringify({ errors: [{ message: "campo inválido" }] }), { status: 200 }),
    );
    const err = await makeClient(fake.fetch)
      .request("mutation CreateFolder { a }")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(XrayGraphQLError);
    expect(String(err)).toContain("CreateFolder: campo inválido");
  });
});

describe("operationName", () => {
  it("lê o nome declarado", () => {
    expect(operationName("query GetTests($a: String) { x }")).toBe("GetTests");
    expect(operationName("mutation  CreateTest { x }")).toBe("CreateTest");
    expect(operationName("{ x }")).toBe("anonymous");
  });
});

describe("parseRetryAfter", () => {
  it("lê segundos e datas", () => {
    expect(parseRetryAfter("2")).toBe(2000);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("lixo")).toBeUndefined();
    expect(parseRetryAfter(new Date(Date.now() + 5000).toUTCString())).toBeGreaterThan(0);
  });
});
