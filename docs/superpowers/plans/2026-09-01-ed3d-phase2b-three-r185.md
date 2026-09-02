# ED3D Phase 2b — three.js r75 to r185 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Move from three.js r75 (2016) to r185, the last remaining piece of the modernization. Everything structural is already done: the engine is ES modules (Phase 1) and the system store is a `BufferGeometry` (Phase 2a).

**Architecture:** An import map resolves `three` and `three/addons/` to a pinned CDN build. Each engine module imports `THREE` explicitly; `main.js` also republishes it on `window` for the four data files that construct three.js objects. The eight remaining legacy `Geometry` uses are converted **first, on r75**, so the version bump is a version bump and nothing else — the sequencing that has already caught defects twice on this project.

**Tech Stack:** three.js **r185** (`three@0.185.0`) via import map. No bundler.

**Spec:** `docs/superpowers/specs/2026-09-01-ed3d-modernization-design.md` (decision D1)

## Global Constraints

- No build step. `Source/` deploys verbatim. `package.json` stays `devDependencies` only.
- `.github/workflows/mainl.yml` untouched.
- **`window.THREE` must remain available.** Four data files construct three.js objects directly: `MapData-Permit.js`, `MapData-multifaction.js`, `MapData-landscape.js`, `MapData-UIA.js`. They stay classic scripts and are **not** to be modified.
- All 30 data files stay unmodified.
- Tests assert only on `window.__ed3dTestState()` (plus `test/system-store.spec.mjs`, which may read `System`).
- Suite baseline: **44 passed, 3 skipped, 0 failed.**

## Known behaviour changes, and the decisions taken

| Change | Decision |
|---|---|
| **Colour management.** r152+ converts colours to linear working space and outputs sRGB, so every hex colour renders differently. | Set `THREE.ColorManagement.enabled = false` before anything else runs. This migration's goal is "same picture, newer engine". Revisit deliberately later. |
| **Physically-correct lighting** is now the only mode. | Only three lit materials exist (2 `MeshPhongMaterial`, 1 `MeshLambertMaterial`) and one `HemisphereLight`. If the scene looks washed out or dark, adjust that light's intensity — do not reintroduce legacy lighting, which no longer exists. |
| `geometry.addAttribute` | Renamed to `setAttribute`. |
| `THREE.VertexColors` | Removed; use `vertexColors: true`. |
| `THREE.FontUtils` | Removed; use `FontLoader` + `font.generateShapes(text, size)`. |
| `GridHelper(size, step)` | Now `GridHelper(size, divisions, colorCenterLine, colorGrid)`. **`size` changed from half-extent to full extent, and `step` (world units) became `divisions` (a count).** `setColors()` is gone. |
| `OrbitControls` | Comes from `three/addons/controls/OrbitControls.js`. The vendored r75 copy is deleted. |

**The `GridHelper` change is the dangerous one.** The existing call is `new THREE.GridHelper(1000000, size)` where `size` is 100 or 1000. On r75 that means "±1,000,000 units, a line every `size` units". On r185 it means "1,000,000 units wide total, `size` divisions". Same call, no error, completely different grid. To preserve current appearance: full extent is `2 * 1000000`, and divisions is `2 * 1000000 / step`.

---

### Task 1: Convert the last eight legacy Geometry uses — still on r75

**Files:**
- Modify: `Source/js/ed3dmap.js` (skybox stars)
- Modify: `Source/js/components/grid.class.js` (×2), `route.class.js` (×1), `hud.class.js` (×2), `galaxy.class.js` (×2)

All eight are plain point clouds or line strips with no metadata attached — unlike the system store, which Phase 2a already handled.

- [ ] **Step 1: Locate them**

```bash
grep -rn "new THREE.Geometry" Source/js/
```
Expected: 8 sites across 5 files.

- [ ] **Step 2: Convert each**

The pattern for a point cloud or line strip is the same. Where the code builds `geo.vertices.push(new THREE.Vector3(x, y, z))` in a loop, accumulate a flat array instead and build the attribute once:

```js
    var verts = [];
    // ... in the loop: verts.push(x, y, z);
    var geo = new THREE.BufferGeometry();
    // r75 spelling; Task 2 renames this to setAttribute.
    geo.addAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
```

Where a geometry also carries per-vertex colours (`geo.colors`), add a matching `'color'` attribute built the same way, and keep the material's `vertexColors` setting as-is.

`galaxy.class.js` builds two large particle clouds with colours — take care that the colour array length matches the position array length exactly (3 floats each per vertex).

Convert one file at a time and run `npm test` after each.

- [ ] **Step 3: Verify none remain**

```bash
grep -rn "new THREE.Geometry" Source/js/ || echo "no legacy Geometry remains"
```

- [ ] **Step 4: Full suite plus a look**

Run `npm test` — expected 44 passed, 3 skipped, 0 failed.

Then look at the map: `npm run serve`, open `http://localhost:4173/voyager.html`. Confirm the starfield, the grid, the galaxy disc, and any route lines all still render. These are exactly the objects you just rewrote, and the suite does not check that anything is *visible*. Report what you saw.

- [ ] **Step 5: Commit**

```bash
git add Source/js
git commit -m "refactor: convert the last legacy Geometry uses to BufferGeometry

Skybox stars, both grids, route lines, two HUD line strips and the two
galaxy particle clouds. All plain point/line data with no attached
metadata. Still on r75 so the version bump stays isolated."
```

---

### Task 2: The version bump, piloted on one page

**Files:**
- Modify: every `Source/js/*.js` and `Source/js/components/*.class.js` (add the `three` import)
- Modify: `Source/js/main.js`
- Modify: `Source/voyager.html` (pilot)
- Delete: `Source/vendor/three-js/OrbitControls.js`, `FontUtils.js`, `helvetiker_regular.typeface.js`
- Create: `Source/vendor/three-js/helvetiker_regular.typeface.json`

- [ ] **Step 1: Add the explicit `three` import to every engine module that uses it**

Every file that references `THREE.` needs, as its first line:

```js
import * as THREE from 'three';
```

This matters for ordering: `Ed3d.material` in `ed3dmap.js` constructs materials **at module-evaluation time**, so `THREE` must be bound as a module import, not awaited from a global.

- [ ] **Step 2: Rewire `main.js`**

```js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';

// Preserve the r75 colour pipeline. r152+ would otherwise convert every hex
// colour into a linear working space and output sRGB, changing how the whole
// map looks. This migration is "same picture, newer engine"; revisiting colour
// management is a separate, deliberate decision.
THREE.ColorManagement.enabled = false;

// The four data files that build three.js objects (Permit, multifaction,
// landscape, UIA) are classic scripts and reference THREE as a global.
window.THREE = THREE;
THREE.OrbitControls = OrbitControls;  // ed3dmap.js constructs THREE.OrbitControls
```

Keep the rest of `main.js` — the singleton republishing and the `initScene` wrapper — exactly as it is.

- [ ] **Step 3: Load the font once, synchronously thereafter**

`THREE.FontUtils.generateShapes(text, options)` is gone. `FontLoader` is async, but `font.generateShapes(text, size)` is synchronous once loaded — so load the font **once** during init and keep every call site synchronous.

Download the modern font next to the old one:

```bash
curl -sL -o Source/vendor/three-js/helvetiker_regular.typeface.json \
  https://cdn.jsdelivr.net/npm/three@0.185.0/examples/fonts/helvetiker_regular.typeface.json
```

In `ed3dmap.js`, load it before `launchMap()` runs and store it as `Ed3d.font`. Then replace each call site:

```js
// before: THREE.FontUtils.generateShapes(text, { font:'helvetiker', size: n, ... })
// after:
Ed3d.font.generateShapes(text, n)
```

Call sites are in `grid.class.js` (×2), `hud.class.js` (×1), `galaxy.class.js` (×1). Guard each with `if (!Ed3d.font) return;` so a slow font load cannot throw.

- [ ] **Step 4: Apply the mechanical renames**

- `geometry.addAttribute(` → `geometry.setAttribute(`  (all sites, including the two from Phase 2a in `system.class.js`)
- `vertexColors: THREE.VertexColors` → `vertexColors: true`

- [ ] **Step 5: Fix `GridHelper` — read this carefully**

In `grid.class.js`:

```js
    this.obj = new THREE.GridHelper(1000000, size);
    this.obj.setColors(color, color);
```

`size` here is a **step in world units** (100 or 1000), and `1000000` is a **half-extent**. On r185 the constructor is `GridHelper(size, divisions, colorCenterLine, colorGrid)` where `size` is the **full** extent. To draw the same grid:

```js
    var extent = 1000000 * 2;
    this.obj = new THREE.GridHelper(extent, extent / size, color, color);
```

Getting this wrong produces a grid with the wrong line spacing and **no error at all**. After the pilot boots, compare the grid against the live map by eye before moving on.

- [ ] **Step 6: Convert the pilot page**

In `Source/voyager.html`, delete the four vendor classic scripts and the r75 CDN tag, and add the import map **before** the module entry:

```html
  <script type="importmap">
  {
    "imports": {
      "three": "https://cdn.jsdelivr.net/npm/three@0.185.0/build/three.module.js",
      "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.185.0/examples/jsm/"
    }
  }
  </script>
```

Keep the `vendor/tween-js/Tween.js` classic script — it sets a `TWEEN` global that `ed3dmap.js` uses, and it is not part of three.js.

- [ ] **Step 7: Boot the pilot**

Run: `npx playwright test test/hook.spec.mjs test/perf.spec.mjs test/system-store.spec.mjs --project=offline`

These all drive `voyager.html`. Expect failures at first — work through the console errors one at a time. Every one is a real r185 incompatibility worth recording in your report.

- [ ] **Step 8: Look at it**

`npm run serve`, open `http://localhost:4173/voyager.html`. Check: starfield, grid **and its line spacing**, galaxy disc, system points, the selection cursor, coordinate text labels, hover and click. Report what you saw, naming anything that differs from what you expect.

- [ ] **Step 9: Commit**

```bash
git add Source
git commit -m "feat: upgrade three.js r75 to r185 via import map, pilot on voyager.html"
```

---

### Task 3: Roll out to the remaining 35 pages

- [ ] **Step 1: Inventory**

```bash
grep -l "three.js/r75" Source/*.html | wc -l
```
Expected: 35.

- [ ] **Step 2: Convert them**

Apply the same change as the pilot to each: drop the r75 CDN tag and the three vendored three.js classic scripts, add the import map. `voyager.html` is the reference. Work in batches, running `npm test` after each.

- [ ] **Step 3: Verify**

```bash
grep -l "three.js/r75" Source/*.html || echo "no page loads r75"
grep -l "importmap" Source/*.html | wc -l   # expect 36
```

- [ ] **Step 4: Delete the dead vendor files**

```bash
git rm Source/vendor/three-js/OrbitControls.js \
       Source/vendor/three-js/FontUtils.js \
       Source/vendor/three-js/helvetiker_regular.typeface.js
```

- [ ] **Step 5: Full suite**

Run `npm test` — expected 44 passed, 3 skipped, 0 failed.

- [ ] **Step 6: Commit**

```bash
git add Source
git commit -m "feat: move the remaining 35 pages to three.js r185"
```

---

## Phase 2b exit criteria

- [ ] `npm test` at 44 passed, 3 skipped, 0 failed
- [ ] No page references `three.js/r75`; all 36 carry the import map
- [ ] No `new THREE.Geometry`, `addAttribute`, `THREE.VertexColors`, `THREE.FontUtils` or `setColors` anywhere
- [ ] `window.THREE` still set, and the four data files that use it are unmodified
- [ ] The grid's line spacing looks the same as before the bump (verified by eye)
- [ ] All 30 data files unmodified
