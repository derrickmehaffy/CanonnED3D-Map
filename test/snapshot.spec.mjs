import { test, expect } from '@playwright/test';
import { gzipSync } from 'node:zlib';
import { stubDataHosts } from './helpers.mjs';

/* The landing page reads a 16.6 MB Spansh dump. Even with the bytes in the
   HTTP cache, decompressing and parsing it costs about three seconds, and
   until this change that was three seconds of empty screen every time the
   dump changed. It now draws the last snapshot it built and swaps the fresh
   result in underneath through Ed3d.updateSystems().

   These tests drive that with a two-system snapshot and a five-system dump,
   so "which one is on screen" is a number rather than a guess. */

const PAGE = '/multifaction.html?factions=Canonn';
const KEY = 'multifaction|"OLD-DUMP"|canonn';

/* What an earlier visit would have left behind: the derived result, not the
   dump. Two systems, in the categories the builder makes for one faction. */
const SNAPSHOT = {
  systemsData: {
    categories: { Canonn: {
      f0c: { name: 'Controlled', color: 'FF9D00' },
      f0p: { name: 'Present', color: '4DE3E1' } } },
    systems: [
      { name: 'Snapshot One', cat: ['f0c'], infos: '', coords: { x: 10, y: 0, z: 10 } },
      { name: 'Snapshot Two', cat: ['f0p'], infos: '', coords: { x: 20, y: 0, z: 20 } }
    ],
    routes: []
  },
  allFactionNames: ['Canonn'],
  systemFactionIndex: {}
};

/* The dump the refetch will find: the same faction, five systems. */
const DUMP = [{
  name: 'Canonn', allegiance: 'Independent', government: 'Cooperative',
  systems: Array.from({ length: 5 }, (_, i) => ({
    systemName: 'Fresh ' + i, systemId64: 1000 + i,
    isControllingFaction: i % 2 === 0,
    coords: { x: i * 10, y: 0, z: i * 10 }
  }))
}];

async function seedSnapshot(page) {
  await page.evaluate(() => new Promise((res) => {
    const q = indexedDB.open('canonn-map', 1);
    q.onupgradeneeded = () => {
      const db = q.result;
      if (!db.objectStoreNames.contains('derived')) db.createObjectStore('derived');
    };
    q.onsuccess = () => { q.result.close(); res(); };
    q.onerror = res;
  }));
  await page.evaluate(async ([key, value]) => {
    await new Promise((res) => {
      const q = indexedDB.open('canonn-map', 1);
      q.onsuccess = () => {
        const tx = q.result.transaction('derived', 'readwrite');
        tx.objectStore('derived').put(value, key);
        tx.oncomplete = res;
        tx.onerror = res;
      };
      q.onerror = res;
    });
  }, [KEY, SNAPSHOT]);
}

/* The dump host, answering a HEAD with an ETag that is deliberately not the
   one the snapshot was keyed under, and a GET with real gzip — the loader
   pipes the body through DecompressionStream, so it has to be. Content-
   encoding is left off on purpose: setting it would make Chromium unzip the
   body first and hand the stream something already plain. */
async function stubDump(page, { etag = '"NEW-DUMP"', delay = 0 } = {}) {
  const body = gzipSync(JSON.stringify(DUMP));
  await page.route('**/downloads.spansh.co.uk/**', async (route) => {
    if (route.request().method() === 'HEAD') {
      // ETag is not a CORS-safelisted response header, so a cross-origin read
      // of it needs Access-Control-Expose-Headers — which is exactly what the
      // real downloads.spansh.co.uk sends, and without it stampOf() sees null
      // and every visit looks like a cache miss.
      return route.fulfill({ status: 200, body: '', headers: {
        etag, 'access-control-expose-headers': 'ETag' } });
    }
    if (delay) await new Promise((r) => setTimeout(r, delay));
    return route.fulfill({
      status: 200, headers: { 'content-type': 'application/octet-stream' }, body
    });
  });
}

const systemCount = (page) => page.evaluate(() =>
  window.System && System.points ? System.points.filter((p) => p && p.cat && p.cat.length).length : 0);

test('the last snapshot is drawn while the dump is refetched', async ({ page }) => {
  await stubDataHosts(page);
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await seedSnapshot(page);

  // Two seconds of dead air on the dump, so the snapshot has to be what shows.
  await stubDump(page, { delay: 2000 });
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });

  await expect.poll(() => systemCount(page), { timeout: 30_000 }).toBe(2);
  await expect(page.locator('#feed')).toHaveClass(/snapshot/);
  await expect(page.locator('#feedtxt')).toContainText('refreshing');

  // Then the fresh dump lands underneath, without a reload.
  await expect.poll(() => systemCount(page), { timeout: 60_000 }).toBe(5);
  await expect(page.locator('#feed')).toHaveClass(/live/);
  await expect(page.locator('#feedtxt')).toHaveText('5 systems');
  await expect(page.locator('#st-shown')).toContainText('5 / 5');
});

test('a snapshot built from the dump being served is left alone', async ({ page }) => {
  await stubDataHosts(page);
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await seedSnapshot(page);

  // Same ETag the snapshot was stored under: nothing to refetch.
  await stubDump(page, { etag: '"OLD-DUMP"' });
  const fetched = [];
  page.on('request', (r) => {
    if (r.url().includes('downloads.spansh.co.uk') && r.method() === 'GET') fetched.push(r.url());
  });
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });

  await expect.poll(() => systemCount(page), { timeout: 30_000 }).toBe(2);
  await expect(page.locator('#feed')).toHaveClass(/live/);
  await page.waitForTimeout(1500);
  expect(fetched, 'the 16.6 MB dump was not downloaded').toEqual([]);
  expect(await systemCount(page)).toBe(2);
});

test('with nothing cached the map still builds from the dump', async ({ page }) => {
  await stubDataHosts(page);
  await stubDump(page);
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });

  await expect.poll(() => systemCount(page), { timeout: 60_000 }).toBe(5);
  await expect(page.locator('#feed')).toHaveClass(/live/);
});
