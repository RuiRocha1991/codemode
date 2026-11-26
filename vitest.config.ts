import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Testes unitários sem rede: cada teste injeta um fetch simulado.
    environment: "node",
  },
});
