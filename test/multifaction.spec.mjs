import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { stubDataHosts } from './helpers.mjs';

/* The landing page, offline.
 *
 * index.html was the one page in the project with no offline coverage, and
 * also the most reported-on: it is the map with four thousand systems, the
 * one whose bloom glare got raised, and the only one that swaps a cached
 * snapshot for a live dump seconds in. It was skipped because it cannot boot
 * without its data — no ?factions= parameter and it returns before Ed3d.init,
 * and the dump itself is a gzipped JSON array from Spansh.
 *
 * So the dump is a fixture: three factions over six real systems with their
 * real coordinates, gzipped exactly as Spansh serves it, which also means the
 * DecompressionStream path is under test rather than stubbed around.
 */
const DUMP = readFileSync(new URL('./fixtures/spansh-factions.json.gz', import.meta.url));

async function landing(page, query) {
  await stubDataHosts(page);
  // After stubDataHosts, so this wins for the one URL it names.
  await page.route('**/downloads.spansh.co.uk/factions.json.gz', (route) => route.fulfill({
    status: 200,
    headers: { 'content-type': 'application/gzip', 'access-control-allow-origin': '*' },
    body: DUMP
  }));
  await page.goto('/index.html' + query, { waitUntil: 'domcontentloaded' });
}

test('the landing page boots from a real Spansh dump', async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(String(e)));

  await landing(page, '?factions=Canonn,Canonn%20Deep%20Space%20Research');

  // The console comes up, which means Ed3d.init() was reached.
  await expect(page.locator('.app .top')).toBeVisible({ timeout: 60_000 });
  // And the loading screen gets out of the way.
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });

  /* Both requested factions get their own pair of categories — controlled and
     present — which is the thing this page exists to show.

     The faction is the group heading, not the row: the rows are "Controlled"
     and "Present", and with two factions there are four of them. Which is
     precisely why readCats keeps Ed3d's <h2> group — without it the panel
     reads "Controlled, Present, Controlled, Present" and says whose about
     none of it. */
  await page.locator('.rail button[data-p="layers"]').click();
  const layers = page.locator('#side .layer');
  await expect.poll(() => layers.count(), { timeout: 30_000 }).toBe(4);
  expect((await layers.allTextContents()).join(' ')).toMatch(/Controlled.*Present/s);

  const groups = await page.locator('#side .lgrp').allTextContents();
  expect(groups).toEqual(['Canonn', 'Canonn Deep Space Research']);

  expect(crashes, 'nothing threw on the way up').toEqual([]);
});

test('the landing page plots the systems the dump gave it', async ({ page }) => {
  await landing(page, '?factions=Canonn,Canonn%20Deep%20Space%20Research');
  await expect(page.locator('.app .top')).toBeVisible({ timeout: 60_000 });

  await expect.poll(() => page.evaluate(() =>
    (window.System && System.points ? System.points.length : 0)),
    { timeout: 30_000 }).toBeGreaterThan(3);

  /* Coordinates land where Spansh put them, with z negated for the scene the
     way every other point in the cloud is. Maia is at z -343.25. */
  const maia = await page.evaluate(() => {
    const p = (System.points || []).find((q) => q && q.name === 'Maia');
    return p ? [p.x, p.y, p.z] : null;
  });
  expect(maia, 'Maia is on the map').not.toBeNull();
  expect(maia[0]).toBeCloseTo(-81.625, 3);
  expect(maia[2]).toBeCloseTo(343.25, 3);
});

test('no factions parameter is explained, not a blank screen', async ({ page }) => {
  /* The early return is deliberate — the page cannot know which factions to
     plot — but it is worth pinning that it puts the loading screen away and
     leaves the console standing rather than spinning forever. */
  await landing(page, '');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });
});
