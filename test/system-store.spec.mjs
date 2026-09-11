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

test('the point cloud is a BufferGeometry with typed attributes', async ({ page }) => {
  await stubDataHosts(page);
  await page.goto(REFERENCE_PAGE, { waitUntil: 'load' });
  await waitForScene(page, expect);
  await expect
    .poll(() => page.evaluate(() => window.__ed3dTestState().dataComplete), { timeout: 60_000 })
    .toBe(true);

  const r = await page.evaluate(() => {
    const g = System.particle.geometry;
    const pos = g.attributes && g.attributes.position;
    return {
      isBuffer: g instanceof THREE.BufferGeometry,
      hasLegacyVertices: Array.isArray(g.vertices) && g.vertices.length > 0,
      positionIsFloat32: pos ? pos.array instanceof Float32Array : false,
      positionCount: pos ? pos.count : -1,
      count: System.count
    };
  });

  expect(r.isBuffer).toBe(true);
  expect(r.hasLegacyVertices).toBe(false);
  expect(r.positionIsFloat32).toBe(true);
  // One vec3 per system.
  expect(r.positionCount).toBe(r.count);
});

test('setColor changes the rendered colour without clobbering the base colour', async ({ page }) => {
  await stubDataHosts(page);
  await page.goto(REFERENCE_PAGE, { waitUntil: 'load' });
  await waitForScene(page, expect);
  await expect
    .poll(() => page.evaluate(() => window.__ed3dTestState().dataComplete), { timeout: 60_000 })
    .toBe(true);

  // The HUD's category filter dims a system by calling System.setColor(i, #111111),
  // then restores it by reading points[i].color back. So points[i].color has to
  // survive being dimmed — otherwise re-enabling a filter leaves the systems grey.
  const r = await page.evaluate(() => {
    const i = System.points.findIndex((p) => p && p.color);
    if (i < 0) return { found: false };
    const base = System.points[i].color.getHexString();

    System.setColor(i, new THREE.Color('#111111'));
    const afterDim = {
      base: System.points[i].color.getHexString(),
      drawn: System.particleGeo.attributes.color.array[i * 3]
    };

    // restore exactly the way hud.class.js does
    System.setColor(i, System.points[i].color);
    return {
      found: true,
      base,
      baseAfterDim: afterDim.base,
      drawnWhenDim: afterDim.drawn,
      restored: System.particleGeo.attributes.color.array[i * 3]
    };
  });

  /* This used to be `if (r.skipped) test.skip(...)`, which meant a regression
     that stopped assigning category colours made the test *skip* rather than
     fail — the suite would have gone green on a map with no coloured systems
     at all. The reference page always has them; their absence is the failure. */
  expect(r.found, 'the reference page must have coloured systems to test with').toBe(true);
  expect(r.baseAfterDim, 'base colour survives dimming').toBe(r.base);
  expect(r.drawnWhenDim, 'dimming actually changed the drawn colour').toBeLessThan(0.2);
  expect(r.restored, 'restoring brings the drawn colour back').toBeGreaterThan(0.2);
});
