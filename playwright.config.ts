import { defineConfig, devices } from '@playwright/test';

const externalBaseUrl = process.env.E2E_BASE_URL?.trim();
const localBaseUrl = 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['line'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: externalBaseUrl || localBaseUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-mobile',
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: 'npm run dev',
        url: `${localBaseUrl}/api/live`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'ignore',
        stderr: 'pipe',
        env: {
          ...process.env,
          NODE_ENV: 'development',
          PORT: '4173',
          DISABLE_HMR: 'true',
        },
      },
});
