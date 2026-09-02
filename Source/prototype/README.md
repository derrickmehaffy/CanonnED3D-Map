# Console prototype — not part of the site

A functional mockup of the proposed map UI, built 2026-09-02. **Not linked from
the nav**; nothing else in `Source/` references it, and it sits outside the
`Source/*.html` glob so the smoke suite ignores it.

Run it:

    npm run serve

then http://localhost:4173/prototype/console.html

Switch maps with `?map=gr` (Guardian Ruins), `?map=gs` (Structures), `?map=gb`
(Beacons) — or just use the map index in the header.

## It drives the real engine

This is **Ed3d**, not a second renderer. `console.html` loads the same import map
and `../js/main.js` that the 36 live pages load, and calls `Ed3d.init()` with
`withHudPanel: false` and `withOptionsPanel: false` so the chrome in `console.js`
replaces the old HUD instead of fighting it.

That means the scene, camera, orbit controls, starfield, galaxy field, grid,
picking, and the 2D/3D switch are all the real thing on three.js r185. The
prototype only supplies the interface around them:

| Chrome | Drives |
|---|---|
| Systems list | the loaded system list; clicking flies the real camera |
| 3D / 2D toggle | `Ed3d.isTopView` + `HUD.moveCamera` — the same path the real buttons use |
| Layer toggles | `Ed3d.catObjs` + `System.setColor` — the real category filter |
| Camera panel | `controls.target`, `camera.position`, `HUD.moveCamera` |
| Display panel | `Grid` visibility, `Galaxy.infosShow/Hide`, point material size |
| Routes panel | parses `FSDJump` entries in-browser, plots via `Ed3d.addBatch()` |
| Search / palette | the loaded system list |

An earlier version of this prototype hand-rolled a canvas renderer so one file
could also work inside a sandboxed artifact. That was the wrong trade: it could
not show whether the new chrome actually fits the real engine, which is the only
question worth asking.

## What is real

- **Data.** Fetches the live Canonn bucket on load — the same URLs the real
  `MapData-G*.js` files use. The header reads `live · N systems` when that
  succeeds and falls back to an embedded snapshot (taken 2026-09-02) otherwise.
- **Template maps.** The Alpha/Beta/Gamma site plans are the real images from
  `ruins.canonn.tech`, embedded as data URIs.
- **Deep links.** Signals, Bifrost, EDSM and Inara, prefilled with the system.

## The point: each map brings its own panel

Three maps are wired, chosen because their custom elements differ:

| Map | Panel | Notes |
|---|---|---|
| **Guardian Ruins** | 3 site types + a template map per type | 600 sites in 212 systems; 198 hold more than one and 166 mix types |
| **Guardian Structures** | 10 named configurations | No template maps exist, so the panel drops that section entirely |
| **Guardian Beacons** | 6 primary-star classes | No site type at all; counted in *beacons*, and each links to its Guardian Structure system |

A generic "list of coloured checkboxes" cannot express any of that. The layer
rail has to be map-aware.

## Two design decisions worth arguing about

**Two lists, two questions.** The map index answers "which map"; the systems
rail answers "what is on this one". Both are browsable rather than search-only —
the systems list filters, sorts by name or distance from Sol, shows which site
types each system holds as coloured wedges, and respects the layer toggles so it
always agrees with the status strip.

**The map index.** Search alone is not enough — you cannot search for a map you
do not know exists. The header name opens a browsable grid of all 33 maps grouped
by domain. ⌘K stays the fast path; ⌘⇧M opens the index.

**Framing on load.** The live maps inherit a fixed `cameraPos`, which on several
of them starts so far out that the systems are invisible. This frames on the
data instead: median point, sized to the nearer half of systems. Guardian Ruins
is bimodal — 55% within ~500 ly, the rest 8 kly away — so the median lands on the
bubble cluster. The ⊙ button toggles to the full extent.

## What is still mocked

- Only three maps are wired. The other 30 are listed in the index and say so.
- Switching maps reloads with `?map=` rather than swapping in place. That is
  honest — today each map really is a separate page — but note `Ed3d.rebuild()`
  cannot reload from `Ed3d.json`, only from `jsonPath`/`jsonContainer`, so an
  in-place switch would need that gap closed first.
