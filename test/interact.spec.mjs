import { test, expect } from '@playwright/test';
import { stubDataHosts, waitForScene, REFERENCE_PAGE } from './helpers.mjs';

/* The parts of the console a person reaches for that nothing else drives.
 *
 * console.spec, card.spec, panel.spec and engine.spec already click a good
 * deal — layers, the systems list, the card, the display switches. What none
 * of them touch is the command palette, the camera panel, or the journal
 * drop, and those are the three places the console does something rather than
 * shows something. A palette that stops opening, or a camera preset that stops
 * moving the camera, would have gone out green.
 */

async function onMap(page) {
  await stubDataHosts(page);
  await page.goto(REFERENCE_PAGE, { waitUntil: 'domcontentloaded' });
  await waitForScene(page, expect);
}

const rail = (p) => `.rail button[data-p="${p}"]`;

/* ── the command palette ────────────────────────────────────────────────── */

test('the palette opens on the keyboard and closes on Escape', async ({ page }) => {
  await onMap(page);

  const scrim = page.locator('#scrim');
  await expect(scrim).not.toHaveClass(/open/);

  await page.keyboard.press('ControlOrMeta+k');
  await expect(scrim).toHaveClass(/open/);
  // Focus lands in the box, so the next thing typed is the query.
  await expect(page.locator('#pq')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(scrim).not.toHaveClass(/open/);
});

test('the palette finds a map and goes there', async ({ page }) => {
  await onMap(page);
  await page.locator('#findbtn').click();
  await page.locator('#pq').fill('Orrery');

  const rows = page.locator('#pres .pr');
  await expect(rows.first()).toBeVisible();
  await expect(rows.first()).toContainText('Orrery');
  // The typed part is marked in the row rather than the row merely matching.
  await expect(rows.first().locator('mark')).toHaveText(/Orrery/i);

  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/orrery\.html/, { timeout: 30_000 });
});

test('the arrows move the selection before Enter takes it', async ({ page }) => {
  await onMap(page);
  await page.locator('#findbtn').click();
  await page.locator('#pq').fill('data');

  const rows = page.locator('#pres .pr');
  await expect(rows.nth(1)).toBeVisible();
  const chosen = () => page.locator('#pres .pr[aria-selected="true"]');

  // The first row is the one Enter would take.
  await expect(chosen()).toHaveCount(1);
  const first = await chosen().textContent();

  await page.keyboard.press('ArrowDown');
  await expect(chosen()).not.toHaveText(first);
  await page.keyboard.press('ArrowUp');
  await expect(chosen()).toHaveText(first);
});

test('>tools narrows the palette to the tools', async ({ page }) => {
  await onMap(page);
  // The Tools button is the same palette, pre-filtered.
  await page.locator('#toolsbtn').click();
  await expect(page.locator('#pq')).toHaveValue('>tools ');

  const groups = page.locator('#pres .pg');
  await expect(groups).toHaveCount(1);
  await expect(groups.first()).toContainText('Canonn tools');
  // Every row is an outbound tool, not a map or a system.
  const rows = page.locator('#pres .pr');
  expect(await rows.count()).toBeGreaterThan(4);
  await expect(page.locator('#pres .pr:not(.ext)')).toHaveCount(0);
});

test('a system this map does not have offers Signals rather than nothing',
  async ({ page }) => {
  await onMap(page);
  await page.locator('#findbtn').click();
  // A name no map here carries.
  await page.locator('#pq').fill('Zzyzx Prime');

  const groups = page.locator('#pres .pg');
  await expect(groups.filter({ hasText: 'Not on this map' })).toHaveCount(1);
  await expect(page.locator('#pres .pr').last()).toContainText('Signals');
});

/* ── the camera panel ───────────────────────────────────────────────────── */

test('the camera presets actually move the camera', async ({ page }) => {
  await onMap(page);
  await page.locator(rail('camera')).click();
  await expect(page.locator('#camrange')).toBeVisible();

  const at = () => page.evaluate(() => ({
    x: Math.round(camera.position.x), y: Math.round(camera.position.y),
    z: Math.round(camera.position.z)
  }));

  await page.locator('[data-cam="top"]').click();
  await expect.poll(async () => (await at()).y, { timeout: 10_000 }).toBeGreaterThan(0);
  const top = await at();
  /* Top down means looking down: the height carries the distance and the
     other two axes are at the target. */
  expect(Math.abs(top.x)).toBeLessThan(top.y);
  expect(Math.abs(top.z)).toBeLessThan(top.y);

  await page.locator('[data-cam="side"]').click();
  await expect.poll(async () => Math.abs((await at()).y), { timeout: 10_000 })
    .toBeLessThan(Math.abs(top.y));

  // And the readout follows, in light years rather than in engine units.
  await expect(page.locator('#camdist')).toHaveText(/[0-9,]+ ly/);
});

test('the distance slider drives the camera and the readout together',
  async ({ page }) => {
  await onMap(page);
  await page.locator(rail('camera')).click();

  const dist = () => page.evaluate(() =>
    Math.round(camera.position.distanceTo(controls.target)));
  const before = await dist();

  // On a step boundary, or the input refuses the value outright.
  const slider = page.locator('#camrange');
  const want = Math.max(400, Math.round(before / 2 / 100) * 100);
  await slider.fill(String(want));
  await slider.dispatchEvent('input');

  await expect.poll(dist, { timeout: 10_000 }).toBeLessThan(before);
  // The number beside it is the same number.
  const shown = await page.locator('#camdist').textContent();
  expect(Math.abs(parseInt(shown.replace(/[^0-9]/g, ''), 10) - (await dist())))
    .toBeLessThan(60);
});

/* ── the journal drop ───────────────────────────────────────────────────── */

test('a dropped journal is plotted as a route', async ({ page }) => {
  await onMap(page);
  await page.locator(rail('routes')).click();
  await expect(page.locator('#drop')).toBeVisible();

  /* Three jumps out of a real Journal: one FSDJump per line, each its own
     JSON object, which is the shape the game writes. */
  const journal = [
    { event: 'FSDJump', StarSystem: 'Deciat', StarPos: [122.62, -0.81, -47.28] },
    { event: 'Scan', StarSystem: 'Deciat' },
    { event: 'FSDJump', StarSystem: 'Maia', StarPos: [-81.62, -149.43, -343.25] },
    { event: 'FSDJump', StarSystem: 'Merope', StarPos: [-78.59, -149.62, -340.53] }
  ].map((o) => JSON.stringify(o)).join('\n');

  await page.locator('#fileinput').setInputFiles({
    name: 'Journal.2026-09-06T120000.01.log',
    mimeType: 'text/plain',
    buffer: Buffer.from(journal)
  });

  // It lands in the panel as a layer, counted by the jumps it found.
  const added = page.locator('#side .layer', { hasText: 'Journal' });
  await expect(added).toBeVisible({ timeout: 20_000 });
  await expect(added.locator('.ct')).toHaveText('3');
});

/* ── views worth keeping, and the view as a file ────────────────────────── */

test('a view can be saved and come back to', async ({ page }) => {
  await onMap(page);
  await page.locator(rail('camera')).click();

  await expect(page.locator('.marks [data-mark]')).toHaveCount(0);
  await page.locator('[data-cam="top"]').click();
  await page.locator('#marksave').click();
  await expect(page.locator('.marks [data-mark]')).toHaveCount(1);

  // Somewhere else entirely, then back to the saved one.
  await page.locator('[data-cam="side"]').click();
  await page.waitForTimeout(400);
  const away = await page.evaluate(() => Math.round(camera.position.y));

  await page.locator('.marks [data-mark]').first().click();
  await expect.poll(() => page.evaluate(() => Math.round(camera.position.y)),
    { timeout: 10_000 }).toBeGreaterThan(away);

  // And it is kept per map, so it is still there on the next visit.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForScene(page, expect);
  await page.locator(rail('camera')).click();
  await expect(page.locator('.marks [data-mark]')).toHaveCount(1);

  // Forgetting one takes it away.
  await page.locator('.marks [data-markx]').first().click();
  await expect(page.locator('.marks [data-mark]')).toHaveCount(0);
});

test('the map can be saved as a picture', async ({ page }) => {
  await onMap(page);
  await page.locator(rail('camera')).click();

  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 20_000 }),
    page.locator('#mapshot').click()
  ]);
  expect(dl.suggestedFilename()).toMatch(/\.png$/);
  const path = await dl.path();
  const { readFileSync } = await import('node:fs');
  const bytes = readFileSync(path);
  expect(bytes.length).toBeGreaterThan(10_000);
  // A PNG, and not a blank one — the renderer has no preserveDrawingBuffer, so
  // drawing and reading have to happen in the same task or this is empty.
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
});
