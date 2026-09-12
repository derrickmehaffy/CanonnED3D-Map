# How this repository is put together

Everything under `Source/` is served as-is. There is no build step, no bundler
and no `package.json` for the site — `npm` here is for the test suite only.
Edit a file, reload the page, and that is the whole loop.

That constraint shapes every decision below, so it is worth knowing that it is
a choice rather than an accident, and that it is not absolute: `three` is
resolved through an **import map** on all 37 pages, so ES modules work without
tooling. Anything that would need transpiling does not.

## The three parts

| Part | Files | What it is |
|---|---|---|
| **The engine** | `js/ed3dmap.js`, `js/components/*.js` | Draws the galaxy: a point cloud of systems, a grid, routes, a HUD. Predates everything else — classic scripts, module-scope globals referenced as bare identifiers. Written on jQuery, off it now. See [ED3D-ENGINE.md](ED3D-ENGINE.md). |
| **The console** | `js/console.js` | The chrome around the engine on every map page — rail, panels, system card, command palette, saved views. One file, generic across the 36 pages that load it. `orrery.html` is the 37th and does not. |
| **The orrery** | `js/orrery.js`, `js/orrery-surface.js`, `js/orrery-sky.js` | One system's bodies on their real orbits. An ES module, and the only part written after the rest. See [ORRERY.md](ORRERY.md). |

## What a page is made of

A map page is a thin shell. `gr-data.html` is representative:

```html
<!-- classic, so they run first and in this order -->
<script src="vendor/papaparse/papaparse.min.js"></script>
<script src="js/canonn-palette.js"></script>          <!-- category colours -->
<script src="js/canonn-api.js"></script>              <!-- one host, one place -->
<script src="js/canonn-fmt.js"></script>              <!-- esc, num -->
<script src="vendor/tween-js/Tween.js"></script>      <!-- camera flights -->
<script type="importmap"> … "three": "./vendor/three/build/three.module.js" … </script>

<!-- module and defer, so they run after every classic script above -->
<script type="module" src="js/main.js?v=7"></script>  <!-- publishes the engine -->
<script defer src="js/console.js"></script>           <!-- the chrome -->
<script defer src="data/MapData-GR.js"></script>      <!-- this map's data -->
```

`console.js` before its `MapData-*.js` is intentional and its header says so:
the console has to be listening before the data lands.

The page itself holds almost no logic. What makes one map differ from another
is its `data/MapData-*.js`, which fetches or declares systems and categories
and calls `Ed3d.init()`.

### Script order is load-bearing

Classic scripts run in document order, and **every** classic script runs before
**any** `defer` or `type="module"` script. So the four small globals must be
plain classic tags, and they must come before the things that read them.

`test/deadcode.spec.mjs` enforces this by reading the files, not by driving a
browser — because a page whose smoke test happens to be skipped will not tell
you its script tag is missing, and two of them once shipped that way.

## The five shared globals

Each is a classic script setting exactly one global. That posture is
deliberate: `console.js` and the data files are classic scripts and cannot
`import`, while `orrery.js` is a module and can read a global perfectly well.

| Global | File | Why it exists |
|---|---|---|
| `CanonnAPI` | `js/canonn-api.js` | The cloud-functions host, region and project id used to be pasted into a dozen call sites. Nothing else should ever name that host. |
| `CanonnFmt` | `js/canonn-fmt.js` | `esc` and `num`. They were duplicated, and the two copies of `esc` disagreed about `null`. |
| `CanonnPalette` | `js/canonn-palette.js` | Category colours. Hue says what kind of thing it is, shade says which type within that kind. |
| `CanonnConsole` | set by `console.js` | The small surface the orrery reads back: the star colour table, and the system dump the card already fetched. |

| `CanonnFilters` | `js/canonn-filters.js` | The Science / Class / Name dropdowns. Three loaders carried 88 byte-identical lines of this each. |
| `CanonnSpectral` | `js/canonn-spectral.js` | A star's colour from its class. This existed twice and the two copies tried different key lengths, so a T Tauri star came out two different colours depending on which surface drew it. |

`js/main.js` additionally publishes the engine's singletons onto `window` —
`Ed3d`, `System`, `Action`, `HUD`, `Route`, `Grid`, `Galaxy`, `Heatmap`,
`Loader`, `PostFX`, `routes` — because the component files reference them as
bare identifiers. This is a compatibility posture, not a design to copy.

## Where the data comes from

- **Canonn's cloud functions**, through `CanonnAPI` — system dumps, the codex,
  typeahead search, route builders. Billed per invocation, which is why the
  card fetches on a click and never on hover or on load.
- **Spansh** — the factions dump behind the landing page, and system dumps.
- **A page's own `MapData-*.js`** — some maps declare their systems outright.
- **`api.canonn.tech`** — retired, does not resolve, and **nothing calls it**.
  Two loaders still named it, both by unreachable code, and both were removed.
  If you find it again, it came back by accident.
- **EDSM** — **not fetched either.** It is unreliable, and the one question the
  map ever asked it — a name in, coordinates out — is answered by Canonn's own
  typeahead. What is left of the name is deliberate: `edsmLink()` in
  `codex-overlay.js` offers the reader an outbound link beside the Signals one,
  and `ts-msg_3305survey` reads a static local snapshot of eagle-eye
  coordinates. `nothing fetches EDSM` holds that line, and it counts code
  rather than the word, so a comment recording the refresh query is fine.

## Tests

```bash
npx playwright test --project=offline      # everything, ~8 minutes
npx playwright test --project=live         # the one spec that may hit the network
```

`test/server.mjs` serves `Source/` on :4173. The `offline` project runs
everything except `live.spec.mjs`, and `test/helpers.mjs` intercepts every data
host — Canonn's functions are billed per call, so **the default suite must
never reach them**. See [../test/README.md](../test/README.md) for what the
fixtures are and where they came from.

Two habits worth keeping:

- **Measure in frames, not milliseconds.** Anything asserting about rendering
  gets starved under four parallel browsers, and a fixed sleep then measures
  the machine rather than the code.
- **Static tests that read files** catch a whole class of thing a browser test
  cannot, because they do not depend on a page booting.
