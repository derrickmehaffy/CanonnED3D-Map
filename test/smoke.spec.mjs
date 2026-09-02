import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { stubDataHosts, waitForScene, ALLOWED_EXTERNAL } from './helpers.mjs';

const pages = JSON.parse(
  readFileSync(new URL('./pages.json', import.meta.url), 'utf8')
);

// Per-page overrides for the screenshot assertion. Keep this empty unless a
// specific page has been diagnosed (not just observed to flake) — see the
// comment on each entry for what was actually measured.
const SCREENSHOT_OPTIONS = {
  // permit-data.html renders large overlapping, additively-blended,
  // per-pixel-discard spheres (Source/data/MapData-Permit.js) that are slow
  // to rasterize under SwiftShader software rendering. A standalone probe
  // (two #edmap screenshots 250ms apart) showed 91% of pixels still differ
  // at the standard 2.5s settle mark, but the pair is byte-identical from
  // 5s onward — the scene truly stops changing, it just takes longer than
  // 2.5s to get there. Playwright's own "two consecutive stable
  // screenshots" check only manages 2-3 attempts inside the default 15s
  // assertion timeout, because each capture of this shader is itself slow,
  // so it never reaches the already-settled state before giving up. A
  // longer per-assertion timeout is the honest fix: it does not loosen what
  // counts as "the same picture", it just gives this one page's expensive
  // shader enough wall-clock time to prove it settled.
  'permit-data.html': { timeout: 60_000 },
  // hyperdiction_data.html, ts-data.html and ts-msg_3305survey.html have no
  // heavy shader of their own (unlike permit-data.html above) and pass
  // cleanly in isolation at any worker count. They only fail when run
  // alongside the rest of the suite at the config's real worker count (4):
  // four simultaneous SwiftShader software renderers contend for CPU, which
  // slows down each screenshot capture enough that Playwright's own
  // "two consecutive stable screenshots" check gets only 2-3 attempts inside
  // the default 15s assertion timeout and never lands two captures inside a
  // quiet window. A longer per-assertion timeout — not a laxer pixel
  // tolerance — lets it keep retrying until it catches such a window.
  'hyperdiction_data.html': { timeout: 60_000 },
  'ts-data.html': { timeout: 60_000 },
  'ts-msg_3305survey.html': { timeout: 60_000 }
};

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

    // Settle the render loop so the starfield and grid text stop moving.
    await page.waitForTimeout(2500);
    await expect(page.locator('#edmap')).toHaveScreenshot(`${p.path}.png`, SCREENSHOT_OPTIONS[p.path]);
  });
}
