import { test, expect } from '@playwright/test';
import { stubDataHosts, waitForScene, REFERENCE_PAGE } from './helpers.mjs';

async function loaded(page) {
  await stubDataHosts(page);
  await page.goto(REFERENCE_PAGE, { waitUntil: 'load' });
  await waitForScene(page, expect);
  await expect
    .poll(() => page.evaluate(() => window.__ed3dTestState().dataComplete), { timeout: 60_000 })
    .toBe(true);
}

const DATA = {
  categories: { 'Test group': { t1: { name: 'One', color: 'FF9D00' }, t2: { name: 'Two', color: '4DE3E1' } } },
  systems: [
    { name: 'Alpha One', coords: { x: 10, y: 20, z: 30 }, cat: ['t1'], infos: 'first' },
    { name: 'Beta Two',  coords: { x: 40, y: 50, z: 60 }, cat: ['t2'] },
    { name: 'Gamma Two', coords: { x: 70, y: 80, z: 90 }, cat: ['t2'] }
  ]
};

test('updateSystems replaces the dataset without a reload', async ({ page }) => {
  await loaded(page);
  const r = await page.evaluate(async (data) => {
    const before = { count: System.count, hadVoyager: System.findByName('Sol') >= 0 };
    await new Promise((res) => Ed3d.updateSystems(data, res));
    return {
      before,
      after: System.count,
      names: System.points.map((p) => p.name),
      // Sagittarius A* is re-registered on every load as the reference point.
      sagittarius: System.findByName('Sagittarius A*') >= 0,
      // The old dataset's systems must be gone, not merged in.
      oldGone: System.findByName('PSR J1932+1059') === -1,
      cloudRebuilt: !!System.particle && System.particle.geometry.attributes.position.count === System.count
    };
  }, DATA);

  expect(r.before.count).toBeGreaterThan(3);
  expect(r.after).toBe(4);                    // 3 systems + Sagittarius A*
  expect(r.names).toContain('Alpha One');
  expect(r.sagittarius).toBe(true);
  expect(r.oldGone, 'the previous dataset is cleared, not appended to').toBe(true);
  expect(r.cloudRebuilt, 'the point cloud matches the new store').toBe(true);
});

test('updateSystems rebuilds the category indices consistently', async ({ page }) => {
  await loaded(page);
  const r = await page.evaluate(async (data) => {
    await new Promise((res) => Ed3d.updateSystems(data, res));
    const cats = Object.keys(Ed3d.catObjs);
    // Every index in catObjs must still address a real point: this is the
    // bookkeeping that a naive removal gets wrong.
    const dangling = cats.some((c) => Ed3d.catObjs[c].some((i) => !System.points[i]));
    return {
      cats,
      t2: (Ed3d.catObjs.t2 || []).map((i) => System.points[i].name).sort(),
      dangling,
      filters: document.querySelectorAll('#filters .map_filter').length
    };
  }, DATA);

  expect(r.cats.sort()).toEqual(['t1', 't2']);
  expect(r.t2).toEqual(['Beta Two', 'Gamma Two']);
  expect(r.dangling, 'no category index points past the end of the store').toBe(false);
  expect(r.filters, 'the old filters are replaced, not appended to').toBe(2);
});

test('the event bus reports changes and survives a throwing listener', async ({ page }) => {
  await loaded(page);
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(String(e)));

  const r = await page.evaluate(async (data) => {
    const seen = [];
    const bad = () => { throw new Error('listener blew up'); };
    const good = (p) => seen.push({ count: p.count, replaced: p.replaced });
    Ed3d.on('systemsChanged', bad).on('systemsChanged', good);
    await new Promise((res) => Ed3d.updateSystems(data, res));

    Ed3d.off('systemsChanged', good);
    await new Promise((res) => Ed3d.updateSystems(data, res));
    return { seen, afterOff: seen.length };
  }, DATA);

  // One event per load, not one per code path that could have fired it.
  expect(r.seen).toEqual([{ count: 4, replaced: true }]);
  expect(r.afterOff, 'off() unsubscribes').toBe(1);
  expect(crashes, 'a throwing listener is contained').toEqual([]);
});

test('routes arrive as an array or as an object, and both draw', async ({ page }) => {
  /* JSON_SCHEMA.md documents `routes` as an object keyed by route id; every
     MapData-*.js in the tree uses an array. jQuery's $.each walked both, so
     nobody noticed — until the migration to forEach, which walks only arrays.
     The documented shape then threw, and because loadDatasAsync is called
     synchronously from launchMap the throw skipped Loader.stop(), leaving the
     spinner up forever over an empty map. Both shapes are public API. */
  await loaded(page);

  const draw = (routes) =>
    page.evaluate((r) => new Promise((done) => {
      const before = [];
      scene.traverse((o) => { if (o.type === 'Line2' || o.isLine2) before.push(o); });
      let threw = null;
      try {
        Ed3d.updateSystems({
          categories: { 'Site type': { a: { name: 'Alpha', color: 'FF9D00' } } },
          systems: [
            { name: 'RouteEnd A', coords: { x: 0, y: 0, z: 0 }, cat: ['a'] },
            { name: 'RouteEnd B', coords: { x: 60, y: 0, z: 60 }, cat: ['a'] }
          ],
          routes: r
        }, () => {
          const after = [];
          scene.traverse((o) => { if (o.type === 'Line2' || o.isLine2) after.push(o); });
          done({ threw, lines: after.length });
        });
      } catch (e) {
        done({ threw: String(e), lines: -1 });
      }
    }), routes);

  const POINTS = [{ s: 'RouteEnd A' }, { s: 'RouteEnd B' }];

  const asArray = await draw([{ points: POINTS, cat: ['a'], circle: false }]);
  expect(asArray.threw, 'an array of routes must not throw').toBeNull();
  expect(asArray.lines, 'the array form should draw one line').toBeGreaterThan(0);

  // The documented shape. This is the one that used to throw.
  const asObject = await draw({ '0': { points: POINTS, cat: ['a'], circle: false } });
  expect(asObject.threw, 'an object of routes must not throw either').toBeNull();
  expect(asObject.lines, 'the object form should draw the same').toBe(asArray.lines);

  // And the loader must have been dismissed, which is what the throw broke.
  expect(await page.locator('#loader').count()).toBe(0);
});
