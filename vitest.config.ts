import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests live next to the code they test. Change this if your project
    // prefers a top-level tests/ directory.
    //
    // `scripts/` is included because the scripts are the enforcement layer:
    // they are what decides whether everything else passes, and until they
    // were tested the gate had no gate.
    include: ['src/**/*.{test,spec}.ts', 'scripts/**/*.{test,spec}.ts'],

    // No DOM, because nothing in this template renders one. Code that touches
    // `document` or `window` -- a UI framework's components -- needs `jsdom` or
    // `happy-dom` here, and its file extensions added to `include` above.
    environment: 'node',

    // Test isolation, made mechanical. A test that passes only because an
    // earlier test left a mock, a spy or an environment variable behind is a
    // test that will one day fail for reasons nobody can reproduce.
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,

    // A retried test is a test that reports "pass" for a suite that failed.
    // Flakiness is a defect in the test or the code, and hiding it here is how
    // a suite stops being evidence. Stated explicitly so nobody has to know
    // the default.
    retry: 0,

    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'scripts/lib/**/*.ts'],
      // Every file matching `include` appears in the report whether or not a
      // test imports it. An entirely untested module has to show up at 0%: a
      // per-file threshold cannot fail on a file that is missing from the
      // report.
      exclude: ['**/*.{test,spec}.ts'],
      thresholds: {
        // Per file, not across the repository. A repository-wide average lets
        // a well-tested module pay for an untested one, which is exactly the
        // case where the number stops meaning anything: the file a reviewer
        // would have worried about is the one the average is hiding.
        //
        // This is also what stands in for diff coverage here. No tool in this
        // toolchain measures coverage of changed lines, but a new file cannot
        // enter the repository below the bar, and an existing file cannot be
        // pushed below it either.
        perFile: true,
        lines: 95,
        functions: 95,
        branches: 95,
        statements: 95,
      },
    },
  },
});
