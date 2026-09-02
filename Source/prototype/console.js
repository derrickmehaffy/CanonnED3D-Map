/* Canonn Map Console — prototype chrome.
 *
 * This drives the REAL Ed3d engine (../js/main.js, three.js r185). Nothing here
 * re-implements the renderer: the scene, camera, picking, grid and 2D/3D switch
 * are all Ed3d's. This file is only the interface around it.
 *
 * Runs as a classic deferred script, so it executes after main.js has published
 * Ed3d and friends on window.
 */
(function () {
  'use strict';

  var PALETTE = ['#FF9D00', '#4DE3E1', '#B98CFF', '#5FD08A', '#E8637B', '#E8C43A',
                 '#7FA8FF', '#FF8B4D', '#57C2A8', '#C58BFF'];

  /* ── the map catalogue ──────────────────────────────────────────────────
     Everything Canonn publishes, grouped. Three are wired to live data; the
     rest are listed so the index stays an honest picture of the whole site.  */
  var CATALOGUE = [
    { g: 'Guardian', items: [
      { id: 'gr', n: 'Guardian Ruins',       d: 'Ancient ruin sites by type, with a template map per type.', live: 1 },
      { id: 'gs', n: 'Guardian Structures',  d: 'Structure sites across ten named configurations.',           live: 1 },
      { id: 'gb', n: 'Guardian Beacons',     d: 'Beacons, grouped by primary star, each linked to a structure.', live: 1 },
      { n: 'Brain Trees',        d: 'Brain tree locations.' }
    ]},
    { g: 'Thargoid', items: [
      { n: 'Thargoid Structures', d: 'Known Thargoid structure sites.' },
      { n: 'Thargoid Barnacles',  d: 'Barnacle forests and clusters.' },
      { n: 'Hyperdictions',       d: 'Reported hyperdiction events.' },
      { n: 'Non-Human Signal Sources', d: 'NHSS threat levels by system.' },
      { n: 'Link Messages: 3305 Survey', d: 'Thargoid link message survey.' },
      { n: 'Unknown Interstellar Anomaly', d: 'UIA route and sightings.' }
    ]},
    { g: 'Cartographics', items: [
      { n: 'Galactic Exploration Catalog', d: 'The full GEC point-of-interest catalogue.' },
      { n: 'Generation Ships',   d: 'Derelict generation ships.' },
      { n: 'Megaships',          d: 'Megaship locations.' },
      { n: 'Listening Posts',    d: 'Listening posts by hint and discovery.' },
      { n: 'Voyager Pulsars',    d: 'Pulsars on the Voyager plaque.' },
      { n: 'Galnet Relay Stations', d: 'Galnet news relay coverage.' },
      { n: 'Permit Locked Regions', d: 'Permit-locked space.' },
      { n: 'Operation Ida',      d: 'Operation Ida reconstruction effort.' }
    ]},
    { g: 'Biology & Geology', items: [
      { n: 'Amphora Plant', d: 'Codex map.' }, { n: 'Bark Mounds', d: 'Codex map.' },
      { n: 'Crystalline Shards', d: 'Codex map.' }, { n: 'Tussocks', d: 'Codex map.' },
      { n: 'Fumaroles', d: 'Codex map.' }, { n: 'Gas Vents', d: 'Codex map.' },
      { n: 'Geysers', d: 'Codex map.' }, { n: 'Lagrange Clouds', d: 'Codex map.' }
    ]},
    { g: 'Routes', items: [
      { n: 'Canonn Challenge Route', d: 'The challenge route.' },
      { n: 'Gnosis Route Map',       d: 'Gnosis megaship itinerary.' },
      { n: 'Adamastor Route',        d: 'Adamastor generation ship route.' }
    ]},
    { g: 'Factions', items: [
      { n: 'Canonn',    d: 'Faction presence.' },
      { n: 'Canonn Deep Space Research', d: 'Faction presence.' },
      { n: 'Orion University', d: 'Faction presence.' },
      { n: 'All Factions', d: 'Every tracked faction.' }
    ]}
  ];

  var TOOLS = [
    ['Signals', 'signals.canonn.tech', 'https://signals.canonn.tech/'],
    ['Bioforge', 'bioforge.canonn.tech', 'https://bioforge.canonn.tech/'],
    ['Bifrost — Guardian ruins', 'ruins.canonn.tech', 'https://ruins.canonn.tech/'],
    ['Thargoid Link Decoder', 'tools.canonn.tech', 'https://tools.canonn.tech/linkdecoder/'],
    ['Thargoid Glyph Tool', 'tools.canonn.tech', 'https://tools.canonn.tech/thargoid_glyphs/'],
    ['Codex Regions', 'canonn-science.github.io', 'https://canonn-science.github.io/Codex-Regions/'],
    ['Undiscovered Codex', 'canonn-science.github.io', 'https://canonn-science.github.io/undiscovered-codex/'],
    ['Abandoned Settlements', 'canonn-science.github.io', 'https://canonn-science.github.io/abandonned/'],
    ['Neutron Star Plots', 'canonn-science.github.io', 'https://canonn-science.github.io/Canonn-Plots/neutron_stars_plots.html'],
    ['EDMC-Canonn plugin', 'github.com', 'https://github.com/canonn-science/EDMC-Canonn/releases/latest']
  ];

  /* Per-map configuration. `panel` is what makes each map's layer rail its own
     thing — the point of the exercise. */
  var MAPS = {
    gr: { name: 'Guardian Ruins',      src: 'https://storage.googleapis.com/canonn-downloads/guardian_ruins.json',
          unit: 'site',  panel: 'types', templates: true, cam: [25, 14100, -12900],
          note: 'Site types share a system more often than not. One point is one system; open it to see every site.' },
    gs: { name: 'Guardian Structures', src: 'https://storage.googleapis.com/canonn-downloads/guardian_structures.json',
          unit: 'site',  panel: 'types', templates: false, cam: [25, 14100, -12900],
          note: 'Ten named configurations. No template maps exist for these, so the panel drops that section.' },
    gb: { name: 'Guardian Beacons',    src: 'https://storage.googleapis.com/canonn-downloads/guardian_beacons.json',
          unit: 'beacon', panel: 'star', templates: false, cam: [382, -102, -204],
          note: 'Beacons have no site type. They group by primary star instead, and each points at a structure system.' }
  };

  var TNOTE = {
    Alpha: 'Six-pointed plan. Obelisks around a raised central dais.',
    Beta:  'Two long approach corridors meeting at a central spire.',
    Gamma: 'Broad triangular plan with the widest obelisk spread.'
  };

  var mapId = (new URLSearchParams(location.search).get('map') || 'gr');
  if (!MAPS[mapId]) mapId = 'gr';
  var CFG = MAPS[mapId];
  var DATA = window.MAPDATA[mapId];
  var THUMBS = window.THUMBS || {};

  var TYPES = DATA.types, on = TYPES.map(function () { return true; });
  var hoverType = TYPES[0];
  var sel = null, selSite = 0, panel = 'layers';
  var catBase = 200;                       // category ids handed to Ed3d
  var extraRoutes = [];                    // systems added from a dropped journal

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function col(i) { return PALETTE[i % PALETTE.length]; }

  /* ── build Ed3d's data structure from the prepared snapshot ───────────── */
  function buildJson(sysList) {
    var cats = {}, group = {};
    TYPES.forEach(function (t, i) {
      group[String(catBase + i)] = { name: t, color: col(i).replace('#', '') };
    });
    cats[CFG.panel === 'star' ? 'Primary star' : 'Site type'] = group;

    var systems = sysList.map(function (s) {
      var types = {}, lines = [];
      s.s.forEach(function (site) {
        types[site[0]] = (types[site[0]] || 0) + 1;
        lines.push(TYPES[site[0]] + (site[1] ? ' — ' + site[1] : ''));
      });
      return {
        name: s.n,
        coords: { x: s.x, y: s.y, z: -s.z },   // Ed3d reverses Z on the way in
        cat: Object.keys(types).map(function (k) { return catBase + (+k); }),
        infos: lines.join('<br>')
      };
    });
    return { categories: cats, systems: systems };
  }

  /* ── live fetch, snapshot fallback ────────────────────────────────────── */
  function normalise(raw) {
    var T = TYPES, out = [], byKey = {};
    raw.forEach(function (r) {
      var n = (r['System Name'] || '').trim(); if (!n) return;
      var x = parseFloat(String(r.x).replace(',', '')),
          y = parseFloat(r.y), z = parseFloat(r.z);
      if (isNaN(x) || isNaN(y) || isNaN(z)) return;
      var label = CFG.panel === 'star'
        ? String(r['Primary Star'] || '').replace(' Star', '').replace(/[()]/g, '').trim()
        : (r['Site Type'] || '').trim();
      var ti = T.indexOf(label); if (ti < 0) return;
      var k = n + '|' + x + '|' + y + '|' + z;
      if (!byKey[k]) { byKey[k] = { n: n, x: +x.toFixed(1), y: +y.toFixed(1), z: +z.toFixed(1), s: [] }; out.push(byKey[k]); }
      byKey[k].s.push([ti, (r['Body Name'] || '').trim(),
                        (r['Guardian Structure System'] || '').trim()]);
    });
    out.forEach(function (s) { s.s.sort(function (a, b) { return a[0] - b[0]; }); });
    return out;
  }

  function setFeed(mode, txt) {
    $('feed').className = 'feed ' + mode;
    $('feedtxt').textContent = txt;
  }

  function start(sysList, mode) {
    var sites = sysList.reduce(function (a, s) { return a + s.s.length; }, 0);
    setFeed(mode, mode + ' · ' + sysList.length + ' systems · ' + sites + ' ' + CFG.unit + 's');
    DATA.sys = sysList;

    Ed3d.init({
      container: 'edmap',
      basePath: '../',              // this page is one directory down
      json: buildJson(sysList),
      withHudPanel: false,          // the chrome in this file replaces it
      withOptionsPanel: false,
      hudMultipleSelect: true,
      startAnim: false,
      showGalaxyInfos: true,
      effectScaleSystem: [10, 200],  // was [20,500]; recomputed from the size slider
      cameraPos: CFG.cam,          // same framing the real pages use
      systemColor: '#FF9D00'
    });

    // Ed3d re-shows this on rebuild; it has done its job.
    var l = $('loading'); if (l) l.style.display = 'none';

    // Open framed on the data. The live maps inherit a fixed cameraPos, which
    // for several of them starts so far out that the systems are invisible —
    // you arrive in deep space and have to go looking. Framing the actual
    // extent is a small change with an outsized effect on first impressions.
    setTimeout(function () { frameData(); applySize(); applyDisplay(); syncDisplay(); }, 400);

    $('st-map').textContent = CFG.name;
    $('mapname').textContent = CFG.name;
    document.title = CFG.name + ' — Canonn Map Console';
    renderPanel();
    updateShown();
    setInterval(tick, 250);
  }

  (function load() {
    var done = false;
    function fallback() {
      if (done) return; done = true;
      start(DATA.sys, 'snapshot');
    }
    var timer = setTimeout(fallback, 8000);
    fetch(CFG.src, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        if (done) return; done = true; clearTimeout(timer);
        var s = normalise(d);
        start(s.length ? s : DATA.sys, s.length ? 'live' : 'snapshot');
      })
      .catch(fallback);
  })();

  /* Frame the camera on the systems.
     Several of these datasets are bimodal — Guardian Ruins has a dense cluster
     near the bubble and a second one ~20 kly away — so a percentile box round
     the whole set frames mostly empty space. Instead: find the median point,
     then size the view to the nearer half of them. For Guardian Ruins that is a
     sharp cut — 55% sit within ~500 ly of the median and the rest jump to 8 kly —
     so the median lands cleanly on the bubble cluster and stays inside Ed3d's
     far-view threshold. The reset button toggles to the full extent. */
  var frameAll = false;
  function frameData() {
    if (typeof camera === 'undefined' || !DATA.sys.length) return;
    function med(a) {
      var b = a.slice().sort(function (m, n) { return m - n; });
      return b[Math.floor(b.length / 2)];
    }
    var pts = DATA.sys.map(function (s) { return { x: s.x, y: s.y, z: -s.z }; });
    var cx = med(pts.map(function (p) { return p.x; })),
        cy = med(pts.map(function (p) { return p.y; })),
        cz = med(pts.map(function (p) { return p.z; }));
    var d = pts.map(function (p) {
      var a = p.x - cx, b = p.y - cy, c = p.z - cz;
      return Math.sqrt(a * a + b * b + c * c);
    }).sort(function (m, n) { return m - n; });
    var radius = frameAll ? d[d.length - 1] : d[Math.floor(d.length * 0.5)];
    var span = Math.max(radius * 2.2, 220);

    controls.target.set(cx, cy, cz);
    camera.position.set(cx - span * 0.42, cy + span * 0.5, cz + span * 0.7);
    controls.update();
    syncCamera();

    // The galaxy region labels are drawn at galaxy scale. On a tight dataset
    // (Beacons spans a few hundred ly) a single label fills the screen, so
    // default them off and leave the Display panel to bring them back.
    if (!frameAll && radius < 2000 && disp.galaxy) doDisplay('galaxy', false);
    var z = $('zfit');
    if (z) z.title = frameAll ? 'Frame the main cluster' : 'Frame everything';
  }

  /* ── status strip, polled off Ed3d's own camera ───────────────────────── */
  function tick() {
    if (typeof controls === 'undefined' || !controls) return;
    var t = controls.target;
    applyDisplay();
    $('st-pos').textContent = Math.round(t.x) + ' · ' + Math.round(t.y) + ' · ' + Math.round(-t.z);
    $('st-sol').textContent = Math.round(Math.sqrt(t.x * t.x + t.y * t.y + t.z * t.z)).toLocaleString() + ' ly';
  }
  function updateShown() {
    var shownSys = 0, shownUnits = 0;
    DATA.sys.forEach(function (s) {
      var any = false;
      s.s.forEach(function (site) { if (on[site[0]]) { shownUnits++; any = true; } });
      if (any) shownSys++;
    });
    $('st-shown').textContent = shownSys + ' / ' + DATA.sys.length + ' sys · ' +
      shownUnits + ' ' + CFG.unit + 's';
  }

  /* ── category filtering, using Ed3d's own catObjs index ───────────────── */
  function setCatVisible(ti, active) {
    var idCat = catBase + ti;
    var list = Ed3d.catObjs[idCat] || [];
    for (var i = 0; i < list.length; i++) {
      var idx = list[i], p = System.points[idx];
      if (!p) continue;
      System.setColor(idx, active ? p.color : new THREE.Color('#111111'));
      p.visible = active;
      p.filtered = active;
    }
  }

  /* ── rail panels ──────────────────────────────────────────────────────── */
  function counts() {
    var c = TYPES.map(function () { return 0; });
    DATA.sys.forEach(function (s) { s.s.forEach(function (site) { c[site[0]]++; }); });
    return c;
  }

  function panelLayers() {
    var c = counts(), multi = 0, mixed = 0;
    DATA.sys.forEach(function (s) {
      if (s.s.length > 1) multi++;
      var t = {}; s.s.forEach(function (x) { t[x[0]] = 1; });
      if (Object.keys(t).length > 1) mixed++;
    });
    var sites = c.reduce(function (a, b) { return a + b; }, 0);
    var h = '<div class="s-t">' + (CFG.panel === 'star' ? 'Primary star' : 'Site type') + '</div>' +
      '<div class="s-sub"><b>' + DATA.sys.length + '</b> systems · <b>' + sites + '</b> ' + CFG.unit + 's</div>';
    TYPES.forEach(function (t, i) {
      if (!c[i]) return;
      h += '<div class="layer' + (on[i] ? '' : ' off') + (hoverType === t ? ' sel' : '') +
        '" data-t="' + i + '" role="button" tabindex="0" aria-pressed="' + on[i] + '">' +
        '<span class="sw" style="background:' + col(i) + '"></span>' +
        '<span class="nm" title="' + esc(t) + '">' + esc(t) + '</span>' +
        '<span class="ct">' + c[i] + '</span></div>';
    });
    h += '<div class="note">' + esc(CFG.note) +
      (multi ? '<br><br><b>' + multi + '</b> systems hold more than one, <b>' + mixed + '</b> mixing types.' : '') +
      '</div>';
    if (CFG.templates) {
      h += '<div class="tmpl"><div class="tmpl-h"><span>Template map</span><b id="tmpl-n"></b></div>' +
        '<img id="tmpl-img" alt="Site template map"><div class="tmpl-f" id="tmpl-f"></div></div>';
    }
    return h;
  }

  function panelCamera() {
    return '<div class="s-t">Camera</div><div class="s-sub">Ed3d\'s own camera, driven from here</div>' +
      '<div class="btnrow">' +
      '<button data-cam="iso">Isometric</button><button data-cam="top">Top down</button>' +
      '<button data-cam="side">Side on</button><button data-cam="sol">Centre Sol</button>' +
      '<button data-cam="reset">Frame the data</button><button data-cam="hint">&nbsp;</button>' +
      '</div>' +
      '<div class="row" style="margin-top:14px"><span class="lb">Distance</span>' +
      '<span class="vv" id="camdist">—</span></div>' +
      '<input type="range" id="camrange" min="200" max="30000" step="100" style="width:100%">' +
      '<div class="note">Top down sets <b>Ed3d.isTopView</b>, the same flag the 3D/2D ' +
      'buttons use. Zoom and pan live in the arrow cluster bottom-right — those are ' +
      'the existing controls, kept as they were.</div>';
  }

  function panelRoutes() {
    var h = '<div class="s-t">Routes &amp; journals</div>' +
      '<div class="s-sub">Drop a journal to plot where you have been</div>' +
      '<div class="drop" id="drop">Drop a <b>Journal*.log</b> here<br>or click to choose a file</div>' +
      '<input type="file" id="fileinput" accept=".log,.json,.txt" multiple style="display:none">';
    if (extraRoutes.length) {
      h += '<div style="margin-top:12px">';
      extraRoutes.forEach(function (r) {
        h += '<div class="layer"><span class="sw" style="background:#5FD08A"></span>' +
          '<span class="nm">' + esc(r.name) + '</span><span class="ct">' + r.count + '</span></div>';
      });
      h += '</div>';
    }
    h += '<div class="note">Reads <b>FSDJump</b> entries and pushes them onto the live map with ' +
      '<b>Ed3d.addBatch()</b>. Nothing leaves your machine — the file is parsed in the browser.</div>';
    return h;
  }

  function panelDisplay() {
    function sw(id, label, state) {
      return '<div class="row"><span class="lb">' + label + '</span>' +
        '<span class="sw-t' + (state ? ' on' : '') + '" data-sw="' + id + '" role="switch" ' +
        'tabindex="0" aria-checked="' + state + '"></span></div>';
    }
    return '<div class="s-t">Display</div><div class="s-sub">Scene toggles</div>' +
      sw('grid', 'Grid', true) +
      sw('galaxy', 'Galaxy labels', true) +
      sw('stars', 'Starfield', true) +
      '<div class="row" style="margin-top:10px"><span class="lb">System size</span>' +
      '<span class="vv" id="szval">—</span></div>' +
      '<input type="range" id="sizerange" min="6" max="70" step="2" style="width:100%">' +
      '<div class="note">Each toggle calls the engine directly — <b>Grid.toggleGrid()</b>, ' +
      '<b>Galaxy.infosShow/Hide()</b>, and the point material\'s own size.</div>';
  }

  function renderPanel() {
    var host = $('side');
    host.innerHTML = panel === 'layers' ? panelLayers()
                   : panel === 'camera' ? panelCamera()
                   : panel === 'routes' ? panelRoutes()
                   : panelDisplay();
    if (panel === 'layers' && CFG.templates) showTemplate(hoverType);
    if (panel === 'camera') syncCamera();
    if (panel === 'display') syncDisplay();
    if (panel === 'routes') wireDrop();
  }

  function showTemplate(t) {
    hoverType = t;
    if (!CFG.templates) return;
    var img = $('tmpl-img'); if (!img) return;
    $('tmpl-n').textContent = t;
    if (THUMBS[t.toLowerCase()]) { img.src = THUMBS[t.toLowerCase()]; img.style.display = 'block'; }
    else img.style.display = 'none';
    $('tmpl-f').textContent = TNOTE[t] || '';
    Array.prototype.forEach.call(document.querySelectorAll('.layer'), function (el) {
      el.classList.toggle('sel', TYPES[+el.dataset.t] === t);
    });
  }

  /* rail + panel events (delegated, so re-rendering the panel is safe) */
  document.querySelector('.rail').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-p]'); if (!b) return;
    var p = b.dataset.p;
    if (p === panel && !$('side').classList.contains('hidden')) {
      $('side').classList.add('hidden');
      b.classList.remove('on');
    } else {
      panel = p;
      $('side').classList.remove('hidden');
      Array.prototype.forEach.call(this.querySelectorAll('button'), function (x) {
        x.classList.toggle('on', x === b);
      });
      renderPanel();
    }
    setTimeout(function () { if (typeof refresh3dMapSize === 'function') refresh3dMapSize(); }, 0);
  });

  $('side').addEventListener('click', function (e) {
    var lay = e.target.closest('.layer[data-t]');
    if (lay) {
      var i = +lay.dataset.t;
      if (e.shiftKey) { showTemplate(TYPES[i]); return; }
      on[i] = !on[i];
      setCatVisible(i, on[i]);
      renderPanel(); updateShown();
      return;
    }
    var cam = e.target.closest('[data-cam]');
    if (cam) { doCamera(cam.dataset.cam); return; }
    var swt = e.target.closest('[data-sw]');
    if (swt) { doDisplay(swt.dataset.sw, !swt.classList.contains('on')); return; }
  });
  $('side').addEventListener('mouseover', function (e) {
    var lay = e.target.closest('.layer[data-t]');
    if (lay && CFG.templates) showTemplate(TYPES[+lay.dataset.t]);
  });

  /* ── camera ───────────────────────────────────────────────────────────── */
  function camDist() {
    if (typeof camera === 'undefined') return 0;
    return Math.round(camera.position.distanceTo(controls.target));
  }
  function syncCamera() {
    var d = camDist(), r = $('camrange');
    if (r) { r.value = Math.max(200, Math.min(30000, d)); $('camdist').textContent = d.toLocaleString() + ' ly'; }
  }
  function moveTo(pos) {
    HUD.moveCamera(
      { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      pos
    );
  }
  function place(x, y, z) {
    // Set the camera outright rather than tweening. HUD.moveCamera's tween is
    // driven by TWEEN.update() inside animate(), and while it runs it rewrites
    // camera.position every frame — which fought OrbitControls and made the
    // presets look like they only worked in the locked 2D view.
    camera.position.set(x, y, z);
    camera.lookAt(controls.target);
    controls.update();
    syncCamera();
  }
  function doCamera(what) {
    if (typeof camera === 'undefined') return;
    var t = controls.target, d = Math.max(400, camDist());
    if (what === 'top') {
      Ed3d.isTopView = true; setViewButtons('2d');
      place(t.x, t.y + d, t.z);
    } else if (what === 'iso') {
      Ed3d.isTopView = false; setViewButtons('3d');
      place(t.x - d * 0.55, t.y + d * 0.5, t.z + d * 0.65);
    } else if (what === 'side') {
      Ed3d.isTopView = false; setViewButtons('3d');
      place(t.x, t.y, t.z + d);
    } else if (what === 'sol') {
      Ed3d.isTopView = false; setViewButtons('3d');
      controls.target.set(0, 0, 0);
      place(-d * 0.55, d * 0.5, d * 0.65);
    } else if (what === 'reset') {
      Ed3d.isTopView = false; setViewButtons('3d');
      frameData();
    }
  }
  var camRangeBound = false;
  document.addEventListener('input', function (e) {
    if (e.target.id === 'camrange') {
      var d = +e.target.value, t = controls.target;
      var dir = camera.position.clone().sub(t).normalize();
      camera.position.copy(t.clone().add(dir.multiplyScalar(d)));
      $('camdist').textContent = d.toLocaleString() + ' ly';
    }
    if (e.target.id === 'sizerange') {
      sysSize = +e.target.value;
      applySize();
      $('szval').textContent = sysSize;
    }
  });

  /* ── display ──────────────────────────────────────────────────────────
     These three fight the engine's own far-view logic: crossing the far-view
     threshold calls enableFarView/disableFarView, which reach in and set grid
     visibility, galaxy labels and the starfield themselves. So the panel keeps
     its own intent and re-asserts it on a timer rather than setting once. */
  var disp = { grid: true, galaxy: true, stars: true };
  var sysSize = 20;                       // flares got huge on zoom-out at 64

  function applyDisplay() {
    if (typeof Ed3d === 'undefined' || !Ed3d.grid1H) return;
    // Grids are scale-dependent: the fine ones are meaningless at galaxy scale
    // and the XL one is meaningless up close, which is why turning them all on
    // at once produced a moire mess. Mirror what disableFarView/enableFarView do.
    var far = !!window.isFarView;
    if (Ed3d.grid1H.obj)  Ed3d.grid1H.obj.visible  = disp.grid && !far;
    if (Ed3d.grid1K.obj)  Ed3d.grid1K.obj.visible  = disp.grid && !far;
    if (Ed3d.grid1XL.obj) Ed3d.grid1XL.obj.visible = disp.grid && far;
    if (Ed3d.grid1H.coordGrid)  Ed3d.grid1H.coordGrid.visible  = disp.grid && !far;
    if (Ed3d.grid1K.coordGrid)  Ed3d.grid1K.coordGrid.visible  = disp.grid && !far;

    // Galaxy.infosShow() reads Ed3d.showGalaxyInfos, so the flag has to be set
    // BEFORE the call — setting it after was why labels never came back.
    Ed3d.showGalaxyInfos = disp.galaxy;
    if (typeof Galaxy !== 'undefined') {
      if (disp.galaxy) Galaxy.infosShow(); else Galaxy.infosHide();
    }
    // Two different things read as "stars": Ed3d.starfield up close, and the
    // Galaxy milkyway particle clouds once far view engages. enableFarView()
    // hides the former and shows the latter, so toggling only starfield did
    // nothing at the zoom level where you can actually see them.
    if (Ed3d.starfield) Ed3d.starfield.visible = disp.stars && !far;
    if (typeof Galaxy !== 'undefined' && Galaxy.milkyway) {
      Galaxy.milkyway.forEach(function (m) { if (m) m.visible = disp.stars && far; });
      if (Galaxy.milkyway2D) Galaxy.milkyway2D.visible = disp.stars && far;
    }
  }

  function applySize() {
    // sizeOnScroll() recomputes point size from camera distance every frame and
    // clamps it to effectScaleSystem. Setting material.size directly is pointless
    // — it is overwritten on the next frame. Drive the clamp instead.
    // The clamp has to do two jobs: keep flares modest up close, and keep systems
    // visible against the starfield when zoomed right out. [20,500] was too big
    // at distance; [8,28] made them vanish. Scale the ceiling off the base.
    Ed3d.effectScaleSystem = [Math.max(4, sysSize * 0.5), Math.min(240, sysSize * 10)];
    if (typeof Action !== 'undefined') Action.prevScale = null;  // force recompute
    System.scaleSize = sysSize;
  }

  function syncDisplay() {
    var s = $('sizerange');
    if (s) { s.value = sysSize; $('szval').textContent = sysSize; }
    Object.keys(disp).forEach(function (k) {
      var el = document.querySelector('[data-sw="' + k + '"]');
      if (el) { el.classList.toggle('on', disp[k]); el.setAttribute('aria-checked', disp[k]); }
    });
  }
  function doDisplay(k, state) { disp[k] = state; applyDisplay(); syncDisplay(); }

  /* ── routes: parse a journal in-browser and push it onto the live map ─── */
  function wireDrop() {
    var drop = $('drop'), input = $('fileinput');
    if (!drop) return;
    drop.onclick = function () { input.click(); };
    input.onchange = function () { handleFiles(this.files); };
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (e) { handleFiles(e.dataTransfer.files); });
  }
  function handleFiles(files) {
    if (!files || !files.length) return;
    Array.prototype.forEach.call(files, function (f) {
      var rd = new FileReader();
      rd.onload = function () {
        var seen = {}, systems = [];
        String(rd.result).split(/\r?\n/).forEach(function (line) {
          if (line.indexOf('FSDJump') < 0) return;
          try {
            var j = JSON.parse(line);
            if (j.event !== 'FSDJump' || !j.StarPos || !j.StarSystem) return;
            if (seen[j.StarSystem]) return;
            seen[j.StarSystem] = 1;
            systems.push({ name: j.StarSystem, infos: 'From ' + f.name,
              coords: { x: j.StarPos[0], y: j.StarPos[1], z: -j.StarPos[2] } });
          } catch (err) { /* not a JSON line — journals are line-delimited */ }
        });
        if (!systems.length) {
          $('drop').innerHTML = 'No <b>FSDJump</b> entries in ' + esc(f.name) + '.<br>Try a Journal*.log.';
          return;
        }
        Ed3d.addBatch({ systems: systems });
        extraRoutes.push({ name: f.name, count: systems.length });
        renderPanel();
      };
      rd.readAsText(f);
    });
  }

  /* ── 3D / 2D — Ed3d's own switch ──────────────────────────────────────── */
  function setViewButtons(m) {
    $('v3d').classList.toggle('on', m === '3d');
    $('v2d').classList.toggle('on', m === '2d');
    $('v3d').setAttribute('aria-pressed', m === '3d');
    $('v2d').setAttribute('aria-pressed', m === '2d');
    $('hint').innerHTML = m === '3d'
      ? 'drag to orbit · scroll to zoom · WASD to fly · click a system'
      : 'drag to pan · scroll to zoom · click a system — camera locked overhead';
  }
  $('v3d').onclick = function () { doCamera('iso'); };
  $('v2d').onclick = function () { doCamera('top'); };
  // Zoom and pan are lcunfool's #nav-controls, restored rather than reimplemented.
  // Its centre button means "reset view", which by default calls
  // Action.moveInitalPosition() and returns to the fixed cameraPos — deep space
  // on several maps. Repointed at frameData() so the obvious button does the
  // useful thing; a second press widens to the full extent.
  (function repointReset() {
    var el = document.getElementById('nav-pan-reset');
    if (!el) { setTimeout(repointReset, 300); return; }
    if (window.jQuery) jQuery(el).off('mousedown touchstart');
    el.title = 'Frame the data';
    el.addEventListener('mousedown', function (e) {
      e.preventDefault(); e.stopPropagation();
      frameAll = !frameAll; frameData();
    });
  })();

  /* ── selection: poll Ed3d's own picking result ────────────────────────── */
  setInterval(function () {
    if (typeof Action === 'undefined' || !Action.selectedPoint) return;
    var p = Action.selectedPoint;
    // Grouped records key the system name as `n`, not `name`. Comparing the
    // wrong field meant this guard never matched, so the card was rebuilt and
    // selSite reset to 0 five times a second — which is why the card's site
    // rows snapped back to the first and the left panel's hover kept being
    // dragged back to the selected site's type.
    if (sel && sel.n === p.name) return;
    var rec = null;
    for (var i = 0; i < DATA.sys.length; i++) if (DATA.sys[i].n === p.name) { rec = DATA.sys[i]; break; }
    if (!rec) return;
    sel = rec; selSite = 0; renderCard();
    if (CFG.templates) showTemplate(TYPES[rec.s[0][0]]);
  }, 200);

  function renderCard() {
    var s = sel, q = encodeURIComponent(s.n);
    var site = s.s[selSite], ty = TYPES[site[0]], th = CFG.templates ? THUMBS[ty.toLowerCase()] : null;
    var tally = {}; s.s.forEach(function (x) { tally[x[0]] = (tally[x[0]] || 0) + 1; });
    var sum = Object.keys(tally).map(function (k) { return tally[k] + ' ' + TYPES[k]; }).join(' · ');
    var rows = s.s.map(function (si, i) {
      return '<div class="site' + (i === selSite ? ' on' : '') + '" data-i="' + i + '" role="button" tabindex="0">' +
        '<span class="sw" style="background:' + col(si[0]) + '"></span>' +
        '<span class="ty">' + esc(TYPES[si[0]]) + '</span>' +
        '<span class="bd">' + (si[1] ? esc(si[1]) : '—') + '</span></div>';
    }).join('');
    var link = '';
    if (CFG.panel === 'star' && s.s[0][2]) {
      link = '<div class="c-link">Guardian structure at <a href="?map=gs">' +
        esc(s.s[0][2]) + '</a> — open the Structures map</div>';
    }
    var c = $('card');
    c.className = 'card';
    c.innerHTML =
      '<div class="c-h"><div class="n">' + esc(s.n) + '</div>' +
        '<button class="x" id="cx" aria-label="Close">&times;</button></div>' +
      '<div class="c-meta">' + s.x + ' · ' + s.y + ' · ' + s.z + '<br>' +
        Math.round(Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z)).toLocaleString() + ' ly from Sol</div>' +
      '<div class="c-sec"><span>' + s.s.length + ' ' + CFG.unit + (s.s.length > 1 ? 's' : '') +
        '</span><b>' + esc(sum) + '</b></div>' + rows + link +
      (th ? '<div class="c-tmpl"><img src="' + th + '" alt="' + ty + ' template">' +
            '<div class="cap">' + ty + ' template — ' + (TNOTE[ty] || '') + '</div></div>' : '') +
      '<div class="c-acts">' +
        '<a href="https://signals.canonn.tech/?system=' + q + '" target="_blank" rel="noopener">Signals <span class="ax">&#8599;</span></a>' +
        '<a href="https://ruins.canonn.tech/" target="_blank" rel="noopener">Bifrost <span class="ax">&#8599;</span></a>' +
        '<a href="https://www.edsm.net/en/search/systems/index/name/' + q + '" target="_blank" rel="noopener">EDSM <span class="ax">&#8599;</span></a>' +
        '<a href="https://inara.cz/elite/starsystem/?search=' + q + '" target="_blank" rel="noopener">Inara <span class="ax">&#8599;</span></a>' +
        '<button id="ccopy">Copy name</button><button id="ccentre">Centre here</button>' +
      '</div>';
    $('cx').onclick = function () { sel = null; c.className = 'card hidden'; };
    $('ccopy').onclick = function () {
      var b = this;
      navigator.clipboard.writeText(s.n).then(function () {
        b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy name'; }, 1200);
      }).catch(function () { b.textContent = 'Copy failed'; });
    };
    $('ccentre').onclick = function () {
      controls.target.set(s.x, s.y, -s.z);
      moveTo({ x: s.x - 120, y: s.y + 90, z: -s.z + 120 });
    };
    Array.prototype.forEach.call(c.querySelectorAll('.site'), function (el) {
      el.onclick = function () { selSite = +el.dataset.i; renderCard(); if (CFG.templates) showTemplate(TYPES[s.s[selSite][0]]); };
    });
    // Deliberately NOT calling showTemplate() here. renderCard() runs on every
    // card refresh, and doing so yanked the left panel's highlight away from
    // whatever the pointer was hovering.
  }

  /* ── map index: the browsable alternative to searching ────────────────── */
  function openIndex() {
    var live = 0, total = 0;
    var h = '';
    CATALOGUE.forEach(function (g) {
      h += '<div class="idx-g"><div class="idx-gt">' + g.g + ' <span style="color:var(--dimmer)">' +
        g.items.length + '</span></div><div class="idx-list">';
      g.items.forEach(function (m) {
        total++;
        var cur = m.id === mapId, isLive = !!m.id;
        if (isLive) live++;
        var cls = 'idx-i' + (cur ? ' cur' : (isLive ? ' live' : ''));
        var tag = cur ? 'Showing now' : (isLive ? 'Wired to live data' : 'On the live site');
        h += m.id
          ? '<a class="' + cls + '" href="?map=' + m.id + '"><div class="n">' + esc(m.n) +
            '</div><div class="d">' + esc(m.d) + '</div><div class="s">' + tag + '</div></a>'
          : '<div class="' + cls + '"><div class="n">' + esc(m.n) + '</div><div class="d">' +
            esc(m.d) + '</div><div class="s">' + tag + '</div></div>';
      });
      h += '</div></div>';
    });
    $('idxbody').innerHTML = h;
    $('idxsub').textContent = total + ' maps · ' + live + ' wired up in this prototype';
    $('idxscrim').classList.add('open');
  }
  $('switcher').onclick = openIndex;
  $('idxclose').onclick = function () { $('idxscrim').classList.remove('open'); };
  $('idxscrim').addEventListener('mousedown', function (e) {
    if (e.target === this) this.classList.remove('open');
  });

  /* ── command palette ──────────────────────────────────────────────────── */
  var psel = 0, pflat = [];
  function openPal(pre) {
    $('scrim').classList.add('open'); $('pq').value = pre || ''; psel = 0; renderPal(); $('pq').focus();
  }
  function closePal() { $('scrim').classList.remove('open'); }
  $('findbtn').onclick = function () { openPal(''); };
  $('toolsbtn').onclick = function () { openPal('>tools '); };
  $('scrim').addEventListener('mousedown', function (e) { if (e.target === this) closePal(); });

  function hl(t, q) {
    if (!q) return esc(t);
    var i = t.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return esc(t);
    return esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + q.length)) + '</mark>' + esc(t.slice(i + q.length));
  }
  function allMaps() {
    var out = [];
    CATALOGUE.forEach(function (g) {
      g.items.forEach(function (m) { out.push({ n: m.n, id: m.id, g: g.g }); });
    });
    return out;
  }
  function renderPal() {
    var raw = $('pq').value.trim(), only = null, term = raw;
    if (raw.indexOf('>tools') === 0) { only = 'tools'; term = raw.slice(6).trim(); }
    else if (raw.indexOf('>map') === 0) { only = 'maps'; term = raw.slice(4).trim(); }
    var lo = term.toLowerCase(), h = ''; pflat = [];
    function grp(label, rows, more) {
      if (!rows.length) return;
      h += '<div class="pg">' + label + (more ? ' <span style="color:#2B3742">' + more + '</span>' : '') + '</div>';
      rows.forEach(function (r) {
        var i = pflat.length; pflat.push(r);
        h += '<div class="pr' + (r.k === 'tool' ? ' ext' : '') + '" role="option" data-i="' + i +
          '" aria-selected="' + (i === psel ? 'true' : 'false') + '"><span class="ic">' +
          (r.k === 'tool' ? '&#8599;' : r.k === 'sys' ? '&#10022;' : '&#9635;') +
          '</span><span class="nm">' + hl(r.t, term) + '</span><span class="mt">' + esc(r.m) + '</span></div>';
      });
    }
    if (only !== 'tools') {
      var ms = allMaps().filter(function (m) { return !lo || m.n.toLowerCase().indexOf(lo) > -1; });
      grp('Maps', ms.slice(0, 6).map(function (m) {
        return { k: 'map', t: m.n, m: m.id === mapId ? 'showing' : m.g, id: m.id };
      }), ms.length > 6 ? ms.length + ' total — ⌘⇧M to browse' : '');
    }
    if (only !== 'maps') {
      grp('Canonn tools', TOOLS.filter(function (t) { return !lo || t[0].toLowerCase().indexOf(lo) > -1; })
        .map(function (t) { return { k: 'tool', t: t[0], m: t[1], u: t[2] }; }));
    }
    if (!only && lo.length > 0) {
      grp('Systems on this map', DATA.sys.filter(function (s) {
        return s.n.toLowerCase().indexOf(lo) > -1;
      }).slice(0, 8).map(function (s) {
        var t = {}; s.s.forEach(function (x) { t[x[0]] = 1; });
        return { k: 'sys', t: s.n, m: Object.keys(t).map(function (k) { return TYPES[k]; }).join(' · '), s: s };
      }));
    }
    $('pres').innerHTML = h || '<div class="pal-empty">No match.</div>';
  }
  function palMove(d) {
    if (!pflat.length) return;
    psel = (psel + d + pflat.length) % pflat.length; renderPal();
    var el = $('pres').querySelector('[data-i="' + psel + '"]');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }
  function palRun() {
    var r = pflat[psel]; if (!r) return;
    if (r.k === 'tool') { window.open(r.u, '_blank', 'noopener'); closePal(); return; }
    if (r.k === 'sys') {
      closePal(); sel = r.s; selSite = 0; renderCard();
      if (CFG.templates) showTemplate(TYPES[r.s.s[0][0]]);
      controls.target.set(r.s.x, r.s.y, -r.s.z);
      moveTo({ x: r.s.x - 120, y: r.s.y + 90, z: -r.s.z + 120 });
      return;
    }
    closePal();
    if (r.id) { location.search = '?map=' + r.id; }
    else { openIndex(); }
  }
  $('pq').addEventListener('input', function () { psel = 0; renderPal(); });
  $('pq').addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); palMove(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); palMove(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); palRun(); }
    else if (e.key === 'Escape') { closePal(); }
  });
  $('pres').addEventListener('mousemove', function (e) {
    var r = e.target.closest('.pr'); if (!r) return;
    var i = +r.dataset.i; if (i !== psel) { psel = i; renderPal(); }
  });
  $('pres').addEventListener('click', function (e) {
    var r = e.target.closest('.pr'); if (!r) return;
    psel = +r.dataset.i; palRun();
  });
  document.addEventListener('keydown', function (e) {
    var k = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && k === 'm') { e.preventDefault(); closePal(); openIndex(); }
    else if ((e.metaKey || e.ctrlKey) && k === 'k') { e.preventDefault(); openPal(''); }
    else if (e.key === 'Escape') { closePal(); $('idxscrim').classList.remove('open'); }
  });
})();
