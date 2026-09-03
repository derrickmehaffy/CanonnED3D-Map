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
