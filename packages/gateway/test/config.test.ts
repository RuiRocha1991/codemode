import { describe, expect, it } from "vitest";
import { ConfigError, isAllowed, matches, parseConfig, resolveEnvRefs, resolveRecord } from "../src/config.js";

describe("configuração", () => {
  it("aceita stdio e http com valores por omissão", () => {
    const c = parseConfig({
      servers: {
        xray: { transport: "stdio", command: "node", args: ["dist/index.js"], env: { XRAY_ENV: "local" } },
        jira: { transport: "http", url: "https://mcp.exemplo.com/mcp", headers: { Authorization: "Bearer ${JIRA_TOKEN}" } },
      },
    });
    expect(c.servers.xray).toMatchObject({ transport: "stdio", timeoutMs: 60000, tools: {} });
    expect(c.servers.jira).toMatchObject({ transport: "http" });
  });

  it.each([
    [{}, /servers/],
    [{ servers: {} }, /pelo menos um/],
    [{ servers: { "nome mau": { transport: "stdio", command: "x" } } }, /Nome de servidor inválido/],
    [{ servers: { constructor: { transport: "stdio", command: "x" } } }, /reservado/],
    [{ servers: { a: { transport: "ftp", command: "x" } } }, /transport/],
    [{ servers: { a: { transport: "http", url: "isto-nao-e-url" } } }, /url/i],
  ])("recusa %j", (cfg, msg) => {
    expect(() => parseConfig(cfg)).toThrow(ConfigError);
    expect(() => parseConfig(cfg)).toThrow(msg);
  });

  it("substitui ${VAR} e diz o NOME da variável em falta, nunca valores", () => {
    expect(resolveEnvRefs("Bearer ${T}", { T: "abc" }, "x")).toBe("Bearer abc");
    expect(() => resolveEnvRefs("${EM_FALTA}", { OUTRA: "segredo-xyz" }, "jira.headers.Authorization")).toThrow(
      "jira.headers.Authorization: a variável de ambiente EM_FALTA não está definida",
    );
    try {
      resolveEnvRefs("${EM_FALTA}", { OUTRA: "segredo-xyz" }, "x");
    } catch (e) {
      expect(String(e)).not.toContain("segredo-xyz");
    }
    expect(resolveRecord({ A: "${T}", B: "fixo" }, { T: "1" }, "s")).toEqual({ A: "1", B: "fixo" });
    expect(() => resolveEnvRefs("${VAZIA}", { VAZIA: "" }, "x")).toThrow(/VAZIA/);
  });

  it("curingas e política allow/deny (deny ganha)", () => {
    expect(matches("get*", "getIssue")).toBe(true);
    expect(matches("get*", "forget")).toBe(false);
    expect(matches("a.b", "aXb")).toBe(false); // o ponto é literal
    expect(matches("*", "qualquer")).toBe(true);
    expect(isAllowed({}, "x")).toBe(true);
    expect(isAllowed({ deny: ["delete*"] }, "deleteIssue")).toBe(false);
    expect(isAllowed({ allow: ["get*", "create*"], deny: ["createTest"] }, "createTest")).toBe(false);
    expect(isAllowed({ allow: ["get*"] }, "createVersion")).toBe(false);
    expect(isAllowed({ allow: ["get*"] }, "getIssue")).toBe(true);
  });
});
