# Console prototype — not part of the site

`console.html` is a functional mockup of the proposed map UI, built 2026-09-02.
It is **not linked from the nav** and nothing else in `Source/` references it.

Run it: `npm run serve`, then http://localhost:4173/prototype/console.html

## What is real

- **Data.** Fetches the live `guardian_ruins.json` from Canonn's storage bucket on
  load — the same URL `MapData-GR.js` uses. The header shows `live · N sites` when
  that succeeds. It falls back to an embedded snapshot (600 sites, taken 2026-09-02)
  after 6s or on any error, and says `snapshot` when it does.
- **Template maps.** The Alpha/Beta/Gamma site plans are the real images from
  `ruins.canonn.tech/images/maps/`, embedded as data URIs so the page works offline
  and inside a sandboxed artifact.
- **Deep links.** Signals, Bifrost, EDSM and Inara links are real and prefilled with
  the selected system.
- **Search.** Filters the live site list by name.

## What is a mockup

- The plot is a hand-rolled perspective renderer on a 2D canvas, not the three.js
  scene. It opens in **3D** with a 3D/2D toggle, matching the real map; "2D" pins the
  camera overhead, which is what `isTopView` does today. Droplines to the galactic
  plane are what make height legible without a real depth buffer. The point is the
  interface around the map, not a second renderer.
- Only Guardian Ruins is wired up. Other maps in the switcher say so when picked.
- Camera / routes / display rail buttons are placeholders.

## One dot is one system, not one site

600 ruin sites sit in only **212 systems**: 198 systems hold more than one site and
166 of those mix types. So the unit plotted is the system, and a dot is drawn as
wedges of the types it contains. Selecting one lists every site in it with its body,
and clicking a site swaps the template map.

Treating each record as its own point — which the first cut did — draws 600 dots
where there are 212 places, stacks them exactly on top of each other, and can only
ever show one type per system.

## Why Guardian Ruins

It was the map named as having per-map custom elements: site types (Alpha, Beta,
Gamma) with a template map per type. That is the case the design has to handle —
a layer panel that is map-aware rather than a generic list of coloured checkboxes.

Note the current `MapData-GR.js` assigns site-type colours with `randomColor()`, so
Alpha is a different colour on every page load. The prototype fixes them.
