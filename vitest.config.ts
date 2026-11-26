import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Lista cada teste pelo nome: a saída dos gates serve de evidência para os avaliadores.
    reporters: ["verbose"],
    // Os testes de integração compartilham um Postgres; arquivos rodam em sequência.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
