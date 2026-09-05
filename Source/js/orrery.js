/**
 * Canonn Orrery — a working model of one system.
 *
 * The galaxy map has always been able to put a dot where a system is. This
 * puts you inside it: the real bodies, on their real orbits, moving at
 * whatever rate you ask for.
 *
 * Nothing here is invented. Canonn's system dump — the one signals.canonn.tech
 * reads — carries a complete Keplerian element set per body: semi-major axis,
 * eccentricity, inclination, argument of periapsis, ascending node, mean
 * anomaly at the dump's own epoch, and period. Sol comes back with Earth at
 * 1.0000007 AU, e = 0.0167, 365.256 days. So the positions below are solved,
 * not animated by eye.
 *
 * Two honest lies, both of which every orrery since 1704 has told:
 *
 *   Distance. Sol runs from Mercury at 0.39 AU to Persephone at 700 AU. Drawn
 *   true, the inner system is one pixel. "Spread" compresses the radii so the
 *   whole system is legible at once; "True distance" gives them back and lets
 *   you see how much of a system is nothing.
 *
 *   Size. Earth's radius is 0.0000426 AU. Bodies are drawn far larger than
 *   they are, on a compressed curve so Jupiter still reads as bigger than
 *   Mercury without being 28 times the width.
 *
 * Loaded on demand: most sessions never open this, and it is a second WebGL
 * context. While it is up the galaxy map's scene is switched off — its own
 * animate() already checks scene.visible — so the camera you left is exactly
 * the camera you come back to.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ── constants ──────────────────────────────────────────────────────────── */

const DEG = Math.PI / 180;
/* Kilometres per astronomical unit — what turns a body's real radius into the
   same units its orbit is drawn in. */
const AU_KM = 149597870.7;

/* Elite is set 1286 years ahead of us, so the dump's real-world timestamp is
   also a date a commander would recognise. */
const GAME_YEAR_OFFSET = 1286;

/* The scene is built in arbitrary units: the outermost orbit lands near 100,
   and the innermost clears the star's glow. */
const ORBIT_OUT = 100;
const ORBIT_IN = 16;

/* Signed, so one pair of buttons runs the whole range including backwards.
   Below "real time" it crosses zero and climbs again the other way. */
const RATES = [
  { label: 'real time', days: 1 / 86400 },
  { label: '1 min/s',   days: 1 / 1440 },
  { label: '1 hour/s',  days: 1 / 24 },
  { label: '6 hours/s', days: 0.25 },
  { label: '1 day/s',   days: 1 },
  { label: '1 week/s',  days: 7 },
  { label: '1 month/s', days: 30.44 },
  { label: '1 year/s',  days: 365.25 },
  { label: '10 yrs/s',  days: 3652.5 },
  { label: '100 yrs/s', days: 36525 }
];
const LADDER = RATES.map((r) => ({ ...r, dir: -1 })).reverse().concat(RATES.map((r) => ({ ...r, dir: 1 })));
/* A week a second is too quick to read on opening — the inner planets blur
   and the moons are a smear. A day a second still moves: Io comes round in
   under two seconds, the Moon in twenty-seven. */
const START_RATE = LADDER.findIndex((r) => r.dir === 1 && r.label === '1 day/s');

/* Elite's own body classes, given the colours the game gives them. Keys are
   the dump's subType strings verbatim; anything unlisted falls through the
   keyword pass below, so a class added to the game later still gets sorted
   into roughly the right family instead of turning grey. */
const TINT = {
  'Earth-like world': 0x62A66F,
  'Water world': 0x2E6FA8,
  'Water giant': 0x4C8FB5,
  'Ammonia world': 0xB08A46,
  'High metal content world': 0x8C6F57,
  'Metal-rich body': 0xB18A63,
  'Rocky body': 0x8B8579,
  'Rocky Ice world': 0x8FA2AE,
  'Icy body': 0xC2D6E2,
  'Class I gas giant': 0xC9A87C,
  'Class II gas giant': 0xE2DED2,
  'Class III gas giant': 0x7FA6C9,
  'Class IV gas giant': 0xC97A55,
  'Class V gas giant': 0xD8552F,
  'Helium-rich gas giant': 0xBFAE9B,
  'Helium gas giant': 0xC7BAA6,
  'Gas giant with water-based life': 0x86B58C,
  'Gas giant with ammonia-based life': 0xA9B57C
};

/* A soft radial falloff for the star's glow. A SpriteMaterial with no map is
   an opaque square, which is exactly what it looked like. Drawn once and
   shared by every star in the scene. */
let GLOW = null;
function glowTexture() {
  if (GLOW) return GLOW;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d').createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0.00, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.14)');
  g.addColorStop(1.00, 'rgba(255,255,255,0)');
  const ctx = c.getContext('2d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  GLOW = new THREE.CanvasTexture(c);
  GLOW.colorSpace = THREE.SRGBColorSpace;
  return GLOW;
}

/* Ring systems come typed in the dump — Icy, Rocky, Metallic, Metal Rich —
   and that is all that decides how they are drawn, because it is all the data
   says. */
/* Rings are not flat plates, and drawing them as one is what makes a wide
   band look solid. Real ones are banded, with gaps: a strip of varying
   density across the radius, seeded per ring so a given ring always looks
   like itself. Radial only — the geometry's UVs are rewritten so u runs from
   the inner edge to the outer, which is the axis the structure lives on. */
function ringTexture(ring, tint) {
  const rnd = seeded('ring|' + (ring.name || '') + '|' + ring.innerRadius);
  const w = 512;
  const c = document.createElement('canvas');
  c.width = w; c.height = 1;
  const ctx = c.getContext('2d');
  const b = baseHsl(tint);

  ctx.clearRect(0, 0, w, 1);
  // A handful of broad bands, then finer structure inside them.
  for (let i = 0; i < 26 + Math.floor(rnd() * 22); i++) {
    const x = rnd() * w;
    const width = w * (0.006 + rnd() * 0.075);
    ctx.fillStyle = hsl(b.h + (rnd() - 0.5) * 10, b.s * (0.6 + rnd() * 0.6),
                        Math.max(10, Math.min(94, b.l + (rnd() - 0.4) * 34)),
                        0.35 + rnd() * 0.65);
    ctx.fillRect(x, 0, width, 1);
  }
  // Gaps: rings are mostly the spaces between them at a distance.
  for (let i = 0; i < 4 + Math.floor(rnd() * 6); i++) {
    ctx.clearRect(rnd() * w, 0, w * (0.004 + rnd() * 0.03), 1);
  }
  // Both edges fade rather than ending on a hard line.
  ['left', 'right'].forEach((side) => {
    const g = ctx.createLinearGradient(side === 'left' ? 0 : w, 0,
                                       side === 'left' ? w * 0.07 : w * 0.93, 0);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = g;
    ctx.fillRect(side === 'left' ? 0 : w * 0.93, 0, w * 0.07, 1);
    ctx.globalCompositeOperation = 'source-over';
  });

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

const RING_TINT = {
  'Icy': 0xC6D8E4,
  'Rocky': 0x9A8F7E,
  'Metallic': 0xB59A6E,
  'Metal Rich': 0xC2A16A
};

/* ── the sky ────────────────────────────────────────────────────────────────
   Not a photograph pasted behind the scene, and no longer a scatter of dots
   either: clouds and dust rendered into one equirectangular image, with a
   star field of its own on top.

   The image is the sky. It is what the scene is drawn against, and it is what
   a black hole bends — the same pixels, so the lens can never show a sky the
   reader is not looking at. It is made on the GPU because it has to be: four
   octaves of noise over two million pixels is a third of a second of
   JavaScript and a couple of milliseconds of shader.

   Two skies come out of the same shader.

   GALACTIC is the modelled one. Stars are drawn from a disc around
   Sagittarius A* — whose position is already in this repo, in
   data/milkyway-ed.json, alongside every region name the galaxy map labels —
   with an exponential falloff outward and a thin vertical spread, then
   projected onto the sky from the system's own coordinates. The dust follows
   that same plane and the core glows where the core actually is, so the sky
   genuinely differs between systems: Sol sits 25,900 light years out and sees
   the galaxy edge-on and distant, Colonia is 22,000 ly nearer and does not.
   It is a model of a galaxy rather than a catalogue of its stars, and the
   readout on the control says so.

   DEEP SPACE is the generic one, and the default. No band, no core: an even
   sky with clouds wherever the noise puts them. Still seeded from the
   system's position, so it is stable for a given system and different between
   them, but it claims nothing about where the system is. */

const CORE = { x: 25, y: 0, z: 25900 };        // Sagittarius A*, from the map's own data

/* Real star colours, warm to cold, and how often each turns up in a sky.

   Weighted by what is *visible*, not by what exists: M dwarfs are three
   quarters of the galaxy's stars and almost none of its naked-eye ones, so a
   sky weighted by population comes out uniformly red and wrong. */
const STAR_HUES = [
  [0.659, 0.753, 1.000, 0.07],   // B — blue-white
  [0.847, 0.886, 1.000, 0.17],   // A — white
  [0.973, 0.969, 1.000, 0.20],   // F
  [1.000, 0.957, 0.918, 0.21],   // G — the Sun
  [1.000, 0.867, 0.706, 0.24],   // K — orange
  [1.000, 0.741, 0.435, 0.11]    // M — red
];

/**
 * Where the stars are, how bright, and what colour.
 *
 * One generator for both skies: only the direction changes. Magnitudes run on
 * a steep curve so that most stars are faint and a handful are not, which is
 * what a real sky looks like and what a field of identical dots does not.
 */
function starField(coords, mode, count) {
  const rnd = seeded(mode + '|' + coords.x + '|' + coords.y + '|' + coords.z);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const mag = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    let near = 1;
    /* The galactic sky is the disc, plus what is standing in front of it.

       The disc model alone leaves a system looking away from the band under
       an almost empty sky, which is not what anyone has ever seen: the stars
       you can pick out in any direction are the near ones, a few hundred
       parsecs at most, and they are scattered evenly because at that range
       the galaxy has no shape yet. So two fifths of this sky is local and the
       rest is the band behind it. */
    if (mode === 'galaxy' && i >= count * 0.4) {
      // A point in the disc: exponential in radius, near-gaussian in thickness.
      const r = -Math.log(1 - rnd() * 0.985) * 8200;
      const th = rnd() * Math.PI * 2;
      const gx = CORE.x + Math.cos(th) * r;
      const gz = CORE.z + Math.sin(th) * r;
      const gy = CORE.y + (rnd() + rnd() + rnd() - 1.5) * 520;

      // Where that lands on this system's sky. Scene z runs opposite the
      // galaxy's, the same way it does everywhere else in this codebase.
      const dx = gx - coords.x, dy = gy - coords.y, dz = -(gz - coords.z);
      const d = Math.hypot(dx, dy, dz) || 1;
      pos[i * 3] = dx / d; pos[i * 3 + 1] = dy / d; pos[i * 3 + 2] = dz / d;
      // Nearer material reads brighter, which is what makes the core end of
      // the band glow instead of the whole ring looking uniform.
      near = Math.min(1, 4200 / d);
    } else {
      // Evenly over the sphere; acos-free form, so the poles do not bunch.
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, sr = Math.sqrt(1 - u * u);
      pos[i * 3] = sr * Math.cos(th);
      pos[i * 3 + 1] = u;
      pos[i * 3 + 2] = sr * Math.sin(th);
    }

    /* Steep, and deliberately steeper than it first was: most of the sky
       should be faint and a couple of dozen stars should carry it. At 2.7 a
       third of the sky came out bright and the backdrop started competing
       with the orbits drawn over it.

       Steeper again now the sky holds twice as many stars. Twice the stars at
       the old curve is twice the light, and a backdrop that bright stops
       being a backdrop; pushing the faint end down means the extra stars
       arrive as the pinpricks between the bright ones, which is what having
       more of them is for. */
    const m = Math.pow(rnd(), 3.8) * (0.35 + near * 0.65);
    mag[i] = 1.0 + m * 2.6;

    let pick = rnd(), k = 0;
    while (k < STAR_HUES.length - 1 && pick > STAR_HUES[k][3]) { pick -= STAR_HUES[k][3]; k++; }
    const lum = 0.08 + m * 0.92;
    col[i * 3] = STAR_HUES[k][0] * lum;
    col[i * 3 + 1] = STAR_HUES[k][1] * lum;
    col[i * 3 + 2] = STAR_HUES[k][2] * lum;
  }
  return { pos, col, mag };
}

/** Where the galaxy's heart is from here — the fact the sky control states. */
function coreBearing(coords) {
  const dx = CORE.x - coords.x, dy = CORE.y - coords.y, dz = CORE.z - coords.z;
  return {
    ly: Math.round(Math.hypot(dx, dy, dz)),
    // How far off the galactic plane the system sits, looking inward.
    tilt: Math.atan2(-dy, Math.hypot(dx, dz)) * 180 / Math.PI
  };
}

/* Clouds and dust, over the whole sphere at once.

   The noise is evaluated on the direction itself rather than on the image's
   own coordinates, which is what keeps it seamless: longitude wraps and the
   poles converge, and a pattern computed in three dimensions does not care.

   Two cloud families, cold and warm, because one hue over a whole sky reads
   as a filter rather than as a place. They are the page's own two colours —
   the ion blue of the interface and the amber of its stars — kept dark
   enough that this stays a background to read a data panel against. */
const NEBULA_VERT = [
  'varying vec2 vUv;',
  'void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }'
].join('\n');

const NEBULA_FRAG = [
  'uniform vec3 uSeed;',
  'uniform vec3 uCore;',        // direction of the galactic core, scene space
  'uniform float uBand;',       // 0 free-form, 1 pinned to the galactic plane
  'uniform float uGlow;',       // how bright the core sits, 0 when there is no core
  'varying vec2 vUv;',

  'float hash(vec3 p) {',
  '  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);',
  '}',
  'float vnoise(vec3 p) {',
  '  vec3 i = floor(p), f = fract(p);',
  '  f = f * f * (3.0 - 2.0 * f);',
  '  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),',
  '                 mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),',
  '             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),',
  '                 mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);',
  '}',
  'float fbm(vec3 p) {',
  '  float v = 0.0, a = 0.5;',
  '  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p *= 2.07; a *= 0.5; }',
  '  return v;',
  '}',

  'void main() {',
  /* The image's own axes back to a direction, in exactly the convention
     three's equirectangular background reads it in — u around from +X
     through +Z, v from the south pole up. Anything that samples this image
     later, the black hole lens included, has to use the same two lines. */
  '  float lat = (vUv.y - 0.5) * 3.1415927;',
  '  float lon = (vUv.x - 0.5) * 6.2831853;',
  '  vec3 dir = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));',

  '  vec3 p = dir * 2.3 + uSeed;',
  '  float cold = fbm(p);',
  '  float warm = fbm(p * 1.7 + vec3(31.4, 7.2, 19.8));',
  '  float fine = fbm(p * 4.3 - vec3(5.1, 2.7, 8.3));',
  '  float dust = fbm(p * 6.7 + vec3(17.0, 41.0, 3.0));',

  /* Pinned to the plane, or not. The galactic sky puts its material where the
     disc is; the generic one lets the noise decide, which is the whole
     difference between the two. */
  '  float band = mix(1.0, exp(-dir.y * dir.y * 14.0), uBand);',

  /* High thresholds and a power on top, because the point is a sky with
     some nebulosity in it rather than a sky made of nebula. Below about a
     quarter coverage it reads as a place; above that it reads as a filter
     laid over the page. */
  '  float c = pow(smoothstep(0.53, 0.84, cold) * band, 1.5);',
  '  float wv = pow(smoothstep(0.60, 0.88, warm) * band, 1.7);',

  /* Folded noise, which is what turns a cloud into a nebula. Plain fBm makes
     soft blobs because its extremes are rare and its middle is everywhere;
     folding it about its midpoint turns every crossing of that midpoint into
     a bright edge, and a field of those reads as filaments. */
  '  float ridge = 1.0 - abs(fine * 2.0 - 1.0);',
  '  float wisp = 0.22 + pow(ridge, 2.6) * 2.1;',

  /* Everything here is linear light and the render target encodes it, so
     these numbers are far smaller than the ones they come out as. This is a
     backdrop for reading a data panel against: the brightest cloud core lands
     around a quarter of white, and most of the sky is nearly black. */
  '  vec3 col = vec3(0.0012, 0.0016, 0.0030);',          // deep space is not black
  '  col += vec3(0.006, 0.013, 0.030) * c * wisp;',
  '  col += vec3(0.020, 0.008, 0.004) * wv * wisp;',

  /* The bulge, where the bulge actually is — and kept tight. Great
     Annihilator sits three thousand light years off the core, so a broad
     falloff there covers most of the sky and turns the whole view brown.

     Broken up by the same noise the clouds are made of, and added before the
     dust rather than after it. A smooth gradient laid over the top is a
     brown filter over the page; the same light with star clouds in it and
     the dust lanes cut through it is the band everyone has looked up at. */
  '  float toCore = max(dot(dir, uCore), 0.0);',
  '  float clumps = 0.45 + 0.9 * fbm(dir * 5.2 - uSeed);',
  '  col += vec3(0.030, 0.022, 0.013) * uGlow * pow(toCore, 9.0) * clumps;',
  '  col += vec3(0.005, 0.0038, 0.0026) * uGlow * pow(toCore, 5.0) * band * clumps;',

  // Dust in front of all of it, not mixed into any of it.
  '  col *= mix(1.0, 0.25, smoothstep(0.48, 0.84, dust) * band);',

  '  gl_FragColor = vec4(col, 1.0);',
  '}'
].join('\n');

/* The same stars, drawn twice.

   On screen they are points at a constant pixel size, which is what keeps a
   star a star at every zoom. Into the image they are drawn again, flattened
   to longitude and latitude — because the lens has to have stars to bend, and
   because a bright star seen through the backdrop as well as as a point picks
   up the soft halo a bright star has. */
const STARS_SCREEN_VERT = [
  'attribute float mag;',
  'attribute vec3 tint;',
  /* gl_PointSize is framebuffer pixels and the renderer draws at up to twice
     the device's CSS scale, so a star sized in bare pixels came out half as
     wide on every retina screen as it does here. */
  'uniform float uPx;',
  'varying vec3 vTint;',
  '#include <common>',
  '#include <logdepthbuf_pars_vertex>',
  'void main() {',
  '  vTint = tint;',
  '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
  '  gl_Position = projectionMatrix * mv;',
  '  gl_PointSize = mag * uPx;',
  '  #include <logdepthbuf_vertex>',
  '}'
].join('\n');

const STARS_BAKE_VERT = [
  'attribute float mag;',
  'attribute vec3 tint;',
  'uniform float uScale;',
  'varying vec3 vTint;',
  /* This pass has no depth buffer and no perspective, so it has no use for
     logarithmic depth — but the renderer defines USE_LOGDEPTHBUF for every
     material once it is switched on, and the fragment shader these two share
     declares the varyings that go with it. A vertex shader that does not
     declare them fails to link. */
  '#include <common>',
  '#include <logdepthbuf_pars_vertex>',
  'void main() {',
  '  vTint = tint;',
  '  vec3 d = normalize(position);',
  '  float u = atan(d.z, d.x) / 6.2831853 + 0.5;',
  '  float v = asin(clamp(d.y, -1.0, 1.0)) / 3.1415927 + 0.5;',
  '  gl_Position = vec4(u * 2.0 - 1.0, v * 2.0 - 1.0, 0.0, 1.0);',
  '  gl_PointSize = mag * uScale;',
  '  #include <logdepthbuf_vertex>',
  '}'
].join('\n');

/* A round star rather than the square gl_PointSize actually hands you, with
   the falloff a point spread function has: a small hard core and a wide faint
   skirt, which is what makes a bright star look bright rather than large. */
const STARS_FRAG = [
  'varying vec3 vTint;',
  '#include <common>',
  '#include <logdepthbuf_pars_fragment>',
  'void main() {',
  '  float d = length(gl_PointCoord - 0.5) * 2.0;',
  '  if (d > 1.0) discard;',
  '  float a = pow(1.0 - d, 2.2);',
  '  gl_FragColor = vec4(vTint * a, 1.0);',
  '  #include <logdepthbuf_fragment>',
  '}'
].join('\n');

/* ── black holes ────────────────────────────────────────────────────────────
   The one body in a system that is not a thing to draw but an absence to draw
   around, so it is the only one here rendered from what is behind it.

   Its size is data, not judgement. Elite's dump gives a black hole a
   solarRadius and that radius is the event horizon: Great Annihilator A is
   198.1 solar masses and 0.000840 R☉, which is 585 km — the Schwarzschild
   radius of 198.1 suns to within a tenth of a percent. Frontier compute it.
   (Sagittarius A* is the exception: 516,608 suns should give a 1.5 million km
   horizon and the dump says 10.8 million. Their galactic centre is drawn
   larger than the physics, and we draw what the dump says, there as here.)

   What you see is not the horizon but the shadow, which is larger. Light
   passing closer than the critical impact parameter b = 3√3/2 · rs cannot
   climb back out, so the black disc is 2.598 horizon radii across and the
   sky just outside it is wrapped around the hole into a ring. Both are in the
   shader below; neither is decoration.

   The lens bends the sky and only the sky. Bending the rest of the system
   would mean rendering the scene to a texture first, which is a cost this
   page does not otherwise pay — and with the sky switched off there is
   nothing behind the hole to bend, so it is simply black, which is what you
   would see. */

const SHADOW = 3 * Math.sqrt(3) / 2;      // 2.598 — shadow radius ÷ horizon radius

/* Star colours, read from the same 293 bytes the system card reads.

   console.js has this lookup too and cannot lend it: that is a classic script
   and this is a module, and orrery.html does not load the console at all.
   Which is exactly why this is here — going through window.CanonnConsole
   meant that on the standalone page nothing found the table and every star in
   every system fell back to the same amber, black holes included. */
let SPECTRAL = null, spectralAsked = null;
function spectralTable() {
  if (!spectralAsked) {
    spectralAsked = fetch('data/spectral-colors.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { SPECTRAL = j || {}; })
      // A missing table leaves every disc unlit, which is honest: it means
      // unclassified, not "no star". It is not worth failing the page over.
      .catch(() => { SPECTRAL = {}; });
  }
  return spectralAsked;
}

/** '#rrggbb' for a spectral class, or '' when the table cannot place it. */
function classColour(cls) {
  if (!SPECTRAL || !cls) return '';
  const c = String(cls).toUpperCase();
  /* Longest key first. "K3" is K and "DA" is D, but "TTS6" is a T Tauri
     star and emphatically not a T-class brown dwarf — matching it on its
     first letter painted every young star in Great Annihilator the deep
     magenta of a body four thousand degrees colder. */
  const key = SPECTRAL[c] ? c
            : SPECTRAL[c.slice(0, 3)] ? c.slice(0, 3)
            : SPECTRAL[c.slice(0, 2)] ? c.slice(0, 2)
            : SPECTRAL[c.charAt(0)] ? c.charAt(0) : '';
  // Wolf-Rayet carries two colours; the first is the one to draw.
  return key ? '#' + String(SPECTRAL[key]).split(',')[0].replace(/^#/, '') : '';
}

/** Elite spells these "Black Hole" and "Supermassive Black Hole". */
function isHole(sub) { return /black hole/i.test(sub || ''); }

/* A quad that always faces the camera, centred on the hole. The offset is
   added in world space from the camera's own right and up, so the lens is a
   disc from wherever you fly, and vWorld reaches the fragment shader without
   needing a matrix inverse GLSL1 does not have. */
const HOLE_VERT = [
  'uniform vec3 uCenter;',
  'uniform vec3 uRight;',
  'uniform vec3 uUp;',
  'uniform float uSize;',
  'varying vec2 vXY;',
  'varying vec3 vWorld;',
  '#include <common>',
  '#include <logdepthbuf_pars_vertex>',
  'void main() {',
  '  vXY = position.xy;',
  '  vWorld = uCenter + (uRight * position.x + uUp * position.y) * uSize;',
  '  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);',
  '  #include <logdepthbuf_vertex>',
  '}'
].join('\n');

/* Gravitational lensing, done as lensing rather than as a painted ring.

   Every fragment of the quad is a ray with an impact parameter b — its
   distance from the axis through the hole. Inside the critical parameter it
   is captured and the fragment is black. Outside, the ray reaches us from an
   apparent angle θ = atan(b/D) having been bent by α, so it left the sky at
   β = θ − α; the shader looks that direction up in the panorama. β running
   negative is not an error, it is the ray that passed the far side of the
   hole, and it is what draws the ring.

   α is the weak-field 2·rs/b divided by (1 − bc/b), which is the standard
   near-field correction: it recovers 2·rs/b far out, and it diverges at the
   photon sphere the way the real deflection does. The divergence is floored,
   because a ray that has wrapped the hole fifty times lands somewhere this
   approximation has no opinion about and the honest thing is to stop.

   The deflection is rolled off over the outer third of the quad. That is the
   one liberty here: the real lens has no edge, and this one has to, so it
   fades out rather than ending in a step against the sky it is bending. */
const HOLE_FRAG = [
  'uniform sampler2D uSky;',
  'uniform vec3 uCenter;',
  'uniform vec3 uFwd;',      // camera → hole, unit
  'uniform float uD;',       // camera → hole, world units
  'uniform float uSize;',    // half-width of the quad, world units
  'uniform float uRs;',      // event horizon, world units
  'uniform float uHasSky;',
  'varying vec2 vXY;',
  'varying vec3 vWorld;',
  '#include <common>',
  '#include <logdepthbuf_pars_fragment>',

  'vec3 look(float beta, vec3 perp) {',
  '  vec3 dir = normalize(uFwd * cos(beta) + perp * sin(beta));',
  '  float u = atan(dir.z, dir.x) / 6.2831853 + 0.5;',
  '  float v = asin(clamp(dir.y, -1.0, 1.0)) / 3.1415927 + 0.5;',
  '  return texture2D(uSky, vec2(u, v)).rgb;',
  '}',

  'void main() {',
  '  float r = length(vXY);',
  '  if (r > 1.0) discard;',
  '  float b = r * uSize;',
  '  float bc = uRs * 2.5980762;',
  '  vec3 col = vec3(0.0);',

  /* With no sky there is nothing to bend, and the lens has nothing to say
     outside the shadow — so it says nothing, rather than painting a black
     disc over whatever happens to be behind it. */
  '  float fade = uHasSky > 0.5 ? 1.0 : 0.0;',
  '  if (b > bc && uHasSky > 0.5) {',
  '    vec3 perp = normalize(vWorld - uCenter);',
  '    float theta = atan(b, uD);',
  '    float a = (2.0 * uRs / b) / max(1.0 - bc / b, 0.02);',
  '    a *= 1.0 - smoothstep(0.4, 0.95, r);',
  '    float beta = theta - a;',
  '    fade = 1.0 - smoothstep(0.55, 1.0, r);',
  /* Five taps along the one axis the sky is stretched on, combined by max
     rather than by average.

     Averaging is right for an extended source and wrong for this one: this sky
     is points, and a point caught by one tap in five came back at a fifth of
     its brightness, which turned the lens into a dark disc cut out of the
     starfield. Lensing does not dim — surface brightness is conserved, and a
     point source is drawn out into an arc of the same brightness — so the taps
     are a smear, and max is what smears them. */
  '    float spread = min(a * 0.008, 0.008);',
  '    vec3 c0 = look(beta, perp);',
  '    c0 = max(c0, look(beta - spread, perp));',
  '    c0 = max(c0, look(beta + spread, perp));',
  '    c0 = max(c0, look(beta - spread * 0.5, perp));',
  '    c0 = max(c0, look(beta + spread * 0.5, perp));',
  '    col = c0;',
  '  }',

  /* The lens has an edge and the sky it bends does not, so the outer band
     hands back to the real sky behind it. The two roll-offs are deliberately
     staggered: the deflection is most of the way to nothing before the quad
     starts becoming transparent, so by the time the real sky shows through
     the lens is already drawing the same stars in the same places and there
     is nothing left to mark the join. */
  '  gl_FragColor = vec4(col, b <= bc ? 1.0 : fade);',
  '  #include <logdepthbuf_fragment>',
  '  #include <tonemapping_fragment>',
  '  #include <colorspace_fragment>',
  '}'
].join('\n');

/* ── stars ──────────────────────────────────────────────────────────────────
   A star is the one body in a system that is not a surface but a process, so
   it gets a shader rather than a painted texture: convection cells that churn
   rather than a picture that sits still.

   How fast and how fine comes from the class. A main-sequence star turns over
   slowly in broad cells; a neutron star is thirty kilometres of degenerate
   matter spinning hundreds of times a second, and reads as something far
   tighter and far more violent. Both run on real seconds rather than
   simulated ones — the surface should not start strobing because you asked
   the orbits to run at a year a second.

   Written as GLSL1 because that is what three's ShaderMaterial compiles by
   default, and it pulls in the logarithmic-depth chunks by hand: a custom
   shader does not get them for free, and without them a star would sort
   against everything else in the scene as though the depth buffer were
   linear. */

const STAR_VERT = [
  'varying vec3 vPos;',
  '#include <common>',
  '#include <logdepthbuf_pars_vertex>',
  'void main() {',
  '  vPos = position;',
  '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
  '  #include <logdepthbuf_vertex>',
  '}'
].join('\n');

const STAR_FRAG = [
  'uniform vec3 uColor;',
  'uniform float uTime;',
  'uniform float uScale;',
  'uniform float uSpeed;',
  'uniform float uContrast;',
  'varying vec3 vPos;',
  '#include <common>',
  '#include <logdepthbuf_pars_fragment>',

  'float hash(vec3 p) {',
  '  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);',
  '}',
  'float vnoise(vec3 p) {',
  '  vec3 i = floor(p), f = fract(p);',
  '  f = f * f * (3.0 - 2.0 * f);',
  '  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),',
  '                 mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),',
  '             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),',
  '                 mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);',
  '}',
  'float fbm(vec3 p) {',
  '  float v = 0.0, a = 0.5;',
  '  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }',
  '  return v;',
  '}',

  'void main() {',
  '  vec3 p = normalize(vPos) * uScale;',
  '  float t = uTime * uSpeed;',
  // Two layers drifting against each other, so cells churn rather than slide.
  '  float n = fbm(p + vec3(0.0, t, 0.0));',
  '  n = mix(n, fbm(p * 2.13 - vec3(t * 0.63)), 0.45);',
  '  vec3 col = uColor * (0.62 + n * 0.85);',
  // The brightest cells run hotter, which is what gives granulation its bite.
  '  col += uColor * pow(max(n - 0.54, 0.0) * 2.3, uContrast);',
  '  gl_FragColor = vec4(col, 1.0);',
  '  #include <logdepthbuf_fragment>',
  '  #include <tonemapping_fragment>',
  '  #include <colorspace_fragment>',
  '}'
].join('\n');

/** How a class of star behaves, in the shader's terms. */
function starLook(sub, cls) {
  const s = String(sub || '').toLowerCase();
  if (s.includes('neutron')) return { scale: 26, speed: 2.6, contrast: 3.4 };
  if (s.includes('white dwarf')) return { scale: 16, speed: 0.9, contrast: 3.0 };
  if (s.includes('black hole')) return { scale: 8, speed: 0.15, contrast: 1.2 };
  if (s.includes('brown dwarf') || /^[LTY]/.test(cls || '')) {
    return { scale: 5.5, speed: 0.05, contrast: 1.6 };   // barely convecting
  }
  if (/^[OB]/.test(cls || '')) return { scale: 11, speed: 0.34, contrast: 2.6 };
  return { scale: 7.5, speed: 0.16, contrast: 2.2 };      // main sequence
}

function starMaterial(node, tint) {
  const look = starLook(node.sub, node.raw.spectralClass);
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(tint) },
      uTime: { value: 0 },
      uScale: { value: look.scale },
      uSpeed: { value: look.speed },
      uContrast: { value: look.contrast }
    },
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG
  });
}

/* ── surfaces ───────────────────────────────────────────────────────────────
   Textures are painted, not photographed.

   Elite has four hundred billion systems, and the dump describes a body by
   class rather than by appearance. A photograph of Jupiter on some other
   system's Class I gas giant would be a fabrication dressed up as data, and
   shipping real imagery for every world would run to terabytes. So each body
   gets a surface painted from what the dump actually says about it — its
   class, and where the data supports it its atmosphere, volcanism and
   temperature.

   Seeded from the body's own id64, so a given world looks the same every time
   anyone visits it. Random per body, never random per page load: a planet
   that changed its face between visits would stop being a fact about the
   planet. */

/** Small, fast, and the same sequence for the same body, forever. */
function seeded(id) {
  let h = 2166136261;
  const str = String(id || 'unnamed');
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6D2B79F5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hsl = (h, s, l, a) => 'hsla(' + h + ',' + s + '%,' + l + '%,' + (a === undefined ? 1 : a) + ')';

/** The base tint as HSL, so a class's own palette can be varied around it. */
function baseHsl(hex) {
  const c = new THREE.Color(hex);
  const o = {};
  c.getHSL(o);
  return { h: o.h * 360, s: o.s * 100, l: o.l * 100 };
}

/** Latitude bands, jittered — how every gas giant reads at a glance. */
function paintBands(ctx, w, h, rnd, b, count) {
  for (let i = 0; i < count; i++) {
    const y = rnd() * h;
    const thick = h * (0.02 + rnd() * 0.13);
    const dl = (rnd() - 0.5) * 52;
    ctx.fillStyle = hsl(b.h + (rnd() - 0.5) * 20, b.s * (0.6 + rnd() * 0.8),
                        Math.max(6, Math.min(92, b.l + dl)), 0.8);
    // Drawn as a run of short segments so the edges waver instead of ruling.
    const steps = 60;
    for (let sx = 0; sx < steps; sx++) {
      const wob = Math.sin(sx / steps * Math.PI * 2 * (1 + rnd())) * thick * 0.35;
      ctx.fillRect((sx / steps) * w, y + wob, w / steps + 1, thick);
    }
  }
}

/** Soft patches — continents, ice fields, mare, whatever the class calls it. */
function paintBlobs(ctx, w, h, rnd, b, count, size, dl, alpha) {
  for (let i = 0; i < count; i++) {
    const x = rnd() * w, y = rnd() * h;
    const r = size * (0.4 + rnd() * 1.6);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const col = hsl(b.h + (rnd() - 0.5) * 22, b.s * (0.6 + rnd() * 0.7),
                    Math.max(4, Math.min(95, b.l + dl * (0.4 + rnd()))), alpha);
    g.addColorStop(0, col);
    g.addColorStop(1, hsl(b.h, b.s, b.l, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    // Wrap, so nothing has a seam down the back.
    if (x < r) ctx.fillRect(x - r + w, y - r, r * 2, r * 2);
    if (x > w - r) ctx.fillRect(x - r - w, y - r, r * 2, r * 2);
  }
}

/** Craters, for anything with no atmosphere to weather them away. */
function paintCraters(ctx, w, h, rnd, b, count) {
  for (let i = 0; i < count; i++) {
    const x = rnd() * w, y = rnd() * h, r = 1 + rnd() * (h * 0.035);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = hsl(b.h, b.s * 0.8, Math.max(3, b.l - 10 - rnd() * 12), 0.5);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x - r * 0.18, y - r * 0.18, r * 0.82, 0, Math.PI * 2);
    ctx.fillStyle = hsl(b.h, b.s * 0.7, Math.min(96, b.l + 6 + rnd() * 10), 0.28);
    ctx.fill();
  }
}

const TEX_CACHE = new Map();

function bodyTexture(n) {
  const key = n.raw.id64 || n.name;
  if (TEX_CACHE.has(key)) return TEX_CACHE.get(key);

  const rnd = seeded(key);
  const b = baseHsl(tintOf(n.sub));
  const sub = String(n.sub || '').toLowerCase();
  const w = 256, h = 128;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  ctx.fillStyle = hsl(b.h, b.s, b.l);
  ctx.fillRect(0, 0, w, h);

  if (sub.includes('gas giant') || sub.includes('water giant')) {
    // Bands, and a storm or two. The count varies per body so two Class I
    // giants in the same system are not the same picture.
    paintBands(ctx, w, h, rnd, b, 16 + Math.floor(rnd() * 14));
    const storms = Math.floor(rnd() * 3);
    for (let i = 0; i < storms; i++) {
      const x = rnd() * w, y = h * (0.25 + rnd() * 0.5), r = h * (0.05 + rnd() * 0.07);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, hsl(b.h + 18, Math.min(100, b.s * 1.4), b.l + 14, 0.8));
      g.addColorStop(1, hsl(b.h, b.s, b.l, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.8, r, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (sub.includes('earth-like') || sub.includes('water world')) {
    /* Ocean first, then land on top of it. Painting an ocean world out of a
       single green produced a green ball with nothing on it — water and land
       are different colours, and that difference is the whole reason the
       class is recognisable at a glance. */
    const ocean = { h: 204, s: 52, l: 26 };
    ctx.fillStyle = hsl(ocean.h, ocean.s, ocean.l);
    ctx.fillRect(0, 0, w, h);
    paintBlobs(ctx, w, h, rnd, ocean, 12, h * 0.22, 10, 0.5);

    // How much land there is varies per world; a water world keeps less.
    const land = { h: 96 + rnd() * 30, s: 30 + rnd() * 22, l: 30 + rnd() * 10 };
    const count = sub.includes('water world')
      ? 4 + Math.floor(rnd() * 5) : 12 + Math.floor(rnd() * 12);
    paintBlobs(ctx, w, h, rnd, land, count, h * 0.15, 6, 0.95);
    paintBlobs(ctx, w, h, rnd, { h: land.h - 40, s: 26, l: 42 },
               Math.floor(count / 2), h * 0.08, 8, 0.55);   // arid ground

    // Ice at both poles.
    ['top', 'bottom'].forEach((edge) => {
      const g = ctx.createLinearGradient(0, edge === 'top' ? 0 : h,
                                         0, edge === 'top' ? h * 0.2 : h * 0.8);
      g.addColorStop(0, hsl(198, 14, 94, 0.9));
      g.addColorStop(1, hsl(198, 14, 94, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, edge === 'top' ? 0 : h * 0.8, w, h * 0.2);
    });
  } else if (sub.includes('ammonia')) {
    paintBands(ctx, w, h, rnd, b, 8 + Math.floor(rnd() * 8));
    paintBlobs(ctx, w, h, rnd, b, 10, h * 0.12, -14, 0.4);
  } else if (sub.includes('ice') || sub.includes('icy')) {
    paintBlobs(ctx, w, h, rnd, b, 16, h * 0.15, 14, 0.4);
    paintCraters(ctx, w, h, rnd, b, 30 + Math.floor(rnd() * 50));
  } else {
    // Rock, metal and everything else the dump has no better word for.
    paintBlobs(ctx, w, h, rnd, b, 14, h * 0.18, -12, 0.45);
    paintCraters(ctx, w, h, rnd, b, 40 + Math.floor(rnd() * 70));
  }

  /* What the dump knows, showing on the surface. A body with a real
     atmosphere gets weather over it; one with active volcanism gets its
     hotspots. Both come from fields, not from taste. */
  const atmo = n.raw.atmosphereComposition;
  if (atmo && Object.keys(atmo).length && n.raw.surfacePressure > 0.02) {
    const decks = 14 + Math.floor(rnd() * 14);
    for (let i = 0; i < decks; i++) {
      const x = rnd() * w, y = rnd() * h;
      const rx = w * (0.05 + rnd() * 0.14), ry = h * (0.02 + rnd() * 0.04);
      const g = ctx.createRadialGradient(x, y, 0, x, y, rx);
      g.addColorStop(0, hsl(0, 0, 99, 0.34 + rnd() * 0.3));
      g.addColorStop(1, hsl(0, 0, 99, 0));
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1, ry / rx);
      ctx.translate(-x, -y);
      ctx.fillStyle = g;
      ctx.fillRect(x - rx, y - rx, rx * 2, rx * 2);
      ctx.restore();
    }
  }
  if (/major|magma|lava/i.test(n.raw.volcanismType || '')) {
    for (let i = 0; i < 8; i++) {
      const x = rnd() * w, y = rnd() * h, r = h * (0.02 + rnd() * 0.05);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, hsl(18, 90, 58, 0.75));
      g.addColorStop(1, hsl(18, 90, 40, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  TEX_CACHE.set(key, tex);
  return tex;
}

/* How solid a ring is drawn.

   The dump carries a mass per ring alongside its radii, so surface density is
   simply mass over area — and it separates them by a factor of fifty across
   Sol: Jupiter's halo ring is a whisper, Saturn's D ring middling, Uranus's
   and Neptune's the heaviest. Worth saying plainly, because it is the reverse
   of the real solar system, where Saturn's rings dwarf everything: these are
   the game's numbers, not astronomy's, and this draws what the data says.

   The units are unstated, so the scale is anchored on a value from the game
   rather than on physics, and clamped so nothing is either invisible or a
   plate. */
function ringOpacity(r) {
  if (!r.mass || !(r.outerRadius > r.innerRadius)) return 0.3;
  const area = Math.PI * (r.outerRadius * r.outerRadius - r.innerRadius * r.innerRadius);
  const density = r.mass / area;
  // Saturn's D ring sits at 1.3e-12 and reads about right at a third opaque.
  return Math.max(0.06, Math.min(0.5, 0.3 * Math.pow(density / 1.3e-12, 0.45)));
}

function tintOf(sub) {
  if (TINT[sub]) return TINT[sub];
  const s = String(sub || '').toLowerCase();
  if (s.includes('gas giant')) return 0xC9A87C;
  if (s.includes('ice') || s.includes('icy')) return 0xC2D6E2;
  if (s.includes('water')) return 0x2E6FA8;
  if (s.includes('metal')) return 0x9A7B5E;
  return 0x8B8579;
}

/* ── orbital mechanics ──────────────────────────────────────────────────── */

/** Kepler's equation, M = E − e·sin E, by Newton–Raphson. */
function eccentricAnomaly(M, e) {
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 12; i++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-11) break;
  }
  return E;
}

/**
 * Where a body is, relative to whatever it orbits, `days` after the epoch its
 * mean anomaly was recorded at. Returns scene units, using the drawn radius
 * rather than the true one — `a` here is already through the layout pass.
 */
function positionAt(b, days, out) {
  if (!b.P) return out.set(0, 0, 0);

  const M = b.M0 + 2 * Math.PI * (days / b.P);
  const E = eccentricAnomaly(M, b.e);
  const nu = 2 * Math.atan2(Math.sqrt(1 + b.e) * Math.sin(E / 2),
                            Math.sqrt(1 - b.e) * Math.cos(E / 2));
  // Radius follows the true ellipse; a is the drawn semi-major axis, so the
  // shape is right even where the scale is not.
  const r = b.a * (1 - b.e * Math.cos(E));
  return inPlaneToScene(r * Math.cos(nu), r * Math.sin(nu), b, out);
}

/** Rotate the orbital plane into the scene by Ω, i and ω. */
function inPlaneToScene(x, y, b, out) {
  const co = Math.cos(b.w), so = Math.sin(b.w);
  const cO = Math.cos(b.O), sO = Math.sin(b.O);
  const ci = Math.cos(b.i), si = Math.sin(b.i);

  const X = x * (cO * co - sO * so * ci) - y * (cO * so + sO * co * ci);
  const Y = x * (sO * co + cO * so * ci) - y * (sO * so - cO * co * ci);
  const Z = x * (so * si) + y * (co * si);

  // Ecliptic Z is the scene's up.
  return out.set(X, Z, Y);
}

/* ── the model ──────────────────────────────────────────────────────────── */

/**
 * Turn one dump into a tree of drawable bodies.
 *
 * `parents` in the dump reads outward — [{Planet: 3}, {Star: 0}] is a moon of
 * body 3, which orbits body 0 — so the first entry is the immediate parent.
 * Barycentres come through as {Null: id}: real nodes with real orbits and no
 * surface, which is why they are kept rather than skipped. Drop one and every
 * body hanging off it loses its anchor.
 */
function buildModel(sys) {
  const raw = (sys.bodies || []).filter((b) => b && b.bodyId !== undefined);
  const byId = new Map(raw.map((b) => [b.bodyId, b]));

  const star = raw.find((b) => b.type === 'Star' && b.mainStar)
            || raw.find((b) => b.type === 'Star')
            || raw[0];
  if (!star) return null;

  const epoch = parseEpoch(sys.date || star.updateTime);

  const nodes = new Map();
  const make = (b) => ({
    id: b.bodyId,
    name: b.name || 'Unnamed',
    type: b.type,
    sub: b.subType || '',
    raw: b,
    km: b.type === 'Star' ? (b.solarRadius || 0) * 696340 : (b.radius || 0),
    hole: b.type === 'Star' && isHole(b.subType),
    // Elements, in radians and days. A body with no period does not move.
    aAu: b.semiMajorAxis || 0,
    e: b.orbitalEccentricity || 0,
    i: (b.orbitalInclination || 0) * DEG,
    w: (b.argOfPeriapsis || 0) * DEG,
    O: (b.ascendingNode || 0) * DEG,
    M0: (b.meanAnomaly || 0) * DEG,
    P: b.orbitalPeriod || 0,
    spin: b.rotationalPeriod || 0,
    tilt: b.axialTilt || 0,
    children: []
  });

  raw.forEach((b) => nodes.set(b.bodyId, make(b)));

  const root = nodes.get(star.bodyId);
  nodes.forEach((n) => {
    if (n === root) return;
    const p = n.raw.parents && n.raw.parents[0];
    const pid = p ? Object.values(p)[0] : null;
    // A parent outside the dump means an incomplete scan; hang it off the
    // star rather than dropping the body.
    const parent = (pid !== null && nodes.has(pid) && nodes.get(pid) !== n)
      ? nodes.get(pid) : root;
    n.parent = parent;
    parent.children.push(n);
  });

  /* Stations, which the dump keeps in two places: on the body they sit on or
     orbit, and at system level for the ones the dump does not attach to a
     body. Both carry a real distanceToArrival, which is the fact worth
     showing — what they do not carry is any orbital element, so this is the
     one thing here that cannot be given a position in the 3D view without
     inventing it. They go where the data supports: the distance axis, the
     list, and the panel. */
  const ports = [];
  nodes.forEach((n) => {
    (n.raw.stations || []).forEach((st) => { if (st && st.name) ports.push({ st, on: n }); });
  });
  (sys.stations || []).forEach((st) => { if (st && st.name) ports.push({ st, on: null }); });

  return { name: sys.name, star: root, all: [...nodes.values()], ports, epoch, sys };
}

function parseEpoch(s) {
  if (!s) return new Date();
  // "2026-09-03 03:00:30+00" is nearly ISO; the offset needs its minutes.
  const iso = String(s).replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00');
  const d = new Date(iso);
  return isNaN(d) ? new Date() : d;
}

/**
 * Decide how big everything is drawn.
 *
 * Each set of siblings is scaled against its own spread, not the system's, so
 * Jupiter's moons stay around Jupiter instead of being crushed to a point by
 * a Kuiper-belt object 200 AU away. That also means this works on a system
 * that looks nothing like Sol.
 */
function layout(model, trueDistance) {
  /* Ideal drawn radius, before the fit below cuts it down to what will go in
     the gap.

     True scale means both axes: the orbits to scale with each other and the
     bodies to scale with the orbits. That makes Mercury two millionths of the
     view across, which is the honest answer — you go and look at it rather
     than seeing it from here. Spread mode exaggerates instead, because at a
     glance you want to read the system, not measure it. */
  const idealR = (n, perAu) => {
    if (!n.km) return 0;                       // barycentres draw nothing
    /* A black hole is drawn at its shadow rather than its horizon: the shadow
       is the black disc you actually see, and sizing the node by it means the
       collision fitting, the framing and the pip all work on what the reader
       is looking at instead of on something 2.6 times smaller. */
    const km = n.hole ? n.km * SHADOW : n.km;
    if (trueDistance) return (km / AU_KM) * perAu;
    // Schematic, and a black hole is not a star: half a star's disc, which
    // leaves its ring sitting a little outside where a star's edge would be.
    if (n.hole) return 1.6;
    if (n.type === 'Star') return 3.2;
    // Compressed hard: Jupiter is 11 Earths across and would swamp the view.
    return Math.max(0.32, Math.min(2.6, 1.05 * Math.pow(n.km / 6378, 0.42)));
  };

  /* One scale for the whole system when distances are true, so a moon of
     Neptune and a moon of Earth are drawn against the same ruler. */
  const maxAu = Math.max(...model.all.map((n) => n.aAu || 0), 1e-9);
  const perAu = ORBIT_OUT / maxAu;

  const spread = (kids, inner, outer) => {
    const orbiting = kids.filter((k) => k.aAu > 0);
    if (!orbiting.length) return;

    if (trueDistance) {
      /* Anchored at zero and on the system's own scale, or it is not true
         distance at all — mapping into an [inner, outer] band turns 0.39 AU
         against 700 into 16 units against 100 and destroys the very ratio
         the mode exists to show. */
      orbiting.forEach((k) => { k.a = k.aAu * perAu; });
    } else {
      /* Log, not square root. Sol runs 0.39 AU to 700, and under a square root
         the eight planets everyone came to see occupy the first fifth of the
         view while Sedna and Persephone take the rest. */
      const key = (k) => Math.log10(Math.max(k.aAu, 1e-6));
      const lo = Math.min(...orbiting.map(key));
      const hi = Math.max(...orbiting.map(key));
      orbiting.forEach((k) => {
        k.a = hi === lo ? outer : inner + (outer - inner) * ((key(k) - lo) / (hi - lo));
      });
    }
    kids.forEach((k) => { if (!k.a) k.a = 0; });
  };

  /* No body may be drawn larger than the room it actually has.

     Without this the exaggeration runs away: at true distance Mercury came out
     twelve times wider than its own orbit and Sol's disc was wider than
     Saturn's, so the whole inner system was drawn inside the star and
     neighbouring planets overlapped. A body is capped by the gap to the orbit
     on either side of it, and a parent by the orbit of its innermost child.
     Two neighbours each taking a third of the gap between them cannot meet. */
  const GAP = 0.34, OWN = 0.4, PARENT = 0.42;

  const fit = (n) => {
    const kids = n.children.filter((k) => k.a > 0).sort((x, y) => x.a - y.a);
    if (kids.length) n.drawR = Math.min(n.drawR, kids[0].a * PARENT);
    kids.forEach((k, i) => {
      const below = i === 0 ? k.a : k.a - kids[i - 1].a;
      const above = i === kids.length - 1 ? Infinity : kids[i + 1].a - k.a;
      k.drawR = Math.min(k.drawR, Math.min(below, above) * GAP, k.a * OWN);
      fit(k);
    });
  };

  model.all.forEach((n) => { n.drawR = idealR(n, perAu); n.a = 0; });

  // Orbits first, then sizes, because a moon system is laid out against the
  // planet's drawn radius and that radius is about to be cut down to fit.
  spread(model.star.children, ORBIT_IN, ORBIT_OUT);
  model.all.forEach((n) => {
    if (!n.children.length || n === model.star) return;
    if (trueDistance) { spread(n.children); return; }
    const base = Math.max(n.drawR, 0.6);
    spread(n.children, base * 2.2, base * 7);
  });
  fit(model.star);
}

/* ── the view ───────────────────────────────────────────────────────────── */

const Orrery = (function () {
  let panel, canvas, renderer, scene, cam3, cam2, controls, raycaster;
  /* One constant-size dot per body, over the top of the spheres.

     Drawn true, a body is far smaller than its orbit — Mercury's radius is
     two millionths of the view — so at true distance the spheres vanish and
     you are left looking at bare ellipses. The dots do not scale with zoom,
     so every body stays visible and stays clickable whatever the scale, and
     the sphere underneath is still the honest one. */
  let pips = null, pipNodes = [];
  let model = null, meshes = [], loop = 0, lastFrame = 0;
  let simDays = 0, rateIx = START_RATE, playing = true, wallClock = 0;
  let mode3d = true, trueDistance = false, selected = null;
  /* What to draw, and whether this is a page or an overlay. Orbit paths get
     three states rather than two: a forty-body system draws forty ellipses,
     and the trans-Neptunian inclinations alone make a tangle you cannot see
     the planets through. */
  let showLabels = true, following = true, orbitMode = 0;   // 0 all, 1 planets, 2 none
  let skyMode = 'none', sky = null;                        // none | galaxy | stars
  // The same sky as a picture, for any black hole in the system to bend.
  let lensSky = null, lenses = [];
  let ambient = null, ambientPct = 30, glowPct = 60;

  /* Preferences live in localStorage, guarded: a private window can make even
     reading it throw, and losing the orrery over a remembered slider would be
     a poor trade. */
  const KEY = 'canonn.orrery.';
  const keep = (k, v) => { try { localStorage.setItem(KEY + k, v); } catch (e) {} };
  const recallNum = (k, d) => {
    try { const v = parseFloat(localStorage.getItem(KEY + k)); return isNaN(v) ? d : v; }
    catch (e) { return d; }
  };
  const recallStr = (k, d) => {
    try { return localStorage.getItem(KEY + k) || d; } catch (e) { return d; }
  };
  // Which slice of the rate ladder this system can usefully use — see below.
  let rateLo = 0, rateHi = LADDER.length - 1;
  const ORBIT_LABEL = ['all', 'planets only', 'none'];
  let standalone = false;
  let coreNote = '';
  let galaxyWasVisible = null;
  const cache = new Map();
  const tmp = new THREE.Vector3();

  /* ── data ─────────────────────────────────────────────────────────────── */

  const API = 'https://us-central1-canonn-api-236217.cloudfunctions.net/query';

  /* The console already fetched this exact dump to find the system's star,
     so ask it before asking the network: opening the orrery on the system you
     just clicked costs nothing at all. The local map is the fallback for a
     page that has the orrery without the console. */
  function held(name) {
    const shared = window.CanonnConsole && window.CanonnConsole.systemDump;
    return (shared && shared(name)) || cache.get(name) || null;
  }

  function hold(name, sys) {
    const keep = window.CanonnConsole && window.CanonnConsole.keepSystemDump;
    if (keep) keep(name, sys); else cache.set(name, sys);
  }

  async function fetchSystem(name, id64) {
    const already = held(name);
    if (already) return already;
    let id = id64;
    if (!id) {
      const r = await fetch(API + '/typeahead?q=' + encodeURIComponent(name));
      const j = await r.json();
      const row = j && j.min_max && j.min_max[0];
      /* typeahead is a prefix search, so only an exact name is this system —
         but "exact" is about the letters, not their case. A link someone
         typed or pasted in caps is a link to the same system, and refusing
         it read as the system being missing. */
      const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
      if (!row || !same(row.name, name)) throw new Error('not in the dump');
      id = row.id64;
    }
    const r = await fetch(API + '/codex/dump?id=' + id + '&caller=CanonnED3D');
    const j = await r.json();
    if (!j || !j.system) throw new Error('no system in the dump');
    hold(name, j.system);
    return j.system;
  }

  /* ── chrome ───────────────────────────────────────────────────────────── */

  function build() {
    panel = document.createElement('div');
    panel.className = 'orrery' + (standalone ? ' orr-page' : '');
    panel.innerHTML = [
      '<div class="orr-top">',
      // In a map this is an overlay you came from somewhere; on its own page
      // it is the destination, and what belongs here is a way to find a system.
      '  <button class="orr-back" id="orr-back">&#8592; Back to the map</button>',
      '  <a class="orr-home" id="orr-home" href="index.html" title="All Canonn maps">',
      '    <svg viewBox="0 0 40 40" aria-hidden="true">',
      '      <ellipse cx="20" cy="20" rx="17" ry="7" fill="none" stroke="currentColor" stroke-width="2.6"/>',
      '      <ellipse cx="20" cy="20" rx="17" ry="7" fill="none" stroke="currentColor" stroke-width="2.6" transform="rotate(60 20 20)"/>',
      '      <ellipse cx="20" cy="20" rx="17" ry="7" fill="none" stroke="currentColor" stroke-width="2.6" transform="rotate(120 20 20)"/>',
      '      <circle cx="20" cy="20" r="5" fill="currentColor"/>',
      '    </svg><span>Orrery</span></a>',
      '  <span class="orr-wip" title="The orrery is new. Orbits are solved from Canonn\'s own data, but the view and its controls are still being worked on.">Prototype</span>',
      '  <div class="orr-find" id="orr-find">',
      '    <input id="orr-q" type="text" autocomplete="off" spellcheck="false"',
      '           placeholder="Find a system&#8230;" aria-label="Find a system">',
      '    <div class="orr-res" id="orr-res" role="listbox"></div>',
      '  </div>',
      '  <div class="orr-title"><b id="orr-name"></b><span id="orr-sub"></span></div>',

      /* The same three ways out the map's own header carries, because a
         reader who came here from the map should not lose them by arriving,
         and one who came straight to the page never had them. In front of
         them, the two that are about the system on screen rather than about
         Canonn. */
      '  <a class="orr-tb sys" id="orr-signals" target="_blank" rel="noopener"',
      '     title="This system in Signals, which knows every body Canonn has a record of">Signals <span>&#8599;</span></a>',
      '  <button class="orr-tb sys" id="orr-link" title="Copy a link straight to this system">Copy link</button>',
      '  <div class="orr-rail">',
      '    <button class="orr-tb" id="orr-tools" aria-haspopup="true" aria-expanded="false"',
      '            title="Canonn tools">&#8862; Tools</button>',
      '    <a class="orr-tb wide" href="https://github.com/canonn-science/CanonnED3D-Map"',
      '       target="_blank" rel="noopener" title="Source on GitHub">GitHub</a>',
      '    <a class="orr-tb wide donate" href="https://canonn.science/donate/"',
      '       target="_blank" rel="noopener" title="Support Canonn">Donate</a>',
      '  </div>',
      '  <button class="orr-x" id="orr-close" aria-label="Close">&times;</button>',
      '  <div class="orr-menu" id="orr-menu" role="menu" aria-labelledby="orr-tools"></div>',
      '</div>',


      // The spine: every body on a log axis of its distance from where you
      // drop in. The orbit view shows AU from each parent, which is a
      // different question from "how far is the fly-out".
      '<div class="orr-spine" id="orr-spine"></div>',
      '<div class="orr-grip orr-grip-h" id="orr-grip-h" role="separator"',
      '     aria-label="Resize the distance axis" tabindex="0"></div>',

      '<div class="orr-mid">',
      '  <aside class="orr-side orr-left" id="orr-left">',
      '    <div class="orr-s-h">',
      '      <div class="orr-s-t">Bodies</div>',
      '      <input id="orr-filter" class="orr-filter" type="text" autocomplete="off"',
      '             spellcheck="false" placeholder="Filter" aria-label="Filter bodies">',
      '    </div>',
      '    <div class="orr-list" id="orr-list"></div>',
      '  </aside>',
      '  <div class="orr-stage"><canvas id="orr-canvas"></canvas>',
      '    <div class="orr-labels" id="orr-labels"></div>',
      /* ── how it is drawn ──────────────────────────────────────────────────
         On the map, over the thing they change. These lived behind a View
         button in a panel that floated here, which meant remembering the
         button existed, opening it, changing one thing and closing it again.
         They are a strip now: no opening, and everything they do is
         happening directly underneath them. */
      '    <div class="orr-hud" id="orr-hud">',
      '      <div class="orr-seg" role="group" aria-label="Projection">',
      '        <button id="orr-3d" class="on" aria-pressed="true">3D</button>',
      '        <button id="orr-2d" aria-pressed="false">2D</button>',
      '      </div>',
      '      <div class="orr-seg" role="group" aria-label="Scale">',
      '        <button id="orr-spread" class="on" aria-pressed="true"',
      '                title="Orbits spread on a log scale, so the whole system is legible at once">Spread</button>',
      '        <button id="orr-true" aria-pressed="false"',
      '                title="Orbits and bodies both to scale. Pick a body to fly to it — at this scale nothing is visible from across the system">True scale</button>',
      '      </div>',
      '      <span class="orr-hud-r"></span>',
      '      <button class="orr-opt" id="orr-orbits"><span>Orbits</span><b>all</b></button>',
      '      <button class="orr-opt on" id="orr-labl"><span>Names</span><b>on</b></button>',
      '      <button class="orr-opt on" id="orr-follow"><span>Follow</span><b>on</b></button>',
      '      <button class="orr-opt" id="orr-sky"><span>Sky</span><b></b></button>',
      '      <span class="orr-hud-r"></span>',

      /* Not everything belongs on the bar. How bright the ambient light is
         and how far a star's glow reaches are set once, to taste, and then
         left alone for the rest of the session — they are settings, not
         controls, and putting them in the same row as the six things a reader
         changes while reading makes all eight harder to find. So these two
         keep a box of their own. */
      '      <div class="orr-pop-w">',
      '        <button class="orr-tb" id="orr-light" aria-haspopup="true" aria-expanded="false">Light</button>',
      '        <div class="orr-pop" id="orr-light-p" role="group" aria-label="Light">',
      '          <label class="orr-sl"><span>Ambient</span>',
      '            <input id="orr-amb" type="range" min="0" max="100" value="30"></label>',
      '          <label class="orr-sl"><span>Star glow</span>',
      '            <input id="orr-glow" type="range" min="0" max="100" value="60"></label>',
      '        </div>',
      '      </div>',
      '      <button class="orr-tb" id="orr-reset">Frame the system</button>',
      '    </div>',
      '    <div class="orr-msg" id="orr-msg">Reading the system dump&#8230;</div>',
      '    <div class="orr-legend" id="orr-legend"></div>',
      '  </div>',
      '    <div class="orr-grip orr-grip-l" id="orr-grip-l" role="separator"',
      '         aria-label="Resize the body list" tabindex="0"></div>',
      '  <aside class="orr-side orr-right" id="orr-right">',
      '    <div class="orr-grip orr-grip-r" id="orr-grip-r" role="separator"',
      '         aria-label="Resize the detail panel" tabindex="0"></div>',
      '    <div class="orr-facts" id="orr-facts"></div>',
      '  </aside>',
      '</div>',
      '<div class="orr-foot">',
      '  <div class="orr-time">',
      '    <button id="orr-slower" title="Slower, then backwards">&#9668;&#9668;</button>',
      '    <button id="orr-play" class="orr-play" title="Pause">&#10074;&#10074;</button>',
      '    <button id="orr-faster" title="Faster">&#9658;&#9658;</button>',
      '    <span class="orr-rate" id="orr-rate"></span>',
      '  </div>',
      '  <div class="orr-clock"><span id="orr-date"></span>',
      '    <button id="orr-now" title="Back to the present">Now</button></div>',
      '</div>',

      // Nothing asked for yet. The search is the page, so it moves to the
      // middle and brings a few real places to start.
      '<div class="orr-empty" id="orr-empty">',
      '  <h1>Canonn Orrery</h1>',
      '  <p>Any system Canonn has data for, with its bodies on their real orbits.',
      '     Search above, or start somewhere known.</p>',
      '  <div class="orr-seeds">',
      '    <button data-sys="Sol">Sol</button>',
      '    <button data-sys="Merope">Merope</button>',
      '    <button data-sys="Colonia">Colonia</button>',
      '    <button data-sys="Sagittarius A*">Sagittarius A*</button>',
      '    <button data-sys="Betelgeuse">Betelgeuse</button>',
      '  </div>',
      '</div>'
    ].join('\n');
    document.body.appendChild(panel);
    canvas = panel.querySelector('#orr-canvas');

    const $ = (id) => panel.querySelector('#' + id);
    $('orr-back').onclick = $('orr-close').onclick = close;
    $('orr-play').onclick = () => setPlaying(!playing);
    $('orr-slower').onclick = () => setRate(rateIx - 1);
    $('orr-faster').onclick = () => setRate(rateIx + 1);
    $('orr-now').onclick = () => { simDays = 0; draw(0); };
    $('orr-3d').onclick = () => setMode(true);
    $('orr-2d').onclick = () => setMode(false);
    $('orr-spread').onclick = () => setScale(false);
    $('orr-true').onclick = () => setScale(true);
    $('orr-labl').onclick = () => setLabels(!showLabels);
    // Three states, so it says which one it is in and steps to the next.
    $('orr-sky').onclick = () =>
      setSky(SKIES[(SKIES.findIndex((k) => k[0] === skyMode) + 1) % SKIES.length][0]);
    $('orr-amb').addEventListener('input', (e) => setAmbient(+e.target.value));
    $('orr-glow').addEventListener('input', (e) => setGlow(+e.target.value));
    $('orr-follow').onclick = () => setFollow(!following);
    $('orr-reset').onclick = () => { if (model) { frame(); select(model.star, false); } };
    $('orr-orbits').onclick = () => setOrbits((orbitMode + 1) % 3);
    $('orr-link').onclick = copyLink;
    $('orr-tools').onclick = (e) => { e.stopPropagation(); showMenu(!menuOpen()); };
    $('orr-light').onclick = (e) => { e.stopPropagation(); showLight(!lightOpen()); };
    document.addEventListener('click', (e) => {
      if (menuOpen() && !$('orr-menu').contains(e.target)) showMenu(false);
      if (lightOpen() && !$('orr-light-p').contains(e.target)) showLight(false);
    });
    $('orr-filter').addEventListener('input', () => renderList());
    $('orr-empty').addEventListener('click', (e) => {
      const b = e.target.closest('[data-sys]');
      if (b) go(b.dataset.sys);
    });
    wireSearch();
    wireResize();

    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', () => { resize(); drawSpine(); });
    canvas.addEventListener('pointerdown', onPick);
    initGL();
  }

  /* ── the tools menu ───────────────────────────────────────────────────────
     Canonn is a dozen tools and the map links out to a handful of them; the
     orrery linked to none, so arriving here was a way of leaving the rest of
     Canonn behind. The list is data/canonn-tools.json, which the console's
     command palette reads as well — one list, so a tool added anywhere is
     added everywhere. Fetched on the first open rather than on load: a reader
     who never opens the menu never pays for it. */

  let TOOLS = null, toolsAsked = null;

  function toolList() {
    if (!toolsAsked) {
      toolsAsked = fetch('data/canonn-tools.json')
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { TOOLS = (j && j.tools) || []; })
        .catch(() => { TOOLS = []; });
    }
    return toolsAsked;
  }

  const menuOpen = () => !!(panel && panel.classList.contains('menu-open'));
  const lightOpen = () => !!(panel && panel.classList.contains('light-open'));

  function showLight(on) {
    panel.classList.toggle('light-open', !!on);
    panel.querySelector('#orr-light').setAttribute('aria-expanded', on ? 'true' : 'false');
  }

  function showMenu(on) {
    panel.classList.toggle('menu-open', !!on);
    panel.querySelector('#orr-tools').setAttribute('aria-expanded', on ? 'true' : 'false');
    if (!on) return;
    toolList().then(() => {
      if (!menuOpen()) return;
      /* The two site links live in the header when there is room for them and
         in here when there is not, so the menu carries them either way — a
         narrow window must not be a window with no way to the source. */
      panel.querySelector('#orr-menu').innerHTML =
        (TOOLS || []).map(([name, host, url]) =>
          '<a role="menuitem" href="' + esc(url) + '" target="_blank" rel="noopener">' +
          '<span>' + esc(name) + '</span><em>' + esc(host) + '</em></a>').join('') +
        '<div class="orr-menu-r"></div>' +
        '<a role="menuitem" class="only-narrow" href="https://github.com/canonn-science/CanonnED3D-Map"' +
        ' target="_blank" rel="noopener"><span>GitHub</span><em>the source</em></a>' +
        '<a role="menuitem" class="only-narrow" href="https://canonn.science/donate/"' +
        ' target="_blank" rel="noopener"><span>Donate</span><em>support Canonn</em></a>' +
        '<a role="menuitem" href="index.html"><span>All Canonn maps</span><em>this site</em></a>';
    });
  }

  /* ── resizing ─────────────────────────────────────────────────────────────
     The list, the detail and the distance axis are all things a reader wants
     more or less of depending on what they are doing, so all three take a
     drag. Widths and heights are remembered, and clamped on the way back in as
     well as on the way out: a size chosen on a wide screen must not be able to
     leave a narrow one with no room for the model itself. */

  function clampSide(px, which) {
    const room = panel.querySelector('.orr-mid').getBoundingClientRect().width || 1200;
    // Always leave the stage at least half the width between the two rails.
    const max = Math.max(180, room * 0.34);
    return Math.round(Math.max(160, Math.min(max, px)));
  }

  function setSide(which, px) {
    const el = panel.querySelector('#orr-' + which);
    const w = clampSide(px, which);
    el.style.width = w + 'px';
    keep(which + 'Width', w);
    resize();
    return w;
  }

  function setSpine(px) {
    const h = Math.round(Math.max(0, Math.min(120, px)));
    const el = panel.querySelector('#orr-spine');
    el.style.height = h + 'px';
    // Below the point where an axis can be read, it is simply put away.
    el.classList.toggle('shut', h < 16);
    keep('spineHeight', h);
    resize();
    return h;
  }

  function drag(grip, onMove) {
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      document.body.classList.add('orr-dragging');
      const move = (ev) => onMove(ev);
      const up = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        document.body.classList.remove('orr-dragging');
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
    });
    // Keyboard, because a drag handle that only takes a pointer is a wall.
    grip.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 40 : 12;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); onMove(null, -step); }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); onMove(null, step); }
    });
  }

  function wireResize() {
    const left = panel.querySelector('#orr-left');
    const right = panel.querySelector('#orr-right');
    const spine = panel.querySelector('#orr-spine');

    drag(panel.querySelector('#orr-grip-l'), (ev, step) => {
      const w = ev ? ev.clientX - left.getBoundingClientRect().left
                   : left.getBoundingClientRect().width + step;
      setSide('left', w);
    });
    drag(panel.querySelector('#orr-grip-r'), (ev, step) => {
      const w = ev ? right.getBoundingClientRect().right - ev.clientX
                   : right.getBoundingClientRect().width - step;
      setSide('right', w);
    });
    drag(panel.querySelector('#orr-grip-h'), (ev, step) => {
      const h = ev ? ev.clientY - spine.getBoundingClientRect().top
                   : spine.getBoundingClientRect().height + step;
      setSpine(h);
      drawSpine();
    });

    setSide('left', recallNum('leftWidth', 262));
    setSide('right', recallNum('rightWidth', 276));
    setSpine(recallNum('spineHeight', 37));
    window.addEventListener('resize', () => {
      setSide('left', left.getBoundingClientRect().width);
      setSide('right', right.getBoundingClientRect().width);
    });
  }

  /* ── finding a system ─────────────────────────────────────────────────────
     The same typeahead the card uses to turn a name into an id64 is a prefix
     search over every system Canonn holds, so it is also the search box. It
     answers with the id64, which means picking a result costs one fetch, not
     two. */

  let qTimer = 0, qSel = -1, qRows = [];

  function wireSearch() {
    const q = panel.querySelector('#orr-q');
    const res = panel.querySelector('#orr-res');

    q.addEventListener('input', () => {
      clearTimeout(qTimer);
      const term = q.value.trim();
      if (term.length < 2) return closeResults();
      // Typing is faster than the round trip; only ask once it settles.
      qTimer = setTimeout(() => search(term), 220);
    });

    q.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!qRows.length) return;
        qSel = (qSel + (e.key === 'ArrowDown' ? 1 : -1) + qRows.length) % qRows.length;
        paintResults();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const pick = qRows[qSel < 0 ? 0 : qSel];
        if (pick) { closeResults(); q.blur(); go(pick.name, pick.id64); }
      } else if (e.key === 'Escape') { closeResults(); q.blur(); }
    });

    res.addEventListener('mousedown', (e) => {
      const row = e.target.closest('[data-i]');
      if (!row) return;
      e.preventDefault();
      const pick = qRows[+row.dataset.i];
      closeResults(); q.blur(); q.value = '';
      go(pick.name, pick.id64);
    });

    document.addEventListener('click', (e) => {
      if (panel && !panel.querySelector('#orr-find').contains(e.target)) closeResults();
    });
  }

  async function search(term) {
    try {
      const r = await fetch(API + '/typeahead?q=' + encodeURIComponent(term));
      const j = await r.json();
      qRows = (j && j.min_max || []).slice(0, 12);
    } catch (e) { qRows = []; }
    qSel = -1;
    paintResults();
  }

  function paintResults() {
    const res = panel.querySelector('#orr-res');
    if (!qRows.length) {
      res.innerHTML = '<div class="orr-none">Nothing by that name in Canonn\'s data.</div>';
      res.classList.add('open');
      return;
    }
    res.innerHTML = qRows.map((r, i) => {
      const ly = Math.round(Math.sqrt(r.x * r.x + r.y * r.y + r.z * r.z)).toLocaleString();
      return '<div class="orr-r' + (i === qSel ? ' on' : '') + '" data-i="' + i +
        '" role="option"><span class="nm">' + esc(r.name) + '</span>' +
        '<span class="ly">' + ly + ' ly</span></div>';
    }).join('');
    res.classList.add('open');
  }

  function closeResults() {
    qRows = []; qSel = -1;
    const res = panel && panel.querySelector('#orr-res');
    if (res) { res.classList.remove('open'); res.innerHTML = ''; }
  }

  /** Open a system and, on the page, put it in the address bar. */
  function go(name, id64) {
    if (standalone) {
      const u = new URL(location.href);
      u.searchParams.set('system', name);
      history.replaceState(null, '', u);
      document.title = name + ' — Canonn Orrery';
    }
    open(name, id64);
  }

  function copyLink() {
    const name = model ? model.name : (panel.querySelector('#orr-name').textContent || '');
    if (!name) return;
    const u = new URL('orrery.html', location.href);
    u.searchParams.set('system', name);
    const btn = panel.querySelector('#orr-link');
    navigator.clipboard.writeText(u.href).then(() => {
      btn.textContent = 'Link copied';
      setTimeout(() => { btn.textContent = 'Copy link'; }, 1400);
    }).catch(() => { btn.textContent = 'Copy failed'; });
  }

  /* ── the spine ────────────────────────────────────────────────────────────
     Distance from the arrival point, in light-seconds, on a log axis. It is
     the question every commander asks about a system and the one thing the
     orbit view cannot show: that draws each body against its own parent, so a
     moon of Neptune and a moon of Earth look alike. Here they do not. */

  function drawSpine() {
    const host = panel.querySelector('#orr-spine');
    if (!model) { host.innerHTML = ''; return; }

    /* The arrival star is the origin, so a dump that omits its distance is
       not missing anything — it is zero by definition, and leaving the star
       off its own axis would be odd. */
    const lsOf = (n) => typeof n.raw.distanceToArrival === 'number'
      ? n.raw.distanceToArrival : (n === model.star ? 0 : null);

    const withLs = model.all.filter((n) => n.drawR > 0 && lsOf(n) !== null);
    const withPorts = (model.ports || []).filter(
      (p) => typeof p.st.distanceToArrival === 'number');
    if (withLs.length < 2) { host.innerHTML = ''; host.classList.add('empty'); return; }
    host.classList.remove('empty');

    const max = Math.max(...withLs.map(lsOf),
                        ...withPorts.map((p) => p.st.distanceToArrival), 1);
    // Log, with everything under 10 Ls pinned to the star end rather than
    // running off to minus infinity.
    const at = (ls) => Math.log10(Math.max(ls, 10) / 10) / Math.log10(max / 10 || 1);

    const ticks = [];
    for (let p = 1; Math.pow(10, p) <= max; p++) {
      ticks.push('<span class="tk" style="left:' + (at(Math.pow(10, p)) * 100) + '%">' +
        (Math.pow(10, p) >= 1000 ? Math.pow(10, p) / 1000 + 'k' : Math.pow(10, p)) + '</span>');
    }

    host.innerHTML =
      '<span class="orr-sp-lb">Arrival distance</span>' +
      '<div class="orr-sp-ax">' + ticks.join('') +
        withLs.map((n) => {
          const moon = n.parent && n.parent !== model.star;
          return '<button class="pip' + (moon ? ' moon' : '') +
            (selected === n ? ' on' : '') + '" data-id="' + n.id + '" ' +
            'style="left:' + (at(lsOf(n)) * 100) + '%;--c:' +
              (n.type === 'Star' ? '#' + starColour(n).getHexString()
                                 : '#' + new THREE.Color(tintOf(n.sub)).getHexString()) + '" ' +
            'title="' + esc(shortName(n)) + ' — ' +
              Math.round(lsOf(n)).toLocaleString() + ' Ls"></button>';
        }).join('') +
        withPorts.map((p) =>
          '<span class="port" style="left:' + (at(p.st.distanceToArrival) * 100) + '%" ' +
          'title="' + esc(p.st.name) + (p.st.type ? ' — ' + esc(p.st.type) : '') + ' &middot; ' +
            Math.round(p.st.distanceToArrival).toLocaleString() + ' Ls"></span>').join('') +
      '</div>' +
      '<span class="orr-sp-max">' + Math.round(max).toLocaleString() + ' Ls</span>';

    host.querySelector('.orr-sp-ax').onclick = (e) => {
      const pip = e.target.closest('.pip');
      if (!pip) return;
      const n = model.all.find((x) => x.id === +pip.dataset.id);
      if (n) select(n);
    };
  }

  function onKey(e) {
    if (!isOpen()) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (menuOpen()) showMenu(false);
      else if (lightOpen()) showLight(false);
      else close();
    }
    else if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
    else if (e.key === ',') setRate(rateIx - 1);
    else if (e.key === '.') setRate(rateIx + 1);
  }

  function initGL() {
    /* A system spans from a body a few thousand kilometres across to an orbit
       seven hundred astronomical units wide. A linear depth buffer cannot hold
       that: whatever near and far are set to, one end of the range gets almost
       no precision, and the surfaces that lose are the ones drawn close
       together — a moon against its planet, an orbit line grazing the body on
       it. three.js has the standard answer built in, and its own example for
       it covers a micrometre to a hundred million light years. It costs a
       fragment-shader depth write, which is worth it here. */
    renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: false, logarithmicDepthBuffer: true
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05070A);

    cam3 = new THREE.PerspectiveCamera(48, 1, 0.1, 8000);
    cam3.position.set(0, 95, 175);
    cam2 = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 8000);
    cam2.position.set(0, 400, 0);
    cam2.zoom = 1;

    raycaster = new THREE.Raycaster();
    // Bodies are small on screen; picking needs a bit of slack.
    raycaster.params.Points = { threshold: 2 };

    // One light at the star, so the far side of a planet is actually dark.
    scene.add(new THREE.PointLight(0xffffff, 2.4, 0, 0.0));
    ambient = new THREE.AmbientLight(0x2a3542, 1.4);
    scene.add(ambient);
    makeControls();
  }

  function makeControls() {
    if (controls) controls.dispose();
    const cam = mode3d ? cam3 : cam2;
    controls = new OrbitControls(cam, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enableRotate = mode3d;
    if (!mode3d) { controls.minPolarAngle = controls.maxPolarAngle = 0; }
    controls.target.set(0, 0, 0);
    controls.update();
  }

  /* ── scene ────────────────────────────────────────────────────────────── */

  function buildPips() {
    if (pips) { scene.remove(pips); pips.geometry.dispose(); pips.material.dispose(); }
    pipNodes = model.all.filter((n) => n.drawR > 0 || n.type === 'Star');
    const pos = new Float32Array(pipNodes.length * 3);
    const col = new Float32Array(pipNodes.length * 3);
    const c = new THREE.Color();
    pipNodes.forEach((n, i) => {
      c.set(n.type === 'Star' ? starColour(n) : new THREE.Color(tintOf(n.sub)));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    pips = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 6, sizeAttenuation: false, vertexColors: true,
      map: glowTexture(), transparent: true, alphaTest: 0.25, depthWrite: false
    }));
    pips.renderOrder = 2;
    pips.frustumCulled = false;
    scene.add(pips);
  }

  function movePips() {
    if (!pips) return;
    const a = pips.geometry.getAttribute('position');
    pipNodes.forEach((n, i) => {
      if (n._pos) a.setXYZ(i, n._pos.x, n._pos.y, n._pos.z);
    });
    a.needsUpdate = true;
  }

  function clearScene() {
    if (pips) { scene.remove(pips); pips.geometry.dispose(); pips.material.dispose(); pips = null; }
    meshes.forEach((m) => {
      if (m.mesh) { scene.remove(m.mesh); m.mesh.geometry.dispose(); m.mesh.material.dispose(); }
      if (m.lens) { scene.remove(m.lens); m.lens.geometry.dispose(); m.lens.material.dispose(); }
      if (m.line) { scene.remove(m.line); m.line.geometry.dispose(); m.line.material.dispose(); }
      if (m.rings) {
        scene.remove(m.rings);
        m.rings.children.forEach((d) => { d.geometry.dispose(); d.material.dispose(); });
      }
    });
    meshes = [];
    lenses = [];
  }

  /* The primary's colour by default, and any star's when asked.
     Great Annihilator has seven stars, two of them black holes; painting all
     seven with the primary's accent said the T Tauris were black holes too. */
  function starColour(node) {
    return new THREE.Color(classColour((node || model.star).raw.spectralClass) || '#FFD9A0');
  }

  /* Twelve horizon radii of quad. The deflection is down to a tenth of a
     radian by that edge and is rolled off to nothing over the last third, so
     the lens stops where it stops being worth drawing. */
  const LENS = 12;
  /* Something for the sampler to point at when the sky is off. The shader
     never reads it — uHasSky gates that — but a bound texture beats a null. */
  let NOSKY = null;
  function noSky() {
    if (!NOSKY) NOSKY = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    NOSKY.needsUpdate = true;
    return NOSKY;
  }

  function holeMaterial(n) {
    const rs = n.drawR / SHADOW;             // drawR is the shadow, not the horizon
    return new THREE.ShaderMaterial({
      uniforms: {
        uSky: { value: lensSky ? lensSky.texture : noSky() },
        uHasSky: { value: lensSky ? 1 : 0 },
        uCenter: { value: new THREE.Vector3() },
        uRight: { value: new THREE.Vector3(1, 0, 0) },
        uUp: { value: new THREE.Vector3(0, 1, 0) },
        uFwd: { value: new THREE.Vector3(0, 0, -1) },
        uD: { value: 1 },
        uSize: { value: rs * LENS },
        uRs: { value: rs }
      },
      vertexShader: HOLE_VERT,
      fragmentShader: HOLE_FRAG,
      transparent: true,
      depthWrite: false        // the shadow sphere underneath does the occluding
    });
  }

  const camX = new THREE.Vector3(), camY = new THREE.Vector3(), camZ = new THREE.Vector3();

  function buildScene() {
    clearScene();
    layout(model, trueDistance);

    const starTint = starColour();
    // The page takes the colour of the star it is showing: the spine's axis
    // fades out of it, and the disc is painted from the same value.
    panel.style.setProperty('--star', '#' + starTint.getHexString());

    model.all.forEach((n) => {
      const entry = { node: n };

      if (n.drawR > 0) {
        const isStar = n.type === 'Star';
        const geo = new THREE.SphereGeometry(n.drawR, isStar ? 32 : 20, isStar ? 24 : 14);
        const mat = n.hole
          // Nothing leaves it, so nothing is painted on it. This sphere is the
          // shadow: it occludes what is behind it, and it takes the click.
          ? new THREE.MeshBasicMaterial({ color: 0x000000 })
          : isStar
          // A star is its own light source, so it is not lit by one — it makes
          // its own, and churns while it does it.
          ? starMaterial(n, starColour(n))
          : new THREE.MeshLambertMaterial({ map: bodyTexture(n) });
        entry.mesh = new THREE.Mesh(geo, mat);
        entry.mesh.userData.node = n;
        scene.add(entry.mesh);

        if (n.hole) {
          /* The lens rides a camera-facing quad rather than the sphere,
             because what it draws is not the hole's surface — a hole has no
             surface — but the sky behind it, arriving bent. Never a click
             target: the shadow underneath is the body. */
          const lens = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), holeMaterial(n));
          lens.frustumCulled = false;      // its geometry is built in the shader
          lens.raycast = () => {};
          entry.lens = lens;
          scene.add(lens);
        } else if (isStar) {
          const glow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: glowTexture(), color: starColour(n), transparent: true, opacity: 0.85,
            blending: THREE.AdditiveBlending, depthWrite: false
          }));
          glow.scale.setScalar(n.drawR * 6);
          entry.glow = glow;
          entry.mesh.add(glow);
        }
      }

      /* The path, sampled once in the body's own plane and then carried
         around by its parent each frame.

         Sampled finely enough for the body that sits on it. A polyline is a
         polygon, and a fixed 180 segments sags below the true ellipse by
         r·pi²/(2·180²) — which against Mercury drawn to scale is three and a
         half times the planet's own radius, so the planet visibly missed its
         own orbit and wobbled in and out of it as it travelled. The ratio
         that matters is orbit radius over body radius, and that is physical:
         orbit km over body km, the same at any draw scale. Spread mode hides
         it only because it draws the body hundreds of thousands of times too
         large. Enough segments to keep the sag under a quarter of the body,
         capped so a small object on a very wide orbit — Sedna wants 38,000 —
         does not run away with memory. */
      if (n.a > 0 && n.P) {
        const pts = [];
        const steps = n.drawR > 0
          ? Math.max(180, Math.min(32768,
              Math.ceil(Math.PI * Math.sqrt(2 * n.a / n.drawR))))
          : 180;
        for (let s = 0; s <= steps; s++) {
          const E = (s / steps) * Math.PI * 2;
          const r = n.a * (1 - n.e * Math.cos(E));
          const nu = 2 * Math.atan2(Math.sqrt(1 + n.e) * Math.sin(E / 2),
                                    Math.sqrt(1 - n.e) * Math.cos(E / 2));
          pts.push(inPlaneToScene(r * Math.cos(nu), r * Math.sin(nu), n, new THREE.Vector3()));
        }
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const moon = n.parent && n.parent !== model.star;
        entry.lineNode = n;
        entry.line = new THREE.Line(geo, new THREE.LineBasicMaterial({
          color: moon ? 0x28343F : 0x33465A, transparent: true, opacity: moon ? 0.34 : 0.5
        }));
        entry.line.userData.node = n;
        scene.add(entry.line);
      }

      /* Rings, at their real width.

         The dump gives inner and outer radius in metres against a body radius
         in kilometres, so one converts the other and the ring comes out in the
         same units as the body it belongs to: Saturn's runs 1.26 to 2.38
         Saturn radii, which is what it actually does.

         Flat in the body's own equatorial plane, so they take its axial tilt —
         Uranus is on its side and its rings should be too. They do not take
         its spin: a ring is not painted on the planet. */
      if (n.drawR > 0 && n.raw.rings && n.raw.rings.length && n.km) {
        entry.rings = new THREE.Object3D();
        n.raw.rings.forEach((r) => {
          const inner = (r.innerRadius / 1000 / n.km) * n.drawR;
          const outer = (r.outerRadius / 1000 / n.km) * n.drawR;
          if (!(outer > inner) || !isFinite(outer)) return;

          const tint = RING_TINT[r.type] || 0xA89C8C;
          const geo = new THREE.RingGeometry(inner, outer, 160, 1);

          /* RingGeometry maps its UVs across the bounding square, which is no
             use for something whose structure is radial. Rewritten so u runs
             from the inner edge to the outer and the band texture lands the
             way a ring is actually built. */
          const pa = geo.getAttribute('position');
          const uv = geo.getAttribute('uv');
          for (let i = 0; i < pa.count; i++) {
            const rad = Math.hypot(pa.getX(i), pa.getY(i));
            uv.setXY(i, (rad - inner) / (outer - inner || 1), 0.5);
          }
          uv.needsUpdate = true;

          const disc = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
            map: ringTexture(r, tint),
            side: THREE.DoubleSide, transparent: true,
            opacity: ringOpacity(r, n.raw.rings), depthWrite: false
          }));
          // RingGeometry is built in the XY plane; the equator is XZ.
          disc.rotation.x = Math.PI / 2;
          disc.renderOrder = 1;
          entry.rings.add(disc);
        });
        if (entry.rings.children.length) {
          entry.rings.rotation.z = n.tilt || 0;
          scene.add(entry.rings);
        } else {
          entry.rings = null;
        }
      }

      meshes.push(entry);
    });
    lenses = meshes.filter((m) => m.lens);

    buildPips();
    frame();
    draw(0);
  }

  /** Put the camera where the whole system fits. */
  function frame() {
    const span = ORBIT_OUT * 1.25;
    cam3.position.set(span * 0.22, span * 0.46, span * 0.78);
    // Relative to the system, not an absolute figure: adaptClip() takes over
    // from here anyway, but a hardcoded 0.05 is only ever right for one scale.
    cam3.near = span * 0.0004; cam3.far = span * 40; cam3.updateProjectionMatrix();
    cam2.position.set(0, span * 3, 0);
    cam2.far = span * 40;
    controls.target.set(0, 0, 0);
    resize();
    controls.update();
  }

  function resize() {
    if (!renderer || !isOpen()) return;
    const r = canvas.parentNode.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    renderer.setSize(w, h, false);
    cam3.aspect = w / h;
    cam3.updateProjectionMatrix();
    const half = ORBIT_OUT * 1.12, aspect = w / h;
    cam2.left = -half * aspect; cam2.right = half * aspect;
    cam2.top = half; cam2.bottom = -half;
    cam2.updateProjectionMatrix();
  }

  /* ── the clock ────────────────────────────────────────────────────────── */

  function gameDate() {
    const t = new Date(model.epoch.getTime() + simDays * 86400000);
    const d = new Date(t);
    d.setUTCFullYear(d.getUTCFullYear() + GAME_YEAR_OFFSET);
    return d.toISOString().slice(0, 16).replace('T', '  ');
  }

  function setPlaying(on) {
    playing = on;
    const b = panel.querySelector('#orr-play');
    b.innerHTML = on ? '&#10074;&#10074;' : '&#9658;';
    b.title = on ? 'Pause' : 'Play';
    b.classList.toggle('paused', !on);
  }

  /* How fast is still worth watching.

     Past a point the clock is not fast, it is undersampled. At a century a
     second Mercury turns seven times between frames: it stops moving and
     starts strobing, and no amount of care in the geometry can help, because
     the samples simply are not there. The ceiling belongs to the system
     rather than being a constant — it comes from the shortest year among the
     bodies orbiting the star, at roughly four frames per orbit at 60fps.

     Moons are deliberately left out of that. They are sub-pixel until you are
     at their planet, and by the time you are, you will have slowed down. */
  function usefulRate() {
    const years = model.star.children.map((n) => n.P).filter((p) => p > 0);
    return years.length ? Math.min(...years) * 15 : Infinity;
  }

  function limitRates() {
    const cap = usefulRate();
    const ok = [];
    LADDER.forEach((r, i) => { if (r.days <= cap) ok.push(i); });
    if (ok.length) { rateLo = ok[0]; rateHi = ok[ok.length - 1]; }
    setRate(rateIx);
  }

  function setRate(ix) {
    rateIx = Math.max(rateLo, Math.min(rateHi, ix));
    const r = LADDER[rateIx];
    panel.querySelector('#orr-rate').textContent =
      (r.dir < 0 && r.days > 1 / 86400 ? '− ' : '') + r.label;
    const slower = panel.querySelector('#orr-slower');
    const faster = panel.querySelector('#orr-faster');
    slower.disabled = rateIx === rateLo;
    faster.disabled = rateIx === rateHi;
    faster.title = faster.disabled
      ? 'As fast as this system reads — beyond this its inner bodies skip whole orbits between frames'
      : 'Faster';
  }

  function setMode(on3d) {
    if (mode3d === on3d) return;
    mode3d = on3d;
    panel.querySelector('#orr-3d').classList.toggle('on', on3d);
    panel.querySelector('#orr-2d').classList.toggle('on', !on3d);
    panel.querySelector('#orr-3d').setAttribute('aria-pressed', String(on3d));
    panel.querySelector('#orr-2d').setAttribute('aria-pressed', String(!on3d));
    makeControls();
    frame();
  }

  function setLabels(on) {
    showLabels = on;
    keep('labels', on ? '1' : '0');
    const b = panel.querySelector('#orr-labl');
    b.classList.toggle('on', on);
    b.querySelector('b').textContent = on ? 'on' : 'off';
    panel.querySelector('#orr-labels').classList.toggle('hide', !on);
  }

  function setFollow(on) {
    following = on;
    keep('follow', on ? '1' : '0');
    const b = panel.querySelector('#orr-follow');
    b.classList.toggle('on', on);
    b.querySelector('b').textContent = on ? 'on' : 'off';
  }

  function setOrbits(mode) {
    orbitMode = mode;
    keep('orbits', mode);
    const b = panel.querySelector('#orr-orbits');
    b.querySelector('b').textContent = ORBIT_LABEL[mode];
    b.classList.toggle('on', mode !== 2);
    meshes.forEach((m) => {
      if (!m.line) return;
      const moon = m.node.parent && m.node.parent !== model.star;
      m.line.visible = mode === 0 || (mode === 1 && !moon);
    });
  }


  function setAmbient(pct) {
    ambientPct = pct;
    keep('ambient', pct);
    panel.querySelector('#orr-amb').value = pct;
    // 0 leaves night sides genuinely black, which is honest but loses half of
    // every body; the top of the range is flat-lit and loses the terminator.
    if (ambient) ambient.intensity = 0.15 + (pct / 100) * 3.1;
  }

  function setGlow(pct) {
    glowPct = pct;
    keep('glow', pct);
    panel.querySelector('#orr-glow').value = pct;
    meshes.forEach((m) => {
      if (!m.glow) return;
      m.glow.material.opacity = (pct / 100) * 1.05;
      m.glow.visible = pct > 0;
    });
  }

  /* Three skies, in the order the button steps through them. Deep space is
     first because it is the default and the one most systems are read
     against. */
  const SKIES = [
    ['stars', 'Deep space'],
    ['galaxy', 'Galactic'],
    ['none', 'Empty']
  ];

  function setSky(mode) {
    if (!SKIES.some((k) => k[0] === mode)) mode = 'stars';
    skyMode = mode;
    keep('sky', mode);
    const el = panel.querySelector('#orr-sky');
    el.classList.toggle('on', mode !== 'none');
    el.querySelector('b').textContent = SKIES.filter((k) => k[0] === mode)[0][1];
    /* The one fact this control can tell a reader that nothing else here
       does: where the galaxy's heart is from this system. It was a line of
       prose in the drawer; on a bar it is what the button says when you rest
       on it, which is also where a reader looks for the other two options. */
    el.title = 'Deep space, Galactic or Empty' + (coreNote ? ' — ' + coreNote : '');
    buildSky();
  }

  /* Hand the current sky to whatever is bending it.

     buildScene runs before the sky is chosen, so the lenses it made are
     holding whatever was current then; and with the sky switched off there is
     nothing behind a hole to bend, which the lens is told rather than left to
     guess at. */
  function syncLenses() {
    lenses.forEach((m) => {
      m.lens.material.uniforms.uSky.value = lensSky ? lensSky.texture : noSky();
      m.lens.material.uniforms.uHasSky.value = lensSky ? 1 : 0;
    });
  }

  /* The sky, rendered once into one image.

     Clouds first, over the whole sphere from a shader that works on the
     direction rather than on the image's own axes — which is what makes it
     seamless at the wrap and at the poles. Then the stars into the same
     image, flattened to longitude and latitude.

     That image is then two things at once: the backdrop the scene is drawn
     against, and the sky a black hole bends. One image, so the lens can never
     show a sky the reader is not looking at. */
  /* How big that image is.

     The nebula shader already carries detail down to about two degrees — its
     ridged wisps are computed at nine times the base frequency — and at 2048
     across a pixel was a fifth of a degree, so those wisps landed on ten
     pixels each and arrived as mush. Doubling the image resolves detail that
     was already being computed, and halves the width of a baked star into
     the bargain. Past 4096 the picture stops improving as fast as the memory
     grows: this is eight megapixels, about 33 MB of texture, which is a fair
     price for the one image the entire view is drawn against.

     Asked of the driver rather than assumed, so a device that cannot hold it
     gets a smaller sky instead of no sky. */
  function skySize() {
    const w = Math.min(4096, renderer.capabilities.maxTextureSize || 2048);
    return { w, h: Math.round(w / 2) };
  }

  function bakeSky(coords, mode, geo) {
    const size = skySize();
    const rt = new THREE.WebGLRenderTarget(size.w, size.h, { depthBuffer: false });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    rt.texture.mapping = THREE.EquirectangularReflectionMapping;
    rt.texture.wrapS = THREE.RepeatWrapping;
    rt.texture.wrapT = THREE.ClampToEdgeWrapping;
    /* No mipmaps. Longitude wraps, so the hardware's own derivative of u
       jumps a whole texture at the seam and picks the coarsest mip — a grey
       arc drawn across the lens. The blur a stretched ray needs is done in
       the lens shader instead, along the axis it is actually stretched on. */
    rt.texture.generateMipmaps = false;
    rt.texture.minFilter = rt.texture.magFilter = THREE.LinearFilter;

    const core = new THREE.Vector3(
      CORE.x - coords.x, CORE.y - coords.y, -(CORE.z - coords.z)).normalize();
    const clouds = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: {
        // Seeded from where the system is, so a sky is stable for a system
        // and different between systems, in both modes.
        uSeed: { value: new THREE.Vector3(
          (coords.x % 512) * 0.031, (coords.y % 512) * 0.037, (coords.z % 512) * 0.029) },
        uCore: { value: core },
        uBand: { value: mode === 'galaxy' ? 1 : 0 },
        uGlow: { value: mode === 'galaxy' ? 1 : 0 }
      },
      vertexShader: NEBULA_VERT, fragmentShader: NEBULA_FRAG,
      depthTest: false, depthWrite: false
    }));
    clouds.renderOrder = -1;
    clouds.frustumCulled = false;

    const stars = new THREE.Points(geo, new THREE.ShaderMaterial({
      /* A couple of texels, and deliberately in texels rather than degrees:
         holding the angle would have kept the same soft halo the smaller
         image gave, which is the blur the bigger one exists to remove. The
         star is still there under the crisp point drawn on top of it — it is
         half as wide, which is what doubling the image buys. */
      uniforms: { uScale: { value: 1.35 } },
      vertexShader: STARS_BAKE_VERT, fragmentShader: STARS_FRAG,
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false
    }));
    stars.frustumCulled = false;

    const bench = new THREE.Scene();
    bench.add(clouds);
    bench.add(stars);
    const flat = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);

    const was = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.render(bench, flat);
    renderer.setRenderTarget(was);

    clouds.geometry.dispose();
    clouds.material.dispose();
    stars.material.dispose();      // the geometry belongs to the on-screen sky
    return rt;
  }

  function buildSky() {
    if (sky) {
      scene.remove(sky);
      sky.geometry.dispose();
      sky.material.dispose();
      sky = null;
    }
    if (lensSky) { lensSky.dispose(); lensSky = null; }
    scene.background = null;

    if (skyMode === 'none' || !model) { syncLenses(); return; }
    const coords = (model.sys && model.sys.coords) || { x: 0, y: 0, z: 0 };
    /* Six thousand is what a person sees from a dark site with their own
       eyes, which is the wrong target: nobody is standing in a field here,
       they are looking through a canopy at a sky the game draws deep. Twice
       that reads as the long exposure it is, and the magnitude curve above
       keeps the extra ones faint. The galactic sky carries a band as well and
       wants more again to build it out of. */
    const d = starField(coords, skyMode, skyMode === 'galaxy' ? 18000 : 12000);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
    geo.setAttribute('tint', new THREE.BufferAttribute(d.col, 3));
    geo.setAttribute('mag', new THREE.BufferAttribute(d.mag, 1));
    sky = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: { uPx: { value: renderer.getPixelRatio() } },
      vertexShader: STARS_SCREEN_VERT, fragmentShader: STARS_FRAG,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
    }));
    /* Directions, not places: the points sit on a unit sphere and the whole
       thing is scaled out and carried with the camera, so the sky never gets
       closer however far in you fly. */
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    scene.add(sky);

    lensSky = bakeSky(coords, skyMode, geo);
    scene.background = lensSky.texture;
    syncLenses();
  }

  function setScale(isTrue) {
    if (trueDistance === isTrue) return;
    trueDistance = isTrue;
    panel.querySelector('#orr-spread').classList.toggle('on', !isTrue);
    panel.querySelector('#orr-true').classList.toggle('on', isTrue);
    buildScene();
  }

  /* ── per frame ────────────────────────────────────────────────────────── */

  /* The clip planes follow the zoom.

     Fixed, near sat at 0.05 units — which at true distance is a third of an
     AU in Sol, so anything you tried to get close to was clipped out of the
     scene before it could grow. Bodies vanished as you zoomed in instead of
     filling the view, and so did their dots, because a point behind the near
     plane is not drawn either. Orthographic has no perspective divide, so it
     never had the problem and does not need the fix. */
  function adaptClip() {
    if (!mode3d) return;
    const d = Math.max(cam3.position.distanceTo(controls.target), 1e-7);
    /* Purely proportional. A floor here is the same mistake as the fixed
       plane it replaced, just smaller: for a body whose framing distance is
       itself around a millionth of a unit — a small moon at true scale — an
       absolute 1e-6 would swallow most of the gap to the camera and clip the
       thing you came to look at. d is already floored, so this cannot be 0.

       Near still has to follow the camera even with a logarithmic depth
       buffer: that fixes precision across the range, not clipping. Anything
       closer than near is still cut away. Far can be generous now, though,
       which is what keeps the rest of the system drawn while you are down
       among the moons. */
    const near = d * 0.002;
    // Only when it has really moved: updateProjectionMatrix every frame for a
    // rounding difference is work for nothing.
    if (Math.abs(cam3.near - near) > near * 0.1) {
      cam3.near = near;
      cam3.far = Math.max(d * 500, ORBIT_OUT * 40);
      cam3.updateProjectionMatrix();
    }
  }

  function draw(dtSeconds) {
    if (!model) return;
    if (playing && dtSeconds) {
      const r = LADDER[rateIx];
      simDays += r.days * r.dir * dtSeconds;
    }

    // Parents before children, so a moon can read its planet's fresh position.
    meshes.forEach((m) => { m.node._done = false; });
    meshes.forEach((m) => place(m.node));

    meshes.forEach((m) => {
      const n = m.node;
      if (m.mesh) {
        m.mesh.position.copy(n._pos);
        if (n.spin) {
          m.mesh.rotation.y = (simDays / n.spin) * Math.PI * 2;
          m.mesh.rotation.z = n.tilt || 0;
        }
      }
      if (m.line) m.line.position.copy(n.parent ? n.parent._pos : ORIGIN);
      if (m.rings) m.rings.position.copy(n._pos);
      // Real seconds, not simulated ones: a star's surface should not strobe
      // because the orbits were asked to run at a year a second.
      if (m.mesh && m.mesh.material.uniforms && m.mesh.material.uniforms.uTime) {
        m.mesh.material.uniforms.uTime.value = wallClock;
      }
    });
    movePips();

    /* Following means travelling with the body, not just aiming at it.

       Moving the target alone leaves the camera where it was, so the offset
       between them grows every frame. Zoomed out that reads as a gentle
       drift; at true scale it is fatal — Mercury covers its own framing
       distance a hundred and forty times a second there, so it was gone
       before the first frame finished and you were left looking at where it
       had been. Both ends move by the same step, which also leaves whatever
       angle and distance the reader had chosen exactly as they left it. */
    if (following && selected && selected._pos) {
      step.copy(selected._pos).sub(controls.target);
      controls.target.add(step);
      (mode3d ? cam3 : cam2).position.add(step);
    }

    drawLabels();
    panel.querySelector('#orr-date').textContent = gameDate();

    /* The sky is direction only, so it rides with the camera and is scaled to
       sit just inside the far plane — near enough to draw, far enough that no
       amount of zoom brings it closer. */
    if (sky) {
      const cam = mode3d ? cam3 : cam2;
      sky.position.copy(cam.position);
      sky.scale.setScalar(Math.max(cam3.far * 0.35, ORBIT_OUT * 4));
    }

    controls.update();

    /* A lens is a billboard as well as a lens: it needs the camera's own axes
       to face, and where the camera sits relative to the hole to bend by.
       Updated after controls, so it is built against the camera this frame is
       about to be drawn with rather than the one before it. */
    if (lenses.length) {
      const cam = mode3d ? cam3 : cam2;
      cam.updateMatrixWorld();
      cam.matrixWorld.extractBasis(camX, camY, camZ);
      lenses.forEach((m) => {
        const u = m.lens.material.uniforms;
        u.uCenter.value.copy(m.node._pos);
        // The shader builds its own geometry, but the renderer sorts blended
        // objects by where the object says it is, so say where it is.
        m.lens.position.copy(m.node._pos);
        u.uRight.value.copy(camX);
        u.uUp.value.copy(camY);
        if (cam.isOrthographicCamera) {
          /* Parallel projection has no eye point: every ray runs down the view
             axis, so the apparent angle is zero at every impact parameter and
             what the lens shows is the sky from directly behind the hole. */
          u.uFwd.value.copy(camZ).negate();
          u.uD.value = 1e9;
        } else {
          u.uFwd.value.copy(m.node._pos).sub(cam.position);
          u.uD.value = u.uFwd.value.length() || 1;
          u.uFwd.value.divideScalar(u.uD.value);
        }
      });
    }

    adaptClip();
    renderer.render(scene, mode3d ? cam3 : cam2);
  }

  const ORIGIN = new THREE.Vector3();
  const step = new THREE.Vector3();

  function place(n) {
    if (n._done) return n._pos;
    n._done = true;
    n._pos = n._pos || new THREE.Vector3();
    if (!n.parent) return n._pos.set(0, 0, 0);
    positionAt(n, simDays, tmp);
    return n._pos.copy(place(n.parent)).add(tmp);
  }

  function animate(now) {
    if (!isOpen()) return;
    loop = requestAnimationFrame(animate);
    const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.1) : 0;
    lastFrame = now;
    wallClock += dt;
    draw(dt);
  }

  /* ── selection ────────────────────────────────────────────────────────── */

  function onPick(e) {
    const r = canvas.getBoundingClientRect();
    const p = new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1
    );
    const cam = mode3d ? cam3 : cam2;
    raycaster.setFromCamera(p, cam);

    /* The dots are constant on screen while the threshold is in world units,
       so it has to track how far out the camera is or picking gets easier as
       you zoom in and impossible as you zoom out. */
    const span = mode3d ? cam.position.distanceTo(controls.target)
                        : (cam.top - cam.bottom) / cam.zoom;
    raycaster.params.Points.threshold = span * 0.012;

    const dot = pips ? raycaster.intersectObject(pips, false) : [];
    if (dot.length) return select(pipNodes[dot[0].index]);

    const hits = raycaster.intersectObjects(
      meshes.filter((m) => m.mesh).map((m) => m.mesh), false);
    if (hits.length) select(hits[0].object.userData.node);
  }

  function select(node, retarget) {
    selected = node;
    if (retarget !== false) focusOn(node);
    panel.querySelectorAll('.orr-row').forEach((el) => {
      el.classList.toggle('on', +el.dataset.id === node.id);
    });
    const row = panel.querySelector('.orr-row.on');
    if (row) row.scrollIntoView({ block: 'nearest' });
    panel.querySelectorAll('.orr-spine .pip').forEach((el) => {
      el.classList.toggle('on', +el.dataset.id === node.id);
    });
    updateFacts();
  }

  /* Pull the camera to a distance that suits what was picked: far enough out
     to see a planet's whole moon system, close enough that a bare rock is not
     a speck. The direction it is viewed from is left alone — that is the
     reader's, not ours. */
  function focusOn(n) {
    if (!n._pos) place(n);
    /* Framed against its own size, with no floor.

       The floor used to be 15 units, which at true scale is five hundred
       thousand times further out than Mercury is wide — so selecting a body
       took you nowhere near it, and scrolling could not get you there either:
       the dolly is multiplicative, and 175 units down to Mercury is a hundred
       and sixty ticks. Twelve times a body's own radius puts it about ten
       degrees across: big enough to look at, with some sky left around it. */
    const want = n === model.star ? ORBIT_OUT * 1.5
      : n.children.some((c) => c.a > 0) ? Math.max(...n.children.map((c) => c.a || 0)) * 4.5
      : n.drawR * 12;
    const cam = mode3d ? cam3 : cam2;
    if (mode3d) {
      const dir = cam.position.clone().sub(controls.target);
      if (dir.lengthSq() < 1e-6) dir.set(0.3, 0.5, 0.8);
      cam.position.copy(n._pos).add(dir.setLength(want));
    } else {
      cam.zoom = Math.max(0.35, (ORBIT_OUT * 1.12) / want);
      cam.updateProjectionMatrix();
    }
    controls.target.copy(n._pos);
    controls.update();
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function num(v, dp) { return v.toFixed(dp).replace(/\.?0+$/, '') || '0'; }
  /** "1 year", not "1 years" — Testholm 1 orbits in exactly one. */
  function qty(v, dp, unit) {
    const t = num(v, dp);
    return t + ' ' + unit + (t === '1' ? '' : 's');
  }

  /* Everything the dump holds about the selected body.

     It carries a great deal more than a name and a radius — atmospheres by
     gas, crusts by rock and metal, the surface materials you would actually
     land for, rings, ring reserves, the mapped signal counts, the stations.
     Showing four numbers and discarding the rest was throwing away the reason
     to open this at all.

     Sections appear only when the body has them, so a bare iceball stays
     short and Mercury runs long. Proportions are drawn as bars because
     "Iron 23.5%" beside "Nickel 17.8%" is a comparison, and a column of
     numerals makes the reader do it themselves. */

  const PCT = (v) => (v >= 10 ? v.toFixed(1) : v.toFixed(2)).replace(/\.?0+$/, '') + '%';

  function bars(obj, tint) {
    const rows = Object.entries(obj || {})
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);
    if (!rows.length) return '';
    const top = rows[0][1];
    return '<div class="orr-bars">' + rows.map(([k, v]) =>
      '<div class="orr-bar"><span class="k">' + esc(k) + '</span>' +
      '<span class="t"><i style="width:' + Math.max(2, (v / top) * 100) + '%' +
        (tint ? ';background:' + tint : '') + '"></i></span>' +
      '<span class="v">' + PCT(v) + '</span></div>').join('') + '</div>';
  }

  function sect(title, body) {
    return body ? '<div class="orr-sec"><h3>' + title + '</h3>' + body + '</div>' : '';
  }

  function table(rows) {
    const live = rows.filter(([, v]) =>
      v !== '' && v !== 0 && v !== null && v !== undefined && v !== false);
    return live.length ? '<dl>' + live.map(([k, v]) =>
      '<div><dt>' + k + '</dt><dd>' + esc(String(v)) + '</dd></div>').join('') + '</dl>' : '';
  }

  /* The four numbers you actually decide on, set the way the system card in
     the galaxy map sets them: label above in condensed caps, the figure large
     and tabular, the unit small and dim beside it. A column of label-and-value
     rows makes you read; this you can scan. */
  function measures(cells) {
    const live = cells.filter((c) => c && c[1]);
    if (!live.length) return '';
    return '<div class="orr-meas">' + live.map(([k, v, u]) =>
      '<div><dt>' + k + '</dt><dd>' + esc(String(v)) +
      (u ? '<em>' + u + '</em>' : '') + '</dd></div>').join('') + '</div>';
  }

  /* The services worth knowing before you fly. Walz Depot lists twenty-six of
     them; naming all twenty-six helps nobody, and these four are the ones that
     decide whether the trip is worth making. */
  const KEY_SERVICES = ['Market', 'Outfitting', 'Shipyard', 'Repair', 'Refuel'];

  function serviceChips(st) {
    const have = st.services || [];
    if (!have.length) return '';
    const shown = KEY_SERVICES.filter((k) => have.includes(k));
    const rest = have.length - shown.length;
    return '<div class="orr-svc">' +
      shown.map((k) => '<i>' + k + '</i>').join('') +
      (rest > 0 ? '<u>+' + rest + ' more</u>' : '') + '</div>';
  }

  /* Out to the wider tooling.

     Spansh keys on the market id, which is the id the dump carries, so that is
     an exact link to this station. Inara numbers stations itself and that
     number is not in the dump, so the honest offer is its search — which does
     land on the station, but it is a search and the label says so. */
  function stationLinks(st, systemName) {
    const out = [];
    if (st.id) {
      out.push('<a href="https://spansh.co.uk/station/' + encodeURIComponent(st.id) +
        '" target="_blank" rel="noopener">Spansh <span>&#8599;</span></a>');
    }
    out.push('<a href="https://inara.cz/elite/search/?search=' +
      encodeURIComponent(st.name + ' ' + systemName) +
      '" target="_blank" rel="noopener" title="Inara numbers its own stations, so this searches for it by name">Find on Inara <span>&#8599;</span></a>');
    return '<div class="orr-links">' + out.join('') + '</div>';
  }

  function stationCard(st, systemName) {
    const pads = st.landingPads || {};
    const big = pads.large ? 'L' : pads.medium ? 'M' : pads.small ? 'S' : '';
    const meta = [
      st.type,
      st.primaryEconomy,
      typeof st.distanceToArrival === 'number'
        ? Math.round(st.distanceToArrival).toLocaleString() + ' Ls' : ''
    ].filter(Boolean).join(' · ');
    return '<div class="orr-stn">' +
      '<div class="orr-stn-h"><b>' + esc(st.name) + '</b>' +
        (big ? '<i class="pad" title="Largest landing pad">' + big + '</i>' : '') + '</div>' +
      (meta ? '<div class="orr-stn-m">' + esc(meta) + '</div>' : '') +
      serviceChips(st) +
      stationLinks(st, systemName) +
    '</div>';
  }

  const chip = (on, label, kind) =>
    on ? '<span class="orr-chip ' + (kind || '') + '">' + label + '</span>' : '';

  /* Signal keys are game tokens and come in more than one shape:
     "$SAA_SignalType_Human;" from the surface scanner, and bare ones like
     "$PLANETARYMININGLOCATION_NAME" from elsewhere. Neither is something to
     put in front of a reader. The few that are worth naming properly are
     named; anything else is stripped back to words rather than shown raw. */
  const SIGNAL_NAMES = {
    biological: 'Biological', geological: 'Geological', guardian: 'Guardian',
    human: 'Human', thargoid: 'Thargoid', other: 'Other',
    planetarymininglocation: 'Mining location', xenological: 'Xenological'
  };

  function signalName(k) {
    const bare = String(k)
      .replace(/^\$?SAA_SignalType_/i, '')
      .replace(/^\$/, '')
      .replace(/;$/, '')
      .replace(/_NAME$/i, '');
    const known = SIGNAL_NAMES[bare.toLowerCase().replace(/_/g, '')];
    if (known) return known;
    const words = bare.replace(/_/g, ' ').toLowerCase().trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  /* Genus tokens name a genus the way the game's code does, not the way the
     codex prints it: "$Codex_Ent_Shrubs_Genus_Name;" is Frutexa on every
     page a commander has ever read. The ones that differ are named here; the
     rest are already themselves and fall through. */
  const GENUS_NAMES = {
    aleoids: 'Aleoida', bacterial: 'Bacterium', brancae: 'Brain Tree',
    cactoid: 'Cactoida', clypeus: 'Clypeus', conchas: 'Concha',
    cone: 'Bark Mound', electricae: 'Electricae', fonticulus: 'Fonticulua',
    fumerolas: 'Fumerola', fungoids: 'Fungoida', ground_struct_ice: 'Crystalline Shard',
    osseus: 'Osseus', recepta: 'Recepta', shrubs: 'Frutexa', sphere: 'Anemone',
    stratum: 'Stratum', thargoid_barnacle: 'Thargoid Barnacle',
    tube: 'Sinuous Tuber', tubus: 'Tubus', tussocks: 'Tussock',
    vents: 'Amphora Plant'
  };

  function genusName(k) {
    const bare = String(k)
      .replace(/^\$?Codex_Ent_/i, '')
      .replace(/_Genus_Name;?$/i, '')
      .replace(/_Name;?$/i, '')
      .replace(/;$/, '');
    return GENUS_NAMES[bare.toLowerCase()] ||
      bare.replace(/_/g, ' ').replace(/(^|\s)\w/g, (c) => c.toUpperCase());
  }

  /* Which kind of signal a body carries, for the marks in the list on the
     left. Only the four worth crossing a system for. */
  const SIGNAL_KINDS = [
    ['bio', 'biological', 'Biological'],
    ['geo', 'geological', 'Geological'],
    ['gua', 'guardian', 'Guardian'],
    ['thg', 'thargoid', 'Thargoid'],
    ['hum', 'human', 'Human']
  ];

  function signalKinds(b) {
    const counts = (b.signals && b.signals.signals) || {};
    const keys = Object.keys(counts).map((k) => signalName(k).toLowerCase());
    return SIGNAL_KINDS.filter(([, key]) => keys.indexOf(key) > -1);
  }

  /* What is actually down there, rather than how many pings came back.

     The dump carries both, and until now only the counts were shown. "Guardian
     1" is the fact that something is there; "Guardian Codex, Guardian Relic
     Tower" is the reason to fly. Genuses the scanner saw but nobody has
     identified are said to be exactly that, because a commander reading this
     is deciding whether the trip is worth making and an unidentified genus is
     the strongest reason there is. */
  function finds(title, rows, kind) {
    if (!rows.length) return '';
    return '<div class="orr-sigs"><h4>' + title + '</h4>' + rows.map((r) =>
      '<div class="orr-sig' + (r.dim ? ' dim' : '') + '">' +
      '<i class="' + kind + '"></i><span>' + esc(r.name) + '</span>' +
      (r.note ? '<em>' + esc(r.note) + '</em>' : '') + '</div>').join('') + '</div>';
  }

  function signalSection(b) {
    const s = b.signals || {};
    const counts = s.signals || {};
    const named = (a) => (a || []).filter(Boolean);
    const bio = named(s.biology), geo = named(s.geology), gua = named(s.guardian);
    if (!Object.keys(counts).length && !bio.length && !geo.length && !gua.length) return '';

    let h = table(Object.entries(counts).map(([k, v]) => [signalName(k), String(v)]));

    /* A genus with no species named against it has been scanned from orbit
       and never landed on. Matching is by name because that is the only join
       the dump gives: "Bacterium Alcyoneum - Teal" carries its own genus. */
    const seen = named(s.genuses).map(genusName);
    const unknown = seen.filter((g) =>
      !bio.some((sp) => sp.toLowerCase().indexOf(g.toLowerCase()) > -1));

    h += finds('Biology', bio.map((name) => ({ name: name.replace(/\s*-\s*/, ' — ') }))
      .concat(unknown.map((name) => ({ name, note: 'not identified', dim: true }))), 'bio');
    h += finds('Geology', geo.map((name) => ({ name })), 'geo');
    h += finds('Guardian', gua.map((name) => ({ name })), 'gua');

    if (gua.length) {
      h += '<div class="orr-links"><a href="https://ruins.canonn.tech/" ' +
        'target="_blank" rel="noopener" title="Bifrost, Canonn\u2019s Guardian site survey">' +
        'Bifrost <span>&#8599;</span></a></div>';
    }

    /* Which star is feeding the biology. Canonn solves this from the system's
       own geometry — the dump says so — and it is the fact that decides
       whether a genus can be here at all. */
    const lit = s.influencingStar;
    if (lit && lit.name) {
      h += '<div class="orr-note-i">Lit by ' + esc(shortName(lit.name)) +
        (lit.subType ? ' &middot; ' + esc(lit.subType) : '') + '</div>';
    }
    return h;
  }

  const KM = (m) => Math.round(m / 1000).toLocaleString() + ' km';

  function updateFacts() {
    const n = selected, b = n.raw;
    const isStar = n.type === 'Star';
    let h = '';

    /* The disc is the body's own painted surface, the very canvas the sphere
       out in the view is wearing — not an icon standing in for it. It exists
       already, so showing it costs nothing and makes the thing you clicked and
       the panel about it visibly the same object. */
    const m = meshes.filter((x) => x.node === n)[0];
    const face = m && m.mesh && m.mesh.material.map && m.mesh.material.map.image;
    let disc = '';
    if (face && face.toDataURL) {
      disc = '<span class="orr-face" style="background-image:url(' +
        face.toDataURL() + ')"></span>';
    } else if (n.hole) {
      disc = '<span class="orr-face hole"></span>';
    } else if (isStar) {
      disc = '<span class="orr-face star" style="background:' +
        starColour(n).getStyle() + '"></span>';
    }

    h += '<div class="orr-f-h">' + disc + '<div class="orr-f-n"><b>' +
         esc(n.name) + '</b><span>' + esc(n.sub || n.type) + '</span></div></div>';

    const flags =
      chip(b.isLandable, 'Landable', 'good') +
      chip(b.terraformingState === 'Terraformed', 'Terraformed', 'good') +
      chip(b.terraformingState === 'Terraformable', 'Terraformable', 'good') +
      chip(b.rotationalPeriodTidallyLocked, 'Tidally locked') +
      chip(b.rings && b.rings.length, 'Ringed') +
      chip(b.reserveLevel, b.reserveLevel + ' reserves') +
      chip(n.spin < 0, 'Retrograde spin');
    if (flags) h += '<div class="orr-chips">' + flags + '</div>';

    /* A black hole answers different questions. Its surface temperature is
       zero and its absolute magnitude is 20 because there is no surface and no
       light, so neither is a measurement; what there is to know is how big the
       hole is, how big the black disc is, and how much mass is doing it. */
    h += measures(n.hole ? [
      ['Horizon', n.km && Math.round(n.km).toLocaleString(), 'km'],
      ['Shadow', n.km && Math.round(n.km * SHADOW).toLocaleString(), 'km'],
      ['Mass', b.solarMasses && Math.round(b.solarMasses).toLocaleString(), '&times; Sun'],
      ['Arrival', b.distanceToArrival && Math.round(b.distanceToArrival).toLocaleString(), 'Ls']
    ] : isStar ? [
      ['Class', [b.spectralClass, b.luminosity].filter(Boolean).join(' '), ''],
      ['Surface', b.surfaceTemperature && Math.round(b.surfaceTemperature).toLocaleString(), 'K'],
      ['Mass', b.solarMasses && num(b.solarMasses, 2), '&times; Sun'],
      ['Age', b.age && (b.age >= 1000 ? num(b.age / 1000, 1) : b.age.toLocaleString()),
        b.age >= 1000 ? 'bn yrs' : 'm yrs']
    ] : [
      ['Radius', n.km && Math.round(n.km).toLocaleString(), 'km'],
      ['Gravity', b.gravity && num(b.gravity, 2), 'g'],
      ['Arrival', b.distanceToArrival && Math.round(b.distanceToArrival).toLocaleString(), 'Ls'],
      ['Year', n.P && (n.P >= 365 ? num(n.P / 365.25, 2) : num(n.P, 1)),
        n.P >= 365 ? 'years' : 'days']
    ]);

    h += sect(n.hole ? 'Black hole' : isStar ? 'Star' : 'Body', table(n.hole ? [
      ['Class', [b.spectralClass, b.luminosity].filter(Boolean).join(' ')],
      ['Radius', b.solarRadius && num(b.solarRadius, 6) + ' × Sun'],
      // Where light orbits rather than escaping — 1.5 horizon radii.
      ['Photon sphere', n.km && Math.round(n.km * 1.5).toLocaleString() + ' km'],
      ['Age', b.age && (b.age >= 1000 ? num(b.age / 1000, 1) + ' bn yrs'
                                      : b.age.toLocaleString() + ' m yrs')]
    ] : isStar ? [
      ['Radius', b.solarRadius && num(b.solarRadius, 3) + ' × Sun'],
      ['Magnitude', b.absoluteMagnitude !== undefined && b.absoluteMagnitude !== null
        ? num(b.absoluteMagnitude, 2) : '']
    ] : [
      ['Mass', b.earthMasses && num(b.earthMasses, b.earthMasses < 1 ? 3 : 2) + ' × Earth'],
      ['Surface', b.surfaceTemperature && Math.round(b.surfaceTemperature) + ' K'],
      ['Pressure', b.surfacePressure ? num(b.surfacePressure, 3) + ' atm' : ''],
      ['Volcanism', b.volcanismType],
      ['Axial tilt', b.axialTilt ? num(Math.abs(b.axialTilt) * 180 / Math.PI, 1) + '°' : '']
    ]));

    h += sect('Orbit', table([
      ['Orbits', n.parent && n.parent.name],
      ['Semi-major axis', n.aAu && num(n.aAu, n.aAu < 0.1 ? 5 : 3) + ' AU'],
      ['Day', n.spin && (Math.abs(n.spin) >= 1 ? qty(Math.abs(n.spin), 2, 'day')
                                               : qty(Math.abs(n.spin) * 24, 1, 'hour'))],
      ['Eccentricity', n.e ? num(n.e, 4) : ''],
      ['Inclination', b.orbitalInclination ? num(b.orbitalInclination, 2) + '°' : ''],
      ['Arg. of periapsis', b.argOfPeriapsis ? num(b.argOfPeriapsis, 2) + '°' : ''],
      ['Ascending node', b.ascendingNode ? num(b.ascendingNode, 2) + '°' : '']
    ]));

    h += sect('Atmosphere',
      (b.atmosphereType ? table([['Type', b.atmosphereType]]) : '') +
      bars(b.atmosphereComposition, '#4C8FB5'));

    h += sect('Crust', bars(b.solidComposition, '#8C6F57'));

    // What you land for. Elite players plan whole expeditions off this list.
    h += sect('Surface materials', bars(b.materials, '#B9903F'));

    if (b.rings && b.rings.length) {
      h += sect('Rings', b.rings.map((r) =>
        '<div class="orr-item"><b>' + esc(r.name) + '</b>' +
        '<span>' + esc(r.type || '') + ' &middot; ' +
        KM(r.innerRadius) + ' to ' + KM(r.outerRadius) + '</span></div>').join(''));
    }
    if (b.belts && b.belts.length) {
      h += sect('Belts', b.belts.map((r) =>
        '<div class="orr-item"><b>' + esc(r.name) + '</b>' +
        '<span>' + esc(r.type || '') + ' &middot; ' +
        KM(r.innerRadius) + ' to ' + KM(r.outerRadius) + '</span></div>').join(''));
    }

    h += sect('Mapped signals', signalSection(b));

    const ports = (b.stations || []).filter((st) => st && st.name);
    if (ports.length) {
      h += sect(ports.length + ' station' + (ports.length > 1 ? 's' : ''),
        ports.slice().sort((x, y) =>
          (x.distanceToArrival || 0) - (y.distanceToArrival || 0))
          .map((st) => stationCard(st, model.name)).join(''));
    }

    if (n === model.star) {
      const loose = (model.ports || []).filter((p) => !p.on).map((p) => p.st);
      if (loose.length) {
        h += sect('Elsewhere in the system', loose.slice().sort((x, y) =>
          (x.distanceToArrival || 0) - (y.distanceToArrival || 0))
          .map((st) => stationCard(st, model.name)).join(''));
      }
    }

    panel.querySelector('#orr-facts').innerHTML = h;
    panel.querySelector('#orr-facts').scrollTop = 0;
  }

  /* Names over the view.

     Only the star, the things that orbit it directly, and whatever is
     selected: labelling all forty at once — every Kuiper object, every moon —
     is unreadable, and the list on the left is there for the rest. Plain DOM
     rather than sprites, so they stay crisp and never scale with the zoom. */
  let labels = [];
  const proj = new THREE.Vector3();

  function buildLabels() {
    const host = panel.querySelector('#orr-labels');
    host.innerHTML = '';
    labels = model.all
      .filter((n) => n.drawR > 0 && (n === model.star || n.parent === model.star))
      .map((n) => {
        const el = document.createElement('span');
        el.className = 'orr-label' + (n === model.star ? ' star' : '');
        el.textContent = shortName(n);
        host.appendChild(el);
        return { node: n, el };
      });
  }

  function drawLabels() {
    if (!labels.length || !showLabels) return;
    const cam = mode3d ? cam3 : cam2;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    labels.forEach(({ node, el }) => {
      proj.copy(node._pos).project(cam);
      const on = proj.z < 1 && Math.abs(proj.x) < 1.06 && Math.abs(proj.y) < 1.06;
      el.classList.toggle('off', !on);
      if (!on) return;
      el.classList.toggle('on', selected === node);
      el.style.transform = 'translate(' + Math.round((proj.x * 0.5 + 0.5) * w) + 'px,' +
                                          Math.round((-proj.y * 0.5 + 0.5) * h) + 'px)';
    });
  }

  /** "Col 173 Sector LB-W b31-0 A 2" is "A 2" once you know the system. */
  function shortName(n) {
    const full = typeof n === 'string' ? n : n.name;
    const sys = model.name + ' ';
    return full.indexOf(sys) === 0 ? full.slice(sys.length) : full;
  }

  const portsOn = (n) => (n.raw.stations || []).filter((x) => x && x.name).length;

  function renderList() {
    // Depth-first, so moons sit under the planet they belong to.
    const all = [];
    const walk = (n, depth) => {
      all.push({ n, depth });
      n.children.slice()
        .sort((a, b) => (a.aAu || 0) - (b.aAu || 0))
        .forEach((c) => walk(c, depth + 1));
    };
    walk(model.star, 0);

    /* Filtering keeps a match's parents, so a moon never appears orphaned
       under a planet that got filtered away — the indent would be a lie. */
    const term = (panel.querySelector('#orr-filter').value || '').trim().toLowerCase();
    let out = all;
    if (term) {
      const hit = (n) => (n.name + ' ' + n.sub).toLowerCase().includes(term);
      const keep = new Set();
      all.forEach(({ n }) => {
        if (!hit(n)) return;
        for (let p = n; p; p = p.parent) keep.add(p);
      });
      out = all.filter(({ n }) => keep.has(n));
    }

    const list = panel.querySelector('#orr-list');
    if (!out.length) {
      list.innerHTML = '<div class="orr-none">No body here matches “' + esc(term) + '”.</div>';
      return;
    }

    list.innerHTML = out.map(({ n, depth }) =>
      '<div class="orr-row" data-id="' + n.id + '" style="--depth:' + depth + '" ' +
      'role="button" tabindex="0" title="' + esc(n.name) + '">' +
      '<span class="dot" style="background:' +
        (n.type === 'Star' ? '#' + starColour(n).getHexString()
          : n.drawR ? '#' + new THREE.Color(tintOf(n.sub)).getHexString() : 'transparent') +
        (n.drawR ? '' : ';box-shadow:inset 0 0 0 1px var(--dimmer)') + '"></span>' +
      '<span class="nm">' + esc(shortName(n)) + '</span>' +
      signalKinds(n.raw).map(([cls, , label]) =>
        '<i class="sg ' + cls + '" title="' + label + ' signals"></i>').join('') +
      (portsOn(n) ? '<span class="pt" title="' + portsOn(n) + ' station' +
        (portsOn(n) > 1 ? 's' : '') + '">&#9670; ' + portsOn(n) + '</span>' : '') +
      '<span class="ct">' + (n.aAu ? num(n.aAu, n.aAu < 0.1 ? 3 : 2) : '') + '</span></div>'
    ).join('');
    if (selected) {
      const row = list.querySelector('.orr-row[data-id="' + selected.id + '"]');
      if (row) row.classList.add('on');
    }

    panel.querySelector('#orr-list').onclick = (e) => {
      const row = e.target.closest('.orr-row');
      if (!row) return;
      const node = model.all.find((n) => n.id === +row.dataset.id);
      if (node) select(node);
    };

    panel.querySelector('#orr-legend').innerHTML =
      '<b>' + model.all.filter((n) => n.drawR).length + '</b> bodies &middot; ' +
      'drag to orbit &middot; scroll to zoom &middot; click a body' +
      '<br><span class="dim">space pauses &middot; , and . change speed</span>';
  }

  /* ── open / close ─────────────────────────────────────────────────────── */

  function isOpen() { return panel && panel.classList.contains('open'); }

  async function open(name, id64) {
    if (!panel) build();
    panel.classList.add('open');
    document.body.classList.add('orrery-open');
    panel.querySelector('#orr-name').textContent = name;
    panel.querySelector('#orr-sub').textContent = '';
    panel.querySelector('#orr-msg').textContent = 'Reading the system dump…';
    panel.querySelector('#orr-msg').className = 'orr-msg';
    panel.classList.add('has-system');
    panel.querySelector('#orr-spine').innerHTML = '';

    // The galaxy map keeps its camera and its data; its animate() already
    // skips everything when the scene is switched off, so this costs nothing
    // while we are here and coming back is instant.
    if (window.scene) {
      galaxyWasVisible = window.scene.visible;
      window.scene.visible = false;
    }

    setRate(START_RATE);
    setPlaying(true);
    simDays = 0;
    lastFrame = 0;

    let sys;
    try {
      // The table is 293 bytes against a dump of a couple of hundred kilobytes,
      // and asking for both at once costs nothing over asking for the dump.
      [sys] = await Promise.all([fetchSystem(name, id64), spectralTable()]);
    } catch (err) {
      panel.querySelector('#orr-msg').className = 'orr-msg bad';
      panel.querySelector('#orr-msg').textContent =
        name + ' is not in Canonn’s system dump, so there is nothing to model yet.';
      return;
    }
    if (!isOpen()) return;                    // closed while we were fetching

    model = buildModel(sys);
    if (!model) {
      panel.querySelector('#orr-msg').className = 'orr-msg bad';
      panel.querySelector('#orr-msg').textContent = 'The dump has no bodies for ' + name + '.';
      return;
    }

    panel.querySelector('#orr-msg').className = 'orr-msg gone';
    panel.querySelector('#orr-sub').textContent =
      model.all.filter((n) => n.type === 'Planet').length + ' planets · ' +
      model.all.filter((n) => n.type === 'Star').length + ' star' +
      (model.all.filter((n) => n.type === 'Star').length > 1 ? 's' : '');

    limitRates();

    /* How far the galaxy's heart is from this system, and how far off its
       plane it sits. The sky control carries it, because that is the control
       the fact is about. */
    const bear = coreBearing((model.sys && model.sys.coords) || { x: 0, y: 0, z: 0 });
    coreNote = bear.ly < 1
      ? 'this is the galactic core'
      : 'Sagittarius A* is ' + bear.ly.toLocaleString() + ' ly away, ' +
        Math.abs(bear.tilt).toFixed(1) + '° ' + (bear.tilt >= 0 ? 'below' : 'above') +
        ' the plane (modelled, not catalogued)';

    // Everything out of here goes to the system, so it needs the system.
    panel.querySelector('#orr-signals').href =
      'https://signals.canonn.tech/?system=' + encodeURIComponent(model.name);

    setAmbient(recallNum('ambient', 30));
    setGlow(recallNum('glow', 60));
    setLabels(recallStr('labels', '1') === '1');
    setFollow(recallStr('follow', '1') === '1');

    buildScene();
    renderList();
    buildLabels();
    drawSpine();
    setOrbits(recallNum('orbits', 0));
    setSky(recallStr('sky', 'stars'));
    select(model.star);
    cancelAnimationFrame(loop);
    loop = requestAnimationFrame(animate);
  }

  function close() {
    if (!panel) return;
    cancelAnimationFrame(loop);
    loop = 0;
    // On its own page there is nowhere to go back to, so closing a system
    // returns to the search rather than leaving a blank screen.
    if (standalone) {
      model = null;
      panel.classList.remove('has-system');
      panel.querySelector('#orr-spine').innerHTML = '';
      panel.querySelector('#orr-name').textContent = '';
      panel.querySelector('#orr-sub').textContent = '';
      const u = new URL(location.href);
      u.searchParams.delete('system');
      history.replaceState(null, '', u);
      document.title = 'Canonn Orrery';
      panel.querySelector('#orr-q').focus();
      return;
    }
    panel.classList.remove('open');
    document.body.classList.remove('orrery-open');
    if (window.scene && galaxyWasVisible !== null) {
      window.scene.visible = galaxyWasVisible;
      galaxyWasVisible = null;
    }
  }

  /* The page, rather than the overlay. Same everything; what changes is that
     there is no map behind it, the search is in the header, and the system
     lives in the address bar so a link to one is a link to one. */
  function page() {
    standalone = true;
    if (!panel) build();
    panel.classList.add('open');
    document.body.classList.add('orrery-open');
    const wanted = new URLSearchParams(location.search).get('system');
    if (wanted) go(wanted);
    else panel.querySelector('#orr-q').focus();

    // Back and forward through the systems someone has looked at.
    window.addEventListener('popstate', () => {
      const n = new URLSearchParams(location.search).get('system');
      if (n && (!model || model.name !== n)) open(n);
    });
  }

  /* Automated-test hook, following the one ed3dmap.js already keeps: the
     suite binds to this rather than to the camera or the scene graph, so
     moving either does not invalidate the tests. Read-only. */
  function state() {
    const cam = mode3d ? cam3 : cam2;
    const sel = selected && selected._pos ? selected : null;
    return {
      system: model ? model.name : null,
      trueScale: trueDistance,
      selected: sel ? sel.name : null,
      // How far the camera is from what it is looking at, and from the body
      // itself — the two numbers that were wrong.
      toTarget: cam.position.distanceTo(controls.target),
      toSelected: sel ? cam.position.distanceTo(sel._pos) : null,
      selectedRadius: sel ? sel.drawR : null,
      near: cam3.near,
      bodies: model ? model.all.length : 0,
      logDepth: !!(renderer && renderer.capabilities.logarithmicDepthBuffer),
      sky: {
        mode: skyMode,
        points: sky ? sky.geometry.getAttribute('position').count : 0,
        scale: sky ? sky.scale.x : 0,
        inScene: !!(sky && sky.parent),
        // The backdrop and the sky a black hole bends are meant to be the one
        // image, and this is where that is either true or it is not.
        baked: lensSky ? lensSky.width : 0,
        isBackdrop: !!(lensSky && scene.background === lensSky.texture)
      },
      /* Every black hole, in the terms its shader works in: the horizon it
         was given, the shadow that horizon draws, how far out the lens runs,
         and whether there is a sky behind it to bend. */
      holes: lenses.map((m) => {
        const u = m.lens.material.uniforms;
        const img = u.uSky.value && u.uSky.value.image;
        /* Where the shadow landed on screen and how wide it came out, from the
           same projection the renderer used. A claim about what a black hole
           looks like can only be settled in pixels, and this is what tells a
           test where to go and read them. */
        const buf = renderer.getSize(new THREE.Vector2())
          .multiplyScalar(renderer.getPixelRatio());
        cam.updateMatrixWorld();
        cam.matrixWorld.extractBasis(camX, camY, camZ);
        const mid = m.node._pos.clone().project(cam);
        const off = m.node._pos.clone().addScaledVector(camX, m.node.drawR).project(cam);
        return {
          screen: {
            x: (mid.x * 0.5 + 0.5) * buf.x,
            y: (0.5 - mid.y * 0.5) * buf.y,
            shadowPx: Math.abs(off.x - mid.x) * 0.5 * buf.x
          },
          name: m.node.name,
          horizonKm: m.node.km,
          shadow: m.node.drawR,
          horizon: u.uRs.value,
          lens: u.uSize.value,
          hasSky: u.uHasSky.value,
          skyWidth: img ? img.width : 0,
          // Which only means anything if it is the sky on screen as well.
          sameAsSky: !!(lensSky && u.uSky.value === lensSky.texture),
          toCamera: u.uD.value
        };
      }),
      ambient: ambientPct,
      glow: glowPct,
      // The star's own clock, in real seconds — deliberately not the orbit
      // clock, so its surface does not strobe when time is run fast.
      starTime: (() => {
        const m = model && meshes.filter((x) => x.node === model.star)[0];
        const u = m && m.mesh && m.mesh.material.uniforms;
        return u && u.uTime ? u.uTime.value : null;
      })(),
      /* The selected body's ring system, in that body's own radii — the units
         the dump does NOT give it in, which is where the factor of a thousand
         between metres and kilometres would show up. */
      rings: (() => {
        const m = sel && meshes.filter((x) => x.node === sel)[0];
        if (!m || !m.rings || !m.rings.children.length) return { count: 0 };
        const g = m.rings.children[0].geometry.parameters;
        return {
          count: m.rings.children.length,
          innerRadii: g.innerRadius / sel.drawR,
          outerRadii: g.outerRadius / sel.drawR,
          tilt: m.rings.rotation.z,
          // Driven by mass over area, so a faint halo ring and a heavy one do
          // not come out identical.
          opacity: m.rings.children[0].material.opacity,
          banded: !!m.rings.children[0].material.map
        };
      })(),
      rate: LADDER[rateIx].label,
      fastestRate: LADDER[rateHi].label,
      /* How far the worst-drawn orbit strays from the body riding on it, in
         that body's own radii. A polyline is a polygon, so it always sags
         below the true ellipse; what matters is whether the sag is bigger
         than the thing sitting on it. Under 1 means you cannot see it. */
      worstOrbitMiss: meshes.reduce((worst, m) => {
        const n = m.node;
        if (!m.line || !(n.drawR > 0) || !(n.a > 0)) return worst;
        const N = m.line.geometry.getAttribute('position').count - 1;
        return Math.max(worst, (n.a * (1 - Math.cos(Math.PI / N))) / n.drawR);
      }, 0)
    };
  }

  /* A fingerprint of each painted surface, so a test can prove a world wears
     the same face on a second visit rather than being re-rolled. Separate from
     state() and never called by anything else: it reads every body's canvas
     back off the GPU-bound image, which is far too expensive to sit in a
     function the tests poll. */
  function faces() {
    return meshes.filter((m) => m.mesh && m.mesh.material.map).map((m) => {
      const img = m.mesh.material.map.image;
      const d = img.getContext('2d', { willReadFrequently: true })
        .getImageData(0, 0, img.width, img.height).data;
      let h = 2166136261;
      for (let i = 0; i < d.length; i += 997) { h ^= d[i]; h = Math.imul(h, 16777619); }
      return m.node.name + ':' + (h >>> 0);
    });
  }

  /* One frame, read back as pixels.

     Alongside faces() and never called by the page itself. Some claims can
     only be settled in pixels — that a black hole draws as a dark disc with
     light gathered outside it is one, and it is exactly the claim that was
     silently false while it drew as a glowing ball. Reading the canvas back
     directly would mean preserveDrawingBuffer, which costs every reader on
     every frame for the sake of a test; this costs one extra render, only
     when something asks. */
  function pixels(x, y, w, h) {
    const size = renderer.getSize(new THREE.Vector2())
      .multiplyScalar(renderer.getPixelRatio());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y);
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    renderer.setRenderTarget(rt);
    renderer.render(scene, mode3d ? cam3 : cam2);
    const buf = new Uint8Array(w * h * 4);
    // GL counts rows from the bottom of the frame; a screen counts from the top.
    renderer.readRenderTargetPixels(rt, x, size.y - y - h, w, h, buf);
    renderer.setRenderTarget(null);
    rt.dispose();
    const out = new Array(w * h * 4);
    for (let r = 0; r < h; r++) {
      const src = (h - 1 - r) * w * 4;
      for (let i = 0; i < w * 4; i++) out[r * w * 4 + i] = buf[src + i];
    }
    return { w, h, data: out };
  }

  return { open, close, isOpen, page, state, faces, pixels };
})();

window.Orrery = Orrery;

/* The mechanics are exported alongside the view so they can be checked
   directly: an orbit that is solved rather than animated by eye is the whole
   claim this file makes, and it should be provable without a screenshot. */
export { Orrery, eccentricAnomaly, positionAt, buildModel, layout };
