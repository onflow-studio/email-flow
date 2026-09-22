import path from "node:path";
import { defineConfig } from "vitest/config";

// Tests live only in lib/classify and lib/sync.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    include: ["lib/classify/**/*.test.ts", "lib/sync/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
  },
});
