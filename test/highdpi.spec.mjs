/**
 * The suite's default project runs at devicePixelRatio 1, which is exactly the
 * ratio at which a whole class of bug is invisible: anything that confuses CSS
 * pixels with the renderer's backing store is correct at 1 and wrong
 * everywhere else. Phones are 2 or 3.
 *
 * This file exists to run at 3.
 */
import { test, expect } from '@playwright/test';
import { stubDataHosts, waitForScene, REFERENCE_PAGE } from './helpers.mjs';

test.use({ deviceScaleFactor: 3, viewport: { width: 752, height: 650 } });

test('the pixel ratio is capped, and picking still lands on the right system', async ({ page }) => {
  /* Two halves of one change, and they only make sense together.

     The map built its renderer with no setPixelRatio, so at DPR 3 the backing
     store was nine times the CSS area — 3.9 megapixels on a phone-sized
     canvas, with MSAA and the postfx targets on top — for a point cloud whose
     vertices are a few pixels across.

     But the picking maths divided CSS-pixel pointer coordinates by
     renderer.domElement.width, which is the backing store. At ratio 1 those
     are the same number, so it was right by accident; capping the ratio alone
     would have put every click and hover at half its intended position.
     Action.mapRect() measures the CSS box now. */
  await stubDataHosts(page);
  await page.goto(REFERENCE_PAGE, { waitUntil: 'load' });
  await waitForScene(page, expect);
  await expect
    .poll(() => page.evaluate(() => window.__ed3dTestState().dataComplete), { timeout: 60_000 })
    .toBe(true);

  const m = await page.evaluate(() => {
    const r = renderer.domElement.getBoundingClientRect();
    // Aim and hover in the same turn: the opening flight is still easing, and
    // a round trip between projecting and casting is enough for it to move.
    let hover = null;
    for (let i = 0; i < System.points.length; i++) {
      const p = System.points[i];
      if (!p || !p.visible) continue;
      const v = new THREE.Vector3(p.x, p.y, p.z).project(camera);
      if (v.z > 1 || Math.abs(v.x) > 0.5 || Math.abs(v.y) > 0.5) continue;
      Action.objHover = null;
      Action.doMouseHover({
        clientX: r.left + (v.x * 0.5 + 0.5) * r.width,
        clientY: r.top + (-v.y * 0.5 + 0.5) * r.height,
        preventDefault() {}
      }, Action);
      const h = Action.objHover;
      hover = { aimed: p.name, resolved: h == null ? null : (System.points[h] || {}).name || null };
      break;
    }
    return {
      dpr: window.devicePixelRatio,
      ratio: renderer.getPixelRatio(),
      cssWidth: r.width,
      backingWidth: renderer.domElement.width,
      hover
    };
  });

  expect(m.dpr, 'this file is pointless unless the context really is high-DPI').toBe(3);
  expect(m.ratio, 'capped at 2 even at DPR 3').toBe(2);
  expect(m.backingWidth, 'the backing store follows the capped ratio')
    .toBe(Math.round(m.cssWidth * 2));

  expect(m.hover, 'no system was projected inside the canvas to aim at').not.toBeNull();
  expect(m.hover.resolved, 'picking must still land on the aimed system at DPR 3')
    .toBe(m.hover.aimed);
});
