import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { stubDataHosts } from './helpers.mjs';

/* The orrery models one system from Canonn's dump. These tests are in two
   halves: the mechanics, which are checked as arithmetic because an orbit
   that is solved rather than animated by eye is the claim the file makes;
   and the view, where what matters is that opening it costs you nothing —
   the galaxy map behind it keeps its camera. */

const API = '**/us-central1-canonn-api-236217.cloudfunctions.net/**';

/** The light settings are the only two still behind a button. */
async function openLight(page) {
  if (!(await page.locator('.orrery.light-open').count())) {
    await page.locator('#orr-light').click();
  }
  await expect(page.locator('#orr-light-p')).toBeVisible();
}

/** Step the sky control until it is showing the mode wanted. */
async function setSky(page, want) {
  const btn = page.locator('#orr-sky');
  for (let i = 0; i < 4; i++) {
    if (await page.evaluate(() => window.Orrery.state().sky.mode) === want) return;
    await btn.click();
  }
  throw new Error('the sky control never reached ' + want);
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
  // "From Testholm" is there because the star was what was picked before.
  await expect(facts.locator('.orr-sec h3')).toHaveText([
    'Body', 'From Testholm', 'Orbit', 'Atmosphere', 'Crust', 'Surface materials', 'Rings',
    'Mapped signals', '2 stations'
  ]);
  /* Nearest first, since the question is which one to fly to. An index, not
     a stack of cards: the detail is a page of its own now, and repeating half
     of it here made the panel long without making it more useful. */
  const stations = facts.locator('.orr-sec', { hasText: '2 stations' });
  await expect(stations.locator('.orr-ports button span'))
    .toHaveText(['Nearer Dock', 'Testholm Hub']);
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
    /* And the detail panel is readable rather than a sliver — in both
       directions. Under the model it is supposed to be the full width of the
       screen, and it was not: resizing writes a width, and a width beats a
       media query, so a rail dragged narrow on a desktop stayed narrow on a
       phone with dead space beside it. */
    expect(box.facts.height, `detail panel is usable at ${at}`).toBeGreaterThan(120);
    if (w <= 820 && h > 560) {
      expect(Math.round(box.facts.width), `detail panel is full width at ${at}`)
        .toBeGreaterThan(w - 4);
    }
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
  await expect(page.locator('.orr-row[data-id]')).toHaveCount(3, { timeout: 60_000 });

  // On the distance axis, because that is the one spatial fact they carry.
  await expect(page.locator('.orr-spine .port')).toHaveCount(3);
  // The axis has to stretch to the furthest of them, not just the bodies.
  await expect(page.locator('.orr-spine')).toContainText('1,200 Ls');

  /* And in the list, under the body they are docked at — nearest first,
     because the list is read as "what could I dock at, and how far". They
     were a count on the body's row and a stack of cards on the far side of
     the window; this is where a reader looks for what is in a system. */
  const rows = page.locator('.orr-list .orr-row');
  await expect(rows).toHaveCount(6);
  await expect(rows.nth(0)).toHaveText(/Testholm/);
  // The ones the dump attaches to no body belong to the system, so they hang
  // off the star rather than being lost under a heading meaning "not placed".
  await expect(rows.nth(1)).toHaveClass(/stn/);
  await expect(rows.nth(1)).toHaveText(/Loose Platform/);
  await expect(rows.nth(3)).toHaveText(/Near Dock/);
  await expect(rows.nth(4)).toHaveText(/Far Dock/);
  // A station sits one level in from the body it belongs to.
  expect(await rows.nth(3).evaluate((el) => el.style.getPropertyValue('--depth'))).toBe('2');

  /* Sol lists sixty-seven of them against forty bodies, which puts Mercury
     eleven rows below the star. They belong here, but a reader looking for a
     body has to be able to put them away. */
  await page.locator('#orr-stations').click();
  await expect(page.locator('.orr-list .orr-row.stn')).toHaveCount(0);
  await expect(page.locator('.orr-list .orr-row')).toHaveCount(3);
  await page.locator('#orr-stations').click();
  await expect(page.locator('.orr-list .orr-row.stn')).toHaveCount(3);
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

  await page.locator('#orr-true').click();
  await expect(page.locator('#orr-true')).toHaveClass(/on/);
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
   names and follow floated over the render as a row of chips. All of it is on
   one strip now, over the model it changes, and the header and the time bar
   hold only what they are about. */
test('how the scene is drawn lives in one place', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });

  // Nothing about drawing is loose in the header or the time bar.
  await expect(page.locator('.orr-top #orr-3d')).toHaveCount(0);
  await expect(page.locator('.orr-foot #orr-true')).toHaveCount(0);

  /* On the strip, over the render, and visible without being asked for. A
     control a reader has to remember is behind a button is one they never
     use — and it belongs on the thing it changes, not a screen-height away
     at the top of the window. */
  for (const id of ['orr-3d', 'orr-2d', 'orr-spread', 'orr-true',
                    'orr-orbits', 'orr-labl', 'orr-follow', 'orr-sky',
                    'orr-reset']) {
    await expect(page.locator('.orr-stage #orr-hud #' + id), id).toBeVisible();
  }

  /* One row. A wrapping flex container shrink-to-fits to its widest single
     item rather than the sum of them, which stacked this four deep over the
     model however much room it had — and a class name already taken by the
     composition bars in the panel had it laid out as a three-column grid. */
  const hud = await page.locator('#orr-hud').boundingBox();
  expect(hud.height).toBeLessThan(40);
  expect(hud.width).toBeGreaterThan(500);

  /* The two exceptions, and the reason they are exceptions: ambient light and
     star glow are set once to taste and then left alone for the session. They
     are settings rather than controls, and putting them in the same row as
     the eight above would have made all ten harder to find. */
  await expect(page.locator('#orr-light-p')).toBeHidden();
  await openLight(page);
  await expect(page.locator('#orr-light-p #orr-amb')).toBeVisible();
  await expect(page.locator('#orr-light-p #orr-glow')).toBeVisible();

  /* And it opens where the button is, which is not the same claim as its
     class being toggled. It was clipped out of existence by the strip's own
     overflow, and then — once fixed — thrown four hundred pixels down the
     page by the strip's backdrop-filter, which makes it the containing block
     for anything fixed inside it. Both times the control "worked". */
  const btn = await page.locator('#orr-light').boundingBox();
  const box = await page.locator('#orr-light-p').boundingBox();
  expect(box.width).toBeGreaterThan(100);
  expect(box.height).toBeGreaterThan(30);
  expect(Math.abs(box.y - (btn.y + btn.height))).toBeLessThan(20);
  expect(box.x + box.width).toBeGreaterThan(btn.x);
  expect(box.x).toBeLessThan(btn.x + btn.width + 20);

  // Escape closes that box before it closes the orrery.
  await page.keyboard.press('Escape');
  await expect(page.locator('#orr-light-p')).toBeHidden();
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
  // It states the one fact nothing else here tells you: where the core is.
  await expect(page.locator('#orr-sky')).toHaveAttribute('title', /25,900 ly/);

  await setSky(page, 'galaxy');
  await expect.poll(() => page.evaluate(() => window.Orrery.state().sky.mode))
    .toBe('galaxy');
  const galaxy = await page.evaluate(() => window.Orrery.state().sky);
  expect(galaxy.points).toBeGreaterThan(1000);
  // Direction only, carried out to sit beyond everything else in the scene.
  expect(galaxy.scale).toBeGreaterThan(400);

  await setSky(page, 'none');
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
  await openLight(page);

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
/* A station is a place, and the dump knows a great deal about one that a card
   in a column could never hold: who runs it and what state they are in, what
   the economy is made of, how many pads of each size, where on the surface it
   stands, every service, the ships and modules it sells, and its market both
   ways round. None of that needed another request — it arrived with the
   system. This is the same station's real block out of Sol's dump, trimmed. */
test('a station says everything the dump knows about it', async ({ page }) => {
  const withPort = JSON.parse(JSON.stringify(SYSTEM));
  withPort.bodies[1].stations = [{
    name: 'Walz Depot', type: 'Planetary Outpost', primaryEconomy: 'Industrial',
    distanceToArrival: 166, id: 3534389760,
    allegiance: 'Federation', government: 'Democracy',
    controllingFaction: "Sol Workers' Party", controllingFactionState: 'Civil Liberty',
    state: 'UnderRepairs',
    latitude: -50.540871, longitude: -41.765411,
    economies: { Industrial: 80, Refinery: 20 },
    landingPads: { large: 2, medium: 2, small: 4 },
    services: ['Dock', 'Market', 'Outfitting', 'Shipyard', 'Repair', 'Refuel',
               'Contacts', 'Missions', 'Crew Lounge', 'Livery'],
    shipyard: { ships: [{ name: 'Asp Explorer' }, { name: 'Cobra MkIII' }] },
    outfitting: { modules: [{ class: 1, name: 'Lightweight Alloy' },
                            { class: 1, name: 'Reinforced Alloy' },
                            { class: 4, name: 'Power Plant' }] },
    market: {
      commodities: [
        { name: 'Biowaste', buyPrice: 109, supply: 78658, demand: 0, sellPrice: 100 },
        { name: 'Platinum', buyPrice: 0, supply: 0, demand: 312797, sellPrice: 56331 },
        { name: 'Gold', buyPrice: 0, supply: 0, demand: 900201, sellPrice: 50946 }
      ],
      prohibitedCommodities: ['Narcotics', 'Slaves']
    }
  }];
  await stubDataHosts(page);
  await stubApi(page, withPort);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row[data-id]')).toHaveCount(3, { timeout: 60_000 });

  // Nothing over the model until it is asked for.
  await expect(page.locator('#orr-modal')).toBeHidden();
  await page.locator('.orr-row.stn', { hasText: 'Walz Depot' }).click();
  const m = page.locator('#orr-modal');
  await expect(m).toBeVisible();

  /* A station has no orbit of its own, so there is nowhere to fly but the
     body it stands on — which is what a reader wants in front of them. */
  expect(await page.evaluate(() => window.Orrery.state().selected)).toBe('Testholm 1');

  await expect(page.locator('#orr-m-name')).toHaveText('Walz Depot');
  await expect(page.locator('#orr-m-sub')).toHaveText('Planetary Outpost · on 1');

  // Who is holding it, and how that is going.
  const control = m.locator('.orr-sec', { hasText: 'Control' });
  await expect(control.locator('dd')).toHaveText(
    ["Sol Workers' Party", 'Civil Liberty', 'Under Repairs']);

  // Where on the body it stands — the two numbers you fly to it with.
  await expect(m.locator('.orr-sec', { hasText: 'On the surface' }).locator('dd'))
    .toHaveText(['-50.5409°', '-41.7654°']);

  await expect(m.locator('.orr-sec', { hasText: 'Landing pads' }).locator('dd'))
    .toHaveText(['2', '2', '4']);
  await expect(m.locator('.orr-sec', { hasText: 'Economy' }).locator('.orr-bar .k'))
    .toHaveText(['Industrial', 'Refinery']);

  // All ten here, unlike the panel, which named the five that decide a trip.
  await expect(m.locator('.orr-sec', { hasText: '10 services' }).locator('.orr-chip'))
    .toHaveCount(10);
  await expect(m.locator('.orr-sec', { hasText: '2 ships' }).locator('.orr-chip'))
    .toHaveText(['Asp Explorer', 'Cobra MkIII']);
  /* Six hundred module rows is not a list anyone reads, so they are counted
     by rating — which is the thing that decides whether the detour is worth
     making. */
  await expect(m.locator('.orr-sec', { hasText: '3 modules' }).locator('.orr-bar .k'))
    .toHaveText(['Class 1', 'Class 4']);

  /* A market both ways round: what it sells cheapest, and what it pays most
     for. Hundreds of rows is not a market anyone reads either. */
  const mkt = m.locator('.orr-sec', { hasText: '3 commodities' });
  await expect(mkt.locator('.orr-mkt').first().locator('.k')).toHaveText(['Biowaste']);
  await expect(mkt.locator('.orr-mkt').nth(1).locator('.k')).toHaveText(['Platinum', 'Gold']);
  await expect(mkt.locator('.orr-mkt').nth(1).locator('.p').first()).toHaveText('56,331 cr');
  await expect(m.locator('.orr-sec', { hasText: 'Will not take' }).locator('.orr-chip'))
    .toHaveText(['Narcotics', 'Slaves']);

  // Exact, because the market id is in the dump.
  await expect(m.locator('.orr-links a').first())
    .toHaveAttribute('href', 'https://spansh.co.uk/station/3534389760');
  // A search, and labelled as one rather than pretending to be a deep link.
  await expect(m.locator('.orr-links a').nth(1)).toHaveText(/Find on Inara/);
  await expect(m.locator('.orr-links a').nth(1))
    .toHaveAttribute('href', /inara\.cz\/elite\/search\/\?search=Walz%20Depot%20Testholm/);
  for (const a of await m.locator('.orr-links a').all()) {
    await expect(a).toHaveAttribute('rel', 'noopener');
    await expect(a).toHaveAttribute('target', '_blank');
  }

  // Escape puts it away, and puts away only it.
  await page.keyboard.press('Escape');
  await expect(m).toBeHidden();
  await expect(page.locator('.orrery.open')).toHaveCount(1);

  // The panel's index opens the same page.
  await page.locator('.orr-ports button', { hasText: 'Walz Depot' }).click();
  await expect(m).toBeVisible();
});

/* A station with a latitude is standing on the ground. Odyssey settlements
   come through the dump with no type at all, so the coordinates are the only
   thing that says so — and the list says it back. */
test('a settlement on the ground reads as one', async ({ page }) => {
  const withPort = JSON.parse(JSON.stringify(SYSTEM));
  withPort.bodies[1].stations = [
    { name: 'Orbital Ring', type: 'Coriolis', distanceToArrival: 500 },
    { name: "Fung's Claim", distanceToArrival: 501, latitude: 39.95, longitude: 12.1 }
  ];
  await stubDataHosts(page);
  await stubApi(page, withPort);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row[data-id]')).toHaveCount(3, { timeout: 60_000 });

  await expect(page.locator('.orr-row.stn', { hasText: 'Orbital Ring' }))
    .not.toHaveClass(/ground/);
  await expect(page.locator('.orr-row.stn', { hasText: "Fung's Claim" }))
    .toHaveClass(/ground/);

  // And with no type, it is called what it is rather than left blank.
  await page.locator('.orr-row.stn', { hasText: "Fung's Claim" }).click();
  await expect(page.locator('#orr-m-sub')).toHaveText('Surface settlement · on 1');
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
  await expect(guard.locator('.orr-sig span')).toHaveText(
    ['Guardian Codex', 'Guardian Relic Tower']);
  // Guardian sites are Bifrost's subject, so that is where the way out goes.
  await expect(guard.locator('a[href*="ruins.canonn.tech"]')).toHaveCount(1);

  await page.locator('.orr-row[data-id="2"]').click();
  const bio = page.locator('.orr-sec', { hasText: 'Mapped signals' });
  // The genus token is read out as the codex prints it, and the species that
  // nobody has landed on and named says so rather than being left out.
  await expect(bio.locator('.orr-sig span')).toHaveText(
    ['Electricae Radialem — Magenta', 'Bacterium']);
  await expect(bio.locator('.orr-sig.dim em')).toHaveText('not identified');
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

/* Canonn is a dozen tools and the orrery linked out to none of them, so
   arriving here was a way of leaving the rest of Canonn behind. The list is
   one file, read by the console's command palette as well, so a tool added
   in one place is not missing from the other. */
test('the way out to the rest of Canonn is in both rooms', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });

  const shared = JSON.parse(readFileSync('Source/data/canonn-tools.json', 'utf8')).tools;
  expect(shared.length).toBeGreaterThan(5);
  // The one file, verbatim, in the console that has never read it before.
  const consoleJs = readFileSync('Source/js/console.js', 'utf8');
  expect(consoleJs).toContain('data/canonn-tools.json');
  expect(consoleJs).not.toContain("['Bioforge', 'bioforge.canonn.tech'");

  await page.locator('#orr-tools').click();
  const menu = page.locator('#orr-menu');
  await expect(menu).toBeVisible();
  for (const [name, , url] of shared) {
    await expect(menu.locator('a[href="' + url + '"]'), name).toHaveCount(1);
  }
  // Every one of them leaves this tab where it is.
  expect(await menu.locator('a[target="_blank"]').count()).toBeGreaterThanOrEqual(shared.length);

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  // Escape closed the menu, not the orrery.
  await expect(page.locator('.orrery.open')).toHaveCount(1);
});

/* Whatever the header grows, both rooms get: a reader who came from the map
   should not lose the tools by arriving, and one who came straight to the
   page never had them. What differs is only what is genuinely different —
   the way back to the map, and the search that is the page's whole reason. */
test('the header carries the same links in the map and on the page', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page);

  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });
  for (const id of ['orr-signals', 'orr-link', 'orr-tools']) {
    await expect(page.locator('.orr-top #' + id), id).toBeVisible();
  }
  await expect(page.locator('#orr-find')).toBeVisible();
  await expect(page.locator('#orr-back')).toBeHidden();
  await expect(page.locator('#orr-signals'))
    .toHaveAttribute('href', 'https://signals.canonn.tech/?system=Testholm');

  // The same header, opened over a map instead.
  await openOrrery(page);
  for (const id of ['orr-signals', 'orr-link', 'orr-tools']) {
    await expect(page.locator('.orr-top #' + id), id).toBeVisible();
  }
  // And the two that are genuinely different swap over.
  await expect(page.locator('#orr-back')).toBeVisible();
  await expect(page.locator('#orr-find')).toBeHidden();
});

/* Dragging the axis taller used to give a taller version of exactly the same
   thing, which is not more detail — it is more empty band. Past the height a
   row of names fits in, it names what is on it. */
test('the distance axis gains detail when it is given room', async ({ page }) => {
  const many = JSON.parse(JSON.stringify(SYSTEM));
  many.bodies[1].stations = [{ name: 'Walz Depot', type: 'Outpost', distanceToArrival: 480 }];
  await stubDataHosts(page);
  await stubApi(page, many);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row[data-id]')).toHaveCount(3, { timeout: 60_000 });

  // Compact: an axis, and nothing named on it.
  const spine = page.locator('#orr-spine');
  await expect(page.locator('.orr-sp-ax .pip')).toHaveCount(3);
  await expect(page.locator('.orr-sp-de')).toHaveCount(0);
  const short = (await spine.boundingBox()).height;

  await page.locator('#orr-sp-more').click();
  const tall = (await spine.boundingBox()).height;
  expect(tall).toBeGreaterThan(short + 20);
  // A readable handful of lanes, not however many it takes to fit everything.
  expect(tall).toBeLessThan(200);

  /* Every body and every station, against the distance it actually sits at —
     and packed into lanes, so two things at nearly the same distance are two
     readable names rather than one on top of the other. */
  const labels = page.locator('.orr-sp-de .lb');
  await expect(labels).toHaveCount(4);
  await expect(page.locator('.orr-sp-de .lb.port')).toHaveText('Walz Depot');
  const boxes = await labels.evaluateAll((els) =>
    els.map((e) => e.getBoundingClientRect()));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const over = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      expect(over, 'labels ' + i + ' and ' + j + ' overlap').toBe(false);
    }
  }

  // A name on the axis picks the body, the same as its pip does.
  await page.locator('.orr-sp-de .lb', { hasText: '1 a' }).click();
  expect(await page.evaluate(() => window.Orrery.state().selected)).toBe('Testholm 1 a');
  // And a station on it opens the station.
  await page.locator('.orr-sp-de .lb.port').click();
  await expect(page.locator('#orr-modal')).toBeVisible();
  await page.keyboard.press('Escape');

  // Back to the axis alone, and it is remembered as a preference.
  await page.locator('#orr-sp-more').click();
  await expect(page.locator('.orr-sp-de')).toHaveCount(0);
  expect((await spine.boundingBox()).height).toBeCloseTo(short, 0);
});

/* The axis used to start at a fixed ten light-seconds however far out the
   system actually began, so Merope — nearest body fourteen hundred Ls,
   furthest five thousand — was a clot against the right-hand end with two
   thirds of the width empty. */
test('the axis spans the system it is drawing', async ({ page }) => {
  const far = JSON.parse(JSON.stringify(SYSTEM));
  far.bodies[1].distanceToArrival = 1400;
  far.bodies[2].distanceToArrival = 5000;
  await stubDataHosts(page);
  await stubApi(page, far);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row[data-id]')).toHaveCount(3, { timeout: 60_000 });

  const ax = await page.locator('.orr-sp-ax').boundingBox();
  const pip = async (id) => {
    const b = await page.locator('.orr-sp-ax .pip[data-id="' + id + '"]').boundingBox();
    return (b.x + b.width / 2 - ax.x) / ax.width;
  };
  // The arrival star is zero light-seconds and has no place on a log scale,
  // so it keeps the far left and the rest of the width is the actual range.
  expect(await pip(0)).toBeLessThan(0.08);
  // The nearest body starts the scale and the furthest ends it.
  expect(await pip(1)).toBeLessThan(0.12);
  expect(await pip(2)).toBeGreaterThan(0.95);
});

/* Sol puts a hundred and three things on this axis, and packing all of them
   took thirty lanes of small text — which is not detail, it is noise. So the
   lanes are however many the reader has given it room for, filled in the
   order a person is looking for them: the star, then what orbits it, then
   moons, then stations. What does not fit keeps its pip and loses its name,
   and the axis says how many it is holding back. */
test('the axis names what matters first, and says what it is holding back',
  async ({ page }) => {
  const crowd = JSON.parse(JSON.stringify(SYSTEM));
  /* Twenty moons of Testholm 1, all at nearly the same distance, so nothing
     but the lane cap can decide what gets named. */
  for (let i = 0; i < 20; i++) {
    crowd.bodies.push({
      bodyId: 100 + i, type: 'Planet', name: 'Testholm 1 moon ' + i,
      subType: 'Rocky body', parents: [{ Planet: 1 }, { Star: 0 }], radius: 900,
      /* Spread in their orbits so every one of them is drawn and gets a pip;
         crowded in arrival distance, which is the axis this is about, so
         nothing but the lane cap can decide which of them gets named. */
      semiMajorAxis: 0.002 + i * 0.0009, orbitalPeriod: 20 + i,
      distanceToArrival: 500 + i * 0.4
    });
  }
  /* And something a long way out, so the axis spans decades and the twenty
     of them really are packed into a sliver of it. Without this they simply
     spread across the width and there is nothing to ration. */
  crowd.bodies.push({
    bodyId: 90, type: 'Planet', name: 'Testholm 9', subType: 'Icy body',
    parents: [{ Star: 0 }], radius: 2000, semiMajorAxis: 400,
    orbitalPeriod: 2920000, distanceToArrival: 200000
  });
  await stubDataHosts(page);
  await stubApi(page, crowd);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row[data-id]')).toHaveCount(24, { timeout: 60_000 });

  await page.locator('#orr-sp-more').click();
  const spine = page.locator('#orr-spine');
  const opened = (await spine.boundingBox()).height;

  // Everything is still on the axis; only the names are rationed.
  await expect(page.locator('.orr-sp-ax .pip')).toHaveCount(24);
  const named = await page.locator('.orr-sp-de .lb').count();
  expect(named).toBeGreaterThan(2);
  expect(named).toBeLessThan(24);
  await expect(page.locator('.orr-sp-de .more')).toContainText(String(24 - named));

  /* The star and the planet are what a reader is looking for, so they are
     named before any of the twenty near-identical moons crowding them out. */
  await expect(page.locator('.orr-sp-de .lb', { hasText: /^Testholm$/ })).toHaveCount(1);
  await expect(page.locator('.orr-sp-de .lb', { hasText: /^1$/ })).toHaveCount(1);

  // And dragging it taller is what asks for more of them.
  await page.locator('#orr-grip-h').focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowDown');
  expect((await spine.boundingBox()).height).toBeGreaterThan(opened);
  expect(await page.locator('.orr-sp-de .lb').count()).toBeGreaterThan(named);
});

/* The dump's system-level list is the stations it does not attach to a body,
   and it gives no body reference at all — so they all hung off the primary
   star, which is not where stations are. A station and the body it orbits are
   the same distance from the arrival star to within a light-second or two,
   and that is the only join the data offers.

   The numbers below are Sol's and Merope's, and they are the two cases that
   decide how the match has to work. */
test('a station the dump does not place is put where it orbits',
  async ({ page }) => {
  const sys = JSON.parse(JSON.stringify(SYSTEM));
  // A gas giant and one of its moons, at Jupiter's and Io's real scale.
  sys.bodies.push(
    { bodyId: 5, type: 'Planet', name: 'Testholm 5', subType: 'Class I gas giant',
      parents: [{ Star: 0 }], radius: 69911, semiMajorAxis: 5.2,
      orbitalPeriod: 4331, distanceToArrival: 2618.5 },
    { bodyId: 6, type: 'Planet', name: 'Testholm 5 a', subType: 'Rocky body',
      parents: [{ Planet: 5 }, { Star: 0 }], radius: 1821, semiMajorAxis: 0.0028,
      orbitalPeriod: 1.77, distanceToArrival: 2618.76 });
  sys.stations = [
    /* Columbus: 1.26 Ls from the moon and 1.47 from the giant, and it orbits
       the giant. Nearest in light-seconds gets this wrong — 377,000 km is
       two hundred moon-radii and nowhere near it, while 441,000 km is six
       giant-radii and exactly where a station sits. */
    { name: 'Columbus', type: 'Ocellus Starport', distanceToArrival: 2620.02 },
    /* Reed's Rest: 3.8 Ls off a gas giant, which is seventeen of its radii
       and an ordinary orbit. Any absolute light-second guard throws this one
       back onto the star, which is why the test is in radii alone. */
    { name: "Reed's Rest", type: 'Orbis Starport', distanceToArrival: 2622.3 },
    // And a megaship far enough out that it belongs to nothing.
    { name: 'Warden JO76', type: 'Mega ship', distanceToArrival: 4200 }
  ];
  await stubDataHosts(page);
  await stubApi(page, sys);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row[data-id]')).toHaveCount(5, { timeout: 60_000 });

  const at = async (station) => {
    await page.locator('.orr-row.stn', { hasText: station }).click();
    return (await page.locator('#orr-m-sub').textContent()).replace(/^.*· at /, '');
  };
  expect(await at('Columbus')).toBe('5');
  await page.keyboard.press('Escape');
  expect(await at("Reed's Rest")).toBe('5');
  await page.keyboard.press('Escape');
  // Nothing is close enough in its own radii, so it stays where the dump put it.
  expect(await at('Warden JO76')).toBe('Testholm');
  await page.keyboard.press('Escape');

  /* It is worked out, not read, so it says so — the difference between a fact
     and a guess wearing a fact's clothes. */
  await expect(page.locator('.orr-row.stn', { hasText: 'Columbus' }))
    .toHaveAttribute('title', /placed at 5 from its arrival distance/);
});

/* Everything above is checked at a desk. This is the phone, where the answers
   are different and where five separate things were broken for months without
   a single test noticing — because every one of them was a matter of where an
   element ended up rather than whether a class had been set. */
test('a phone gets a whole orrery', async ({ page }) => {
  await stubDataHosts(page);
  const withPorts = JSON.parse(JSON.stringify(SYSTEM));
  withPorts.bodies[1].stations = [{ name: 'Nearer Dock', type: 'Outpost',
    distanceToArrival: 505, landingPads: { medium: 2 } }];
  await stubApi(page, withPorts);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-facts .orr-f-h')).toBeVisible({ timeout: 60_000 });

  /* The name of the system is what the page is about. It was flex:1 among
     five flex:none buttons — the only thing that could give — and gave until
     it was three pixels wide. */
  const name = await page.locator('#orr-name').boundingBox();
  expect(name.width).toBeGreaterThan(20);
  await expect(page.locator('#orr-name')).toHaveText('Testholm');

  /* The strip is one row that scrolls, not three that wrap over the model,
     and not a row with half of itself past the edge and no way to know. */
  const hud = await page.locator('#orr-hud').boundingBox();
  expect(hud.height).toBeLessThan(52);
  const reach = await page.locator('#orr-hud').evaluate((e) => ({
    scroll: e.scrollWidth, client: e.clientWidth,
    scrollable: getComputedStyle(e).overflowX
  }));
  if (reach.scroll > reach.client) expect(reach.scrollable).toBe('auto');

  /* The list is where stations live and nowhere else, so a phone without it
     is a phone with the whole station feature missing. */
  await expect(page.locator('#orr-tabs')).toBeVisible();
  await expect(page.locator('#orr-left')).toBeHidden();
  await page.locator('#orr-tab-list').click();
  await expect(page.locator('#orr-left')).toBeVisible();
  await expect(page.locator('.orr-row.stn', { hasText: 'Nearer Dock' })).toBeVisible();
  const list = await page.locator('#orr-left').boundingBox();
  expect(list.width).toBeGreaterThan(370);

  // Choosing a body means you want to read about it, so the sheet follows.
  await page.locator('.orr-row[data-id="1"]').click();
  await expect(page.locator('#orr-right')).toBeVisible();
  await expect(page.locator('#orr-left')).toBeHidden();
  await expect(page.locator('.orr-facts')).toContainText('Testholm 1');

  /* The two links about the system fold into the menu rather than crowding
     the name out of the header. */
  await expect(page.locator('#orr-signals')).toBeHidden();
  await page.locator('#orr-tools').click();
  await expect(page.locator('#orr-menu a[href*="signals.canonn.tech/?system="]'))
    .toBeVisible();
  await expect(page.locator('#orr-menu [data-act="copy"]')).toBeVisible();
});

/* Held sideways a phone is short and wide. Stacking is the wrong answer to
   wide — it was leaving ninety pixels of model under a full-width sheet — so
   the side-by-side layout comes back and the height is what gives. */
test('a phone held sideways still has a model in it', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page);
  await page.setViewportSize({ width: 812, height: 375 });
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-facts .orr-f-h')).toBeVisible({ timeout: 60_000 });

  const stage = await page.locator('.orr-stage').boundingBox();
  expect(stage.height).toBeGreaterThan(200);
  expect(stage.width).toBeGreaterThan(380);
  // Both rails, either side, and no tabs to switch between them.
  await expect(page.locator('#orr-left')).toBeVisible();
  await expect(page.locator('#orr-right')).toBeVisible();
  await expect(page.locator('#orr-tabs')).toBeHidden();
  // Neither of them eating the room a dragged desktop width would have taken.
  expect((await page.locator('#orr-left').boundingBox()).width).toBeLessThan(200);
});

/* Three things that were costing real resources and were invisible to every
   test here, because each of them was about what the machine does rather than
   about what the DOM says. All three are measured through the GL context. */

test('rebuilding the scene does not allocate more of the GPU', async ({ page }) => {
  const rings = JSON.parse(JSON.stringify(SYSTEM));
  rings.bodies[1].rings = [
    { name: 'Testholm 1 A Ring', type: 'Icy', innerRadius: 8e6, outerRadius: 1.4e7, mass: 1e12 },
    { name: 'Testholm 1 B Ring', type: 'Rocky', innerRadius: 1.5e7, outerRadius: 2e7, mass: 3e12 }
  ];
  await stubDataHosts(page);
  await stubApi(page, rings);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row[data-id]')).toHaveCount(3, { timeout: 60_000 });
  await page.waitForTimeout(700);

  /* Toggling the scale rebuilds every mesh in the scene. Ring bands were made
     fresh each time and a body's face is cached, and neither was ever freed —
     three disposes a material's own resources, never its textures. */
  const grew = await page.evaluate(async () => {
    const c = document.querySelector('#orr-canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    let made = 0;
    const real = gl.createTexture.bind(gl);
    gl.createTexture = function () { made++; return real(); };
    const t = document.querySelector('#orr-true'), s = document.querySelector('#orr-spread');
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    // One cycle to settle any first-use upload, then five that must cost nothing.
    t.click(); await wait(350); s.click(); await wait(350);
    const settled = made;
    for (let i = 0; i < 5; i++) { t.click(); await wait(300); s.click(); await wait(300); }
    return made - settled;
  });
  expect(grew, 'GPU textures allocated by five scene rebuilds').toBe(0);
});

test('a paused orrery stops drawing', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row[data-id]')).toHaveCount(3, { timeout: 60_000 });
  await page.waitForTimeout(700);

  /* Without the bloom pipeline, which is about what the frame is made of and
     not about how often one is made — and which under software rendering is
     slow enough to drag the running case down to the idle rate and hide the
     very difference being measured. */
  await page.locator('#orr-light').click();
  await page.locator('#orr-bloom').fill('0');
  await page.locator('#orr-bloom').dispatchEvent('input');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  const calls = await page.evaluate(async () => {
    const c = document.querySelector('#orr-canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    let n = 0;
    const real = gl.drawElements.bind(gl);
    gl.drawElements = function () { n++; return real.apply(gl, arguments); };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const play = document.querySelector('#orr-play');
    play.click();                                   // pause
    await wait(600);                                // let the camera settle
    n = 0;
    await wait(1200);
    const paused = n;
    n = 0;
    play.click();                                   // and run again
    await wait(1200);
    return { paused, playing: n };
  });

  /* It was rendering an identical frame sixty times a second for as long as
     the page was open. Not none, because a star's surface goes on boiling
     when the orbits are stopped — but a tenth of the rate, which is what a
     slow boil needs and a sixth of the work. */
  expect(calls.paused, 'draw calls while paused and still').toBeGreaterThan(0);
  expect(calls.paused).toBeLessThan(calls.playing / 3);
  expect(calls.playing, 'draw calls while running').toBeGreaterThan(100);
});

test('turning the view is not the same as picking something', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row[data-id]')).toHaveCount(3, { timeout: 60_000 });
  await page.waitForTimeout(700);

  const at = () => page.evaluate(() => window.Orrery.state().selected);

  /* Where a body actually is on screen. A label is translated to the body's
     projected point and then offset by its own margin, so the transform is
     the number wanted and the bounding rect is not. */
  const where = () => page.evaluate(() => {
    const host = document.querySelector('.orr-labels').getBoundingClientRect();
    const l = [...document.querySelectorAll('.orr-label')]
      .find((e) => e.textContent.trim() === '1' && !e.classList.contains('off'));
    if (!l) throw new Error('Testholm 1 is not on screen to aim at');
    const m = new DOMMatrix(getComputedStyle(l).transform);
    return { x: Math.round(host.x + m.m41), y: Math.round(host.y + m.m42) };
  });

  /* Framing the system puts every body in shot, which is what both gestures
     below need to aim at. Done from the bar rather than the canvas, so it is
     not the thing under test. */
  const aim = async () => {
    await page.locator('#orr-reset').click();
    await expect.poll(at, { timeout: 10_000 }).toBe('Testholm');
    await page.waitForTimeout(500);
    return where();
  };

  // A tap picks, wobble and all.
  let p = await aim();
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 2, p.y + 1);
  await page.mouse.up();
  await expect.poll(at, { timeout: 5000 }).toBe('Testholm 1');

  /* A drag does not. Picking ran on pointerdown, so starting a rotate gesture
     near a planet selected it and flew the camera there — in a busy inner
     system that made the view hard to turn at all. */
  p = await aim();
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(p.x + i * 12, p.y + i * 4);
  await page.mouse.up();
  await page.waitForTimeout(400);
  expect(await at(), 'a drag from a body must not select it').toBe('Testholm');
});

/* "Frame the whole system" did not frame the whole system.

   It sat at a fixed 0.94 of the outermost orbit, which fits nothing: at a 48°
   vertical field that distance shows about 63 units across a system 100 units
   in radius. On Sol it read as a reasonable close-up, because there are forty
   bodies and most of them are inside that — so nobody noticed. On a system
   with one planet it showed the star and empty space. */
test('framing the system puts the system in the frame', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page);

  // Widescreen is the case the arithmetic was missing, and portrait the one
  // where the tilt of the orbit plane decides it instead.
  for (const [w, h] of [[1600, 800], [1100, 900], [820, 1100]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.orr-row[data-id]')).toHaveCount(3, { timeout: 60_000 });
    await page.waitForTimeout(600);

    const onScreen = async (label) => page.evaluate((want) => {
      const host = document.querySelector('.orr-labels').getBoundingClientRect();
      const l = [...document.querySelectorAll('.orr-label')]
        .find((e) => e.textContent.trim() === want);
      if (!l || l.classList.contains('off')) return null;
      const m = new DOMMatrix(getComputedStyle(l).transform);
      return { x: host.x + m.m41, y: host.y + m.m42,
               l: host.x, r: host.right, t: host.y, b: host.bottom };
    }, label);

    for (const pass of ['on opening', 'after framing']) {
      if (pass === 'after framing') {
        await page.locator('#orr-reset').click();
        await page.waitForTimeout(500);
      }
      const at = `${w}x${h} ${pass}`;
      const p = await onScreen('1');
      expect(p, `the planet is drawn at ${at}`).not.toBeNull();
      // Inside the canvas, not merely inside the label's 6% of overscan.
      expect(p.x, `planet not off the left at ${at}`).toBeGreaterThan(p.l);
      expect(p.x, `planet not off the right at ${at}`).toBeLessThan(p.r);
      expect(p.y, `planet not off the top at ${at}`).toBeGreaterThan(p.t);
      expect(p.y, `planet not off the bottom at ${at}`).toBeLessThan(p.b);
    }
  }
});

/* Every navigation used replaceState, so no history entry was ever created —
   while a popstate listener sat waiting for entries that could not arrive.
   Back out of the fifth system you looked at and you left the orrery. */
test('back and forward walk the systems you looked at', async ({ page }) => {
  await stubDataHosts(page);
  const other = { ...SYSTEM, name: 'Otherholm', id64: 77 };
  await page.route('**/us-central1-canonn-api-236217.cloudfunctions.net/**', (route) => {
    const url = route.request().url();
    const json = (b) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.includes('/typeahead')) {
      const q = decodeURIComponent(url.split('q=')[1] || '');
      const pick = /^o/i.test(q) ? other : SYSTEM;
      return json({ min_max: [{ id64: pick.id64, name: pick.name, x: 0, y: 0, z: 0 }] });
    }
    return json({ system: url.includes('id=77') ? other : SYSTEM });
  });

  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row[data-id]')).toHaveCount(3, { timeout: 60_000 });

  await page.locator('#orr-q').fill('Otherholm');
  await expect(page.locator('.orr-res .orr-r').first()).toBeVisible({ timeout: 20_000 });
  await page.locator('.orr-res .orr-r').first().click();
  await expect(page.locator('#orr-name')).toHaveText('Otherholm', { timeout: 30_000 });

  /* Straight back, without waiting for anything to settle. A dump takes a
     moment to arrive and until it does the model still holds the last system,
     so a guard that asks the model "are we already here?" gets the wrong
     answer and decides nothing needs doing — leaving the header naming a
     system the view is not showing. */
  await page.goBack();
  await expect(page.locator('#orr-name')).toHaveText('Testholm', { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => window.Orrery.state().system),
    { timeout: 30_000 }).toBe('Testholm');

  await page.goForward();
  await expect(page.locator('#orr-name')).toHaveText('Otherholm', { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => window.Orrery.state().system),
    { timeout: 30_000 }).toBe('Otherholm');
});

/* A link to a system was the only link there was, so "look at Europa" was a
   link to Sol and a sentence telling somebody what to click. */
test('a link can name the body, not just the system', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page);

  await page.goto('/orrery.html?system=Testholm&body=1%20a', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row[data-id]')).toHaveCount(3, { timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.Orrery.state().selected),
    { timeout: 20_000 }).toBe('Testholm 1 a');

  // Picking another body rewrites it, so the address bar is always the view.
  await page.locator('.orr-row[data-id="1"]').click();
  await expect.poll(() => new URL(page.url()).searchParams.get('body')).toBe('1');
  // And the star is the system, so it drops out rather than reading as a body.
  await page.locator('.orr-row[data-id="0"]').click();
  await expect.poll(() => new URL(page.url()).searchParams.get('body')).toBe(null);

  /* Choosing bodies is not navigation — walking down a list of moons must not
     be forty presses of Back to get out of. */
  const before = await page.evaluate(() => history.length);
  for (const id of [1, 2, 0, 1, 2]) await page.locator(`.orr-row[data-id="${id}"]`).click();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => history.length),
    'picking bodies does not fill the history').toBe(before);
});

/* A dialog that takes focus and then lets Tab walk out of it is not modal,
   and one that drops focus on close leaves a keyboard reader at the top of
   the document hunting for the row they were on. */
test('the station dialog keeps the keyboard inside it', async ({ page }) => {
  const withPort = JSON.parse(JSON.stringify(SYSTEM));
  withPort.bodies[1].stations = [{ name: 'Walz Depot', type: 'Outpost',
    distanceToArrival: 166, id: 3534389760, services: ['Dock', 'Market'] }];
  await stubDataHosts(page);
  await stubApi(page, withPort);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row[data-id]')).toHaveCount(3, { timeout: 60_000 });

  const row = page.locator('.orr-row.stn', { hasText: 'Walz Depot' });
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#orr-modal')).toBeVisible();

  const inside = () => page.evaluate(() =>
    !!document.querySelector('.orr-m-box').contains(document.activeElement));
  expect(await inside(), 'focus starts in the dialog').toBe(true);
  // All the way round, forwards and back, without ever leaving.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await inside(), `still inside after ${i + 1} tabs`).toBe(true);
  }
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Shift+Tab');
    expect(await inside(), 'still inside going backwards').toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(page.locator('#orr-modal')).toBeHidden();
  // And back on the row it was opened from.
  expect(await page.evaluate(() =>
    document.activeElement.textContent.includes('Walz Depot'))).toBe(true);
});

/* Every dump carries a block about the system itself — who lives there, who
   runs it, which power holds it and how hard, what the minor factions are
   doing, how much of it anybody has scanned — and none of it was shown
   anywhere. Selecting the star showed you the star; there was no view of the
   system in a program called an orrery. The numbers below are Sol's. */
test('the star is where you read the system', async ({ page }) => {
  const sys = JSON.parse(JSON.stringify(SYSTEM));
  Object.assign(sys, {
    population: 18320926115, security: 'High', allegiance: 'Federation',
    government: 'Democracy', primaryEconomy: 'Refinery', secondaryEconomy: 'Service',
    region: { region: 18, name: 'Inner Orion Spur' },
    bodyCount: 5, date: '2026-09-05 02:43:00+00',
    controllingPower: 'Jerome Archer', powerState: 'Stronghold',
    powerStateControlProgress: 0.542413,
    powerStateReinforcement: 19898, powerStateUndermining: 92285,
    powers: ['Aisling Duval', 'Jerome Archer', 'Zemina Torval'],
    controllingFaction: { name: 'Mother Gaia', activeStates: [{ state: 'Expansion' }] },
    factions: [
      { name: 'Mother Gaia', influence: 0.42 },
      { name: 'Sol Workers\u2019 Party', influence: 0.31 },
      { name: 'Aegis Core', influence: 0.27 }
    ]
  });
  await stubDataHosts(page);
  await stubApi(page, sys);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row[data-id]')).toHaveCount(3, { timeout: 60_000 });

  const facts = page.locator('.orr-facts');
  await expect(facts).toContainText('18.32 bn');
  await expect(facts).toContainText('Inner Orion Spur');
  await expect(facts).toContainText('Refinery · Service');

  /* How much of it anybody has been to. bodyCount is the game's own count and
     leaves out barycentres, so this does too — a barycentre is a place two
     things orbit, not a place. */
  await expect(facts.locator('.orr-sec', { hasText: 'System' }))
    .toContainText('3 of 5');

  const pp = facts.locator('.orr-sec', { hasText: 'Powerplay' });
  await expect(pp.locator('dd')).toHaveText(['Jerome Archer', 'Stronghold', '54%']);
  // The number people argue about, drawn as the tug of war it is.
  await expect(pp.locator('.orr-tug i b')).toHaveText('19,898');
  await expect(pp.locator('.orr-tug u b')).toHaveText('92,285');
  await expect(pp).toContainText('Also contesting: Aisling Duval, Zemina Torval');

  const fac = facts.locator('.orr-sec', { hasText: '3 factions' });
  await expect(fac).toContainText('Mother Gaia');
  await expect(fac).toContainText('Expansion');
  // Influence arrives as a fraction; a reader thinks in percent, biggest first.
  await expect(fac.locator('.orr-bar .k')).toHaveText(
    ['Mother Gaia', 'Sol Workers\u2019 Party', 'Aegis Core']);
  await expect(fac.locator('.orr-bar .v').first()).toHaveText('42%');

  // And none of it turns up on a body that is not the star.
  await page.locator('.orr-row[data-id="1"]').click();
  await expect(page.locator('.orr-facts')).not.toContainText('Powerplay');
  await expect(page.locator('.orr-facts')).not.toContainText('18.32 bn');
});

/* Five signal colours, two kinds of station square and a smaller pip for a
   moon — all invented here, and until now learnable only by resting on things
   one at a time and waiting for a tooltip. */
test('the marks in the list have a key', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row[data-id]')).toHaveCount(3, { timeout: 60_000 });

  await expect(page.locator('#orr-key-p')).toBeHidden();
  await page.locator('#orr-key').click();
  const key = page.locator('#orr-key-p');
  await expect(key).toBeVisible();
  for (const kind of ['bio', 'geo', 'gua', 'thg', 'hum']) {
    await expect(key.locator('.orr-key-r i.sg.' + kind), kind).toBeVisible();
  }
  await expect(key).toContainText('Guardian signals');
  await expect(key).toContainText('On the ground');

  // It opens against its button, rather than wherever the stylesheet lands it.
  const btn = await page.locator('#orr-key').boundingBox();
  const box = await key.boundingBox();
  expect(Math.abs(box.y - (btn.y + btn.height))).toBeLessThan(20);

  await page.keyboard.press('Escape');
  await expect(key).toBeHidden();
});

/* Thirty-nine of Sol's forty bodies carry an atmosphereType and ten a full
   composition by gas, and none of it was drawn — every world was a painted
   ball with a knife-edge terminator. */
test('a world with air is drawn with air', async ({ page }) => {
  const sys = JSON.parse(JSON.stringify(SYSTEM));
  sys.bodies[1].atmosphereType = 'Hot thick Carbon dioxide';
  sys.bodies[1].atmosphereComposition = { 'Carbon dioxide': 96.5, Nitrogen: 3.5 };
  sys.bodies[1].surfacePressure = 93.19;
  sys.bodies[2].atmosphereType = 'No atmosphere';
  await stubDataHosts(page);
  await stubApi(page, sys);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row[data-id]')).toHaveCount(3, { timeout: 60_000 });
  await page.waitForTimeout(700);

  const air = await page.evaluate(() => window.Orrery.air());
  const withAir = air.filter((a) => a.air);
  expect(withAir.map((a) => a.name)).toEqual(['Testholm 1']);
  // A shell standing off the surface, not a coat of paint on it.
  expect(withAir[0].swell).toBeGreaterThan(1.01);
  expect(withAir[0].swell).toBeLessThan(1.1);
  /* Carbon dioxide is warm, not the pale blue of a nitrogen sky — the colour
     comes off the biggest share of the composition. */
  expect(withAir[0].tint.r).toBeGreaterThan(withAir[0].tint.b);
  // And it never takes a click away from the body it belongs to.
  expect(withAir[0].clickable).toBe(false);

  // A star makes its own light and is not wearing air.
  expect(air.filter((a) => a.name === 'Testholm')[0].air).toBe(false);
});

/* Four small things that were each somebody's bad afternoon. */

test('a system nobody has scanned is not a dead end', async ({ page }) => {
  await stubDataHosts(page);
  await page.route(API, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ min_max: [] }) }));
  await page.goto('/orrery.html?system=Nowhere%20At%20All', { waitUntil: 'domcontentloaded' });

  const msg = page.locator('#orr-msg');
  await expect(msg).toHaveClass(/bad/, { timeout: 30_000 });
  await expect(msg).toContainText('Nowhere At All');
  // The tool that knows about every system, and this one by name.
  await expect(msg.locator('a[href*="signals.canonn.tech"]'))
    .toHaveAttribute('href', /system=Nowhere%20At%20All/);

  // And a way back to looking, rather than a sentence and a blank screen.
  await page.locator('#orr-msg [data-act="find"]').click();
  await expect(page.locator('.orr-empty')).toBeVisible();
  await expect(page.locator('#orr-q')).toBeFocused();
});

test('asking for less movement gets less movement', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row[data-id]')).toHaveCount(3, { timeout: 60_000 });

  // Not running by itself. It still runs the moment anybody presses play.
  await expect(page.locator('#orr-play')).toHaveClass(/paused/);
  const date = await page.locator('#orr-date').textContent();
  await page.waitForTimeout(900);
  expect(await page.locator('#orr-date').textContent()).toBe(date);

  await page.locator('#orr-play').click();
  await expect.poll(() => page.locator('#orr-date').textContent(), { timeout: 10_000 })
    .not.toBe(date);
});

test('the marks on the distance axis can be hit', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row[data-id]')).toHaveCount(3, { timeout: 60_000 });

  /* A moon's pip is five pixels of dot. Forty of them at the accessible
     minimum would be a solid bar, so the dot stays small and carries an
     invisible target around it. */
  const reach = await page.locator('.orr-sp-ax .pip.moon').first().evaluate((el) => {
    const cs = getComputedStyle(el, '::after');
    return { w: parseFloat(cs.width), h: parseFloat(cs.height) };
  });
  expect(reach.w).toBeGreaterThanOrEqual(24);
  expect(reach.h).toBeGreaterThanOrEqual(24);

  // And it is the moon that gets picked, not merely something.
  const pip = page.locator('.orr-sp-ax .pip[data-id="2"]');
  const b = await pip.boundingBox();
  await page.mouse.click(b.x + b.width / 2 + 8, b.y + b.height / 2);
  await expect.poll(() => page.evaluate(() => window.Orrery.state().selected),
    { timeout: 10_000 }).toBe('Testholm 1 a');
});

test('nothing is set smaller than it can be read at', async () => {
  const css = readFileSync('Source/css/orrery.css', 'utf8');
  const sizes = [...css.matchAll(/font-size:([0-9.]+)px/g)].map((m) => parseFloat(m[1]));
  expect(sizes.length).toBeGreaterThan(30);
  /* Twenty-five rules sat below ten pixels and two of them at eight, which
     reads as density on a big monitor and as nothing at all on a laptop. Nine
     is the floor, and what is left there is uppercase micro-labelling with
     letter-spacing, which reads a size larger than it is set. */
  expect(Math.min(...sizes), 'the smallest type in the stylesheet').toBeGreaterThanOrEqual(9);
});

/* The search knew every system Canonn holds and nothing about the four you
   had actually opened, which is the list a person wants when they come back
   to a tab they left open. */
test('the search remembers where you have been', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row[data-id]')).toHaveCount(3, { timeout: 60_000 });

  // An empty box offers where you have been rather than nothing at all.
  await page.locator('#orr-q').click();
  const res = page.locator('.orr-res');
  await expect(res).toBeVisible();
  await expect(res.locator('.orr-r.was .nm')).toHaveText(['Testholm']);
  // A remembered system was stored, not searched for, so it has no distance.
  await expect(res.locator('.orr-r.was .ly')).toHaveText(['recent']);

  /* And typing narrows them straight away rather than leaving the whole list
     under the cursor while Canonn is asked — the first row you can click has
     to be a row you meant. */
  await page.locator('#orr-q').fill('Zz');
  await expect(res.locator('.orr-r.was')).toHaveCount(0);

  // The empty page offers them too, ahead of the five this file picked.
  await page.goto('/orrery.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-empty')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#orr-seed-h')).toHaveText('Where you have been');
  await expect(page.locator('#orr-seeds button')).toHaveText(['Testholm']);
  await page.locator('#orr-seeds button').first().click();
  await expect(page.locator('#orr-name')).toHaveText('Testholm', { timeout: 30_000 });
});

/* One light, at the star, and geometry the dump already gives — so a ring's
   shadow across its planet, the planet's across its rings, and a moon going
   dark behind its planet are each a line of arithmetic on the ray back to the
   star. The first two are checked as wiring; the third is checked in pixels,
   because "it is darker" is a claim about what a reader sees. */
test('a moon behind its planet is in the dark', async ({ page }) => {
  await stubDataHosts(page);
  const at = async (meanAnomaly) => {
    const sys = JSON.parse(JSON.stringify(SYSTEM));
    /* The planet a quarter-turn round its orbit, so the camera — which sits
       off the +Z side of whatever it looks at — is looking at the moon's lit
       face rather than its night side; with the planet at M=0 both readings
       were a thin crescent and the rest was night. The moon in the planet's
       own plane: at the planet's own anomaly it sits beyond the planet on the
       line from the star, dead in its shadow; a half-turn on, it sits between
       them in full light. Nothing else moves between the two. */
    sys.bodies[1].meanAnomaly = 270;
    Object.assign(sys.bodies[2], { orbitalInclination: 0, argOfPeriapsis: 0,
      ascendingNode: 0, orbitalEccentricity: 0, meanAnomaly, atmosphereType: 'No atmosphere' });
    await stubApi(page, sys);
    // Paused from the start, so the clock does not move anything.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/orrery.html?system=Testholm&body=1%20a', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.orr-row[data-id]')).toHaveCount(3, { timeout: 60_000 });
    await expect.poll(() => page.evaluate(() => window.Orrery.state().selected),
      { timeout: 20_000 }).toBe('Testholm 1 a');
    await page.waitForTimeout(900);
    // The moon's face, read straight off the frame.
    return page.evaluate(() => {
      const host = document.querySelector('.orr-labels').getBoundingClientRect();
      const l = [...document.querySelectorAll('.orr-label')].find((e) => e.classList.contains('on'));
      const m = new DOMMatrix(getComputedStyle(l).transform);
      const c = document.querySelector('#orr-canvas').getBoundingClientRect();
      const x = Math.round(host.x + m.m41 - c.x), y = Math.round(host.y + m.m42 - c.y);
      const r = Math.max(3, Math.round(window.Orrery.state().selectedRadius
        / window.Orrery.state().toSelected * c.height * 0.9));
      const img = window.Orrery.pixels(x - r, y - r, r * 2, r * 2);
      let sum = 0, n = 0;
      for (let i = 0; i < img.data.length; i += 4) {
        // Only the disc, not the sky around it.
        const px = (i / 4) % img.w, py = Math.floor(i / 4 / img.w);
        if (Math.hypot(px - r, py - r) > r * 0.8) continue;
        sum += (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3; n++;
      }
      return sum / n;
    });
  };

  const lit = await at(90);
  const dark = await at(270);
  expect(lit, 'a moon in the light is bright').toBeGreaterThan(25);
  // The star's light is gone; what is left is the sky, which is not nothing.
  expect(dark, 'a moon behind its planet is dark — lit ' + lit.toFixed(1)).toBeLessThan(lit * 0.4);
  expect(dark).toBeGreaterThan(0.5);
});

test('rings and planets shadow each other, and dusk is a band', async ({ page }) => {
  const sys = JSON.parse(JSON.stringify(SYSTEM));
  sys.bodies[1].rings = [
    { name: 'Testholm 1 A Ring', type: 'Icy', innerRadius: 8e6, outerRadius: 1.4e7, mass: 1e13 }
  ];
  sys.bodies[1].atmosphereType = 'Thin Nitrogen';
  await stubDataHosts(page);
  await stubApi(page, sys);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row[data-id]')).toHaveCount(3, { timeout: 60_000 });

  const shade = await page.evaluate(() => window.Orrery.shade());
  const planet = shade.find((x) => x.name === 'Testholm 1');
  const moon = shade.find((x) => x.name === 'Testholm 1 a');

  // The planet knows its ring, edge to edge, in its own radii.
  expect(planet.ring).not.toBeNull();
  expect(planet.ring.inner).toBeGreaterThan(1);
  expect(planet.ring.outer).toBeGreaterThan(planet.ring.inner);
  expect(planet.ring.depth).toBeGreaterThan(0);
  // And its rings know it, for its shadow across them.
  expect(planet.ringsShadowedBy).toBe(true);
  // The moon knows what it can pass behind; the planet, orbiting a star, does not.
  expect(moon.behind).toBe('Testholm 1');
  expect(planet.behind).toBeNull();
  // A world with air is lit past ninety degrees; a bare one barely.
  expect(planet.wrap).toBeGreaterThan(0.2);
  expect(moon.wrap).toBeLessThan(0.1);
});

/* A parallel projection has no eye point, so a sky sphere shows one tiny cap
   of itself and 2D was drawn against nothing — which read as a bug rather
   than as a property of the projection. */
test('2D has a sky too', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page, { ...SYSTEM, coords: { x: 120, y: -30, z: 4200 } });
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row[data-id]')).toHaveCount(3, { timeout: 60_000 });
  await page.waitForTimeout(600);

  const sky = () => page.evaluate(() => window.Orrery.state().sky);
  expect((await sky()).flat).toBe(false);
  expect((await sky()).visible).toBe(true);

  await page.locator('#orr-2d').click();
  await page.waitForTimeout(600);
  // The same image the lens bends, laid flat; the point stars are directions
  // and have no meaning in a view with none.
  expect((await sky()).flat).toBe(true);
  expect((await sky()).visible).toBe(false);
  expect((await sky()).isBackdrop).toBe(true);

  // And it is actually there in the frame: a corner of the view, away from
  // the model, has structure in it rather than being black.
  const spread = await page.evaluate(() => {
    const img = window.Orrery.pixels(8, 8, 160, 100);
    let lo = 255, hi = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3;
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    return hi - lo;
  });
  expect(spread, 'the 2D backdrop has something in it').toBeGreaterThan(6);

  await page.locator('#orr-3d').click();
  await page.waitForTimeout(400);
  expect((await sky()).flat).toBe(false);
});

/* "Which station here has a large pad and a shipyard" is the question people
   actually ask, and every field it takes was already loaded. */
test('the filter finds a station by what it can do', async ({ page }) => {
  const sys = JSON.parse(JSON.stringify(SYSTEM));
  sys.bodies[1].stations = [
    { name: 'Big Dock', type: 'Orbis Starport', distanceToArrival: 500,
      landingPads: { large: 4, medium: 2, small: 2 }, services: ['Dock', 'Shipyard', 'Refuel'] },
    { name: 'Small Post', type: 'Outpost', distanceToArrival: 505,
      landingPads: { medium: 1 }, services: ['Dock', 'Refuel'] }
  ];
  await stubDataHosts(page);
  await stubApi(page, sys);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row.stn')).toHaveCount(2, { timeout: 60_000 });

  const hits = async (term) => {
    await page.locator('#orr-filter').fill(term);
    await page.waitForTimeout(150);
    return page.locator('.orr-row.stn .nm').allTextContents();
  };
  expect(await hits('shipyard')).toEqual(['Big Dock']);
  expect(await hits('large pad')).toEqual(['Big Dock']);
  expect(await hits('refuel')).toEqual(['Big Dock', 'Small Post']);
  expect(await hits('outfitting')).toEqual([]);
  await expect(page.locator('.orr-none')).toBeVisible();
});

/* An orrery invites "how far is that from that" and there was no way to ask.
   There is no mode: pick a body, then another, and the second says how far
   it is from the first — right now, since both are moving. */
test('the panel says how far this is from the last body picked', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });     // hold the clock
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row[data-id]')).toHaveCount(3, { timeout: 60_000 });

  // Nothing to measure from yet: the star was chosen, not picked after another.
  await expect(page.locator('.orr-facts')).not.toContainText('From ');

  await page.locator('.orr-row[data-id="1"]').click();
  await page.locator('.orr-row[data-id="2"]').click();
  const from = page.locator('.orr-sec', { hasText: 'From 1' });
  await expect(from).toBeVisible();
  /* The moon orbits at 0.0026 AU with an eccentricity of 0.05, so right now
     it is somewhere between 369,000 and 409,000 km away — and under a
     hundredth of an AU it is said in kilometres, which is how anyone would
     say it. Drawn-scale distances are a log in Spread and would have given
     nonsense; this is worked out on the real ellipse. */
  const km = parseInt((await from.locator('dd').first().textContent()).replace(/[^0-9]/g, ''), 10);
  expect(km).toBeGreaterThan(360_000);
  expect(km).toBeLessThan(420_000);
  await expect(from.locator('dd').nth(1)).toContainText(/1\.[23] s/);

  // And it chains: pick the star now and it measures from the moon.
  await page.locator('.orr-row[data-id="0"]').click();
  await expect(page.locator('.orr-sec', { hasText: 'From 1 a' }).locator('dd').first())
    .toContainText('AU');
});

/* A hundred and eight rows, each its own tab stop, announcing nothing about
   which level it was on — which is the whole point of the indent. */
test('the list is a tree you can walk with the arrows', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row[data-id]')).toHaveCount(3, { timeout: 60_000 });

  await expect(page.locator('#orr-list')).toHaveAttribute('role', 'tree');
  await expect(page.locator('.orr-row[role="treeitem"]')).toHaveCount(3);
  await expect(page.locator('.orr-row[data-id="2"]')).toHaveAttribute('aria-level', '3');
  // One tab stop for the lot.
  await expect(page.locator('.orr-row[tabindex="0"]')).toHaveCount(1);

  const focused = () => page.evaluate(() => document.activeElement.dataset.id);
  await page.locator('.orr-row[tabindex="0"]').focus();
  await page.keyboard.press('ArrowDown');
  expect(await focused()).toBe('1');
  await page.keyboard.press('End');
  expect(await focused()).toBe('2');
  // Moving focus does not fly the camera around; choosing does.
  expect(await page.evaluate(() => window.Orrery.state().selected)).toBe('Testholm');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.Orrery.state().selected)).toBe('Testholm 1 a');
  await expect(page.locator('.orr-row[data-id="2"]')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  expect(await focused()).toBe('0');

  /* And the model itself can be walked from anywhere, the way , and . run the
     clock from anywhere: ] is the next body, [ the one before. */
  await page.locator('#orr-canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(']');
  await expect.poll(() => page.evaluate(() => window.Orrery.state().selected)).toBe('Testholm');
  await page.keyboard.press(']');
  await expect.poll(() => page.evaluate(() => window.Orrery.state().selected)).toBe('Testholm 1');
  await page.keyboard.press('[');
  await expect.poll(() => page.evaluate(() => window.Orrery.state().selected)).toBe('Testholm');
});

/* People screenshot these to post, and the renderer is right here. */
test('the view can be saved as a picture', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page);
  await page.goto('/orrery.html?system=Testholm&body=1', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row[data-id]')).toHaveCount(3, { timeout: 60_000 });
  await page.waitForTimeout(600);

  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 20_000 }),
    page.locator('#orr-snap').click()
  ]);
  // Named for what is in it, and a PNG.
  expect(dl.suggestedFilename()).toBe('Testholm - 1.png');
  const path = await dl.path();
  expect(readFileSync(path).length).toBeGreaterThan(10_000);
});

/* At speed the bodies jump around their orbits with nothing showing the
   motion, which is what made the rate control hard to read. */
test('a moving body leaves a trail', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page);
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row[data-id]')).toHaveCount(3, { timeout: 60_000 });

  /* A sixth of an orbit, sampled on the body's own clock: at a day a second
     the moon — twenty-seven days round — collects a point every couple of
     hours of its time, and the planet, a year round, barely one. */
  // Polled, not timed: under software rendering the first seconds go on
  // baking the sky and compiling shaders, and a frame is not a fixed thing.
  const moonPts = () => page.evaluate(() =>
    window.Orrery.state().trails.find((t) => t.name === 'Testholm 1 a').points);
  await expect.poll(moonPts, { timeout: 20_000 }).toBeGreaterThan(8);
  const trails = await page.evaluate(() => window.Orrery.state().trails);
  const moon = trails.find((t) => t.name === 'Testholm 1 a');
  const planet = trails.find((t) => t.name === 'Testholm 1');
  expect(moon.points).toBeLessThanOrEqual(40);
  expect(planet.points).toBeLessThan(moon.points);
  // The star does not move and has no trail to leave.
  expect(trails.find((t) => t.name === 'Testholm')).toBeUndefined();

  // Now is a jump in the clock: a trail drawn across that jump would be a
  // line across the system to somewhere the body never went.
  await page.locator('#orr-now').click();
  await page.waitForTimeout(200);
  expect((await page.evaluate(() => window.Orrery.state().trails))
    .find((t) => t.name === 'Testholm 1 a').points).toBeLessThan(3);
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

  /* Framed on the hole itself rather than on the system. Opening a system
     frames the whole of it, which is right — and puts a hole with a shadow a
     few thousand kilometres across on about four pixels, which no photometry
     can say anything about. The claim under test is what a hole looks like
     when you go and look at one. */
  await page.locator('.orr-row[data-id="1"]').click();
  const wide = () => page.evaluate(() =>
    (window.Orrery.state().holes.filter((h) => h.name === 'Annihilator B')[0] || {})
      .screen.shadowPx || 0);
  await expect.poll(wide, { timeout: 20_000 }).toBeGreaterThan(10);

  /* And then back off until eight shadow radii — the span these bands are
     measured across, out past the lens and into ordinary sky — fits on the
     frame. Selecting a body puts it twelve of its own radii away, which is
     the right distance to look at one and too close to measure one. */
  const box = await page.locator('#orr-canvas').boundingBox();
  const room = Math.min(box.width, box.height) / 2 / 8;
  for (let i = 0; i < 30 && (await wide()) > room; i++) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(120);
  }
  expect(await wide(), 'a shadow that fits the measurement').toBeLessThan(room);
  await page.waitForTimeout(1200);

  const profile = await page.evaluate(() => {
    const at = window.Orrery.state().holes
      .filter((h) => h.name === 'Annihilator B')[0].screen;
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
    const out = {
      shadowPx: at.shadowPx,
      inside: band(0, 0.8),      // the shadow
      ring: band(1.0, 1.6),      // where the light piles up, at the shadow's edge
      mid: band(3.0, 4.2),       // still under the lens, bent only gently
      sky: band(5.5, 8)          // past the lens, the sky itself
    };
    // And the whole way out, in fifths of a shadow radius, for the fall-off.
    out.steps = [];
    for (let r = 1.0; r < 3.2; r += 0.2) out.steps.push(band(r, r + 0.2));
    return out;
  });

  const seen = ' — ' + JSON.stringify(profile);
  expect(profile.shadowPx, 'a shadow big enough to measure').toBeGreaterThan(4);
  expect(profile.inside, 'the shadow is black' + seen).toBeLessThan(1);
  expect(profile.ring, 'and light piles up just outside it' + seen)
    .toBeGreaterThan(profile.sky * 1.08);

  /* And falls away from there to the sky it started as, without climbing
     again on the way. This replaced an assertion that there is a darker band
     between the shadow and the ring: there was one, and it was real, but it
     was a fact about looking at the other hole in this system from across the
     system rather than about black holes. Where the ring lands — and whether
     anything separates from it — depends on how far away the observer is, so
     the assertion held only at the distance it was written at. The fall-off
     is the claim that holds wherever you stand. */
  for (let i = 1; i < profile.steps.length; i++) {
    expect(profile.steps[i], 'brightness falls away from the ring, step ' + i + seen)
      .toBeLessThan(profile.steps[i - 1] * 1.06);
  }

  /* Away from the ring the lens hands the sky back at the brightness it found
     it. Lensing moves light, it does not destroy it, and this is the number
     that says the shader is doing that: it sat at sixty percent while the sky
     was a scatter of points, because demagnifying a point field drops the
     points between samples, and it came up to parity the moment the sky
     became a continuum with clouds in it. */
  expect(profile.mid, 'surface brightness is conserved' + seen)
    .toBeGreaterThan(profile.sky * 0.75);

  expect(errors.filter((e) => /shader|GLSL|WebGL|THREE/i.test(e))).toEqual([]);
});

test('with no sky behind it there is nothing for a hole to bend', async ({ page }) => {
  await stubDataHosts(page);
  await stubApi(page, HOLES);
  await page.goto('/orrery.html?system=Annihilator', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orr-row')).toHaveCount(3, { timeout: 60_000 });

  await setSky(page, 'galaxy');
  await expect.poll(() => page.evaluate(() => window.Orrery.state().holes[0].hasSky)).toBe(1);
  expect(await page.evaluate(() => window.Orrery.state().holes[0].skyWidth)).toBe(4096);

  await setSky(page, 'none');
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
  await setSky(page, 'none');
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
