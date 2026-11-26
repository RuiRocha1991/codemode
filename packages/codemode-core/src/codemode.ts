import { runInSandbox, type ApiFunctions, type SandboxResult } from "./sandbox.js";

/**
 * Módulo Code Mode genérico (XMCM-20): recebe um objeto de API qualquer e as suas
 * declarações TypeScript, e oferece `describe` e `execute`. Não depende do Xray,
 * para poder ser extraído para um gateway que junte vários MCP (XMCM-32).
 */
export interface CodeModeApi {
  /** Nome do objeto global na sandbox, por exemplo "xray". */
  name: string;
  functions: ApiFunctions;
  /** Declarações TypeScript (com comentários) das funções, como o Claude as vê. */
  declarations: string;
}

export interface CodeModeOptions {
  api: CodeModeApi;
  /** Texto extra para o describe (ambiente, avisos). */
  context?: () => Record<string, unknown>;
  timeoutMs?: number;
  memoryMb?: number;
  maxResultChars?: number;
}

export interface Description {
  api: string;
  declarations: string;
  usage: string;
  context: Record<string, unknown>;
}

export class CodeMode {
  constructor(private readonly options: CodeModeOptions) {}

  describe(): Description {
    const { api } = this.options;
    return {
      api: api.name,
      declarations: api.declarations,
      usage:
        `Escreva o corpo de uma função async em JavaScript/TypeScript sem tipos. O objeto global \`${api.name}\` tem as funções declaradas. ` +
        `Use await, Promise.all para paralelismo e \`return\` para devolver o resultado final (JSON, pequeno). ` +
        `Não há rede, ficheiros, process nem require. Faça todo o trabalho numa só execução e devolva só o que precisa de ver (contagens, chaves, amostras).`,
      context: this.options.context?.() ?? {},
    };
  }

  execute(code: string): Promise<SandboxResult> {
    const { api, timeoutMs, memoryMb, maxResultChars } = this.options;
    return runInSandbox(code, {
      apiName: api.name,
      functions: api.functions,
      ...(timeoutMs !== undefined && { timeoutMs }),
      ...(memoryMb !== undefined && { memoryMb }),
      ...(maxResultChars !== undefined && { maxResultChars }),
    });
  }
}
