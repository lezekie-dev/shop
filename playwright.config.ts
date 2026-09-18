import { defineConfig, devices } from "@playwright/test";

/**
 * Configuration Playwright.
 *
 * Les specs tournent contre un BUILD DE PRODUCTION, pas `next dev`.
 * Raison : en mode dev, webpack recharge les chunks client partagés entre
 * specs et laisse des modules sans leur helper `__webpack_require__.n`, ce qui
 * faisait échouer `guest-checkout.spec.ts` de façon intermittente
 * (`__webpack_require__.n is not a function` dans add-to-cart-form.tsx).
 * En production, pas de HMR ni de chunk réinvalidé : le test est stable.
 *
 * Deux façons de lancer :
 *   1. Serveur déjà en route (recommandé) :
 *        npm run build && npx next start -p 3108 &
 *        PLAYWRIGHT_BASE_URL=http://127.0.0.1:3108 npx playwright test
 *   2. Sans serveur : `npx playwright test` démarre le build + start ci-dessous.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3108",
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        // Build de prod puis serveur : évite le bug de chunks HMR en dev.
        command: "npm run build && npx next start -p 3108",
        url: "http://127.0.0.1:3108/api/health",
        reuseExistingServer: true,
        timeout: 300_000,
      },
});
