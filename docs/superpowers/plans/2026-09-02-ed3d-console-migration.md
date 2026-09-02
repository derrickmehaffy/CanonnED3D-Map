# ED3D Console Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Promote the console from `Source/prototype/` to the real interface for all 36 map pages, without breaking a single existing URL.

**Architecture:** The console chrome becomes **generic**. It captures each map's categories by wrapping `HUD.initFilters`, and reads counts from `Ed3d.catObjs` and systems from `System.points` — so the layer panel, systems list and card work on any map with **zero per-map configuration**. The 35 `MapData-*.js` files are not rewritten: they keep building `systemsData` and calling `Ed3d.init()`, and the console simply supplies chrome around whatever they produce. Each page keeps its own URL and its own data file; only its HTML shell changes.

**Spec:** `docs/design/2026-09-01-ui-modernization-research.md`
**Prototype:** `Source/prototype/console.html` — the design this generalises

## Global Constraints

- **No existing URL may break.** `map.canonn.tech/ts-data.html` and the other 35 are linked from canonn.science, Discord, the wiki and people's bookmarks. Pages keep their filenames.
- No build step. `Source/` deploys verbatim. `package.json` stays `devDependencies` only.
- `.github/workflows/mainl.yml` untouched.
- **Do not rewrite the `MapData-*.js` files.** They are the data contract and several are community-contributed. Only `MapData-Hyperdiction.js` has been touched to date, and only to use `System.findByName()`.
- three.js stays at r185 (`three@0.185.0`) via the existing import map.
- Suite baseline: **46 passed, 3 skipped, 0 failed.**

## The default map

`map.canonn.tech/` was inspected live on 2026-09-02:

| | |
|---|---|
| Data file | `data/MapData-multifaction.js` |
| URL | self-rewrites to `?factions=Canonn,Canonn Deep Space Research` via `history.replaceState` |
| Systems | 4,147 |
| Categories | 4 — `f0c` 1825, `f0p` 1630, `f1c` 306, `f1p` 385 |
| Camera | `[-10000, 40000, 50000]` |

The console must default to exactly this. Note the category ids are **arbitrary strings** (`f0c`), not the numeric scheme the prototype assumed — which is why the generic capture below is required rather than optional.

## Why the chrome can be generic

Verified across five deliberately different maps by wrapping `HUD.initFilters`:

| Page | Groups | Categories | Systems |
|---|---|---|---|
| `voyager.html` | 3 | 4 | 16 |
| `listening_posts.html` | 1 | 2 | 307 |
| `canonn-challenge.html` | 1 | 2 | 125 |
| `permit-data.html` | 2 | **18** | 1,813 |
| `gec.html` | 1 | 17 | 638 |

Every one yielded category ids, names, colours and live counts with no per-map code. That is the whole basis of this plan: the migration is a **shell swap per page**, not 35 data ports.

---

### Task 1: Generalise the console chrome

**Files:**
- Create: `Source/js/console/shell.js`, `Source/js/console/shell.css`
- Modify: `Source/prototype/console.html` (becomes a thin consumer, proving the shared shell)
- Test: `test/console.spec.mjs`

The prototype hardcodes three maps, a numeric `catBase`, and its own `DATA.sys` snapshot. All three go.

- [ ] **Step 1: Write the failing test**

```js
import { test, expect } from '@playwright/test';
import { stubDataHosts, waitForScene } from './helpers.mjs';

// One assertion per map shape the generic panel has to survive.
for (const [page, groups, cats] of [
  ['/voyager.html', 3, 4],
  ['/listening_posts.html', 1, 2],
  ['/permit-data.html', 2, 18]
]) {
  test(`console reads categories generically on ${page}`, async ({ page: pg }) => {
    await stubDataHosts(pg);
    await pg.goto('/prototype/console.html?src=' + encodeURIComponent(page), { waitUntil: 'load' });
    await waitForScene(pg, expect);
    await expect
      .poll(() => pg.evaluate(() => window.EdConsole && window.EdConsole.categoryCount()), { timeout: 60_000 })
      .toBe(cats);
    expect(await pg.evaluate(() => window.EdConsole.groupCount())).toBe(groups);
  });
}
```

- [ ] **Step 2: Run it and watch it fail** — `window.EdConsole` does not exist yet.

- [ ] **Step 3: Capture categories generically**

In `shell.js`, before `Ed3d.init()` runs, wrap the HUD:

```js
var captured = {};
(function hook() {
  if (typeof HUD === 'undefined') { setTimeout(hook, 20); return; }
  var orig = HUD.initFilters.bind(HUD);
  // Ed3d hands the raw categories object straight to the HUD and keeps no copy
  // of its own, so this is the only place to see it. initFilters is called
  // again for every addBatch(), hence merging rather than assigning.
  HUD.initFilters = function (cats) { Object.assign(captured, cats); render(); return orig(cats); };
})();
```

Expose `window.EdConsole = { categoryCount, groupCount, categories: () => captured }`.

- [ ] **Step 4: Drive the layer panel from the captured categories**

For each group, for each `[id, {name, color}]`: label `name`, swatch `#color`, count `(Ed3d.catObjs[id] || []).length`. Toggling reuses the existing `setCatVisible(id, on)`, which already works on arbitrary ids.

Delete `catBase`, `TYPES`, and the numeric assumptions.

- [ ] **Step 5: Drive the systems list from `System.points`**

The prototype reads its own grouped snapshot. Replace with `System.points`, grouping by name so a system with several entries is one row, and deriving the wedge colours from each point's categories.

- [ ] **Step 6: Move per-map extras into an opt-in registry**

Guardian Ruins' template maps become one entry keyed by data file, not a branch in the core:

```js
var EXTRAS = {
  'MapData-GR.js': { templates: { alpha: '…', beta: '…', gamma: '…' }, notes: { … } }
};
```

Everything else gets the generic panel and loses nothing.

- [ ] **Step 7: Suite green, then commit** — expect 46 + 3 new.

---

### Task 2: Convert three pilot pages at their real URLs

**Files:** `Source/gr-data.html`, `Source/gs-data.html`, `Source/gb-data.html`

- [ ] **Step 1: Establish the page template**

Each page keeps its filename, its `MapData-*.js` and its `canonnEd3d_*.init()` call. Only the shell changes: the console markup, `js/console/shell.css`, and `js/console/shell.js` in place of the old `#hud`. `Ed3d.init` gains `withHudPanel: false, withOptionsPanel: false`; the data file supplies everything else as it does today.

- [ ] **Step 2: Verify each renders, filters, and picks**

`npm run serve`, then open all three. Confirm: systems render, the layer panel lists that map's real categories with correct counts, toggling filters the map, clicking a system opens the card, and lcunfool's arrows still work.

- [ ] **Step 3: Confirm the old URLs still resolve** — the filenames are unchanged, so `map.canonn.tech/gr-data.html` keeps working. State this explicitly in the report.

- [ ] **Step 4: Commit**

---

### Task 3: Roll out by group

Convert in batches, running `npm test` after each. Batches follow the nav's own grouping so a regression is easy to localise:

- [ ] Guardian — `bt-data`
- [ ] Thargoid — `ts-data`, `tb-data`, `hyperdiction_data`, `nhss-data`, `ts-msg_3305survey`, `route_uia`
- [ ] Cartographics — `gec`, `gen-data`, `megaships-data`, `listening_posts`, `voyager`, `galnet`, `permit-data`, `ida-data`
- [ ] Routes — `canonn-challenge`, `gnosis_data`, `route_adamastor`, `route_data`
- [ ] Codex — `codex`, `cloud_data`, `landscape_signal`
- [ ] Remaining — `cmdr`, `carrier_data`, `colonisation_data`, `prison_data`, `dcoh`, `dcoh_headless`, `multifaction`, the combos

**Two pages need hand conversion:** `ida-data.html` has standalone-mode logic that strips the nav and rewrites `#edmap` sizing, and `index.html` self-rewrites its URL. Everything else is mechanical.

**Eight data files read URL parameters** — `Gnosis`, `Prisons`, `Carriers`, `Cloud`, `Route`, `DCOH`, `multifaction`, `Colonisation`. Their pages must keep passing the query string through untouched.

---

### Task 4: index.html and the map registry

- [ ] **Step 1: Make index.html the console on the default map**

It keeps `MapData-multifaction.js` and its `history.replaceState` default of `?factions=Canonn,Canonn Deep Space Research`, matching the live site exactly. Verify against `map.canonn.tech`: 4,147 systems, 4 categories, camera `[-10000, 40000, 50000]`.

- [ ] **Step 2: Generate the map index from a real registry**

`Source/js/console/maps.js` lists every page: filename, display name, group, one-line description. The index and the ⌘K palette both read it, so adding a map means one entry rather than editing two hardcoded lists. Generate the first version from `include/nav.html` so nothing is missed.

- [ ] **Step 3: Decide the nav's fate — needs Derrick's call, see Open Questions**

---

### Task 5: Retire the prototype and the old HUD panel

- [ ] Delete `Source/prototype/` once every page is on the shared shell.
- [ ] Remove the `#hud` panel branch from `hud.class.js` (everything after `if (!Ed3d.withHudPanel) return;`) only once nothing sets `withHudPanel: true`. Keep `initHudAction` — the nav arrows live there.
- [ ] Full suite, manual pass over a sample of each group, commit.

---

## Exit criteria

- [ ] All 36 pages render through the shared console shell
- [ ] Every existing URL still resolves to the same map
- [ ] `index.html` matches the live default: multifaction, Canonn + CDSR, 4,147 systems
- [ ] The layer panel shows correct categories and counts on every map, with no per-map code beyond `EXTRAS`
- [ ] `Source/prototype/` is gone
- [ ] 35 of 35 `MapData-*.js` files unmodified by this plan
- [ ] `npm test` green

## Open questions for Derrick

1. **Does the console replace `include/nav.html`, or coexist with it?** The plan assumes replace — the map switcher and ⌘K make the 102-link hover menu redundant, and it is the thing the redesign set out to remove. But that is a visible change on every page and is your call.
2. **Do the combo pages survive?** `aliens-combo`, `guardians-combo`, `thargoids-combo` load two data files each. They work, but the layer panel's group headers may make them redundant now.
3. **`dcoh_headless.html`** exists to be embedded in an iframe. Should it get the chrome at all, or stay bare?
4. **Ordering:** roll out group by group behind the live site, or convert everything on the branch and merge once? The plan assumes the latter.
