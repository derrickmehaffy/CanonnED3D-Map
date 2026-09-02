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

---

# The "wow" side: the pipeline is the thing holding the look back

Same session, prototyped live on `gec.html` and `voyager.html`.

## Why it currently looks milky

The scene is built almost entirely from **additive blending with no headroom**:

| | count | size | blending |
|---|---|---|---|
| Galaxy point cloud | 26,212 | 500 | additive |
| Galaxy core cloud | 1,817 | 2,000 | additive |
| System flares | per map | 200 | additive |
| Region labels | ~98 | — | additive |
| Grid | 88k verts | — | normal |

Every one of those writes into an **8-bit LDR buffer that clamps at 1.0**. In
the galactic plane, dozens of size-500 sprites overlap, the sum blows straight
past white, and the result clips flat. That is the entire reason the map reads
as a washed-out haze rather than stars — it is not the textures or the colours,
it is that the r75-era pipeline has nowhere to put values above 1.

## What modern three.js changes

Render into a **half-float target** so additive blending can accumulate past
1.0, then **tone map** on the way out instead of clipping:

```js
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.75;

const composer = new EffectComposer(renderer,
  new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType }));
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.7, 0.5, 0.85));
composer.addPass(new OutputPass());
```

Prototyped and captured: dense overlap compresses into bright cores with
coloured falloff instead of a white sheet, and systems read as individual glowing
stars against dark space — the Elite galaxy-map look.

**Bloom only works once HDR is in place.** Tried first on the existing pipeline
and it blew the whole frame out at any useful threshold, because nothing in an
LDR scene is brighter than anything else once it has clipped. Threshold above
1.0 then does nothing at all. Order matters: HDR and tone mapping first, bloom
second.

Selective bloom (bloom the data, not the backdrop, via a second composer and a
mix pass) was also prototyped. Worth keeping in reserve, but it is a workaround
for missing headroom; with HDR the plain bloom pass is enough and much simpler.

**Open tuning question:** at exposure 0.75 the Milky Way recedes further than it
should — the stars look great, the galaxy nearly vanishes. Exposure, bloom
threshold and the galaxy sprite brightness need balancing together. That is a
dial-turning exercise with a person looking at it, not something to guess.

## Related: colour management is currently off

`ColorManagement.enabled = false` is set deliberately (Phase 2b) so the legacy
hex colours render as authored. That pins the renderer to the old
non-colour-managed path, and it is the same decision that keeps tone mapping
out. Turning both on together shifts every colour on the site, so it is a
deliberate re-look at the palette rather than a flag flip — but it is the door
to the whole modern pipeline.

## Also worth having

**Thick route lines.** Route and pulsar lines use `LineBasicMaterial`, whose
`linewidth` is a documented no-op in WebGL — every line is a 1px hairline
regardless of setting. `Line2` / `LineMaterial` from three's addons draws lines
as camera-facing quads with real width, joins and dashes. For the route maps
(Voyager pulsars, UIA, Adamastor) this is a large visual upgrade for a small,
contained change, and it is independent of the HDR work.

## Suggested order for the visual work

1. HDR target + ACES tone mapping — the unlock; everything else depends on it
2. Bloom, tuned together with exposure and galaxy brightness, with a person watching
3. `Line2` route lines — independent, self-contained, big payoff on route maps
4. Revisit colour management and the palette as one deliberate pass
