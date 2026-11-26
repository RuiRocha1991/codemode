import { describe, expect, it } from "vitest";
import { checkContract, EXPECTED_OPERATIONS, type IntrospectionResult } from "../src/xray/schema-contract.js";

function schemaFrom(ops = EXPECTED_OPERATIONS): IntrospectionResult {
  const fields = (kind: "query" | "mutation") =>
    ops.filter((o) => o.kind === kind).map((o) => ({ name: o.name, args: o.args.map((name) => ({ name })) }));
  return { __schema: { queryType: { fields: fields("query") }, mutationType: { fields: fields("mutation") } } };
}

describe("checkContract", () => {
  it("passa quando o schema tem tudo", () => {
    const checks = checkContract(schemaFrom());
    expect(checks.every((c) => c.found && c.missingArgs.length === 0)).toBe(true);
  });

  it("aponta operações e argumentos em falta", () => {
    const schema = schemaFrom();
    schema.__schema.mutationType!.fields = schema.__schema.mutationType!.fields
      .filter((f) => f.name !== "createFolder")
      .map((f) => (f.name === "createTest" ? { ...f, args: f.args.filter((a) => a.name !== "gherkin") } : f));
    const checks = checkContract(schema);
    expect(checks.find((c) => c.operation.name === "createFolder")?.found).toBe(false);
    expect(checks.find((c) => c.operation.name === "createTest")?.missingArgs).toEqual(["gherkin"]);
  });

  it("mostra argumentos extra sem falhar", () => {
    const schema = schemaFrom();
    schema.__schema.queryType!.fields[0]!.args.push({ name: "modifiedSince" });
    const check = checkContract(schema)[0]!;
    expect(check.missingArgs).toEqual([]);
    expect(check.extraArgs).toEqual(["modifiedSince"]);
  });
});
