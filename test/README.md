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
`Source/js/ed3dmap.js` — and republishes the engine singletons on `window`
(`Ed3d`, `Grid`, `Ico`, `HUD`, `Action`, `Route`, `System`, `Galaxy`,
`Heatmap`, `Loader`, `routes`, `isFarView`, plus `scene`/`camera`/`controls`/
`renderer`/`container` once `initScene()` has created them).

Engine files call each other by bare name, and so do the data files. Rather
than converting those into imports — which would create real cycles, since
`Ed3d`, `HUD` and `Action` all reference each other — everything is
republished on `window` and bare references resolve against the global object
at call time. This is deliberate, not an oversight.

(`canonnEd3d_*` and `window.__ed3dTestState` are *not* published by `main.js`:
the former are plain globals declared in each classic data file, the latter is
assigned directly inside `ed3dmap.js`.)

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

## Journal fixtures

`test/fixtures/*.log` are real Elite Dangerous journals from a real commander's
machine, reduced to what the parser under test actually reads.

They were produced by a **whitelist**, never a blocklist: only named events
survive, and only named keys on those events. A blocklist is one new Frontier
field away from putting a commander's name, FID, ship or balance into a public
repository, and `handleFiles` reads three keys — `event`, `StarSystem`,
`StarPos` — so nothing else has to be real. System names and coordinates are
public game data. After generating, the output was checked for `FID`,
`Commander`, `ShipName`, `ShipIdent`, `Credits`, `Name_Localised`, `Message`,
`Factions` and `SystemFaction`, all zero. **Regenerate the same way, and check
again**, rather than hand-editing a journal and hoping.

The three cover what real journals actually look like:

| Fixture | What it is |
|---|---|
| `journal-with-route.log` | 10 jumps across 9 systems — one is passed through twice, because the map plots systems and dedupes by name |
| `journal-no-jumps.log` | A real evening that never left the system. Three of five real journals look like this; it is not a broken file |
| `journal-near-empty.log` | A session that opened and closed — one header line |

## The landing page

`index.html` is the map with four thousand systems, the one whose bloom glare
got reported, and the only page that swaps a cached snapshot for a live dump
seconds in. It was also the only page in the project with no offline coverage
at all, because it cannot boot without its data: no `?factions=` parameter and
it returns before `Ed3d.init()`, and the dump itself is a gzipped JSON array
from `downloads.spansh.co.uk`.

`multifaction.spec.mjs` covers it, against
`fixtures/spansh-factions.json.gz` — three factions over six real systems with
their real coordinates, **gzipped exactly as Spansh serves it**, so the page's
`DecompressionStream` path is under test rather than stubbed around.

It stays `offlineSkip: true` in `pages.json`, and that is not the gap
reopening. The smoke suite answers every data host with a bare `[]`, which
cannot be a gzip stream; serving one needs the per-test route that
`multifaction.spec.mjs` installs. The generic smoke test and the dedicated
spec are covering different things, and only the second can cover this page.

## Spansh fixtures

Spansh exports are a different shape from a journal — one JSON document rather
than a line per event — and three of those shapes turn up. Two of these
fixtures are **real replies from the Spansh API**; one is constructed, and it
matters which:

| Fixture | Provenance |
|---|---|
| `spansh-system.json` | Real: `api/dump/10477373803` (Sol), trimmed to the system block and two bodies. The parser reads a name and coordinates; 1.9 MB of bodies proves nothing extra |
| `spansh-search.json` | Real, verbatim: `api/systems/field_values/system_names?q=Synuefe WH-F`, 20 systems with coordinates flat on the row rather than under `coords` |
| `spansh-route.json` | **Constructed** — a bare ordered array, the plotter's shape. The wrapper is mine; the coordinates are lifted out of the search reply above, so the numbers are Frontier's |

One thing worth knowing before adding to these. `System.create` negates z on
the way in — `var z = -parseFloat(val.coords.z); //-- Revert Z coord` — so a
caller hands over **game** coordinates and lets it do that once. Negating
first lands the system mirrored through the galactic plane from everything
native to the map, which is what the journal drop did from the day it was
written. `a dropped system lands where the map already puts systems` pins the
convention with real coordinates, checked against Spansh in both directions.

## What this suite does not do

There is no visual regression testing. Screenshot baselines were tried and
removed: `#edmap`'s height derives from the nav height, which is not
deterministic in a headless environment, so the captured region varied between
runs in a way no pixel tolerance could absorb. If the three.js upgrade goes
ahead, visual checking is worth revisiting then — that is where silent
rendering changes actually become a risk.
