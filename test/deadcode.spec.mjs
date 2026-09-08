import { test, expect } from '@playwright/test';
import { stubDataHosts, waitForScene, REFERENCE_PAGE } from './helpers.mjs';

const DEAD = [
  'ed3dmap.min.js',
  'Projector.js',
  'CSS3DRenderer.js',
  'RaytracingRenderer.js',
  'TextGeometry.js',
  'ShaderMaterial.js'
];

test('no dead vendor file is requested', async ({ page }) => {
  const requested = [];
  page.on('request', (r) => {
    const name = new URL(r.url()).pathname.split('/').pop();
    if (DEAD.includes(name)) requested.push(name);
  });

  await stubDataHosts(page);
  await page.goto(REFERENCE_PAGE, { waitUntil: 'load' });
  await waitForScene(page, expect);

  expect(requested).toEqual([]);
});

test('the old nav is gone, and nothing reaches w3schools for it', async ({ page }) => {
  const thirdParty = [];
  page.on('request', (r) => {
    if (new URL(r.url()).hostname.endsWith('w3schools.com')) thirdParty.push(r.url());
  });

  await stubDataHosts(page);
  /* The console replaced include/nav.html on every page linked from it; the
     six pages nobody linked kept carrying the nav, and were the last thing
     holding both it and the local w3data replacement alive. They are on the
     console too now, so the nav and its loader are deleted — and this asserts
     the state that replaced them rather than the one they were in. */
  await page.goto('/cmdr.html', { waitUntil: 'load' });
  await waitForScene(page, expect);

  // The nav's own container, on a page that carried it until now.
  await expect(page.locator('#cssmenu')).toHaveCount(0);
  // And the console's, which is what it was replaced by.
  await expect(page.locator('.app .top')).toBeVisible();
  expect(thirdParty, 'no request reached w3schools.com').toEqual([]);
});

test('no page still asks for the deleted nav', async ({ page }) => {
  const gone = [];
  page.on('response', (r) => {
    const path = new URL(r.url()).pathname;
    if (/include\/nav\.html$|nav-include\.js$/.test(path)) gone.push(path + ' → ' + r.status());
  });

  await stubDataHosts(page);
  /* Two of the six converted pages, and one that was always on the console.
     Not route_data, which pages.json marks offlineSkip: its data cannot be
     stubbed into something the map will draw. */
  for (const p of ['/carrier_data.html', '/cloud_data.html', REFERENCE_PAGE]) {
    await page.goto(p, { waitUntil: 'load' });
    await waitForScene(page, expect);
  }
  expect(gone, 'a page asked for a file that no longer exists').toEqual([]);
});
