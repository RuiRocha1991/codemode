import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, SERVER_NAME } from "../src/server.js";
import { fakeFetch, makeClient } from "./helpers/fake-xray.js";

async function connect(handler: Parameters<typeof fakeFetch>[0]) {
  const fake = fakeFetch(handler);
  const server = createServer({
    env: { name: "local", baseUrl: "http://localhost:8080" },
    client: makeClient(fake.fetch),
  });
  const client = new Client({ name: "teste", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, fake };
}

function text(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as { type: string; text: string }[];
  return content.map((c) => c.text).join("");
}

describe("servidor MCP", () => {
  it("aceita uma ligação e diz o ambiente nas instruções", async () => {
    const { client } = await connect(() => ({}));
    expect(client.getServerVersion()?.name).toBe(SERVER_NAME);
    expect(client.getInstructions()).toContain('"local"');
    await client.close();
  });

  it("lista a ferramenta whoami", async () => {
    const { client } = await connect(() => ({}));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("whoami");
    await client.close();
  });

  it("whoami devolve o ambiente depois de uma chamada autenticada", async () => {
    const { client, fake } = await connect(() => ({ __typename: "Query" }));
    const result = await client.callTool({ name: "whoami", arguments: {} });
    expect(result.isError).toBeFalsy();
    const body = JSON.parse(text(result)) as Record<string, unknown>;
    expect(body).toMatchObject({ environment: "local", authenticated: true });
    expect(fake.calls[0]?.token).toBe("tok");
    await client.close();
  });

  it("whoami devolve um erro legível quando a autenticação falha", async () => {
    const { client } = await connect(() => new Response("no", { status: 403 }));
    const result = await client.callTool({ name: "whoami", arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("HTTP 403");
    await client.close();
  });
});
