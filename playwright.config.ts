import { defineConfig, devices } from '@playwright/test'

// TEST-3: Chromium, WebKit and Firefox at 1440×900; Chromium and WebKit at 393×852.
// Set PW_PROJECTS=chromium (comma-separated) to run a subset, e.g. where only Chromium is installed.
const desktop = { viewport: { width: 1440, height: 900 } }
const phone = { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }

const all = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'], ...desktop } },
  { name: 'webkit', use: { ...devices['Desktop Safari'], ...desktop } },
  { name: 'firefox', use: { ...devices['Desktop Firefox'], ...desktop } },
  { name: 'chromium-phone', use: { ...devices['Pixel 7'], ...phone } },
  { name: 'webkit-phone', use: { ...devices['iPhone 15'], ...phone } },
]
const wanted = process.env.PW_PROJECTS?.split(',').map((s) => s.trim())
const port = Number(process.env.PW_PORT ?? 4173)

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}/`,
    trace: 'retain-on-failure',
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    // The fake GitHub is wired with page routes; keep the service worker out of the way.
    serviceWorkers: 'block',
  },
  projects: wanted ? all.filter((p) => wanted.includes(p.name)) : all,
  webServer: {
    command: `npm run build && npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
