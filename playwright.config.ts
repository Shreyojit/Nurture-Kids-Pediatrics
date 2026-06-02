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
      ],
});
