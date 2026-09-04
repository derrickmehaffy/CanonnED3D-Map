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
   Not a photograph pasted behind the scene: a galaxy sampled, then looked at
   from where the system actually is.

   Points are drawn from a disc around Sagittarius A* — whose position is
   already in this repo, in data/milkyway-ed.json, alongside every region name
   the galaxy map labels — with an exponential falloff outward and a thin
   vertical spread, then projected onto the sky from the system's own
   coordinates. The band lands where it should and is densest toward the core,
   and it genuinely differs between systems: Sol sits 25,900 light years out
   and sees the galaxy edge-on and distant, Colonia is 22,000 ly nearer and
   does not.

   It is a model of a galaxy rather than a catalogue of its stars, and the
   readout on the control says so. */

const CORE = { x: 25, y: 0, z: 25900 };        // Sagittarius A*, from the map's own data

function galacticSky(coords, count) {
  const rnd = seeded('sky|' + coords.x + '|' + coords.y + '|' + coords.z);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const c = new THREE.Color();

  for (let i = 0; i < count; i++) {
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

    /* Nearer material reads brighter, which is what makes the core end of the
       band glow instead of the whole ring looking uniform. */
    const near = Math.min(1, 4200 / d);
    c.setHSL(0.09 + rnd() * 0.08, 0.18 + rnd() * 0.3, 0.26 + near * 0.55);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  return { pos, col };
}

/** No galaxy, just sky — an even scatter, still stable per system. */
function plainSky(coords, count) {
  const rnd = seeded('plain|' + coords.x + '|' + coords.y + '|' + coords.z);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    // Evenly over the sphere; acos-free form, so the poles do not bunch.
    const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, sr = Math.sqrt(1 - u * u);
    pos[i * 3] = sr * Math.cos(th);
    pos[i * 3 + 1] = u;
    pos[i * 3 + 2] = sr * Math.sin(th);
    const b = 0.3 + Math.pow(rnd(), 2.4) * 0.7;
    c.setHSL(0.08 + rnd() * 0.12, 0.22 * rnd(), b * 0.66);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  return { pos, col };
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
    if (trueDistance) return (n.km / AU_KM) * perAu;
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
      // typeahead is a prefix search, so only an exact name is this system.
      if (!row || row.name !== name) throw new Error('not in the dump');
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
      '  <button class="orr-tb" id="orr-link" title="Copy a link straight to this system">Copy link</button>',
      '  <button class="orr-x" id="orr-close" aria-label="Close">&times;</button>',
      '</div>',

      // The spine: every body on a log axis of its distance from where you
      // drop in. The orbit view shows AU from each parent, which is a
      // different question from "how far is the fly-out".
      '<div class="orr-spine" id="orr-spine"></div>',

      '<div class="orr-mid">',
      '  <aside class="orr-side orr-left">',
      '    <div class="orr-s-h">',
      '      <div class="orr-s-t">Bodies</div>',
      '      <input id="orr-filter" class="orr-filter" type="text" autocomplete="off"',
      '             spellcheck="false" placeholder="Filter" aria-label="Filter bodies">',
      '    </div>',
      '    <div class="orr-list" id="orr-list"></div>',
      '  </aside>',
      '  <div class="orr-stage"><canvas id="orr-canvas"></canvas>',
      '    <div class="orr-labels" id="orr-labels"></div>',
      '    <div class="orr-msg" id="orr-msg">Reading the system dump&#8230;</div>',
      '    <button class="orr-vbtn" id="orr-vopen" aria-expanded="false"',
      '            aria-controls="orr-drawer">View</button>',
      '    <div class="orr-drawer" id="orr-drawer" role="group" aria-label="View">',
      '      <div class="orr-d-h">View<button id="orr-vclose" aria-label="Close">&times;</button></div>',
      '      <div class="orr-d-s">',
      '        <h4>Projection</h4>',
      '        <div class="orr-seg">',
      '          <button id="orr-3d" class="on" aria-pressed="true">3D</button>',
      '          <button id="orr-2d" aria-pressed="false">2D</button>',
      '        </div>',
      '      </div>',
      '      <div class="orr-d-s">',
      '        <h4>Scale</h4>',
      '        <div class="orr-seg">',
      '          <button id="orr-spread" class="on" title="Orbits spread on a log scale, so the whole system is legible at once">Spread</button>',
      '          <button id="orr-true" title="Orbits and bodies both to scale. Pick a body to fly to it — at this scale nothing is visible from across the system">True scale</button>',
      '        </div>',
      '      </div>',
      '      <div class="orr-d-s">',
      '        <h4>Show</h4>',
      '        <button class="orr-opt" id="orr-orbits"><span>Orbit paths</span><b>all</b></button>',
      '        <button class="orr-opt on" id="orr-labl"><span>Names</span><b>on</b></button>',
      '        <button class="orr-opt on" id="orr-follow"><span>Follow selection</span><b>on</b></button>',
      '      </div>',
      '      <div class="orr-d-s">',
      '        <h4>Sky</h4>',
      '        <button class="orr-opt" id="orr-sky-galaxy"><span>Galactic</span><b></b></button>',
      '        <div class="orr-note" id="orr-corebear"></div>',
      '        <button class="orr-opt" id="orr-sky-stars"><span>Star field</span><b></b></button>',
      '        <button class="orr-opt on" id="orr-sky-none"><span>Empty</span><b></b></button>',
      '      </div>',
      '      <div class="orr-d-s">',
      '        <h4>Light</h4>',
      '        <label class="orr-sl"><span>Ambient</span>',
      '          <input id="orr-amb" type="range" min="0" max="100" value="30"></label>',
      '        <label class="orr-sl"><span>Star glow</span>',
      '          <input id="orr-glow" type="range" min="0" max="100" value="60"></label>',
      '      </div>',
      '      <button class="orr-d-reset" id="orr-reset">Frame the whole system</button>',
      '    </div>',
      '    <div class="orr-legend" id="orr-legend"></div>',
      '  </div>',
      '  <aside class="orr-side orr-right">',
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
    $('orr-vopen').onclick = () => openDrawer(!panel.classList.contains('view-open'));
    $('orr-vclose').onclick = () => openDrawer(false);
    ['galaxy', 'stars', 'none'].forEach((m) => {
      $('orr-sky-' + m).onclick = () => setSky(m);
    });
    $('orr-amb').addEventListener('input', (e) => setAmbient(+e.target.value));
    $('orr-glow').addEventListener('input', (e) => setGlow(+e.target.value));
    $('orr-follow').onclick = () => setFollow(!following);
    $('orr-reset').onclick = () => { if (model) { frame(); select(model.star, false); } };
    $('orr-orbits').onclick = () => setOrbits((orbitMode + 1) % 3);
    $('orr-link').onclick = copyLink;
    $('orr-filter').addEventListener('input', () => renderList());
    $('orr-empty').addEventListener('click', (e) => {
      const b = e.target.closest('[data-sys]');
      if (b) go(b.dataset.sys);
    });
    wireSearch();

    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', () => { resize(); drawSpine(); });
    canvas.addEventListener('pointerdown', onPick);
    initGL();
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
              (n.type === 'Star' ? '#' + starColour().getHexString()
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
      if (panel.classList.contains('view-open')) openDrawer(false); else close();
    }
    else if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
    else if (e.key === 'v' || e.key === 'V') {
      openDrawer(!panel.classList.contains('view-open'));
    }
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
      c.set(n.type === 'Star' ? starColour() : new THREE.Color(tintOf(n.sub)));
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
      if (m.line) { scene.remove(m.line); m.line.geometry.dispose(); m.line.material.dispose(); }
      if (m.rings) {
        scene.remove(m.rings);
        m.rings.children.forEach((d) => { d.geometry.dispose(); d.material.dispose(); });
      }
    });
    meshes = [];
  }

  function starColour() {
    const c = window.CanonnConsole && CanonnConsole.starColour;
    const cls = model.star.raw.spectralClass;
    const hex = c ? c(cls) : '';
    return new THREE.Color(hex || '#FFD9A0');
  }

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
        const mat = isStar
          // The star is its own light source, so it is not lit by one — it
          // makes its own, and churns while it does it.
          ? starMaterial(n, starTint)
          : new THREE.MeshLambertMaterial({ map: bodyTexture(n) });
        entry.mesh = new THREE.Mesh(geo, mat);
        entry.mesh.userData.node = n;
        scene.add(entry.mesh);

        if (isStar) {
          const glow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: glowTexture(), color: starTint, transparent: true, opacity: 0.85,
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

  function openDrawer(on) {
    panel.classList.toggle('view-open', on);
    panel.querySelector('#orr-vopen').setAttribute('aria-expanded', String(on));
    panel.querySelector('#orr-vopen').classList.toggle('on', on);
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

  function setSky(mode) {
    skyMode = mode;
    keep('sky', mode);
    // These are a choice of one, and the Show rows above state their value in
    // words rather than in colour; the sky rows do the same so the drawer
    // reads consistently and does not lean on colour alone.
    ['galaxy', 'stars', 'none'].forEach((m) => {
      const el = panel.querySelector('#orr-sky-' + m);
      el.classList.toggle('on', m === mode);
      el.querySelector('b').textContent = m === mode ? 'shown' : '';
    });
    buildSky();
  }

  function buildSky() {
    if (sky) {
      scene.remove(sky);
      sky.geometry.dispose();
      sky.material.dispose();
      sky = null;
    }
    if (skyMode === 'none' || !model) return;
    const coords = (model.sys && model.sys.coords) || { x: 0, y: 0, z: 0 };
    const n = skyMode === 'galaxy' ? 9000 : 2600;
    const d = skyMode === 'galaxy' ? galacticSky(coords, n) : plainSky(coords, n);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(d.col, 3));
    sky = new THREE.Points(geo, new THREE.PointsMaterial({
      size: skyMode === 'galaxy' ? 1.5 : 1.9,
      sizeAttenuation: false, vertexColors: true,
      transparent: true, opacity: 0.95, depthWrite: false
    }));
    /* Directions, not places: the points sit on a unit sphere and the whole
       thing is scaled out and carried with the camera, so the sky never gets
       closer however far in you fly. */
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    scene.add(sky);
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

  const chip = (on, label, kind) =>
    on ? '<span class="orr-chip ' + (kind || '') + '">' + label + '</span>' : '';

  /** "$SAA_SignalType_Human;" is a game token, not something to show a reader. */
  const signalName = (k) => String(k).replace(/^\$SAA_SignalType_/, '').replace(/;$/, '');

  const KM = (m) => Math.round(m / 1000).toLocaleString() + ' km';

  function updateFacts() {
    const n = selected, b = n.raw;
    const isStar = n.type === 'Star';
    let h = '';

    h += '<div class="orr-f-h"><b>' + esc(n.name) + '</b>' +
         '<span>' + esc(n.sub || n.type) + '</span></div>';

    const flags =
      chip(b.isLandable, 'Landable', 'good') +
      chip(b.terraformingState === 'Terraformed', 'Terraformed', 'good') +
      chip(b.terraformingState === 'Terraformable', 'Terraformable', 'good') +
      chip(b.rotationalPeriodTidallyLocked, 'Tidally locked') +
      chip(b.rings && b.rings.length, 'Ringed') +
      chip(b.reserveLevel, b.reserveLevel + ' reserves') +
      chip(n.spin < 0, 'Retrograde spin');
    if (flags) h += '<div class="orr-chips">' + flags + '</div>';

    h += sect(isStar ? 'Star' : 'Body', table(isStar ? [
      ['Class', [b.spectralClass, b.luminosity].filter(Boolean).join(' ')],
      ['Surface', b.surfaceTemperature && Math.round(b.surfaceTemperature).toLocaleString() + ' K'],
      ['Mass', b.solarMasses && num(b.solarMasses, 3) + ' × Sun'],
      ['Radius', b.solarRadius && num(b.solarRadius, 3) + ' × Sun'],
      ['Age', b.age && (b.age >= 1000 ? num(b.age / 1000, 1) + ' bn years'
                                      : b.age.toLocaleString() + ' m years')],
      ['Magnitude', b.absoluteMagnitude !== undefined && b.absoluteMagnitude !== null
        ? num(b.absoluteMagnitude, 2) : '']
    ] : [
      ['Radius', n.km && Math.round(n.km).toLocaleString() + ' km'],
      ['Mass', b.earthMasses && num(b.earthMasses, b.earthMasses < 1 ? 3 : 2) + ' × Earth'],
      ['Gravity', b.gravity && num(b.gravity, 2) + ' g'],
      ['Surface', b.surfaceTemperature && Math.round(b.surfaceTemperature) + ' K'],
      ['Pressure', b.surfacePressure ? num(b.surfacePressure, 3) + ' atm' : ''],
      ['Volcanism', b.volcanismType],
      ['Axial tilt', b.axialTilt ? num(Math.abs(b.axialTilt) * 180 / Math.PI, 1) + '°' : '']
    ]));

    h += sect('Orbit', table([
      ['Orbits', n.parent && n.parent.name],
      ['Arrival', b.distanceToArrival && Math.round(b.distanceToArrival).toLocaleString() + ' Ls'],
      ['Semi-major axis', n.aAu && num(n.aAu, n.aAu < 0.1 ? 5 : 3) + ' AU'],
      ['Year', n.P && (n.P >= 365 ? qty(n.P / 365.25, 2, 'year') : qty(n.P, 1, 'day'))],
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

    const sig = b.signals && b.signals.signals;
    if (sig && Object.keys(sig).length) {
      h += sect('Mapped signals', table(
        Object.entries(sig).map(([k, v]) => [signalName(k), String(v)])));
    }

    const ports = (b.stations || []).filter((st) => st && st.name);
    if (ports.length) {
      h += sect(ports.length + ' station' + (ports.length > 1 ? 's' : ''),
        ports.slice().sort((x, y) =>
          (x.distanceToArrival || 0) - (y.distanceToArrival || 0)).map((st) => {
          const pads = st.landingPads || {};
          const big = pads.large ? 'L' : pads.medium ? 'M' : pads.small ? 'S' : '';
          const line = [
            st.type,
            st.primaryEconomy,
            typeof st.distanceToArrival === 'number'
              ? Math.round(st.distanceToArrival).toLocaleString() + ' Ls' : ''
          ].filter(Boolean).join(' · ');
          return '<div class="orr-item">' +
            '<b>' + esc(st.name) +
              (big ? '<i class="pad" title="Largest landing pad">' + big + '</i>' : '') + '</b>' +
            (line ? '<span>' + esc(line) + '</span>' : '') + '</div>';
        }).join(''));
    }

    if (n === model.star) {
      const loose = (model.ports || []).filter((p) => !p.on).map((p) => p.st);
      if (loose.length) {
        h += sect('Elsewhere in the system', loose.slice().sort((x, y) =>
          (x.distanceToArrival || 0) - (y.distanceToArrival || 0)).map((st) =>
          '<div class="orr-item"><b>' + esc(st.name) + '</b><span>' +
          esc([st.type, typeof st.distanceToArrival === 'number'
            ? Math.round(st.distanceToArrival).toLocaleString() + ' Ls' : '']
            .filter(Boolean).join(' · ')) + '</span></div>').join(''));
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
    const sys = model.name + ' ';
    return n.name.indexOf(sys) === 0 ? n.name.slice(sys.length) : n.name;
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
        (n.type === 'Star' ? '#' + starColour().getHexString()
          : n.drawR ? '#' + new THREE.Color(tintOf(n.sub)).getHexString() : 'transparent') +
        (n.drawR ? '' : ';box-shadow:inset 0 0 0 1px var(--dimmer)') + '"></span>' +
      '<span class="nm">' + esc(shortName(n)) + '</span>' +
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
      sys = await fetchSystem(name, id64);
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

    /* What the reader last chose, and the one fact the sky control can tell
       them that nothing else here does: how far the galaxy's heart is from
       this system, and how far off its plane they are sitting. */
    const bear = coreBearing((model.sys && model.sys.coords) || { x: 0, y: 0, z: 0 });
    panel.querySelector('#orr-corebear').textContent =
      'Sagittarius A* is ' + bear.ly.toLocaleString() + ' ly away, ' +
      Math.abs(bear.tilt).toFixed(1) + '° ' + (bear.tilt >= 0 ? 'below' : 'above') +
      ' the plane. Modelled, not catalogued.';

    setAmbient(recallNum('ambient', 30));
    setGlow(recallNum('glow', 60));
    setLabels(recallStr('labels', '1') === '1');
    setFollow(recallStr('follow', '1') === '1');

    buildScene();
    renderList();
    buildLabels();
    drawSpine();
    setOrbits(recallNum('orbits', 0));
    setSky(recallStr('sky', 'galaxy'));
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
        inScene: !!(sky && sky.parent)
      },
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

  return { open, close, isOpen, page, state, faces };
})();

window.Orrery = Orrery;

/* The mechanics are exported alongside the view so they can be checked
   directly: an orbit that is solved rather than animated by eye is the whole
   claim this file makes, and it should be provable without a screenshot. */
export { Orrery, eccentricAnomaly, positionAt, buildModel, layout };
