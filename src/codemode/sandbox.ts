import ivm from "isolated-vm";

/**
 * Sandbox de Code Mode sobre isolated-vm (um isolate V8 separado, sem Node).
 *
 * Dentro do isolate NÃO existem: process, require, fetch, ficheiros, timers, rede.
 * Só existem o JavaScript base, `console` (capturado) e o objeto de API, cujas funções
 * atravessam a fronteira por uma única Reference e só trocam JSON.
 *
 * Este módulo é genérico: não sabe que a API é o Xray (extrai-se para um gateway em XMCM-32).
 */

/** Funções que o código pode chamar. Cada uma recebe no máximo um argumento JSON e devolve JSON. */
export type ApiFunctions = Record<string, (arg?: unknown) => Promise<unknown> | unknown>;

export interface SandboxOptions {
  /** Nome do objeto global dentro da sandbox, por exemplo "xray". */
  apiName: string;
  functions: ApiFunctions;
  /** Tempo limite de parede por execução. Por omissão 120 s. */
  timeoutMs?: number;
  /** Memória máxima do isolate. Por omissão 128 MB. */
  memoryMb?: number;
  /** Tamanho máximo do resultado em JSON, em caracteres. Por omissão 200 000. */
  maxResultChars?: number;
  /** Máximo de linhas de console guardadas. Por omissão 200. */
  maxLogLines?: number;
}

export interface SandboxSuccess {
  ok: true;
  /** Valor devolvido pelo código (JSON). `undefined` se o código não devolveu nada. */
  value: unknown;
  logs: string[];
  durationMs: number;
  apiCalls: number;
}

export interface SandboxFailure {
  ok: false;
  kind: "error" | "timeout" | "memory" | "result-too-large";
  message: string;
  logs: string[];
  durationMs: number;
  apiCalls: number;
}

export type SandboxResult = SandboxSuccess | SandboxFailure;

export const DEFAULT_TIMEOUT_MS = 120_000;
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function timeoutMessage(ms: number): string {
  const t = ms >= 1000 ? `${+(ms / 1000).toFixed(1)} s` : `${ms} ms`;
  return `A execução passou o tempo limite de ${t} e foi terminada.`;
}

/** Devolve a mensagem de um erro de qualquer origem, sem a pilha do host. */
function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Corre `code` (corpo de uma função async; pode usar await e return) na sandbox. */
export async function runInSandbox(code: string, options: SandboxOptions): Promise<SandboxResult> {
  const {
    apiName,
    functions,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    memoryMb = 128,
    maxResultChars = 200_000,
    maxLogLines = 200,
  } = options;
  if (!IDENT.test(apiName)) throw new Error(`apiName inválido: ${apiName}`);
  const names = Object.keys(functions);
  for (const n of names) if (!IDENT.test(n)) throw new Error(`nome de função inválido: ${n}`);

  const started = Date.now();
  const logs: string[] = [];
  let apiCalls = 0;
  let aborted = false;
  let abortReason: SandboxFailure["kind"] | undefined;

  const isolate = new ivm.Isolate({ memoryLimit: memoryMb });
  const done = (extra: Omit<SandboxFailure, "logs" | "durationMs" | "apiCalls">): SandboxFailure => ({
    ...extra,
    logs,
    durationMs: Date.now() - started,
    apiCalls,
  });

  let timer: NodeJS.Timeout | undefined;
  try {
    const context = await isolate.createContext();
    const jail = context.global;
    await jail.set("global", jail.derefInto());

    // Ponte única para o host: (nome, argumentoEmJSON) → Promise<JSON em texto>.
    const bridge = new ivm.Reference(async (name: string, argJson: string | undefined) => {
      // Depois de um timeout ou erro, nenhuma chamada nova chega à API (evita escritas fantasma).
      if (aborted) throw new Error("execução terminada");
      const fn = Object.hasOwn(functions, name) ? functions[name] : undefined;
      if (!fn) throw new Error(`função desconhecida: ${apiName}.${name}`);
      apiCalls++;
      const arg: unknown = argJson === undefined ? undefined : JSON.parse(argJson);
      const out = await fn(arg);
      return out === undefined ? "undefined" : JSON.stringify(out);
    });
    const logBridge = new ivm.Reference((line: string) => {
      if (logs.length < maxLogLines) logs.push(String(line).slice(0, 2000));
      else if (logs.length === maxLogLines) logs.push("… (mais linhas omitidas)");
    });
    await jail.set("__bridge", bridge);
    await jail.set("__log", logBridge);
    await jail.set("__fnNames", new ivm.ExternalCopy(names).copyInto());

    // Bootstrap: monta o objeto de API e o console; depois apaga as pontes do global.
    await context.eval(
      `(() => {
        const bridge = __bridge, log = __log, names = __fnNames;
        const call = (name) => async (arg) => {
          let text;
          try {
            text = await bridge.apply(undefined, [name, arg === undefined ? undefined : JSON.stringify(arg)],
              { result: { promise: true, copy: true } });
          } catch (e) {
            throw new Error(e && e.message ? e.message : String(e));
          }
          return text === "undefined" ? undefined : JSON.parse(text);
        };
        const api = {};
        for (const n of names) api[n] = call(n);
        Object.defineProperty(globalThis, ${JSON.stringify(apiName)}, { value: Object.freeze(api), enumerable: true });
        const fmt = (a) => { try { return typeof a === "string" ? a : JSON.stringify(a); } catch { return String(a); } };
        const send = (...a) => log.applySync(undefined, [a.map(fmt).join(" ")]);
        globalThis.console = Object.freeze({ log: send, info: send, warn: send, error: send, debug: send });
        delete globalThis.__bridge; delete globalThis.__log; delete globalThis.__fnNames;
      })()`,
    );

    // O código do utilizador vai como corpo de função async; o resultado sai em JSON.
    const wrapped =
      `(async () => {\n"use strict";\n${code}\n})().then(` +
      `(v) => v === undefined ? "undefined" : JSON.stringify(v))`;
    const script = await isolate.compileScript(wrapped);

    const run = script.run(context, { promise: true, copy: true, timeout: timeoutMs });
    const deadline = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    const outcome = await Promise.race([run, deadline]);

    if (outcome === "timeout") {
      aborted = true;
      abortReason = "timeout";
      return done({ ok: false, kind: "timeout", message: timeoutMessage(timeoutMs) });
    }
    const text = outcome as string;
    if (text.length > maxResultChars) {
      return done({
        ok: false,
        kind: "result-too-large",
        message: `O resultado tem ${text.length} caracteres (máximo ${maxResultChars}). Devolva só o que precisa: contagens, chaves, amostras.`,
      });
    }
    return {
      ok: true,
      value: text === "undefined" ? undefined : JSON.parse(text),
      logs,
      durationMs: Date.now() - started,
      apiCalls,
    };
  } catch (err) {
    aborted = true;
    const msg = messageOf(err);
    if (abortReason === "timeout" || /Script execution timed out/i.test(msg)) {
      return done({ ok: false, kind: "timeout", message: timeoutMessage(timeoutMs) });
    }
    if (/memory limit|isolate was disposed|disposed during/i.test(msg) && isolate.isDisposed) {
      return done({ ok: false, kind: "memory", message: `A execução passou o limite de memória de ${memoryMb} MB e foi terminada.` });
    }
    return done({ ok: false, kind: "error", message: cleanError(err) });
  } finally {
    if (timer) clearTimeout(timer);
    aborted = true;
    if (!isolate.isDisposed) isolate.dispose();
  }
}

/** Erro legível para o Claude corrigir o código: mensagem e primeiras linhas úteis, sem caminhos do host. */
function cleanError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const stack = (err.stack ?? "")
    .split("\n")
    .filter((l) => !l.includes("node_modules") && !l.includes("node:internal") && !/\(file:|\/home\//.test(l))
    .slice(0, 6)
    .join("\n");
  return stack.includes(err.message) ? stack : `${err.name}: ${err.message}\n${stack}`.trim();
}
