import { defineConfig } from '@playwright/test';

const preview = 'bunx --bun --no-install vite preview --host 127.0.0.1 --port 4174';

export default defineConfig({
  testDir: './tests/browser', testMatch: '**/*.pw.ts', workers: 1,
  use: { baseURL: 'http://127.0.0.1:4174', viewport: { width: 1000, height: 760 } },
  projects: [{ name: 'webkit', use: { browserName: 'webkit' } }, { name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: process.env.PREVIEW_PRO_MAX_USE_BUILT_WEB === '1' ? preview : `bun run build:web && ${preview}`,
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
  },
});
