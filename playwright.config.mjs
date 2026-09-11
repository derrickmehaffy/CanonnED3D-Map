import { defineConfig, devices } from '@playwright/test';

const BASE = 'http://localhost:4173';

export default defineConfig({
  testDir: './test',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: BASE,
    viewport: { width: 1280, height: 800 },
    ...devices['Desktop Chrome'],
    launchOptions: {
      // Headless Chromium needs SwiftShader to produce a real WebGL context;
      // without these the canvas renders blank and every screenshot matches.
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    }
  },
  /* One project, and it runs every spec. There was a second, 'live', matching
     a test/live.spec.mjs that never existed — so `npm run test:live` ran zero
     tests while reading as coverage, and the page it was meant to cover
     (route_data.html) had none at all. That page has its own spec now, with
     shaped stubs; Canonn's cloud functions are billed per invocation, so
     nothing in this suite is allowed to reach them.

     Do NOT narrow this to smoke.spec.mjs — perf, deadcode, hook and the rest
     all run under it. */
  projects: [{ name: 'offline' }],
  webServer: {
    command: 'node test/server.mjs',
    url: `${BASE}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});
