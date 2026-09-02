import { test, expect } from '@playwright/test';
import { stubDataHosts, waitForScene, REFERENCE_PAGE } from './helpers.mjs';

test('System exposes an index-aligned metadata array', async ({ page }) => {
  await stubDataHosts(page);
  await page.goto(REFERENCE_PAGE, { waitUntil: 'load' });
  await waitForScene(page, expect);
  await expect
    .poll(() => page.evaluate(() => window.__ed3dTestState().dataComplete), { timeout: 60_000 })
    .toBe(true);

  const r = await page.evaluate(() => {
    const idx = System.findByName('Sagittarius A*');
    return {
      count: System.count,
      pointsLength: System.points.length,
      sagIndex: idx,
      sagName: idx >= 0 ? System.points[idx].name : null,
      hasCoords: idx >= 0 && typeof System.points[idx].x === 'number'
    };
  });

  // Sagittarius A* is registered as a clickable particle on every map.
  expect(r.sagIndex).toBeGreaterThanOrEqual(0);
  expect(r.sagName).toBe('Sagittarius A*');
  expect(r.hasCoords).toBe(true);
  // The metadata array must stay index-aligned with the point count.
  expect(r.pointsLength).toBe(r.count);
});

test('findByName returns -1 for an unknown system', async ({ page }) => {
  await stubDataHosts(page);
  await page.goto(REFERENCE_PAGE, { waitUntil: 'load' });
  await waitForScene(page, expect);
  const missing = await page.evaluate(() => System.findByName('No Such System Anywhere'));
  expect(missing).toBe(-1);
});
