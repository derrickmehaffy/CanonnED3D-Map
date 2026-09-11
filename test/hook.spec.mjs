import { test, expect } from '@playwright/test';
import { stubDataHosts, REFERENCE_PAGE } from './helpers.mjs';

/* REFERENCE_PAGE is voyager.html, and helpers.mjs records why: index.html
   loads MapData-multifaction.js, which returns without calling Ed3d.init()
   when there is no ?factions= parameter, so no scene ever exists. This file
   used to re-declare the constant and explain it again. */

test('__ed3dTestState reports scene readiness', async ({ page }) => {
  /* This was an inline googletagmanager abort with a comment saying helpers.mjs
     "does not exist yet" and that a later task would replace it. It does exist,
     and this was the only spec with no catch-all data-host guard — so a new
     data source added to a page this file loads would have reached the network
     from here and nowhere else. */
  await stubDataHosts(page);

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
