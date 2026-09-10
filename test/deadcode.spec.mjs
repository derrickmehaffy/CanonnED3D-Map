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

/* ── one address for Canonn's data ──────────────────────────────────────── */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'Source');
const read = (p) => readFileSync(join(SRC, p), 'utf8');
const pages = readdirSync(SRC).filter((f) => f.endsWith('.html'));

test('only canonn-api.js names the cloud-functions host', () => {
  /* The host, the region and the project id were pasted into twelve call
     sites across ten files. They are in one file now, and the point of that
     is lost the first time somebody pastes it back. */
  const named = [];
  const walk = (dir, rel = '') => {
    for (const e of readdirSync(join(SRC, dir), { withFileTypes: true })) {
      const path = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { if (e.name !== 'vendor') walk(join(dir, e.name), path); continue; }
      if (!/\.(js|html|mjs)$/.test(e.name)) continue;
      if (path.endsWith('js/canonn-api.js')) continue;
      if (readFileSync(join(SRC, dir, e.name), 'utf8').includes('cloudfunctions.net')) {
        named.push(path);
      }
    }
  };
  walk('.');
  expect(named, 'these should ask CanonnAPI for the URL instead').toEqual([]);
});

test('every page that runs the console also loads the API', () => {
  /* Missing this tag does not cost you the star colours it is nearest to —
     it throws before the console is wired up, and costs you the command
     palette, the systems list and the card. Two pages shipped without it
     because both of their smoke tests happened to be skipped. */
  const missing = pages.filter((f) => {
    const html = read(f);
    return html.includes('js/console.js') && !html.includes('js/canonn-api.js');
  });
  expect(missing).toEqual([]);
});

test('the API is loaded before anything that uses it', () => {
  /* A classic script runs in document order, and every classic script runs
     before every deferred or module one. So the rule is only about the
     classic scripts: canonn-api.js has to be the first of them that wants it.
     Reading the tags rather than the file text matters — the first pass at
     this matched the words "console.js" inside an HTML comment. */
  const USERS = /js\/console\.js|js\/codex-overlay\.js|data\/MapData-/;
  const late = [];

  for (const f of pages) {
    const scripts = [...read(f).matchAll(/<script\b([^>]*)>/gi)]
      .map((m) => m[1])
      .filter((attrs) => /\bsrc\s*=/.test(attrs))
      .map((attrs) => ({
        src: (attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/) || [])[1] || '',
        // Anything that does not run in document order runs after all of it.
        later: /\bdefer\b|\basync\b|type\s*=\s*["']module["']/i.test(attrs)
      }));

    const api = scripts.findIndex((t) => t.src.includes('js/canonn-api.js'));
    if (api < 0) continue;
    expect(scripts[api].later, f + ': canonn-api.js must run in document order').toBe(false);
    const early = scripts.findIndex((t, i) => i < api && !t.later && USERS.test(t.src));
    if (early >= 0) late.push(f + ': ' + scripts[early].src);
  }
  expect(late, 'canonn-api.js has to come first').toEqual([]);
});

/* ── category colours are a fact about the data, not a per-visit accident ── */

test('every page whose data needs the palette loads it, and loads it first',
  async () => {
  /* Read off disk rather than driven in a browser, for the same reason the
     canonn-api.js checks below are: a page whose smoke test happens to be
     skipped will not tell you its script tag is missing, and two of them
     shipped that way. A data file that calls CanonnPalette on a page that
     never loaded it is a ReferenceError at load, which takes the whole map
     with it. */
  const bad = [];
  for (const page of pages) {
    const html = read(page);
    const data = [...html.matchAll(/data\/(MapData-[A-Za-z0-9_]+\.js)/g)].map((m) => m[1]);
    const wants = data.some((d) => {
      try { return read('data/' + d).includes('CanonnPalette'); } catch { return false; }
    });
    const has = html.includes('canonn-palette.js');
    if (wants && !has) bad.push(page + ' calls CanonnPalette but never loads it');
    if (!wants && has) bad.push(page + ' loads the palette and has no use for it');
    if (wants && has) {
      const first = Math.min(...data.map((d) => html.indexOf('data/' + d)));
      if (html.indexOf('canonn-palette.js') > first) {
        bad.push(page + ' loads the palette after the data file that calls it');
      }
    }
  }
  expect(bad).toEqual([]);
});

test('no map category picks its colour at random', async () => {
  /* Eight data files used to set category colours with randomColor(), so
     Guardian Ruins site types and Thargoid barnacle classes came up different
     on every visit. The legend and the points always agreed with each other,
     which is why it never looked broken and never got fixed — but a colour
     nobody can learn is not a legend. */
  const offenders = readdirSync(join(SRC, 'data'))
    .filter((f) => f.endsWith('.js'))
    .filter((f) => read('data/' + f).includes('randomColor'));
  expect(offenders).toEqual([]);
});

test('no page still loads axios', async () => {
  /* Seven axios instances and three plain GETs, on a 2019 release carried by
     every page that loads the console. The instances were callable —
     `capi({ url, method })` — which is why a grep for `capi.get` found nothing
     and briefly convinced me they were dead; four of them were live. They are
     fetch now, keeping the two things axios did that matter: a base URL, and
     rejecting rather than resolving on a 4xx or 5xx. */
  const offenders = pages.filter((p) => read(p).includes('/axios/'));
  expect(offenders).toEqual([]);
});

test('the shared formatters load before whatever uses them', () => {
  /* esc and num lived in both console.js and orrery.js, and console.js had two
     esc declarations in one scope, the later of which silently replaced the
     earlier. They disagreed about null — one gave "", the other the literal
     text "null" — and the one that lost was the one that handled it. They are
     in canonn-fmt.js now, read as a global because console.js is a classic
     script and cannot import.

     A missing tag is therefore a ReferenceError at load that takes the whole
     console with it, exactly as a missing canonn-api.js tag once did on the
     two pages whose smoke tests happened to be skipped.

     Tags, not file text, and classic scripts only — the same two lessons the
     canonn-api.js check above already carries. The first pass at this reported
     orrery.html and voyager.html, and both were innocent: it was matching an
     import map and a comment. */
  const USERS = /js\/console\.js|js\/orrery\.js/;
  const bad = [];

  for (const f of pages) {
    const scripts = [...read(f).matchAll(/<script\b([^>]*)>/gi)]
      .map((m) => m[1])
      .filter((attrs) => /\bsrc\s*=/.test(attrs))
      .map((attrs) => ({
        src: (attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/) || [])[1] || '',
        later: /\bdefer\b|\basync\b|type\s*=\s*["']module["']/i.test(attrs)
      }));

    if (!scripts.some((t) => USERS.test(t.src))) continue;
    const fmt = scripts.findIndex((t) => t.src.includes('js/canonn-fmt.js'));
    if (fmt < 0) { bad.push(f + ' uses the formatters and never loads them'); continue; }
    expect(scripts[fmt].later, f + ': canonn-fmt.js must run in document order').toBe(false);
    const early = scripts.findIndex((t, i) => i < fmt && !t.later && USERS.test(t.src));
    if (early >= 0) bad.push(f + ': ' + scripts[early].src + ' runs before the formatters');
  }
  expect(bad).toEqual([]);
});
