import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Vitest config for server-side tests (location/geo, etc.).
 * Run with: npm run test:server
 */
export default defineConfig({
  root: path.resolve(import.meta.dirname),
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  test: {
    environment: "node",
    include: ["server/**/*.test.ts"],
    exclude: ["**/node_modules/**", "server/services/mercury.test.ts"],
    globals: true,
  },
});
