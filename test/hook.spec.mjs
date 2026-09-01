import { test, expect } from '@playwright/test';

// voyager.html is used rather than index.html: index.html loads
// MapData-multifaction.js, which logs a warning and returns WITHOUT calling
// Ed3d.init() when no ?factions= parameter is present, so no scene ever exists.
// voyager.html has a single local data file, no URL parameters and no network.
const REFERENCE_PAGE = '/voyager.html';

test('__ed3dTestState reports scene readiness', async ({ page }) => {
  // No analytics beacons from the test suite. helpers.mjs does not exist yet,
  // so this is inline; Task 3 replaces it with stubDataHosts().
  await page.route(/googletagmanager\.com/, (r) => r.abort());

  await page.goto(REFERENCE_PAGE, { waitUntil: 'load' });

  await expect
    .poll(() => page.evaluate(() => typeof window.__ed3dTestState), { timeout: 30_000 })
    .toBe('function');

  await expect
    .poll(() => page.evaluate(() => window.__ed3dTestState().sceneVisible), { timeout: 60_000 })
    .toBe(true);

  // sceneVisible flips true before data finishes loading (launchMap() calls
  // showScene() early so the galaxy/grid render while systems stream in), so
  // dataComplete must be polled separately rather than asserted inline.
  await expect
    .poll(() => page.evaluate(() => window.__ed3dTestState().dataComplete), { timeout: 60_000 })
    .toBe(true);

  const state = await page.evaluate(() => window.__ed3dTestState());
  // voyager.html loads local system data and Sagittarius A* is registered as
  // a clickable particle on every map, so systemCount must be > 0 once
  // dataComplete is true.
  expect(state.systemCount).toBeGreaterThan(0);
});
