# The orrery

`js/orrery.js`, with `orrery-surface.js` and `orrery-sky.js`. One system's
bodies on their real orbits, solved from the orbital elements in Canonn's
system dump rather than animated by eye.

It runs two ways from the same file: **standalone** at `orrery.html?system=Sol`,
and **over a map**, where `console.js` injects it on demand from the system
card. `standalone` gates the differences — a Back button over a map, a "Show on
the map" link when standalone.

```js
export { Orrery, eccentricAnomaly, positionAt, buildModel, layout };
window.Orrery = Orrery;   // { open, close, isOpen, page, state, faces,
                          //   pixels, air, shade, skyAgreement }
```

The mechanics are exported next to the view on purpose: an orbit that is
*solved* is the claim this file makes, and it should be provable without a
screenshot.

## The orbital elements need no correction

Frontier's dump carries the **standard J2000 heliocentric ecliptic elements,
verbatim** — Mercury's ascending node at 48.331°, Earth's at −11.261°,
Uranus's argument of periapsis at 96.999°, all textbook. So the elements go
into the maths as they arrive.

You will be told to negate the ascending node and the argument of periapsis.
That is the right compensation for a **left-handed** renderer, and measured
against Sol it leaves every planet still running backwards: it turns the
orbit's tilt the right way up and does nothing to the direction of travel.

The one sign that matters is in `inPlaneToScene`:

```js
return out.set(X, Z, -Y);   // ecliptic (x, y, z) → scene, y up
```

Swapping two axes and negating neither is a **reflection**, not a rotation. It
was `(X, Z, Y)` for months, and every body in every system orbited its parent
the wrong way round — invisible, because a mirrored orbit traces exactly the
same ellipse. Only chirality catches it, which is what
`the planets go round the right way` measures: Sol is a ruler because every
planet in it is prograde, so `r × v` must have a positive scene-`y` for all
eight.

**Elements are read with `|| 0`.** A body that vanishes for want of one number
is worse than a body in roughly the right place, but zero is a real value, so
an unscanned orbit is drawn as confidently as a scanned one. `missingElements`
names the gaps in the facts panel. A body with no period at all stands still
out on its orbit rather than at the origin, which is its parent's exact centre.

## The clock

`simDays` is measured from **the dump's own epoch**, `parseEpoch(sys.date)`, not
from now. Mean anomaly is quoted at that epoch, so propagating from the present
would mean integrating over a millennium of orbits for nothing.
`GAME_YEAR_OFFSET = 1286` is applied for **display only** — Elite is set that
far ahead.

The speed control is one slider over `LADDER`, a signed ladder of rates running
backwards through real time to forwards. Each system has a ceiling past which
its inner bodies skip whole orbits between frames; that ceiling is the end of
the slider's track rather than a button that stops responding.

## Render on demand

The rAF loop always runs — OrbitControls needs it to damp, and starting and
stopping a loop is how you get a stutter on the first move. What stops is the
**render**:

```js
let dirty = true;
const invalidate = () => { dirty = true; };
```

Anything that could change the picture calls `invalidate()`. Paused and
untouched, it draws about ten frames a second rather than sixty, because a
star's surface goes on boiling when the orbits stop.

**If you add something animated, it must call `invalidate()` or it will not be
drawn.**

## Camera flights, and the two things that fight them

Choosing a body flies the camera over rather than putting it there.
`stepFlight` runs from `draw()` **after every body has been placed**, so it can
lerp toward where the body is *now* — aim at where a moon was and it has moved
on by the time you arrive.

Two collaborators have to stand aside:

- **Follow** pins the camera's target to the selected body every frame, and it
  runs after the flight step. Left alone it pinned the target on the flight's
  first frame and dragged the camera the whole distance with it — a snap with
  easing on the end. It is skipped while `flight` is in the air.
- **The reader.** A pointer or a wheel on the canvas cancels the flight,
  because they are steering now.

The console has the same lever for its own flight, `stopFly()`, and needs it
for a reason worth knowing: a TWEEN rewrites `camera.position` every frame, the
map stops drawing while the orrery is over it, and `TWEEN.update` stops with
it — so a flight begun on the map froze mid-air and resumed on close, undoing
the position the map had just been restored to.

## Testing it

`window.Orrery.state()` is the seam. The suite binds to it rather than to the
camera or the scene graph, so moving either does not invalidate the tests. It
reports the selected body, the camera position, whether a flight is in the air,
the orbits and where each body is, the black holes' screen geometry, the sky's
bake state, and more.

Three habits, each learned from a flaky test:

- **`settled(page)` before measuring the view.** Choosing a body flies the
  camera, so the framing distance is what it settles at, not what it reads a
  fixed moment after a click. It asks `state().flying` first, because camera
  positions alone cannot tell the stillness *before* a flight from the
  stillness *after* it.
- **Pause the clock before aiming at a body.** Anything that measures where a
  body is and then clicks it will miss under parallel load.
- **`Orrery.pixels(x, y, w, h)` renders its own target**, so it never reads a
  stale buffer — but it can read a sky nothing has baked yet, which comes back
  black and makes every band of a photometric profile zero.

## Things that are simply landmines

- **A hidden Browser pane does not throttle `requestAnimationFrame`, it stops
  it.** The clock cannot advance, so nothing animation-driven can be verified
  there. Screenshots still work, because capturing one forces a frame — which
  is exactly why this is easy to mistake for a real bug.
- **`[hidden]` loses to any rule with more classes.**
  `.orrery.has-system .orr-tb.sys{display:block}` is four classes and beat it,
  showing a link the script had switched off.
- **Rail widths are a preference, and a resize must not overwrite one.** The
  stylesheet caps them on small windows — narrower defaults below 1100px, a
  hard `22vw`/`24vw` when short and landscape — and reading the rendered width
  back recorded the cap as a choice, so one pass through a small window left
  the rails a strip on a wide monitor.
- **`Playwright.evaluate` does not honour the page's import map.** Inject a
  `<script type="module">` to test ES modules in-page.
