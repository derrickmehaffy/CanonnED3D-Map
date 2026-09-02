# ED3D Phase 2a — System Store to BufferGeometry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy `THREE.Geometry` system store with `BufferGeometry` plus a parallel metadata array — **while still on three.js r75** — so that the version bump in Phase 2b is a version change and nothing else.

**Architecture:** Today each system is a `THREE.Vector3` with `.name`, `.infos`, `.url`, `.visible`, `.clickable` and `.color` bolted on, pushed into `geometry.vertices`. After this phase, positions and colors live in `Float32Array` attributes on a `BufferGeometry`, and the per-system metadata lives in an index-aligned plain array `System.points[]`. Roughly 25 call sites that read `System.particleGeo.vertices[i]` become `System.points[i]`.

**Tech Stack:** three.js **r75** (unchanged), ES modules, no bundler.

**Spec:** `docs/superpowers/specs/2026-09-01-ed3d-modernization-design.md`

## Global Constraints

- **Stay on three.js r75.** No import map, no version change. Phase 2b does that.
- r75's BufferGeometry API is `geometry.addAttribute(name, attr)`, **not** `setAttribute`, and it has no `setFromPoints`. Use the r75 spelling; Phase 2b renames it.
- No build step. `Source/` deploys verbatim. `package.json` stays `devDependencies` only.
- `.github/workflows/mainl.yml` untouched.
- Only **one** data file may change: `Source/data/MapData-Hyperdiction.js`. The other 29 stay untouched.
- Tests assert only on `window.__ed3dTestState()`.
- Suite baseline: **41 passed, 3 skipped, 0 failed**. It must end there.

## Why this is its own phase

`THREE.Geometry` was removed in r131, so this conversion is mandatory before r185. Doing it *first*, on r75, means that if the map breaks after the version bump we know it was the version — the same reasoning that put module conversion before the bump in Phase 1, which is already paying off.

Only the **system store** is converted here. The other legacy `Geometry` uses — `ed3dmap.js` skybox stars, `grid.class.js` (×2), `route.class.js`, `hud.class.js` (×2), `galaxy.class.js` (×2) — are simple point/line strips with no metadata attached. They convert mechanically in Phase 2b.

---

### Task 1: Introduce the metadata array alongside the existing store

**Files:**
- Modify: `Source/js/components/system.class.js`
- Test: `test/system-store.spec.mjs` (new)

**Interfaces:**
- Produces: `System.points` — an index-aligned array of plain objects `{ x, y, z, name, infos, url, cat, visible, clickable, color }`. Also `System.findByName(name)` returning the index or `-1`, and `System.getPoint(i)` returning `System.points[i]`.
- The legacy `System.particleGeo.vertices` keeps working in this task. Task 2 removes it.

- [ ] **Step 1: Write the failing test**

Create `test/system-store.spec.mjs`:

```js
import { test, expect } from '@playwright/test';
import { stubDataHosts, waitForScene, REFERENCE_PAGE } from './helpers.mjs';

test('System exposes an index-aligned metadata array', async ({ page }) => {
  await stubDataHosts(page);
  await page.goto(REFERENCE_PAGE, { waitUntil: 'load' });
  await waitForScene(page, expect);
  await expect
    .poll(() => page.evaluate(() => window.__ed3dTestState().dataComplete), { timeout: 60_000 })
    .toBe(true);

  const r = await page.evaluate(() => {
    const idx = System.findByName('Sagittarius A*');
    return {
      count: System.count,
      pointsLength: System.points.length,
      sagIndex: idx,
      sagName: idx >= 0 ? System.points[idx].name : null,
      hasCoords: idx >= 0 && typeof System.points[idx].x === 'number'
    };
  });

  // Sagittarius A* is registered as a clickable particle on every map.
  expect(r.sagIndex).toBeGreaterThanOrEqual(0);
  expect(r.sagName).toBe('Sagittarius A*');
  expect(r.hasCoords).toBe(true);
  // The metadata array must stay index-aligned with the point count.
  expect(r.pointsLength).toBe(r.count);
});

test('findByName returns -1 for an unknown system', async ({ page }) => {
  await stubDataHosts(page);
  await page.goto(REFERENCE_PAGE, { waitUntil: 'load' });
  await waitForScene(page, expect);
  const missing = await page.evaluate(() => System.findByName('No Such System Anywhere'));
  expect(missing).toBe(-1);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx playwright test test/system-store.spec.mjs --project=offline`
Expected: FAIL — `System.findByName is not a function`.

- [ ] **Step 3: Populate `System.points` in `create()`**

In `Source/js/components/system.class.js`, add `'points': [],` and `'nameIndex': {},` beside the existing `'particleColor': []`.

In `create()`, immediately after `this.particleGeo.vertices.push(particle); this.count++;`, push the matching metadata:

```js
      //-- Index-aligned metadata. The GPU only needs position and colour; every
      //   other per-system property lives here so the geometry can become a
      //   BufferGeometry without losing it.
      this.points.push({
        x: x, y: y, z: z,
        name: val.name,
        infos: val.infos,
        url: val.url,
        cat: val.cat,
        visible: true,
        clickable: true,
        color: this.particleColor[this.count - 1]
      });
      if (val.name !== undefined) this.nameIndex[val.name] = this.points.length - 1;
```

In the early-return branch that merges duplicate systems (`if (val.infos != undefined && this.particleInfos[idSys])`), keep the metadata in step by also appending to the existing entry:

```js
        if (this.points[indexParticle] !== undefined) {
          this.points[indexParticle].infos = (this.points[indexParticle].infos || '') + val.infos;
        }
```

In `remove()`, reset the new state alongside the old: `this.points = []; this.nameIndex = {};`

- [ ] **Step 4: Add the lookup helpers**

```js
  /**
   * Index of a system by name, or -1. Replaces the linear scans over
   * particleGeo.vertices that BufferGeometry makes impossible.
   */
  'findByName': function (name) {
    var i = this.nameIndex[name];
    return (i === undefined) ? -1 : i;
  },

  'getPoint': function (index) {
    return this.points[index];
  },
```

- [ ] **Step 5: Run the test**

Run: `npx playwright test test/system-store.spec.mjs --project=offline`
Expected: PASS.

- [ ] **Step 6: Full suite**

Run: `npm test` — expected 43 passed (41 + 2 new), 3 skipped, 0 failed.

- [ ] **Step 7: Commit**

```bash
git add Source/js/components/system.class.js test/system-store.spec.mjs
git commit -m "refactor: add index-aligned metadata array to System store

Positions and colours are about to move into typed arrays. Every other
per-system property (name, infos, url, cat, visible) moves to
System.points[], index-aligned with the geometry, plus a name index so
lookups do not need a linear scan over vertices."
```

---

### Task 2: Move the consumers off `particleGeo.vertices`

**Files:**
- Modify: `Source/js/components/action.class.js`
- Modify: `Source/js/components/hud.class.js`
- Modify: `Source/data/MapData-Hyperdiction.js`

**Interfaces:**
- Consumes: `System.points`, `System.findByName` from Task 1.
- Produces: no remaining reads of `particleGeo.vertices` or `particleGeo.colors` outside `system.class.js`.

- [ ] **Step 1: Inventory every consumer**

```bash
grep -rn "particleGeo\.\(vertices\|colors\)\|geometry\.vertices\[" \
  Source/js/components/ Source/js/ed3dmap.js Source/data/
```

Roughly 25 sites, concentrated in `action.class.js` (picking and prev/next navigation) and `hud.class.js` (category filters and colour updates). Work through them one file at a time and re-run `npm test` after each file.

- [ ] **Step 2: Convert the reads**

The mapping is mechanical:

| Before | After |
|---|---|
| `System.particleGeo.vertices[i]` | `System.points[i]` |
| `intersection.object.geometry.vertices[i]` | `System.points[i]` |
| `System.particleGeo.vertices.length` | `System.points.length` |
| `$(System.particleGeo.vertices).each(...)` | `System.points.forEach(...)` |

The metadata objects carry `.x`, `.y`, `.z` as plain numbers, not a `Vector3`. Any site doing vector maths on the result needs an explicit `new THREE.Vector3(p.x, p.y, p.z)`. **Check each site** — several pass the point to camera-movement code that expects a `Vector3`.

- [ ] **Step 3: Convert the colour writes**

`hud.class.js` writes `System.particleGeo.colors[i] = new THREE.Color(...)` and sets `colorsNeedUpdate`. Add a setter to `system.class.js` and use it:

```js
  /**
   * Set one point's colour. While the store is still a legacy Geometry this
   * writes both the colour array and the metadata; Task 3 makes it write the
   * typed array instead. Callers do not change again.
   */
  'setColor': function (index, color) {
    this.particleColor[index] = color;
    if (this.points[index] !== undefined) this.points[index].color = color;
    if (this.particleGeo !== null) {
      this.particleGeo.colors[index] = color;
      this.particleGeo.colorsNeedUpdate = true;
    }
  },
```

Replace every `System.particleGeo.colors[i] = X` with `System.setColor(i, X)` and drop the now-redundant `colorsNeedUpdate` lines.

- [ ] **Step 4: Fix `MapData-Hyperdiction.js`**

Replace the linear scan:

```js
							for (var vi = 0; vi < System.particleGeo.vertices.length; vi++) {
								if (System.particleGeo.vertices[vi].name === refName) {
									target = System.particleGeo.vertices[vi];
```

with the indexed lookup:

```js
							var vi = System.findByName(refName);
							if (vi >= 0) {
								target = System.points[vi];
```

Match the surrounding braces and loop-exit logic exactly — read the whole block before editing.

- [ ] **Step 5: Verify nothing outside `system.class.js` touches the legacy store**

```bash
grep -rn "particleGeo" Source/js/components/action.class.js Source/js/components/hud.class.js Source/data/ \
  || echo "no external consumers remain"
```
`hud.class.js`'s `if (!System.particleGeo) System.initParticleSystem();` guards are fine to keep — they test existence, not contents. Everything else must be gone.

- [ ] **Step 6: Full suite**

Run: `npm test` — expected 43 passed, 3 skipped, 0 failed.

- [ ] **Step 7: Commit**

```bash
git add Source/js/components Source/data/MapData-Hyperdiction.js
git commit -m "refactor: read system metadata from System.points, not geometry vertices

Moves ~25 call sites in action.class.js and hud.class.js off
particleGeo.vertices, and replaces MapData-Hyperdiction.js's linear name
scan with System.findByName(). Colour writes go through System.setColor()."
```

---

### Task 3: Swap the store itself to BufferGeometry

**Files:**
- Modify: `Source/js/components/system.class.js`
- Test: `test/system-store.spec.mjs`

- [ ] **Step 1: Write the failing test**

Append to `test/system-store.spec.mjs`:

```js
test('the point cloud is a BufferGeometry with typed attributes', async ({ page }) => {
  await stubDataHosts(page);
  await page.goto(REFERENCE_PAGE, { waitUntil: 'load' });
  await waitForScene(page, expect);
  await expect
    .poll(() => page.evaluate(() => window.__ed3dTestState().dataComplete), { timeout: 60_000 })
    .toBe(true);

  const r = await page.evaluate(() => {
    const g = System.particle.geometry;
    const pos = g.attributes && g.attributes.position;
    return {
      isBuffer: g instanceof THREE.BufferGeometry,
      hasLegacyVertices: Array.isArray(g.vertices) && g.vertices.length > 0,
      positionIsFloat32: pos ? pos.array instanceof Float32Array : false,
      positionCount: pos ? pos.count : -1,
      count: System.count
    };
  });

  expect(r.isBuffer).toBe(true);
  expect(r.hasLegacyVertices).toBe(false);
  expect(r.positionIsFloat32).toBe(true);
  // One vec3 per system.
  expect(r.positionCount).toBe(r.count);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx playwright test test/system-store.spec.mjs --project=offline -g "BufferGeometry"`
Expected: FAIL — `isBuffer` is false.

- [ ] **Step 3: Replace the accumulator**

`initParticleSystem()` currently does `this.particleGeo = new THREE.Geometry;`. Replace the accumulation strategy: keep growing plain JS arrays and build the typed arrays at flush time.

```js
  'initParticleSystem': function () {
    this.positions = [];
    this.colorValues = [];
    this.points = [];
    this.nameIndex = {};
    this.count = 0;
    this.particleGeo = null;
  },
```

In `create()`, replace the `this.particleGeo.vertices.push(particle)` path with:

```js
      this.positions.push(x, y, z);
      var c = this.particleColor[this.count];
      this.colorValues.push(c.r, c.g, c.b);
      this.count++;
```

and delete the `new THREE.Vector3(...)` particle construction and its property assignments — `System.points` now carries all of that. Guard `create()` on `this.positions !== null` instead of `this.particleGeo !== null`.

- [ ] **Step 4: Build the BufferGeometry at flush time**

Rewrite `endParticleSystem()`:

```js
  'endParticleSystem': function () {

    if (this.positions === null || this.positions.length === 0) return;

    if (this.particle !== null) {
      scene.remove(this.particle);
      if (this.particle.geometry) this.particle.geometry.dispose();
    }

    var geo = new THREE.BufferGeometry();
    // r75 spells this addAttribute; Phase 2b renames it to setAttribute.
    geo.addAttribute('position', new THREE.BufferAttribute(new Float32Array(this.positions), 3));
    geo.addAttribute('color', new THREE.BufferAttribute(new Float32Array(this.colorValues), 3));

    var particleMaterial = new THREE.PointsMaterial({
      map: Ed3d.textures.flare_yellow,
      vertexColors: THREE.VertexColors,
      size: this.scaleSize,
      fog: false,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthTest: true,
      depthWrite: false
    });

    this.particle = new THREE.Points(geo, particleMaterial);
    this.particle.clickable = true;
    this.particleGeo = geo;

    scene.add(this.particle);
  },
```

Note `vertexColors: THREE.VertexColors` stays for now — that constant still exists in r75. Phase 2b changes it to `true`.

- [ ] **Step 5: Make `setColor` write the typed array**

```js
  'setColor': function (index, color) {
    this.particleColor[index] = color;
    if (this.points[index] !== undefined) this.points[index].color = color;
    this.colorValues[index * 3] = color.r;
    this.colorValues[index * 3 + 1] = color.g;
    this.colorValues[index * 3 + 2] = color.b;
    if (this.particleGeo !== null && this.particleGeo.attributes.color) {
      var attr = this.particleGeo.attributes.color;
      attr.array[index * 3] = color.r;
      attr.array[index * 3 + 1] = color.g;
      attr.array[index * 3 + 2] = color.b;
      attr.needsUpdate = true;
    }
  },
```

- [ ] **Step 6: Update `remove()`**

Reset `positions`, `colorValues`, `points`, `nameIndex`, `particleColor`, `count`, and dispose the geometry before `scene.remove(this.particle)`.

- [ ] **Step 7: Run the tests**

Run: `npx playwright test test/system-store.spec.mjs --project=offline`
Expected: all PASS.

- [ ] **Step 8: Full suite, and check picking by hand**

Run: `npm test` — expected 43 passed, 3 skipped, 0 failed.

The smoke suite does not click anything, so **manually verify picking still works**: serve the site (`npm run serve`), open `http://localhost:4173/voyager.html`, hover and click a system, and confirm the info panel shows the right name. Report what you saw. If hovering throws in the console, the raycast index is no longer resolving to `System.points` — say so rather than guessing.

- [ ] **Step 9: Commit**

```bash
git add Source/js/components/system.class.js test/system-store.spec.mjs
git commit -m "refactor: store systems in a BufferGeometry with typed attributes

Positions and colours are now Float32Array attributes; per-system
metadata lives in the index-aligned System.points array added earlier.
Removes the per-batch geometry rebuild that existed only to work around
an r75 GPU buffer-sizing quirk.

Still on r75 — addAttribute is the r75 spelling of setAttribute."
```

---

## Phase 2a exit criteria

- [ ] `npm test` at 43 passed, 3 skipped, 0 failed
- [ ] `System.particle.geometry` is a `BufferGeometry` with `Float32Array` position and colour attributes
- [ ] No `.vertices` read of the system store anywhere outside `system.class.js`
- [ ] Hover and click still select the correct system (verified by hand)
- [ ] three.js is still r75 — no import map, no version change
- [ ] 29 of the 30 data files unmodified; only `MapData-Hyperdiction.js` changed

## What Phase 2b inherits

The legacy `Geometry` uses that remain are all simple point or line strips with no attached metadata: `ed3dmap.js` skybox stars, `grid.class.js` (×2), `route.class.js`, `hud.class.js` (×2), `galaxy.class.js` (×2). Those convert mechanically alongside the version bump, together with `FontUtils` → `FontLoader`, the `GridHelper` signature change, `THREE.VertexColors` → `vertexColors: true`, `addAttribute` → `setAttribute`, and the import map.
