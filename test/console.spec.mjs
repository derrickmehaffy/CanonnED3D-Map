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

/* window.CONSOLE is the per-page escape hatch: everything in it has a working
   default, so no page has to declare anything, but a page that wants its own
   vocabulary or extra panel content can say so. gr-data.html is the first user
   — the ruin-type template maps Derrick asked for in the mockup. */
test('a page can opt in to template maps and its own vocabulary', async ({ page }) => {
  await stubDataHosts(page);
  await page.goto('/gr-data.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app .top')).toBeVisible({ timeout: 30_000 });

  // The offline suite never contacts ruins.canonn.tech, so push a known set in
  // through the engine's own replace path instead of waiting on the network.
  await page.waitForFunction(() => window.Ed3d && Ed3d.updateSystems, { timeout: 30_000 });
  await page.evaluate(() => new Promise((res) => Ed3d.updateSystems({
    categories: { 'Site type': {
      a: { name: 'Alpha', color: 'FF9D00' },
      b: { name: 'Beta',  color: '4DE3E1' },
      g: { name: 'Gamma', color: 'B98CFF' } } },
    systems: [
      { name: 'Ruin A', coords: { x: 10, y: 0, z: 10 }, cat: ['a'] },
      { name: 'Ruin B', coords: { x: 20, y: 0, z: 20 }, cat: ['b'] },
      { name: 'Ruin G', coords: { x: 30, y: 0, z: 30 }, cat: ['g'] }
    ]
  }, res)));
  await expect(page.locator('#side .layer').first()).toBeVisible({ timeout: 30_000 });

  // "ruins", not the generic "points".
  await expect(page.locator('#side .s-sub').first()).toContainText('ruins');

  const img = page.locator('#tmpl-img');
  await expect(img).toBeVisible();

  // Hovering a type swaps the template and its note.
  await page.locator('#side .layer').nth(1).hover();
  await expect(page.locator('#tmpl-n')).toHaveText('Beta');
  await expect(img).toHaveAttribute('src', 'img/ruins/beta.png');
  await expect(page.locator('#tmpl-f')).toContainText('central spire');

  // The image is real, not a broken reference.
  const drawn = await img.evaluate((el) => el.naturalWidth > 0);
  expect(drawn, 'the template image actually loaded').toBe(true);

  await page.locator('#side .layer').nth(0).hover();
  await expect(page.locator('#tmpl-n')).toHaveText('Alpha');
});

test('pages that declare nothing still get sane defaults', async ({ page }) => {
  await stubDataHosts(page);
  await page.goto('/voyager.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#side .layer').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#side .s-sub').first()).toContainText('points');
  // voyager declares no window.CONSOLE at all.
  await expect(page.locator('#tmpl-img')).toHaveCount(0);
});

/* Several ruins in one system share its coordinates, so Ed3d merges them into
   a single point and concatenates their info blocks. Each block therefore
   carries its own Bifrost link — a system with five ruins gets five, not one
   link to the site index. */
test('each site links to itself, and Inara is gone', async ({ page }) => {
  await stubDataHosts(page);
  await page.goto('/gr-data.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app .top')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => window.Ed3d && Ed3d.updateSystems, { timeout: 30_000 });

  await page.evaluate(() => new Promise((res) => Ed3d.updateSystems({
    categories: { 'Site type': { a: { name: 'Alpha', color: 'FF9D00' } } },
    systems: [
      { name: 'Twin Ruins', coords: { x: 5, y: 5, z: 5 }, cat: ['a'],
        infos: '<a href="https://ruins.canonn.tech/#GR6">Ancient Ruins (Alpha)</a><br>' },
      { name: 'Twin Ruins', coords: { x: 5, y: 5, z: 5 }, cat: ['a'],
        infos: '<a href="https://ruins.canonn.tech/#GR7">Ancient Ruins (Beta)</a><br>' }
    ]
  }, res)));
  await expect(page.locator('#side .layer').first()).toBeVisible({ timeout: 30_000 });

  await page.evaluate(() => {
    Action.selectedPoint = System.points[System.findByName('Twin Ruins')];
  });
  const card = page.locator('#card');
  await expect(card).toBeVisible({ timeout: 15_000 });

  // One link per site, each to its own page.
  const hrefs = await card.locator('.c-body a').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  expect(hrefs).toEqual(['https://ruins.canonn.tech/#GR6', 'https://ruins.canonn.tech/#GR7']);

  // The header describes the system, not the filter categories: two records
  // merged into one point is "2 ruins", however many categories it lands in.
  await expect(card.locator('.c-sec')).toContainText('2 ');

  // The site plan lives in the Layers panel; a second copy in the card only
  // made it taller.
  await expect(card.locator('.c-tmpl')).toHaveCount(0);

  // Signals covers everything the other tools did and links out itself.
  const actions = await card.locator('.c-acts a').evaluateAll((els) => els.map((e) => e.textContent));
  expect(actions.join(' ')).toContain('Signals');
  expect(actions.join(' ')).not.toContain('Inara');
});

test('the card stays clear of the zoom controls and can be moved', async ({ page }) => {
  await stubDataHosts(page);
  await page.goto('/voyager.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#side .layer').first()).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => { Action.selectedPoint = System.points[System.findByName('Sol')]; });
  await expect(page.locator('#card')).toBeVisible({ timeout: 15_000 });

  const clear = await page.evaluate(() => {
    const c = document.getElementById('card').getBoundingClientRect();
    const nav = document.getElementById('nav-controls').getBoundingClientRect();
    return !(c.bottom > nav.top && c.right > nav.left);
  });
  expect(clear, 'the card must not cover the zoom and pan arrows').toBe(true);

  // Dragging the header moves it, and the position is remembered.
  await page.evaluate(() => {
    const h = document.querySelector('#card .c-h');
    const r = h.getBoundingClientRect();
    h.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.x + 40, clientY: r.y + 8, pointerId: 1 }));
    h.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.x - 160, clientY: r.y + 60, pointerId: 1 }));
    h.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
  });
  await expect(page.locator('#card')).toHaveClass(/moved/);
  expect(await page.evaluate(() => localStorage.getItem('canonn.console.cardBox'))).toBeTruthy();
});

test('searching for a system this map does not have offers a way out', async ({ page }) => {
  await stubDataHosts(page);
  await page.goto('/voyager.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#side .layer').first()).toBeVisible({ timeout: 60_000 });

  await page.locator('#findbtn').click();
  await page.locator('#pq').fill('Shinrarta Dezhra');       // real system, not on this map
  await expect(page.locator('#pres')).toContainText('Not on this map');
  await expect(page.locator('#pres .pr .nm')).toContainText('Shinrarta Dezhra');

  // A local match must not be pushed aside by the fallback.
  await page.locator('#pq').fill('Sol');
  await expect(page.locator('#pres')).toContainText('Systems on this map');
});
