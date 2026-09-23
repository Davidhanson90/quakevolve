import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.spec.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "coverage",
      include: [
        "src/data/**/*.ts",
        "src/features/**/*.ts",
        "src/model/**/*.ts",
        "src/ga/**/*.ts"
      ],
      exclude: ["src/**/*.spec.ts", "src/**/*.test.ts", "src/**/index.ts"],
      thresholds: {
        perFile: true,
        statements: 85,
        branches: 80,
        functions: 85,
        lines: 85
      }
    }
  }
});
