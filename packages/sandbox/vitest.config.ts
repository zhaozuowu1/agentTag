import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
});
