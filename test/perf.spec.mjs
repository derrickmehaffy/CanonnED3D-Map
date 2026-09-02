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
