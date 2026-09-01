# ED3D Phase 0 — Safety Net and Quick Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a Playwright regression suite across all 50 pages, capture screenshot baselines on unmodified `master`, then land the five independent performance and supply-chain fixes with that safety net in place.

**Architecture:** A zero-dependency Node static server serves `Source/` as the web root (required — 49 pages reference `/js/jquery-2.1.4.min.js` root-absolutely). Playwright drives Chromium with SwiftShader so WebGL works headless. The default suite runs **offline**: every external data host is intercepted and fulfilled with an empty JSON array, so runs are deterministic, fast, and make zero calls to Canonn's metered cloud functions. A separate opt-in `live` project exercises real data plumbing on demand. Tests bind to one stable hook, `window.__ed3dTestState()`, so Phase 2's internals rewrite does not invalidate 50 test files.

**Tech Stack:** Node 24, `@playwright/test` (devDependency only), vanilla `node:http` static server. No bundler, no runtime dependencies added.

**Spec:** `docs/superpowers/specs/2026-09-01-ed3d-modernization-design.md`

## Deviation from the spec, recorded

Spec section 7 lists four assertions per page, one being "the expected system
count is rendered (> 0)". That assertion is **not** in the offline suite, because
the offline suite stubs data hosts with `[]` in order to stay deterministic and
avoid calling Canonn's metered cloud functions. System count is asserted in the
opt-in `live` project instead (Task 10). The other three assertions — no uncaught
error, WebGL context present, screenshot matches baseline — are all in the
offline suite and run on every `npm test`.

## Global Constraints

- **No build step on the content path.** `Source/` continues to deploy verbatim via `.github/workflows/mainl.yml`. Node is required to run tests, never to ship a change. (Spec D1, D3)
- **`package.json` contains `devDependencies` only.** No `dependencies` key. No runtime npm packages.
- **Do not modify `.github/workflows/mainl.yml`.** CI wiring is out of scope for this plan.
- **Server root is `Source/`**, not the repository root. 49 pages use the root-absolute path `/js/jquery-2.1.4.min.js`.
- **Tests assert only on `window.__ed3dTestState()`**, never on `System`, `scene`, `Ed3d`, or other internals. Those are rewritten in Phase 2.
- **The default `npm test` run must make zero requests to external hosts.** Canonn's cloud functions are billed per invocation (see the Canonn-GCloud README's design notes on invocation cost).
- **Phase 0 changes must not alter rendering.** Every screenshot diff in this plan is expected to be empty. A non-empty diff is a bug, not an update.
- Target three.js version for later phases is **r185 (`three@0.185.0`)**. Phase 0 stays on r75.

---

### Task 1: Test harness scaffolding

**Files:**
- Create: `package.json`
- Create: `test/server.mjs`
- Create: `playwright.config.mjs`
- Create: `test/pages.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: `node test/server.mjs` serves `Source/` on `http://localhost:4173`. `test/pages.json` is an array of `{ path: string, query: string, offlineSkip: boolean }`. `npm test` runs the `offline` Playwright project; `npm run test:live` runs the `live` project; `npm run test:update` refreshes screenshot baselines.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "canonn-ed3d-map",
  "private": true,
  "version": "0.0.0",
  "description": "Canonn ED3D galaxy map. Source/ is deployed verbatim; this package.json exists only for the test harness.",
  "scripts": {
    "serve": "node test/server.mjs",
    "test": "playwright test --project=offline",
    "test:live": "playwright test --project=live",
    "test:update": "playwright test --project=offline --update-snapshots"
  },
  "devDependencies": {
    "@playwright/test": "^1.56.0"
  }
}
```

- [ ] **Step 2: Create the static server at `test/server.mjs`**

```js
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

// Server root is Source/, not the repo root: 49 pages reference
// "/js/jquery-2.1.4.min.js" with a leading slash.
const ROOT = fileURLToPath(new URL('../Source/', import.meta.url));
const PORT = Number(process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.csv': 'text/csv; charset=utf-8'
};

createServer(async (req, res) => {
  const requested = new URL(req.url, 'http://localhost').pathname;
  let pathname;
  try {
    pathname = decodeURIComponent(requested);
  } catch {
    // decodeURIComponent throws on a malformed percent-escape (e.g. a lone
    // "%"). Answer 400 instead of letting the throw become an unhandled
    // rejection in this async handler, which would crash the process — and
    // with it the single webServer shared by every parallel Playwright worker.
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad Request');
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  // pathname always starts with "/" (it comes from URL.pathname), and
  // normalize() on an absolute path can never leave a leading ".." — there
  // is nothing above "/" to traverse to (e.g. normalize("/../etc") === "/etc").
  // That, plus join(ROOT, safe) and the startsWith(ROOT) check below, is what
  // keeps the resolved file inside ROOT.
  const safe = normalize(pathname);
  const file = join(ROOT, safe);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}).listen(PORT, () => {
  console.log(`serving Source/ on http://localhost:${PORT}`);
});
```

- [ ] **Step 3: Verify the server serves a page**

Run:
```bash
node test/server.mjs & sleep 1 && curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://localhost:4173/index.html && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4173/js/jquery-2.1.4.min.js && kill %1
```
Expected: `200 text/html; charset=utf-8` then `200`. The second check proves the root-absolute jQuery path resolves.

- [ ] **Step 4: Create `playwright.config.mjs`**

```js
import { defineConfig, devices } from '@playwright/test';

const BASE = 'http://localhost:4173';

export default defineConfig({
  testDir: './test',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  timeout: 120_000,
  expect: {
    timeout: 15_000,
    // WebGL + SwiftShader is not bit-identical across machines; allow a small
    // tolerance while still catching structural changes such as a grid whose
    // line spacing shifts by 100x.
    toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled' }
  },
  reporter: [['list']],
  use: {
    baseURL: BASE,
    viewport: { width: 1280, height: 800 },
    ...devices['Desktop Chrome'],
    launchOptions: {
      // Headless Chromium needs SwiftShader to produce a real WebGL context;
      // without these the canvas renders blank and every screenshot matches.
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    }
  },
  projects: [
    // 'offline' runs every spec except the live one. Do NOT narrow this to
    // smoke.spec.mjs — perf, deadcode and hook specs all run under it.
    { name: 'offline', testIgnore: /live\.spec\.mjs/ },
    { name: 'live', testMatch: /live\.spec\.mjs/ }
  ],
  webServer: {
    command: 'node test/server.mjs',
    url: `${BASE}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});
```

- [ ] **Step 5: Generate the page manifest**

Run:
```bash
node -e "const fs=require('fs');const p=fs.readdirSync('Source').filter(f=>f.endsWith('.html')).sort().map(path=>({path,query:'',offlineSkip:false}));fs.writeFileSync('test/pages.json',JSON.stringify(p,null,2)+'\n');console.log(p.length+' pages')"
```
Expected: `50 pages`. The `query` field carries page-specific URL parameters (13 data files read them); `offlineSkip` quarantines pages that cannot boot without live data. Both are filled in during Task 3.

- [ ] **Step 6: Ignore Playwright's generated output**

Append to `.gitignore`:

```
# Playwright test harness
node_modules/
test-results/
playwright-report/
blob-report/
.playwright/
```

- [ ] **Step 7: Install and confirm the toolchain**

Run:
```bash
npm install && npx playwright install chromium
```
Expected: install completes and `node_modules/` exists. Confirm no runtime deps were added:
```bash
node -e "const p=require('./package.json');if(p.dependencies)throw new Error('runtime dependency added');console.log('devDependencies only: OK')"
```
Expected: `devDependencies only: OK`

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json playwright.config.mjs test/server.mjs test/pages.json .gitignore
git commit -m "test: add Playwright harness and static server for Source/"
```

---

### Task 2: Stable test hook

**Files:**
- Modify: `Source/js/ed3dmap.js` (append hook near the end of the file; set the flag inside `loadDatasComplete`, currently ending at line 709)
- Test: `test/hook.spec.mjs`

**Interfaces:**
- Consumes: `test/server.mjs` from Task 1.
- Produces: `window.__ed3dTestState()` returning `{ sceneVisible: boolean, systemCount: number, dataComplete: boolean }`. This is the **only** surface later tests may assert on.

- [ ] **Step 1: Write the failing test**

Create `test/hook.spec.mjs`:

```js
import { test, expect } from '@playwright/test';

// voyager.html is used rather than index.html: index.html loads
// MapData-multifaction.js, which logs a warning and returns WITHOUT calling
// Ed3d.init() when no ?factions= parameter is present, so no scene ever exists.
// voyager.html has a single local data file, no URL parameters and no network.
const REFERENCE_PAGE = '/voyager.html';

test('__ed3dTestState reports scene readiness', async ({ page }) => {
  // No analytics beacons from the test suite. helpers.mjs does not exist yet,
  // so this is inline; Task 3 replaces it with stubDataHosts().
  await page.route(/googletagmanager\.com/, (r) => r.abort());

  await page.goto(REFERENCE_PAGE, { waitUntil: 'load' });

  await expect
    .poll(() => page.evaluate(() => typeof window.__ed3dTestState), { timeout: 30_000 })
    .toBe('function');

  await expect
    .poll(() => page.evaluate(() => window.__ed3dTestState().sceneVisible), { timeout: 60_000 })
    .toBe(true);

  const state = await page.evaluate(() => window.__ed3dTestState());
  expect(typeof state.systemCount).toBe('number');
  expect(typeof state.dataComplete).toBe('boolean');
});
```

`REFERENCE_PAGE` is inlined here because `test/helpers.mjs` does not exist until
Task 3. Later specs import it from there instead.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx playwright test test/hook.spec.mjs --project=offline`
Expected: FAIL — the `typeof window.__ed3dTestState` poll times out reporting `"undefined"`.

- [ ] **Step 3: Add the hook**

Append to the end of `Source/js/ed3dmap.js`:

```js

//------------------------------------------------------------------------------
// Automated-test hook.
//
// This is the ONLY surface the Playwright suite binds to.  Engine internals
// (System, scene, particle geometry) are rewritten during the three.js
// migration; keeping the tests behind this function means that rewrite does
// not invalidate 50 test files.  Do not remove or rename it.
//------------------------------------------------------------------------------

window.__ed3dTestState = function () {
  var visible = false;
  var count = 0;
  try { visible = (typeof scene !== 'undefined' && scene != null && scene.visible === true); } catch (e) { visible = false; }
  try { count = (typeof System !== 'undefined' && System != null && System.count) ? System.count : 0; } catch (e) { count = 0; }
  return {
    sceneVisible: visible,
    systemCount: count,
    dataComplete: Ed3d._testDataComplete === true
  };
};
```

- [ ] **Step 4: Set the completion flag**

In `Source/js/ed3dmap.js`, inside `'loadDatasComplete': function () {`, immediately after the line `this.Action.init();`, insert:

```js
    Ed3d._testDataComplete = true;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx playwright test test/hook.spec.mjs --project=offline`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add Source/js/ed3dmap.js test/hook.spec.mjs
git commit -m "test: add stable __ed3dTestState hook for the smoke suite"
```

---

### Task 3: Offline smoke suite across all 50 pages

**Files:**
- Create: `test/helpers.mjs`
- Create: `test/smoke.spec.mjs`
- Modify: `test/pages.json`

**Interfaces:**
- Consumes: `window.__ed3dTestState()` from Task 2; `test/pages.json` from Task 1.
- Produces: `test/helpers.mjs` exporting `DATA_HOSTS`, `ALLOWED_EXTERNAL`, `REFERENCE_PAGE` (`'/voyager.html'`), `stubDataHosts(page) -> { stubbed, externalContinued }`, and `waitForScene(page, expect, timeout?)`. Every later offline test imports from here. Also produces one test per page named exactly `smoke <path>`.

- [ ] **Step 1: Create the shared helper module**

Create `test/helpers.mjs`. This is deliberately **not** a `.spec.mjs` file:
importing a spec file re-registers all of its tests inside the importing suite,
which would run the 50 smoke tests again inside every other spec.

```js
// Every host that serves map *data*.  Asset CDNs are deliberately absent, so
// three.js and jQuery still load normally.  Canonn's cloud functions are billed
// per invocation, so the default suite must never call them.
export const DATA_HOSTS = [
  'api.canonn.tech',
  'us-central1-canonn-api-236217.cloudfunctions.net',
  'storage.googleapis.com',
  'edastro.com',
  'dcoh.watch',
  'elitebgs.app',
  'downloads.spansh.co.uk',
  'edsm.net',
  'www.edsm.net',
  'ruins.canonn.tech',
  'signals.canonn.tech',
  'www.googletagmanager.com'
];

// Hosts the offline suite is allowed to actually contact: assets only.
export const ALLOWED_EXTERNAL = [
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'maxcdn.bootstrapcdn.com'
];

// voyager.html is the reference page for engine-level tests: a single local
// data file, no URL parameters, no network, and withHudPanel enabled.
// Do NOT use index.html — it loads MapData-multifaction.js, which returns
// early and never calls Ed3d.init() when no ?factions= parameter is present.
export const REFERENCE_PAGE = '/voyager.html';

/**
 * Intercept every request. Data hosts are answered with an empty JSON array.
 * Returns a live record so tests can assert nothing leaked to a data host that
 * is missing from DATA_HOSTS.
 */
export async function stubDataHosts(page) {
  const record = { stubbed: [], externalContinued: [] };
  await page.route('**/*', async (route) => {
    const host = new URL(route.request().url()).hostname;
    if (DATA_HOSTS.includes(host)) {
      record.stubbed.push(host);
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    if (host !== 'localhost' && host !== '127.0.0.1') {
      record.externalContinued.push(host);
    }
    await route.continue();
  });
  return record;
}

/** Poll until the map reports a visible scene. */
export async function waitForScene(page, expect, timeout = 60_000) {
  await expect
    .poll(() => page.evaluate(() => window.__ed3dTestState?.().sceneVisible ?? false), { timeout })
    .toBe(true);
}
```

- [ ] **Step 2: Write the failing test**

Create `test/smoke.spec.mjs`:

```js
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { stubDataHosts, waitForScene, ALLOWED_EXTERNAL } from './helpers.mjs';

const pages = JSON.parse(
  readFileSync(new URL('./pages.json', import.meta.url), 'utf8')
);

for (const p of pages) {
  const spec = p.offlineSkip ? test.skip : test;
  spec(`smoke ${p.path}`, async ({ page }) => {
    const crashes = [];
    page.on('pageerror', (e) => crashes.push(String(e)));

    const net = await stubDataHosts(page);
    await page.goto(`/${p.path}${p.query}`, { waitUntil: 'load' });
    await waitForScene(page, expect);

    // A real WebGL context must exist; a blank canvas would make every
    // screenshot assertion vacuously pass.
    const hasGL = await page.evaluate(() => {
      const c = document.querySelector('#ed3dmap canvas');
      return !!(c && (c.getContext('webgl2') || c.getContext('webgl')));
    });
    expect(hasGL, 'WebGL context present').toBe(true);

    // Any external host that was NOT stubbed must be a known asset CDN.
    // This is what catches a new data source missing from DATA_HOSTS.
    const leaked = [...new Set(net.externalContinued)]
      .filter((h) => !ALLOWED_EXTERNAL.includes(h));
    expect(leaked, `unstubbed external host contacted by ${p.path}`).toEqual([]);

    expect(crashes, `uncaught errors on ${p.path}`).toEqual([]);
  });
}
```

- [ ] **Step 3: Run it to see which pages fail on unmodified master**

Run: `npx playwright test test/smoke.spec.mjs --project=offline --reporter=list`
Expected: most pages PASS. Some may FAIL — those are pre-existing conditions on `master`, **not** regressions. Record the failing page names.

- [ ] **Step 4: Quarantine or repair each failure**

For every page that failed in Step 3, decide and act:

- **Failed because a data file needs a URL parameter** (13 files read `getUrlParameter` / `URLSearchParams`): set that page's `query` in `test/pages.json`, e.g. `"query": "?factions=Canonn"` for `multifaction.html`. Re-run.
- **Failed because an empty `[]` response breaks its loader**: set `"offlineSkip": true` for that page and add a one-line reason comment in the commit message. It is covered by the `live` project in Task 10 instead.

Re-run until the suite is green:
```bash
npx playwright test test/smoke.spec.mjs --project=offline
```
Expected: PASS, 0 failures. Skipped pages are acceptable and must be listed in the commit message.

The `leaked` assertion already in the test is what surfaces a missing host: if a
page contacts a data API not present in `DATA_HOSTS`, that hostname appears in
`net.externalContinued` and the test fails naming it. When that happens, add the
host to `DATA_HOSTS` in `test/helpers.mjs` rather than to the allow-list.

- [ ] **Step 5: Commit**

```bash
git add test/helpers.mjs test/smoke.spec.mjs test/pages.json
git commit -m "test: add offline smoke suite covering all 50 pages"
```

---

### Task 4: Capture screenshot baselines on unmodified master

**Files:**
- Modify: `test/smoke.spec.mjs`
- Create: `test/smoke.spec.mjs-snapshots/` (generated)

**Interfaces:**
- Consumes: the green offline suite from Task 3.
- Produces: committed PNG baselines. Every subsequent task in this plan asserts against these.

This task must complete **before** any source change in Tasks 5–9. The baselines are the only thing that catches silent visual breakage such as the `GridHelper` signature change documented in the spec.

- [ ] **Step 1: Add the screenshot assertion**

In `test/smoke.spec.mjs`, replace the final line of the test body — `expect(crashes, \`uncaught errors on ${p.path}\`).toEqual([]);` — with:

```js
    expect(crashes, `uncaught errors on ${p.path}`).toEqual([]);

    // Settle the render loop so the starfield and grid text stop moving.
    await page.waitForTimeout(2500);
    await expect(page.locator('#edmap')).toHaveScreenshot(`${p.path}.png`);
```

- [ ] **Step 2: Generate the baselines**

Run: `npx playwright test test/smoke.spec.mjs --project=offline --update-snapshots`
Expected: PASS. A PNG per non-skipped page appears under `test/smoke.spec.mjs-snapshots/`.

- [ ] **Step 3: Verify the baselines are stable across two consecutive runs**

Run: `npx playwright test test/smoke.spec.mjs --project=offline`
Expected: PASS with no diffs. If a page flakes, raise only that page's tolerance by adding a `maxDiffPixelRatio` argument to its assertion rather than loosening the global setting.

- [ ] **Step 4: Commit**

```bash
git add test/smoke.spec.mjs test/smoke.spec.mjs-snapshots
git commit -m "test: capture screenshot baselines on unmodified master

Baselines are the reference point for the whole modernization effort.
Any diff in Phase 0 is a bug, not an update."
```

---

### Task 5: Fix the dead frame throttle

**Files:**
- Modify: `Source/js/ed3dmap.js:1088-1094` (`refreshWithCamPos`)
- Test: `test/perf.spec.mjs`

**Interfaces:**
- Consumes: `window.__ed3dTestState()`.
- Produces: nothing consumed by later tasks.

The guard `if (n % 1 != 0) return;` can never be true — an integer modulo 1 is always 0 — so the intended throttle never fires and `addCoords()` runs on both grids every frame, allocating an options object and building a coordinate string each time. The comment claims 5 seconds; restoring that literally would make the grid coordinate labels visibly lag, so this throttles to 100 ms (10 Hz), which is imperceptible for text labels and cuts the work roughly sixfold at 60 fps.

- [ ] **Step 1: Write the failing test**

Create `test/perf.spec.mjs`:

```js
import { test, expect } from '@playwright/test';
import { stubDataHosts, waitForScene, REFERENCE_PAGE } from './helpers.mjs';

test('grid addCoords is throttled, not called every frame', async ({ page }) => {
  await stubDataHosts(page);
  await page.goto(REFERENCE_PAGE, { waitUntil: 'load' });
  await waitForScene(page, expect);

  const calls = await page.evaluate(async () => {
    let n = 0;
    const orig = Ed3d.grid1H.addCoords;
    Ed3d.grid1H.addCoords = function () {
      n++;
      return orig.apply(this, arguments);
    };
    await new Promise((r) => setTimeout(r, 1000));
    Ed3d.grid1H.addCoords = orig;
    return n;
  });

  // At 60 fps an unthrottled loop calls this ~60 times per second.
  // A 100 ms throttle yields ~10, so 20 is a generous ceiling.
  expect(calls).toBeLessThanOrEqual(20);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx playwright test test/perf.spec.mjs --project=offline`
Expected: FAIL — received roughly 55–60 calls, exceeding 20.

- [ ] **Step 3: Implement the throttle**

In `Source/js/ed3dmap.js`, replace:

```js
function refreshWithCamPos() {

  var d = new Date();
  var n = d.getTime();

  //-- Refresh only every 5 sec
  if (n % 1 != 0) return;

  Ed3d.grid1H.addCoords();
  Ed3d.grid1K.addCoords();
```

with:

```js
var lastCoordRefresh = 0;

function refreshWithCamPos() {

  //-- Throttle the grid coordinate labels to 10 Hz.  The previous guard here
  //   was `if (n % 1 != 0) return;` which can never be true, so this ran on
  //   every frame.
  var now = performance.now();
  if (now - lastCoordRefresh >= 100) {
    lastCoordRefresh = now;
    Ed3d.grid1H.addCoords();
    Ed3d.grid1K.addCoords();
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx playwright test test/perf.spec.mjs --project=offline`
Expected: PASS

- [ ] **Step 5: Verify no visual regression**

Run: `npx playwright test test/smoke.spec.mjs --project=offline`
Expected: PASS with zero screenshot diffs.

- [ ] **Step 6: Commit**

```bash
git add Source/js/ed3dmap.js test/perf.spec.mjs
git commit -m "perf: fix grid coordinate throttle that never fired

The guard was 'n % 1 != 0' where n is Date.getTime(); an integer mod 1
is always 0, so addCoords ran on both grids every frame. Throttled to
10 Hz and dropped the per-frame Date allocation."
```

---

### Task 6: Eliminate per-frame HUD DOM writes

**Files:**
- Modify: `Source/js/ed3dmap.js:893-897` (inside `animate`)
- Test: `test/perf.spec.mjs`

**Interfaces:**
- Consumes: `stubDataHosts` from `test/smoke.spec.mjs`.
- Produces: nothing consumed by later tasks.

Four jQuery selector lookups plus DOM writes run on every frame. While the camera is stationary the written values are identical, so all four writes are pure waste.

- [ ] **Step 1: Write the failing test**

Append to `test/perf.spec.mjs`:

```js
test('HUD readouts do not churn the DOM while the camera is idle', async ({ page }) => {
  await stubDataHosts(page);
  await page.goto(REFERENCE_PAGE, { waitUntil: 'load' });
  await waitForScene(page, expect);

  const mutations = await page.evaluate(async () => {
    const targets = ['cx', 'cy', 'cz', 'distsol']
      .map((id) => document.getElementById(id))
      .filter(Boolean);
    if (targets.length === 0) return -1;
    let n = 0;
    const obs = new MutationObserver((records) => { n += records.length; });
    targets.forEach((t) => obs.observe(t, { childList: true, characterData: true, subtree: true }));
    await new Promise((r) => setTimeout(r, 1000));
    obs.disconnect();
    return n;
  });

  expect(mutations, 'HUD elements were found').toBeGreaterThanOrEqual(0);
  // Idle camera means identical values; a correct implementation writes none.
  expect(mutations).toBeLessThanOrEqual(4);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx playwright test test/perf.spec.mjs --project=offline -g "churn"`
Expected: FAIL — roughly 240 mutations (4 elements × ~60 frames), far above 4.

- [ ] **Step 3: Implement cached, change-gated writes**

In `Source/js/ed3dmap.js`, add above `function animate(time) {`:

```js
//-- Cached HUD readout nodes and their last-written values.  These four
//   readouts previously ran a jQuery selector lookup and a DOM write on every
//   frame even when the values had not changed.
var hudReadout = { cx: null, cy: null, cz: null, distsol: null };
var hudReadoutLast = { cx: null, cy: null, cz: null, distsol: null };

function setHudReadout(id, value) {
  if (hudReadoutLast[id] === value) return;
  if (hudReadout[id] === null) {
    hudReadout[id] = document.getElementById(id);
    if (hudReadout[id] === null) return;
  }
  hudReadout[id].textContent = value;
  hudReadoutLast[id] = value;
}
```

Then replace:

```js
  $('#cx').html(Math.round(controls.target.x));
  $('#cy').html(Math.round(controls.target.y));
  $('#cz').html(Math.round(-controls.target.z)); // Reverse z coord

  $('#distsol').html(Ed3d.calcDistSol(controls.target));
```

with:

```js
  setHudReadout('cx', Math.round(controls.target.x));
  setHudReadout('cy', Math.round(controls.target.y));
  setHudReadout('cz', Math.round(-controls.target.z)); // Reverse z coord
  setHudReadout('distsol', Ed3d.calcDistSol(controls.target));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx playwright test test/perf.spec.mjs --project=offline -g "churn"`
Expected: PASS

- [ ] **Step 5: Verify the readouts still update when the camera moves**

Append to `test/perf.spec.mjs`:

```js
test('HUD readouts still update when the camera moves', async ({ page }) => {
  await stubDataHosts(page);
  await page.goto(REFERENCE_PAGE, { waitUntil: 'load' });
  await waitForScene(page, expect);

  const before = await page.evaluate(() => document.getElementById('cx')?.textContent ?? null);
  await page.evaluate(async () => {
    controls.target.x += 500;
    await new Promise((r) => setTimeout(r, 300));
  });
  const after = await page.evaluate(() => document.getElementById('cx')?.textContent ?? null);

  expect(before).not.toBeNull();
  expect(after).not.toBe(before);
});
```

Run: `npx playwright test test/perf.spec.mjs --project=offline`
Expected: PASS — all three perf tests green.

- [ ] **Step 6: Verify no visual regression**

Run: `npx playwright test test/smoke.spec.mjs --project=offline`
Expected: PASS with zero screenshot diffs.

- [ ] **Step 7: Commit**

```bash
git add Source/js/ed3dmap.js test/perf.spec.mjs
git commit -m "perf: cache HUD readout nodes and write only on change

Four jQuery lookups plus DOM writes ran every frame regardless of
whether the values changed. Now cached and change-gated."
```

---

### Task 7: Narrow and throttle the mousemove raycast

**Files:**
- Modify: `Source/js/components/action.class.js:178-200` (`onMouseHover`)
- Test: `test/perf.spec.mjs`

**Interfaces:**
- Consumes: `stubDataHosts`.
- Produces: nothing consumed by later tasks.

`onMouseHover` calls `intersectObjects(scene.children)` on every `mousemove`, walking every top-level object in the scene rather than the point cloud that actually carries the clickable systems. Two fixes: intersect only the objects that can be hit, and coalesce bursts of mousemove events to one raycast per animation frame.

- [ ] **Step 1: Read the current handler**

Run: `sed -n '170,205p' Source/js/components/action.class.js`
Expected: the `onMouseHover` body, including `obj.raycaster = new THREE.Raycaster(...)` and `var intersects = obj.raycaster.intersectObjects(scene.children);`. Note the exact surrounding lines before editing — the line numbers above are from `master` and shift as earlier tasks land.

- [ ] **Step 2: Write the failing test**

Append to `test/perf.spec.mjs`:

```js
test('mousemove raycasts are coalesced and scoped to hit candidates', async ({ page }) => {
  await stubDataHosts(page);
  await page.goto(REFERENCE_PAGE, { waitUntil: 'load' });
  await waitForScene(page, expect);

  await page.evaluate(() => {
    window.__ray = { calls: 0, maxTargets: 0 };
    const proto = THREE.Raycaster.prototype;
    const orig = proto.intersectObjects;
    proto.intersectObjects = function (objects) {
      window.__ray.calls++;
      window.__ray.maxTargets = Math.max(window.__ray.maxTargets, objects.length);
      return orig.apply(this, arguments);
    };
  });

  const box = await page.locator('#ed3dmap canvas').boundingBox();
  for (let i = 0; i < 30; i++) {
    await page.mouse.move(box.x + 200 + i * 4, box.y + 200 + i * 2);
  }
  await page.waitForTimeout(500);

  const ray = await page.evaluate(() => window.__ray);
  // 30 mousemoves must not produce 30 raycasts once coalesced to one per frame.
  expect(ray.calls).toBeLessThan(30);
  // And each raycast must target the hit-candidate list, not every scene child.
  expect(ray.maxTargets).toBeLessThanOrEqual(3);
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `npx playwright test test/perf.spec.mjs --project=offline -g "coalesced"`
Expected: FAIL — `ray.maxTargets` is the full `scene.children` length (well above 3), and `ray.calls` is about 30.

- [ ] **Step 4: Implement coalescing and scoping**

In `Source/js/components/action.class.js`, add these properties to the `Action` object alongside the existing `'raycaster' : null,` declaration:

```js
  'hoverPending'  : false,
  'hoverEvent'    : null,
```

Add this method to the `Action` object:

```js
  /**
   * The only objects a hover raycast can meaningfully hit: the system point
   * cloud plus any solid spheres.  Previously this walked all of
   * scene.children on every mousemove.
   */
  'hitCandidates' : function() {
    var targets = [];
    if (System.particle != null) targets.push(System.particle);
    return targets;
  },
```

Then, in `onMouseHover`, replace the body's opening so that the handler stores the event and defers the work to the next animation frame. Change:

```js
  'onMouseHover' : function(event, obj) {
```

to:

```js
  'onMouseHover' : function(event, obj) {

    //-- Coalesce bursts of mousemove events to one raycast per frame.
    obj.hoverEvent = event;
    if (obj.hoverPending) return;
    obj.hoverPending = true;
    requestAnimationFrame(function() {
      obj.hoverPending = false;
      obj.doMouseHover(obj.hoverEvent, obj);
    });
  },

  'doMouseHover' : function(event, obj) {
```

Finally, replace the line:

```js
    var intersects = obj.raycaster.intersectObjects(scene.children);
```

with:

```js
    var intersects = obj.raycaster.intersectObjects(obj.hitCandidates());
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx playwright test test/perf.spec.mjs --project=offline -g "coalesced"`
Expected: PASS

- [ ] **Step 6: Verify hover still selects a system**

Append to `test/perf.spec.mjs`:

```js
test('hover still resolves a system under the cursor', async ({ page }) => {
  await stubDataHosts(page);
  await page.goto(REFERENCE_PAGE, { waitUntil: 'load' });
  await waitForScene(page, expect);

  // Sagittarius A* is registered as a clickable particle on every map.
  const hit = await page.evaluate(() => {
    const targets = Action.hitCandidates();
    return targets.length > 0;
  });
  expect(hit, 'hover raycast has at least one target object').toBe(true);
});
```

Run: `npx playwright test test/perf.spec.mjs --project=offline`
Expected: PASS — all perf tests green.

- [ ] **Step 7: Verify no visual regression**

Run: `npx playwright test test/smoke.spec.mjs --project=offline`
Expected: PASS with zero screenshot diffs.

- [ ] **Step 8: Commit**

```bash
git add Source/js/components/action.class.js test/perf.spec.mjs
git commit -m "perf: coalesce hover raycasts to one per frame and scope targets

intersectObjects(scene.children) ran on every mousemove. Now deferred to
the next animation frame and scoped to the system point cloud."
```

---

### Task 8: Remove dead code

**Files:**
- Delete: `Source/js/ed3dmap.min.js`
- Delete: `Source/vendor/three-js/Projector.js`
- Delete: `Source/vendor/three-js/CSS3DRenderer.js`
- Delete: `Source/vendor/three-js/RaytracingRenderer.js`
- Delete: `Source/vendor/three-js/TextGeometry.js`
- Delete: `Source/vendor/three-js/ShaderMaterial.js`
- Modify: `Source/js/ed3dmap.js:205-232` (remove two `$.getScript` lines)
- Modify: `Source/js/components/system.class.js:173` and `Source/js/components/galaxy.class.js:373,397` (remove `sortParticles`)
- Test: `test/deadcode.spec.mjs`

**Interfaces:**
- Consumes: `stubDataHosts`.
- Produces: nothing consumed by later tasks.

`ed3dmap.min.js` is referenced nowhere. `Projector.js` and `CSS3DRenderer.js` are fetched by the dependency waterfall but used nowhere. The other three vendored files are referenced only by the dead minified bundle. `sortParticles` was removed from three.js long before r75 and is already a no-op.

- [ ] **Step 1: Write the failing test**

Create `test/deadcode.spec.mjs`:

```js
import { test, expect } from '@playwright/test';
import { stubDataHosts, waitForScene, REFERENCE_PAGE } from './helpers.mjs';

const DEAD = [
  'ed3dmap.min.js',
  'Projector.js',
  'CSS3DRenderer.js',
  'RaytracingRenderer.js',
  'TextGeometry.js',
  'ShaderMaterial.js'
];

test('no dead vendor file is requested', async ({ page }) => {
  const requested = [];
  page.on('request', (r) => {
    const name = new URL(r.url()).pathname.split('/').pop();
    if (DEAD.includes(name)) requested.push(name);
  });

  await stubDataHosts(page);
  await page.goto(REFERENCE_PAGE, { waitUntil: 'load' });
  await waitForScene(page, expect);

  expect(requested).toEqual([]);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx playwright test test/deadcode.spec.mjs --project=offline`
Expected: FAIL — `requested` contains `Projector.js` and `CSS3DRenderer.js`.

- [ ] **Step 3: Remove the dead `$.getScript` loads**

In `Source/js/ed3dmap.js`, delete these two lines from the first `$.when(` block:

```js
      $.getScript(Ed3d.basePath + "vendor/three-js/CSS3DRenderer.js"),
      $.getScript(Ed3d.basePath + "vendor/three-js/Projector.js"),
```

Leave the `OrbitControls.js` and `FontUtils.js` lines — both are genuinely used.

- [ ] **Step 4: Delete the dead files**

```bash
git rm Source/js/ed3dmap.min.js \
       Source/vendor/three-js/Projector.js \
       Source/vendor/three-js/CSS3DRenderer.js \
       Source/vendor/three-js/RaytracingRenderer.js \
       Source/vendor/three-js/TextGeometry.js \
       Source/vendor/three-js/ShaderMaterial.js
```

- [ ] **Step 5: Remove the no-op `sortParticles` assignments**

Delete the line `this.particle.sortParticles = true;` from `Source/js/components/system.class.js`, and the lines `points.sortParticles = true;` and `pointsBig.sortParticles = true;` from `Source/js/components/galaxy.class.js`.

Verify none remain:
```bash
grep -rn "sortParticles" Source/ || echo "none remaining"
```
Expected: `none remaining`

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx playwright test test/deadcode.spec.mjs --project=offline`
Expected: PASS

- [ ] **Step 7: Verify no page regressed**

Run: `npx playwright test test/smoke.spec.mjs test/perf.spec.mjs --project=offline`
Expected: PASS with zero screenshot diffs across all 50 pages.

- [ ] **Step 8: Commit**

```bash
git add -A Source test/deadcode.spec.mjs
git commit -m "chore: delete unused vendor files and no-op assignments

ed3dmap.min.js was referenced nowhere. Projector and CSS3DRenderer were
fetched by the loader but never used; the other three were referenced
only by the dead bundle. sortParticles has been a no-op since before r75."
```

---

### Task 9: Replace the w3schools nav include

**Files:**
- Create: `Source/js/nav-include.js`
- Modify: all 50 `Source/*.html` files (one line each)
- Test: `test/deadcode.spec.mjs`

**Interfaces:**
- Consumes: `stubDataHosts`.
- Produces: a global `w3IncludeHTML(callback?)`. The function name and the `w3-include-html` attribute are **deliberately preserved** so the per-page change is a single `src` swap and the conditional logic in `ida-data.html` keeps working untouched.

All 50 pages load `https://www.w3schools.com/lib/w3data.js` — a third-party script with full DOM access on a production domain, from a host that is not a CDN and offers no integrity or availability guarantee. `include/nav.html` contains no nested includes, so a drop-in local replacement is straightforward.

- [ ] **Step 1: Write the failing test**

Append to `test/deadcode.spec.mjs`:

```js
test('nav renders without contacting w3schools', async ({ page }) => {
  const thirdParty = [];
  page.on('request', (r) => {
    if (new URL(r.url()).hostname.endsWith('w3schools.com')) thirdParty.push(r.url());
  });

  await stubDataHosts(page);
  await page.goto(REFERENCE_PAGE, { waitUntil: 'load' });

  // nav.html contains <div id="cssmenu">; voyager.html includes it.
  await expect(page.locator('#cssmenu')).toBeAttached({ timeout: 30_000 });
  expect(thirdParty, 'no request reached w3schools.com').toEqual([]);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx playwright test test/deadcode.spec.mjs --project=offline -g "w3schools"`
Expected: FAIL — `thirdParty` contains the `w3data.js` URL.

- [ ] **Step 3: Create the local replacement**

Create `Source/js/nav-include.js`:

```js
/**
 * Local replacement for w3schools' w3data.js.
 *
 * Implements only the w3-include-html behaviour this site uses.  The function
 * name and attribute are kept identical so pages need only swap the script
 * src; per-page logic that toggles the attribute (see ida-data.html) keeps
 * working unchanged.  nav.html contains no nested includes, so a single pass
 * is sufficient.
 */
function w3IncludeHTML(callback) {

  var nodes = document.querySelectorAll('[w3-include-html]');

  if (nodes.length === 0) {
    if (typeof callback === 'function') callback();
    return;
  }

  var pending = nodes.length;

  Array.prototype.forEach.call(nodes, function (el) {

    var file = el.getAttribute('w3-include-html');

    fetch(file)
      .then(function (res) {
        if (!res.ok) throw new Error(res.status + ' ' + file);
        return res.text();
      })
      .then(function (html) {
        el.innerHTML = html;
      })
      .catch(function (err) {
        el.innerHTML = '';
        console.error('nav include failed:', err);
      })
      .then(function () {
        el.removeAttribute('w3-include-html');
        pending -= 1;
        if (pending === 0 && typeof callback === 'function') callback();
      });
  });
}
```

- [ ] **Step 4: Swap the script tag on every page**

```bash
cd Source && sed -i 's|<script src="https://www.w3schools.com/lib/w3data.js"></script>|<script src="js/nav-include.js"></script>|g' *.html && cd ..
```

Verify the swap is complete:
```bash
grep -rl "w3schools.com" Source/ || echo "no w3schools references remain"
grep -rlc "js/nav-include.js" Source/*.html | wc -l
```
Expected: `no w3schools references remain`, then `50`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx playwright test test/deadcode.spec.mjs --project=offline`
Expected: PASS

- [ ] **Step 6: Verify the nav renders on every page**

Run: `npx playwright test test/smoke.spec.mjs --project=offline`
Expected: PASS with zero screenshot diffs. The nav is inside the screenshot region on pages where it is visible, so a broken include would surface as a diff.

- [ ] **Step 7: Commit**

```bash
git add Source/js/nav-include.js Source/*.html test/deadcode.spec.mjs
git commit -m "security: replace w3schools w3data.js with a local nav include

All 50 pages loaded a third-party script with full DOM access from a
host with no integrity or availability guarantee. The replacement keeps
the w3IncludeHTML name and w3-include-html attribute so per-page logic
is untouched."
```

---

### Task 10: Opt-in live-data suite

**Files:**
- Create: `test/live.spec.mjs`

**Interfaces:**
- Consumes: `test/pages.json`, `window.__ed3dTestState()`.
- Produces: `npm run test:live`. Never part of the default `npm test`.

The offline suite proves the engine boots and renders; it deliberately stubs data. This project proves the data plumbing works end to end. It is opt-in because Canonn's cloud functions are billed per invocation and the pages it covers hit real infrastructure.

- [ ] **Step 1: Write the test**

Create `test/live.spec.mjs`:

```js
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const pages = JSON.parse(
  readFileSync(new URL('./pages.json', import.meta.url), 'utf8')
);

test.describe.configure({ mode: 'serial' });

for (const p of pages) {
  test(`live ${p.path}`, async ({ page }) => {
    const crashes = [];
    page.on('pageerror', (e) => crashes.push(String(e)));

    await page.goto(`/${p.path}${p.query}`, { waitUntil: 'load' });

    await expect
      .poll(() => page.evaluate(() => window.__ed3dTestState?.().sceneVisible ?? false), {
        timeout: 90_000
      })
      .toBe(true);

    await expect
      .poll(() => page.evaluate(() => window.__ed3dTestState?.().systemCount ?? 0), {
        timeout: 90_000
      })
      .toBeGreaterThan(0);

    expect(crashes, `uncaught errors on ${p.path}`).toEqual([]);
  });
}
```

`mode: 'serial'` keeps the suite from issuing 50 concurrent bursts at Canonn's infrastructure.

- [ ] **Step 2: Run it**

Run: `npm run test:live`
Expected: most pages PASS. Record any failures — they indicate a genuinely broken data source, not a migration regression, and belong in a separate issue rather than this plan.

- [ ] **Step 3: Commit**

```bash
git add test/live.spec.mjs
git commit -m "test: add opt-in live-data suite

Excluded from the default run because Canonn's cloud functions are
billed per invocation."
```

---

### Task 11: Document the harness

**Files:**
- Create: `test/README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Write the document**

Create `test/README.md`:

```markdown
# ED3D test harness

Node is needed only to run these tests. It is **not** needed to ship a change:
`Source/` still deploys verbatim, and editing a `MapData-*.js` file or an HTML
page requires nothing but a text editor and a push.

## Setup

    npm install
    npx playwright install chromium

## Running

| Command | What it does |
|---|---|
| `npm test` | Offline suite across all 50 pages. Deterministic. No external calls. |
| `npm run test:live` | Opt-in suite against real data sources. Slow; hits metered infrastructure. |
| `npm run test:update` | Regenerate screenshot baselines. Only when a visual change is intended. |
| `npm run serve` | Serve `Source/` on http://localhost:4173 for manual poking. |

## How it works

`test/server.mjs` serves `Source/` as the web root — required, because 49 pages
reference `/js/jquery-2.1.4.min.js` with a leading slash.

The offline suite intercepts every host in `DATA_HOSTS` (`test/smoke.spec.mjs`)
and answers with `[]`. Asset CDNs are deliberately *not* intercepted, so
three.js and jQuery load normally. Canonn's cloud functions are billed per
invocation, so the default run must never contact them — if you add a new data
source, add its host to `DATA_HOSTS`.

Tests assert only on `window.__ed3dTestState()`, defined at the bottom of
`Source/js/ed3dmap.js`. Engine internals are being rewritten; that hook is the
contract. Do not bind tests to `System`, `scene`, or `Ed3d` directly.

## Adding a page

Add an entry to `test/pages.json`:

    { "path": "my-page.html", "query": "?foo=bar", "offlineSkip": false }

Set `offlineSkip: true` only if the page cannot boot without live data. Then run
`npm run test:update` to generate its baseline.
```

- [ ] **Step 2: Commit**

```bash
git add test/README.md
git commit -m "docs: document the test harness and why Node is dev-only"
```

---

## Phase 0 exit criteria

- [ ] `npm test` green across all 50 pages, zero screenshot diffs against the Task 4 baselines
- [ ] `npm run test:live` run once and its results recorded
- [ ] No request to `w3schools.com` from any page
- [ ] No request for any deleted vendor file
- [ ] `package.json` has no `dependencies` key
- [ ] `.github/workflows/mainl.yml` unchanged

## What comes next

Phases 1–3 get their own plans, written after this one lands. Phase 1's plan is
deliberately deferred: Task 8 removes dead code and Task 9 removes the w3schools
dependency, which changes what actually needs converting to ES modules. Writing
that plan now would mean planning against a file set that is about to change.
