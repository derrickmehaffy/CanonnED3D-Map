import { test, expect } from '@playwright/test';
import { stubDataHosts, waitForScene, REFERENCE_PAGE } from './helpers.mjs';

async function loaded(page) {
  await stubDataHosts(page);
  await page.goto(REFERENCE_PAGE, { waitUntil: 'load' });
  await waitForScene(page, expect);
  await expect
    .poll(() => page.evaluate(() => window.__ed3dTestState().dataComplete), { timeout: 60_000 })
    .toBe(true);
}

/* Region labels are built from a font loaded asynchronously — addText() returns
   early until Ed3d.font arrives — so tests about them have to wait for the
   labels themselves, not just for the data. */
async function labelsReady(page) {
  await expect
    .poll(() => page.evaluate(() =>
      (window.Galaxy && Galaxy.infos && Galaxy.infos.children.length) || 0), { timeout: 60_000 })
    .toBeGreaterThan(20);
}

/* Galaxy.addText() used to allocate a MeshBasicMaterial per region label — ~98
   of them — and infosUpdateCallback walked every mesh to change opacity. Labels
   come in two opacity bands (the `revert` flag), so two shared materials cover
   every case and the opacity update became two assignments. */
test('region labels share two materials rather than one each', async ({ page }) => {
  await loaded(page);
  await labelsReady(page);
  const r = await page.evaluate(() => {
    // Region labels are the children of Galaxy.infos. Scoping to that matters:
    // the cursor cones and the 2D galaxy floor are MeshBasicMaterial too.
    const uuids = new Set();
    const labels = Galaxy.infos.children.filter((o) => o.type === 'Mesh');
    labels.forEach((o) => uuids.add(o.material.uuid));
    return { labels: labels.length, distinct: uuids.size,
             shared: Object.keys(Galaxy.textMaterials || {}).length };
  });
  expect(r.labels).toBeGreaterThan(20);
  expect(r.shared).toBe(2);
  expect(r.distinct, 'every label draws from the two shared materials').toBeLessThanOrEqual(2);
});

test('both label opacity bands still respond to the distance callback', async ({ page }) => {
  await loaded(page);
  await labelsReady(page);
  const r = await page.evaluate(() => {
    // infosUpdateCallback returns early when labels are off, and the console's
    // display timer flips that flag as the camera crosses into far view — so
    // pin it rather than racing it.
    Ed3d.showGalaxyInfos = true;
    Galaxy.infos.previousOpacity = -1;
    Galaxy.infosUpdateCallback(150);          // scale-70 = 80 -> clamped to 0.8
    const a = { n: Galaxy.textMaterials.normal.opacity, r: Galaxy.textMaterials.revert.opacity };
    Ed3d.showGalaxyInfos = true;
    Galaxy.infos.previousOpacity = -1;
    Galaxy.infosUpdateCallback(75);           // scale-70 = 5  -> a lower band
    const b = { n: Galaxy.textMaterials.normal.opacity, r: Galaxy.textMaterials.revert.opacity };
    return { a, b };
  });
  // The two bands move independently, and neither is stuck.
  expect(r.a.n).not.toBe(r.b.n);
  expect(r.a.n).not.toBe(r.a.r);
});

/* endParticleSystem() runs once per 500-system batch. It used to build a fresh
   PointsMaterial every time while only disposing the geometry, leaking
   ceil(N/500)-1 materials per load, each holding a texture reference. */
test('the point cloud reuses one material across batch flushes', async ({ page }) => {
  await loaded(page);
  const r = await page.evaluate(() => {
    const before = System.particleMaterial.uuid;
    const size = System.particleMaterial.size;
    System.endParticleSystem();               // simulate another batch flush
    System.endParticleSystem();
    return {
      same: System.particleMaterial.uuid === before,
      attached: System.particle.material === System.particleMaterial,
      sizeKept: System.particleMaterial.size === size
    };
  });
  expect(r.same, 'no new material per flush').toBe(true);
  expect(r.attached, 'the cloud draws with the shared material').toBe(true);
  expect(r.sizeKept).toBe(true);
});

/* The two grids were GridHelpers: at 100 ly spacing that is 20,000 divisions
   and ~80,000 vertices, together 40% of the frame — and line geometry has no
   anti-aliasing, which is what produced the moiré when the grid was toggled or
   the camera moved. They are now drawn analytically in a fragment shader. */
test('the grid is a shader quad, not line geometry', async ({ page }) => {
  await loaded(page);
  const r = await page.evaluate(() => {
    const g = [Ed3d.grid1H.obj, Ed3d.grid1K.obj];
    return {
      types: g.map((o) => o.type),
      materials: g.map((o) => o.material.type),
      verts: g.reduce((a, o) => a + o.geometry.attributes.position.count, 0),
      // fwidth-based coverage is the whole point: it is what removes the moiré.
      usesDerivatives: g.every((o) => /fwidth/.test(o.material.fragmentShader)),
      spacing: g.map((o) => o.material.uniforms.uSize.value),
      culled: g.map((o) => o.frustumCulled)
    };
  });
  expect(r.types).toEqual(['Mesh', 'Mesh']);
  expect(r.materials).toEqual(['ShaderMaterial', 'ShaderMaterial']);
  expect(r.verts, 'two quads, not 88,008 line vertices').toBe(8);
  expect(r.usesDerivatives).toBe(true);
  // The 100 ly and 1000 ly grids Ed3d.initScene() asks for.
  expect(r.spacing).toEqual([100, 1000]);
  // The quad is always under the camera; culling by bounding sphere only
  // ever gets it wrong.
  expect(r.culled).toEqual([false, false]);
});

test('the grid still follows the camera and toggles', async ({ page }) => {
  await loaded(page);
  const r = await page.evaluate(() => {
    // moveGridTo snaps X/Z to 1000 ly, which both grids divide evenly, so the
    // shader's world-anchored lines stay aligned with the old behaviour.
    Action.moveGridTo(12345, 678, -9876);
    const p = Ed3d.grid1H.obj.position;
    const was = Ed3d.grid1H.obj.visible;
    Ed3d.grid1H.hide();
    const hidden = Ed3d.grid1H.obj.visible;
    Ed3d.grid1H.visible = true;
    Ed3d.grid1H.show();
    return { x: p.x, y: p.y, z: p.z, was, hidden, shown: Ed3d.grid1H.obj.visible };
  });
  expect(r.x).toBe(12000);
  expect(r.z).toBe(-10000);
  expect(r.y).toBe(678);
  expect(r.hidden).toBe(false);
  expect(r.shown).toBe(true);
});

/* The HDR pipeline is opt-in: Ed3d's colours were authored against the
   non-colour-managed path, so turning it on shifts every hue. It must stay off
   until asked, and must restore the renderer exactly when switched back. */
test('the HDR pipeline is off by default and reverts cleanly', async ({ page }) => {
  await loaded(page);
  const r = await page.evaluate(() => {
    const before = {
      enabled: PostFX.enabled,
      toneMapping: renderer.toneMapping,
      render: renderer.render
    };
    PostFX.enable();
    const on = {
      enabled: PostFX.enabled,
      toneMapping: renderer.toneMapping,
      // ACESFilmicToneMapping is 4 in three's enum
      wrapped: renderer.render !== before.render,
      halfFloat: PostFX.composer.renderTarget1.texture.type
    };
    PostFX.disable();
    const after = {
      enabled: PostFX.enabled,
      toneMapping: renderer.toneMapping,
      restored: renderer.render === before.render
    };
    return { before, on, after, HalfFloatType: THREE.HalfFloatType,
             ACES: THREE.ACESFilmicToneMapping, NoToneMapping: THREE.NoToneMapping };
  });

  expect(r.before.enabled, 'off until asked for').toBe(false);
  expect(r.before.toneMapping).toBe(r.NoToneMapping);

  expect(r.on.enabled).toBe(true);
  expect(r.on.toneMapping).toBe(r.ACES);
  expect(r.on.wrapped, 'renders through the composer').toBe(true);
  // The whole point: additive blending needs somewhere to accumulate past 1.0.
  expect(r.on.halfFloat).toBe(r.HalfFloatType);

  expect(r.after.enabled).toBe(false);
  expect(r.after.toneMapping).toBe(r.before.toneMapping);
  expect(r.after.restored, 'renderer.render put back').toBe(true);
});

/* LineBasicMaterial.linewidth is a documented no-op in WebGL, so every route
   was a 1px hairline whatever it asked for. Line2 draws the line as
   camera-facing quads, which gives it real width — but its material has to be
   told the canvas resolution to convert that width into pixels. */
test('routes are drawn with real line width', async ({ page }) => {
  await loaded(page);
  const r = await page.evaluate(() => {
    const rs = Object.keys(routes).map((k) => routes[k]).filter(Boolean);
    const size = new THREE.Vector2();
    renderer.getSize(size);
    return {
      count: rs.length,
      types: [...new Set(rs.map((x) => x.type))],
      materials: [...new Set(rs.map((x) => x.material.type))],
      width: rs[0].material.linewidth,
      // Names are the handle HUD uses to toggle route visibility by category.
      named: rs.every((x) => /^route-/.test(x.name)),
      resMatches: rs.every((x) => x.material.resolution.x === size.x &&
                                  x.material.resolution.y === size.y)
    };
  });
  expect(r.count).toBeGreaterThan(0);
  expect(r.types).toEqual(['Line2']);
  expect(r.materials).toEqual(['LineMaterial']);
  expect(r.width).toBeGreaterThan(1);
  expect(r.named, 'route names survive for HUD toggling').toBe(true);
  expect(r.resMatches, 'materials know the canvas size').toBe(true);
});

test('route materials follow a canvas resize', async ({ page }) => {
  await loaded(page);
  await page.setViewportSize({ width: 900, height: 700 });
  await page.waitForTimeout(400);
  const ok = await page.evaluate(() => {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    return Object.keys(routes).map((k) => routes[k]).filter(Boolean)
      .every((x) => x.material.resolution.x === size.x);
  });
  expect(ok, 'stale resolution would draw lines at the wrong width').toBe(true);
});

/* The grid tears and crawls where its lines fall closer together than a pixel:
   the coverage estimate turns to noise. Tilting toward the horizon is what
   drives it — top-down was always fine, and it got worse the lower the camera
   went — so the shader fades on line density, which is what actually decides
   whether a line can be resolved.

   Measured rather than asserted on the source: read the framebuffer along the
   horizon and count lit pixels, across a sweep of elevations rather than one,
   because the angle it broke at was nowhere near edge-on. */
test('the grid does not tear into a band at any viewing angle', async ({ page }) => {
  await loaded(page);

  const litAlongHorizon = (elevation) => page.evaluate((y) => {
    // Isolate the grid: the galaxy backdrop and the route lines cross the
    // horizon too, and would be counted as tearing.
    const grids = [Ed3d.grid1H.obj, Ed3d.grid1K.obj];
    const hidden = [];
    scene.traverse((o) => {
      if (o !== scene && o.visible && grids.indexOf(o) === -1 &&
          (o.isMesh || o.isPoints || o.isLine || o.isSprite)) {
        o.visible = false; hidden.push(o);
      }
    });

    controls.target.set(0, 0, 0);
    camera.position.set(2500, y, 2500);
    controls.update();
    // Two things the render loop normally does, which driving the renderer
    // directly skips: sizing the grid quad to the view, and re-running the
    // far-view check that decides whether the fine grids are shown at all.
    // This is about the shader, so the grids are simply made visible.
    Ed3d.grid1H.updateOrigin();
    Ed3d.grid1K.updateOrigin();
    grids.forEach((g) => { g.visible = true; });
    renderer.render(scene, camera);

    const gl = renderer.getContext();
    const w = gl.drawingBufferWidth;
    const row = new Uint8Array(w * 4);
    // The worst band sits a little above centre, where the plane runs out.
    gl.readPixels(0, Math.floor(gl.drawingBufferHeight * 0.52), w, 1,
                  gl.RGBA, gl.UNSIGNED_BYTE, row);

    hidden.forEach((o) => { o.visible = true; });

    let lit = 0;
    for (let i = 0; i < w; i++) {
      // Anything appreciably above the #0d0d10 background.
      if (row[i * 4] > 45 || row[i * 4 + 1] > 45 || row[i * 4 + 2] > 55) lit++;
    }
    return { lit, width: w };
  }, elevation);

  // Straight down the grid is fully resolvable and must still draw. Counted
  // over the whole frame, because from overhead there is no horizon row to
  // sample — the plane fills the view.
  const overhead = await page.evaluate(() => {
    const grids = [Ed3d.grid1H.obj, Ed3d.grid1K.obj];
    const hidden = [];
    scene.traverse((o) => {
      if (o !== scene && o.visible && grids.indexOf(o) === -1 &&
          (o.isMesh || o.isPoints || o.isLine || o.isSprite)) { o.visible = false; hidden.push(o); }
    });
    controls.target.set(0, 0, 0);
    // Inside the far-view threshold (scale = distance/200 > 25), past which
    // Ed3d hides the fine grids itself.
    camera.position.set(300, 2000, 300);
    controls.update();
    Ed3d.grid1H.updateOrigin();
    Ed3d.grid1K.updateOrigin();
    grids.forEach((g) => { g.visible = true; });
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    hidden.forEach((o) => { o.visible = true; });
    let lit = 0;
    for (let i = 0; i < w * h; i++) {
      if (buf[i * 4] > 45 || buf[i * 4 + 1] > 45 || buf[i * 4 + 2] > 55) lit++;
    }
    return lit;
  });
  expect(overhead, 'the grid still draws when it can be resolved').toBeGreaterThan(500);

  // Zooming in must not take the grid with it. The edge-on fade is measured as
  // an angle rather than an absolute height for exactly this reason: height
  // alone shrinks as you fly in, so a grid you are looking straight down at
  // would disappear at precisely the point it is most readable.
  const closeIn = await page.evaluate(() => {
    const grids = [Ed3d.grid1H.obj, Ed3d.grid1K.obj];
    controls.target.set(0, 0, 0);
    camera.position.set(20, 90, 20);          // right down on the plane, looking down
    controls.update();
    Ed3d.grid1H.updateOrigin();
    Ed3d.grid1K.updateOrigin();
    grids.forEach((g) => { g.visible = true; });
    return grids.map((g) => g.material.uniforms.uHeight.value);
  });
  expect(closeIn.every((v) => v > 0.9), 'a top-down view is never treated as edge-on').toBe(true);

  // Level with the plane it should let go, whatever the zoom.
  const levelWith = await page.evaluate(() => {
    controls.target.set(0, 0, 0);
    camera.position.set(-900, 6, 900);
    controls.update();
    Ed3d.grid1H.updateOrigin();
    return Ed3d.grid1H.obj.material.uniforms.uHeight.value;
  });
  expect(levelWith, 'edge-on is faded out').toBeLessThan(0.2);

  // 2000 down to 60 walks from a comfortable three-quarter view to nearly
  // edge-on. 900 and 220 are around where the tearing actually showed up.
  for (const elevation of [2000, 900, 220, 60]) {
    const r = await litAlongHorizon(elevation);
    expect(
      r.lit,
      `at elevation ${elevation} the horizon should stay clear, ` +
      `${r.lit}/${r.width} pixels lit`
    ).toBeLessThan(r.width * 0.12);
  }
});

/* The region labels are flat text lying on the galactic plane. Seen edge-on
   every glyph collapses into sub-pixel slivers and tears into a band of white
   dashes along the horizon — which is what the grid kept getting blamed for.

   The second opacity band is what made it stubborn: opacityMiddle is
   1.1 - opacity, so exactly when the normal labels have faded out the "revert"
   ones are at full strength, leaving opaque flat text lying edge-on. */
test('region labels fade when the view goes edge-on to their plane', async ({ page }) => {
  await loaded(page);
  await labelsReady(page);

  const opacityAt = (elevation) => page.evaluate((y) => {
    controls.target.set(0, 0, 0);
    camera.position.set(-900, y, 900);
    controls.update();
    Ed3d.showGalaxyInfos = true;
    Galaxy.infosUpdateCallback(camera.position.distanceTo(controls.target) / 200);
    return {
      normal: Galaxy.textMaterials.normal.opacity,
      revert: Galaxy.textMaterials.revert.opacity
    };
  }, elevation);

  const overhead = await opacityAt(3000);
  const grazing = await opacityAt(120);

  expect(overhead.revert, 'labels read normally from a sensible angle').toBeGreaterThan(0.8);
  expect(grazing.revert, 'and all but vanish edge-on').toBeLessThan(0.3);

  // The early-out used to key on scale alone, so swinging the camera from
  // overhead to side-on at the same distance never updated anything.
  const sameDistance = await page.evaluate(() => {
    const r = 1200;
    const read = (y) => {
      controls.target.set(0, 0, 0);
      const h = Math.sqrt(Math.max(r * r - y * y, 1));
      camera.position.set(h / Math.SQRT2, y, h / Math.SQRT2);
      controls.update();
      Galaxy.infosUpdateCallback(camera.position.distanceTo(controls.target) / 200);
      return Galaxy.textMaterials.revert.opacity;
    };
    return { high: read(1000), low: read(60) };
  });
  expect(sameDistance.high).not.toBeCloseTo(sameDistance.low, 2);
});
