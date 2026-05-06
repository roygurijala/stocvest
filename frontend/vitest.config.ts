import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  esbuild: {
    jsx: "automatic"
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, ".")
    }
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    /** Avoid cross-file races on `global.fetch` stubs (market/scanner/symbol-news tests). */
    fileParallelism: false
  }
});
