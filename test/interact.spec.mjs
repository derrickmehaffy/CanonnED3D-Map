import { test, expect } from '@playwright/test';
import { stubDataHosts, waitForScene, REFERENCE_PAGE } from './helpers.mjs';

/* The parts of the console a person reaches for that nothing else drives.
 *
 * console.spec, card.spec, panel.spec and engine.spec already click a good
 * deal — layers, the systems list, the card, the display switches. What none
 * of them touch is the command palette, the camera panel, or the journal
 * drop, and those are the three places the console does something rather than
 * shows something. A palette that stops opening, or a camera preset that stops
 * moving the camera, would have gone out green.
 */

async function onMap(page) {
  await stubDataHosts(page);
  await page.goto(REFERENCE_PAGE, { waitUntil: 'domcontentloaded' });
  await waitForScene(page, expect);
}

const rail = (p) => `.rail button[data-p="${p}"]`;

/* ── the command palette ────────────────────────────────────────────────── */

test('the palette opens on the keyboard and closes on Escape', async ({ page }) => {
  await onMap(page);

  const scrim = page.locator('#scrim');
  await expect(scrim).not.toHaveClass(/open/);

  await page.keyboard.press('ControlOrMeta+k');
  await expect(scrim).toHaveClass(/open/);
  // Focus lands in the box, so the next thing typed is the query.
  await expect(page.locator('#pq')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(scrim).not.toHaveClass(/open/);
});

test('the palette finds a map and goes there', async ({ page }) => {
  await onMap(page);
  await page.locator('#findbtn').click();
  await page.locator('#pq').fill('Orrery');

  const rows = page.locator('#pres .pr');
  await expect(rows.first()).toBeVisible();
  await expect(rows.first()).toContainText('Orrery');
  // The typed part is marked in the row rather than the row merely matching.
  await expect(rows.first().locator('mark')).toHaveText(/Orrery/i);

  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/orrery\.html/, { timeout: 30_000 });
});

test('the arrows move the selection before Enter takes it', async ({ page }) => {
  await onMap(page);
  await page.locator('#findbtn').click();
  await page.locator('#pq').fill('data');

  const rows = page.locator('#pres .pr');
  await expect(rows.nth(1)).toBeVisible();
  const chosen = () => page.locator('#pres .pr[aria-selected="true"]');

  // The first row is the one Enter would take.
  await expect(chosen()).toHaveCount(1);
  const first = await chosen().textContent();

  await page.keyboard.press('ArrowDown');
  await expect(chosen()).not.toHaveText(first);
  await page.keyboard.press('ArrowUp');
  await expect(chosen()).toHaveText(first);
});

test('>tools narrows the palette to the tools', async ({ page }) => {
  await onMap(page);
  // The Tools button is the same palette, pre-filtered.
  await page.locator('#toolsbtn').click();
  await expect(page.locator('#pq')).toHaveValue('>tools ');

  const groups = page.locator('#pres .pg');
  await expect(groups).toHaveCount(1);
  await expect(groups.first()).toContainText('Canonn tools');
  // Every row is an outbound tool, not a map or a system.
  const rows = page.locator('#pres .pr');
  expect(await rows.count()).toBeGreaterThan(4);
  await expect(page.locator('#pres .pr:not(.ext)')).toHaveCount(0);
});

test('a system this map does not have offers Signals rather than nothing',
  async ({ page }) => {
  await onMap(page);
  await page.locator('#findbtn').click();
  // A name no map here carries.
  await page.locator('#pq').fill('Zzyzx Prime');

  const groups = page.locator('#pres .pg');
  await expect(groups.filter({ hasText: 'Not on this map' })).toHaveCount(1);
  await expect(page.locator('#pres .pr').last()).toContainText('Signals');
});

/* ── the camera panel ───────────────────────────────────────────────────── */

test('the camera presets actually move the camera', async ({ page }) => {
  await onMap(page);
  await page.locator(rail('camera')).click();
  await expect(page.locator('#camrange')).toBeVisible();

  const at = () => page.evaluate(() => ({
    x: Math.round(camera.position.x), y: Math.round(camera.position.y),
    z: Math.round(camera.position.z)
  }));

  await page.locator('[data-cam="top"]').click();
  await expect.poll(async () => (await at()).y, { timeout: 10_000 }).toBeGreaterThan(0);
  const top = await at();
  /* Top down means looking down: the height carries the distance and the
     other two axes are at the target. */
  expect(Math.abs(top.x)).toBeLessThan(top.y);
  expect(Math.abs(top.z)).toBeLessThan(top.y);

  await page.locator('[data-cam="side"]').click();
  await expect.poll(async () => Math.abs((await at()).y), { timeout: 10_000 })
    .toBeLessThan(Math.abs(top.y));

  // And the readout follows, in light years rather than in engine units.
  await expect(page.locator('#camdist')).toHaveText(/[0-9,]+ ly/);
});

test('the distance slider drives the camera and the readout together',
  async ({ page }) => {
  await onMap(page);
  await page.locator(rail('camera')).click();

  const dist = () => page.evaluate(() =>
    Math.round(camera.position.distanceTo(controls.target)));
  const before = await dist();

  // On a step boundary, or the input refuses the value outright.
  const slider = page.locator('#camrange');
  const want = Math.max(400, Math.round(before / 2 / 100) * 100);
  await slider.fill(String(want));
  await slider.dispatchEvent('input');

  await expect.poll(dist, { timeout: 10_000 }).toBeLessThan(before);
  // The number beside it is the same number.
  const shown = await page.locator('#camdist').textContent();
  expect(Math.abs(parseInt(shown.replace(/[^0-9]/g, ''), 10) - (await dist())))
    .toBeLessThan(60);
});

/* ── the journal drop ───────────────────────────────────────────────────── */

test('a dropped journal is plotted as a route', async ({ page }) => {
  await onMap(page);
  await page.locator(rail('routes')).click();
  await expect(page.locator('#drop')).toBeVisible();

  /* Three jumps out of a real Journal: one FSDJump per line, each its own
     JSON object, which is the shape the game writes. */
  const journal = [
    { event: 'FSDJump', StarSystem: 'Deciat', StarPos: [122.62, -0.81, -47.28] },
    { event: 'Scan', StarSystem: 'Deciat' },
    { event: 'FSDJump', StarSystem: 'Maia', StarPos: [-81.62, -149.43, -343.25] },
    { event: 'FSDJump', StarSystem: 'Merope', StarPos: [-78.59, -149.62, -340.53] }
  ].map((o) => JSON.stringify(o)).join('\n');

  await page.locator('#fileinput').setInputFiles({
    name: 'Journal.2026-09-06T120000.01.log',
    mimeType: 'text/plain',
    buffer: Buffer.from(journal)
  });

  // It lands in the panel as a layer, counted by the jumps it found.
  const added = page.locator('#side .layer', { hasText: 'Journal' });
  await expect(added).toBeVisible({ timeout: 20_000 });
  await expect(added.locator('.ct')).toHaveText('3');
});

/* ── views worth keeping, and the view as a file ────────────────────────── */

test('a view can be saved and come back to', async ({ page }) => {
  await onMap(page);
  await page.locator(rail('camera')).click();

  await expect(page.locator('.marks [data-mark]')).toHaveCount(0);
  await page.locator('[data-cam="top"]').click();
  await page.locator('#marksave').click();
  await expect(page.locator('.marks [data-mark]')).toHaveCount(1);

  // Somewhere else entirely, then back to the saved one.
  await page.locator('[data-cam="side"]').click();
  await page.waitForTimeout(400);
  const away = await page.evaluate(() => Math.round(camera.position.y));

  await page.locator('.marks [data-mark]').first().click();
  await expect.poll(() => page.evaluate(() => Math.round(camera.position.y)),
    { timeout: 10_000 }).toBeGreaterThan(away);

  // And it is kept per map, so it is still there on the next visit.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForScene(page, expect);
  await page.locator(rail('camera')).click();
  await expect(page.locator('.marks [data-mark]')).toHaveCount(1);

  // Forgetting one takes it away.
  await page.locator('.marks [data-markx]').first().click();
  await expect(page.locator('.marks [data-mark]')).toHaveCount(0);
});

test('the map can be saved as a picture', async ({ page }) => {
  await onMap(page);
  await page.locator(rail('camera')).click();

  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 20_000 }),
    page.locator('#mapshot').click()
  ]);
  expect(dl.suggestedFilename()).toMatch(/\.png$/);
  const path = await dl.path();
  const { readFileSync } = await import('node:fs');
  const bytes = readFileSync(path);
  expect(bytes.length).toBeGreaterThan(10_000);
  // A PNG, and not a blank one — the renderer has no preserveDrawingBuffer, so
  // drawing and reading have to happen in the same task or this is empty.
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
});

/* ── links that name a system ───────────────────────────────────────────── */

test('a link can name a system, and the map still knows which map it is',
  async ({ page }) => {
  await onMap(page);

  // Pick one from the list, and the address bar says which.
  await page.locator(rail('systems')).click();
  const row = page.locator('.sysrow[data-sys]').first();
  const name = await row.getAttribute('data-sys');
  await row.click();
  await expect.poll(() => new URL(page.url()).searchParams.get('system')).toBe(name);

  // Choosing systems is not navigation, so it must not fill the history.
  const depth = await page.evaluate(() => history.length);
  await page.locator('.sysrow[data-sys]').nth(1).click();
  await page.locator('.sysrow[data-sys]').nth(2).click();
  expect(await page.evaluate(() => history.length)).toBe(depth);

  /* And the link opens on it. A catalogue entry carrying no parameters only
     matched a URL carrying none, so a system in the address made the map stop
     recognising itself and call itself "Canonn map". */
  const label = await page.locator('#mapname').textContent();
  expect(label).not.toBe('Canonn map');

  await page.goto('/voyager.html?system=' + encodeURIComponent(name),
    { waitUntil: 'domcontentloaded' });
  await waitForScene(page, expect);
  await expect(page.locator('#card .c-h')).toContainText(name, { timeout: 30_000 });
  await expect(page.locator('#mapname')).toHaveText(label);

  // The card can hand that link out.
  await expect(page.locator('#clink')).toBeVisible();
});

test('a shared link waits for the map to load rather than missing it',
  async ({ page }) => {
  /* Read once at startup this worked on the small maps and quietly did
     nothing on the rest: the systems arrive well after the page does. The
     data here is pushed in by hand, long after, which is the case that used
     to fail. */
  await stubDataHosts(page);
  await page.goto('/gr-data.html?system=Test%20System%20042',
    { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app .top')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => window.Ed3d && Ed3d.updateSystems, { timeout: 30_000 });

  // Nothing to find yet, so nothing is claimed.
  await expect(page.locator('#card .c-h')).toHaveCount(0);

  await page.evaluate(() => new Promise((res) => Ed3d.updateSystems({
    categories: { 'Site type': { a: { name: 'Alpha', color: 'FF9D00' } } },
    systems: Array.from({ length: 100 }, (_, i) => ({
      name: 'Test System ' + String(i).padStart(3, '0'),
      coords: { x: i * 3, y: 0, z: i }, cat: ['a']
    }))
  }, res)));

  // And now it is answered.
  await expect(page.locator('#card .c-h'))
    .toContainText('Test System 042', { timeout: 30_000 });
});

/* ── the cursor's label ─────────────────────────────────────────────────── */

test('picking from the list renames the cursor, not just moves it',
  async ({ page }) => {
  /* Action.moveToObj — what clicking a star in the 3D view runs — writes the
     cursor's name and coordinate labels through HUD.addText. Those two meshes
     are children of Action.cursor.selection, so they travel with the cursor.
     selectInMap moved the cursor without rewriting them, which left the
     previous star's name hanging over the new one: the card said one system
     and the map said another, and the map looked like it had not updated. */
  await onMap(page);
  await page.locator(rail('systems')).click();

  await page.waitForFunction(() => window.Ed3d && Ed3d.font && window.Action &&
    window.System && System.points && System.points.length > 2, { timeout: 30_000 });

  // Click a star the way the engine does, so the labels exist and name it.
  const first = await page.evaluate(() => {
    const i = System.points.length - 1, p = System.points[i];
    Action.oldSel = null; Action.moveToObj(i, p);
    return p.name;
  });
  const labelled = () => page.evaluate(() => ({
    sys: Ed3d.textSel.system.geometry.uuid,
    coords: Ed3d.textSel.coords.geometry.uuid,
    at: Math.round(Action.cursor.selection.position.x)
  }));
  await expect.poll(async () => (await labelled()).sys).toBeTruthy();
  const before = await labelled();

  // Now pick a different system out of the list.
  const rows = page.locator('.sysrow[data-sys]');
  const name = await rows.filter({ hasNotText: first }).first().getAttribute('data-sys');
  expect(name).not.toBe(first);
  await page.locator(`.sysrow[data-sys="${name}"]`).click();

  // The cursor moves...
  await expect.poll(async () => (await labelled()).at).not.toBe(before.at);
  // ...and it is relabelled rather than carrying the old name along.
  const after = await labelled();
  expect(after.sys).not.toBe(before.sys);
  expect(after.coords).not.toBe(before.coords);
});

/* ── the journal drop, on real journals ─────────────────────────────────── */

/* Fixtures are real Journals from a real commander, reduced to the events and
   keys the parser actually reads (see the sanitiser note in test/README.md).
   System names and coordinates are public game data; nothing identifying a
   commander, a ship or a balance survives into the repository. */
const FIXTURES = new URL('./fixtures/', import.meta.url);
async function journal(name) {
  const { readFileSync } = await import('node:fs');
  return { name, mimeType: 'text/plain',
           buffer: readFileSync(new URL(name, FIXTURES)) };
}

test('a session that never left the system is not called a bad journal',
  async ({ page }) => {
  /* Three of five real journals hold no FSDJump at all — they are perfectly
     good files from evenings spent in one system. Telling the reader "Try a
     Journal*.log" when they just gave you one blames the file for the wrong
     thing, and is the reading that made the upload look broken. */
  await onMap(page);
  await page.locator(rail('routes')).click();
  await page.locator('#fileinput').setInputFiles([await journal('journal-no-jumps.log')]);

  const drop = page.locator('#drop');
  await expect(drop).toContainText(/jump/i, { timeout: 20_000 });
  await expect(drop).not.toContainText(/Try a Journal/i);
});

test('one jumpless file does not bury the route that did load', async ({ page }) => {
  /* The message was written per file, straight into the drop zone, and
     returned. Hand it a real evening's worth of journals — some with jumps,
     some without — and whichever jumpless one finished last left its
     complaint on screen while the systems from the others were already on the
     map. That is "the upload has stopped working". */
  await onMap(page);
  await page.locator(rail('routes')).click();
  await page.locator('#fileinput').setInputFiles([
    await journal('journal-with-route.log'),
    await journal('journal-no-jumps.log'),
    await journal('journal-near-empty.log')
  ]);

  /* The route lands, counted by the systems it found — nine, not the ten
     jumps in the file: Luyten 674-15 was passed through twice and the map
     plots systems rather than jumps. Worth remembering if the drop ever grows
     a "join the dots in order" mode, because that needs the repeats. */
  const added = page.locator('#side .layer', { hasText: 'journal-with-route' });
  await expect(added).toBeVisible({ timeout: 20_000 });
  await expect(added.locator('.ct')).toHaveText('9');

  /* And the drop zone still reads as a drop zone, with what was left out
     noted under it rather than replacing it.

     Asserted as one summary of both skipped files, because that is the only
     thing that tells aggregated reporting from per-file reporting: writing
     the message as each reader finishes also leaves a message on screen, just
     the last one to land, naming one file and forgetting the rest. */
  const drop = page.locator('#drop');
  await expect(drop).toContainText('Drop a');
  await expect(drop).toContainText('2 of those have no jumps');
});

test('picking a system flies there rather than cutting', async ({ page }) => {
  /* Clicking a star in the map has always eased across — Action.moveToObj
     tweens position and target together over 800ms. Picking the same system
     out of the list set camera.position outright, so the two ways of choosing
     a system felt like two different maps, and a cut gives the reader nothing
     to follow: you arrive somewhere with no idea which way you came.

     Not HUD.moveCamera's tween, which rewrites camera.position every frame and
     fought OrbitControls — the camera presets set position outright for
     exactly that reason. This is moveToObj's shape: both ends moved together,
     controls.update() once at the end. */
  await onMap(page);
  await page.locator(rail('systems')).click();

  /* Sampled per frame rather than by the clock. A wall-clock reading a fixed
     number of milliseconds after the click says nothing under a loaded
     machine — the flight may not have started or may already be over — and
     that is precisely how the orrery's picking test used to flake. What
     separates a flight from a cut is not where the camera is at any moment,
     it is how many places it was on the way: a cut has none. */
  await page.evaluate(() => {
    window.__fly = [];
    const tick = () => {
      window.__fly.push([camera.position.x, camera.position.y, camera.position.z]);
      if (window.__fly.length < 240) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await page.locator('.sysrow[data-sys]').nth(3).click();
  await page.waitForTimeout(1500);

  const { steps, between } = await page.evaluate(() => {
    const f = window.__fly;
    const a = f[0], b = f[f.length - 1];
    const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    const total = d(a, b);
    // Places it was that are neither where it started nor where it ended.
    const between = f.filter((p) => {
      const t = d(a, p) / (total || 1);
      return t > 0.05 && t < 0.95;
    }).length;
    return { steps: total, between };
  });

  expect(steps, 'the camera went somewhere').toBeGreaterThan(1);
  expect(between, 'it was seen part of the way there').toBeGreaterThan(3);
});

test('the card hands out the coordinates, ready to paste', async ({ page }) => {
  /* Asked for: "could a fourth box get thrown in there for 'copy x,y,z' as
     simple text delimited coords with commas, because I am so sick to death
     of copying the xyz from spansh or edsm and this gives a hugely faster way
     of finding plotting data."

     Game coordinates, which are what the card already shows and what every
     other tool wants — the scene negates z when it points the camera, and
     copying that would hand out a mirror of the system. */
  await onMap(page);
  await page.evaluate(() => {
    window.__wrote = null;
    navigator.clipboard.writeText = (t) => { window.__wrote = t; return Promise.resolve(); };
  });

  await page.locator(rail('systems')).click();
  const row = page.locator('.sysrow[data-sys]').first();
  await row.click();
  await expect(page.locator('#card .c-h')).toBeVisible({ timeout: 20_000 });

  await page.locator('#ccoords').click();
  const wrote = await page.evaluate(() => window.__wrote);

  // Three numbers, comma separated, and nothing else to strip out.
  expect(wrote).toMatch(/^-?\d+(\.\d+)?, -?\d+(\.\d+)?, -?\d+(\.\d+)?$/);

  // The same three the card is showing, in the same order.
  const shown = await page.locator('#card .c-meta').textContent();
  const nums = wrote.split(', ');
  for (const n of nums) expect(shown).toContain(n);

  // And they are the game's coordinates, not the scene's mirrored z.
  const rec = await page.evaluate(() => {
    const n = document.querySelector('#card .c-h').textContent.replace(/×$/, '').trim();
    const p = System.points.find((q) => q.name === n);
    return p ? { x: p.x, y: p.y, z: p.z } : null;
  });
  expect(Number(nums[2])).toBeCloseTo(-rec.z, 3);
});
