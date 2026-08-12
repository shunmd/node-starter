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
      // No global threshold is set here. A number invented by a template is
      // not a quality bar, and a bar nobody chose gets lowered on first
      // contact. Add thresholds once the project knows what it is testing.
    },
  },
});
