import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests live next to the code they test. Change this if your project
    // prefers a top-level tests/ directory.
    include: ['src/**/*.{test,spec}.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.{test,spec}.ts'],
      thresholds: {
        // This is a starting bar for the template, not a reason to write
        // meaningless tests. Raise it when the generated project has measured
        // business-critical paths that justify a stricter target.
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
