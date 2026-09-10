/**
 * The Science / Class / Name dropdowns, from js/canonn-filters.js.
 *
 * These loops had no coverage at all before this file: the offline suite
 * answers Canonn's hosts with "[]", so on codex.html, nhss-data.html and
 * cmdr.html the builder ran against an empty hierarchy and appended nothing.
 * The smoke tests therefore proved the page booted, not that a filter was ever
 * built — which is how three copies of it drifted along unexamined.
 *
 * So the hierarchy is handed in directly rather than fetched. It is the same
 * shape the /ref?hierarchy=1 reply has:
 *
 *   { hud_category: { sub_class: { english_name: { platform } } } }
 */
import { test, expect } from '@playwright/test';

const HOST = 'http://localhost:4173';

/** A page holding just the filter container, with the real script on it. */
const SHELL = `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
  <div id="filters">
    <h2>Categories</h2>
    <div id="cats"><a href="#" id="cat-a">A</a><a href="#" id="cat-b">B</a></div>
  </div>
  <script src="/js/canonn-filters.js"></script>
</body></html>`;

/** Deliberately not in alphabetical order, at any of the three levels. */
const HIERARCHY = {
  Geology: {
    Vents: {
      'Water Vent': { platform: 'horizons' },
      'Sulphur Dioxide Vent': { platform: 'odyssey' }
    },
    Fumaroles: {
      'Carbon Dioxide Fumarole': { platform: 'horizons' }
    }
  },
  Biology: {
    Stratum: {
      // Two variants of one name; the dropdown lists the name once.
      'Stratum Tectonicas - Green': { platform: 'odyssey' },
      'Stratum Tectonicas - Grey': { platform: 'odyssey' }
    },
    Bacterium: {
      'Bacterium Aurasus': { platform: 'odyssey' }
    }
  },
  // Every name here is Horizons-only, so an odyssey filter must drop the
  // whole category rather than leave it listed and empty.
  Anomalies: {
    Lagrange: {
      'Luteolum Anomaly': { platform: 'horizons' }
    }
  }
};

const EMPTY_PARAMS = { hud_category: '', sub_class: '', english_name: '', platform: '' };

async function shell(page) {
  await page.route(HOST + '/__filters.html', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: SHELL })
  );
  await page.goto(HOST + '/__filters.html', { waitUntil: 'load' });
  await expect.poll(() => page.evaluate(() => typeof window.CanonnFilters)).toBe('object');
}

/** Build with the given params and read the three dropdowns back. */
function options(page, hierarchy, params) {
  return page.evaluate(
    ([h, p]) => {
      document.querySelectorAll('#filters_form').forEach((f) => f.remove());
      window.CanonnFilters.build(h, p);
      const read = (id) =>
        [...document.querySelectorAll('#select_' + id + ' option')].map((o) => o.value);
      return {
        hud: read('hud_category'),
        sub: read('sub_class'),
        name: read('english_name'),
        selected: [...document.querySelectorAll('#filters_form option')]
          .filter((o) => o.selected && o.value)
          .map((o) => o.value)
      };
    },
    [hierarchy, params]
  );
}

test('the dropdowns come out sorted, grouped by category', async ({ page }) => {
  /* All three loaders called sortObj(hierarchy_data) as a statement and threw
     the result away — it returns a sorted copy rather than sorting in place, so
     the dropdowns came out in whatever order the API happened to send. This is
     the one deliberate behaviour change in the extraction. */
  await shell(page);
  const o = await options(page, HIERARCHY, EMPTY_PARAMS);

  // The leading "" is the -- Science -- / -- Class -- / -- Name -- placeholder.
  expect(o.hud).toEqual(['', 'Anomalies', 'Biology', 'Geology']);

  // The class and name lists are appended category by category, so they read
  // grouped — sorted categories on the outside, sorted classes within each —
  // rather than sorted end to end. Anomalies' one class comes first because
  // Anomalies is the first category, not because L sorts before B.
  expect(o.sub).toEqual(['', 'Lagrange', 'Bacterium', 'Stratum', 'Fumaroles', 'Vents']);
  expect(o.name).toEqual([
    '',
    'Luteolum Anomaly',                    // Anomalies
    'Bacterium Aurasus', 'Stratum Tectonicas', // Biology
    'Carbon Dioxide Fumarole',             // Geology / Fumaroles
    'Sulphur Dioxide Vent', 'Water Vent'   // Geology / Vents
  ]);
});

test('a name with variants is listed once', async ({ page }) => {
  await shell(page);
  const o = await options(page, HIERARCHY, EMPTY_PARAMS);
  expect(o.name.filter((n) => n === 'Stratum Tectonicas')).toHaveLength(1);
  expect(o.name).not.toContain('Stratum Tectonicas - Green');
});

test('a category left empty by a filter is not offered', async ({ page }) => {
  /* The two `found` flags. Asking for Odyssey drops every name under
     Anomalies, and the category must go with them rather than sit in the list
     opening onto nothing. */
  await shell(page);
  const o = await options(page, HIERARCHY, { ...EMPTY_PARAMS, platform: 'odyssey' });

  expect(o.hud).toContain('Biology');
  expect(o.hud).not.toContain('Anomalies');
  expect(o.sub).not.toContain('Lagrange');
  expect(o.name).not.toContain('Luteolum Anomaly');
  // Geology survives on its one Odyssey vent, but its Horizons-only class does not.
  expect(o.hud).toContain('Geology');
  expect(o.sub).not.toContain('Fumaroles');
});

test('a choice already in the URL comes back selected', async ({ page }) => {
  await shell(page);
  const o = await options(page, HIERARCHY, { ...EMPTY_PARAMS, hud_category: 'Biology' });
  expect(o.selected).toEqual(['Biology']);
  // Narrowing to one category narrows the classes under it too.
  expect(o.sub).toEqual(['', 'Bacterium', 'Stratum']);
});

test('the Odyssey box is ticked from the parameters, not from markup', async ({ page }) => {
  await shell(page);
  const ticked = (params) =>
    page.evaluate((p) => {
      document.querySelectorAll('#filters_form').forEach((f) => f.remove());
      window.CanonnFilters.build({}, p);
      return document.getElementById('filters_check_legacy').checked;
    }, params);

  expect(await ticked({ ...EMPTY_PARAMS, platform: 'odyssey' })).toBe(true);
  expect(await ticked(EMPTY_PARAMS)).toBe(false);
});

test('a filter heading hides the block under it and re-clicks its links', async ({ page }) => {
  /* toggleFilterHeader ends by clicking every link in the block it just
     toggled — that is how the HUD's own category filters get re-applied. The
     jQuery version went through .trigger('click'), which runs the handlers and
     then the native method while guarding against hearing its own event twice;
     a plain el.click() fires them once, so the count has to match. */
  await shell(page);
  await page.evaluate(() => {
    window.__clicks = 0;
    document.querySelectorAll('#cats a').forEach((a) =>
      a.addEventListener('click', (e) => { e.preventDefault(); window.__clicks++; })
    );
    window.CanonnFilters.build({}, { hud_category: '', sub_class: '', english_name: '', platform: '' });
  });

  const state = () =>
    page.evaluate(() => ({
      display: getComputedStyle(document.getElementById('cats')).display,
      clicks: window.__clicks
    }));

  expect(await state()).toEqual({ display: 'block', clicks: 0 });

  await page.click('#filters h2');
  expect(await state()).toEqual({ display: 'none', clicks: 2 });

  await page.click('#filters h2');
  expect(await state()).toEqual({ display: 'block', clicks: 4 });
});
