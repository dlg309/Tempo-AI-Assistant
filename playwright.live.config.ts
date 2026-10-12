import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "live.spec.ts",
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.TEMPO_TEST_BASE_URL || "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
});
