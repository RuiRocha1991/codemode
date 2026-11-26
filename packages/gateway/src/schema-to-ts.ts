/**
 * Converte o JSON Schema das ferramentas MCP em tipos TypeScript para o `describe`.
 *
 * Os esquemas vêm de servidores externos: são DADOS NÃO CONFIÁVEIS. Por isso:
 * - nomes de propriedades só saem como identificadores se forem seguros; senão vão entre aspas;
 * - descrições são limpas (sem fecho de comentário) antes de entrarem em comentários;
 * - a profundidade é limitada, e referências ($ref) só se resolvem dentro do próprio esquema.
 */

type Schema = {
  type?: string | string[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema | Schema[];
  enum?: unknown[];
  const?: unknown;
  oneOf?: Schema[];
  anyOf?: Schema[];
  allOf?: Schema[];
  additionalProperties?: boolean | Schema;
  description?: string;
  nullable?: boolean;
  $ref?: string;
  $defs?: Record<string, Schema>;
  definitions?: Record<string, Schema>;
  format?: string;
  default?: unknown;
};

const MAX_DEPTH = 8;
const SAFE_IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Texto seguro para um comentário JSDoc de uma linha. */
export function cleanComment(text: string | undefined, max = 300): string {
  if (!text) return "";
  const one = text.replace(/\s+/g, " ").replace(/\*\//g, "* /").replace(/\/\*/g, "/ *").trim();
  return one.length > max ? one.slice(0, max - 1) + "…" : one;
}

function quote(s: string): string {
  return JSON.stringify(s);
}

function literal(v: unknown): string {
  if (typeof v === "string") return quote(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v === null) return "null";
  return "unknown";
}

export function schemaToTs(schema: unknown, root: Schema = (schema ?? {}) as Schema, depth = 0, indent = ""): string {
  if (schema === true || schema === undefined || schema === null) return "unknown";
  if (schema === false) return "never";
  const s = schema as Schema;
  if (depth > MAX_DEPTH) return "unknown";

  if (s.$ref) {
    const m = /^#\/(\$defs|definitions)\/([^/]+)$/.exec(s.$ref);
    const target = m ? (root[m[1] as "$defs" | "definitions"] ?? {})[m[2]!] : undefined;
    return target ? schemaToTs(target, root, depth + 1, indent) : "unknown";
  }
  if (s.const !== undefined) return literal(s.const);
  if (Array.isArray(s.enum)) return s.enum.length ? s.enum.map(literal).join(" | ") : "never";

  const union = s.oneOf ?? s.anyOf;
  if (union?.length) return unique(union.map((u) => paren(schemaToTs(u, root, depth + 1, indent)))).join(" | ");
  if (s.allOf?.length) return s.allOf.map((u) => paren(schemaToTs(u, root, depth + 1, indent))).join(" & ");

  const types = Array.isArray(s.type) ? s.type : s.type ? [s.type] : inferType(s);
  const parts = types.map((t) => typeToTs(t, s, root, depth, indent));
  if (s.nullable) parts.push("null");
  return unique(parts).join(" | ") || "unknown";
}

function inferType(s: Schema): string[] {
  if (s.properties || s.additionalProperties !== undefined) return ["object"];
  if (s.items) return ["array"];
  return [];
}

function typeToTs(t: string, s: Schema, root: Schema, depth: number, indent: string): string {
  switch (t) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array": {
      const items = Array.isArray(s.items) ? undefined : s.items;
      return `${paren(schemaToTs(items, root, depth + 1, indent))}[]`;
    }
    case "object":
      return objectToTs(s, root, depth, indent);
    default:
      return "unknown";
  }
}

function objectToTs(s: Schema, root: Schema, depth: number, indent: string): string {
  const props = Object.entries(s.properties ?? {});
  const required = new Set(s.required ?? []);
  const inner = indent + "  ";
  const lines: string[] = [];
  for (const [name, sub] of props) {
    const key = SAFE_IDENT.test(name) ? name : quote(name);
    const doc = cleanComment((sub as Schema)?.description);
    if (doc) lines.push(`${inner}/** ${doc} */`);
    lines.push(`${inner}${key}${required.has(name) ? "" : "?"}: ${schemaToTs(sub, root, depth + 1, inner)};`);
  }
  const ap = s.additionalProperties;
  if (ap && ap !== true) lines.push(`${inner}[key: string]: ${schemaToTs(ap, root, depth + 1, inner)};`);
  // `properties: {}` explícito sem additionalProperties = sem argumentos; sem `properties` = objeto livre.
  else if (ap === true || (props.length === 0 && ap === undefined && s.properties === undefined)) lines.push(`${inner}[key: string]: unknown;`);
  return lines.length ? `{\n${lines.join("\n")}\n${indent}}` : "{}";
}

function paren(t: string): string {
  return /[|&]/.test(t) && !t.startsWith("{") && !t.startsWith("(") ? `(${t})` : t;
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}
