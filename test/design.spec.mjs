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
