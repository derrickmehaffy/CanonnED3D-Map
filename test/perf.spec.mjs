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

test('mousemove raycasts are coalesced and scoped to hit candidates', async ({ page }) => {
  await stubDataHosts(page);
  await page.goto(REFERENCE_PAGE, { waitUntil: 'load' });
  await waitForScene(page, expect);

  // Fire a genuine burst of 30 mousemove events synchronously in one JS tick
  // (dispatched directly on `container`, the element Action.init() attaches
  // its listener to) rather than via page.mouse.move(). In this sandboxed,
  // software-rendered (SwiftShader) environment, page.mouse.move()'s CDP
  // round trip paces real input at roughly one event per animation frame, so
  // it can never produce a same-frame burst for the coalescing wrapper to
  // collapse — measured at ~16-18ms per call, matching the render loop's own
  // frame period. Dispatching in-page reproduces the actual condition
  // (many mousemoves arriving before the next requestAnimationFrame) that
  // onMouseHover's coalescing guards against.
  const ray = await page.evaluate(async () => {
    window.__ray = { calls: 0, maxTargets: 0 };
    const proto = THREE.Raycaster.prototype;
    const orig = proto.intersectObjects;
    proto.intersectObjects = function (objects) {
      window.__ray.calls++;
      window.__ray.maxTargets = Math.max(window.__ray.maxTargets, objects.length);
      return orig.apply(this, arguments);
    };

    const rect = container.getBoundingClientRect();
    for (let i = 0; i < 30; i++) {
      container.dispatchEvent(new MouseEvent('mousemove', {
        clientX: rect.left + 200 + i * 4,
        clientY: rect.top + 200 + i * 2,
        bubbles: true
      }));
    }
    await new Promise((r) => setTimeout(r, 500));
    return window.__ray;
  });

  // 30 mousemoves fired in one burst must not produce 30 raycasts once
  // coalesced to one per frame.
  expect(ray.calls).toBeLessThan(30);
  // And each raycast must target the hit-candidate list, not every scene child.
  expect(ray.maxTargets).toBeLessThanOrEqual(3);
});

test('hover resolves the system under the cursor, and nothing over empty sky', async ({ page }) => {
  /* This used to assert `Action.hitCandidates().length > 0` — no mousemove, no
     ray, no system resolved, so every noun in the old title was unverified and
     emptying the candidate list would still have passed.

     It calls doMouseHover directly, which is the function the listener on
     `container` invokes. The coalescing wrapper in front of it is what the test
     above covers; driving a hover through real pointer delivery does not work
     in this software-rendered sandbox, for the reason that test records. What
     is exercised here is the part that was silently fragile: turning a pointer
     position into a ray. That maths divided CSS pixels by the renderer's
     backing-store size, which are equal only while the pixel ratio is 1, so it
     was correct by accident.

     Both directions matter: "resolves a system" means nothing without
     "resolves nothing over empty sky", since a hover that matched everything
     would satisfy the first on its own. */
  await stubDataHosts(page);
  await page.goto(REFERENCE_PAGE, { waitUntil: 'load' });
  await waitForScene(page, expect);
  await expect
    .poll(() => page.evaluate(() => window.__ed3dTestState().dataComplete), { timeout: 60_000 })
    .toBe(true);

  /* Aim and hover in one evaluate. Splitting them let the opening camera
     flight ease between the projection and the ray, so the pointer landed
     where the system had been a round trip ago — which is how this read as a
     picking failure when it was a stale target. */
  const aimAndHover = () => page.evaluate(() => {
    const r = renderer.domElement.getBoundingClientRect();
    for (let i = 0; i < System.points.length; i++) {
      const p = System.points[i];
      if (!p || !p.visible) continue;
      const v = new THREE.Vector3(p.x, p.y, p.z).project(camera);
      if (v.z > 1 || Math.abs(v.x) > 0.5 || Math.abs(v.y) > 0.5) continue;
      const x = r.left + (v.x * 0.5 + 0.5) * r.width;
      const y = r.top + (-v.y * 0.5 + 0.5) * r.height;
      Action.objHover = null;
      Action.doMouseHover({ clientX: x, clientY: y, preventDefault() {} }, Action);
      const hit = Action.objHover;
      return {
        aimed: p.name,
        resolved: hit === null || hit === undefined ? null : (System.points[hit] || {}).name || null
      };
    }
    return null;
  });

  const over = await aimAndHover();
  expect(over, 'no system is projected inside the canvas to aim at').not.toBeNull();
  expect(over.resolved, 'a pointer over a system resolves that system').toBe(over.aimed);

  const sky = await page.evaluate(() => {
    const r = renderer.domElement.getBoundingClientRect();
    Action.objHover = null;
    Action.doMouseHover({ clientX: r.left + 2, clientY: r.top + 2, preventDefault() {} }, Action);
    return Action.objHover;
  });
  expect(sky, 'and the corner furthest from the data resolves none').toBeNull();
});

test('the map caps its pixel ratio, and picking is measured in CSS pixels', async ({ page }) => {
  /* Uncapped, a phone at devicePixelRatio 3 renders a backing store nine times
     the CSS area, with MSAA and the postfx targets on top, for vertices a few
     pixels across. The orrery already capped at 2; the map did not.

     The two halves are one change. Picking used to divide CSS-pixel pointer
     coordinates by renderer.domElement.width — the backing store — which is
     only the same number while the ratio is 1. Capping without fixing that
     would have put every click at half its intended position, so this asserts
     both: the cap is applied, and the rect the maths uses is CSS pixels. */
  await stubDataHosts(page);
  await page.goto(REFERENCE_PAGE, { waitUntil: 'load' });
  await waitForScene(page, expect);

  const m = await page.evaluate(() => {
    const r = renderer.domElement.getBoundingClientRect();
    const rect = Action.mapRect();
    return {
      ratio: renderer.getPixelRatio(),
      dpr: window.devicePixelRatio,
      composerRatio: (PostFX && PostFX.composer) ? PostFX.composer.getPixelRatio() : null,
      // mapRect must report the CSS box, not the backing store.
      rectIsCss: Math.abs(rect.width - r.width) < 0.5 && Math.abs(rect.height - r.height) < 0.5,
      backingIsRatioTimesCss:
        Math.abs(renderer.domElement.width - r.width * renderer.getPixelRatio()) < 1.5
    };
  });

  expect(m.ratio, 'the cap must hold however high the screen goes').toBeLessThanOrEqual(2);
  expect(m.ratio).toBe(Math.min(m.dpr || 1, 2));
  expect(m.rectIsCss, 'Action.mapRect must measure CSS pixels, not the backing store').toBe(true);
  expect(m.backingIsRatioTimesCss, 'and the backing store should follow the ratio').toBe(true);
  if (m.composerRatio !== null) {
    expect(m.composerRatio, 'the bloom chain renders at the same ratio').toBe(m.ratio);
  }
});
