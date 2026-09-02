import { test, expect } from '@playwright/test';
import { stubDataHosts } from './helpers.mjs';

// voyager.html is the first page converted to the console chrome.
const PAGE = '/voyager.html';

async function ready(page) {
  await stubDataHosts(page);
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  // The console populates only once Ed3d reports its data complete.
  await expect(page.locator('#side .layer').first()).toBeVisible({ timeout: 60_000 });
}

test('the console replaces the nav and injects its own chrome', async ({ page }) => {
  await ready(page);
  await expect(page.locator('#cssmenu')).toHaveCount(0);   // include/nav.html is gone
  await expect(page.locator('.app .top')).toBeVisible();
  await expect(page.locator('#mapname')).toHaveText('Voyager Pulsars');
});

test('Ed3d\'s own chrome stays hidden behind the console', async ({ page }) => {
  await ready(page);
  // These exist — the console drives #filters — but must never be on screen,
  // or they overlap the console's own controls.
  for (const sel of ['#hud', '#controls', '#hud-toggle']) {
    await expect(page.locator(sel)).toBeHidden();
  }
  // lcunfool's zoom/pan arrows are deliberately kept.
  await expect(page.locator('#nav-controls')).toBeVisible();
});

test('categories are read from Ed3d rather than configured per map', async ({ page }) => {
  await ready(page);
  const rows = page.locator('#side .layer');
  // voyager declares four categories; two hold points and are the ones listed.
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Sol');
  await expect(rows.nth(1)).toContainText('Voyager System');
  // The count column must not repeat Ed3d's own "(14)" suffix.
  await expect(rows.nth(1)).not.toContainText('(14)');
});

test('toggling a layer proxies through to Ed3d and updates the count', async ({ page }) => {
  await ready(page);
  const shown = page.locator('#st-shown');
  await expect(shown).toContainText('15 / 15');

  await page.locator('#side .layer').nth(1).click();       // hide Voyager System
  await expect(shown).toContainText('1 / 15');
  // Assert the engine's own state, not the anchor's attribute: Ed3d tracks
  // active through jQuery .data(), which never writes back to the DOM.
  const hidden = await page.evaluate(() =>
    Ed3d.catObjs['0'].every((i) => System.points[i].visible === false));
  expect(hidden, 'Ed3d hid the category the console toggled').toBe(true);

  await page.locator('#side .layer').nth(1).click();       // and back
  await expect(shown).toContainText('15 / 15');
});

test('the systems panel lists the map\'s systems', async ({ page }) => {
  await ready(page);
  await page.locator('.rail button[data-p="systems"]').click();
  const rows = page.locator('#side .sysrow');
  await expect(rows).toHaveCount(15);
  await expect(page.locator('#side')).toContainText('Sol');
});

test('the map index offers every destination the nav had', async ({ page }) => {
  await ready(page);
  await page.locator('#switcher').click();
  await expect(page.locator('#idxscrim')).toHaveClass(/open/);
  // The catalogue is generated from include/nav.html, so nothing is lost.
  await expect(page.locator('#idxsub')).toHaveText(/84 maps/);
  await expect(page.locator('.idx-i.cur')).toContainText('Voyager Pulsars');
  await expect(page.locator('.idx-i[href="gr-data.html"]')).toHaveCount(1);
});
