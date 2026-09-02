# ED3D Phase 1 — ES Module Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the map's own JavaScript to ES modules while still running on the existing global `THREE` (r75), so that when three.js is swapped in Phase 2 any breakage is unambiguously attributable to the version bump rather than to modularization.

**Architecture:** A new entry module `Source/js/main.js` statically imports every engine file and publishes the existing globals onto `window` before anything initialises. Cross-references *between* engine files are deliberately **not** converted to imports — they keep resolving as globals at call time. This keeps the change mechanical and avoids untangling the circular relationships between `Ed3d`, `HUD`, `Action`, and `System`, which is Phase 2's problem, not Phase 1's.

**Tech Stack:** Native ES modules, no bundler. three.js r75 still loaded as a classic CDN script (Phase 2 replaces it with an import map).

**Spec:** `docs/superpowers/specs/2026-09-01-ed3d-modernization-design.md` (decision D4)

## Global Constraints

- **No build step.** `Source/` continues to deploy verbatim. Node is for tests only.
- Do NOT modify `.github/workflows/mainl.yml`. `package.json` stays `devDependencies` only.
- **Stay on three.js r75.** This phase must not change the three.js version, add an import map, or touch any `THREE.*` API. Phase 2 does that.
- Tests assert only on `window.__ed3dTestState()`.
- The default `npm test` must contact zero external data hosts.
- **The 30 `Source/data/MapData-*.js` files must keep working unchanged.** 15 of them reach into engine globals (`scene`, `camera`, `controls`, `System`, `HUD`, `Action`, `Galaxy`, `Route`) and 4 construct `THREE` objects directly. They stay classic scripts.
- Baseline to beat: `npm test` is **41 passed, 3 skipped, 0 failed**. It must stay there.

---

## Why cross-references stay global

Every engine file defines one singleton (`var Grid`, `var HUD`, `var Action`, …) and calls the others by bare name. In a module, `var Grid` is module-scoped, so a bare `Grid` elsewhere would throw.

Rather than adding imports everywhere — which would create genuine import cycles, since `Ed3d` ↔ `HUD` ↔ `Action` all reference each other — `main.js` assigns every singleton to `window` immediately after import and before any `init()` runs. Bare references resolve against the global object at **call** time, and nothing cross-references at module-evaluation time (verified: every file's top level is an object literal; the only eval-time dependency is `Ed3d.material`, which needs `THREE`, already a global).

This is the same compatibility posture the spec chose for the data files (decision D2), applied one layer inward.

---

### Task 1: Convert engine JS to modules and wire a pilot page

**Files:**
- Modify: `Source/js/components/{grid,icon,hud,action,route,system,galaxy,heat}.class.js` (add `export`)
- Modify: `Source/js/codex-overlay.js` (add `export`)
- Modify: `Source/js/ed3dmap.js` (add `export`, delete the `$.getScript` waterfall, convert the codex-overlay lazy load to dynamic `import()`)
- Create: `Source/js/main.js`
- Modify: `Source/voyager.html` (pilot only)

**Interfaces:**
- Produces: `Source/js/main.js`, a module with no exports, run as `<script type="module" src="js/main.js">`. It imports every engine singleton and assigns to `window`: `THREE` is already global; it publishes `Ed3d`, `Grid`, `Ico`, `HUD`, `Action`, `Route`, `System`, `Galaxy`, `Heatmap`, and the shared engine state (`scene`, `camera`, `controls`, `renderer`, `container`).
- Consumes: nothing new.

- [ ] **Step 1: Add exports to the eight component files and codex-overlay**

Each file currently ends with its singleton object. Append an export to each, keeping the existing `var` declaration untouched:

| File | Add at end of file |
|---|---|
| `components/grid.class.js` | `export { Grid };` |
| `components/icon.class.js` | `export { Ico };` |
| `components/hud.class.js` | `export { HUD };` |
| `components/action.class.js` | `export { Action };` |
| `components/route.class.js` | `export { Route };` |
| `components/system.class.js` | `export { System };` |
| `components/galaxy.class.js` | `export { Galaxy };` |
| `components/heat.class.js` | `export { Heatmap };` |
| `codex-overlay.js` | `export { CanonnCodexOverlay };` |

Do not otherwise restructure these files.

- [ ] **Step 2: Fix the `this` bindings that strict mode breaks — do this FIRST**

**This is the one change that will break the map instantly if missed.** ES modules
are always strict mode. In sloppy mode a plain function call binds `this` to
`window`; in strict mode it binds `undefined`.

Three top-level functions in `Source/js/ed3dmap.js` rely on the sloppy behaviour:

- `function animate(time)` — uses `this.Action.updateCursorSize`,
  `this.Action.sizeOnScroll`, `this.Galaxy.infosUpdateCallback`,
  `this.Action.updatePointClickRadius`
- `function enableFarView(scale, withAnim)` — uses `this.Galaxy` throughout
- `function disableFarView(scale, withAnim)` — same

`animate` is invoked as a bare `animate()` and via `requestAnimationFrame(animate)`,
so in a module `this` is `undefined` and the **first rendered frame throws a
TypeError**. Nothing else in the file would even get a chance to fail.

In the bodies of those three functions only, replace `this.Action` with `Action`
and `this.Galaxy` with `Galaxy` — the module-level imports added in Step 4.

```bash
# Inspect first; these are all inside the three functions above.
grep -n "this\.\(Action\|Galaxy\)" Source/js/ed3dmap.js
```

**Do NOT blanket-replace across the file.** Occurrences inside `Ed3d`'s own
methods (`initObjects`, `rebuild`, `launchMap`, `loadDatasComplete`, and the
`this.Galaxy.milkyway2D` line inside `launchMap`) are called as `Ed3d.method()`,
so `this` is correctly `Ed3d` there and must stay untouched. The boundary is
whether the enclosing function is a property of the `Ed3d` object literal or a
standalone `function` declaration.

Verify afterwards that no standalone function still uses `this`:

```bash
node --input-type=module -e "import('./Source/js/ed3dmap.js').catch(e=>{console.log('expected in node (no DOM):',e.message)})" 2>&1 | head -3
```

That import will fail in Node for lack of a DOM, which is fine — you are only
checking it is not a *syntax* error.

- [ ] **Step 3: Export the engine state and `Ed3d` from `ed3dmap.js`**

At the end of `Source/js/ed3dmap.js`, add:

```js
export { Ed3d, Loader, animate, render, refresh3dMapSize, distance, distanceFromTarget };
export function getEngineState() {
  return { scene: scene, camera: camera, controls: controls, renderer: renderer, container: container };
}
```

`scene`/`camera`/`controls`/`renderer`/`container` are assigned inside `initScene()`, so they cannot be exported as live bindings that the data files can read via `window` — `getEngineState()` is called *after* init to publish them. Step 4 wires that up.

- [ ] **Step 4: Replace the `$.getScript` waterfall with static imports**

In `Source/js/ed3dmap.js`, `Ed3d.init` currently loads eleven files through two nested `$.when($.getScript(...))` blocks. Every one of those files is now imported statically by `main.js`, so the whole waterfall is dead.

Replace the body of `'init': function (options) {` — from the `//-- Load dependencies` comment through the closing of the outer `.done(...)` chain — with:

```js
    // Dependencies are now static ES module imports in js/main.js; there is
    // nothing left to load at runtime.
    Loader.update('Launch scene');
    Ed3d.launchMap();
    if (typeof options.finished === "function") options.finished();
```

Keep everything above that comment (the `$.extend` of options and the `#ed3dmap` container append) exactly as it is. Delete the now-unused `isMinified` early return.

At the top of `ed3dmap.js`, add the imports it needs by name:

```js
import { Grid } from './components/grid.class.js';
import { Ico } from './components/icon.class.js';
import { HUD } from './components/hud.class.js';
import { Action } from './components/action.class.js';
import { Route } from './components/route.class.js';
import { System } from './components/system.class.js';
import { Galaxy } from './components/galaxy.class.js';
import { Heatmap } from './components/heat.class.js';
```

`vendor/three-js/OrbitControls.js`, `vendor/three-js/FontUtils.js`, `vendor/three-js/helvetiker_regular.typeface.js` and `vendor/tween-js/Tween.js` all attach to the global `THREE`/`TWEEN` and are not ES modules. They stay classic `<script>` tags — Step 5 adds them to the page.

- [ ] **Step 5: Create the entry module `Source/js/main.js`**

```js
// Entry module. Imports every engine singleton and republishes it on window
// before anything initialises.
//
// Engine files call each other by bare name (HUD.create(), System.count, ...)
// and the 30 data files in Source/data/ do the same. Rather than converting
// those into imports — which would create real cycles, since Ed3d, HUD and
// Action all reference each other — every singleton is assigned to window
// here. Bare references resolve against the global object at call time, and
// nothing cross-references at module-evaluation time.
//
// This is the same compatibility posture the design doc chose for the data
// files, applied one layer inward. Phase 2 may tighten it; Phase 1 does not.

import { Ed3d, Loader, getEngineState } from './ed3dmap.js';
import { Grid } from './components/grid.class.js';
import { Ico } from './components/icon.class.js';
import { HUD } from './components/hud.class.js';
import { Action } from './components/action.class.js';
import { Route } from './components/route.class.js';
import { System } from './components/system.class.js';
import { Galaxy } from './components/galaxy.class.js';
import { Heatmap } from './components/heat.class.js';

Object.assign(window, {
  Ed3d: Ed3d,
  Loader: Loader,
  Grid: Grid,
  Ico: Ico,
  HUD: HUD,
  Action: Action,
  Route: Route,
  System: System,
  Galaxy: Galaxy,
  Heatmap: Heatmap
});

// scene/camera/controls/renderer/container are created inside initScene(), so
// they cannot be published until after launchMap() runs. Ed3d.launchMap is
// wrapped to republish them the moment they exist — the data files read them
// as globals.
var originalLaunchMap = Ed3d.launchMap;
Ed3d.launchMap = function () {
  var result = originalLaunchMap.apply(this, arguments);
  Object.assign(window, getEngineState());
  return result;
};

// Signal that the engine is ready. Pages call their data file's init() from a
// DOMContentLoaded handler, which fires after all deferred scripts, so this
// has always run by then.
window.__ed3dReady = true;
```

- [ ] **Step 6: Convert the pilot page `Source/voyager.html`**

Replace the classic engine script tag and the init block. The ordering matters: `<script type="module">` and `<script defer>` both execute after parsing **in document order**, and `DOMContentLoaded` fires after both — so the module runs first, then the data file, then the init.

Change:

```html
    <script src="js/ed3dmap.js?v=6"></script>
```

to:

```html
    <script src="vendor/three-js/OrbitControls.js"></script>
    <script src="vendor/three-js/FontUtils.js"></script>
    <script src="vendor/three-js/helvetiker_regular.typeface.js"></script>
    <script src="vendor/tween-js/Tween.js"></script>
    <script type="module" src="js/main.js?v=7"></script>
```

Change:

```html
    <script src="data/MapData-Voyager.js"></script>
```

to:

```html
    <script defer src="data/MapData-Voyager.js"></script>
```

Change the inline init:

```html
      canonnEd3d_voyager.init();
```

to:

```html
      document.addEventListener('DOMContentLoaded', function () {
        canonnEd3d_voyager.init();
      });
```

- [ ] **Step 7: Verify the pilot page boots**

Run: `npx playwright test test/hook.spec.mjs test/perf.spec.mjs --project=offline`

These all drive `voyager.html` (it is `REFERENCE_PAGE`). Expected: all pass. If the scene never becomes visible, check the browser console for a module resolution error or a `ReferenceError` on a bare global — those are the two expected failure modes.

- [ ] **Step 8: Run the full suite**

Run: `npm test`

Expected: **35 of 36 pages still use the old classic loading**, so they must still pass unchanged — the engine files are now modules, but the old `<script src="js/ed3dmap.js">` tag on those pages will fail to parse an `import` statement.

**This step is expected to FAIL for the 35 unconverted pages.** That is the point of the pilot: it proves the module path works before the rollout. Record which pages fail and confirm the failure is the expected "unexpected token 'export'" / "Cannot use import statement outside a module" syntax error, not something else.

- [ ] **Step 9: Commit**

```bash
git add Source/js test/
git commit -m "refactor: convert engine JS to ES modules, pilot on voyager.html

Adds js/main.js as the entry module. Engine singletons are republished on
window so the 30 data files and the engine's own cross-references keep
resolving as globals — deliberately not untangled here.

Deletes the nested \$.getScript waterfall in Ed3d.init; every file it
loaded is now a static import.

Still on three.js r75. Only voyager.html is converted; the other 35 pages
are rolled over in the next task and fail until then."
```

---

### Task 2: Roll out to the remaining 35 pages

**Files:**
- Modify: the other 35 `Source/*.html`

**Interfaces:**
- Consumes: `Source/js/main.js` from Task 1.
- Produces: all 36 pages on the module entry.

- [ ] **Step 1: Inventory the variation**

The pages are near-identical but the data-file name and init call differ, and a few have extra logic. Before scripting anything, list every distinct shape:

```bash
grep -l "js/ed3dmap.js" Source/*.html | while read f; do
  echo "=== $f"; grep -nE "ed3dmap\.js|data/MapData-|canonnEd3d_[a-z]+\.init" "$f"
done
```

Note any page whose init is not a bare `canonnEd3d_X.init();` — those need hand conversion, not a scripted one.

- [ ] **Step 2: Convert the pages**

Apply the same three changes as the pilot to each page. Script the mechanical majority, hand-convert the rest. After each batch, re-run `npm test` so a mistake is caught against a small diff rather than 35 files at once.

Do not change anything else on these pages.

- [ ] **Step 3: Verify no page still loads the old entry**

```bash
grep -l "js/ed3dmap.js" Source/*.html || echo "no page uses the old entry"
grep -l "js/main.js" Source/*.html | wc -l
```

Expected: `no page uses the old entry`, then `36`.

- [ ] **Step 4: Full suite green**

Run: `npm test`
Expected: **41 passed, 3 skipped, 0 failed** — back to the Phase 0 baseline.

If a page fails, the likely causes in order: a data file that ran before the module (check `defer` and the `DOMContentLoaded` wrapper), a bare global the compat layer does not publish (check the browser console for `ReferenceError` and add it to `main.js`), or a page-specific inline script that assumed synchronous execution.

- [ ] **Step 5: Commit**

```bash
git add Source
git commit -m "refactor: move the remaining 35 pages onto the ES module entry"
```

---

### Task 3: Remove the jQuery dependency loader remnants

**Files:**
- Modify: `Source/js/ed3dmap.js`
- Modify: `test/README.md`

- [ ] **Step 1: Convert the codex-overlay lazy load to a dynamic import**

`loadDatasComplete` still uses `$.getScript` to fetch `js/codex-overlay.js` on demand. Replace it with a dynamic `import()`:

```js
        Ed3d._codexOverlayTriggered = true;
        import('./codex-overlay.js').then(function (mod) {
          mod.CanonnCodexOverlay.loadIfNeeded();
        });
```

- [ ] **Step 2: Confirm no `$.getScript` remains**

```bash
grep -n "getScript" Source/js/*.js Source/js/components/*.js || echo "none remaining"
```
Expected: `none remaining`

- [ ] **Step 3: Note the state in the test README**

Add a short section recording that the engine is ES modules on r75, that `main.js` is the entry, and that the data files are deliberately still classic scripts reading globals.

- [ ] **Step 4: Full suite and commit**

Run: `npm test` — expected 41 passed, 3 skipped, 0 failed.

```bash
git add Source/js test/README.md
git commit -m "refactor: drop the last \$.getScript call for a dynamic import"
```

---

## Phase 1 exit criteria

- [ ] `npm test` at 41 passed, 3 skipped, 0 failed
- [ ] No `$.getScript` anywhere in `Source/js/`
- [ ] All 36 pages load `js/main.js` as a module; none loads `js/ed3dmap.js` directly
- [ ] three.js is still r75 from cdnjs — no import map, no version change
- [ ] The 30 `Source/data/MapData-*.js` files are unmodified

## What Phase 2 inherits

Static imports and a single entry point — exactly what an import map (or a bundler, later) needs. The compat layer publishing engine singletons on `window` stays until the data files are migrated, which is not scheduled.
