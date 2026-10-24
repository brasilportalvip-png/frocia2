import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: 'professional-project-panel.spec.ts',
  outputDir: 'test-results/professional-panel',
  timeout: 30000, retries: process.env.CI ? 1 : 0, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4184', locale: 'pt-BR', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: { command: 'npx vite --host 127.0.0.1 --port 4184 --strictPort', url: 'http://127.0.0.1:4184/e2e/fixtures/project-configuration.html', reuseExistingServer: !process.env.CI },
});
