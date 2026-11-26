import { readFileSync } from "node:fs";
import { z } from "zod";

/**
 * Configuração do gateway: que servidores MCP ligar.
 *
 * O ficheiro NÃO leva segredos. Valores como "${JIRA_TOKEN}" são substituídos pelas
 * variáveis de ambiente do processo do gateway no arranque; se faltar uma, o servidor
 * não liga e o erro diz o nome da variável (nunca o valor).
 */
const SERVER_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;

const Policy = z.object({
  /** Se existir, só estas ferramentas ficam disponíveis. Aceita `*` como curinga. */
  allow: z.array(z.string().min(1)).optional(),
  /** Ferramentas escondidas do código (ganha sobre allow). Aceita `*`. */
  deny: z.array(z.string().min(1)).optional(),
});

const Common = z.object({
  tools: Policy.default({}),
  /** Tempo limite de cada chamada a uma ferramenta deste servidor. Por omissão 60 s. */
  timeoutMs: z.number().int().min(1000).max(600_000).default(60_000),
});

const Stdio = Common.extend({
  transport: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  cwd: z.string().optional(),
});

/**
 * Autenticação por servidor HTTP, sem OAuth: token de API (bearer) ou utilizador+token (basic).
 * Os valores levam normalmente ${VAR}, para o segredo ficar no ambiente e não no ficheiro.
 */
const Auth = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bearer"), token: z.string().min(1) }),
  z.object({ type: z.literal("basic"), username: z.string().min(1), password: z.string().min(1) }),
]);

const Http = Common.extend({
  transport: z.literal("http"),
  url: z.url(),
  headers: z.record(z.string(), z.string()).default({}),
  auth: Auth.optional(),
}).refine((c) => !c.auth || !Object.keys(c.headers).some((h) => h.toLowerCase() === "authorization"), {
  message: 'use "auth" OU o cabeçalho Authorization em "headers", não os dois',
  path: ["auth"],
});

export const ServerConfigSchema = z.discriminatedUnion("transport", [Stdio, Http]);
export const GatewayConfigSchema = z.object({
  servers: z.record(z.string(), ServerConfigSchema).refine((s) => Object.keys(s).length > 0, "defina pelo menos um servidor"),
});

export type ServerConfig = z.output<typeof ServerConfigSchema>;
export type GatewayConfig = z.output<typeof GatewayConfigSchema>;

/** Nomes reservados: não podem ser nomes de servidor (ficariam ambíguos em `mcp.<nome>`). */
const RESERVED = new Set(["__proto__", "prototype", "constructor", "toString", "valueOf", "hasOwnProperty"]);

export class ConfigError extends Error {
  override name = "ConfigError";
}

export function parseConfig(raw: unknown): GatewayConfig {
  const parsed = GatewayConfigSchema.safeParse(raw);
  if (!parsed.success) throw new ConfigError(`Configuração do gateway inválida:\n${z.prettifyError(parsed.error)}`);
  for (const name of Object.keys(parsed.data.servers)) {
    if (!SERVER_NAME.test(name)) {
      throw new ConfigError(`Nome de servidor inválido "${name}": use letras, dígitos e _ (começa por letra ou _, até 32 caracteres), porque vira mcp.${name.replace(/\W+/g, "_")}`);
    }
    if (RESERVED.has(name)) throw new ConfigError(`Nome de servidor reservado: ${name}`);
  }
  return parsed.data;
}

export function readConfig(path: string): GatewayConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new ConfigError(`Não consegui ler a configuração ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return parseConfig(raw);
}

/** Substitui ${VAR} pelo valor da variável de ambiente. Lança com o NOME da variável em falta. */
export function resolveEnvRefs(value: string, env: NodeJS.ProcessEnv, where: string): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => {
    const v = env[name];
    if (v === undefined || v === "") throw new ConfigError(`${where}: a variável de ambiente ${name} não está definida`);
    return v;
  });
}

/** Cabeçalhos finais de um servidor HTTP: `headers` + Authorization derivado de `auth`. */
export function buildHttpHeaders(
  cfg: { headers: Record<string, string>; auth?: z.output<typeof Auth> | undefined },
  env: NodeJS.ProcessEnv,
  where: string,
): Record<string, string> {
  const headers = resolveRecord(cfg.headers, env, `${where}.headers`);
  if (cfg.auth?.type === "bearer") {
    headers["Authorization"] = `Bearer ${resolveEnvRefs(cfg.auth.token, env, `${where}.auth.token`)}`;
  } else if (cfg.auth?.type === "basic") {
    const user = resolveEnvRefs(cfg.auth.username, env, `${where}.auth.username`);
    const pass = resolveEnvRefs(cfg.auth.password, env, `${where}.auth.password`);
    headers["Authorization"] = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
  }
  return headers;
}

export function resolveRecord(rec: Record<string, string>, env: NodeJS.ProcessEnv, where: string): Record<string, string> {
  return Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, resolveEnvRefs(v, env, `${where}.${k}`)]));
}

/** Curinga simples: `*` casa qualquer sequência. Sem mais sintaxe, para não haver surpresas. */
export function matches(pattern: string, name: string): boolean {
  const re = new RegExp("^" + pattern.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
  return re.test(name);
}

export function isAllowed(policy: { allow?: string[] | undefined; deny?: string[] | undefined }, tool: string): boolean {
  if (policy.deny?.some((p) => matches(p, tool))) return false;
  if (policy.allow && !policy.allow.some((p) => matches(p, tool))) return false;
  return true;
}
