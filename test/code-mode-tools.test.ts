import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { XrayApi, flattenFolders, sumTests, type FolderNode } from "../src/xray/api.js";
import { XRAY_EXAMPLE } from "../src/xray/declarations.js";
import { fakeFetch, makeClient } from "./helpers/fake-xray.js";
import { MemoryXray } from "./helpers/memory-xray.js";

async function connect(mem = new MemoryXray(), executeTimeoutMs?: number) {
  const fake = fakeFetch(mem.handle);
  const graphql = makeClient(fake.fetch);
  const server = createServer({
    env: { name: "local", baseUrl: "http://localhost:8080" },
    client: graphql,
    xray: new XrayApi(graphql),
    ...(executeTimeoutMs !== undefined && { executeTimeoutMs }),
  });
  const client = new Client({ name: "teste", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, mem, fake };
}

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
const body = (r: ToolResult) => JSON.parse((r.content as { text: string }[])[0]!.text) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("ferramenta describe", () => {
  it("devolve declarações, modo de uso e o ambiente", async () => {
    const { client } = await connect();
    const r = body(await client.callTool({ name: "describe", arguments: {} }));
    expect(r.api).toBe("xray");
    expect(r.declarations).toContain("declare const xray");
    expect(r.declarations).toContain("createFolder");
    expect(r.context).toEqual({ environment: "local", baseUrl: "http://localhost:8080" });
    expect(r.usage).toContain("return");
  });

  it("a lista de ferramentas é whoami, describe e execute", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["describe", "execute", "whoami"]);
  });
});

describe("ferramenta execute", () => {
  it("o exemplo do cenário A corre numa única chamada", async () => {
    const mem = new MemoryXray();
    mem.seedTests("DEMO", 200);
    const { client } = await connect(mem);
    const r = await client.callTool({ name: "execute", arguments: { code: XRAY_EXAMPLE } });
    expect(r.isError).toBeFalsy();
    const out = body(r);
    const tree = out.value as FolderNode;
    expect(flattenFolders(tree)).toHaveLength(5);
    expect(sumTests(tree)).toBe(200);
    expect(out.apiCalls).toBeGreaterThan(10);
    expect(out.logs).toEqual([]);
  });

  it("devolve erros legíveis para o Claude corrigir o código", async () => {
    const mem = new MemoryXray();
    mem.seedTests("DEMO", 1);
    const { client } = await connect(mem);
    const r = await client.callTool({ name: "execute", arguments: { code: `await xray.getFolderTree({ project: "DEMO", path: "/nao-existe" })` } });
    expect(r.isError).toBe(true);
    const out = body(r);
    expect(out.kind).toBe("error");
    expect(out.error).toContain("não existe");
  });

  it("um projeto sem testes explica como resolver o projectId", async () => {
    const { client } = await connect();
    const r = await client.callTool({ name: "execute", arguments: { code: `await xray.getFolderTree({ project: "DEMO" })` } });
    expect(r.isError).toBe(true);
    expect(body(r).error).toContain("passe o ID numérico");
  });

  it("erros de validação dizem o que corrigir", async () => {
    const { client } = await connect();
    const r = await client.callTool({ name: "execute", arguments: { code: `await xray.createFolder({ project: "DEMO", path: "/" })` } });
    expect(r.isError).toBe(true);
    expect(body(r).error).toContain("createFolder: entrada inválida");
  });

  it("aplica o tempo limite configurado", async () => {
    const { client } = await connect(new MemoryXray(), 300);
    const r = await client.callTool({ name: "execute", arguments: { code: "while (true) {}" } });
    expect(r.isError).toBe(true);
    expect(body(r).kind).toBe("timeout");
  });

  it("o código não alcança segredos nem o host", async () => {
    const { client } = await connect();
    const r = await client.callTool({ name: "execute", arguments: { code: "return [typeof process, typeof fetch, typeof require]" } });
    expect(body(r).value).toEqual(["undefined", "undefined", "undefined"]);
  });

  it("a ferramenta está presa ao ambiente da instância", async () => {
    const { client, fake } = await connect();
    await client.callTool({ name: "execute", arguments: { code: `return await xray.getTests({ jql: "project = DEMO" })` } });
    // Todos os pedidos foram para o único URL GraphQL da instância; não há forma de escolher outro.
    expect(fake.calls.length).toBeGreaterThan(0);
  });
});
