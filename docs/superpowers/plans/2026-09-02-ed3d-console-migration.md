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

---

## Redirects: mostly unnecessary

Measured against the live nav: **96 links resolve to only 29 distinct HTML files.**
62 of the 91 internal links are the same page with different query parameters —
`codex.html` alone serves **51** nav entries (every Biology, Geology and Cloud
species). `multifaction.html` serves 6, the combos 3 each.

So the site is already "one page, many params" for the bulk of its surface. Since
every page keeps its filename in this plan, **no redirects are needed**. If a page
is retired later, a three-line `<meta http-equiv="refresh">` shim at the old
filename is enough, and can be added per page as the need arises.

---

## Data fetching: one map dominates everything

Measured on the live site, 2026-09-02, on the default map:

| | Cold | Warm HTTP cache |
|---|---|---|
| `factions.json.gz` response | 882 ms | 178 ms |
| Data ready | 5,574 ms | 3,289 ms |
| **Decompress + parse + build** | **4,692 ms** | **3,111 ms** |

The dump is **16.6 MB gzipped**, fetched on every visit to the landing page to
render 4,147 systems for two factions. Total page weight is **16.8 MB**; the next
largest asset is a 247 KB texture.

**The download is not the bottleneck.** Spansh already sends
`cache-control: max-age=86400` with an ETag, and the fetch does not bust it, so
repeat visits are served from cache — and still cost **3.1 seconds**, because the
client decompresses and parses the whole dump every single load.

Why the whole dump: it is needed twice over — to filter to the requested factions,
and to build `allFactionNames` for the sidebar's faction-search autocomplete.
Fetching one faction is therefore not a drop-in fix.

There is no per-faction endpoint on Canonn's cloud functions today (`/query/factions`
returns 400), and `elitebgs.app` timed out when tested, so a server-side fix needs
new work in Canonn-GCloud — LCU No Fool Like One's domain, not this plan's.

**What this plan can do client-side**, in order of payoff:

1. **Cache the derived result, not the response.** Store the filtered systems and
   the faction-name list in IndexedDB keyed by the dump's ETag. A warm visit then
   costs ~0 ms instead of 3.1 s. This is the single biggest win available.
2. **Defer the autocomplete list.** `allFactionNames` is only needed when the
   faction search box is focused. Building it on demand removes it from the
   critical path.
3. **Reconsider the landing page.** Every first-time visitor to map.canonn.tech
   pays this cost before seeing anything. Worth asking whether multifaction should
   be the default at all — see Open Questions.

---

## The loading overlay is a contract, not a detail

Worth knowing before any page is touched: **the engine never dismisses the
loader.** Every one of the 35 `MapData-*.js` files ends its load with

```js
document.getElementById('loading').style.display = 'none';
```

on its success path *and* its error path. Nothing in `Source/js/` references
`#loading` at all. So that id is an interface between the pages and the data
layer — drop the element while re-doing a page's chrome and the map sits behind
a black screen with nothing in the console.

The console therefore keeps `id="loading"`, and moves the fade into a
MutationObserver watching for the callers' `display:none`. Zero data files
change. `test/boot.spec.mjs` asserts the contract across all 35.

Two loaders exist today. `index.html`, `multifaction.html`, `galnet.html` and
`gec.html` use the Lottie **R&D animated logo** (`data/rd-banner-v2-1.json` via
`vendor/bodymovin`, 654 KB together). The other 31 pages use
`img/Canonn-Logo.gif` — **3.65 MB**, 800x800, ~300 frames, displayed at 300x300.

That GIF is the second-largest asset on the site after the faction dump, and it
is downloaded before the map starts. Standardising every page on the Lottie
(now the console's boot screen) removes 3.65 MB from 31 pages and costs 654 KB
on those that don't already load it — a net win everywhere, and the loader
becomes consistent as a side effect.

The animation is a 15 s build-and-fade, so it needs driving rather than looping
from the top: frame 0 is empty, the atom assembles by ~300, and it fades at
~440. The console plays the assembly once and then loops the formed logo.

---

## Worth a look later: DarkSession's rewrite

https://github.com/DarkSession/CanonnED3D-Map-DCoH-v2

Not a GitHub fork — a standalone TypeScript + webpack rewrite of Ed3d,
published to npm as `canonned3d-map` v0.1.8. Nine commits, all in January 2023,
dormant since. Same class structure as ours but **fewer** features (no Route,
Grid, Heatmap or Ico), and on three 0.148 where we are on 0.185.

Adopting it wholesale would mean a build step, which was declined on purpose,
so this is a source of ideas rather than code.

**The idea worth taking: its event bus.** `ED3DMap` emits `init`, `render`,
`enableFarView`, `disableFarView` and `systemHoverChanged` through `emittery`,
and components subscribe. That is directly relevant here — `js/console.js`
polls the engine instead, on a 250 ms interval for the status strip and another
for `Action.selectedPoint`. Events would replace both polls, and the idea ports
without any of the TypeScript. Good candidate for after the rollout.

It also carries `src/dcoh_historical.html`, a historical DCoH map we do not have.

It does **not** fix the selection-cursor artifact: its cursor is the same
ring-and-cone build as `action.class.js:583`, an outer cone and an inner black
cone 0.2 apart with no depth bias. Ours is 20 / 20.2, theirs 12.5 / 12.7 — the
same latent z-fighting, so there is nothing to copy for that one.

## Open questions for Derrick

1. **Does the console replace `include/nav.html`, or coexist with it?** The plan
   assumes replace. The nav is a two-row bar of 10 top-level items with three
   levels of hover cascade beneath — 96 links, 1,300 px tall when fully expanded.
   The map switcher and ⌘K cover the same ground without the cascade, and it is
   what the redesign set out to remove. Still a visible change on every page, so
   it is your call.
2. **Do the combo pages survive?** `aliens-combo`, `guardians-combo`, `thargoids-combo` load two data files each. They work, but the layer panel's group headers may make them redundant now.
3. **`dcoh_headless.html`** exists to be embedded in an iframe. Should it get the chrome at all, or stay bare?
**Settled:** multifaction stays the landing page.

4. **Should multifaction stay the landing page?** ~~Open~~ — keeping it. It costs every first-time
   visitor 5.6 s (3.1 s even warm) before anything renders, because of the 16.6 MB
   Spansh dump. A lighter default would make the site feel dramatically faster;
   keeping it means fixing the caching first.

**Settled:** full conversion, all pages at once on the branch (not staged behind
the live site). No redirects needed — see above.
