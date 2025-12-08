import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    include: ["app/tests/**/*.test.ts"],
    exclude: ["node_modules", "build"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
