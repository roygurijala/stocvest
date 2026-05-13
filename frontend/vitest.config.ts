import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  esbuild: {
    jsx: "automatic"
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // ``server-only`` is a runtime marker package shipped by Next.js
      // that throws if a server module is imported on the client. In a
      // unit-test (jsdom) environment we just want the import to be a
      // silent no-op so tests can mount client components whose
      // transitive imports touch server-only-marked modules (e.g.
      // ``<Sidebar>`` → ``logoutAction`` → ``lib/auth/cognito``).
      // The empty stub here preserves the production guard while
      // unblocking jsdom rendering of dashboard chrome.
      "server-only": path.resolve(__dirname, "tests/mocks/server-only-stub.ts")
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
