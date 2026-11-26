import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, SERVER_NAME } from "../src/server.js";

describe("servidor MCP", () => {
  it("aceita uma ligação de um cliente MCP", async () => {
    const server = createServer();
    const client = new Client({ name: "teste", version: "0.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    expect(client.getServerVersion()?.name).toBe(SERVER_NAME);
    await client.close();
  });
});
