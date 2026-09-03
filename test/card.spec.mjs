import { test, expect } from '@playwright/test';
import { stubDataHosts } from './helpers.mjs';

/* Thirty systems in three categories, injected rather than fetched so the
   assertions below are about numbers this file chose. */
async function map(page) {
  await stubDataHosts(page);
  await page.goto('/gr-data.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app .top')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => window.Ed3d && Ed3d.updateSystems, { timeout: 30_000 });
  await page.evaluate(() => new Promise((res) => Ed3d.updateSystems({
    categories: { 'Site type': {
      a: { name: 'Alpha', color: 'FF9D00' },
      b: { name: 'Beta',  color: '4DE3E1' },
      g: { name: 'Gamma', color: 'B98CFF' } } },
    systems: ['a', 'b', 'g'].flatMap((c, ci) =>
      Array.from({ length: 10 }, (_, i) => ({
        name: c.toUpperCase() + i, coords: { x: ci * 50 + i, y: 0, z: i }, cat: [c]
      })))
  }, res)));
  await expect(page.locator('#side .layer').first()).toBeVisible({ timeout: 30_000 });
}

async function pickFromList(page, name) {
  await page.locator('.rail button[data-p="systems"]').click();
  await page.locator('.sysrow[data-sys="' + name + '"]').click();
  await expect(page.locator('#card')).toBeVisible();
}

/* Ed3d leaves Action.selectedPoint set after a click, and the console polls it
   five times a second. Hiding the card without clearing that meant it came
   straight back — so this has to hold well past one poll interval. */
test('closing the card keeps it closed', async ({ page }) => {
  await map(page);
  await pickFromList(page, 'B3');
  await page.locator('#card-x').click();
  await expect(page.locator('#card')).toBeHidden();
  await page.waitForTimeout(1200);
  await expect(page.locator('#card')).toBeHidden();
});

test('closing the card takes the selection cursor off the map', async ({ page }) => {
  await map(page);
  await pickFromList(page, 'B3');
  await expect.poll(() => page.evaluate(() =>
    Action.cursor.selection && Action.cursor.selection.visible)).toBe(true);

  await page.locator('#card-x').click();
  await expect.poll(() => page.evaluate(() => ({
    point: Action.selectedPoint,
    cursor: Action.cursor.selection && Action.cursor.selection.visible
  }))).toEqual({ point: null, cursor: false });
});

/* Picking a row used to fly the camera and nothing else, so in a cluster there
   was no telling which of the points in view you had asked for. */
test('a system picked from the list is selected in the map', async ({ page }) => {
  await map(page);
  await pickFromList(page, 'G7');

  const state = await page.evaluate(() => ({
    name: Action.selectedPoint && Action.selectedPoint.name,
    visible: Action.cursor.selection.visible,
    at: Action.cursor.selection.position.toArray().map(Math.round)
  }));
  expect(state.name).toBe('G7');
  expect(state.visible).toBe(true);
  // Injected at x = 2*50 + 7, y = 0, z = 7 — and Ed3d negates z.
  expect(state.at).toEqual([107, 0, -7]);
});

/* The card is anchored to the right edge of the stage, so the grip is on the
   bottom-left: dragging left widens it and the right edge must not move. */
test('the card resizes from its bottom-left corner', async ({ page }) => {
  await map(page);
  await pickFromList(page, 'B3');

  const box = () => page.evaluate(() => {
    const b = document.getElementById('card').getBoundingClientRect();
    return { left: Math.round(b.left), right: Math.round(b.right),
             width: Math.round(b.width), height: Math.round(b.height) };
  });
  const before = await box();

  const grip = await page.locator('#card .c-grip').boundingBox();
  await page.mouse.move(grip.x + 8, grip.y + 8);
  await page.mouse.down();
  await page.mouse.move(grip.x + 8 - 120, grip.y + 8 + 60, { steps: 8 });
  await page.mouse.up();

  const after = await box();
  expect(after.right).toBe(before.right);
  expect(after.width).toBe(before.width + 120);
  expect(after.height).toBe(before.height + 60);
  expect(after.left).toBe(before.left - 120);
});

/* Hide-deselected acts on the types above it, so it belongs under both the
   bulk buttons and the rows themselves. */
test('the layers panel orders its controls before its options', async ({ page }) => {
  await map(page);
  const order = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#side .selrow, #side .layer, #side .hidechk'))
      .map((e) => e.className.split(' ')[0]));
  expect(order[0]).toBe('selrow');
  expect(order.at(-1)).toBe('hidechk');
  expect(order.filter((c) => c === 'layer')).toHaveLength(3);
});

/* ── the primary star ───────────────────────────────────────────────────────
   The card asks the endpoint Signals reads. Those cloud functions are billed
   per invocation, so what matters as much as the rendering is that a click
   costs at most one lookup and a second click on the same system costs none.
   The offline suite stubs that host with "[]", so the first test here is also
   the one that says a broken lookup must not take the card with it. */

const API = '**/us-central1-canonn-api-236217.cloudfunctions.net/**';

async function fakeStarApi(page, calls) {
  await page.route(API, async (route) => {
    const url = route.request().url();
    calls.push(url);
    const json = (body) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.includes('/typeahead')) {
      return json({ min_max: [{ id64: 42, name: 'B3', x: 0, y: 0, z: 0 }], values: ['B3'] });
    }
    return json({ system: {
      name: 'B3', bodyCount: 12,
      bodies: [
        { type: 'Star', name: 'B3 A', mainStar: true, subType: 'K (Yellow-Orange) Star',
          spectralClass: 'K3', luminosity: 'Va', surfaceTemperature: 4670,
          solarMasses: 0.675781, solarRadius: 0.847015, age: 10622 },
        { type: 'Star', name: 'B3 B', subType: 'M (Red dwarf) Star', spectralClass: 'M4' },
        { type: 'Planet', name: 'B3 1', isLandable: true },
        { type: 'Planet', name: 'B3 2', isLandable: false }
      ]
    } });
  });
}

test('the card reads the primary star out of the system dump', async ({ page }) => {
  const calls = [];
  await map(page);
  await fakeStarApi(page, calls);
  await pickFromList(page, 'B3');

  const star = page.locator('#cstar .c-star');
  await expect(star).toBeVisible();
  await expect(star.locator('.c-star-h b')).toHaveText('K3 Va');
  // Which star you actually drop out at, not just what is in the system.
  await expect(star.locator('.c-star-n')).toHaveText('AK (Yellow-Orange) Star');
  await expect(star.locator('.c-star-g')).toContainText('4,670 K');
  await expect(star.locator('.c-star-g')).toContainText('0.68 M');
  await expect(star.locator('.c-star-g')).toContainText('10.6 Gyr');
  // bodyCount from the system, landable counted from the bodies, and K is a
  // class a fuel scoop can use.
  await expect(star.locator('.c-star-f'))
    .toHaveText('12 bodies · 2 stars · 1 landable · scoopable');
});

test('a system is looked up once and then remembered', async ({ page }) => {
  const calls = [];
  await map(page);
  await fakeStarApi(page, calls);

  await pickFromList(page, 'B3');
  await expect(page.locator('#cstar .c-star-h b')).toHaveText('K3 Va');
  expect(calls).toHaveLength(2);              // typeahead, then the dump

  // Away and back: served from the cache, so the block is there on the first
  // frame and nothing is fetched.
  await page.locator('.sysrow[data-sys="G7"]').click();
  await page.locator('.sysrow[data-sys="B3"]').click();
  await expect(page.locator('#cstar .c-star-h b')).toHaveText('K3 Va');

  const forB3 = calls.filter((u) => u.includes('typeahead'));
  expect(forB3.filter((u) => u.includes('B3'))).toHaveLength(1);
});

/* typeahead is a prefix search: asking for a system the dump does not have
   answers with whatever merely starts the same way. */
test('a near miss from the lookup is not treated as the system', async ({ page }) => {
  await map(page);
  await page.route(API, (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ min_max: [{ id64: 9, name: 'B30', x: 0, y: 0, z: 0 }] })
  }));
  await pickFromList(page, 'B3');
  await expect(page.locator('#card')).toBeVisible();
  await expect(page.locator('#cstar .c-star')).toHaveCount(0);
});

/* The offline suite stubs that host with "[]". The card has to survive it. */
test('a failed lookup leaves the rest of the card alone', async ({ page }) => {
  await map(page);
  await pickFromList(page, 'B3');
  await expect(page.locator('#card .c-meta')).toContainText('ly from Sol');
  await expect(page.locator('#card .c-acts a')).toContainText('Open in Signals');
  await expect.poll(() => page.locator('#cstar .c-star').count()).toBe(0);
});
