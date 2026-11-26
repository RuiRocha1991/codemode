import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * Configuração de ambientes.
 *
 * - O ficheiro config/environments.json está no repositório e não tem segredos.
 * - Cada instância do servidor fica presa a um ambiente, escolhido por XRAY_ENV no arranque.
 * - Os segredos vêm de variáveis de ambiente: XRAY_<AMBIENTE>_CLIENT_ID / _CLIENT_SECRET
 *   (por exemplo XRAY_LOCAL_CLIENT_ID), com recurso a XRAY_CLIENT_ID / XRAY_CLIENT_SECRET.
 * - A produção está bloqueada no código, independentemente do que diga a configuração.
 */

const EnvironmentEntrySchema = z.object({
  baseUrl: z.url(),
  enabled: z.boolean().default(true),
  production: z.boolean().default(false),
  authPath: z.string().startsWith("/").default("/api/v2/authenticate"),
  graphqlPath: z.string().startsWith("/").default("/api/v2/graphql"),
  description: z.string().optional(),
});

export const EnvironmentsFileSchema = z.record(z.string().regex(/^[a-z0-9-]+$/), EnvironmentEntrySchema);
export type EnvironmentsFile = z.infer<typeof EnvironmentsFileSchema>;

export interface Environment {
  /** Nome do ambiente, por exemplo "local" ou "staging". */
  name: string;
  baseUrl: string;
  authUrl: string;
  graphqlUrl: string;
  clientId: string;
  clientSecret: string;
}

/** Vista do ambiente sem segredos, para mostrar ao assistente e escrever em registos. */
export type PublicEnvironment = Pick<Environment, "name" | "baseUrl">;

export class EnvironmentError extends Error {
  override name = "EnvironmentError";
}

/**
 * Hosts da produção do Xray Cloud. Qualquer URL que aponte para eles é recusado,
 * mesmo que venha de XRAY_BASE_URL ou de uma entrada com enabled: true.
 * Abrir a produção é o trabalho de XMCM-35 (exige modo de simulação e confirmação).
 */
const PRODUCTION_HOST_PATTERN = /(^|\.)xray\.cloud\.getxray\.app$/i;

export function isProductionUrl(url: string): boolean {
  return PRODUCTION_HOST_PATTERN.test(new URL(url).hostname);
}

export const DEFAULT_ENVIRONMENTS_PATH = fileURLToPath(new URL("../../config/environments.json", import.meta.url));

export function readEnvironmentsFile(path: string = DEFAULT_ENVIRONMENTS_PATH): EnvironmentsFile {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  const parsed = EnvironmentsFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new EnvironmentError(`Configuração de ambientes inválida em ${path}: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

function secretVarPrefix(envName: string): string {
  return `XRAY_${envName.toUpperCase().replace(/-/g, "_")}`;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Escolhe o ambiente a partir de XRAY_ENV e lê os segredos.
 * Lança EnvironmentError se o ambiente não existir, estiver desligado, for de produção
 * ou faltarem segredos. O servidor não arranca nesses casos.
 */
export function loadEnvironment(
  vars: NodeJS.ProcessEnv,
  file: EnvironmentsFile = readEnvironmentsFile(),
): Environment {
  const name = vars.XRAY_ENV?.trim();
  if (!name) {
    throw new EnvironmentError(`XRAY_ENV não está definido. Ambientes conhecidos: ${Object.keys(file).join(", ")}.`);
  }
  const entry = file[name];
  if (!entry) {
    throw new EnvironmentError(`Ambiente desconhecido "${name}". Ambientes conhecidos: ${Object.keys(file).join(", ")}.`);
  }
  if (entry.production) {
    throw new EnvironmentError(`O ambiente "${name}" é de produção e está bloqueado nesta versão.`);
  }
  if (!entry.enabled) {
    throw new EnvironmentError(`O ambiente "${name}" está desligado na configuração.`);
  }

  const baseUrl = stripTrailingSlash(vars.XRAY_BASE_URL?.trim() || entry.baseUrl);
  if (!z.url().safeParse(baseUrl).success) {
    throw new EnvironmentError(`URL base inválido para "${name}": ${baseUrl}`);
  }
  if (isProductionUrl(baseUrl)) {
    throw new EnvironmentError(`O URL ${baseUrl} é da produção do Xray Cloud e está bloqueado nesta versão.`);
  }

  const prefix = secretVarPrefix(name);
  const clientId = vars[`${prefix}_CLIENT_ID`] || vars.XRAY_CLIENT_ID;
  const clientSecret = vars[`${prefix}_CLIENT_SECRET`] || vars.XRAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new EnvironmentError(
      `Faltam credenciais para "${name}": defina ${prefix}_CLIENT_ID e ${prefix}_CLIENT_SECRET (ou XRAY_CLIENT_ID e XRAY_CLIENT_SECRET).`,
    );
  }

  return {
    name,
    baseUrl,
    authUrl: baseUrl + entry.authPath,
    graphqlUrl: baseUrl + entry.graphqlPath,
    clientId,
    clientSecret,
  };
}

export function publicView(env: Environment): PublicEnvironment {
  return { name: env.name, baseUrl: env.baseUrl };
}
