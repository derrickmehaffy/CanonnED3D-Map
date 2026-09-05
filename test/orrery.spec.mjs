import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { stubDataHosts } from './helpers.mjs';

/* The orrery models one system from Canonn's dump. These tests are in two
   halves: the mechanics, which are checked as arithmetic because an orbit
   that is solved rather than animated by eye is the claim the file makes;
   and the view, where what matters is that opening it costs you nothing —
   the galaxy map behind it keeps its camera. */

const API = '**/us-central1-canonn-api-236217.cloudfunctions.net/**';

/** Everything about how the scene is drawn lives behind one button. */
async function openView(page) {
  if (!(await page.locator('.orrery.view-open').count())) {
    await page.locator('#orr-vopen').click();
  }
  await expect(page.locator('#orr-drawer')).toBeVisible();
}

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

  // A week a second was too quick to read on opening; a day a second still
  // moves — Io comes round in under two seconds.
  await expect(page.locator('.orr-rate')).toHaveText('1 day/s');
  await page.locator('#orr-faster').click();
  await expect(page.locator('.orr-rate')).toHaveText('1 week/s');
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
  // The headline four, set the way the galaxy map's system card sets them.
  await expect(facts.locator('.orr-meas dt'))
    .toHaveText(['Radius', 'Gravity', 'Arrival', 'Year']);
  await expect(facts.locator('.orr-meas dd').first()).toHaveText('6,378km');
  // And the tables below do not repeat them — a grid that restates the table
  // under it only makes the reader check whether they differ.
  await expect(facts.locator('.orr-sec', { hasText: 'Orbit' })).not.toContainText('Arrival');
  await expect(facts).toContainText('1 AU');
  await expect(facts).toContainText('1 day');   // not "1 days"
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
    stations: [
      { name: 'Testholm Hub', type: 'Coriolis', primaryEconomy: 'Refinery',
        distanceToArrival: 502, landingPads: { large: 4, medium: 4, small: 8 } },
      { name: 'Nearer Dock', type: 'Outpost', distanceToArrival: 480,
        landingPads: { large: 0, medium: 2, small: 4 } }
    ]
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
    'Mapped signals', '2 stations'
  ]);
  // Nearest first, since the question is which one to fly to, and the largest
  // pad is the thing that decides whether you can dock at all.
  const stations = facts.locator('.orr-sec', { hasText: '2 stations' });
  await expect(stations.locator('.orr-stn-h b')).toHaveText(['Nearer Dock', 'Testholm Hub']);
  await expect(stations.locator('.orr-stn').first().locator('.pad')).toHaveText('M');
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

/* ── the orrery as a page of its own ────────────────────────────────────── */

/** The typeahead, answering as the real one does: a prefix search. */
async function stubSearch(page, rows = [
  { id64: 99, name: 'Testholm', x: 30, y: 40, z: 0 },
  { id64: 100, name: 'Testholm Deep', x: 3, y: 4, z: 0 }
]) {
  await page.route(API, (route) => {
    const url = route.request().url();
    const json = (b) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.includes('/typeahead')) {
      const q = decodeURIComponent(new URL(url).searchParams.get('q') || '').toLowerCase();
      return json({ min_max: rows.filter((r) => r.name.toLowerCase().startsWith(q)) });
    }
    return json({ system: SYSTEM });
  });
}

test('a link to a system opens that system', async ({ page }) => {
  await stubDataHosts(page);
  await stubSearch(page);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });
  await expect(page.locator('#orr-name')).toHaveText('Testholm');
  await expect(page).toHaveTitle('Testholm — Canonn Orrery');
  // No map behind it, so there is nothing to go back to.
  await expect(page.locator('.orr-back')).toBeHidden();
});

test('with no system named, the search is the page', async ({ page }) => {
  await stubDataHosts(page);
  await stubSearch(page);
  await page.goto('/orrery.html', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('.orr-empty h1')).toHaveText('Canonn Orrery', { timeout: 30_000 });
  // An empty screen is an invitation to act, so it offers real places to start.
  await expect(page.locator('.orr-seeds button').first()).toHaveText('Sol');
  await expect(page.locator('.orr-mid')).toBeHidden();
  await expect(page.locator('.orr-foot')).toBeHidden();
});

test('searching finds a system and puts it in the address bar', async ({ page }) => {
  await stubDataHosts(page);
  await stubSearch(page);
  await page.goto('/orrery.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-empty h1')).toBeVisible({ timeout: 30_000 });

  await page.locator('#orr-q').fill('testh');
  await expect(page.locator('.orr-res .orr-r')).toHaveCount(2, { timeout: 15_000 });
  // Distance from Sol comes free with the lookup, so the results say it.
  await expect(page.locator('.orr-res .orr-r').first()).toContainText('50 ly');

  await page.locator('.orr-res .orr-r').first().click();
  await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });
  // The link is the point: what you are looking at is in the URL.
  expect(new URL(page.url()).searchParams.get('system')).toBe('Testholm');
  await expect(page.locator('.orr-empty')).toBeHidden();
});

test('the body filter keeps a match\'s parents', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });

  // "1 a" is a moon of "Testholm 1", which is not itself a match — but
  // dropping it would leave the moon indented under nothing.
  await page.locator('#orr-filter').fill('1 a');
  await expect(page.locator('.orr-row .nm')).toHaveText(['Testholm', '1', '1 a']);

  await page.locator('#orr-filter').fill('rocky');       // matches by subtype too
  await expect(page.locator('.orr-row .nm')).toHaveText(['Testholm', '1', '1 a']);

  await page.locator('#orr-filter').fill('nothing here');
  await expect(page.locator('.orr-list .orr-none')).toBeVisible();
});

test('what gets drawn is under the reader\'s control', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });

  await openView(page);

  // Three states, because a forty-body system draws forty ellipses and the
  // planets disappear into their own moons. Each row states its own value in
  // words, so the drawer reads without relying on colour.
  const orbits = page.locator('#orr-orbits b');
  await expect(orbits).toHaveText('all');
  await page.locator('#orr-orbits').click();
  await expect(orbits).toHaveText('planets only');
  await page.locator('#orr-orbits').click();
  await expect(orbits).toHaveText('none');

  await expect(page.locator('#orr-labels')).not.toHaveClass(/hide/);
  await page.locator('#orr-labl').click();
  await expect(page.locator('#orr-labels')).toHaveClass(/hide/);
  await expect(page.locator('#orr-labl b')).toHaveText('off');
});

/* distanceToArrival in light-seconds is what a commander actually asks about a
   system, and it is the one spatial fact the orbit view cannot show: that
   draws each body against its own parent. */
test('the spine places every body by its distance from arrival', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });

  // The star at 0 Ls, the planet at 499, its moon at 500.
  await expect(page.locator('.orr-spine .pip')).toHaveCount(3);
  await expect(page.locator('.orr-spine')).toContainText('500 Ls');
  await expect(page.locator('.orr-spine .pip.moon')).toHaveCount(1);

  // And it is navigation, not decoration.
  await page.locator('.orr-spine .pip').last().click();
  await expect(page.locator('.orr-facts .orr-f-h b')).toHaveText('Testholm 1 a');
  await expect(page.locator('.orr-spine .pip').last()).toHaveClass(/on/);
});

/* The spine hides itself below 960px. With grid rows assigned by source order
   that shifted every child up one: the stage took the "auto" track and
   collapsed to its content while the time bar inherited the 1fr and grew to
   half the screen. Rows are named now, and this is what says so. */
test('the layout holds at every width', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page);

  for (const [w, h] of [[1440, 900], [900, 800], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.orr-facts .orr-f-h')).toBeVisible({ timeout: 60_000 });

    const box = await page.evaluate(() => {
      const r = (s) => {
        const e = document.querySelector(s);
        return e ? e.getBoundingClientRect() : null;
      };
      return {
        vw: innerWidth, vh: innerHeight, scrollW: document.documentElement.scrollWidth,
        mid: r('.orr-mid'), stage: r('.orr-stage'), foot: r('.orr-foot'),
        facts: r('.orr-right')
      };
    });

    const at = `${w}x${h}`;
    // Nothing sticks out sideways.
    expect(box.scrollW, `no sideways scroll at ${at}`).toBe(w);
    expect(Math.round(box.mid.width), `the middle fits at ${at}`).toBeLessThanOrEqual(w);
    // The view gets the room, not the time bar.
    expect(Math.round(box.foot.height), `time bar stays a bar at ${at}`).toBeLessThan(70);
    expect(box.stage.height, `the view has real height at ${at}`).toBeGreaterThan(200);
    // And the detail panel is readable rather than a sliver.
    expect(box.facts.height, `detail panel is usable at ${at}`).toBeGreaterThan(120);
    // Everything lands inside the window.
    expect(Math.round(box.foot.bottom), `nothing below the fold at ${at}`).toBeLessThanOrEqual(h);
  }
});

/* The exaggeration used to run away. At true distance Mercury came out twelve
   times wider than its own orbit and Sol's disc was wider than Saturn's, so
   the whole inner system was drawn inside the star and neighbouring planets
   overlapped each other. A body may not be drawn larger than the room it has. */
test('no body is drawn bigger than the room it has', async ({ page }) => {
  const m = await mechanics(page);

  for (const trueDistance of [false, true]) {
    const bad = await page.evaluate(([mod, td]) => {
      // Sol's real shape: a tight inner system, gas giants, and a body 700 AU
      // out that sets the scale for everything else.
      const AU = [0.387, 0.723, 1, 1.524, 5.204, 9.582, 19.23, 30.11, 39.48, 700];
      const KM = [2440, 6052, 6378, 3390, 69911, 58232, 25362, 24622, 1188, 1200];
      const sys = { name: 'S', bodies: [
        { bodyId: 0, type: 'Star', name: 'S', mainStar: true, solarRadius: 1 },
        ...AU.map((a, i) => ({
          bodyId: i + 1, type: 'Planet', name: 'p' + i, subType: 'Rocky body',
          parents: [{ Star: 0 }], radius: KM[i],
          semiMajorAxis: a, orbitalPeriod: 365 * Math.pow(a, 1.5)
        })),
        // A moon, so the nesting is exercised too.
        { bodyId: 99, type: 'Planet', name: 'moon', subType: 'Icy body',
          parents: [{ Planet: 5 }, { Star: 0 }], radius: 1737,
          semiMajorAxis: 0.0026, orbitalPeriod: 27 }
      ] };
      const model = mod.buildModel(sys);
      mod.layout(model, td);

      const bad = [];
      const walk = (n) => {
        const kids = n.children.filter((k) => k.a > 0).sort((x, y) => x.a - y.a);
        // Nothing sits inside what it orbits.
        if (kids.length && n.drawR >= kids[0].a) {
          bad.push(n.name + ' engulfs ' + kids[0].name);
        }
        // Neighbours do not touch.
        for (let i = 1; i < kids.length; i++) {
          if (kids[i].drawR + kids[i - 1].drawR >= kids[i].a - kids[i - 1].a) {
            bad.push(kids[i - 1].name + ' overlaps ' + kids[i].name);
          }
        }
        kids.forEach(walk);
      };
      walk(model.star);
      return bad;
    }, [m, trueDistance]);

    expect(bad, trueDistance ? 'at true distance' : 'spread').toEqual([]);
  }
});

/* Stations have a real distance from arrival and no orbital elements at all,
   so they go where the data supports them and nowhere else. */
test('stations appear where their data actually places them', async ({ page }) => {
  const withPorts = JSON.parse(JSON.stringify(SYSTEM));
  withPorts.bodies[1].stations = [
    { name: 'Far Dock', type: 'Coriolis', distanceToArrival: 900 },
    { name: 'Near Dock', type: 'Outpost', distanceToArrival: 505 }
  ];
  withPorts.stations = [{ name: 'Loose Platform', type: 'Orbis Starport',
                          distanceToArrival: 1200 }];

  await stubDataHosts(page);
  await stubApi(page, withPorts);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });

  // On the distance axis, because that is the one spatial fact they carry.
  await expect(page.locator('.orr-spine .port')).toHaveCount(3);
  // The axis has to stretch to the furthest of them, not just the bodies.
  await expect(page.locator('.orr-spine')).toContainText('1,200 Ls');

  // Counted in the list against the body they belong to.
  await expect(page.locator('.orr-row[data-id="1"] .pt')).toHaveText('◆ 2');
  await expect(page.locator('.orr-row[data-id="0"] .pt')).toHaveCount(0);

  // The ones the dump attaches to no body belong to the system, so they are
  // read off the star rather than being lost.
  await page.locator('.orr-row[data-id="0"]').click();
  await expect(page.locator('.orr-sec', { hasText: 'Elsewhere in the system' }))
    .toContainText('Loose Platform');
});

/* Getting close to a body at true scale had four separate things in the way,
   and the first three each hid the next.

   The near plane was pinned at 0.05 units, which in Sol is a third of an AU,
   so anything you approached was clipped out of the scene — the sphere and
   its constant-size dot both. focusOn() had an absolute floor of 15 units,
   half a million times further out than Mercury is wide, so selecting a body
   went nowhere near it. Scrolling could not rescue that either: the dolly is
   multiplicative, and 175 units down to Mercury is 160 ticks. And following
   moved only the aim point, leaving the camera behind — at that zoom a body
   crosses its own framing distance a hundred times a second, so it was gone
   within a frame. */
test('you can get right up to a body at true scale', async ({ page }) => {
  await stubDataHosts(page);
  // Sol's real geometry: an inner planet, and a body 700 AU out that sets the
  // scale everything else is drawn against.
  await stubApi(page, { name: 'Testholm', id64: 99, date: '2026-01-01 00:00:00+00', bodies: [
    { bodyId: 0, type: 'Star', name: 'Testholm', mainStar: true,
      subType: 'G (White-Yellow) Star', spectralClass: 'G2', solarRadius: 1 },
    { bodyId: 1, type: 'Planet', name: 'Testholm 1', subType: 'Metal-rich body',
      parents: [{ Star: 0 }], radius: 2440, distanceToArrival: 170,
      semiMajorAxis: 0.387, orbitalEccentricity: 0.2, orbitalPeriod: 88 },
    { bodyId: 2, type: 'Planet', name: 'Testholm 2', subType: 'Icy body',
      parents: [{ Star: 0 }], radius: 1200, distanceToArrival: 340000,
      semiMajorAxis: 700, orbitalPeriod: 5475000 }
  ] });
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });

  await openView(page);
  await page.locator('#orr-true').click();
  await expect(page.locator('#orr-true')).toHaveClass(/on/);
  await page.locator('#orr-vclose').click();
  await page.locator('.orr-row[data-id="1"]').click();
  await page.waitForTimeout(600);

  const at = () => page.evaluate(() => window.Orrery.state());
  const s = await at();
  expect(s.trueScale).toBe(true);
  expect(s.selected).toBe('Testholm 1');

  // Framed against its own size rather than an absolute floor, so it actually
  // fills a useful part of the view instead of being a sub-pixel speck.
  expect(s.toSelected).toBeLessThan(s.selectedRadius * 30);
  expect(s.toSelected).toBeGreaterThan(s.selectedRadius);

  // And the near plane came in with it, or the body would be clipped away.
  expect(s.near).toBeLessThan(s.toSelected);

  /* Following carries the camera, not just the aim. The body is moving; if
     only the target moved, this distance would run away within a second. */
  await page.waitForTimeout(2500);
  const later = await at();
  expect(later.selected).toBe('Testholm 1');
  expect(Math.abs(later.toSelected - s.toSelected)).toBeLessThan(s.toSelected * 0.5);
});

/* A polyline is a polygon: it always sags below the true ellipse it stands
   for. At a fixed 180 segments that sag is r·pi²/(2·180²), which against
   Mercury drawn to scale is three and a half times the planet's own radius —
   so the planet sat visibly off its own orbit and wobbled in and out of it as
   it travelled, worse the faster time ran. Spread mode hid it only by drawing
   bodies hundreds of thousands of times too large. */
test('a body rides on its own orbit line, at either scale', async ({ page }) => {
  await stubDataHosts(page);
  // Sol's real span: a small inner planet, a gas giant, and a small body far
  // out — which is the case that needs the most segments by a long way.
  await stubApi(page, { name: 'Testholm', id64: 99, date: '2026-01-01 00:00:00+00', bodies: [
    { bodyId: 0, type: 'Star', name: 'Testholm', mainStar: true,
      subType: 'G (White-Yellow) Star', spectralClass: 'G2', solarRadius: 1 },
    { bodyId: 1, type: 'Planet', name: 'Testholm 1', subType: 'Metal-rich body',
      parents: [{ Star: 0 }], radius: 2440, distanceToArrival: 170,
      semiMajorAxis: 0.387, orbitalEccentricity: 0.2056, orbitalPeriod: 88 },
    { bodyId: 2, type: 'Planet', name: 'Testholm 2', subType: 'Class I gas giant',
      parents: [{ Star: 0 }], radius: 69911, distanceToArrival: 2600,
      semiMajorAxis: 5.204, orbitalEccentricity: 0.0488, orbitalPeriod: 4332 },
    { bodyId: 3, type: 'Planet', name: 'Testholm 3', subType: 'Icy body',
      parents: [{ Star: 0 }], radius: 995, distanceToArrival: 290000,
      semiMajorAxis: 506, orbitalEccentricity: 0.85, orbitalPeriod: 4161000 }
  ] });
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row')).toHaveCount(4, { timeout: 60_000 });

  const miss = () => page.evaluate(() => window.Orrery.state().worstOrbitMiss);

  // Under one body-radius everywhere, which is the point at which it stops
  // being something you can see.
  expect(await miss(), 'spread').toBeLessThan(1);

  await openView(page);
  await page.locator('#orr-true').click();
  await expect(page.locator('#orr-true')).toHaveClass(/on/);
  await page.waitForTimeout(500);
  expect(await miss(), 'true scale').toBeLessThan(1);
});

/* A system spans from a body a few thousand kilometres across to an orbit
   hundreds of AU wide. A linear depth buffer cannot hold that range: whatever
   near and far are set to, one end gets almost no precision, and what loses is
   exactly the surfaces drawn close together — a moon against its planet, an
   orbit line grazing the body riding it. */
test('depth is held logarithmically, across the whole span', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });
  expect(await page.evaluate(() => window.Orrery.state().logDepth)).toBe(true);
});

/* Past a point the clock is not fast, it is undersampled: a body that turns
   several times between frames stops moving and starts strobing, and no care
   in the geometry can help because the samples are not there. The ceiling
   belongs to the system, not to the control. */
test('the clock stops at the speed the system can still show', async ({ page }) => {
  const withPeriods = (name, periods) => ({
    name, id64: 99, date: '2026-01-01 00:00:00+00',
    bodies: [
      { bodyId: 0, type: 'Star', name, mainStar: true,
        subType: 'G (White-Yellow) Star', spectralClass: 'G2', solarRadius: 1 },
      ...periods.map((P, i) => ({
        bodyId: i + 1, type: 'Planet', name: name + ' ' + (i + 1),
        subType: 'Rocky body', parents: [{ Star: 0 }], radius: 6000,
        semiMajorAxis: Math.pow(P / 365, 2 / 3), orbitalPeriod: P,
        distanceToArrival: 400 + i
      }))
    ]
  });

  const capOf = async (sys) => {
    await stubApi(page, sys);
    await page.goto('/orrery.html?system=' + encodeURIComponent(sys.name),
      { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.orr-facts .orr-f-h')).toBeVisible({ timeout: 60_000 });
    for (let i = 0; i < 25; i++) {
      await page.locator('#orr-faster').click({ force: true }).catch(() => {});
    }
    return page.evaluate(() => window.Orrery.state());
  };

  await stubDataHosts(page);

  // Sol's shape: an 88-day inner planet holds the ceiling down.
  const fast = await capOf(withPeriods('Quick', [88, 365, 4332]));
  expect(fast.fastestRate).toBe('1 year/s');
  await expect(page.locator('#orr-faster')).toBeDisabled();

  // A system whose innermost body takes eight years can be run far harder
  // without anything skipping, so the ceiling lifts to the top of the ladder.
  const slow = await capOf(withPeriods('Slow', [3000, 60000]));
  expect(slow.fastestRate).toBe('100 yrs/s');
  await expect(page.locator('#orr-faster')).toBeDisabled();

  // A middling one lands in between rather than at either end — the ceiling
  // tracks the data, it is not a two-way switch.
  const mid = await capOf(withPeriods('Middling', [2200, 60000]));
  expect(mid.fastestRate).toBe('10 yrs/s');

  // Whatever the ceiling, "slower" still reaches the bottom of the ladder and
  // the reverse half of it.
  for (let i = 0; i < 25; i++) {
    await page.locator('#orr-slower').click({ force: true }).catch(() => {});
  }
  await expect(page.locator('.orr-rate')).toContainText('−');
  await expect(page.locator('#orr-slower')).toBeDisabled();
});

/* Ring geometry is in the dump and is real: inner and outer radius, and a
   type. The radii arrive in metres against a body radius in kilometres, which
   is the easy thing to get wrong by a factor of a thousand. */
test('rings are drawn at the width the dump gives them', async ({ page }) => {
  const ringed = JSON.parse(JSON.stringify(SYSTEM));
  Object.assign(ringed.bodies[1], {
    radius: 58232,                                  // Saturn's, in km
    axialTilt: 0.4665,
    rings: [{ name: 'D Ring', type: 'Icy',
              innerRadius: 74500000, outerRadius: 140180000 }]   // metres
  });
  await stubDataHosts(page);
  await stubApi(page, ringed);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });
  await page.locator('.orr-row[data-id="1"]').click();

  // 74,500 km and 140,180 km against a 58,232 km body: 1.28 and 2.41 radii.
  const ring = await page.evaluate(() => window.Orrery.state().rings);
  expect(ring.count).toBe(1);
  expect(ring.innerRadii).toBeCloseTo(74500 / 58232, 2);
  expect(ring.outerRadii).toBeCloseTo(140180 / 58232, 2);
  // Flat in the body's equatorial plane, so it carries the axial tilt.
  expect(ring.tilt).toBeCloseTo(0.4665, 3);

  await expect(page.locator('.orr-facts')).toContainText('D Ring');
  await expect(page.locator('.orr-chip', { hasText: 'Ringed' })).toBeVisible();

  /* Not a flat plate. Rings are banded with gaps, which is what stops a wide
     one reading as a solid disc, and how solid it is drawn comes from the
     mass the dump gives it over the area it covers. */
  expect(ring.banded).toBe(true);
  expect(ring.opacity).toBeGreaterThan(0.2);
  expect(ring.opacity).toBeLessThan(0.4);
});

/* A ring's mass and its area are both in the dump, so how solid it looks is
   data rather than taste. Across Sol that separates them by a factor of
   fifty: Jupiter's halo ring is a whisper and Uranus's is heavy. */
test('a faint ring is drawn faint', async ({ page }) => {
  const withRing = (mass, innerRadius, outerRadius) => {
    const sys = JSON.parse(JSON.stringify(SYSTEM));
    Object.assign(sys.bodies[1], {
      radius: 58232,
      rings: [{ name: 'R', type: 'Icy', mass, innerRadius, outerRadius }]
    });
    return sys;
  };
  const opacityOf = async (sys) => {
    await stubApi(page, sys);
    await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });
    await page.locator('.orr-row[data-id="1"]').click();
    return page.evaluate(() => window.Orrery.state().rings.opacity);
  };
  await stubDataHosts(page);

  // Jupiter's halo ring: barely any mass spread over a very wide band.
  const whisper = await opacityOf(withRing(10000, 92000000, 182000000));
  // Uranus's: more mass over a smaller one.
  const heavy = await opacityOf(withRing(171570, 30890000, 103000000));

  expect(whisper).toBeLessThan(heavy);
  expect(whisper).toBeLessThan(0.15);
});

/* A star is the one body in a system that is not a surface but a process, so
   it gets a shader rather than a painted texture. Two things have to hold: it
   has to compile at all — a custom ShaderMaterial does not get three's
   logarithmic-depth chunks for free, and without them it sorts against the
   rest of the scene as though depth were linear — and it has to run on real
   seconds rather than simulated ones. */
test('the star churns, on its own clock', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await stubDataHosts(page);
  await stubApi(page);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });

  const starTime = () => page.evaluate(() => window.Orrery.state().starTime);
  expect(await starTime(), 'the star has a shader clock').not.toBeNull();

  // Pause the orbits: the surface must keep moving anyway.
  await page.locator('#orr-play').click();
  const paused = await page.evaluate(() => window.Orrery.state());
  const t0 = paused.starTime;
  await page.waitForTimeout(1200);
  const t1 = await starTime();
  expect(t1, 'the surface runs while the orbits are stopped').toBeGreaterThan(t0);

  // And the orbit clock really was stopped, so the two are independent.
  await expect(page.locator('#orr-date')).toHaveText(
    await page.locator('#orr-date').textContent());

  // A shader that failed to compile shows up here, not in a screenshot.
  expect(errors.filter((e) => /shader|GLSL|WebGL|THREE/i.test(e))).toEqual([]);
});

/* Textures are painted per body from what the dump says, and seeded from the
   body's own id64 — random per body, never random per page load. A world that
   changed its face between visits would stop being a fact about the world. */
test('a body keeps the same face between visits', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page);

  const faceOf = async () => {
    await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });
    // Read the generated canvas back off the texture the body is wearing.
    return page.evaluate(() => {
      const st = window.Orrery.state();
      return window.Orrery.faces();
    });
  };

  const first = await faceOf();
  const second = await faceOf();
  expect(first.length).toBeGreaterThan(0);
  expect(second, 'the same worlds, painted the same way').toEqual(first);
});

/* An orrery answers three questions — which system, when, and how it is drawn
   — and its controls belong where the answers do. The third group had no
   home: projection sat in the header, scale in the time bar, and orbits,
   names and follow floated over the render. All of it is in one drawer now,
   and the header and time bar hold only what they are about. */
test('how the scene is drawn lives in one place', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });

  // Nothing about drawing is loose in the header or the time bar.
  await expect(page.locator('.orr-top #orr-3d')).toHaveCount(0);
  await expect(page.locator('.orr-foot #orr-true')).toHaveCount(0);
  await expect(page.locator('#orr-drawer')).toBeHidden();

  await openView(page);
  for (const id of ['orr-3d', 'orr-2d', 'orr-spread', 'orr-true',
                    'orr-orbits', 'orr-labl', 'orr-follow',
                    'orr-sky-galaxy', 'orr-sky-stars', 'orr-sky-none',
                    'orr-amb', 'orr-glow', 'orr-reset']) {
    await expect(page.locator('#orr-drawer #' + id), id).toHaveCount(1);
  }

  // Escape closes the drawer before it closes the orrery.
  await page.keyboard.press('Escape');
  await expect(page.locator('#orr-drawer')).toBeHidden();
  await expect(page.locator('.orrery.open')).toHaveCount(1);
});

/* The sky is computed from where the system actually is, not pasted on: a
   galaxy sampled around Sagittarius A* and then looked at from the system's
   own coordinates. Sol is 25,900 ly out and sees it one way; somewhere else
   sees it another. */
test('the sky is built from the system\'s position', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page, { ...SYSTEM, coords: { x: 0, y: 0, z: 0 } });
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });
  await openView(page);

  // It states the one fact nothing else here tells you: where the core is.
  await expect(page.locator('#orr-corebear')).toContainText('25,900 ly');

  await page.locator('#orr-sky-galaxy').click();
  await expect.poll(() => page.evaluate(() => window.Orrery.state().sky.mode))
    .toBe('galaxy');
  const galaxy = await page.evaluate(() => window.Orrery.state().sky);
  expect(galaxy.points).toBeGreaterThan(1000);
  // Direction only, carried out to sit beyond everything else in the scene.
  expect(galaxy.scale).toBeGreaterThan(400);

  await page.locator('#orr-sky-none').click();
  await expect.poll(() => page.evaluate(() => window.Orrery.state().sky.points)).toBe(0);

  // And the choice is remembered, because it is a preference not a mode.
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });
  expect(await page.evaluate(() => window.Orrery.state().sky.mode)).toBe('none');
});

test('the light controls do something, and are remembered', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });
  await openView(page);

  await page.locator('#orr-amb').fill('80');
  await page.locator('#orr-amb').dispatchEvent('input');
  await page.locator('#orr-glow').fill('0');
  await page.locator('#orr-glow').dispatchEvent('input');
  expect(await page.evaluate(() => window.Orrery.state().ambient)).toBe(80);
  expect(await page.evaluate(() => window.Orrery.state().glow)).toBe(0);

  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });
  const back = await page.evaluate(() => window.Orrery.state());
  expect(back.ambient).toBe(80);
  expect(back.glow).toBe(0);
});

/* Stations are places you might fly to, so they link out to the tools that
   know more. The two links are not equivalent and the labels say so: Spansh
   keys on the market id the dump carries, so that is exact; Inara numbers its
   stations itself and that number is nowhere in the dump, so the honest offer
   is a search. */
test('a station links out to where more is known', async ({ page }) => {
  const withPort = JSON.parse(JSON.stringify(SYSTEM));
  withPort.bodies[1].stations = [{
    name: 'Walz Depot', type: 'Planetary Outpost', primaryEconomy: 'Industrial',
    distanceToArrival: 166, id: 3534389760,
    landingPads: { large: 2, medium: 2, small: 4 },
    services: ['Dock', 'Market', 'Outfitting', 'Shipyard', 'Repair', 'Refuel',
               'Contacts', 'Missions', 'Crew Lounge', 'Livery']
  }];
  await stubDataHosts(page);
  await stubApi(page, withPort);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });
  await page.locator('.orr-row[data-id="1"]').click();

  const card = page.locator('.orr-stn', { hasText: 'Walz Depot' });
  // Exact, because the market id is in the dump.
  await expect(card.locator('a').first())
    .toHaveAttribute('href', 'https://spansh.co.uk/station/3534389760');
  // A search, and labelled as one rather than pretending to be a deep link.
  await expect(card.locator('a').nth(1)).toHaveText(/Find on Inara/);
  await expect(card.locator('a').nth(1))
    .toHaveAttribute('href', /inara\.cz\/elite\/search\/\?search=Walz%20Depot%20Testholm/);
  for (const a of await card.locator('a').all()) {
    await expect(a).toHaveAttribute('rel', 'noopener');
    await expect(a).toHaveAttribute('target', '_blank');
  }

  /* Ten services listed, but only the handful that decide whether the trip is
     worth making are named; the rest are counted. */
  await expect(card.locator('.orr-svc i'))
    .toHaveText(['Market', 'Outfitting', 'Shipyard', 'Repair', 'Refuel']);
  await expect(card.locator('.orr-svc u')).toHaveText('+5 more');
});

/* Game tokens are not something to show a reader, and they come in more than
   one shape. */
test('signal names are read out, not printed raw', async ({ page }) => {
  const sig = JSON.parse(JSON.stringify(SYSTEM));
  sig.bodies[1].signals = { signals: {
    '$SAA_SignalType_Biological;': 3,
    '$PLANETARYMININGLOCATION_NAME': 6,
    '$SAA_SignalType_Human;': 1
  } };
  await stubDataHosts(page);
  await stubApi(page, sig);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });
  await page.locator('.orr-row[data-id="1"]').click();

  const signals = page.locator('.orr-sec', { hasText: 'Mapped signals' });
  await expect(signals.locator('dt')).toHaveText(['Biological', 'Mining location', 'Human']);
  await expect(signals).not.toContainText('$');
  await expect(signals).not.toContainText('_NAME');
});

/* The dump carries far more than the counts. Blaa Hypai BN-I b26-1 B 4 — the
   system that turned this up — reads "$SAA_SignalType_Guardian;: 1" and then
   names what is there: a Guardian Codex and a Relic Tower. Showing only the 1
   threw away the reason to fly. Both bodies below are that system's real
   blocks, copied out of the dump. */
test('a mapped signal says what is down there, not just how many', async ({ page }) => {
  const sig = JSON.parse(JSON.stringify(SYSTEM));
  sig.bodies[1].signals = {
    signals: { '$SAA_SignalType_Guardian;': 1 },
    genuses: [],
    guardian: ['Guardian Codex', 'Guardian Relic Tower']
  };
  sig.bodies[2].signals = {
    signals: { '$SAA_SignalType_Biological;': 2 },
    // Two genuses seen from orbit; only one of them identified on the ground.
    genuses: ['$Codex_Ent_Electricae_Genus_Name;', '$Codex_Ent_Bacterial_Genus_Name;'],
    biology: ['Electricae Radialem - Magenta'],
    influencingStar: { name: 'Testholm', subType: 'G (White-Yellow) Star' }
  };
  await stubDataHosts(page);
  await stubApi(page, sig);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });

  await page.locator('.orr-row[data-id="1"]').click();
  const guard = page.locator('.orr-sec', { hasText: 'Mapped signals' });
  await expect(guard.locator('.orr-find span')).toHaveText(
    ['Guardian Codex', 'Guardian Relic Tower']);
  // Guardian sites are Bifrost's subject, so that is where the way out goes.
  await expect(guard.locator('a[href*="ruins.canonn.tech"]')).toHaveCount(1);

  await page.locator('.orr-row[data-id="2"]').click();
  const bio = page.locator('.orr-sec', { hasText: 'Mapped signals' });
  // The genus token is read out as the codex prints it, and the species that
  // nobody has landed on and named says so rather than being left out.
  await expect(bio.locator('.orr-find span')).toHaveText(
    ['Electricae Radialem — Magenta', 'Bacterium']);
  await expect(bio.locator('.orr-find.dim em')).toHaveText('not identified');
  await expect(bio).toContainText('Lit by Testholm');
  await expect(bio).not.toContainText('$Codex_Ent');
});

/* Twenty-two bodies and one of them has the Guardian site. Reading the panel
   for each is twenty-two clicks; the list says which one before you click. */
test('the list marks the bodies worth clicking', async ({ page }) => {
  const sig = JSON.parse(JSON.stringify(SYSTEM));
  sig.bodies[1].signals = { signals: { '$SAA_SignalType_Guardian;': 1 } };
  sig.bodies[2].signals = { signals: {
    '$SAA_SignalType_Biological;': 3, '$SAA_SignalType_Geological;': 1 } };
  await stubDataHosts(page);
  await stubApi(page, sig);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });

  await expect(page.locator('.orr-row[data-id="0"] .sg')).toHaveCount(0);
  await expect(page.locator('.orr-row[data-id="1"] .sg.gua')).toHaveCount(1);
  await expect(page.locator('.orr-row[data-id="2"] .sg.bio')).toHaveCount(1);
  await expect(page.locator('.orr-row[data-id="2"] .sg.geo')).toHaveCount(1);
  // The marks have to be visible to be marks.
  const box = await page.locator('.orr-row[data-id="1"] .sg.gua').boundingBox();
  expect(box.width).toBeGreaterThan(2);
});

/* A link someone typed or pasted in caps is a link to the same system. The
   typeahead is a prefix search over canonical names, so the guard against a
   near-match has to compare letters rather than case. */
test('a system opens whatever case its name is written in', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page);
  await page.goto('/orrery.html?system=TESTHOLM', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });
  await expect(page.locator('#orr-msg')).toHaveClass(/gone/);
});

/* The list, the detail and the distance axis all take a drag, and the sizes
   are remembered — they are how a reader sets the tool up for what they are
   doing, not a mode. */
test('the panels resize, and stay where they were put', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });

  const widthOf = (sel) => page.evaluate((s) =>
    Math.round(document.querySelector(s).getBoundingClientRect().width), sel);
  const before = await widthOf('#orr-left');

  // Keyboard, because a drag handle that only takes a pointer is a wall.
  await page.locator('#orr-grip-l').focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  const wider = await widthOf('#orr-left');
  expect(wider).toBeGreaterThan(before);

  await page.locator('#orr-grip-h').focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');

  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });
  expect(await widthOf('#orr-left'), 'the list stayed where it was put').toBe(wider);

  // Whatever is asked for, the stage keeps room to be worth looking at.
  await page.locator('#orr-grip-l').focus();
  for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowRight');
  const stage = await widthOf('.orr-stage');
  const mid = await widthOf('.orr-mid');
  expect(stage).toBeGreaterThan(mid * 0.3);
});

/* ── black holes ────────────────────────────────────────────────────────────

   Great Annihilator's two, verbatim from Canonn's dump. Real numbers because
   the first test below is about what Elite's numbers mean, and a made-up mass
   and radius could not be wrong about that. */
const HOLES = {
  name: 'Annihilator', id64: 2587943, bodyCount: 3,
  date: '2026-01-01 00:00:00+00',
  coords: { x: 354.84, y: -42.44, z: 22997.22 },
  bodies: [
    { bodyId: 0, type: 'Star', name: 'Annihilator A', mainStar: true,
      subType: 'Black Hole', spectralClass: 'H5', luminosity: 'VII',
      solarRadius: 0.000840251168224299, solarMasses: 198.097656,
      surfaceTemperature: 0, absoluteMagnitude: 20, age: 2,
      rotationalPeriod: 1.037e-6, distanceToArrival: 0 },
    { bodyId: 1, type: 'Star', name: 'Annihilator B', subType: 'Black Hole',
      spectralClass: 'H0', luminosity: 'VII',
      solarRadius: 0.000280255526599569, solarMasses: 66.074219,
      surfaceTemperature: 0, absoluteMagnitude: 20,
      parents: [{ Star: 0 }], semiMajorAxis: 347.65, orbitalPeriod: 227703,
      distanceToArrival: 211599 },
    { bodyId: 2, type: 'Star', name: 'Annihilator A 1', subType: 'T Tauri Star',
      spectralClass: 'TTS6', luminosity: 'VI', solarRadius: 0.331, solarMasses: 0.148,
      surfaceTemperature: 1564, parents: [{ Star: 0 }],
      semiMajorAxis: 7.07, orbitalPeriod: 487.4, distanceToArrival: 3468 }
  ]
};

/* The claim the whole rendering rests on: Elite's solarRadius for a black hole
   is not a stylistic choice, it is the Schwarzschild radius of the mass the
   dump gives alongside it. If that ever stopped being true the drawn size
   would be arbitrary, and this is where we would find out. */
test('a black hole\'s radius in the dump is its event horizon', async () => {
  const KM_PER_SUN = 2.9532;          // 2GM/c², per solar mass
  for (const b of HOLES.bodies.filter((x) => x.subType === 'Black Hole')) {
    const stated = b.solarRadius * 696340;
    const schwarzschild = b.solarMasses * KM_PER_SUN;
    expect(Math.abs(stated - schwarzschild) / schwarzschild,
      b.name + ': ' + stated.toFixed(1) + ' km stated, ' +
      schwarzschild.toFixed(1) + ' km of Schwarzschild').toBeLessThan(0.005);
  }
});

test('a black hole is drawn at its shadow, not its horizon', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page, HOLES);
  await page.goto('/orrery.html?system=Annihilator', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });

  const holes = await page.evaluate(() => window.Orrery.state().holes);
  expect(holes.map((h) => h.name)).toEqual(['Annihilator A', 'Annihilator B']);
  // The T Tauri in the same system is a star and gets no lens.
  expect(holes).toHaveLength(2);

  const a = holes[0];
  expect(a.horizonKm).toBeCloseTo(0.000840251168224299 * 696340, 3);
  /* What is drawn is the shadow — 3√3/2 horizon radii — because that is the
     black disc an observer sees, not the horizon inside it. */
  expect(a.shadow / a.horizon).toBeCloseTo(3 * Math.sqrt(3) / 2, 4);
  // And the lens runs well past the shadow, or there is nowhere for a ring.
  expect(a.lens / a.shadow).toBeGreaterThan(3);
});

/* The rendering claim, checked as pixels rather than as intent: a dark disc
   with light gathered into a ring just outside it. Nothing else in the scene
   looks like that, and the amber ball this used to draw did not. */
test('a black hole is a shadow with a ring, not a glowing ball', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await stubDataHosts(page);
  /* The two holes without the T Tauri that orbits between them. This is a
     photometric measurement and a star drawn a few tens of pixels away throws
     its glow right across the annuli being compared; the pair alone leaves
     the hole standing against the sky, which is the thing being measured. */
  await stubApi(page, { ...HOLES, bodyCount: 2, bodies: HOLES.bodies.slice(0, 2) });
  /* The galaxy, not the even scatter — because a ring is a fact about the sky
     as much as about the hole. Lensing conserves surface brightness, so a sky
     of uniform brightness lenses into a sky of uniform brightness and there is
     no ring to find. It takes structure behind the hole to make one, and this
     system sits three thousand light years off the core with the band right
     across it. */
  await page.addInitScript(() => {
    try { localStorage.setItem('canonn.orrery.sky', 'galaxy'); } catch (e) {}
  });
  await page.goto('/orrery.html?system=Annihilator', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row')).toHaveCount(2, { timeout: 60_000 });
  await page.waitForTimeout(1500);

  const profile = await page.evaluate(() => {
    const at = window.Orrery.state().holes[0].screen;
    // Out to eight shadow radii, which reaches past the lens and into the
    // ordinary sky on the same frame, so the two are directly comparable.
    const half = Math.round(at.shadowPx * 8);
    const img = window.Orrery.pixels(
      Math.round(at.x) - half, Math.round(at.y) - half, half * 2, half * 2);

    const band = (lo, hi) => {
      let sum = 0, n = 0;
      for (let y = 0; y < img.h; y++) {
        for (let x = 0; x < img.w; x++) {
          const r = Math.hypot(x - half, y - half) / at.shadowPx;
          if (r < lo || r >= hi) continue;
          const i = (y * img.w + x) * 4;
          sum += (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3; n++;
        }
      }
      return n ? sum / n : null;
    };
    return {
      shadowPx: at.shadowPx,
      inside: band(0, 0.8),      // the shadow
      wound: band(1.05, 1.6),    // the far side of the sky, many times over
      ring: band(1.8, 2.5),      // where the light piles up
      mid: band(3.0, 4.2),       // still under the lens, bent only gently
      sky: band(5.5, 8)          // past the lens, the sky itself
    };
  });

  const seen = ' — ' + JSON.stringify(profile);
  expect(profile.shadowPx, 'a shadow big enough to measure').toBeGreaterThan(4);
  expect(profile.inside, 'the shadow is black' + seen).toBeLessThan(1);
  expect(profile.ring, 'and light piles up just outside it' + seen)
    .toBeGreaterThan(profile.sky * 1.08);

  /* Away from the ring the lens hands the sky back at the brightness it found
     it. Lensing moves light, it does not destroy it, and this is the number
     that says the shader is doing that: it sat at sixty percent while the sky
     was a scatter of points, because demagnifying a point field drops the
     points between samples, and it came up to parity the moment the sky
     became a continuum with clouds in it. */
  expect(profile.mid, 'surface brightness is conserved' + seen)
    .toBeGreaterThan(profile.sky * 0.75);

  /* Between the shadow and the ring is a darker band, and it should be there:
     those rays wind past the hole several times before they leave, so what
     they show is an average of the whole sky rather than of this part of it.
     This system sits near the galactic core, where the local sky is brighter
     than the galaxy's average — so the average reads as a gap. */
  expect(profile.wound, 'the wound band is dimmer than its surroundings' + seen)
    .toBeLessThan(profile.sky);

  expect(errors.filter((e) => /shader|GLSL|WebGL|THREE/i.test(e))).toEqual([]);
});

test('with no sky behind it there is nothing for a hole to bend', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page, HOLES);
  await page.goto('/orrery.html?system=Annihilator', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });
  await openView(page);

  await page.locator('#orr-sky-galaxy').click();
  await expect.poll(() => page.evaluate(() => window.Orrery.state().holes[0].hasSky)).toBe(1);
  expect(await page.evaluate(() => window.Orrery.state().holes[0].skyWidth)).toBe(4096);

  await page.locator('#orr-sky-none').click();
  await expect.poll(() => page.evaluate(() => window.Orrery.state().holes[0].hasSky)).toBe(0);
});

/* Surface temperature 0 and absolute magnitude 20 are Elite saying "no
   surface, no light", not measurements. Printing them as figures would be the
   panel asserting something the data never said. */
test('the panel answers what a black hole can be asked', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page, HOLES);
  await page.goto('/orrery.html?system=Annihilator', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });

  const facts = page.locator('.orr-facts');
  await expect(facts).toContainText('Black Hole');
  // Arrival is absent because this one *is* the arrival star, at zero.
  await expect(facts.locator('.orr-meas dt')).toHaveText(['Horizon', 'Shadow', 'Mass']);
  await expect(facts.locator('.orr-meas')).toContainText('585');
  await expect(facts.locator('.orr-meas')).toContainText('1,520');
  await expect(facts).toContainText('Photon sphere');
  await expect(facts, 'a temperature of zero is not a temperature')
    .not.toContainText('0 K');
  await expect(facts, 'and a magnitude of 20 is not a brightness')
    .not.toContainText('Magnitude');

  // The T Tauri in the same system is still a star and still says so.
  await page.locator('.orr-row', { hasText: 'A 1' }).click();
  await expect(facts).toContainText('T Tauri');
  await expect(facts.locator('.orr-meas')).toContainText('1,564');
});

/* Every star used to be painted the primary's colour, which in a system whose
   primary is a black hole told you the T Tauris were black holes too. */
test('each star is painted its own colour', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page, HOLES);
  await page.goto('/orrery.html?system=Annihilator', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });

  const dot = (id) => page.locator('.orr-row[data-id="' + id + '"]').locator('.dot')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await dot(0)).not.toBe(await dot(2));

  /* And TTS6 is a T Tauri star, which is young and warm — not a T-class brown
     dwarf, which is neither. Matching a spectral class on its first letter
     painted every young star in this system the deep magenta of a body four
     thousand degrees colder, and nothing noticed until each star started
     being painted its own colour instead of the primary's. */
  const [r, g, b] = (await dot(2)).match(/\d+/g).map(Number);
  expect(r, 'a T Tauri is warm: ' + await dot(2)).toBeGreaterThan(200);
  expect(g, 'not the magenta of a T dwarf').toBeGreaterThan(150);
  expect(g).toBeGreaterThan(b);
});

/* ── the sky ────────────────────────────────────────────────────────────── */

test('deep space is what you get without asking', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });
  const sky = await page.evaluate(() => window.Orrery.state().sky);
  expect(sky.mode).toBe('stars');
  expect(sky.points).toBeGreaterThan(10_000);
  /* A backdrop, not only a scatter of points: one image, and it is in use.
     Four thousand across wherever the driver will hold it, because the
     nebula's finest structure is about two degrees and anything smaller
     than this throws that away before it is ever drawn. */
  expect(sky.baked).toBe(4096);
  expect(sky.isBackdrop).toBe(true);
});

/* Clouds are the difference between a sky and a handful of dots. They are
   also the thing a screenshot would show and a state field would not, so this
   reads the frame: with a sky the background carries structure, and with the
   sky switched off the same region is flat. */
test('the sky has weather in it', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page, { ...SYSTEM, coords: { x: 120, y: -30, z: 4200 } });
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });
  await page.waitForTimeout(1200);

  // A patch of the frame away from the star and its orbits.
  const patch = () => page.evaluate(() => {
    const img = window.Orrery.pixels(20, 20, 160, 120);
    let sum = 0, sq = 0;
    const n = img.w * img.h;
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3;
      sum += v; sq += v * v;
    }
    const mean = sum / n;
    return { mean, sd: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
  });

  const withSky = await patch();
  await openView(page);
  await page.locator('#orr-sky-none').click();
  await expect.poll(() => page.evaluate(() => window.Orrery.state().sky.points)).toBe(0);
  await page.waitForTimeout(400);
  const empty = await patch();

  expect(withSky.mean, 'space is lit').toBeGreaterThan(empty.mean + 2);
  expect(withSky.sd, 'and it is not lit evenly').toBeGreaterThan(3);
  expect(empty.sd, 'where an empty sky is flat').toBeLessThan(withSky.sd / 2);
});

/* The invariant the whole arrangement rests on: the backdrop and the sky a
   black hole bends are one image, read the same way up.

   They were not, and nothing said so. The lens used to have its own copy,
   painted by JavaScript with row zero at the north pole and then sampled
   through a texture three flips on upload — so it drew the sky upside down,
   and a galactic band lying across the equator was symmetric enough to hide
   it completely.

   The fix is structural rather than arithmetic: there is no CPU-painted copy
   any more, so there is no flip for two conventions to disagree about. One
   shader writes the image and two readers read it — the lens, and three's own
   background — and this pins the lens to the one three actually uses.

   Checked against three's source rather than against a copy of it, because a
   copy is exactly the thing that drifted. And checked as text, honestly,
   because it cannot be checked by looking: the lens compresses a wide piece
   of sky into a small disc, so reading it upside down changes the frame by
   about six percent, which is well inside what a different machine's
   rasteriser will do to the same scene. */
test('the lens reads the sky the way three writes it', async ({ page }) => {
  await stubDataHosts(page);
  await page.goto('/orrery.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.Orrery, { timeout: 60_000 });

  const tidy = (t) => t.replace(/\s+/g, '');
  const equirect = await page.evaluate(async () => {
    const T = await import('three');
    const m = /vec2 equirectUv[\s\S]*?\n}/.exec(T.ShaderChunk.common);
    return m ? m[0] : '';
  });
  expect(equirect, 'three still has an equirectUv to agree with').not.toBe('');

  /* RECIPROCAL_PI is 1/π, so these two say the same thing. What matters is
     the sign: "asin(y)/π + 0.5" and "0.5 − asin(y)/π" differ only in which
     end of the image is the sky's north, and that is the whole bug. */
  expect(tidy(equirect)).toContain('floatv=asin(clamp(dir.y,-1.0,1.0))*RECIPROCAL_PI+0.5;');
  expect(tidy(equirect)).toContain('floatu=atan(dir.z,dir.x)*RECIPROCAL_PI2+0.5;');

  const src = readFileSync(new URL('../Source/js/orrery.js', import.meta.url), 'utf8');
  const lens = /const HOLE_FRAG = \[[\s\S]*?\]\.join/.exec(src);
  expect(lens, 'the lens shader is still called HOLE_FRAG').not.toBeNull();
  expect(tidy(lens[0])).toContain('floatv=asin(clamp(dir.y,-1.0,1.0))/3.1415927+0.5;');
  expect(tidy(lens[0])).toContain('floatu=atan(dir.z,dir.x)/6.2831853+0.5;');

  // And the shader that writes the image inverts exactly that.
  const paint = /const NEBULA_FRAG = \[[\s\S]*?\]\.join/.exec(src);
  expect(tidy(paint[0])).toContain('floatlat=(vUv.y-0.5)*3.1415927;');
  expect(tidy(paint[0])).toContain('floatlon=(vUv.x-0.5)*6.2831853;');
});

test('the lens and the backdrop are one image', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page, { ...HOLES, bodyCount: 2, bodies: HOLES.bodies.slice(0, 2) });
  await page.addInitScript(() => {
    try { localStorage.setItem('canonn.orrery.sky', 'galaxy'); } catch (e) {}
  });
  await page.goto('/orrery.html?system=Annihilator', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row')).toHaveCount(2, { timeout: 60_000 });
  await page.waitForTimeout(1200);

  const one = await page.evaluate(() => window.Orrery.state());
  expect(one.sky.isBackdrop, 'the image is the backdrop').toBe(true);
  expect(one.holes[0].sameAsSky, 'and the lens is bending that image').toBe(true);
});
