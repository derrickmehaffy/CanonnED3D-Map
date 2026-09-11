/**
 * route_data.html — the codex route planner.
 *
 * This page had no executing test of any kind. It is marked `offlineSkip` in
 * pages.json because the generic stub answers every data host with `[]`, and
 * `formatCol` reads `data[0].startSystem` before it iterates anything, so `[]`
 * throws before the map is built. The project that was supposed to cover it,
 * `live`, matched a `test/live.spec.mjs` that does not exist — so it ran zero
 * tests, and one of 36 pages was silently uncovered.
 *
 * The fix is a shaped stub rather than a live call: two replies of the form the
 * page actually consumes. Canonn's cloud functions are billed per invocation,
 * so nothing here reaches them.
 */
import { test, expect } from '@playwright/test';
import { stubDataHosts, waitForScene } from './helpers.mjs';

const START = { name: 'Sol', x: 0, y: 0, z: 0 };
const END = { name: 'Colonia', x: -9530.5, y: -910.28125, z: 19808.125 };

/* Both the codex-route and the GMP-route replies are consumed by formatCol,
   which wants an array whose first element carries startSystem and endSystem.
   The GMP reply also carries the waypoints between them. */
const ROUTE = [{
  startSystem: START,
  endSystem: END,
  jumpRange: 50,
  // A couple of real intermediate systems, so the route has something to draw.
  route: [
    { name: 'Skaudai CH-B d14-34', x: -5481.15625, y: -579.5, z: 10429.4375 },
    { name: 'Eok Bluae YG-Y d64', x: -7314.90625, y: -717.71875, z: 15029.125 }
  ]
}];

async function openRoute(page) {
  await stubDataHosts(page);
  // Shaped replies for this page's two endpoints, installed after the generic
  // stub so they win.
  await page.route('**/*get_codex_route*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROUTE) }));
  await page.route('**/*get_gmp_route*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROUTE) }));

  await page.goto(
    '/route_data.html?startSystem=Sol&endSystem=Colonia&jumpRange=50',
    { waitUntil: 'load' }
  );
}

test('the route planner builds a map from a planned route', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await openRoute(page);
  await waitForScene(page, expect);

  const state = await page.evaluate(() => ({
    points: System.points.length,
    names: System.points.map((p) => p && p.name).filter(Boolean),
    // The two ends are their own categories, renamed to the systems chosen.
    cats: Object.keys(Ed3d.catObjs),
    routes: Object.keys(window.routes || {}).length
  }));

  expect(state.points, 'both ends of the route should be on the map').toBeGreaterThanOrEqual(2);
  expect(state.names).toContain('Sol');
  expect(state.names).toContain('Colonia');
  expect(state.routes, 'and the route itself should be drawn').toBeGreaterThan(0);

  expect(errors, 'the page should boot without throwing').toEqual([]);
});

test('the route planner names its start and end categories after the systems', async ({ page }) => {
  /* formatCol rewrites categories 11 and 12 from the reply, which is the one
     piece of per-request behaviour this page has: the filter list should read
     "Sol" and "Colonia", not whatever the file was authored with. */
  await openRoute(page);
  await waitForScene(page, expect);

  const labels = await page.evaluate(() =>
    [...document.querySelectorAll('#filters .map_filter')].map((a) => a.textContent.trim()));

  expect(labels.join(' | ')).toContain('Sol');
  expect(labels.join(' | ')).toContain('Colonia');
});

test('a route reply the page cannot read fails loudly, not silently', async ({ page }) => {
  /* The generic `[]` stub is exactly this case, and it is why the page was
     skipped rather than covered. Worth pinning what happens: the promise
     rejects and the map never initialises. If this page is ever hardened to
     show an empty state instead, this test should be the one that changes. */
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await stubDataHosts(page);
  await page.goto(
    '/route_data.html?startSystem=Sol&endSystem=Colonia&jumpRange=50',
    { waitUntil: 'load' }
  );
  // Give the two promises time to settle either way.
  await page.waitForTimeout(1500);

  const built = await page.evaluate(() =>
    !!(window.System && System.points && System.points.length));
  expect(built, 'an unreadable reply should not produce a half-built map').toBe(false);
});
