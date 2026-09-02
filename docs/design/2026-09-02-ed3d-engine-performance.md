# Where Ed3d's frame time actually goes

Measured 2026-09-02 on `gec.html` (639 systems), headless Chromium at 1280x800.

**Caveat on the numbers:** headless Chromium rasterises on the CPU via
SwiftShader, so the absolute milliseconds are much worse than a real GPU. Treat
these as *relative* costs. The ranking is what matters, and overdraw — which is
what dominates here — is genuinely expensive on real integrated GPUs too.

## Method

Render 40 frames, take the median, then hide one group of objects at a time and
re-measure. The drop is that group's share of the frame.

| Hidden | Frame (ms) | Saved | Share |
|---|---|---|---|
| *baseline* | 46.9 | — | — |
| Grid (4 objects) | 28.1 | **18.8** | **40%** |
| Galaxy point clouds (3) | 31.2 | **15.7** | **33%** |
| System point cloud (1) | 39.8 | 7.1 | 15% |
| Sprites (1) | 39.9 | 7.0 | 15% |
| Region labels (98) | 43.3 | 3.6 | 8% |

Draw calls at rest: **7**. Frustum culling is already working; draw call count
is not a problem and does not need solving.

## What this rules out

**Merging the region labels makes things worse, not better.** The obvious-looking
optimisation — 98 label meshes into one merged geometry via
`BufferGeometryUtils.mergeGeometries()` — was prototyped and measured:

```
before  7 draw calls, 44.6 ms
after   7 draw calls, 88.1 ms     (98 labels merged)
```

Frame time **doubled**. One merged mesh spans the whole galaxy, so it can never
be frustum-culled, and all ~170k triangles are submitted every frame instead of
the handful actually on screen. The labels were only 8% of the frame to begin
with. Do not do this.

## What is worth doing

### 1. Replace the grid with a shader grid — 40% of the frame, and a known bug

`GridHelper` builds real line geometry: the two grids carry ~80k line vertices
between them, drawn across the whole screen. It is the single most expensive
thing in the scene, and it is *also* the source of the moiré tearing already
reported when toggling the grid off and on.

Both problems have the same fix: draw the grid in a fragment shader on a single
quad, computing line coverage analytically from screen-space derivatives
(`fwidth`). Two triangles instead of 80,000 line segments, correct
anti-aliasing at every zoom rather than aliasing into moiré, and distance fade
for free. This is the standard modern approach and needs no new dependency.

Best single change available: it removes the largest cost and closes an open
bug at the same time.

### 2. Galaxy background point clouds — 33%

Three `Points` clouds of large additive-blended sprites. Additive blending with
`depthWrite: false` means every pixel is shaded once per overlapping particle,
so this is pure overdraw and scales with how much of the screen the galaxy
covers. Options, cheapest first: shrink the sprites with distance, drop the
particle count at far zoom, or bake the distant galaxy to a single textured
quad and only switch to particles when close.

### 3. Share the label material — memory, not frame time

`Galaxy.addText()` (`galaxy.class.js:254`) allocates a **new**
`MeshBasicMaterial` per label with identical settings — 98 identical materials.
One shared instance is a two-line change. It will not move the frame time (see
the table) but it cuts material state and memory, and makes the labels one
uniform thing to toggle.

While there: `textMesh.geometry = textGeo` and `geometry.needsUpdate = true`
just below it are both dead — the geometry is already passed to the constructor,
and `needsUpdate` is not a `BufferGeometry` property. Leftovers from r75.

### 4. `endParticleSystem` leaks a material per batch

`System.endParticleSystem()` (`system.class.js:154`) disposes the old geometry
but builds a **new `PointsMaterial` every flush** and never disposes the
previous one. It runs once per 500-system batch, so a load leaks
`ceil(N/500) - 1` materials, each holding a texture reference. Small at GEC's
639 systems, real at 50,000. The material is identical every time — build it
once and reuse it.

### 5. Point sizing on zoom

`Action.sizeOnScroll` adjusts point size manually as the camera moves, which is
where "the flares get really big when zoomed out" comes from. `PointsMaterial`
has `sizeAttenuation`, and a small custom shader can clamp apparent size
properly, rather than driving it from scroll events.

## Suggested order

1. Shader grid — biggest win, fixes a reported bug
2. Galaxy overdraw — second biggest
3. Material sharing and the batch leak — small, safe, quick
4. Point sizing — behavioural, needs a look together

Re-measure on real hardware before and after; these numbers are only good for
ranking.
