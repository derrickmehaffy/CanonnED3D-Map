import { test, expect } from '@playwright/test';
import { stubDataHosts, waitForScene, REFERENCE_PAGE } from './helpers.mjs';

test('grid addCoords is throttled, not called every frame', async ({ page }) => {
  await stubDataHosts(page);
  await page.goto(REFERENCE_PAGE, { waitUntil: 'load' });
  await waitForScene(page, expect);

  const calls = await page.evaluate(async () => {
    let n = 0;
    const orig = Ed3d.grid1H.addCoords;
    Ed3d.grid1H.addCoords = function () {
      n++;
      return orig.apply(this, arguments);
    };
    await new Promise((r) => setTimeout(r, 1000));
    Ed3d.grid1H.addCoords = orig;
    return n;
  });

  // At 60 fps an unthrottled loop calls this ~60 times per second.
  // A 100 ms throttle yields ~10, so 20 is a generous ceiling.
  expect(calls).toBeLessThanOrEqual(20);
});

test('HUD readouts do not churn the DOM while the camera is idle', async ({ page }) => {
  await stubDataHosts(page);
  await page.goto(REFERENCE_PAGE, { waitUntil: 'load' });
  await waitForScene(page, expect);

  const mutations = await page.evaluate(async () => {
    const targets = ['cx', 'cy', 'cz', 'distsol']
      .map((id) => document.getElementById(id))
      .filter(Boolean);
    if (targets.length === 0) return -1;
    let n = 0;
    const obs = new MutationObserver((records) => { n += records.length; });
    targets.forEach((t) => obs.observe(t, { childList: true, characterData: true, subtree: true }));
    await new Promise((r) => setTimeout(r, 1000));
    obs.disconnect();
    return n;
  });

  expect(mutations, 'HUD elements were found').toBeGreaterThanOrEqual(0);
  // Idle camera means identical values; a correct implementation writes none.
  expect(mutations).toBeLessThanOrEqual(4);
});

test('HUD readouts still update when the camera moves', async ({ page }) => {
  await stubDataHosts(page);
  await page.goto(REFERENCE_PAGE, { waitUntil: 'load' });
  await waitForScene(page, expect);

  const before = await page.evaluate(() => document.getElementById('cx')?.textContent ?? null);
  await page.evaluate(async () => {
    controls.target.x += 500;
    await new Promise((r) => setTimeout(r, 300));
  });
  const after = await page.evaluate(() => document.getElementById('cx')?.textContent ?? null);

  expect(before).not.toBeNull();
  expect(after).not.toBe(before);
});
