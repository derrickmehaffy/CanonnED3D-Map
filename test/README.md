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
| `npm test` | The whole suite across all 36 pages. Deterministic, offline, ~18s. |
| `npm run serve` | Serve `Source/` on http://localhost:4173 for manual poking. |

## What it checks

For every page that can boot offline, the smoke suite asserts:

1. The page loads and the scene becomes visible.
2. A real WebGL context exists (a blank canvas would make everything else vacuous).
3. No uncaught page errors.
4. No unstubbed external host was contacted.

Plus targeted tests for the Phase 0 performance fixes (`perf.spec.mjs`), the
dead-code removals (`deadcode.spec.mjs`), and the test hook itself
(`hook.spec.mjs`).

## Engine architecture

The engine is ES modules running on three.js r75. `Source/js/main.js` is the
entry point: every page loads the four vendor classic scripts (OrbitControls,
FontUtils, the typeface, Tween) and then `main.js` as
`<script type="module">`, which imports the engine modules — including
`Source/js/ed3dmap.js` — and publishes the compat globals (`Ed3d`,
`canonnEd3d_*`, `__ed3dTestState`, etc.) that the rest of the page relies on.

The 30 `Source/data/MapData-*.js` files are deliberately still classic
scripts: they read those engine globals off `window` rather than importing
them, so they stay untouched by this migration. Each page loads its data file
with `defer` and calls its `canonnEd3d_X.init()` from inside a
`DOMContentLoaded` listener — `<script type="module">` and `<script defer>`
both run after parsing, in document order, and `DOMContentLoaded` fires after
both, so the module always publishes its globals before the data file runs
and before init is called.

## How it works

`test/server.mjs` serves `Source/` as the web root — required, because 49 pages
reference `/js/jquery-2.1.4.min.js` with a leading slash.

`stubDataHosts()` in `test/helpers.mjs` intercepts every host in `DATA_HOSTS`
and answers with `[]`, or with a shaped empty object for the two hosts whose
loaders dereference a named property first (see `STUB_BODIES`). Asset CDNs are
deliberately not intercepted, so three.js and jQuery load normally.

**Canonn's cloud functions are billed per invocation, so the default run must
never contact them.** If you add a new data source, add its host to
`DATA_HOSTS`. The `leaked` assertion in `smoke.spec.mjs` fails the suite naming
any external host that is in neither list, so a forgotten host surfaces loudly.

Tests assert only on `window.__ed3dTestState()`, defined at the bottom of
`Source/js/ed3dmap.js`. Engine internals are due to be rewritten when three.js
is upgraded; that hook is the contract. Do not bind tests to `System`, `scene`,
or `Ed3d` directly.

`REFERENCE_PAGE` is `voyager.html`, not `index.html` — `index.html` loads
`MapData-multifaction.js`, which returns without ever calling `Ed3d.init()` when
no `?factions=` parameter is present, so no scene is created.

## Skipped pages

3 of the 36 entries in `test/pages.json` carry `"offlineSkip": true`:

- **`route_data.html`** — its loader dereferences the stubbed `[]`. Its host is
  shared by several data files with different expected shapes, so a host-level
  stub override would break the ones that currently pass.
- **`index.html`, `multifaction.html`** — both fetch a gzipped Spansh dump and
  pipe it through `DecompressionStream`. The generic stub is not valid gzip.
  Covering them needs a synthetic fixture with at least one fake faction.

The 14 pages backed by `api.canonn.tech` were deleted rather than skipped: that
API is unreachable and the pages were deliberately retired upstream, not left
broken. See git history if you need them back.

## Adding a page

Add an entry to `test/pages.json`:

    { "path": "my-page.html", "query": "?foo=bar", "offlineSkip": false }

Set `offlineSkip: true` only if the page genuinely cannot boot without live
data. A page that just needs a URL parameter should get the parameter instead.

## What this suite does not do

There is no visual regression testing. Screenshot baselines were tried and
removed: `#edmap`'s height derives from the nav height, which is not
deterministic in a headless environment, so the captured region varied between
runs in a way no pixel tolerance could absorb. If the three.js upgrade goes
ahead, visual checking is worth revisiting then — that is where silent
rendering changes actually become a risk.
