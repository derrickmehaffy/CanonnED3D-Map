import { test, expect } from '@playwright/test';
import { stubDataHosts } from './helpers.mjs';

/* gr-data.html has 212 systems locally, enough to exercise paging without the
   network. codex.html finishes near 35,000, which is what made rendering the
   whole list at once lock the panel up. */
async function ruins(page) {
  await stubDataHosts(page);
  await page.goto('/gr-data.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app .top')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => window.Ed3d && Ed3d.updateSystems, { timeout: 30_000 });
  await page.evaluate(() => new Promise((res) => Ed3d.updateSystems({
    categories: { 'Site type': { a: { name: 'Alpha', color: 'FF9D00' } } },
    systems: Array.from({ length: 300 }, (_, i) => ({
      name: 'Test System ' + String(i).padStart(3, '0'),
      coords: { x: i * 3, y: 0, z: i }, cat: ['a']
    }))
  }, res)));
  await expect(page.locator('#side .layer').first()).toBeVisible({ timeout: 30_000 });
  await page.locator('.rail button[data-p="systems"]').click();
}

test('the systems list renders in pages rather than all at once', async ({ page }) => {
  await ruins(page);
  const rows = page.locator('.sysrow');
  await expect(rows).toHaveCount(80);              // one page, not 300

  // Scrolling brings in the next pages.
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => {
      const s = document.getElementById('side');
      s.scrollTop = s.scrollHeight;
      s.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(120);
  }
  await expect(rows).toHaveCount(300);
});

test('the filter and sort controls stay put while the list scrolls', async ({ page }) => {
  await ruins(page);
  await expect(page.locator('.syshead')).toHaveCSS('position', 'sticky');
  // Back-to-top only appears once there is somewhere to go back to.
  await expect(page.locator('#systotop')).toBeHidden();
  await page.evaluate(() => {
    const s = document.getElementById('side');
    s.scrollTop = 600; s.dispatchEvent(new Event('scroll'));
  });
  await expect(page.locator('#systotop')).toBeVisible();
  await page.locator('#systotop').click();
  await expect.poll(() => page.evaluate(() => document.getElementById('side').scrollTop))
    .toBeLessThan(50);
});

test('the panel can be resized and the width is remembered', async ({ page }) => {
  await ruins(page);
  const width = () => page.evaluate(() =>
    Math.round(document.getElementById('side').getBoundingClientRect().width));
  const before = await width();

  await page.evaluate(() => {
    const g = document.querySelector('.side-grip');
    const r = g.getBoundingClientRect();
    g.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.x, pointerId: 1 }));
    g.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.x + 100, pointerId: 1 }));
    g.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
  });
  expect(await width()).toBeGreaterThan(before);
  expect(await page.evaluate(() => localStorage.getItem('canonn.console.sideWidth')))
    .toBe(String(await width()));

  // The grip survives a panel re-render, which replaces the panel's contents.
  await page.locator('.rail button[data-p="layers"]').click();
  await expect(page.locator('.side-grip')).toHaveCount(1);
});

test('display settings and panel width carry to another map', async ({ page }) => {
  await ruins(page);
  await page.locator('.rail button[data-p="display"]').click();
  await page.locator('[data-sw="stars"]').click();          // turn the starfield off
  await page.evaluate(() => {
    const s = document.getElementById('sizerange');
    s.value = 44; s.dispatchEvent(new Event('input', { bubbles: true }));
  });

  await page.goto('/voyager.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#side .layer').first()).toBeVisible({ timeout: 60_000 });
  await page.locator('.rail button[data-p="display"]').click();

  await expect(page.locator('[data-sw="stars"]')).not.toHaveClass(/on/);
  await expect(page.locator('#szval')).toHaveText('44');
});

test('a collapsed panel stays collapsed, and the rail does not', async ({ page }) => {
  await ruins(page);
  // Clicking the active rail icon collapses the panel beside it.
  await page.locator('.rail button[data-p="systems"]').click();
  await expect(page.locator('#side')).toBeHidden();
  await expect(page.locator('.rail')).toBeVisible();

  await page.goto('/voyager.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app .top')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#side')).toBeHidden();
  await expect(page.locator('.rail')).toBeVisible();
});

/* ── layer selection ────────────────────────────────────────────────────── */

async function threeTypes(page) {
  await stubDataHosts(page);
  await page.goto('/gr-data.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app .top')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => window.Ed3d && Ed3d.updateSystems, { timeout: 30_000 });
  await page.evaluate(() => new Promise((res) => Ed3d.updateSystems({
    categories: { 'Site type': {
      a: { name: 'Alpha', color: 'FF9D00' },
      b: { name: 'Beta',  color: '4DE3E1' },
      g: { name: 'Gamma', color: 'B98CFF' } } },
    systems: ['a', 'b', 'g'].flatMap((c, ci) =>
      Array.from({ length: 10 }, (_, i) => ({
        name: c.toUpperCase() + i, coords: { x: ci * 50 + i, y: 0, z: i }, cat: [c]
      })))
  }, res)));
  await expect(page.locator('#side .layer').first()).toBeVisible({ timeout: 30_000 });
}

const hiddenPoints = (page) => page.evaluate(() => {
  const a = System.particleGeo.getAttribute('aVisible');
  let n = 0;
  for (let i = 0; i < a.count; i++) if (!a.array[i]) n++;
  return n;
});

test('select all and clear act on every layer at once', async ({ page }) => {
  await threeTypes(page);
  const shown = page.locator('#st-shown');
  await expect(shown).toContainText('30 / 30');

  await page.locator('[data-all="0"]').click();
  await expect(shown).toContainText('0 / 30');
  // Clear is disabled once nothing is selected, and Select all becomes live.
  await expect(page.locator('[data-all="0"]')).toBeDisabled();
  await expect(page.locator('[data-all="1"]')).toBeEnabled();

  await page.locator('[data-all="1"]').click();
  await expect(shown).toContainText('30 / 30');
  await expect(page.locator('[data-all="1"]')).toBeDisabled();
});

/* Ed3d dims a filtered system to #111111. That is nearly black alone, but the
   cloud blends additively, so in a dense cluster hundreds of "off" points sum
   into a grey haze that reads as data. Hiding drops them from the draw. */
test('deselected systems can be removed from the draw entirely', async ({ page }) => {
  await threeTypes(page);
  await expect(page.locator('#hidefilt')).toBeChecked();   // on by default

  expect(await hiddenPoints(page), 'nothing hidden while all layers are on').toBe(0);
  await page.locator('#side .layer').nth(0).click();
  await expect.poll(() => hiddenPoints(page)).toBe(10);

  // Unchecking hands the job back to Ed3d's dimming.
  await page.locator('#hidefilt').uncheck();
  await expect.poll(() => hiddenPoints(page)).toBe(0);
  await expect(page.locator('#st-shown')).toContainText('20 / 30');
});

test('the hide preference is remembered across maps', async ({ page }) => {
  await threeTypes(page);
  await page.locator('#hidefilt').uncheck();
  await page.goto('/voyager.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#side .layer').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#hidefilt')).not.toBeChecked();
});

test('HDR is on by default', async ({ page }) => {
  await stubDataHosts(page);
  await page.goto('/voyager.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#side .layer').first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.PostFX && PostFX.enabled), { timeout: 20_000 })
    .toBe(true);
  await page.locator('.rail button[data-p="display"]').click();
  await expect(page.locator('[data-sw="hdr"]')).toHaveClass(/on/);
});

/* Bloom shipped at zero on every map, because it was calibrated against the
   worst case: codex.html is thousands of systems in tight clusters, and any
   glow at all turns that into one sheet of light. That is a fact about
   density, not about bloom — it left the best thing the HDR pipeline does
   switched off on every map that could carry it.

   Pushing the systems in gives the density to judge without waiting on a real
   dump, and it is also the honest test: the map's answer has to survive its
   data arriving after the console did, which is the normal case. */
async function withSystems(page, count) {
  await stubDataHosts(page);
  await page.goto('/gr-data.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app .top')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => window.Ed3d && Ed3d.updateSystems, { timeout: 30_000 });
  await page.evaluate((n) => new Promise((res) => Ed3d.updateSystems({
    categories: { 'Site type': { a: { name: 'Alpha', color: 'FF9D00' } } },
    systems: Array.from({ length: n }, (_, i) => ({
      name: 'Test System ' + String(i).padStart(5, '0'),
      coords: { x: (i % 90) * 3, y: 0, z: i }, cat: ['a']
    }))
  }, res)), count);
  await expect(page.locator('#side .layer').first()).toBeVisible({ timeout: 30_000 });
}

const bloom = (page) => page.evaluate(() => window.PostFX && PostFX.strength);

test('bloom starts at what the map can carry', async ({ page }) => {
  // A couple of hundred systems can each hold a real halo.
  await withSystems(page, 300);
  await expect.poll(() => bloom(page), { timeout: 20_000 }).toBeGreaterThan(0);
  // And the pass is running, not merely configured.
  expect(await page.evaluate(() => PostFX.bloom.enabled)).toBe(true);
});

test('a crowded map still starts clean', async ({ page }) => {
  await withSystems(page, 2000);
  await expect.poll(() => bloom(page), { timeout: 20_000 }).toBe(0);
  expect(await page.evaluate(() => PostFX.bloom.enabled)).toBe(false);
});

test('a reader who sets bloom is not overruled by the map', async ({ page }) => {
  await withSystems(page, 300);
  await expect.poll(() => bloom(page), { timeout: 20_000 }).toBeGreaterThan(0);

  /* Turned off by hand, on a map whose own answer is "on". A stored zero is a
     decision; it is not the same as never having said. */
  await page.evaluate(() => localStorage.setItem('canonn.console.bloom', '0'));
  await withSystems(page, 300);
  await expect.poll(() => bloom(page), { timeout: 20_000 }).toBe(0);

  // And it follows them to the next map rather than being argued with on each.
  await page.goto('/voyager.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#side .layer').first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => bloom(page), { timeout: 20_000 }).toBe(0);
});

/* ── stars sized to the crowd ───────────────────────────────────────────── */

/* The reader-facing number, not System.scaleSize — the engine rewrites that
   for its own flare scaling and it reads 400 whatever the control says. */
const size = (page) => page.locator('#sizerange').inputValue().then(Number);

test('a crowded map starts with smaller stars', async ({ page }) => {
  /* Reported as "bloom zero is still a bit bright", with a screenshot of the
     bloom slider at zero over a white-hot map. Measured, bloom was not the
     cause and turning it off is not the cure: the halo goes, the core does
     not. The point sprites blend additively, so at real screen density
     hundreds of them land on the same pixel and sum far past white — exposure
     barely touches it, turning the HDR path off is worse, and material
     opacity cannot outrun a sum that large.

     What does work is having fewer of them overlap, which is the System size
     control that was on screen the whole time. So a crowded map picks a size
     that suits it, the way it already picks its own bloom. */
  await withSystems(page, 8000);
  await page.locator('.rail button[data-p="display"]').click();
  await expect.poll(() => size(page), { timeout: 20_000 }).toBeLessThan(20);
});

test('a sparse map is left at the size it always had', async ({ page }) => {
  await withSystems(page, 300);
  await page.locator('.rail button[data-p="display"]').click();
  await expect.poll(() => size(page), { timeout: 20_000 }).toBe(20);
});

test('a reader who sets a size is not overruled by the map', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('canonn.console.sysSize', '44'));
  await withSystems(page, 8000);
  await page.waitForTimeout(1200);
  await page.locator('.rail button[data-p="display"]').click();
  expect(await size(page)).toBe(44);
});

/* ── the real stars on the galaxy map ───────────────────────────────────── */

test('the real named stars can be shown on the map, where they are',
  async ({ page }) => {
  /* The same 230 stars the orrery puts on its sky, but here at their actual
     positions — the galaxy map is real space, so a star belongs where it is
     rather than projected onto a sphere. An orientation aid: the map knows
     Canonn's sites and nothing else, so nothing on it says "that way is
     Betelgeuse". Off by default, because it is 230 more things on a map that
     already has thousands. */
  await stubDataHosts(page);
  await page.goto('/gr-data.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app .top')).toBeVisible({ timeout: 30_000 });
  await page.locator('.rail button[data-p="display"]').click();

  const sw = page.locator('[data-sw="named"]');
  await expect(sw).toBeVisible();
  await expect(sw).not.toHaveClass(/on/);
  expect(await page.evaluate(() => window.CanonnConsole.namedStars())).toBe(0);

  await sw.click();
  await expect(sw).toHaveClass(/on/);
  await expect.poll(() => page.evaluate(() => window.CanonnConsole.namedStars()),
    { timeout: 30_000 }).toBeGreaterThan(200);

  /* At real positions, so the z convention is the map's own: minus the game z,
     the same as every system in the point cloud. Spansh puts Rigel at
     z -682.53125. */
  const rigel = await page.evaluate(() => window.CanonnConsole.namedStarAt('Rigel'));
  expect(rigel[2]).toBeCloseTo(682.53125, 3);

  // Named, and not all at once.
  await expect.poll(() => page.locator('.far-lbl:not(.off)').count(),
    { timeout: 10_000 }).toBeLessThanOrEqual(24);

  // And it goes away again, and is remembered.
  await sw.click();
  await expect(sw).not.toHaveClass(/on/);
  await expect.poll(() => page.evaluate(() => window.CanonnConsole.namedStars()),
    { timeout: 10_000 }).toBe(0);
});

test('nothing in the console is set smaller than it can be read at', async () => {
  /* The orrery has had this guarantee for a while; the console had none, and
     the two are meant to read as one product. Nine pixels is the floor, and
     what sits there is uppercase micro-labelling with letter-spacing, which
     reads a size larger than it is set.

     One carve-out, and it is a real distinction rather than a convenience:
     .c-star-scoop's ::before is the content '◆', a diamond marking a
     scoopable star. A glyph is seen, not read, and its size is chosen for
     optical balance against the 11px line it sits on — the floor is about
     legibility of text. */
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../Source/css/console.css', import.meta.url), 'utf8');

  const rules = [...css.matchAll(/([^{}]+)\{([^}]*font-size:\s*([0-9.]+)px[^}]*)\}/g)]
    .map((m) => ({ sel: m[1].trim().split('\n').pop().trim(), px: parseFloat(m[3]), body: m[2] }));
  expect(rules.length, 'found the rules to check').toBeGreaterThan(30);

  const text = rules.filter((r) => !/::before|::after/.test(r.sel) || !/content:/.test(r.body));
  const small = text.filter((r) => r.px < 9).map((r) => `${r.sel} @ ${r.px}px`);
  expect(small, 'text below the nine-pixel floor').toEqual([]);
});

test('every focus ring in both stylesheets is the same ring', async () => {
  /* One amber 2px outline, offset 2px, is the focus style for the whole
     product. It drifted once — the orrery's speed slider went in at 1px — and
     a focus ring that changes weight between controls reads as two products
     rather than one. */
  const { readFileSync } = await import('node:fs');
  const odd = [];
  for (const f of ['console.css', 'orrery.css']) {
    const css = readFileSync(new URL('../Source/css/' + f, import.meta.url), 'utf8');
    for (const m of css.matchAll(/([^{}]*:focus-visible[^{}]*)\{([^}]*)\}/g)) {
      const body = m[2];
      if (!/outline\s*:/.test(body)) continue;            // e.g. the grip, which tints
      const w = (body.match(/outline\s*:\s*([0-9.]+)px/) || [])[1];
      if (w && w !== '2') odd.push(`${f}: ${m[1].trim()} → ${w}px`);
    }
  }
  expect(odd).toEqual([]);
});

test('the chrome you click is big enough to click', async ({ page }) => {
  /* The card's close was 21x17 and the orrery's 19x19 — the same control,
     undersized in both places, which is how a shared idiom drifts. Anything
     that is chrome rather than data gets 24px in each direction.

     Deliberately not everything: the orrery's spine draws an 8px pip per body
     on a dense axis, and links inside a sentence in the card are inline. Both
     have an equivalent full-size path — the body list, and the card's own
     buttons — which is the exemption that matters here. */
  await withSystems(page, 60);
  await page.locator('.rail button[data-p="systems"]').click();
  await page.locator('.sysrow[data-sys]').first().click();
  await expect(page.locator('#card .c-h')).toBeVisible({ timeout: 20_000 });

  const small = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('#card .c-h .x, #card .c-reset, .rail button').forEach((e) => {
      const b = e.getBoundingClientRect();
      if (b.width && b.height && (b.width < 24 || b.height < 24)) {
        out.push((e.id || e.className) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height));
      }
    });
    return out;
  });
  expect(small).toEqual([]);
});
