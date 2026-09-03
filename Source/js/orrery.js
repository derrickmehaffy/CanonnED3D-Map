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
const START_RATE = LADDER.findIndex((r) => r.dir === 1 && r.label === '1 week/s');

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

  return { name: sys.name, star: root, all: [...nodes.values()], epoch, sys };
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
  const bodyR = (n) => {
    if (!n.km) return 0;                       // barycentres draw nothing
    if (n.type === 'Star') return 3.2;
    // Compressed hard: Jupiter is 11 Earths across and would swamp the view.
    const r = 1.05 * Math.pow(n.km / 6378, 0.42);
    return Math.max(0.32, Math.min(2.6, r));
  };

  model.all.forEach((n) => { n.drawR = bodyR(n); });

  const spread = (kids, inner, outer) => {
    const orbiting = kids.filter((k) => k.aAu > 0);
    if (!orbiting.length) return;

    if (trueDistance) {
      /* Anchored at zero, or it is not true distance at all — it was being
         mapped into the same [inner, outer] band as the compressed mode,
         which turns 0.39 AU against 700 into 16 units against 100 and
         destroys the very ratio the mode exists to show. From zero, Mercury
         lands almost on top of the star, which is the honest answer. */
      const hi = Math.max(...orbiting.map((k) => k.aAu));
      orbiting.forEach((k) => { k.a = outer * (k.aAu / hi); });
    } else {
      /* Log, not square root. Sol runs 0.39 AU to 700, and under a square root
         the eight planets everyone came to see occupy the first fifth of the
         view while Sedna and Persephone take the rest. On a log the same set
         spreads across the whole of it, which is what an orrery is for. */
      const key = (k) => Math.log10(Math.max(k.aAu, 1e-6));
      const lo = Math.min(...orbiting.map(key));
      const hi = Math.max(...orbiting.map(key));
      orbiting.forEach((k) => {
        k.a = hi === lo ? outer : inner + (outer - inner) * ((key(k) - lo) / (hi - lo));
      });
    }
    kids.forEach((k) => { if (!k.a) k.a = 0; });
  };

  spread(model.star.children, ORBIT_IN, ORBIT_OUT);
  model.all.forEach((n) => {
    if (!n.children.length || n === model.star) return;
    // A moon system is sized off its planet, so it reads as belonging to it.
    const base = Math.max(n.drawR, 0.6);
    spread(n.children, base * 2.2, base * 7);
  });
}

/* ── the view ───────────────────────────────────────────────────────────── */

const Orrery = (function () {
  let panel, canvas, renderer, scene, cam3, cam2, controls, raycaster;
  let model = null, meshes = [], loop = 0, lastFrame = 0;
  let simDays = 0, rateIx = START_RATE, playing = true;
  let mode3d = true, trueDistance = false, selected = null;
  /* What to draw, and whether this is a page or an overlay. Orbit paths get
     three states rather than two: a forty-body system draws forty ellipses,
     and the trans-Neptunian inclinations alone make a tangle you cannot see
     the planets through. */
  let showLabels = true, following = true, orbitMode = 0;   // 0 all, 1 planets, 2 none
  const ORBIT_LABEL = ['Orbits: all', 'Orbits: planets', 'Orbits: none'];
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
      '  <div class="orr-view" role="group" aria-label="View">',
      '    <button id="orr-3d" class="on" aria-pressed="true">3D</button>',
      '    <button id="orr-2d" aria-pressed="false">2D</button>',
      '  </div>',
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
      '    <div class="orr-tools" role="group" aria-label="What to draw">',
      '      <button id="orr-orbits" title="Orbit paths: all, planets only, none">Orbits: all</button>',
      '      <button id="orr-labl" class="on" title="Names over the view">Labels</button>',
      '      <button id="orr-follow" class="on" title="Keep the camera on the selected body">Follow</button>',
      '      <button id="orr-reset" title="Frame the whole system again">Reset view</button>',
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
      '  <div class="orr-scale">',
      '    <button id="orr-spread" class="on" title="Orbits spread on a log scale, so the whole system is legible at once">Spread</button>',
      '    <button id="orr-true" title="Orbits to scale with each other. Bodies stay exaggerated, or they would be invisible">True distance</button>',
      '  </div>',
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
    if (withLs.length < 2) { host.innerHTML = ''; host.classList.add('empty'); return; }
    host.classList.remove('empty');

    const max = Math.max(...withLs.map(lsOf), 1);
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
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
    else if (e.key === ',') setRate(rateIx - 1);
    else if (e.key === '.') setRate(rateIx + 1);
  }

  function initGL() {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
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
    scene.add(new THREE.AmbientLight(0x2a3542, 1.4));
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

  function clearScene() {
    meshes.forEach((m) => {
      if (m.mesh) { scene.remove(m.mesh); m.mesh.geometry.dispose(); m.mesh.material.dispose(); }
      if (m.line) { scene.remove(m.line); m.line.geometry.dispose(); m.line.material.dispose(); }
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
          // The star is its own light source, so it is not lit by one.
          ? new THREE.MeshBasicMaterial({ color: starTint })
          : new THREE.MeshLambertMaterial({ color: tintOf(n.sub) });
        entry.mesh = new THREE.Mesh(geo, mat);
        entry.mesh.userData.node = n;
        scene.add(entry.mesh);

        if (isStar) {
          const glow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: glowTexture(), color: starTint, transparent: true, opacity: 0.85,
            blending: THREE.AdditiveBlending, depthWrite: false
          }));
          glow.scale.setScalar(n.drawR * 6);
          entry.mesh.add(glow);
        }
      }

      // The path, sampled once in the body's own plane and then carried
      // around by its parent each frame.
      if (n.a > 0 && n.P) {
        const pts = [];
        const steps = 180;
        for (let s = 0; s <= steps; s++) {
          const E = (s / steps) * Math.PI * 2;
          const r = n.a * (1 - n.e * Math.cos(E));
          const nu = 2 * Math.atan2(Math.sqrt(1 + n.e) * Math.sin(E / 2),
                                    Math.sqrt(1 - n.e) * Math.cos(E / 2));
          pts.push(inPlaneToScene(r * Math.cos(nu), r * Math.sin(nu), n, new THREE.Vector3()));
        }
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const moon = n.parent && n.parent !== model.star;
        entry.line = new THREE.Line(geo, new THREE.LineBasicMaterial({
          color: moon ? 0x28343F : 0x33465A, transparent: true, opacity: moon ? 0.34 : 0.5
        }));
        scene.add(entry.line);
      }

      meshes.push(entry);
    });

    frame();
    draw(0);
  }

  /** Put the camera where the whole system fits. */
  function frame() {
    const span = ORBIT_OUT * 1.25;
    cam3.position.set(span * 0.22, span * 0.46, span * 0.78);
    cam3.near = 0.05; cam3.far = span * 40; cam3.updateProjectionMatrix();
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

  function setRate(ix) {
    rateIx = Math.max(0, Math.min(LADDER.length - 1, ix));
    const r = LADDER[rateIx];
    panel.querySelector('#orr-rate').textContent =
      (r.dir < 0 && r.days > 1 / 86400 ? '− ' : '') + r.label;
    panel.querySelector('#orr-slower').disabled = rateIx === 0;
    panel.querySelector('#orr-faster').disabled = rateIx === LADDER.length - 1;
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
    panel.querySelector('#orr-labl').classList.toggle('on', on);
    panel.querySelector('#orr-labels').classList.toggle('hide', !on);
  }

  function setFollow(on) {
    following = on;
    panel.querySelector('#orr-follow').classList.toggle('on', on);
  }

  function setOrbits(mode) {
    orbitMode = mode;
    panel.querySelector('#orr-orbits').textContent = ORBIT_LABEL[mode];
    panel.querySelector('#orr-orbits').classList.toggle('on', mode !== 2);
    meshes.forEach((m) => {
      if (!m.line) return;
      const moon = m.node.parent && m.node.parent !== model.star;
      m.line.visible = mode === 0 || (mode === 1 && !moon);
    });
  }

  function setScale(isTrue) {
    if (trueDistance === isTrue) return;
    trueDistance = isTrue;
    panel.querySelector('#orr-spread').classList.toggle('on', !isTrue);
    panel.querySelector('#orr-true').classList.toggle('on', isTrue);
    buildScene();
  }

  /* ── per frame ────────────────────────────────────────────────────────── */

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
    });

    // Selecting a body is also aiming at it: the camera target eases onto
    // whatever is chosen and then stays with it, which is the only way to
    // watch a moon system without chasing it by hand.
    if (following && selected && selected._pos) controls.target.lerp(selected._pos, 0.12);

    drawLabels();
    panel.querySelector('#orr-date').textContent = gameDate();

    controls.update();
    renderer.render(scene, mode3d ? cam3 : cam2);
  }

  const ORIGIN = new THREE.Vector3();

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
    draw(dt);
  }

  /* ── selection ────────────────────────────────────────────────────────── */

  function onPick(e) {
    const r = canvas.getBoundingClientRect();
    const p = new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1
    );
    raycaster.setFromCamera(p, mode3d ? cam3 : cam2);
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
    const want = n === model.star ? ORBIT_OUT * 1.5
      : n.children.some((c) => c.a > 0) ? Math.max(...n.children.map((c) => c.a || 0)) * 4.5
      // A body with no moons has nothing to frame but itself, and filling the
      // view with it puts whatever happens to be behind it in your face.
      : Math.max(n.drawR * 42, 15);
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

    if (b.stations && b.stations.length) {
      h += sect('Stations', b.stations.map((st) =>
        '<div class="orr-item"><b>' + esc(st.name || 'Unnamed') + '</b>' +
        '<span>' + esc([st.type, st.controllingFaction].filter(Boolean).join(' · ')) + '</span>' +
        '</div>').join(''));
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

    buildScene();
    renderList();
    buildLabels();
    drawSpine();
    setOrbits(orbitMode);
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

  return { open, close, isOpen, page };
})();

window.Orrery = Orrery;

/* The mechanics are exported alongside the view so they can be checked
   directly: an orbit that is solved rather than animated by eye is the whole
   claim this file makes, and it should be provable without a screenshot. */
export { Orrery, eccentricAnomaly, positionAt, buildModel, layout };
