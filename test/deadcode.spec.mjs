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

test('nav renders without contacting w3schools', async ({ page }) => {
  const thirdParty = [];
  page.on('request', (r) => {
    if (new URL(r.url()).hostname.endsWith('w3schools.com')) thirdParty.push(r.url());
  });

  await stubDataHosts(page);
  // Every page linked from the nav is now on the console, which replaces
  // include/nav.html. The pages lcunfool unlinked still carry it, so one of
  // those is what keeps this assertion alive; it retires with them.
  await page.goto('/dcoh.html', { waitUntil: 'load' });

  // nav.html contains <div id="cssmenu">.
  await expect(page.locator('#cssmenu')).toBeAttached({ timeout: 30_000 });
  expect(thirdParty, 'no request reached w3schools.com').toEqual([]);
});
