import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    testTimeout: 30_000,
    // Charge .env.test (prioritaire) puis .env, avant tout import applicatif.
    // Sans ça, `src/lib/env.ts` jette au premier import parce que zod ne
    // trouve ni DATABASE_URL ni SESSION_SECRET.
    setupFiles: ["./tests/helpers/setup-env.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
