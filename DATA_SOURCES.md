# Where the data comes from

One row per page, generated from what each `data/MapData-*.js` actually
fetches. The previous version of this file was organised by menu heading and
had drifted badly: it documented ten pages and thirteen loaders that no longer
exist, named fourteen `api.canonn.tech` collections that appear nowhere in the
tree, and attributed the wrong source to eight pages that do exist. A table
that has to be hand-maintained per page is a table that goes stale, so this one
is deliberately flat and short.

`docs/ARCHITECTURE.md` explains how a page is put together; this is only about
where its systems come from.

---

## The hosts

| Host | What it serves |
|---|---|
| `storage.googleapis.com/canonn-downloads` | Bulk CSV and JSON dumps, pre-generated and refreshed periodically. Fifteen loaders read these, and it is the cheapest source: one request instead of thousands. |
| `us-central1-canonn-api-236217.cloudfunctions.net` | Canonn's cloud functions, reached only through `CanonnAPI` — system dumps, the codex, typeahead, route builders. **Billed per invocation**, which is why the system card fetches on a click and never on hover or on load, caches for a month, and coalesces concurrent asks for the same system. |
| `downloads.spansh.co.uk` | The factions dump behind the landing page. Fetched with a HEAD first to compare ETags, because the body is 16.6 MB. |
| `elitebgs.app` | Faction presence, for the colonisation map. |
| `dcoh.watch` | The Thargoid war feed. The war is over, so this returns little — the map is empty because the feed is, not because it broke. |
| `edastro.com` | The Galactic Exploration Catalogue. |
| `Source/data/` and `Source/data/csvCache/` | Local snapshots committed to the repo. Several maps are entirely local and reach nothing. |

Two hosts appear in the loaders and are **not** data sources. `api.canonn.tech`
is retired and does not resolve; nothing calls it, and
`nothing calls the retired Canonn API` fails the suite if it comes back.
`www.edsm.net` is linked to for the reader and read once as a static local
snapshot, never fetched live; `nothing fetches EDSM` holds that line.
`signals.canonn.tech`, `inara.cz`, `ruins.canonn.tech`, `canonn.science` and
`elitedangerous.com` appear only as outbound links in a system's info panel.

---

## Page by page

| Page | Loader | Reads |
|---|---|---|
| `aliens-combo.html` | `MapData-Aliens.js` | Canonn cloud functions, storage.googleapis.com · 1 local file |
| `bt-data.html` | `MapData-BT.js` | storage.googleapis.com |
| `canonn-challenge.html` | `MapData-Challenge.js` | 1 local file |
| `carrier_data.html` | `MapData-Carriers.js` | Canonn cloud functions |
| `cloud_data.html` | `MapData-Cloud.js` | storage.googleapis.com |
| `cmdr.html` | `MapData-Cmdr.js` | Canonn cloud functions |
| `codex.html` | `MapData-Codex.js` | Canonn cloud functions |
| `colonisation_data.html` | `MapData-Colonisation.js` | Canonn cloud functions, elitebgs.app · 2 local files |
| `dcoh.html` | `MapData-DCOH.js` | dcoh.watch |
| `dcoh_headless.html` | `MapData-DCOH.js` | dcoh.watch |
| `galnet.html` | `MapData-Galnet.js` | storage.googleapis.com |
| `gb-data.html` | `MapData-GB.js` | storage.googleapis.com |
| `gec.html` | `MapData-GEC.js` | edastro.com · 1 local file |
| `gen-data.html` | `MapData-GEN.js` | storage.googleapis.com |
| `gnosis_data.html` | `MapData-Gnosis.js` | 1 local file |
| `gr-data.html` | `MapData-GR.js` | storage.googleapis.com |
| `gs-data.html` | `MapData-GS.js` | storage.googleapis.com |
| `guardians-combo.html` | `MapData-Guardians.js` | storage.googleapis.com |
| `hyperdiction_data.html` | `MapData-Hyperdiction.js` | storage.googleapis.com |
| `ida-data.html` | `MapData-IDA.js` | downloads.spansh.co.uk, storage.googleapis.com |
| `index.html` | `MapData-multifaction.js` | downloads.spansh.co.uk |
| `landscape_signal.html` | `MapData-landscape.js` | storage.googleapis.com |
| `listening_posts.html` | `MapData-LP.js` | 1 local file |
| `megaships-data.html` | `MapData-Megaships.js` | storage.googleapis.com |
| `multifaction.html` | `MapData-multifaction.js` | downloads.spansh.co.uk |
| `nhss-data.html` | `MapData-NHSS.js` | Canonn cloud functions |
| `orrery.html` | `—` | declared in its own loader |
| `permit-data.html` | `MapData-Permit.js` | 1 local file |
| `prison_data.html` | `MapData-Prisons.js` | 1 local file |
| `route_adamastor.html` | `MapData-Adamastor.js` | 2 local files |
| `route_data.html` | `MapData-Route.js` | Canonn cloud functions |
| `route_uia.html` | `MapData-UIA.js` | 1 local file |
| `tb-data.html` | `MapData-TB.js` | storage.googleapis.com |
| `thargoids-combo.html` | `MapData-Thargoids.js` | Canonn cloud functions, storage.googleapis.com · 1 local file |
| `ts-data.html` | `MapData-TS.js` | 1 local file |
| `ts-msg_3305survey.html` | `MapData-TSmsg_3305survey.js` | 4 local files |
| `voyager.html` | `MapData-Voyager.js` | 1 local file |

---

## Pages that take query parameters

| Loader | Parameters |
|---|---|
| `MapData-multifaction.js` | `factions` — the landing page shows nothing without it |
| `MapData-Codex.js`, `MapData-NHSS.js` | `hud_category`, `sub_class`, `english_name`, `platform` — the Science / Class / Name dropdowns, built by `js/canonn-filters.js` |
| `MapData-Route.js` | `startSystem`, `endSystem`, `jumpRange` |
| `MapData-Colonisation.js` | `faction`, `homeSystem`, `showRoute`, `keepExpansion`, `Highlight` |
| `MapData-DCOH.js` | `faction` |
| `MapData-Cmdr.js` | `cmdr` |

`codex.html` is reused across many menu entries by varying its parameters
rather than by having a page each.

---

### Category Codes Used in CSV Dumps

| Category | Code(s) | Type |
|---|---|---|
| Amphora Plant | `2101400` | Biology |
| Bark Mounds | `2100101` | Biology |
| Brain Tree | `2100201`–`2100208` | Biology |
| Crystalline Shards | `2101500` | Biology |
| Fungoids (FG) | `2100401`–`2100408` | Biology |
| Tubers/Wire (TW) | `2100501`–`2100508` | Biology |
| Fumaroles | `1400102`–`1400164` | Geology |
| Gas Vents | `1400402`–`1400414` | Geology |
| Geysers | `1400208`–`1400262` | Geology |
| Lava Spouts | `1400306`–`1400307` | Geology |
| Guardian Beacons | `3200800` | Guardian |
| Guardian Structures | `3200200`–`3200600` | Guardian |
| Thargoid Barnacles | `2100101`–`2100102` | Thargoid |
| Thargoid Structures | `3101000`–`3101200` | Thargoid |

---

## Notes

- **The cloud functions are billed per invocation.** The offline test suite
  intercepts every host in `DATA_HOSTS` and must never reach them; the one
  live-search path left in the product is the orrery's typeahead, which
  debounces at 220 ms with a two-character minimum.
- The GCS dumps are a performance decision, not a fallback: a combo map showing
  thousands of sites would otherwise be thousands of requests.
- To refresh the UIA waypoint snapshots: `fetch-uia-waypoints.ps1`, which is
  named in `MapData-UIA.js` and is **not** in this repository.
