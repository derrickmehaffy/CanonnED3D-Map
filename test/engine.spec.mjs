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

/* Galaxy.addText() used to allocate a MeshBasicMaterial per region label — ~98
   of them — and infosUpdateCallback walked every mesh to change opacity. Labels
   come in two opacity bands (the `revert` flag), so two shared materials cover
   every case and the opacity update became two assignments. */
test('region labels share two materials rather than one each', async ({ page }) => {
  await loaded(page);
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
  const r = await page.evaluate(() => {
    Galaxy.infos.previousOpacity = -1;
    Galaxy.infosUpdateCallback(150);          // scale-70 = 80 -> clamped to 0.8
    const a = { n: Galaxy.textMaterials.normal.opacity, r: Galaxy.textMaterials.revert.opacity };
    Galaxy.infos.previousOpacity = -1;
    Galaxy.infosUpdateCallback(75);           // scale-70 = 5  -> 0.5 band
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
