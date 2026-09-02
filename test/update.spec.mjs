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
