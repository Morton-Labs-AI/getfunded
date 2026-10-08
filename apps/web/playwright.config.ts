import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke tests run against the production build (`npm run build` first). The
 * server is started here with the environment the suite assumes, so a local
 * run and CI behave the same:
 *
 *   AI_MODE=mock       deterministic, token-free model client (no key needed)
 *   SELF_HOSTED=true   every workspace on the internal plan, billing hidden
 *   TRUST_PROXY=true   off Vercel the app ignores X-Forwarded-For unless told to
 *                      trust it, so every request would read as the one "unknown"
 *                      address and the whole suite (plus anything else hitting the
 *                      server) would share a single anonymous rate-limit bucket
 *                      (30/min). `next start` fills X-Forwarded-For from the socket
 *                      address, so with the flag requests bucket by real client
 *                      address, and a test may send its own X-Forwarded-For
 *   APP_URL            absolute origin for links and same-origin checks
 *
 * Set PLAYWRIGHT_BASE_URL (for example http://localhost:3051) to target another
 * port; the server command follows it. With a server already listening there,
 * it is reused (except in CI), so its own environment must then match the above.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL?.replace(/\/$/, "") || "http://localhost:3050";
const port = new URL(baseURL).port || "3050";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: `npx next start -p ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      AI_MODE: "mock",
      SELF_HOSTED: "true",
      TRUST_PROXY: "true",
      APP_URL: baseURL,
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
