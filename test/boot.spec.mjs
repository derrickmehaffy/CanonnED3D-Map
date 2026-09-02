import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { stubDataHosts } from './helpers.mjs';

const DATA_DIR = fileURLToPath(new URL('../Source/data/', import.meta.url));
const CONSOLE_PAGE = '/prototype/console.html?map=gr';

/* The boot screen clears as soon as the data lands — about two seconds, and
   less under a warm cache. That is too quick to assert against, so tests that
   need to inspect it hold the map data back. Five seconds keeps the screen up
   without tripping the console's own 8 s fall-back-to-snapshot timer. */
function holdData(page, ms = 5000) {
  return page.addInitScript(`{
    const real = window.fetch;
    window.fetch = (...a) => new Promise((res) => setTimeout(() => res(real(...a)), ${ms}));
  }`);
}

/* The loading overlay is dismissed by the data layer, not by the engine: every
   MapData-*.js ends its load with
       document.getElementById('loading').style.display = 'none'
   including on its error paths. That id is a hard contract between the pages
   and all 35 data files. Renaming it — or dropping the element while migrating
   pages to the console — leaves the map behind a black screen with no error in
   the log, which is exactly the kind of break that only shows up in production. */
test('every MapData file dismisses the loading overlay', () => {
  const files = readdirSync(DATA_DIR).filter((f) => /^MapData-.*\.js$/.test(f));
  expect(files.length).toBeGreaterThan(30);

  const missing = files.filter(
    (f) => !/getElementById\(\s*['"]loading['"]\s*\)/.test(readFileSync(join(DATA_DIR, f), 'utf8'))
  );
  expect(missing, `data files that never hide #loading: ${missing.join(', ')}`).toEqual([]);
});

test('the console boot screen mounts the R&D logo', async ({ page }) => {
  await stubDataHosts(page);
  await holdData(page);
  await page.goto(CONSOLE_PAGE, { waitUntil: 'domcontentloaded' });

  // Lottie builds an <svg> from data/rd-banner-v2-1.json.
  const svg = page.locator('#bootlogo svg');
  await expect(svg).toBeAttached({ timeout: 15_000 });
  await expect(svg).toHaveAttribute('viewBox', '0 0 1600 400');
  await expect(page.locator('#bootmsg')).toContainText(/\S/);
});

test('the console boot screen gets out of the way once the map is up', async ({ page }) => {
  await stubDataHosts(page);
  await page.goto(CONSOLE_PAGE, { waitUntil: 'domcontentloaded' });

  // Hidden rather than removed: the overlay covers the canvas at z-index 40, so
  // it must stop capturing clicks — but the node has to survive, because the
  // data layer dismisses it by id and some maps get there very late.
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('#loading')).toHaveCount(1);
});

/* A map whose fetch is slow or fails reaches
     document.getElementById('loading').style.display = 'none'
   long after the console has already dismissed the boot screen. Removing the
   node made that throw on null and took Ed3d.init() down with it, leaving a
   blank page — which is how ts-msg_3305survey.html broke. */
test('a late dismissal from the data layer does not throw', async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(String(e)));
  await stubDataHosts(page);
  await page.goto(CONSOLE_PAGE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });

  const threw = await page.evaluate(() => {
    try {
      document.getElementById('loading').style.display = 'none';
      return null;
    } catch (e) { return String(e); }
  });
  expect(threw).toBeNull();
  expect(crashes).toEqual([]);
});

test('the boot screen falls back to a wordmark without the Lottie player', async ({ page }) => {
  await stubDataHosts(page);
  await page.route('**/bodymovin.min.js', (r) => r.fulfill({ status: 200, body: '' }));
  await holdData(page);
  await page.goto(CONSOLE_PAGE, { waitUntil: 'domcontentloaded' });

  // A wordmark, rather than an empty black square...
  await expect(page.locator('#bootfallback')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#bootlogo')).toBeHidden();
  // ...and it still gets out of the way.
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });
});
