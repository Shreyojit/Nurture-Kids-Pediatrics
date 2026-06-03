import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Runs 05-appnav-badge.spec.ts against the admin-mode build (VITE_APP_MODE=admin).
    // Regression guard: patients must not see the ADMIN badge when in admin mode.
    {
      name: 'chromium-admin',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5174' },
      testMatch: '**/05-appnav-badge.spec.ts',
    },
  ],
  // Start both servers automatically when running tests.
  // Set PLAYWRIGHT_SKIP_SERVER=1 if you want to manage them yourself.
  webServer: process.env.PLAYWRIGHT_SKIP_SERVER
    ? undefined
    : [
        {
          command: 'npm run dev -w apps/api',
          url: 'http://localhost:4000/health',
          reuseExistingServer: true,
          timeout: 30_000,
          stdout: 'ignore',
          stderr: 'pipe',
        },
        {
          command: 'npm run dev -w apps/web',
          url: 'http://localhost:5173',
          reuseExistingServer: true,
          timeout: 30_000,
          stdout: 'ignore',
          stderr: 'pipe',
        },
        {
          command: 'npm run dev:admin -w apps/web',
          url: 'http://localhost:5174',
          reuseExistingServer: true,
          timeout: 30_000,
          stdout: 'ignore',
          stderr: 'pipe',
        },
      ],
});
