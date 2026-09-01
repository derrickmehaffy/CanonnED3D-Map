import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { stubDataHosts, waitForScene, ALLOWED_EXTERNAL } from './helpers.mjs';

const pages = JSON.parse(
  readFileSync(new URL('./pages.json', import.meta.url), 'utf8')
);

for (const p of pages) {
  const spec = p.offlineSkip ? test.skip : test;
  spec(`smoke ${p.path}`, async ({ page }) => {
    const crashes = [];
    page.on('pageerror', (e) => crashes.push(String(e)));

    const net = await stubDataHosts(page);
    await page.goto(`/${p.path}${p.query}`, { waitUntil: 'load' });
    await waitForScene(page, expect);

    // A real WebGL context must exist; a blank canvas would make every
    // screenshot assertion vacuously pass.
    const hasGL = await page.evaluate(() => {
      const c = document.querySelector('#ed3dmap canvas');
      return !!(c && (c.getContext('webgl2') || c.getContext('webgl')));
    });
    expect(hasGL, 'WebGL context present').toBe(true);

    // Any external host that was NOT stubbed must be a known asset CDN.
    // This is what catches a new data source missing from DATA_HOSTS.
    const leaked = [...new Set(net.externalContinued)]
      .filter((h) => !ALLOWED_EXTERNAL.includes(h));
    expect(leaked, `unstubbed external host contacted by ${p.path}`).toEqual([]);

    expect(crashes, `uncaught errors on ${p.path}`).toEqual([]);
  });
}
