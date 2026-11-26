import { describe, expect, it } from "vitest";
import {
  EnvironmentError,
  EnvironmentsFileSchema,
  isProductionUrl,
  loadEnvironment,
  publicView,
  readEnvironmentsFile,
} from "../src/config/environments.js";

const file = EnvironmentsFileSchema.parse({
  local: { baseUrl: "http://localhost:8080" },
  staging: { baseUrl: "https://xray-staging.example.com/" },
  off: { baseUrl: "https://off.example.com", enabled: false },
  "prod-us": { baseUrl: "https://us.xray.cloud.getxray.app", enabled: false, production: true },
  "prod-ligado": { baseUrl: "https://us.xray.cloud.getxray.app", enabled: true, production: true },
  "disfarcado": { baseUrl: "https://xray.cloud.getxray.app", enabled: true },
});

const secrets = { XRAY_CLIENT_ID: "id", XRAY_CLIENT_SECRET: "secret" };

describe("loadEnvironment", () => {
  it("escolhe o ambiente por XRAY_ENV e monta os URLs", () => {
    const env = loadEnvironment({ XRAY_ENV: "staging", ...secrets }, file);
    expect(env).toMatchObject({
      name: "staging",
      baseUrl: "https://xray-staging.example.com",
      authUrl: "https://xray-staging.example.com/api/v2/authenticate",
      graphqlUrl: "https://xray-staging.example.com/api/v2/graphql",
    });
  });

  it("prefere os segredos específicos do ambiente", () => {
    const env = loadEnvironment(
      { XRAY_ENV: "local", ...secrets, XRAY_LOCAL_CLIENT_ID: "lid", XRAY_LOCAL_CLIENT_SECRET: "lsecret" },
      file,
    );
    expect(env.clientId).toBe("lid");
    expect(env.clientSecret).toBe("lsecret");
  });

  it("aceita XRAY_BASE_URL para sobrepor o URL base", () => {
    const env = loadEnvironment({ XRAY_ENV: "local", XRAY_BASE_URL: "http://localhost:9999/", ...secrets }, file);
    expect(env.graphqlUrl).toBe("http://localhost:9999/api/v2/graphql");
  });

  it("recusa arrancar sem XRAY_ENV", () => {
    expect(() => loadEnvironment({ ...secrets }, file)).toThrow(/XRAY_ENV não está definido/);
  });

  it("recusa ambientes desconhecidos", () => {
    expect(() => loadEnvironment({ XRAY_ENV: "qa", ...secrets }, file)).toThrow(/desconhecido/);
  });

  it("recusa ambientes desligados", () => {
    expect(() => loadEnvironment({ XRAY_ENV: "off", ...secrets }, file)).toThrow(/desligado/);
  });

  it("recusa produção mesmo que esteja ligada na configuração", () => {
    expect(() => loadEnvironment({ XRAY_ENV: "prod-us", ...secrets }, file)).toThrow(/produção/);
    expect(() => loadEnvironment({ XRAY_ENV: "prod-ligado", ...secrets }, file)).toThrow(/produção/);
  });

  it("recusa URLs de produção, mesmo num ambiente que não se declara de produção", () => {
    expect(() => loadEnvironment({ XRAY_ENV: "disfarcado", ...secrets }, file)).toThrow(EnvironmentError);
    expect(() =>
      loadEnvironment({ XRAY_ENV: "local", XRAY_BASE_URL: "https://eu.xray.cloud.getxray.app", ...secrets }, file),
    ).toThrow(/produção/);
  });

  it("recusa arrancar sem credenciais", () => {
    expect(() => loadEnvironment({ XRAY_ENV: "local" }, file)).toThrow(/XRAY_LOCAL_CLIENT_ID/);
  });

  it("a vista pública não tem segredos", () => {
    const env = loadEnvironment({ XRAY_ENV: "local", ...secrets }, file);
    expect(JSON.stringify(publicView(env))).not.toContain("secret");
  });
});

describe("isProductionUrl", () => {
  it.each([
    ["https://xray.cloud.getxray.app", true],
    ["https://us.xray.cloud.getxray.app/api/v2", true],
    ["https://EU.XRAY.CLOUD.GETXRAY.APP", true],
    ["http://localhost:8080", false],
    ["https://xray.cloud.getxray.app.example.com", false],
  ])("%s → %s", (url, expected) => {
    expect(isProductionUrl(url)).toBe(expected);
  });
});

describe("config/environments.json", () => {
  it("é válido e tem a produção desligada", () => {
    const real = readEnvironmentsFile();
    expect(Object.keys(real)).toEqual(expect.arrayContaining(["local", "staging", "prod-us", "prod-eu"]));
    expect(real["prod-us"]?.enabled).toBe(false);
    expect(real["prod-eu"]?.enabled).toBe(false);
    expect(JSON.stringify(real)).not.toMatch(/secret/i);
  });
});
