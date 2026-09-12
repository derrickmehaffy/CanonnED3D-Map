/**
 * The places where the two surfaces had drifted apart, or where a rule was
 * being beaten by another rule and the comment beside it said otherwise.
 *
 * Every number here was measured off the running page before it was asserted.
 */
import { test, expect } from '@playwright/test';
import { stubDataHosts, waitForScene, REFERENCE_PAGE } from './helpers.mjs';

const SYSTEM = {
  name: 'Testholm', id64: 1, date: '2026-01-01 00:00:00',
  coords: { x: 1, y: 2, z: 3 },
  bodies: [
    { name: 'Testholm', type: 'Star', subType: 'G (White-Yellow) Star', bodyId: 0,
      distanceToArrival: 0, solarMasses: 1, solarRadius: 1, surfaceTemperature: 5778,
      age: 4800, spectralClass: 'G2', isScoopable: true },
    { name: 'Testholm 1', type: 'Planet', subType: 'Earth-like world', bodyId: 1,
      distanceToArrival: 500, parents: [{ Star: 0 }], gravity: 1, earthMasses: 1,
      radius: 6000, orbitalPeriod: 365, semiMajorAxis: 1, surfaceTemperature: 288,
      isLandable: true }
  ]
};

async function orrery(page) {
  await stubDataHosts(page);
  await page.route('**/*codex/dump*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ system: SYSTEM }) }));
  await page.route('**/*typeahead*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ min_max: [{ id64: 1, name: 'Testholm', x: 1, y: 2, z: 3 }],
                             values: ['Testholm'] }) }));
  await page.goto('/orrery.html?system=Testholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orrery.open')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.orr-row')).toHaveCount(2, { timeout: 60_000 });
}

/* A deliberately crowded system. The declutter cannot be tested on a star and
   one planet — measured, the test passed with the whole mechanism removed —
   so this is fourteen bodies on tightly spaced orbits with the kind of
   designation-only names that are three times the width of "Mars". */
const CROWDED = {
  name: 'Crowdholm', id64: 2, date: '2026-01-01 00:00:00',
  coords: { x: 1, y: 2, z: 3 },
  bodies: [
    { name: 'Crowdholm', type: 'Star', subType: 'G (White-Yellow) Star', bodyId: 0,
      distanceToArrival: 0, solarMasses: 1, solarRadius: 1, surfaceTemperature: 5778,
      age: 4800, spectralClass: 'G2' },
    ...Array.from({ length: 14 }, (_, i) => ({
      name: 'Crowdholm (' + (307261 + i * 977) + ') 20' + (10 + i) + ' MS' + i,
      type: 'Planet', subType: 'High metal content world', bodyId: i + 1,
      distanceToArrival: 400 + i * 12, parents: [{ Star: 0 }],
      gravity: 1, earthMasses: 1, radius: 5500 + i * 40,
      orbitalPeriod: 300 + i * 7, semiMajorAxis: 0.9 + i * 0.06,
      surfaceTemperature: 280
    }))
  ]
};

async function crowded(page) {
  await stubDataHosts(page);
  await page.route('**/*codex/dump*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ system: CROWDED }) }));
  await page.route('**/*typeahead*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ min_max: [{ id64: 2, name: 'Crowdholm', x: 1, y: 2, z: 3 }],
                             values: ['Crowdholm'] }) }));
  await page.goto('/orrery.html?system=Crowdholm', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.orrery.open')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.orr-row')).toHaveCount(15, { timeout: 60_000 });
}

test('the measurement tile is set the way the card sets it', async ({ page }) => {
  /* orrery.css said these were sized "the way the galaxy map's system card
     sets them: label above, figure large and tabular". They were not:
     `.orr-facts dt`/`dd` carry the same specificity and come later in the
     file, and .orr-meas sits inside .orr-facts — so the label rendered at 10px
     and the figure at 11px, a label as large as its own number, in the one
     component both surfaces use for every reading taken off the screen. */
  await orrery(page);
  await page.locator('.orr-row').first().click();
  await expect(page.locator('.orr-meas').first()).toBeVisible({ timeout: 30_000 });

  const t = await page.evaluate(() => {
    const dl = document.querySelector('.orr-meas');
    const dt = dl.querySelector('dt'), dd = dl.querySelector('dd');
    const g = (e, p) => getComputedStyle(e)[p];
    return {
      tag: dl.tagName,
      label: parseFloat(g(dt, 'fontSize')),
      figure: parseFloat(g(dd, 'fontSize')),
      labelSpacing: g(dt, 'letterSpacing'),
      tabular: g(dd, 'fontVariantNumeric')
    };
  });

  expect(t.tag, 'dt and dd are only valid inside a dl').toBe('DL');
  expect(t.figure, 'the figure matches the card’s 14.5px').toBeCloseTo(14.5, 1);
  expect(t.label, 'and the label stays the smaller of the two').toBeCloseTo(9, 1);
  expect(t.figure, 'the number must outrank its own label').toBeGreaterThan(t.label + 3);
  expect(t.tabular, 'figures line up between rows').toContain('tabular-nums');
});

test('both resize handles are on the edge they resize', async ({ page }) => {
  /* orr-grip-h was a fifth grid child in a four-row grid, so auto-placement
     put it in an implicit row 5: full width along the bottom, lying over the
     time bar, showing a row-resize cursor there while dragging it resized an
     axis at the top. And orr-grip-l — the *left* rail's handle — sat 3px off
     the *right* edge of the window, because it was a sibling of the stage and
     .orr-mid is not positioned. */
  await orrery(page);

  const g = await page.evaluate(() => {
    const r = (id) => {
      const e = document.getElementById(id);
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return { x: b.x, right: b.right, y: b.y, bottom: b.bottom, w: b.width, h: b.height };
    };
    const box = (sel) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return { x: b.x, right: b.right, y: b.y, bottom: b.bottom };
    };
    return {
      gripL: r('orr-grip-l'), gripR: r('orr-grip-r'), gripH: r('orr-grip-h'),
      left: box('#orr-left'), right: box('#orr-right'),
      spine: box('#orr-spine'), foot: box('.orr-foot'),
      vw: window.innerWidth,
      gripLParent: document.getElementById('orr-grip-l').parentElement.id
    };
  });

  // The left handle belongs to the left rail, not to the window's far side.
  expect(g.gripLParent, 'inside the rail it resizes').toBe('orr-left');
  expect(Math.abs(g.gripL.right - g.left.right), 'on the left rail’s own edge')
    .toBeLessThan(6);
  expect(g.gripL.x, 'and nowhere near the right edge of the window')
    .toBeLessThan(g.vw / 2);

  // Mirror of it on the right rail, which was always correct.
  expect(Math.abs(g.gripR.x - g.right.x), 'the right handle on the right rail’s edge')
    .toBeLessThan(6);

  // The spine's handle sits on the spine, not across the time bar.
  if (g.gripH && g.gripH.h > 0) {
    expect(Math.abs(g.gripH.bottom - g.spine.bottom), 'on the spine’s bottom edge')
      .toBeLessThan(6);
    expect(g.gripH.y, 'and clear of the time bar').toBeLessThan(g.foot.y);
  }
});

test('a control has a boundary a reader can see', async ({ page }) => {
  /* --rule is #1B242E: 1.21:1 against --panel. As a hairline between blocks
     that is the point. As the only boundary a ghost button has it is not —
     WCAG 1.4.11 wants 3:1 for the visual boundary of a control. So there are
     two tokens now, one meaning each. */
  await stubDataHosts(page);
  await page.goto(REFERENCE_PAGE, { waitUntil: 'load' });
  await waitForScene(page, expect);

  const lum = (c) => {
    const [r, g, b] = c.match(/\d+/g).slice(0, 3).map(Number).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  const got = await page.evaluate(() => {
    const out = {};
    for (const sel of ['.find', '.switch', '.viewmode', '#nav-controls .nav-btn', '.totop']) {
      const e = document.querySelector(sel);
      if (e) out[sel] = { border: getComputedStyle(e).borderTopColor };
    }
    out.panel = getComputedStyle(document.querySelector('.side')).backgroundColor;
    return out;
  });

  for (const [sel, v] of Object.entries(got)) {
    if (sel === 'panel') continue;
    expect(ratio(v.border, got.panel), sel + ' boundary against the panel')
      .toBeGreaterThanOrEqual(3);
  }
});

test('the card always shows its way out', async ({ page }) => {
  /* .card was max-height:calc(100% - 275px) for chrome ~160px tall, and
     .c-acts began 395px into the card — so at 1280x720 "Open the orrery" and
     "Open in Signals", the only links that take a commander anywhere, were
     below the visible area, with a 1.21:1 scrollbar thumb as the only hint
     that anything was there. The actions are pinned now, and the card has a
     floor so a short stage cannot collapse it to nothing. */
  await page.setViewportSize({ width: 1280, height: 720 });
  await stubDataHosts(page);
  await page.goto(REFERENCE_PAGE, { waitUntil: 'load' });
  await waitForScene(page, expect);

  await page.evaluate(() => {
    const i = System.points.findIndex((p) => p && p.name && p.visible);
    Action.moveToObj(i, System.points[i]);
  });
  await expect(page.locator('.c-acts')).toBeVisible({ timeout: 30_000 });

  const m = await page.evaluate(() => {
    const card = document.querySelector('.card');
    const acts = document.querySelector('.c-acts');
    const cb = card.getBoundingClientRect(), ab = acts.getBoundingClientRect();
    return {
      cardH: cb.height, scrollH: card.scrollHeight,
      position: getComputedStyle(acts).position,
      actsWithinCard: ab.bottom <= cb.bottom + 1 && ab.top >= cb.top - 1,
      primary: acts.textContent.replace(/\s+/g, ' ')
    };
  });

  expect(m.cardH, 'the card must not collapse').toBeGreaterThanOrEqual(220);
  expect(m.position, 'the actions are pinned, not scrolled').toBe('sticky');
  expect(m.actsWithinCard, 'and visible without scrolling the card').toBe(true);
  expect(m.primary).toContain('Open the orrery');
  expect(m.primary).toContain('Open in Signals');
});

test('the panel answers Enter and Space, not only the mouse', async ({ page }) => {
  /* Every row and toggle in the rail carried tabindex="0" and a role, and the
     only handler was `click` — which a role="button" div does not get from a
     key press. So 80 tab stops on the systems panel did nothing. The orrery's
     own list has always had this right. */
  await stubDataHosts(page);
  await page.goto(REFERENCE_PAGE, { waitUntil: 'load' });
  await waitForScene(page, expect);
  await expect.poll(() => page.evaluate(() => window.__ed3dTestState().dataComplete),
    { timeout: 60_000 }).toBe(true);

  await page.evaluate(() => new Promise((done) => Ed3d.updateSystems({
    categories: { 'Site type': { a: { name: 'Alpha', color: 'FF9D00' } } },
    systems: [{ name: 'Keyholm', coords: { x: 5, y: 0, z: 5 }, cat: ['a'] }]
  }, done)));

  const row = page.locator('.layer[data-t]').first();
  await expect(row).toBeVisible();

  const pressed = () => row.getAttribute('aria-pressed');
  const first = await pressed();

  await row.focus();
  await page.keyboard.press('Enter');
  expect(await pressed(), 'Enter toggles the layer').not.toBe(first);

  await page.keyboard.press(' ');
  expect(await pressed(), 'and so does Space').toBe(first);

  /* And focus survives the re-render, or a second press goes nowhere and a
     keyboard reader is dumped to the top of the list after every toggle. */
  expect(await page.evaluate(() => {
    const a = document.activeElement;
    return !!(a && a.closest && a.closest('.layer[data-t]'));
  }), 'focus stays on the row that was activated').toBe(true);
});

test('the key hints name a key the reader has', async ({ page }) => {
  /* The handler always accepted metaKey or ctrlKey; only the labels were
     hardcoded to the Command glyph, on a game played overwhelmingly on PC. */
  await stubDataHosts(page);
  await page.goto(REFERENCE_PAGE, { waitUntil: 'load' });
  await waitForScene(page, expect);

  const badge = await page.locator('.find .k').textContent();
  const mac = await page.evaluate(() =>
    /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent));

  if (mac) expect(badge).toContain('⌘');
  else {
    expect(badge, 'a Windows or Linux commander has no Command key').not.toContain('⌘');
    expect(badge).toContain('Ctrl');
  }
});

/* The swatch beside a layer name is the only key a map has: nothing else tells
   a commander which dot on the screen is which layer. route_uia.html listed
   eighteen layers and drew nine of them in one identical yellow — every UIA
   wave plus their roll-up — with a tenth pair sharing a green, one layer at
   1.58:1 against the panel, and the interface's own --amber used as data. */
for (const page_ of ['/route_uia.html', '/gr-data.html']) {
  test(`every layer on ${page_} has its own visible colour`, async ({ page }) => {
    await stubDataHosts(page);
    await page.goto(page_, { waitUntil: 'load' });
    await waitForScene(page, expect);
    await expect.poll(() => page.evaluate(() => window.__ed3dTestState().dataComplete),
      { timeout: 60_000 }).toBe(true);
    await expect(page.locator('#filters .map_filter').first()).toBeAttached({ timeout: 30_000 });

    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('#filters .map_filter')].map((a) => {
        const sw = a.querySelector('.check');
        return {
          name: a.textContent.trim().replace(/\s+/g, ' ').slice(0, 40),
          bg: sw ? getComputedStyle(sw).backgroundColor : null
        };
      }).filter((r) => r.bg && r.bg !== 'rgba(0, 0, 0, 0)'));

    expect(rows.length, 'this map should have layers to check').toBeGreaterThan(1);

    // No two layers may be the same colour.
    const groups = {};
    for (const r of rows) (groups[r.bg] = groups[r.bg] || []).push(r.name);
    const shared = Object.entries(groups)
      .filter(([, v]) => v.length > 1)
      .map(([c, v]) => c + ' ← ' + v.join(' / '));
    expect(shared, 'layers the panel names apart but the map draws the same').toEqual([]);

    /* --amber means "selected" and --ion means "station" in the chrome around
       every map. A data layer may not be either, or the colour carries two
       meanings and therefore none. */
    const reserved = ['rgb(255, 157, 0)', 'rgb(77, 227, 225)'];
    expect(rows.filter((r) => reserved.includes(r.bg)).map((r) => r.name),
      'a data layer is using an interface accent').toEqual([]);

    // And each swatch has to be visible against the panel it sits on.
    const lum = (c) => {
      const [r, g, b] = c.match(/\d+/g).slice(0, 3).map(Number).map((v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const panel = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.side')).backgroundColor);
    const faint = rows
      .map((r) => ({ ...r, ratio: (lum(r.bg) + 0.05) / (lum(panel) + 0.05) }))
      .filter((r) => r.ratio < 2)
      .map((r) => r.name + ' @ ' + r.ratio.toFixed(2) + ':1');
    expect(faint, 'a swatch nobody can see is not a key').toEqual([]);
  });
}

test('body labels stop piling on top of each other', async ({ page }) => {
  /* drawLabels culled by frustum and nothing else: no screen-space test, no
     cap, no priority. Measured on Sol at 752x290, nineteen labels gave
     thirteen overlapping pairs and the inner planets were a single grey smear.

     drawFarLabels() in the same file already ranks and caps its 230 named
     stars, with a comment saying all of them at once "is a wall of text over a
     system of eight bodies — I know, because that is what the first version
     did". The system's own bodies never got it, and they are the set that
     clusters. */
  await page.setViewportSize({ width: 900, height: 520 });
  await crowded(page);
  await expect(page.locator('.orr-label').first()).toBeAttached({ timeout: 30_000 });

  const m = await page.evaluate(() => {
    const shown = [...document.querySelectorAll('.orr-label')]
      .filter((e) => !e.classList.contains('off'));
    const boxes = shown.map((e) => {
      const b = e.getBoundingClientRect();
      return { t: e.textContent, l: b.left, r: b.right, tp: b.top, bt: b.bottom };
    });
    let pairs = 0;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (!(a.r < b.l || a.l > b.r || a.bt < b.tp || a.tp > b.bt)) pairs++;
      }
    }
    return {
      shown: shown.length,
      total: document.querySelectorAll('.orr-label').length,
      overlapping: pairs,
      star: shown.some((e) => e.classList.contains('star'))
    };
  });

  expect(m.overlapping, 'no two visible labels may overlap').toBe(0);
  expect(m.shown, 'and something is still labelled').toBeGreaterThan(0);
  /* The star is rank 0, so it is never the one dropped — losing the name of
     the thing everything else orbits would be the worst possible trade. */
  expect(m.star, 'the star keeps its label').toBe(true);
});

test('the body list column is one unit, and says which', async ({ page }) => {
  /* One right-aligned column carried two units: a body's semi-major axis in AU
     and, on the row under it, a station's arrival distance in Ls — three
     orders of magnitude apart, with no label and no header. "Earth 1" above
     "M.Gorbachev 501" read as the station being five hundred times further out
     than the planet it orbits, in the list a commander uses to decide where to
     fly. Both are light-seconds from arrival now, which is what the distance
     spine and the ARRIVAL tile already used. */
  await crowded(page);

  const m = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.orr-row')].map((r) => ({
      station: r.classList.contains('stn'),
      // The arrival star is the origin and correctly reads 0.
      star: r.getAttribute('aria-level') === '1',
      name: (r.querySelector('.nm') || {}).textContent || '',
      cell: (r.querySelector('.ct') || {}).textContent || ''
    }));
    return {
      rows,
      unitLabel: (document.querySelector('.orr-s-u') || {}).textContent || null
    };
  });

  expect(m.unitLabel, 'the unit is named once, in the header').toBe('Ls');

  /* The fixture's bodies sit 400 Ls and up. In AU they would have been under
     10 — so any cell below 100 would mean the old unit had come back. */
  const bodies = m.rows.filter((r) => !r.station && !r.star && r.cell);
  expect(bodies.length, 'the fixture should list bodies with distances')
    .toBeGreaterThan(3);
  for (const b of bodies) {
    const v = Number(b.cell.replace(/,/g, ''));
    expect(v, b.name + ' reads ' + b.cell + ', which is AU not Ls')
      .toBeGreaterThanOrEqual(100);
  }

  // The arrival star is the origin, so its own distance is zero, not blank.
  const star = m.rows.find((r) => r.star);
  expect(star.cell, 'the star sits at the origin of the column').toBe('0');
});
