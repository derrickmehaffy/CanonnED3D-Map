import { test, expect } from '@playwright/test';
import { stubDataHosts } from './helpers.mjs';

/* The orrery models one system from Canonn's dump. These tests are in two
   halves: the mechanics, which are checked as arithmetic because an orbit
   that is solved rather than animated by eye is the claim the file makes;
   and the view, where what matters is that opening it costs you nothing —
   the galaxy map behind it keeps its camera. */

const API = '**/us-central1-canonn-api-236217.cloudfunctions.net/**';

/* A star, a planet on a one-year circle, and a moon of that planet. Small
   enough that every assertion below is a number this file chose. */
const SYSTEM = {
  name: 'Testholm', id64: 99, bodyCount: 3,
  date: '2026-01-01 00:00:00+00',
  bodies: [
    { bodyId: 0, type: 'Star', name: 'Testholm', mainStar: true,
      subType: 'G (White-Yellow) Star', spectralClass: 'G2', luminosity: 'V',
      solarRadius: 1, solarMasses: 1, surfaceTemperature: 5778, rotationalPeriod: 25 },
    { bodyId: 1, type: 'Planet', name: 'Testholm 1', subType: 'Earth-like world',
      parents: [{ Star: 0 }], radius: 6378, gravity: 1, isLandable: false,
      semiMajorAxis: 1, orbitalEccentricity: 0, orbitalInclination: 0,
      argOfPeriapsis: 0, ascendingNode: 0, meanAnomaly: 0,
      orbitalPeriod: 365.25, rotationalPeriod: 1, distanceToArrival: 499 },
    { bodyId: 2, type: 'Planet', name: 'Testholm 1 a', subType: 'Rocky body',
      parents: [{ Planet: 1 }, { Star: 0 }], radius: 1737,
      semiMajorAxis: 0.0026, orbitalEccentricity: 0.05, orbitalInclination: 5,
      argOfPeriapsis: 30, ascendingNode: 60, meanAnomaly: 120,
      orbitalPeriod: 27.3, distanceToArrival: 500 }
  ]
};

async function stubApi(page, system = SYSTEM) {
  await page.route(API, (route) => {
    const url = route.request().url();
    const json = (b) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.includes('/typeahead')) {
      return json({ min_max: [{ id64: system.id64, name: system.name, x: 0, y: 0, z: 0 }] });
    }
    return json({ system });
  });
}

/** Load the module in the page and hand back a handle to it. */
async function mechanics(page) {
  await stubDataHosts(page);
  await page.goto('/gr-data.html', { waitUntil: 'domcontentloaded' });
  // The maths needs nothing but the module; the import map on the page is
  // what resolves 'three' for it.
  await page.waitForFunction(() => window.__ed3dReady === true, { timeout: 60_000 });
  return page.evaluateHandle(() => import('/js/orrery.js'));
}

/* ── the mechanics ──────────────────────────────────────────────────────── */

test('Kepler\'s equation is actually solved', async ({ page }) => {
  const m = await mechanics(page);
  const worst = await page.evaluate((mod) => {
    let worst = 0;
    // Across the eccentricities real bodies have, including the comets.
    for (const e of [0, 0.0167, 0.2056, 0.5, 0.8, 0.95]) {
      for (let k = 0; k < 24; k++) {
        const M = (k / 24) * Math.PI * 2;
        const E = mod.eccentricAnomaly(M, e);
        worst = Math.max(worst, Math.abs(E - e * Math.sin(E) - M));
      }
    }
    return worst;
  }, m);
  expect(worst).toBeLessThan(1e-9);
});

test('a body comes back to where it started after exactly one orbit', async ({ page }) => {
  const m = await mechanics(page);
  const drift = await page.evaluate((mod) => {
    // An eccentric, inclined, rotated orbit — the case where a wrong rotation
    // order still looks plausible on screen.
    const b = { a: 40, e: 0.35, i: 0.4, w: 0.9, O: 1.7, M0: 0.3, P: 100 };
    const at = (d) => { const v = { set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } };
                        mod.positionAt(b, d, v); return v; };
    const p0 = at(0), p1 = at(100), half = at(50);
    const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
    return { period: dist(p0, p1), moved: dist(p0, half) };
  }, m);
  expect(drift.period).toBeLessThan(1e-9);   // one period later: same place
  expect(drift.moved).toBeGreaterThan(1);    // and it did go somewhere in between
});

test('the hierarchy follows the dump, barycentres included', async ({ page }) => {
  const m = await mechanics(page);
  const tree = await page.evaluate(([mod, sys]) => {
    const withBary = JSON.parse(JSON.stringify(sys));
    withBary.bodies.push(
      { bodyId: 8, type: 'Barycentre', name: 'Bary 8', parents: [{ Star: 0 }],
        semiMajorAxis: 30, orbitalEccentricity: 0.2, orbitalPeriod: 9000 },
      { bodyId: 9, type: 'Planet', name: 'Far one', subType: 'Icy body',
        parents: [{ Null: 8 }, { Star: 0 }], radius: 1200,
        semiMajorAxis: 0.01, orbitalPeriod: 40 });
    const model = mod.buildModel(withBary);
    const of = (n) => model.all.find((x) => x.name === n);
    return {
      star: model.star.name,
      moonParent: of('Testholm 1 a').parent.name,
      baryChild: of('Far one').parent.name,
      // A barycentre has no surface, so it is a node and not a sphere.
      baryDrawn: (mod.layout(model, false), of('Bary 8').drawR)
    };
  }, [m, SYSTEM]);

  expect(tree.star).toBe('Testholm');
  expect(tree.moonParent).toBe('Testholm 1');
  expect(tree.baryChild).toBe('Bary 8');
  expect(tree.baryDrawn).toBe(0);
});

/* ── the view ───────────────────────────────────────────────────────────── */

async function openOrrery(page) {
  await stubDataHosts(page);
  await stubApi(page);
  await page.goto('/gr-data.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app .top')).toBeVisible({ timeout: 60_000 });
  await page.waitForFunction(() => window.Ed3d && Ed3d.updateSystems, { timeout: 30_000 });
  await page.evaluate(() => new Promise((res) => Ed3d.updateSystems({
    categories: { 'Site type': { a: { name: 'Alpha', color: 'FF9D00' } } },
    systems: [{ name: 'Testholm', coords: { x: 5, y: 0, z: 5 }, cat: ['a'] }]
  }, res)));
  await expect(page.locator('#side .layer').first()).toBeVisible({ timeout: 30_000 });
  await page.locator('.rail button[data-p="systems"]').click();
  await page.locator('.sysrow[data-sys="Testholm"]').click();
  await page.locator('#correry:not([hidden])').click({ timeout: 30_000 });
  await page.locator('.orrery.open').waitFor({ timeout: 30_000 });
  await expect(page.locator('.orr-msg')).toHaveClass(/gone/, { timeout: 30_000 });
}

/* The reason this is an overlay and not its own page. */
test('coming back leaves the galaxy map exactly where it was', async ({ page }) => {
  await openOrrery(page);
  // Put the camera somewhere specific first, the way a reader would.
  await page.evaluate(() => {
    camera.position.set(1234, 567, -890);
    controls.target.set(100, 20, -30);
    controls.update();
  });
  const read = () => page.evaluate(() => ({
    cam: camera.position.toArray().map(Math.round),
    tgt: controls.target.toArray().map(Math.round),
    visible: window.scene.visible
  }));

  await page.locator('#orr-back').click();
  await expect(page.locator('.orrery.open')).toHaveCount(0);
  const back = await read();
  expect(back).toEqual({ cam: [1234, 567, -890], tgt: [100, 20, -30], visible: true });
});

test('the galaxy map stops drawing while the orrery is up', async ({ page }) => {
  await openOrrery(page);
  // Ed3d's own animate() returns early on an invisible scene, so this is the
  // whole of the pause: no render, no per-frame work, camera untouched.
  expect(await page.evaluate(() => window.scene.visible)).toBe(false);
  await page.locator('#orr-back').click();
  await expect.poll(() => page.evaluate(() => window.scene.visible)).toBe(true);
});

test('the clock runs, pauses, and changes rate', async ({ page }) => {
  await openOrrery(page);
  const date = () => page.locator('#orr-date').textContent();

  // Poll rather than sleep: how many frames land in any given second is the
  // browser's business, and a fixed window made this fail about one run in
  // six. What has to be true is that the clock moves, not when.
  const t1 = await date();
  await expect.poll(date, { timeout: 15_000, message: 'time advances while playing' })
    .not.toBe(t1);

  await page.locator('#orr-play').click();
  const paused = await date();
  await page.waitForTimeout(1200);
  expect(await date(), 'and stops when paused').toBe(paused);

  await expect(page.locator('.orr-rate')).toHaveText('1 week/s');
  await page.locator('#orr-faster').click();
  await expect(page.locator('.orr-rate')).toHaveText('1 month/s');
  // Stepping down past the slowest rate crosses zero and runs backwards.
  for (let i = 0; i < 11; i++) await page.locator('#orr-slower').click();
  await expect(page.locator('.orr-rate')).toContainText('−');
});

test('the bodies and their facts come off the dump', async ({ page }) => {
  await openOrrery(page);
  await expect(page.locator('.orr-row')).toHaveCount(3);
  // Procedural systems name every body after the system, so the list drops
  // the prefix — "Col 173 Sector LB-W b31-0 A 2" is "A 2" once you know where
  // you are, and the column was otherwise all ellipsis.
  await expect(page.locator('.orr-row .nm')).toHaveText(['Testholm', '1', '1 a']);

  await page.locator('.orr-row[data-id="1"]').click();
  // The panel still names it in full: that is where you go to be sure.
  const facts = page.locator('.orr-facts');
  await expect(facts.locator('.orr-f-h b')).toHaveText('Testholm 1');
  await expect(facts).toContainText('6,378 km');
  await expect(facts).toContainText('1 AU');
  await expect(facts).toContainText('1 year');
  await expect(facts).toContainText('1 day');   // not "1 years", not "1 days"
});

/* The dump is the same source the card's star block reads, so a system that
   is not in it has nothing to model — and the button never appears. */
test('no button on a system the dump does not have', async ({ page }) => {
  await stubDataHosts(page);
  await page.goto('/gr-data.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app .top')).toBeVisible({ timeout: 60_000 });
  await page.waitForFunction(() => window.Ed3d && Ed3d.updateSystems, { timeout: 30_000 });
  await page.evaluate(() => new Promise((res) => Ed3d.updateSystems({
    categories: { 'Site type': { a: { name: 'Alpha', color: 'FF9D00' } } },
    systems: [{ name: 'Nowhere', coords: { x: 1, y: 0, z: 1 }, cat: ['a'] }]
  }, res)));
  await page.locator('.rail button[data-p="systems"]').click();
  await page.locator('.sysrow').first().click();
  await expect(page.locator('#card')).toBeVisible();
  await expect(page.locator('#correry')).toBeHidden();
});

/* The card's star block and the orrery want the identical response: the card
   reads four fields out of a couple of hundred kilobytes, and the orrery
   wants the rest of it. Fetching it twice was pure waste on an endpoint
   Canonn is billed for per call. */
test('the orrery reuses the dump the card already fetched', async ({ page }) => {
  const calls = [];
  await stubDataHosts(page);
  await page.route(API, (route) => {
    calls.push(route.request().url());
    const url = route.request().url();
    const json = (b) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.includes('/typeahead')) {
      return json({ min_max: [{ id64: SYSTEM.id64, name: SYSTEM.name, x: 0, y: 0, z: 0 }] });
    }
    return json({ system: SYSTEM });
  });

  await page.goto('/gr-data.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app .top')).toBeVisible({ timeout: 60_000 });
  await page.waitForFunction(() => window.Ed3d && Ed3d.updateSystems, { timeout: 30_000 });
  await page.evaluate(() => new Promise((res) => Ed3d.updateSystems({
    categories: { 'Site type': { a: { name: 'Alpha', color: 'FF9D00' } } },
    systems: [{ name: 'Testholm', coords: { x: 5, y: 0, z: 5 }, cat: ['a'] }]
  }, res)));
  await page.locator('.rail button[data-p="systems"]').click();
  await page.locator('.sysrow[data-sys="Testholm"]').click();

  // The card resolves the name and pulls the dump: two calls, and no more.
  await expect(page.locator('#correry:not([hidden])')).toBeVisible({ timeout: 30_000 });
  expect(calls.filter((u) => u.includes('/codex/dump'))).toHaveLength(1);

  await page.locator('#correry').click();
  await expect(page.locator('.orrery.open')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 30_000 });
  expect(calls.filter((u) => u.includes('/codex/dump')),
    'opening the orrery cost no second fetch').toHaveLength(1);
});

/* A dump carries far more per body than a radius: atmospheres by gas, crusts
   by rock and metal, the surface materials people plan expeditions around. */
test('a body shows everything the dump holds about it', async ({ page }) => {
  const rich = JSON.parse(JSON.stringify(SYSTEM));
  Object.assign(rich.bodies[1], {
    isLandable: true, terraformingState: 'Terraformed',
    rotationalPeriodTidallyLocked: true, earthMasses: 1, surfacePressure: 1.02,
    volcanismType: 'Rocky Magma', axialTilt: 0.401426,
    atmosphereType: 'Suitable for water-based life',
    atmosphereComposition: { Nitrogen: 77.9, Oxygen: 20.9, Argon: 0.93 },
    solidComposition: { Rock: 70, Metal: 30, Ice: 0 },
    materials: { Iron: 23.5, Nickel: 17.8, Sulphur: 12.9 },
    rings: [{ name: 'A Ring', type: 'Icy', innerRadius: 74500000, outerRadius: 140180000 }],
    signals: { signals: { '$SAA_SignalType_Biological;': 4, '$SAA_SignalType_Human;': 2 } },
    stations: [{ name: 'Testholm Hub', type: 'Coriolis', controllingFaction: 'Canonn' }]
  });
  await stubDataHosts(page);
  await stubApi(page, rich);
  await page.goto('/gr-data.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app .top')).toBeVisible({ timeout: 60_000 });
  await page.waitForFunction(() => window.Ed3d && Ed3d.updateSystems, { timeout: 30_000 });
  await page.evaluate(() => new Promise((res) => Ed3d.updateSystems({
    categories: { 'Site type': { a: { name: 'Alpha', color: 'FF9D00' } } },
    systems: [{ name: 'Testholm', coords: { x: 5, y: 0, z: 5 }, cat: ['a'] }]
  }, res)));
  await page.locator('.rail button[data-p="systems"]').click();
  await page.locator('.sysrow[data-sys="Testholm"]').click();
  await page.locator('#correry:not([hidden])').click({ timeout: 30_000 });
  await expect(page.locator('.orrery.open')).toBeVisible({ timeout: 30_000 });
  await page.locator('.orr-row[data-id="1"]').click();

  const facts = page.locator('.orr-facts');
  // What is true about it, before any of the numbers.
  await expect(facts.locator('.orr-chip'))
    .toHaveText(['Landable', 'Terraformed', 'Tidally locked', 'Ringed']);
  await expect(facts.locator('.orr-sec h3')).toHaveText([
    'Body', 'Orbit', 'Atmosphere', 'Crust', 'Surface materials', 'Rings',
    'Mapped signals', 'Stations'
  ]);
  // Proportions are bars, sorted by share, biggest first.
  await expect(facts.locator('.orr-sec', { hasText: 'Surface materials' })
    .locator('.orr-bar .k')).toHaveText(['Iron', 'Nickel', 'Sulphur']);
  await expect(facts).toContainText('23.5%');
  // The game's own token is not something to show a reader.
  await expect(facts).toContainText('Biological');
  await expect(facts).not.toContainText('SAA_SignalType');
  await expect(facts).toContainText('Testholm Hub');
  await expect(facts).toContainText('23°');          // axial tilt, in degrees
});

/* "True distance" was not. Both modes remapped into the same [inner, outer]
   band, which turns 0.39 AU against 700 into 16 units against 100 — the exact
   ratio the mode exists to show, destroyed. It has to anchor at zero. */
test('true distance keeps the ratio between orbits', async ({ page }) => {
  const m = await mechanics(page);
  const scaled = await page.evaluate((mod) => {
    const sys = { name: 'S', bodies: [
      { bodyId: 0, type: 'Star', name: 'S', mainStar: true, solarRadius: 1 },
      { bodyId: 1, type: 'Planet', name: 'Near', parents: [{ Star: 0 }], radius: 6000,
        semiMajorAxis: 1, orbitalPeriod: 365 },
      { bodyId: 2, type: 'Planet', name: 'Mid', parents: [{ Star: 0 }], radius: 6000,
        semiMajorAxis: 10, orbitalPeriod: 11000 },
      { bodyId: 3, type: 'Planet', name: 'Far', parents: [{ Star: 0 }], radius: 6000,
        semiMajorAxis: 100, orbitalPeriod: 365000 }
    ] };
    const read = (trueDistance) => {
      const model = mod.buildModel(sys);
      mod.layout(model, trueDistance);
      const a = (n) => model.all.find((x) => x.name === n).a;
      return { near: a('Near'), mid: a('Mid'), far: a('Far') };
    };
    return { true_: read(true), spread: read(false) };
  }, m);

  // Ten times the orbit, ten times out — that is the whole claim.
  expect(scaled.true_.mid / scaled.true_.near).toBeCloseTo(10, 4);
  expect(scaled.true_.far / scaled.true_.near).toBeCloseTo(100, 4);

  // The compressed mode deliberately does not: it is a log, so the three
  // decades land evenly across the view instead.
  expect(scaled.spread.far / scaled.spread.near).toBeLessThan(10);
  expect(scaled.spread.mid - scaled.spread.near)
    .toBeCloseTo(scaled.spread.far - scaled.spread.mid, 4);
});
