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
