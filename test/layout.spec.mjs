/**
 * The console's layout across widths and heights.
 *
 * There was one layout media query in console.css and it did nothing: its
 * `.side{position:absolute}` was overridden by a `.side{position:relative}`
 * added 60 lines later for the drag grip, same specificity and later in source.
 * So `left:44px` became a *relative* nudge — the panel kept its 300px in the
 * flex flow and also shifted right, leaving a dead gutter and painting over the
 * stage. On a 360px phone the stage was left 4px wide and the map was simply
 * off-screen; on a folding phone at 752px the system card was sliced into
 * "URFACE TEMP" and "uel scoopable".
 *
 * Nothing in the suite ran below 1280 wide, so none of it was visible.
 *
 * The sizes here are real: 360×670 and 752×650 are a Galaxy Fold's two screens
 * as measured off screenshots — note the unfolded one is *wider and shorter*,
 * because the browser adds a tab strip. 768×1024 is iPad portrait, which the
 * broken rule also covered. 900×420 is a short laptop window.
 */
import { test, expect } from '@playwright/test';
import { stubDataHosts, waitForScene } from './helpers.mjs';

const PAGE = '/gr-data.html';

const SIZES = [
  { name: 'phone, Fold cover screen', w: 360, h: 670, floats: true },
  { name: 'phone, upper edge of the band', w: 599, h: 800, floats: true },
  { name: 'Fold unfolded — wider than the cover screen and shorter', w: 752, h: 650, floats: true },
  { name: 'iPad portrait', w: 768, h: 1024, floats: true },
  { name: 'short laptop window', w: 900, h: 420, floats: true },
  { name: 'the layout everything was built against', w: 1280, h: 800, floats: false },
  { name: 'a wide monitor', w: 1920, h: 1080, floats: false }
];

async function open(page, w, h) {
  await page.setViewportSize({ width: w, height: h });
  await stubDataHosts(page);
  await page.goto(PAGE, { waitUntil: 'load' });
  await waitForScene(page, expect);
}

const geometry = (page) => page.evaluate(() => {
  const box = (s) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { x: b.x, right: b.right, w: b.width, h: b.height };
  };
  const side = document.querySelector('.side');
  return {
    vw: window.innerWidth,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    headerOverflow: document.querySelector('.top').scrollWidth - window.innerWidth,
    sidePosition: getComputedStyle(side).position,
    rail: box('.rail'), side: box('.side'), stage: box('.stage'),
    nav: box('#nav-controls'), viewmode: box('.viewmode')
  };
});

for (const s of SIZES) {
  test(`no horizontal overflow at ${s.w}×${s.h} — ${s.name}`, async ({ page }) => {
    await open(page, s.w, s.h);
    const g = await geometry(page);

    /* body{overflow:hidden} plus user-scalable=no meant anything pushed past
       the right edge could not be scrolled to *or* pinched to. Measured 126px
       lost at 411 and 195px on route_uia at 360. */
    expect(g.overflow, 'the document must not be wider than the window').toBe(0);
    expect(g.headerOverflow, 'and neither must the header row').toBeLessThanOrEqual(0);
  });
}

for (const s of SIZES) {
  test(`the panel ${s.floats ? 'floats over' : 'sits beside'} the map at ${s.w}×${s.h}`, async ({ page }) => {
    await open(page, s.w, s.h);
    const g = await geometry(page);

    if (s.floats) {
      /* Out of flow, so the stage gets the window's width less the rail
         instead of being squeezed to whatever is left after 356px of chrome. */
      expect(g.sidePosition).toBe('absolute');
      expect(Math.round(g.stage.x), 'the stage starts right after the rail')
        .toBe(Math.round(g.rail.w));
      expect(g.stage.w, 'and spans the rest of the window')
        .toBeGreaterThan(g.vw - g.rail.w - 2);
    } else {
      // Desktop is untouched: rail, then panel, then stage.
      expect(g.sidePosition).toBe('relative');
      expect(Math.round(g.stage.x), 'the stage starts after rail + panel')
        .toBe(Math.round(g.side.right));
    }
  });
}

test('the camera cluster and the 2D toggle stay reachable on a phone', async ({ page }) => {
  /* Both are anchored inside .stage, so when the stage was 4px wide they were
     off-screen — and unreachable, because the page cannot scroll sideways.
     Enumerated as lost in the mobile review along with Tools, GitHub and
     Donate; the last two fold into the header menu by design. */
  await open(page, 360, 670);
  const g = await geometry(page);

  expect(g.nav, 'the camera cluster should exist').not.toBeNull();
  expect(g.nav.right, 'and sit inside the window').toBeLessThanOrEqual(g.vw + 1);
  expect(g.nav.x).toBeGreaterThanOrEqual(-1);

  expect(g.viewmode.right, 'so should the 3D/2D toggle').toBeLessThanOrEqual(g.vw + 1);

  // Tools stays; the two outbound links fold away rather than overflow.
  const shown = await page.evaluate(() =>
    [...document.querySelectorAll('.toprail .tb')]
      .filter((t) => getComputedStyle(t).display !== 'none')
      .map((t) => t.textContent.trim()));
  expect(shown.join(' ')).toContain('Tools');
  expect(shown.join(' '), 'GitHub and Donate fold away below 1024').not.toContain('GitHub');
});

test('the system card is not painted under the panel on a folding phone', async ({ page }) => {
  /* This is the exact corruption from the owner's screenshots: the card's left
     edge ran under the opaque panel, so the system's name lost its first
     characters and SURFACE TEMP read "URFACE TEMP". */
  await open(page, 752, 650);

  await page.evaluate(() => {
    const i = System.points.findIndex((p) => p && p.name && p.visible);
    Action.moveToObj(i, System.points[i]);
  });
  await expect(page.locator('.card')).toBeVisible();

  const m = await page.evaluate(() => {
    const c = document.querySelector('.card').getBoundingClientRect();
    const s = document.querySelector('.side');
    const sb = s.getBoundingClientRect();
    return {
      cardLeft: c.left, cardRight: c.right, panelRight: sb.right,
      panelShown: getComputedStyle(s).display !== 'none',
      cardZ: +getComputedStyle(document.querySelector('.card')).zIndex,
      sideZ: +getComputedStyle(s).zIndex,
      vw: window.innerWidth
    };
  });

  expect(m.cardLeft, 'the card must start clear of the panel').toBeGreaterThanOrEqual(m.panelRight);
  expect(m.cardRight, 'and end inside the window').toBeLessThanOrEqual(m.vw + 1);
  /* Belt and braces: if a narrower window ever does overlap them, the card has
     to win, because the panel is opaque. */
  expect(m.cardZ, 'the card outranks the panel').toBeGreaterThan(m.sideZ);
});

test('a short window compacts the chrome rather than squeezing the map', async ({ page }) => {
  /* The folding-phone lesson: unfolding buys width and spends height, so every
     rule keyed on width alone left the unfolded screen looking like the cover
     screen. This one keys on height, which also catches a short laptop
     window. */
  await open(page, 900, 420);
  const rows = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.app')).gridTemplateRows);
  const [top, , strip] = rows.split(' ').map(parseFloat);

  expect(top, 'the header compacts from 44px').toBeLessThan(44);
  expect(strip, 'and the status strip from 30px').toBeLessThan(30);

  const cardMax = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.card')).maxHeight);
  expect(parseFloat(cardMax), 'the card is bounded by the window, not by a fixed reserve')
    .toBeLessThan(420);
});

test('Escape dismisses the card, then the panel', async ({ page }) => {
  /* Escape reached only the palette and the index scrim, so on a narrow window
     — where the panel covers the map outright — the two things actually in the
     way could not be dismissed from the keyboard at all. One layer per press,
     innermost first, so it never closes more than was asked. */
  await open(page, 360, 670);

  await page.evaluate(() => {
    const i = System.points.findIndex((p) => p && p.name && p.visible);
    Action.moveToObj(i, System.points[i]);
  });
  await expect(page.locator('.card')).toBeVisible();

  const hidden = () => page.evaluate(() => ({
    card: document.getElementById('card').classList.contains('hidden'),
    panel: document.getElementById('side').classList.contains('hidden')
  }));

  expect(await hidden()).toEqual({ card: false, panel: false });

  await page.keyboard.press('Escape');
  expect(await hidden(), 'the card goes first').toEqual({ card: true, panel: false });

  await page.keyboard.press('Escape');
  expect(await hidden(), 'then the panel').toEqual({ card: true, panel: true });
});

test.describe('touch', () => {
  /* pointer:coarse is driven by the context's hasTouch, not by the viewport
     size — setViewportSize alone leaves the media query false, so the
     assertions below would have been measuring a mouse. */
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 780 } });

  test('touch gets targets it can actually hit', async ({ page }) => {
    /* Not one control in the console met 44x44. These are the ones a commander
       has to hit while holding the thing in one hand. */
    await stubDataHosts(page);
    await page.goto(PAGE, { waitUntil: 'load' });
    await waitForScene(page, expect);

    expect(await page.evaluate(() => matchMedia('(pointer:coarse)').matches),
      'the context must really be coarse or this asserts nothing').toBe(true);

    /* The offline stub answers every data host with [], so this page has no
       categories and therefore no .layer rows. Give it one — the row is a
       primary touch target and its height is the thing being asserted. */
    await page.evaluate(() => new Promise((done) => Ed3d.updateSystems({
      categories: { 'Site type': { a: { name: 'Alpha', color: 'FF9D00' } } },
      systems: [{ name: 'Touchholm', coords: { x: 5, y: 0, z: 5 }, cat: ['a'] }]
    }, done)));
    await expect(page.locator('.layer').first()).toBeVisible();

    const sizes = await page.evaluate(() => {
      const of = (s) => {
        const e = document.querySelector(s);
        if (!e) return null;
        const b = e.getBoundingClientRect();
        return { w: Math.round(b.width), h: Math.round(b.height) };
      };
      return {
        rail: of('.rail button'),
        nav: of('#nav-controls .nav-btn'),
        layer: of('.layer'),
        viewmode: of('.viewmode button')
      };
    });

    expect(sizes.rail.w, 'rail buttons').toBeGreaterThanOrEqual(44);
    expect(sizes.rail.h).toBeGreaterThanOrEqual(44);
    expect(sizes.nav.w, 'camera buttons').toBeGreaterThanOrEqual(44);
    expect(sizes.nav.h).toBeGreaterThanOrEqual(44);
    expect(sizes.layer.h, 'layer rows').toBeGreaterThanOrEqual(44);
    expect(sizes.viewmode.h, 'the 3D/2D toggle').toBeGreaterThanOrEqual(36);
  });
});
