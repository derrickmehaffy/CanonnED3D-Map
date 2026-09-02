# CanonnED3D UI modernization — research notes

**Date:** 2026-09-01
**Status:** Research + design proposal. Nothing built; `Source/` untouched.
**Companion:** interactive design proposal published as an artifact (link in the commit thread)

---

## 1. What was measured

All figures taken from the running site on 2026-09-01, not estimated.

| Measure | Value | Where |
|---|---|---|
| Links in the nav | **102** | `Source/include/nav.html` |
| Distinct link labels | 81 | same |
| Levels of hover nesting | 4 | `li.has-sub` chains |
| Top-level menu groups | 9 | Guardians, Thargoids, Cartographics, Canonn Faction, Biology, Geology, Lagrange Clouds, Tools, Github |
| Rows of chrome above the map | 2 | nav row + "Suggest a Map" / Donate row |
| Fixed left sidebar | 317 px | `#hud` |
| Corners holding controls | 3 | view toggles top-right, pan/zoom bottom-right, search+filters left |

**The Biology group alone holds ~24 species links.** Reaching one means hovering a
top-level item, tracking into a submenu, and holding the pointer steady across it.
On any touch device there is no hover, so that path does not exist at all.

---

## 2. What already works — do not rebuild these

Reading the code changed the brief. Two features assumed missing are present, both
LCU No Fool Like One's work:

- **Live system search.** `#system-search-input` in `hud.class.js` debounces input and
  queries a typeahead endpoint on the Canonn cloud functions, then adds the resolved
  system to the map. It has keyboard navigation through results. It is not a gap — it is
  a feature buried under a sidebar heading with no shortcut.
- **Route / journal file upload.** `#file-upload-dialog` accepts dragged journal or route
  files and plots them. Genuinely uncommon among comparable tools, and currently hidden
  behind a folder icon next to the search heading.

Any redesign should promote both, not replace them.

---

## 3. The ecosystem gap

Canonn's own resources page (canonn.science/resources) lists **twelve** tools. The map
is two of the entries on it. The map's `Tools` menu links to **two** of the other ten.

| Tool | URL | Linked from map? |
|---|---|---|
| Signals | signals.canonn.tech | yes — buried in Tools |
| Thargoid Link Decoder | tools.canonn.tech/linkdecoder | yes — buried in Tools |
| Bioforge | bioforge.canonn.tech | no |
| Bifrost (Guardian ruins) | ruins.canonn.tech | no |
| Codex Regions | canonn-science.github.io/Codex-Regions | no |
| Undiscovered Codex | canonn-science.github.io/undiscovered-codex | no |
| Thargoid Glyph Tool | tools.canonn.tech/thargoid_glyphs | no |
| Abandoned Settlement Viewer | canonn-science.github.io/abandonned | no |
| Neutron Star Plots | canonn-science.github.io/Canonn-Plots | no |
| EDMC-Canonn plugin | github.com/canonn-science/EDMC-Canonn | no |

**The concrete cost:** a commander who selects a system on the map and wants its
biology has to read the name, switch tab, and retype it into Signals. Then again into
Bioforge. The map already holds the system name and coordinates.

This is the highest-value, lowest-risk change available — it needs no layout work.

---

## 4. Peer scan

- **Canonn Signals** — search-first: a single large search field is the hero. Confirms
  Canonn's brand colour (orange, the atom-and-flask mark) and that a search-led entry
  point is already the house pattern. The map should feel like its sibling.
- **Spansh** — solves "many tools, one nav" with six grouped dropdowns plus a global
  search, but on stock Bootstrap with no visual identity. A useful counter-example:
  grouping alone is not the answer if it costs the identity Canonn already has.
- **EDSM** — dense, data-first, conventional nav.

Nobody in this space uses a command palette. That is an opportunity, not a warning —
but see the open question about discoverability.

---

## 5. Proposed direction

**Thesis: the map is an instrument, not a website.**

Four surfaces replace the current scattered chrome:

1. **One 48px top bar** — Canonn mark, a *map switcher* (not a dead label), the search
   affordance, and a tools launcher. Replaces two rows and the hover cascade.
2. **Command palette (⌘K)** — one field over three sources: 102 maps, 12 tools, live
   system search. The signature element.
3. **Icon rail, left** — layers, camera, routes, display. Collapsed by default so the
   map keeps the width. Layer lists get their own filter above ~12 entries (the GEC has 18).
4. **Status strip, bottom** — position, distance to Sol, distance to Sagittarius A*,
   systems shown / total, current map. Mono, tabular figures, fixed baseline. Replaces
   the floating "Infos" box.

Plus the **system card**: selecting a system offers Signals / Bioforge / Bifrost / EDSM /
Inara prefilled. This is the ecosystem fix.

### Palette

Canonn's own, tightened. Amber is the orange from the atom mark and the existing map.
Ion is the map's existing `#0DFFFF` selection colour, desaturated so it stops vibrating
against the amber. Neutrals biased blue toward the void rather than pure grey.

```
--void  #05070A    --panel #0C1116    --rule #1B242E
--amber #FF9D00    --ion   #4DE3E1    --text #CAD4DC
```

### Typography — the one real risk

Proposes dropping **Orbitron** for the **IBM Plex** superfamily (Condensed for chrome
labels, Sans for prose, Mono for all numerics).

Orbitron is the recognisably *Elite* face, so this is a genuine identity risk and the
thing most worth arguing about. The case for the change: Orbitron is close to illegible
at the 11–12px this interface actually uses, and Canonn is a research group, not a ship —
Plex is the type of technical instrumentation. The amber keeps the lineage unmistakable.
Fallback position: keep Orbitron for the wordmark alone.

---

## 6. Suggested order

| | Change | Risk |
|---|---|---|
| A | Command palette *over* the existing nav | Additive, reversible, old menu keeps working |
| B | System card with ecosystem links | Touches the HUD info panel only — highest value per unit risk |
| C | Collapse two chrome rows into one | Mechanical, touches all 36 pages |
| D | Layer rail + status strip | Largest; reworks the 1,551-line `hud.class.js` |

A and B are independent of each other and of the rest.

---

## 7. Open questions for Derrick

1. **Is Orbitron negotiable?** Everything else here is reversible; this one is identity.
2. **Who else maintains this?** A palette only two people know about is worse than a menu
   everyone can see. The switcher exists partly to keep maps visibly browsable.
3. **How much traffic is second-screen / tablet?** If significant, hover-only navigation
   is already broken for those users and phase C moves up.
4. **Should the map absorb other tools, or point at them?** This proposal assumes
   point-at: deep links out, no embedding. Cheaper, and leaves each tool's author in
   control.
5. **What happens to the 14 retired maps?** Removed from the repo this session. If any
   deserve reviving against the cloud functions, the switcher is where they would reappear.

---

## 8. Sources

- Canonn resources page — https://canonn.science/resources/
- Canonn Signals — https://signals.canonn.tech/
- Spansh — https://spansh.co.uk/
- EDSM — https://www.edsm.net/
- Repo audit — `Source/include/nav.html`, `Source/js/components/hud.class.js`
