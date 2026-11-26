import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Os testes usam o código-fonte do pacote, sem precisarem de o compilar antes.
    alias: { "@codemode/core": fileURLToPath(new URL("./packages/codemode-core/src/index.ts", import.meta.url)) },
  },
  test: {
    include: ["test/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    // Testes unitários sem rede: cada teste injeta um fetch simulado.
    environment: "node",
  },
});
