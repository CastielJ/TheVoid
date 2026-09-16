import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    // Integration tests share one physical Postgres database and use
    // TRUNCATE for test isolation between tests — running test files in
    // parallel would let one file's TRUNCATE race another file's
    // in-flight assertions. Small suite, so serializing is cheap; revisit
    // only if suite runtime becomes a real problem.
    fileParallelism: false,
  },
});
