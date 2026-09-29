import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', testMatch: '**/*.pw.ts', workers: 1,
  use: { baseURL: 'http://127.0.0.1:4174', viewport: { width: 1000, height: 760 } },
  projects: [{ name: 'webkit', use: { browserName: 'webkit' } }, { name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: { command: 'bun run dev:web -- --port 4174', url: 'http://127.0.0.1:4174', reuseExistingServer: !process.env.CI },
});
