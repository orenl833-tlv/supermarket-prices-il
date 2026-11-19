import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests: the built web app served by the real API, against a
 * database seeded by e2e/seed.ts. Run with:
 *   DATABASE_URL=<throwaway db> npm run e2e:seed -w @spil/web
 *   npm run build -w @spil/web
 *   DATABASE_URL=<same db> npm run e2e -w @spil/web
 */
const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
    ...devices["iPhone 13"],
    browserName: "chromium", // iPhone viewport and touch, Chromium engine
  },
  webServer: {
    command: "npm start -w @spil/api",
    cwd: "../..",
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: String(PORT),
      DATABASE_URL: process.env.DATABASE_URL ?? "",
      // Delivery terms for the seeded online store of "יקרה" (see e2e/seed.ts).
      DELIVERY_TERMS_JSON: JSON.stringify([
        { chain: "יקרה", fee: 20, minimumOrder: 10, checkedAt: "2026-11-19", source: "e2e" },
      ]),
    },
  },
});
