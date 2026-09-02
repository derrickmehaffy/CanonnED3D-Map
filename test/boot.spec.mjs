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

test('the console boot screen removes itself once the map is up', async ({ page }) => {
  await stubDataHosts(page);
  await page.goto(CONSOLE_PAGE, { waitUntil: 'domcontentloaded' });

  // It must not merely fade: the overlay covers the canvas at z-index 40 and
  // would swallow every click on the map if it stayed in the DOM.
  await expect(page.locator('#loading')).toHaveCount(0, { timeout: 60_000 });
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
  await expect(page.locator('#loading')).toHaveCount(0, { timeout: 60_000 });
});
