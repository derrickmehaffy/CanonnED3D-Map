# The Ed3d engine

`js/ed3dmap.js` plus `js/components/*.js`. It draws the galaxy map: a point
cloud of systems, a grid, route lines, and a HUD of category filters. It
predates the rest of the project and reads like it — classic scripts,
module-scope globals referenced as bare identifiers, `var` everywhere.

It was written on jQuery and is off it now, so no page loads the library.
`no page loads jQuery, and nothing reaches for the global` keeps it that way,
and checks the global as well as the tag: a `$(...)` added to a file that no
longer loads jQuery is a ReferenceError where it runs, which on a data loader
is a blank map. Two local `$` helpers are not jQuery and the check knows it —
`console.js` defines one as `getElementById`, `orrery.js` one as a
panel-scoped `querySelector`.

It works. The patterns below are the ones that will bite you if you do not know
them, in the order they usually do.

## Coordinates: z is negated on the way in

```js
// components/system.class.js
var z = -parseFloat(val.coords.z);   //-- Revert Z coord
```

**A caller hands over game coordinates and lets `System.create` do that once.**
Negating first lands the system mirrored through the galactic plane from
everything else on the map.

That is not hypothetical: the journal drop did exactly that from the day it was
written, so every route it plotted was on the wrong side of the galaxy and the
system card handed out a sign-flipped z. It is pinned now by
`a dropped system lands where the map already puts systems`, which checks a
real system's coordinates against Spansh in both directions.

So, for anything you add:

| You have | You pass | `System.points[i].z` ends up |
|---|---|---|
| Game/Spansh/journal `z` | `coords.z` unchanged | `-z` |

And to hand coordinates back to a person — the card's **Copy x, y, z** — negate
again. `SYSLIST()` in `console.js` does this: `z: -p.z`.

## `System.points` is the metadata; the geometry is separate

Every system is one vertex in a single `BufferGeometry`. `System.points` is an
**index-aligned** array of plain objects holding everything the GPU does not
need:

```js
{ x, y, z, name, infos, url, cat, entries, visible, clickable, color }
```

Two consequences that catch people:

- **A point is not an `Object3D`.** It has no `.material`, no `.position`.
  There used to be an `obj.material = Ed3d.material.selected` in
  `Action.moveToObj`; it assigned a property nobody read, and the colour
  attribute was measurably identical either side of a selection.
  `System.create`'s `withSolid` argument would build a real sphere and is
  never passed by anything.
- **Colour goes through `System.setColor(i, color)`**, which updates the
  accumulator and the live attribute. `points[i].color` is the system's **base**
  colour and is deliberately left alone, because the category filter dims with
  `setColor(i, #111111)` and restores by reading the base back.

`System.nameIndex[name]` gives you the index for a name.

## Data arrives in batches, and late

| Call | Use |
|---|---|
| `Ed3d.init({ json, … })` | First load. |
| `Ed3d.addBatch(data, done)` | Append more systems to a live map. |
| `Ed3d.updateSystems(data, done)` | Replace the dataset outright. |

`addBatch` works through its systems **in chunks on a timer**, so nothing has
been created when the call returns. Capturing `System.nameIndex[name]`
immediately gives you `undefined` — which is how the journal layer toggle came
to switch nothing off on its first attempt. Look indices up when you need them.

The bus tells you when to look:

```js
Ed3d.on('systemsChanged', fn);   // emitted whenever the set of systems changes
Ed3d.on('dataSnapshot', fn);     // the landing page showing a cached snapshot
                                 // before the real dump lands
```

**Anything that asks a question about the data on a startup timer will get the
wrong answer.** On the big maps the systems arrive seconds after the page does
— codex is readable at 500 and still appending at 3,422. Bloom defaults and
`?system=` deep links both silently did nothing for exactly this reason; both
now run from the `systemsChanged` handler and re-try per batch until answered.

## Selection, and the labels that ride with the cursor

`Action.moveToObj(index, point)` is what clicking a star runs. It sets
`oldSel`/`selectedPoint`, moves the 3D cursor, moves the grid, tweens the
camera — and writes the cursor's name and coordinate labels:

```js
HUD.addText('system', obj.name,  8, 20, 0, 6, this.cursor.selection);
HUD.addText('coords', textAddC,  8, 15, 0, 3, this.cursor.selection);
```

Those two meshes are **children of the cursor object**, so they travel with it.
Anything that moves the cursor without rewriting them leaves the previous
star's name hanging over the new one — the card says one system and the map
says another, which reads as the map not having updated at all. If you write a
new way to select a system, mirror `moveToObj`; `selectInMap` in `console.js`
is the worked example.

## Routes

Ed3d's data format has a native `routes` array, and `components/route.class.js`
draws each one as a `Line2` through an ordered `points` list. Use it rather
than inventing a second way to join two systems.

```js
Route.initRoute(id, route);   // register waypoints; creates systems if the
                              // points carry coords
Route.createRoute(id, route); // draw the line
```

A route may name its `color` outright, or take one from a map category. Set
`circle: false` unless you want a torus at each end — the default marks them,
and a torus is also what the selection cursor is, so they arrive looking like
selections nobody made.

## Things that are simply landmines

- **`THREE.ColorManagement.enabled = false` lives at `ed3dmap.js:102`**, not in
  `main.js`. It must be set before any `THREE.Color` is constructed, and this
  file builds materials at module-evaluation time. `main.js` carries a note
  saying why it is not there.
- **Import-map addresses must be absolute or start with `./`, `../`, `/`.**
  `"vendor/three/…"` is silently nulled and every module on the page fails.
- **`three.module.js` imports `./three.core.js`** — copy both when vendoring.
- **Category filters are `#filters .map_filter` elements in Ed3d's own HUD**,
  hidden by `console.css`. The console reads them rather than being told about
  them, which is what keeps `console.js` map-agnostic. Toggling a category
  means clicking Ed3d's element; a layer with no such element (a dropped
  journal) has to drive visibility itself.
- **`p.filtered === false` plus `System.applyVisibility(true)`** is how a point
  is actually removed from the draw, as opposed to dimmed.
