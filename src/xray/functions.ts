import type { ApiFunctions } from "../codemode/sandbox.js";
import type { XrayApi } from "./api.js";

/** Nomes das funções que o Code Mode expõe como `xray.<nome>`. Lista fechada: só estas chegam à sandbox. */
export const XRAY_FUNCTION_NAMES = [
  "getTests",
  "createTests",
  "createFolder",
  "addTestsToFolder",
  "getFolderTree",
  "countTestsInFolder",
  "createTestPlan",
  "addTestsToTestPlan",
  "getTestPlanTests",
  "cleanup",
  "graphql",
] as const;

export type XrayFunctionName = (typeof XRAY_FUNCTION_NAMES)[number];

/**
 * Adapta o XrayApi ao formato da sandbox. Cada função recebe o argumento já vindo de JSON;
 * a validação com zod acontece dentro do XrayApi, por isso o `unknown` é seguro.
 * `createTests` recebe um array, as outras um objeto.
 */
export function xrayFunctions(api: XrayApi): ApiFunctions {
  const call = <K extends XrayFunctionName>(name: K) => (arg: unknown) =>
    (api[name] as (a: unknown) => Promise<unknown>).call(api, arg);
  return Object.fromEntries(XRAY_FUNCTION_NAMES.map((n) => [n, call(n)]));
}
