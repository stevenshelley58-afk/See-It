import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Vitest configuration for database integration tests.
 *
 * These tests run against a REAL database and should be run separately
 * from unit tests. Make sure DATABASE_URL is set to a test database.
 *
 * Run with: npm run test:integration
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    // Only include integration tests
    include: ["app/tests/**/*.integration.test.ts"],
    exclude: ["node_modules", "build"],
    // Longer timeouts for database operations
    testTimeout: 60000,
    hookTimeout: 60000,
    // Run tests sequentially to avoid database conflicts
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
