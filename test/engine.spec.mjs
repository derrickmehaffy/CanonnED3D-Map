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
