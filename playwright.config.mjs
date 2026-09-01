import { defineConfig, devices } from '@playwright/test';

const BASE = 'http://localhost:4173';

export default defineConfig({
  testDir: './test',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  timeout: 120_000,
  expect: {
    timeout: 15_000,
    // WebGL + SwiftShader is not bit-identical across machines; allow a small
    // tolerance while still catching structural changes such as a grid whose
    // line spacing shifts by 100x.
    toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled' }
  },
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
  projects: [
    // 'offline' runs every spec except the live one. Do NOT narrow this to
    // smoke.spec.mjs — perf, deadcode and hook specs all run under it.
    { name: 'offline', testIgnore: /live\.spec\.mjs/ },
    { name: 'live', testMatch: /live\.spec\.mjs/ }
  ],
  webServer: {
    command: 'node test/server.mjs',
    url: `${BASE}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});
