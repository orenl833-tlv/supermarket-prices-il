import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests share one throwaway database and reset its schema,
    // so test files run one after another.
    fileParallelism: false,
  },
});
