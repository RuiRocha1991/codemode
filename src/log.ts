/**
 * Registos estruturados para stderr. O stdout pertence ao protocolo MCP (stdio),
 * por isso nada neste projeto pode escrever para stdout.
 *
 * Nunca passar segredos nem tokens a estas funções.
 */
export type LogFields = Record<string, string | number | boolean | undefined>;

export type Logger = (level: "info" | "warn" | "error", msg: string, fields?: LogFields) => void;

export const stderrLogger: Logger = (level, msg, fields) => {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields });
  process.stderr.write(line + "\n");
};

export const silentLogger: Logger = () => {};
