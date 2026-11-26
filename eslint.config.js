import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "coverage/", "node_modules/", "examples/", "packages/*/dist/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // stdout pertence ao protocolo MCP: os registos vão para stderr através de src/log.ts.
      "no-console": ["error", { allow: ["error"] }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["scripts/**/*.ts", "test/**/*.ts"],
    rules: { "no-console": "off" },
  },
);
