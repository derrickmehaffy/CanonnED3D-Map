import { test, expect } from '@playwright/test';
import { stubDataHosts, waitForScene, REFERENCE_PAGE } from './helpers.mjs';

/* Dragging the map is the single most-used interaction and nothing else in this
 * suite touches it — every other test loads a page and reads state. This drives
 * real pointer input through CDP, because Playwright's own mouse API does not
 * produce the pointer-capture behaviour three.js OrbitControls relies on. */
test('dragging the map orbits the camera', async ({ page }) => {
  await stubDataHosts(page);
  await page.goto(REFERENCE_PAGE, { waitUntil: 'load' });
  await waitForScene(page, expect);
  await page.waitForTimeout(1500);

  const before = await page.evaluate(() => camera.position.toArray());

  const cdp = await page.context().newCDPSession(page);
  const box = await page.locator('#ed3dmap canvas').boundingBox();
  const x = Math.round(box.x + box.width * 0.6);
  const y = Math.round(box.y + box.height * 0.5);
  const btn = { button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' };

  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, ...btn });
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchMouseEvent',
      { type: 'mouseMoved', x: x - i * 14, y: y - i * 5, ...btn });
    await page.waitForTimeout(20);
  }
  await cdp.send('Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: x - 168, y: y - 60, ...btn });
  await page.waitForTimeout(800);

  const after = await page.evaluate(() => camera.position.toArray());
  const moved = Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]);

  expect(moved, 'camera should orbit when the map is dragged').toBeGreaterThan(1);
});
