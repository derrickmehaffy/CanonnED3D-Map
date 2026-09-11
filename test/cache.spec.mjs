import { test, expect } from '@playwright/test';
import { stubDataHosts } from './helpers.mjs';

/* The landing page pulls a 16.6 MB Spansh dump. Spansh already sends
   cache-control: max-age=86400 and the fetch does not bust it, so the bytes
   come from the HTTP cache on a repeat visit — and the page still took over
   three seconds, because it decompressed and JSON.parsed the whole thing again
   to keep a few thousand systems. The fix caches the *derived* result in
   IndexedDB, keyed by the dump's ETag. These cover the cache itself; the
   integration is exercised against the real dump, which the offline suite
   deliberately never contacts. */
async function onPage(page) {
  await stubDataHosts(page);
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.canonnEd3d_multifaction, { timeout: 30_000 });
}

test('the derived cache round-trips a value', async ({ page }) => {
  await onPage(page);
  const r = await page.evaluate(async () => {
    const c = canonnEd3d_multifaction.derivedCache;
    const payload = { systemsData: { systems: [{ name: 'Sol' }] }, allFactionNames: ['Canonn'] };
    await c.put('t|', 't|etag1|canonn', payload);
    const hit = await c.get('t|etag1|canonn');
    const miss = await c.get('t|etag1|nobody');
    return { name: hit && hit.systemsData.systems[0].name, factions: hit && hit.allFactionNames, miss };
  });
  expect(r.name).toBe('Sol');
  expect(r.factions).toEqual(['Canonn']);
  expect(r.miss).toBeNull();
});

test('a new dump replaces the old entry rather than accumulating', async ({ page }) => {
  await onPage(page);
  const r = await page.evaluate(async () => {
    const c = canonnEd3d_multifaction.derivedCache;
    await c.put('p|', 'p|old-etag|canonn', { systemsData: { systems: [] } });
    await c.put('p|', 'p|new-etag|canonn', { systemsData: { systems: [] } });
    // An unrelated prefix must survive the prune.
    await c.put('other|', 'other|keep', { systemsData: { systems: [] } });
    return {
      old: await c.get('p|old-etag|canonn'),
      fresh: !!(await c.get('p|new-etag|canonn')),
      untouched: !!(await c.get('other|keep'))
    };
  });
  expect(r.old, 'the superseded ETag is evicted').toBeNull();
  expect(r.fresh).toBe(true);
  expect(r.untouched, 'pruning is scoped to its own prefix').toBe(true);
});

test('the ETag probe does not download the dump', async ({ page }) => {
  await stubDataHosts(page);
  const gets = [];
  page.on('request', (r) => {
    if (/factions\.json\.gz/.test(r.url())) gets.push(r.method());
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.canonnEd3d_multifaction, { timeout: 30_000 });

  /* The page itself legitimately GETs the dump to build the map, so the title's
     claim can only be checked over the probe alone. Everything before this line
     is the page doing its job; everything after is stampOf and nothing else. */
  gets.length = 0;
  const stamp = await page.evaluate(() =>
    canonnEd3d_multifaction.stampOf('https://downloads.spansh.co.uk/factions.json.gz'));

  expect(gets, 'the probe issues exactly one HEAD').toEqual(['HEAD']);
  expect(gets, 'and must never GET — that is 16.6MB').not.toContain('GET');
  /* The stub answers without an ETag. A missing stamp has to come back as null,
     meaning "nothing cached", rather than throwing: this assertion used to be
     `stamp === null || typeof stamp === 'string'`, which is true of every value
     stampOf can return, so it could not fail. */
  expect(stamp).toBeNull();
});

test('cache failure falls through instead of breaking the page', async ({ page }) => {
  await stubDataHosts(page);
  // Simulate a private window, where opening a database throws.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      get() { throw new DOMException('denied'); }
    });
  });
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(String(e)));
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.canonnEd3d_multifaction, { timeout: 30_000 });
  const r = await page.evaluate(async () =>
    await canonnEd3d_multifaction.derivedCache.get('anything'));
  expect(r).toBeNull();
  expect(crashes).toEqual([]);
});
