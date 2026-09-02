import { test, expect } from '@playwright/test';
import { stubDataHosts } from './helpers.mjs';

/* gr-data.html has 212 systems locally, enough to exercise paging without the
   network. codex.html finishes near 35,000, which is what made rendering the
   whole list at once lock the panel up. */
async function ruins(page) {
  await stubDataHosts(page);
  await page.goto('/gr-data.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app .top')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => window.Ed3d && Ed3d.updateSystems, { timeout: 30_000 });
  await page.evaluate(() => new Promise((res) => Ed3d.updateSystems({
    categories: { 'Site type': { a: { name: 'Alpha', color: 'FF9D00' } } },
    systems: Array.from({ length: 300 }, (_, i) => ({
      name: 'Test System ' + String(i).padStart(3, '0'),
      coords: { x: i * 3, y: 0, z: i }, cat: ['a']
    }))
  }, res)));
  await expect(page.locator('#side .layer').first()).toBeVisible({ timeout: 30_000 });
  await page.locator('.rail button[data-p="systems"]').click();
}

test('the systems list renders in pages rather than all at once', async ({ page }) => {
  await ruins(page);
  const rows = page.locator('.sysrow');
  await expect(rows).toHaveCount(80);              // one page, not 300

  // Scrolling brings in the next pages.
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => {
      const s = document.getElementById('side');
      s.scrollTop = s.scrollHeight;
      s.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(120);
  }
  await expect(rows).toHaveCount(300);
});

test('the filter and sort controls stay put while the list scrolls', async ({ page }) => {
  await ruins(page);
  await expect(page.locator('.syshead')).toHaveCSS('position', 'sticky');
  // Back-to-top only appears once there is somewhere to go back to.
  await expect(page.locator('#systotop')).toBeHidden();
  await page.evaluate(() => {
    const s = document.getElementById('side');
    s.scrollTop = 600; s.dispatchEvent(new Event('scroll'));
  });
  await expect(page.locator('#systotop')).toBeVisible();
  await page.locator('#systotop').click();
  await expect.poll(() => page.evaluate(() => document.getElementById('side').scrollTop))
    .toBeLessThan(50);
});

test('the panel can be resized and the width is remembered', async ({ page }) => {
  await ruins(page);
  const width = () => page.evaluate(() =>
    Math.round(document.getElementById('side').getBoundingClientRect().width));
  const before = await width();

  await page.evaluate(() => {
    const g = document.querySelector('.side-grip');
    const r = g.getBoundingClientRect();
    g.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.x, pointerId: 1 }));
    g.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.x + 100, pointerId: 1 }));
    g.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
  });
  expect(await width()).toBeGreaterThan(before);
  expect(await page.evaluate(() => localStorage.getItem('canonn.console.sideWidth')))
    .toBe(String(await width()));

  // The grip survives a panel re-render, which replaces the panel's contents.
  await page.locator('.rail button[data-p="layers"]').click();
  await expect(page.locator('.side-grip')).toHaveCount(1);
});

test('display settings and panel width carry to another map', async ({ page }) => {
  await ruins(page);
  await page.locator('.rail button[data-p="display"]').click();
  await page.locator('[data-sw="stars"]').click();          // turn the starfield off
  await page.evaluate(() => {
    const s = document.getElementById('sizerange');
    s.value = 44; s.dispatchEvent(new Event('input', { bubbles: true }));
  });

  await page.goto('/voyager.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#side .layer').first()).toBeVisible({ timeout: 60_000 });
  await page.locator('.rail button[data-p="display"]').click();

  await expect(page.locator('[data-sw="stars"]')).not.toHaveClass(/on/);
  await expect(page.locator('#szval')).toHaveText('44');
});

test('a collapsed panel stays collapsed, and the rail does not', async ({ page }) => {
  await ruins(page);
  // Clicking the active rail icon collapses the panel beside it.
  await page.locator('.rail button[data-p="systems"]').click();
  await expect(page.locator('#side')).toBeHidden();
  await expect(page.locator('.rail')).toBeVisible();

  await page.goto('/voyager.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app .top')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#side')).toBeHidden();
  await expect(page.locator('.rail')).toBeVisible();
});
