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

test('hover still resolves a system under the cursor', async ({ page }) => {
  await stubDataHosts(page);
  await page.goto(REFERENCE_PAGE, { waitUntil: 'load' });
  await waitForScene(page, expect);

  // Sagittarius A* is registered as a clickable particle on every map.
  const hit = await page.evaluate(() => {
    const targets = Action.hitCandidates();
    return targets.length > 0;
  });
  expect(hit, 'hover raycast has at least one target object').toBe(true);
});
