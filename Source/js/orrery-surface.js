/**
 * Surfaces, painted on the GPU.
 *
 * Every body used to be a 256×128 canvas: a flat fill, some radial gradients
 * for storms and cloud decks, blobs for continents, circles for craters. It
 * read as a coloured ball, and at the size a selected body fills the view it
 * read as a blurred coloured ball.
 *
 * This paints the same classes — rock, ice, metal, ammonia, gas giant,
 * earth-like, water world — as fields rather than as shapes: domain-warped
 * noise for terrain and coastline, latitude bands with turbulence for giants,
 * bowl-and-rim craters as distance fields, cloud decks as their own layer,
 * lava along ridged cracks where the dump says the world is volcanic. The
 * height field is differentiated on the fly into a normal map, which is what
 * makes a crater a crater rather than a darker circle, and the alpha of the
 * albedo carries how shiny the surface is, so an ocean catches the star and
 * a plain does not.
 *
 * Two targets in one pass — albedo+specular and normal — into an equirect the
 * sphere geometry wears directly. Deterministic per body: everything varies
 * off a seed, so a world looks the same every time you come back to it. Sized
 * by whoever asks: a few hundred pixels for forty bodies at a glance, a couple
 * of thousand for the one being looked at, rebaked in a few milliseconds.
 *
 * Nothing here touches the DOM, and nothing here decides which body deserves
 * which size — that is the orrery's call.
 */
import * as THREE from 'three';

/* No #version line: three prepends it for glslVersion GLSL3, and a second
   one is a compile error — which shows up as a black texture and a bare
   INVALID_OPERATION, with no message anywhere a person would look. */
const VERT = `precision highp float;
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG = `precision highp float;
precision highp int;
in vec2 vUv;
layout(location = 0) out vec4 oAlbedo;   // rgb colour, a = how shiny
layout(location = 1) out vec4 oNormal;   // tangent-space normal, 0..1

uniform vec3  uSeed;
uniform vec3  uBase;      // the class's own colour, linear
uniform int   uKind;      // 0 rock 1 ice 2 gas 3 earth-like 4 water world 5 ammonia 6 metal
uniform float uLand;      // sea level, as a fraction of the height field that is dry
uniform int   uCraterN;   // how many craters to test — density, not a look
uniform float uCraterR;   // their typical size, in radians
uniform float uBands;     // how many latitude bands round a giant
uniform int   uStorms;
uniform float uClouds;    // 0..1 cover
uniform float uLava;      // 0 or 1
uniform float uIce;       // how far the caps reach, 0..1 of the way to the equator
uniform float uRelief;    // how strongly height turns into shading
uniform float uTexel;     // one texel in longitude, for the derivative

/* ── noise ─────────────────────────────────────────────────────────────── */
float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123); }
float hash1(float n) { return fract(sin(n) * 43758.5453123); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                 mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                 mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p, int oct) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) { if (i >= oct) break; v += a * vnoise(p); p = p * 2.03 + 1.7; a *= 0.5; }
  return v;
}
/* Warped: the coordinate itself is pushed around by noise first, which is
   what gives coastlines their inlets and giants their streaks instead of the
   round blobs plain fBm makes. */
float warped(vec3 p, float amount, int oct) {
  vec3 q = vec3(fbm(p, 4), fbm(p + vec3(5.2, 1.3, 2.8), 4), fbm(p + vec3(1.7, 9.2, 4.1), 4));
  return fbm(p + amount * (q - 0.5) * 2.0, oct);
}
float ridged(vec3 p, int oct) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) { if (i >= oct) break; v += a * (1.0 - abs(vnoise(p) * 2.0 - 1.0)); p = p * 2.11 + 3.1; a *= 0.5; }
  return v;
}

/* ── craters: bowls with rims, as a distance field over the sphere ─────── */
float craters(vec3 d, out float rim) {
  float h = 0.0; rim = 0.0;
  for (int i = 0; i < 128; i++) {
    if (i >= uCraterN) break;
    float fi = float(i) * 7.31 + uSeed.x * 13.0;
    vec3 c = normalize(vec3(hash1(fi) , hash1(fi + 1.0), hash1(fi + 2.0)) * 2.0 - 1.0);
    float r = uCraterR * (0.35 + hash1(fi + 3.0) * hash1(fi + 3.0) * 2.2);   // many small, few large
    float dist = sqrt(max(0.0, 2.0 - 2.0 * dot(d, c)));                        // chord ≈ angle
    if (dist > r * 1.35) continue;
    float t = dist / r;
    // A bowl to the rim, a raised lip, then a soft ejecta skirt.
    float bowl = -(1.0 - t * t) * 0.9;
    float lip = exp(-pow((t - 1.0) * 6.0, 2.0)) * 0.55;
    float skirt = exp(-pow((t - 1.15) * 4.0, 2.0)) * 0.12;
    float depth = r / uCraterR;                                                 // bigger craters are deeper
    h += (bowl + lip + skirt) * depth;
    rim = max(rim, lip * depth);
  }
  return h;
}

/* ── the height field, by class ────────────────────────────────────────── */
float terrain(vec3 d) {
  vec3 p = d * 2.3 + uSeed;
  if (uKind == 2 || uKind == 5) return 0.0;                 // giants have no ground
  if (uKind == 3 || uKind == 4) {
    // Continents, with mountains where the warped field peaks.
    float base = warped(p * 1.1, 0.9, 6);
    float mount = ridged(p * 3.0 + 7.0, 4) * 0.35 * smoothstep(0.5, 0.75, base);
    return base + mount;
  }
  float rim;
  float ground = warped(p * 1.6, 0.5, 5) * 0.7;
  float cr = craters(d, rim) * 0.045;
  if (uKind == 1) ground += (1.0 - ridged(p * 5.0, 4)) * 0.08;   // ice: cracked
  return ground + cr;
}

/* ── colour ────────────────────────────────────────────────────────────── */
vec3 rockColour(vec3 d, float h, float rimAt) {
  vec3 p = d * 2.3 + uSeed;
  float tone = fbm(p * 4.0 + 11.0, 4);
  vec3 c = uBase * (0.72 + tone * 0.56);
  // Broad darker plains — maria — so the surface has a large scale as well as
  // a small one, which is what stops it reading as a uniform grain.
  float mare = smoothstep(0.52, 0.68, warped(p * 0.9 + 3.0, 0.6, 4));
  c *= 1.0 - mare * 0.32;
  // Crater floors darker, rims a touch brighter; regolith streaks.
  c *= 1.0 - smoothstep(0.30, 0.20, h) * 0.22;
  c += rimAt * 0.25 * uBase;
  c = mix(c, c * vec3(0.92, 0.95, 1.0), fbm(p * 9.0, 3) * 0.3);
  return c;
}
vec3 iceColour(vec3 d, float h) {
  vec3 p = d * 2.3 + uSeed;
  vec3 c = mix(uBase, vec3(0.93, 0.96, 1.0), 0.55);
  float crack = ridged(p * 5.0, 4);
  c *= 1.0 - smoothstep(0.62, 0.9, crack) * 0.35;
  c *= 0.85 + fbm(p * 3.0, 4) * 0.25;
  return c;
}
vec3 metalColour(vec3 d, float h, float rimAt) {
  vec3 c = rockColour(d, h, rimAt) * vec3(0.9, 0.92, 0.98);
  float sheen = fbm(d * 7.0 + uSeed, 3);
  return mix(c, c * 1.35, smoothstep(0.6, 0.85, sheen) * 0.5);
}
vec3 giantColour(vec3 d, float lat) {
  vec3 p = d * 2.3 + uSeed;
  // Bands run with latitude; the turbulence pulls them into streaks.
  /* The turbulence is what a giant looks like: a band that stays a ruled
     line is a diagram. Warped hard, and again finely along the band. */
  float turb = (warped(p * vec3(0.9, 3.0, 0.9), 2.2, 5) - 0.5) * 1.8;
  float band = sin(lat * uBands + turb * 7.0 + fbm(p * 0.8, 3) * 2.0);
  float fine = fbm(p * vec3(2.5, 18.0, 2.5) + turb * 3.0 + 3.0, 4);
  vec3 light = uBase * 1.22 + vec3(0.06, 0.04, 0.0);
  vec3 dark  = uBase * 0.72;
  vec3 c = mix(dark, light, band * 0.5 + 0.5);
  c = mix(c, c * (0.78 + fine * 0.44), 0.7);
  // Storms: a few ovals, each with a swirl.
  for (int i = 0; i < 4; i++) {
    if (i >= uStorms) break;
    float fi = float(i) * 3.7 + uSeed.y * 9.0;
    float slat = (hash1(fi) - 0.5) * 1.6, slon = hash1(fi + 1.0) * 6.2831853;
    vec3 sc = vec3(cos(slat) * cos(slon), sin(slat), cos(slat) * sin(slon));
    float ang = sqrt(max(0.0, 2.0 - 2.0 * dot(d, sc)));
    float r = 0.06 + hash1(fi + 2.0) * 0.09;
    // Stretched along the band, and swirled inside.
    float dl = (asin(clamp(d.y, -1.0, 1.0)) - slat);
    float ellip = sqrt(ang * ang + dl * dl * 3.0);
    float inside = 1.0 - smoothstep(r * 0.6, r, ellip);
    float swirl = sin(ellip / r * 9.0 + atan(dl, ang) * 2.0) * 0.5 + 0.5;
    vec3 sColour = mix(uBase * 1.5 + vec3(0.12, 0.05, 0.0), uBase * 0.8, swirl);
    c = mix(c, sColour, inside * 0.85);
  }
  return c;
}
vec3 ammoniaColour(vec3 d, float lat) {
  vec3 c = giantColour(d, lat) * vec3(0.95, 1.0, 0.9);
  float blotch = warped(d * 3.5 + uSeed, 0.7, 4);
  return mix(c, uBase * 0.6, smoothstep(0.6, 0.8, blotch) * 0.5);
}
vec3 earthColour(vec3 d, float h, float lat, out float shine) {
  float sea = 1.0 - uLand;                       // height below this is water
  float above = h - sea;
  vec3 deep = vec3(0.02, 0.09, 0.22), shallow = vec3(0.07, 0.30, 0.42);
  vec3 sand = vec3(0.62, 0.55, 0.36), grass = vec3(0.16, 0.34, 0.12);
  vec3 dry = vec3(0.45, 0.38, 0.22), rock = vec3(0.36, 0.33, 0.30), snow = vec3(0.93, 0.95, 0.97);
  vec3 p = d * 2.3 + uSeed;
  float wet = fbm(p * 2.2 + 21.0, 4);           // where it rains, roughly
  vec3 c;
  if (above < 0.0) {
    c = mix(shallow, deep, smoothstep(0.0, 0.12, -above));
    shine = 0.9;
  } else {
    float t = above / max(0.001, uLand);
    vec3 low = mix(dry, grass, smoothstep(0.35, 0.65, wet));
    c = mix(sand, low, smoothstep(0.0, 0.03, above));
    c = mix(c, rock, smoothstep(0.18, 0.32, t));
    // Snowline falls toward the poles.
    float snowline = 0.42 - abs(lat) / 1.5708 * 0.3;
    c = mix(c, snow, smoothstep(snowline, snowline + 0.08, t));
    shine = 0.06;
  }
  // Ice caps, with a ragged edge.
  float capEdge = 1.0 - uIce * (0.55 + fbm(p * 4.0, 3) * 0.2);
  float cap = smoothstep(capEdge, capEdge + 0.05, abs(lat) / 1.5708);
  c = mix(c, snow, cap);
  shine = mix(shine, 0.3, cap);
  return c;
}

void main() {
  float lat = (vUv.y - 0.5) * 3.1415927;
  float lon = (vUv.x - 0.5) * 6.2831853;
  vec3 d = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));

  float h = terrain(d);
  float rimAt = 0.0;
  if (uKind == 0 || uKind == 6 || uKind == 1) { float r; craters(d, r); rimAt = r; }

  float shine = 0.05;
  vec3 c;
  if (uKind == 2) { c = giantColour(d, lat); shine = 0.12; }
  else if (uKind == 5) { c = ammoniaColour(d, lat); shine = 0.1; }
  else if (uKind == 3 || uKind == 4) { c = earthColour(d, h, lat, shine); }
  else if (uKind == 1) { c = iceColour(d, h); shine = 0.35; }
  else if (uKind == 6) { c = metalColour(d, h, rimAt); shine = 0.18; }
  else { c = rockColour(d, h, rimAt); }

  // Lava, where the dump says the crust is open.
  if (uLava > 0.5) {
    float crack = ridged(d * 6.0 + uSeed * 2.0, 4);
    float hot = smoothstep(0.78, 0.95, crack);
    c = mix(c, vec3(1.0, 0.32, 0.05), hot);
    shine = mix(shine, 0.0, hot);
  }

  // Clouds over it all, on worlds that have air enough for them.
  if (uClouds > 0.0 && uKind != 2 && uKind != 5) {
    float cl = warped(d * 3.2 + uSeed + 40.0, 0.8, 5);
    float cover = smoothstep(0.78 - uClouds * 0.28, 0.9, cl);
    c = mix(c, vec3(0.96, 0.97, 1.0), cover * 0.85);
    shine = mix(shine, 0.15, cover);
  }

  /* The normal, from the height field's slope. Two neighbouring directions a
     texel apart along longitude and latitude, the height at each, and the
     gradient that gives — scaled by how much relief this class is allowed. */
  vec3 east = normalize(vec3(-sin(lon), 0.0, cos(lon)));
  vec3 north = normalize(cross(east, d));
  float e = uTexel * 2.0;
  float hx = terrain(normalize(d + east * e));
  float hy = terrain(normalize(d + north * e));
  vec2 g = vec2(hx - h, hy - h) / e * uRelief;
  vec3 n = normalize(vec3(-g.x, -g.y, 1.0));

  oAlbedo = vec4(max(c, 0.0), clamp(shine, 0.0, 1.0));
  oNormal = vec4(n * 0.5 + 0.5, 1.0);
}`;

/* ── what a body is, in the shader's terms ─────────────────────────────── */

const KIND = { rock: 0, ice: 1, gas: 2, earth: 3, water: 4, ammonia: 5, metal: 6 };

/**
 * Decide the paint from the dump's own fields and the seed, the way the canvas
 * painter did. `rnd` is the body's seeded generator, so two bodies of one
 * class differ and one body never differs from itself.
 */
export function surfaceSpec(node, tintHex, rnd) {
  const sub = String(node.sub || '').toLowerCase();
  const raw = node.raw || {};
  let kind = KIND.rock;
  if (sub.includes('gas giant') || sub.includes('water giant')) kind = KIND.gas;
  else if (sub.includes('earth-like')) kind = KIND.earth;
  else if (sub.includes('water world')) kind = KIND.water;
  else if (sub.includes('ammonia')) kind = KIND.ammonia;
  else if (sub.includes('ice') || sub.includes('icy')) kind = KIND.ice;
  else if (sub.includes('metal')) kind = KIND.metal;

  const atmo = raw.atmosphereComposition;
  const air = atmo && Object.keys(atmo).length && raw.surfacePressure > 0.02;
  const base = new THREE.Color(tintHex).convertSRGBToLinear();

  return {
    seed: new THREE.Vector3(rnd() * 97, rnd() * 97, rnd() * 97),
    base, kind,
    land: kind === KIND.water ? 0.08 + rnd() * 0.1 : kind === KIND.earth ? 0.28 + rnd() * 0.2 : 0.5,
    craterN: kind === KIND.gas || kind === KIND.ammonia || kind === KIND.earth || kind === KIND.water ? 0
      : kind === KIND.ice ? 30 + Math.floor(rnd() * 40) : 50 + Math.floor(rnd() * 70),
    craterR: 0.05 + rnd() * 0.05,
    bands: 10 + rnd() * 14,
    storms: kind === KIND.gas ? 1 + Math.floor(rnd() * 3) : 0,
    clouds: air ? Math.min(1, (raw.surfacePressure || 0) / 1.2) * 0.8 + 0.2 : 0,
    lava: /major|magma|lava/i.test(raw.volcanismType || '') ? 1 : 0,
    ice: kind === KIND.earth ? 0.12 + rnd() * 0.12 : kind === KIND.water ? 0.2 + rnd() * 0.15 : 0,
    relief: kind === KIND.gas || kind === KIND.ammonia ? 0 : kind === KIND.earth || kind === KIND.water ? 0.35
      : kind === KIND.ice ? 0.5 : 0.8
  };
}

/* ── the bake ──────────────────────────────────────────────────────────── */

let quad = null, material = null, bench = null, flat = null;

function ensure() {
  if (quad) return;
  material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT, fragmentShader: FRAG,
    depthTest: false, depthWrite: false,
    uniforms: {
      uSeed: { value: new THREE.Vector3() }, uBase: { value: new THREE.Color() },
      uKind: { value: 0 }, uLand: { value: 0.5 }, uCraterN: { value: 0 }, uCraterR: { value: 0.08 },
      uBands: { value: 14 }, uStorms: { value: 0 }, uClouds: { value: 0 }, uLava: { value: 0 },
      uIce: { value: 0 }, uRelief: { value: 0.6 }, uTexel: { value: 1 / 512 }
    }
  });
  quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  bench = new THREE.Scene();
  bench.add(quad);
  flat = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
}

/**
 * Paint one body at one size. Returns the two textures and a way to free them.
 */
export function bakeSurface(renderer, spec, w, h) {
  ensure();
  const rt = new THREE.WebGLRenderTarget(w, h, { count: 2, depthBuffer: false });
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const [albedo, normal] = rt.textures;
  albedo.colorSpace = THREE.SRGBColorSpace;
  normal.colorSpace = THREE.NoColorSpace;
  rt.textures.forEach((t) => {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = aniso;
  });

  const u = material.uniforms;
  u.uSeed.value.copy(spec.seed);
  u.uBase.value.copy(spec.base);
  u.uKind.value = spec.kind;
  u.uLand.value = spec.land;
  u.uCraterN.value = spec.craterN;
  u.uCraterR.value = spec.craterR;
  u.uBands.value = spec.bands;
  u.uStorms.value = spec.storms;
  u.uClouds.value = spec.clouds;
  u.uLava.value = spec.lava;
  u.uIce.value = spec.ice;
  u.uRelief.value = spec.relief;
  u.uTexel.value = (2 * Math.PI) / w;

  const was = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(bench, flat);
  renderer.setRenderTarget(was);
  // Mipmaps are made when the texture is next bound; nothing to do here.
  return { albedo, normal, width: w, height: h, dispose: () => rt.dispose() };
}

/**
 * The albedo read back small, as a canvas — for the disc in the panel and for
 * the suite to hash. One readback, only when asked.
 */
export function surfaceCanvas(renderer, surface, w, h) {
  const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: surface.albedo });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  const s = new THREE.Scene(); s.add(m);
  const was = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(s, flat || new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1));
  const buf = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
  renderer.setRenderTarget(was);
  rt.dispose(); mat.dispose(); m.geometry.dispose();

  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const img = c.getContext('2d').createImageData(w, h);
  // GL rows run bottom-up; a canvas runs top-down, and north is the top.
  for (let y = 0; y < h; y++) {
    img.data.set(buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  }
  c.getContext('2d').putImageData(img, 0, 0);
  return c;
}
