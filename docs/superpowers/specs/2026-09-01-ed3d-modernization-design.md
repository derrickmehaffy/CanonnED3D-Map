# CanonnED3D Map — Modernization Design

**Date:** 2026-09-01
**Status:** Approved design, pending implementation plan
**Scope:** Performance quick wins, ESM conversion, three.js r75 → r185, data loader consolidation
**Explicitly out of scope:** Solar system detail view (deferred until the codebase is modern)

---

## 1. Context

`Source/` is deployed verbatim to GitHub Pages by
[.github/workflows/mainl.yml](../../../.github/workflows/mainl.yml). There is no
`package.json`, no bundler, and no test suite. All dependencies are CDN
`<script>` tags or vendored files.

The renderer is **three.js r75** (mid-2016), loaded from cdnjs on all 50 HTML
pages. Current three.js is **r185** (`three@0.185.0`) — roughly 110 releases.

The project has ~15 contributors, dominated by NoFoolLikeOne (241 commits) and
DMehaffy (116), with a long tail of one- and two-commit drive-by contributions.
**Preserving the low-friction "edit a file and push" contributor workflow is a
first-class constraint**, not a nice-to-have.

---

## 2. Goals

1. Get onto a supported three.js release.
2. Measurably improve frame-time and interaction latency.
3. Consolidate the duplicated per-file data loading.
4. Remove dead code and third-party supply-chain risk.
5. Leave the codebase in a state where a solar system detail view is
   straightforward to add later.

## 3. Non-goals

- The solar system detail view. Feasibility was confirmed (see Appendix A) but
  it is deferred.
- A bundler / build step. See decision D1.
- Rewriting the HUD, the visual design, or the map's feature set.
- Refactoring unrelated to the four goals above.

---

## 4. Decisions

### D1 — ESM + import maps, no build step

Modern three.js ships ESM only; the global-script UMD build is gone. The three
options considered were import maps (no build), Vite (build), and pinning the
last UMD release (~r149).

**Pinning UMD was rejected outright**: `THREE.Geometry` was removed in r131, so
r149 still requires the full `BufferGeometry` rewrite. It pays the entire
migration cost while remaining 36 releases behind on a dead module format.

**Import maps were chosen over Vite** because ESM conversion is a *prerequisite*
for adopting Vite, not an alternative to it. Vite consumes ES modules. If Vite
is wanted later, the migration is: add a config, swap the import map for bare
specifiers. No work done now is wasted then. Given that asymmetry, and the
contributor-friction cost of requiring Node for content edits, import maps win.

```html
<script type="importmap">
{ "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.185.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.185.0/examples/jsm/"
}}
</script>
```

### D2 — `Ed3d` and `THREE` remain published as globals

The 49 `data/MapData-*.js` files are the de-facto public API and are
community-contributed. Measured coupling:

- **44 of 49** touch only `Ed3d.init`, `Ed3d.addBatch`, and config properties
  (`playerPos`, `cameraPos`, `textures`, `material`).
- **4** construct three.js objects directly: `MapData-landscape.js`,
  `MapData-multifaction.js`, `MapData-Permit.js`, `MapData-UIA.js`.
- **1** reaches into engine internals: `MapData-Hyperdiction.js:243` linear-scans
  `System.particleGeo.vertices` by name.

The module entry publishes `window.Ed3d` and `window.THREE`. This keeps 48 of 49
data files working unchanged. Only `MapData-Hyperdiction.js` needs an edit, and
it gets a supported `System.findByName(name)` in place of the vertex scan.

This is a deliberate compatibility layer, not an accident. It is documented as
the supported surface so future contributors know what they may rely on.

### D3 — Playwright smoke tests, devDependencies only

A `package.json` containing only `devDependencies` is added. The deploy remains
`Source/` verbatim; contributors editing a MapData file still just edit and push.
Node is required only to run tests, never to ship a change.

### D4 — Module conversion lands before the version bump

r75 has no ESM build, so these must ultimately land together. But the codebase is
first converted to ES modules that reference the existing global `THREE`, and
verified, *before* three.js is swapped. This separates "did modularization break
it" from "did r185 break it" — worth one extra step across 50 untested pages.

---

## 5. Current-state findings (evidence)

### Performance

| Finding | Location |
|---|---|
| Frame throttle never fires. Guard is `if (n % 1 != 0) return;` where `n` is `Date.getTime()`. An integer mod 1 is always 0. Comment claims "every 5 sec"; it runs every frame. | [ed3dmap.js:1094](../../../Source/js/ed3dmap.js) |
| `new Date()` allocated every frame | ed3dmap.js:1090 |
| Four jQuery selector lookups + DOM writes per frame (`#cx`, `#cy`, `#cz`, `#distsol`) | ed3dmap.js:893-897 |
| `intersectObjects(scene.children)` on every `mousemove` — linear scan of the whole point cloud | action.class.js:187 |
| `renderer.setPixelRatio()` never called | ed3dmap.js:441 |

### Dead code

- `js/ed3dmap.min.js` (161 KB) — referenced by nothing.
- `vendor/three-js/Projector.js`, `CSS3DRenderer.js` — loaded by the `$.getScript`
  waterfall at ed3dmap.js:207-209, used nowhere.
- `vendor/three-js/RaytracingRenderer.js`, `TextGeometry.js`, `ShaderMaterial.js` —
  referenced only by the dead `ed3dmap.min.js`.
- `sortParticles = true` (system.class.js:173, galaxy.class.js:373 & 397) — no-op; the property was
  removed from three.js long before r75.

### Supply chain

- All 50 pages load `https://www.w3schools.com/lib/w3data.js` to inject the nav.
  A third-party script with full DOM access on a production domain, from a host
  that is not a CDN and offers no delivery or integrity guarantee.
- `axios@0.19.0` (2019) on all 50 pages, used by 18 data files. Every use is a
  plain GET; native `fetch` replaces it. The dependency is deleted, not upgraded.

### Data layer

Two backends, neither centrally configured:

- `https://api.canonn.tech` — 14 files each declare their own `const API_ENDPOINT`
  and hand-roll an identical offset-paging loop.
- `https://us-central1-canonn-api-236217.cloudfunctions.net/...` — hardcoded raw
  in 13 files: `Aliens`, `Biology`, `Carriers`, `Cmdr`, `Codex`, `Colonisation`,
  `CS`, `Faction`, `FactionRes`, `NHSS`, `Route`, `Thargoids`, `UIA`. The GCP
  region and project id are baked into thirteen separate files; any function
  redeploy that moves them breaks the map in thirteen places.

Note: 20 files declare a top-level `const API_ENDPOINT` (14 targeting
api.canonn.tech, 5 the cloud functions, 1 Google Cloud Storage). Two of these
would collide if loaded on the same page. Verified they do not today — the `*-combo.html` pages
each load one real MapData file; the second reference is a disabled comment. This
is latent fragility, not a live bug. ESM module scope removes it.

### three.js API removals to migrate

| r75 API | Status | Affected |
|---|---|---|
| `THREE.Geometry` | removed r131 | system.class.js:128, grid.class.js:50 & 74, galaxy.class.js:277-278 |
| `THREE.FontUtils.generateShapes` | removed | grid, hud, galaxy classes |
| `helvetiker_regular.typeface.js` | legacy format | replaced by JSON typeface + `FontLoader` |
| `THREE.VertexColors` | removed | system.class.js:162, galaxy.class.js:366 & 389 → `vertexColors: true` |
| `GridHelper.setColors()` | removed | grid.class.js:26 |

**Silent-breakage warning.** `GridHelper`'s signature changed meaning, not just
shape. In r75 it was `GridHelper(size, step)` where `size` is a **half-extent**
and `step` is **spacing in world units**. In modern three it is
`GridHelper(size, divisions, colorCenterLine, colorGrid)` where `size` is the
**full extent** and `divisions` is a **count**. The existing call
`new THREE.GridHelper(1000000, 100)` means "±1,000,000 units, a line every 100
units" today and "1,000,000 units wide, 100 divisions — a line every 10,000
units" after the upgrade. This fails silently with no console error. It is the
single strongest argument for screenshot-baseline smoke tests.

---

## 6. Phased plan

### Phase 0 — Quick wins

Independent of everything else; no rework once later phases land.

1. Fix the dead throttle; remove the per-frame `new Date()`.
2. Cache the four HUD readout nodes; write only when the value changes.
3. Narrow the mousemove raycast to the Points object; throttle to `requestAnimationFrame`.
4. Delete `ed3dmap.min.js` and the five dead vendored addons; remove their `$.getScript` loads.
5. Replace `w3data.js` with a local `fetch`-based nav include.

**Exit:** measurable frame-time improvement, no behavior change, all pages load.

### Phase 1 — ES modules on r75

Convert `js/ed3dmap.js` and the eight `js/components/*.class.js` files to ES
modules referencing the existing global `THREE`. Delete the nested `$.getScript`
waterfall (ed3dmap.js:205-232) in favour of static imports. Publish `window.Ed3d`.
Update the 50 pages' entry `<script>` to `type="module"`.

**Exit:** all 50 smoke tests green, still on r75.

### Phase 2 — three.js r75 → r185

Add the import map; replace global `THREE` with real imports; `OrbitControls`
from `three/addons/`.

The central change is the system store. Today: `Vector3` objects with `.name`,
`.infos`, `.url`, `.clickable`, `.color` bolted on, pushed into
`geometry.vertices`. After:

- a `BufferGeometry` with `Float32Array` position and color attributes
- a **parallel plain-JS metadata array**, indexed identically
- a `Map` from name → index, backing a new `System.findByName()`

This removes the per-batch geometry-rebuild workaround (system.class.js:141-150, rebuilt at :156),
which exists solely to work around an r75 GPU buffer-sizing quirk.

Then: `FontUtils` → `FontLoader` in three components, modern typeface JSON,
`vertexColors: true`, `GridHelper` constructor corrected for the semantics
change above, and `MapData-Hyperdiction.js` moved to `System.findByName()`.

**Exit:** all 50 smoke tests green on r185, screenshot baselines reviewed for
intentional visual changes.

### Phase 3 — Data loader consolidation

One shared `js/api.js` module providing:

- a paged-fetch helper replacing the 14 duplicated offset loops
- **one** endpoint configuration replacing the 13 hardcoded cloudfunctions URLs
- native `fetch`; `axios` removed from all 50 pages

Data files keep their current entry points; only their internals change.

**Exit:** `axios` gone, zero hardcoded backend URLs outside `js/api.js`, all 50
smoke tests green.

---

## 7. Verification

A generated Playwright smoke test per page, driven by a manifest. Each asserts:

1. The page loads without a console error or unhandled rejection.
2. A WebGL context is created and the scene becomes visible.
3. The expected system count is rendered (> 0, or a known count where stable).
4. A screenshot matches its baseline within tolerance.

Baselines are captured on current `master` **before Phase 0 begins**, so every
phase is diffed against known-good output. Screenshot diffs are the only thing
that catches the `GridHelper` class of silent breakage.

Run locally via `npm test`. Wiring this into CI is deferred; the workflow that
deploys `Source/` is not modified by this project.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Silent visual regressions (e.g. `GridHelper`) | Screenshot baselines captured before any change |
| A community data file relies on an internal not covered by the compat layer | Coupling was measured file-by-file (D2); smoke tests cover all 50 pages |
| Import maps unsupported in an old browser | Baseline support is Chrome 89+ / Firefox 108+ / Safari 16.4+; acceptable for this audience |
| CDN outage for three.js | Vendoring `three.module.js` under `vendor/` is a drop-in change to the import map if wanted |
| Scope creep into the detail view | Explicitly out of scope; revisit after Phase 3 |

---

## Appendix A — Solar system detail view feasibility (deferred)

Confirmed possible. No body-level data exists in this repo — the schema is
system-level only (`name`, `coords`, `cat`, `infos`, `url`, `type`). But EDSM,
already a documented source in [DATA_SOURCES.md](../../../DATA_SOURCES.md), serves
full orbital elements per body from `/api-system-v1/bodies?systemName=X`. A live
probe against `Sol` returned `parents` (orbital hierarchy, handles binaries),
`semiMajorAxis`, `orbitalPeriod`, `orbitalEccentricity`, `orbitalInclination`,
`argOfPeriapsis`, `rotationalPeriod`, `axialTilt`, `radius`, `subType`,
`isLandable`, `atmosphereType`, and `belts[]`.

A single on-click fetch is sufficient to render a real orrery. The feature is
additive — a second scene and view mode — and does not constrain any decision in
this document.
