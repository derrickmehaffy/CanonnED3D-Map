/* Canonn Map Console — chrome for the real Ed3d map.
 *
 * Injects the interface (top bar, icon rail, side panels, status strip, command
 * palette, map index) around whatever map the page already loads, then drives
 * it through Ed3d's own API. Nothing here re-implements the renderer, and
 * nothing here is map-specific: a page opts in with
 *
 *     <link rel="stylesheet" href="css/console.css">
 *     <script defer src="js/console.js"></script>
 *
 * placed BEFORE its MapData-*.js, and drops its include/nav.html div.
 *
 * How it stays generic across all 29 pages:
 *   - Categories are whatever Ed3d built. The console reads the real
 *     .map_filter anchors out of #filters and proxies clicks back to them, so
 *     route toggling, colour handling and recentring stay Ed3d's job. A map
 *     with 2 categories and one with 18 need no configuration either way.
 *   - Systems come from System.points, the index-aligned metadata array.
 *   - The map's name comes from <title>.
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ── boot screen ────────────────────────────────────────────────────────
     The R&D animated logo from the landing page, reused as the loader.

     The element keeps id="loading": every one of the 35 MapData-*.js files
     ends its load — including its error paths — with
         document.getElementById('loading').style.display = 'none'
     and nothing in the engine touches it. That id is an interface with the
     data layer, so the fade lives in an observer here rather than in the 35
     callers, and no data file has to change.                                */
  var Boot = (function () {
    var el, anim, dismissed = false, done = false;

    function say(txt, accent) {
      var m = $('bootmsg');
      if (m) m.innerHTML = accent ? esc(txt) + ' <b>' + esc(accent) + '</b>' : esc(txt);
    }

    function finish() {
      if (!el || done) return;
      done = true;
      if (anim) { try { anim.destroy(); } catch (e) {} anim = null; }
      // Hidden, not removed. The data layer dismisses the overlay with
      //   document.getElementById('loading').style.display = 'none'
      // and some maps only get there long after the scene is up — a slow or
      // failed fetch, or an error path. Removing the node makes that call
      // throw on null and take Ed3d.init() down with it. display:none is
      // enough: it stops the overlay covering the canvas and swallowing
      // clicks, and the contract keeps working however late the call comes.
      el.innerHTML = '';
      el.style.display = 'none';
    }

    function dismiss() {
      if (dismissed || !el) return;
      dismissed = true;
      el.style.display = '';            // undo the caller's hide so it can fade
      el.classList.add('done');
      el.addEventListener('transitionend', finish, { once: true });
      setTimeout(finish, 800);          // in case the transition never fires
    }

    function mount() {
      el = $('loading');
      if (!el) return;

      new MutationObserver(function () {
        if (el && el.style.display === 'none') dismiss();
      }).observe(el, { attributes: true, attributeFilter: ['style'] });

      if (!window.bodymovin) { el.classList.add('nolottie'); return; }

      // rd-banner is a 15 s build-and-fade: frame 0 is empty, limpets fly in
      // and assemble the atom by ~300, and the whole thing fades out at ~440.
      // Looped from the top it is blank for most of a short load and dissolves
      // on a long one, so the assembly runs once and then holds on the formed
      // logo, which orbits. The segments meet at 300, so the hand-off is
      // invisible and the loader never shows an empty frame.
      var ASSEMBLE = [110, 400], SUSTAIN = [300, 400];

      var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      try {
        anim = window.bodymovin.loadAnimation({
          container: $('bootlogo'),
          renderer: 'svg',
          loop: false,
          autoplay: false,
          rendererSettings: { progressiveLoad: false },
          path: 'data/rd-banner-v2-1.json'
        });
        anim.addEventListener('data_failed', function () { if (el) el.classList.add('nolottie'); });
        anim.addEventListener('DOMLoaded', function () {
          if (!anim) return;
          if (still) { anim.goToAndStop(SUSTAIN[1], true); return; }
          anim.addEventListener('complete', function () {
            if (!anim) return;
            anim.loop = true;
            anim.playSegments([SUSTAIN], true);
          });
          anim.playSegments([ASSEMBLE], true);
        });
      } catch (e) {
        el.classList.add('nolottie');
      }
    }

    return { mount: mount, say: say, dismiss: dismiss };
  })();
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function col(i) { return PALETTE[i % PALETTE.length]; }

  /* ── build Ed3d's data structure from the prepared snapshot ───────────── */



  var SHELL = [
  "    <div class=\"app\">",
  "      <div class=\"top\">",
  "        <svg class=\"mark\" viewBox=\"0 0 40 40\" aria-hidden=\"true\">",
  "          <ellipse cx=\"20\" cy=\"20\" rx=\"17\" ry=\"7\" fill=\"none\" stroke=\"#FF9D00\" stroke-width=\"2.4\"/>",
  "          <ellipse cx=\"20\" cy=\"20\" rx=\"17\" ry=\"7\" fill=\"none\" stroke=\"#FF9D00\" stroke-width=\"2.4\" transform=\"rotate(60 20 20)\"/>",
  "          <ellipse cx=\"20\" cy=\"20\" rx=\"17\" ry=\"7\" fill=\"none\" stroke=\"#FF9D00\" stroke-width=\"2.4\" transform=\"rotate(120 20 20)\"/>",
  "          <circle cx=\"20\" cy=\"20\" r=\"5\" fill=\"#FF9D00\"/>",
  "        </svg>",
  "        <button class=\"switch\" id=\"switcher\" title=\"Browse all maps\">",
  "          <span id=\"mapname\"></span> <span class=\"ch\">&#9662;</span></button>",
  "        <button class=\"find\" id=\"findbtn\">Find anything <span class=\"k\">&#8984;K</span></button>",
  "        <span class=\"sp\"></span>",
  "        <span class=\"feed\" id=\"feed\"><span class=\"d\"></span><span id=\"feedtxt\">loading&#8230;</span></span>",
  "        <div class=\"toprail\">",
  "          <button class=\"tb\" id=\"toolsbtn\" title=\"Canonn tools\">&#8862; Tools</button>",
  "          <a class=\"tb\" href=\"https://github.com/canonn-science/CanonnED3D-Map\" target=\"_blank\"",
  "             rel=\"noopener\" title=\"Source on GitHub\">GitHub</a>",
  "          <a class=\"tb donate\" href=\"https://canonn.science/donate/\" target=\"_blank\"",
  "             rel=\"noopener\" title=\"Support Canonn\">Donate</a>",
  "        </div>",
  "      </div>",
  "      <div class=\"mid\">",
  "        <div class=\"rail\">",
  "          <button class=\"on\" data-p=\"layers\" title=\"Layers\" aria-label=\"Layers\"><i class=\"fa fa-filter\"></i></button>",
  "          <button data-p=\"systems\" title=\"Systems on this map\" aria-label=\"Systems on this map\"><i class=\"fa fa-list\"></i></button>",
  "          <button data-p=\"camera\" title=\"Camera\" aria-label=\"Camera\"><i class=\"fa fa-crosshairs\"></i></button>",
  "          <button data-p=\"routes\" title=\"Routes &amp; journals\" aria-label=\"Routes and journals\"><i class=\"fa fa-location-arrow\"></i></button>",
  "          <button data-p=\"display\" title=\"Display\" aria-label=\"Display\"><i class=\"fa fa-adjust\"></i></button>",
  "        </div>",
  "        <aside class=\"side\" id=\"side\"></aside>",
  "        <div class=\"stage\">",
  "          <div id=\"console-stage-slot\"></div>",
  "          <div class=\"viewmode\" role=\"group\" aria-label=\"View mode\">",
  "            <button id=\"v3d\" class=\"on\" aria-pressed=\"true\">3D</button>",
  "            <button id=\"v2d\" aria-pressed=\"false\">2D</button>",
  "          </div>",
  "          <div class=\"hint\" id=\"hint\">drag to orbit &#183; scroll to zoom &#183; click a system</div>",
  "          <div class=\"card hidden\" id=\"card\"></div>",
  "        </div>",
  "      </div>",
  "      <div class=\"strip\">",
  "        <div class=\"cell\"><span class=\"lb\">Target</span><span class=\"vl\" id=\"st-pos\">&#8212;</span></div>",
  "        <div class=\"cell\"><span class=\"lb\">Sol</span><span class=\"vl\" id=\"st-sol\">&#8212;</span></div>",
  "        <div class=\"cell\"><span class=\"lb\">Shown</span><span class=\"vl ion\" id=\"st-shown\">&#8212;</span></div>",
  "        <div class=\"cell end\"><span class=\"lb\">Map</span><span class=\"vl\" id=\"st-map\">&#8212;</span></div>",
  "      </div>",
  "    </div>",
  "    <div class=\"scrim pal-scrim\" id=\"scrim\">",
  "      <div class=\"pal\" role=\"dialog\" aria-label=\"Find anything\">",
  "        <div class=\"pal-in\"><span class=\"cr\">&gt;</span>",
  "          <input id=\"pq\" type=\"text\" placeholder=\"Search systems, maps and Canonn tools&#8230;\"",
  "                 autocomplete=\"off\" spellcheck=\"false\" aria-label=\"Search\"></div>",
  "        <div class=\"pal-res\" id=\"pres\" role=\"listbox\"></div>",
  "        <div class=\"pal-foot\"><span>&#8593;&#8595; move</span><span>&#8629; open</span>",
  "          <span>esc close</span><span>&#8984;&#8679;M browse all maps</span></div>",
  "      </div>",
  "    </div>",
  "    <div class=\"scrim idx-scrim\" id=\"idxscrim\">",
  "      <div class=\"idx\" role=\"dialog\" aria-label=\"All maps\">",
  "        <div class=\"idx-h\">",
  "          <h2>All maps</h2>",
  "          <span class=\"sub\" id=\"idxsub\"></span>",
  "          <button class=\"x\" id=\"idxclose\" aria-label=\"Close\">&times;</button>",
  "        </div>",
  "        <div class=\"idx-b\" id=\"idxbody\"></div>",
  "      </div>",
  "    </div>"
  ].join('\n');

  /* ── shell ──────────────────────────────────────────────────────────────
     The page ships a bare <div id="edmap"> with the boot overlay inside it,
     exactly as every map page always has. The chrome is injected around it
     here rather than pasted into 29 files, so the interface stays in one
     place and a page opts in with a stylesheet link and a script tag.

     #edmap is *moved*, not recreated: Ed3d has not run yet (this script is
     ordered before the MapData file), and moving the element keeps the boot
     overlay and its id="loading" contract intact. */
  function buildShell() {
    var map = $('edmap');
    if (!map) return false;

    var host = document.createElement('div');
    host.innerHTML = SHELL;
    while (host.firstChild) document.body.appendChild(host.firstChild);

    var slot = $('console-stage-slot');
    slot.parentNode.replaceChild(map, slot);
    document.body.classList.add('console');
    if (window.CONSOLE && window.CONSOLE.bare) document.body.classList.add('bare');
    return true;
  }

  if (!buildShell()) return;      // no #edmap: not a map page, leave it alone
  Boot.mount();
  Boot.say('Loading', MAPNAME);

  /* ── the map catalogue ──────────────────────────────────────────────────
     Generated from include/nav.html so replacing the nav loses no destination:
     every one of its 84 map links, in its own groups, reachable from the map
     index (Cmd/Ctrl+Shift+M) and the command palette. */
  var CATALOGUE = [
    { g: "CanonnED3D", items: [
      { n: "CanonnED3D", u: "index.html" },
      // Not from the old nav: the orrery is new, and it is a destination
      // rather than a map, so it goes at the top with the index.
      { n: "Orrery", u: "orrery.html" }
    ]},
    { g: "Guardians", items: [
      { n: "Brain Trees", u: "bt-data.html" },
      { n: "Guardian Beacons", u: "gb-data.html" },
      { n: "Guardian Ruins", u: "gr-data.html" },
      { n: "Guardian Structures", u: "gs-data.html" },
      { n: "Combo Maps", u: "guardians-combo.html" },
      { n: "Alien Data Maps", u: "aliens-combo.html" }
    ]},
    { g: "Thargoids", items: [
      { n: "Thargoid Barnacles", u: "tb-data.html" },
      { n: "Thargoid Structures", u: "ts-data.html" },
      { n: "Hyperdictions", u: "hyperdiction_data.html" },
      { n: "Non-Human Signal Sources", u: "nhss-data.html" },
      { n: "Thargoid Link Messages: 3305 Survey", u: "ts-msg_3305survey.html" },
      { n: "Unknown Insterstellar Anomaly", u: "route_uia.html" },
      { n: "Combo Maps", u: "thargoids-combo.html" },
      { n: "Alien Data Maps", u: "aliens-combo.html" }
    ]},
    { g: "Cartographics", items: [
      { n: "Landscape Signal", u: "landscape_signal.html" },
      { n: "Generation Ships", u: "gen-data.html" },
      { n: "Megaships", u: "megaships-data.html" },
      { n: "Operation Ida", u: "ida-data.html" },
      { n: "Galactic Exploration Catalog", u: "gec.html" },
      { n: "Galnet News Digest - Relay Stations", u: "galnet.html" },
      { n: "Permit Locked Regions", u: "permit-data.html" },
      { n: "Canonn Challenge Route", u: "canonn-challenge.html" },
      { n: "Gnosis Route Map", u: "gnosis_data.html" },
      { n: "Adamastor Route", u: "route_adamastor.html" },
      { n: "Listening Posts", u: "listening_posts.html" },
      { n: "Voyager Pulsars", u: "voyager.html" }
    ]},
    { g: "Canonn Faction", items: [
      { n: "Canonn", u: "multifaction.html?factions=Canonn" },
      { n: "Canonn Deep Space Reseach", u: "multifaction.html?factions=Canonn+Deep+Space+Research" },
      { n: "Orion University", u: "multifaction.html?factions=Orion+University" },
      { n: "All Factions", u: "multifaction.html?factions=All" },
      { n: "All Canonn Factions", u: "multifaction.html?factions=Canonn,Canonn+Deep+Space+Research,Orion+University" }
    ]},
    { g: "Biology", items: [
      { n: "Horizons Biology", u: "codex.html?hud_category=Biology" },
      { n: "Amphora Plant", u: "codex.html?hud_category=Biology&sub_class=Amphora Plant" },
      { n: "Anemone", u: "codex.html?hud_category=Biology&sub_class=Anemone" },
      { n: "Bark Mounds", u: "codex.html?hud_category=Biology&sub_class=Bark Mounds" },
      { n: "Brain Tree", u: "bt-data.html" },
      { n: "Shards", u: "codex.html?hud_category=Biology&sub_class=Shards" },
      { n: "Thargoid Barnacles", u: "tb-data.html" },
      { n: "Tubers", u: "codex.html?hud_category=Biology&sub_class=Tubers" },
      { n: "Aleoids", u: "codex.html?hud_category=Biology&sub_class=Aleoids" },
      { n: "Bacterial", u: "codex.html?hud_category=Biology&sub_class=Bacterial" },
      { n: "Cactoid", u: "codex.html?hud_category=Biology&sub_class=Cactoid" },
      { n: "Clypeus", u: "codex.html?hud_category=Biology&sub_class=Clypeus" },
      { n: "Conchas", u: "codex.html?hud_category=Biology&sub_class=Conchas" },
      { n: "Electricae", u: "codex.html?hud_category=Biology&sub_class=Electricae" },
      { n: "Fonticulus", u: "codex.html?hud_category=Biology&sub_class=Fonticulus" },
      { n: "Fumerolas", u: "codex.html?hud_category=Biology&sub_class=Fumerolas" },
      { n: "Fungoids", u: "codex.html?hud_category=Biology&sub_class=Fungoids" },
      { n: "Osseus", u: "codex.html?hud_category=Biology&sub_class=Osseus" },
      { n: "Recepta", u: "codex.html?hud_category=Biology&sub_class=Recepta" },
      { n: "Shrubs", u: "codex.html?hud_category=Biology&sub_class=Shrubs" },
      { n: "Stratum", u: "codex.html?hud_category=Biology&sub_class=Stratum" },
      { n: "Tubus", u: "codex.html?hud_category=Biology&sub_class=Tubus" },
      { n: "Tussocks", u: "codex.html?hud_category=Biology&sub_class=Tussocks" }
    ]},
    { g: "Geology", items: [
      { n: "Crystalline Shards", u: "codex.html?hud_category=Biology&english_name=Crystalline Shards" },
      { n: "Fumaroles", u: "codex.html?hud_category=Geology&sub_class=Fumarole" },
      { n: "Gas Vents", u: "codex.html?hud_category=Geology&sub_class=Gas Vent" },
      { n: "Geysers", u: "codex.html?hud_category=Geology&sub_class=Geyser" },
      { n: "Lava Spouts", u: "codex.html?hud_category=Geology&sub_class=Lava Spout" }
    ]},
    { g: "Lagrange Clouds", items: [
      { n: "Clouds", u: "codex.html?hud_category=Cloud&english_name=%25Cloud" },
      { n: "Lagrange Cloud", u: "codex.html?hud_category=Cloud&sub_class=Lagrange Cloud" },
      { n: "Storm Cloud", u: "codex.html?hud_category=Cloud&sub_class=Storm Cloud" },
      { n: "Calcite Plates", u: "codex.html?hud_category=Cloud&sub_class=Calcite Plates" },
      { n: "Ice Crystals", u: "codex.html?hud_category=Cloud&sub_class=Ice Crystals" },
      { n: "Metallic Crystals", u: "codex.html?hud_category=Cloud&sub_class=Metallic Crystals" },
      { n: "Mineral Spheres", u: "codex.html?hud_category=Cloud&sub_class=Mineral Spheres" },
      { n: "Silicate Crystals", u: "codex.html?hud_category=Cloud&sub_class=Silicate Crystals" },
      { n: "Aster", u: "codex.html?hud_category=Cloud&sub_class=Aster" },
      { n: "Chalice Pod", u: "codex.html?hud_category=Cloud&sub_class=Chalice Pod" },
      { n: "Gyre", u: "codex.html?hud_category=Cloud&sub_class=Gyre" },
      { n: "Mollusc", u: "codex.html?hud_category=Cloud&sub_class=Mollusc" },
      { n: "Peduncle", u: "codex.html?hud_category=Cloud&sub_class=Peduncle" },
      { n: "Quadripartite", u: "codex.html?hud_category=Cloud&sub_class=Quadripartite" },
      { n: "Rhizome", u: "codex.html?hud_category=Cloud&sub_class=Rhizome" },
      { n: "Stolon", u: "codex.html?hud_category=Cloud&sub_class=Stolon" },
      { n: "Void", u: "codex.html?hud_category=Cloud&sub_class=Void" },
      { n: "Anomalies", u: "codex.html?hud_category=Anomaly" },
      { n: "E-Type Anomaly", u: "codex.html?hud_category=Anomaly&sub_class=E-Type Anomaly" },
      { n: "K-Type Anomaly", u: "codex.html?hud_category=Anomaly&sub_class=K-Type Anomaly" },
      { n: "L-Type Anomaly", u: "codex.html?hud_category=Anomaly&sub_class=L-Type Anomaly" },
      { n: "P-Type Anomaly", u: "codex.html?hud_category=Anomaly&sub_class=P-Type Anomaly" },
      { n: "Q-Type Anomaly", u: "codex.html?hud_category=Anomaly&sub_class=Q-Type Anomaly" },
      { n: "T-Type Anomaly", u: "codex.html?hud_category=Anomaly&sub_class=T-Type Anomaly" }
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

  /* ── state ──────────────────────────────────────────────────────────────
     CATS is read out of Ed3d's own HUD once the map is up; see readCats(). */
  var CATS = [];                           // [{ id, name, color, count }]
  var hoverType = null;
  var sel = null, panel = 'layers';
  var cardType = null;   // which type's site plan the card is showing
  var extraRoutes = [];                    // systems added from a dropped journal
  var sysQuery = '', sysSort = 'name';     // systems panel: filter text and order
  var lastScrolledTo = null;               // system the list last jumped to
  /* Most pages title themselves "CanonnED3D - Maps", so the title is no use as
     a name. The catalogue built from the nav has the real one for every map,
     query string included — that is what the nav displayed. */
  var MAPNAME = (function () {
    // Several catalogue entries can match one URL, because they are the same
    // page with progressively more parameters: codex.html?hud_category=Biology
    // is "Horizons Biology", and that same page with &english_name=Bark+Mounds
    // is "Bark Mounds". Both match, so take the one that matched on the most
    // parameters rather than the first one found.
    var best = null, bestScore = -1;
    for (var i = 0; i < CATALOGUE.length; i++) {
      var items = CATALOGUE[i].items;
      for (var j = 0; j < items.length; j++) {
        var score = pageMatchScore(items[j].u);
        if (score > bestScore) { bestScore = score; best = items[j].n; }
      }
    }
    if (best !== null) return best;
    var t = (document.title || '').replace(/^\s*CanonnED3D\s*[-–—]\s*/i, '').trim();
    return (!t || /^maps?$/i.test(t)) ? 'Canonn map' : t;
  })();

  /* Everything below has a working default, so a page needs no configuration.
     A page that wants to say "ruin" instead of "point", or ship template
     images, sets window.CONSOLE before this script runs. */
  var CFG = window.CONSOLE || {};
  CFG.unit      = CFG.unit || 'point';
  CFG.note      = CFG.note || '';
  CFG.panel     = CFG.panel || 'type';
  CFG.templates = !!CFG.templates;
  /* A page that is meant to be embedded in someone else's site — dcoh.watch
     iframes one — sets bare:true. It keeps the panels and the card, which are
     the map's own controls, and drops the Canonn top bar and status strip,
     which are this site's furniture and have no business inside a frame. */
  CFG.bare      = !!CFG.bare;
  var THUMBS = window.THUMBS || {};
  var TNOTE  = window.TNOTE  || {};

  function catName(i) { return (CATS[i] && CATS[i].name) || ''; }

  /* Preferences live in localStorage: they are per-reader conveniences, and
     the point of them is that they survive switching maps. Every access is
     guarded — a private window can make even reading throw, and losing the
     map over a remembered panel width would be a poor trade. */
  var STORE = 'canonn.console.';

  function remember(k, v) { try { localStorage.setItem(STORE + k, v); } catch (e) {} }
  function recall(k, dflt) {
    try {
      var v = localStorage.getItem(STORE + k);
      return v === null ? (dflt === undefined ? null : dflt) : v;
    } catch (e) { return dflt === undefined ? null : dflt; }
  }
  function recallBool(k, dflt) {
    var v = recall(k);
    return v === null || v === '' ? dflt : v === '1';
  }
  function recallNum(k, dflt) {
    var v = parseFloat(recall(k));
    return isNaN(v) ? dflt : v;
  }

  function setFeed(mode, txt) {
    $('feed').className = 'feed ' + mode;
    $('feedtxt').textContent = txt;
  }

  function on(i)  { return CATS[i] ? CATS[i].on : true; }
  /* System "infos" is authored HTML — the data files put <br>, thumbnails and
     Signals links in it, and Ed3d's own HUD always rendered it as markup.
     Escaping it showed the tags as text; dropping it straight into innerHTML
     trusts remote APIs (codex and GEC fill this field from the network). So
     render an allowlisted subset: structure and links survive, scripts,
     handlers and javascript: URLs do not. */
  var HTML_OK = { A:1, B:1, BR:1, DIV:1, EM:1, I:1, IMG:1, LI:1, OL:1, P:1,
                  SMALL:1, SPAN:1, STRONG:1, U:1, UL:1 };
  var ATTR_OK = { A: ['href', 'title'], IMG: ['src', 'alt', 'title'] };

  function safeHtml(html) {
    var doc;
    try {
      doc = new DOMParser().parseFromString('<body>' + (html || '') + '</body>', 'text/html');
    } catch (e) {
      return esc(html);
    }
    (function walk(node) {
      var children = Array.prototype.slice.call(node.childNodes);
      children.forEach(function (child) {
        if (child.nodeType === 3) return;                       // text is fine
        if (child.nodeType !== 1 || !HTML_OK[child.tagName]) {
          // Keep what it said, lose the element itself.
          if (child.nodeType === 1) {
            walk(child);
            while (child.firstChild) child.parentNode.insertBefore(child.firstChild, child);
          }
          child.parentNode.removeChild(child);
          return;
        }
        var keep = ATTR_OK[child.tagName] || [];
        Array.prototype.slice.call(child.attributes).forEach(function (a) {
          var ok = keep.indexOf(a.name.toLowerCase()) > -1;
          if (ok && /^(href|src)$/i.test(a.name) &&
              /^\s*(javascript|data(?!:image\/)):/i.test(a.value)) ok = false;
          if (!ok) child.removeAttribute(a.name);
        });
        if (child.tagName === 'A') {
          child.setAttribute('target', '_blank');
          child.setAttribute('rel', 'noopener noreferrer');
        }
        walk(child);
      });
    })(doc.body);
    return doc.body.innerHTML;
  }

  function col(i) { return (CATS[i] && CATS[i].color) || '#FF9D00'; }

  /* Ed3d builds a real HUD of category filters in #filters, hidden by
     console.css. Reading it is what keeps this file map-agnostic: whatever a
     map declared — 2 categories or 18, one group or three — turns up here with
     no per-map configuration. The colour is the swatch Ed3d already computed. */
  function readCats() {
    var out = [];
    document.querySelectorAll('#filters .map_filter').forEach(function (a) {
      var id = a.getAttribute('data-filter');
      var sw = a.querySelector('.check');
      /* Ed3d groups its filters under an <h2> per category group, and the
         console was dropping it. One group is fine without it — most maps
         have one. The landing page has a group per faction, so its panel read
         "Controlled, Present, Controlled, Present" with nothing saying whose. */
      var box = a.closest('#filters > div');
      var head = box && box.previousElementSibling;
      out.push({
        id: id,
        el: a,
        group: (head && head.tagName === 'H2' && (head.textContent || '').trim()) || '',
        // Ed3d appends its own "(14)" tally to the label; the console renders
        // the count in its own column, so drop it rather than show it twice.
        name: (a.textContent || '').trim().replace(/\s*\(\d+\)\s*$/, '') || id,
        color: (sw && sw.style.backgroundColor) || '#FF9D00',
        on: String(a.getAttribute('data-active')) !== '0',
        count: (window.Ed3d && Ed3d.catObjs[id] && Ed3d.catObjs[id].length) || 0
      });
    });
    return out;
  }

  function refreshCatCounts() {
    if (!window.Ed3d) return;
    CATS.forEach(function (c) {
      c.count = (Ed3d.catObjs[c.id] && Ed3d.catObjs[c.id].length) || 0;
    });
  }

  /* Toggling proxies the click straight back to Ed3d's own anchor. That keeps
     route visibility, custom materials, the dimming colour and the recentring
     behaviour in one place — the engine's — instead of a second copy here that
     would drift. #filters binds the handler by delegation, so a synthetic
     click is indistinguishable from a real one. */
  function setCatVisible(i, active) {
    var c = CATS[i];
    if (!c || c.on === active) return;
    c.on = active;
    if (window.jQuery) jQuery(c.el).trigger('click');
    else c.el.click();
    syncFilteredVisibility();
  }

  /* Ed3d dims a filtered-out system to #111111 rather than removing it. On a
     sparse map that reads as "off"; on a dense one hundreds of them blend
     additively into a grey haze that is hard to tell from real data. This
     pushes the state into the point cloud, which drops them from the draw. */
  function syncFilteredVisibility() {
    if (window.System && System.applyVisibility) System.applyVisibility(hideFiltered);
  }

  function setAllCats(active) {
    CATS.forEach(function (c, i) { setCatVisible(i, active); });
    renderPanel();
    updateShown();
  }

  /* The systems the console lists and frames. Ed3d's System.points is the
     index-aligned metadata array, so it doubles as the map's system list on
     every page. Points are grouped by name because a system holding several
     sites is several points. */
  var _sysCache = null, _sysCacheLen = -1;
  function invalidateSystems() { _sysCache = null; _sysCacheLen = -1; sysRowsCache = null; }
  function SYSLIST() {
    if (!window.System || !System.points || !System.points.length) return [];
    // Ed3d keeps appending points as batches arrive, so cache against the
    // length rather than once — the first call lands when only Sagittarius A*
    // exists and would otherwise pin the list at one system.
    if (_sysCache && _sysCacheLen === System.points.length) return _sysCache;

    var byName = {}, out = [];
    System.points.forEach(function (p, idx) {
      if (!p || !p.name) return;

      // point.cat is an array: one system can belong to several categories.
      var cats = Array.isArray(p.cat) ? p.cat : (p.cat == null ? [] : [p.cat]);

      // Ed3d registers Sagittarius A* on every map as a reference point with no
      // category. It is scaffolding, not the map's data, so it should not show
      // up in the system list or the totals. A map that declares no categories
      // at all is a different case — there everything is uncategorised, and
      // dropping it would empty the list.
      if (!cats.length && CATS.length) return;

      var rec = byName[p.name];
      if (!rec) {
        rec = byName[p.name] = { n: p.name, x: p.x, y: p.y, z: -p.z, s: [],
                                 idx: idx, entries: p.entries || 1 };
        out.push(rec);
      }
      // [category, infos, per-site link, point index]
      if (!cats.length) rec.s.push([0, p.infos || '', p.url || '', idx]);
      else cats.forEach(function (c) { rec.s.push([catIndexOf(c), p.infos || '', p.url || '', idx]); });
    });
    _sysCache = out;
    _sysCacheLen = System.points.length;
    return out;
  }
  function catIndexOf(id) {
    for (var i = 0; i < CATS.length; i++) if (CATS[i].id == id) return i;
    return 0;
  }

  var frameAll = false;
  function frameData() {
    if (typeof camera === 'undefined' || !SYSLIST().length) return;
    function med(a) {
      var b = a.slice().sort(function (m, n) { return m - n; });
      return b[Math.floor(b.length / 2)];
    }
    var pts = SYSLIST().map(function (s) { return { x: s.x, y: s.y, z: -s.z }; });
    var cx = med(pts.map(function (p) { return p.x; })),
        cy = med(pts.map(function (p) { return p.y; })),
        cz = med(pts.map(function (p) { return p.z; }));
    var d = pts.map(function (p) {
      var a = p.x - cx, b = p.y - cy, c = p.z - cz;
      return Math.sqrt(a * a + b * b + c * c);
    }).sort(function (m, n) { return m - n; });
    // Clipping to the median half only helps a big, genuinely bimodal set —
    // Guardian Ruins has a dense cluster near the bubble and a second one
    // ~20 kly out, so framing everything shows mostly empty space. On a small
    // or evenly spread map it just hides most of the data: Voyager's 16
    // pulsars reach 13 kly with no cluster to prefer. So only clip when there
    // are enough points to have outliers AND a real gap to cut at.
    var p50 = d[Math.floor(d.length * 0.5)], far = d[d.length - 1];
    var bimodal = d.length >= 50 && p50 > 0 && far / p50 >= 4;
    var radius = (frameAll || !bimodal) ? far : p50;
    var span = Math.max(radius * 2.2, 220);

    controls.target.set(cx, cy, cz);
    camera.position.set(cx - span * 0.42, cy + span * 0.5, cz + span * 0.7);
    controls.update();
    syncCamera();

    // Region labels used to be switched off automatically on a tight dataset,
    // on the grounds that one label can fill the view. In practice that just
    // looked like a broken toggle — they are wanted by default, and the
    // Display panel is there for anyone who disagrees.
    var z = $('zfit');
    if (z) z.title = frameAll ? 'Frame the main cluster' : 'Frame everything';
  }

  /* ── status strip, polled off Ed3d's own camera ───────────────────────── */
  var lastPointCount = -1;

  /* Ed3d keeps appending points after it first reports the data complete —
     codex.html finishes at 3,422 having been readable at 500 — and a map can
     replace its data outright through Ed3d.updateSystems(). Either way the
     panel and counts have to follow rather than being rendered once.

     The engine emits 'systemsChanged', so that is the signal. The length check
     in tick() stays as a backstop for data arriving by a path that does not
     announce itself. */
  var consoleReady = false;

  /* A map may draw a cached snapshot first and refresh underneath rather than
     hold an empty screen — the landing page does, because parsing the Spansh
     dump takes about three seconds even when the bytes come from cache. The
     status light says which of the two is on screen. */
  var showingSnapshot = false;
  function feedNow() {
    var n = SYSLIST().length + ' systems';
    setFeed(showingSnapshot ? 'snapshot' : 'live',
            showingSnapshot ? n + ' · refreshing' : n);
  }
  if (window.Ed3d && Ed3d.on) Ed3d.on('dataSnapshot', function () {
    showingSnapshot = true;
    if (consoleReady) feedNow();
  });

  function syncToData() {
    if (!window.System || !System.points) return;
    // 'systemsChanged' fires from loadDatasComplete, which runs before
    // whenReady has read the categories out of Ed3d's HUD. Acting on it that
    // early would build the system list with CATS still empty — and an empty
    // CATS is how SYSLIST tells "this map has no categories" from "the
    // categories have not been read yet", so Ed3d's uncategorised reference
    // point would be counted as a system and then cached that way.
    if (!consoleReady) return;
    lastPointCount = System.points.length;
    invalidateSystems();
    if (arguments.length && arguments[0] && arguments[0].replaced) {
      CATS = readCats();
      // A replacement is the refreshed dataset landing, so whatever snapshot
      // was on screen is no longer what is being shown.
      showingSnapshot = false;
    }
    refreshCatCounts();
    updateShown();
    if (panel === 'layers' || panel === 'systems') renderPanel();
    feedNow();
  }

  if (window.Ed3d && Ed3d.on) Ed3d.on('systemsChanged', syncToData);

  function tick() {
    if (typeof controls === 'undefined' || !controls) return;

    if (window.System && System.points && System.points.length !== lastPointCount) {
      syncToData();
    }

    var t = controls.target;
    applyDisplay();
    $('st-pos').textContent = Math.round(t.x) + ' · ' + Math.round(t.y) + ' · ' + Math.round(-t.z);
    $('st-sol').textContent = Math.round(Math.sqrt(t.x * t.x + t.y * t.y + t.z * t.z)).toLocaleString() + ' ly';
  }
  function updateShown() {
    var shownSys = 0, shownUnits = 0;
    SYSLIST().forEach(function (s) {
      var any = false;
      s.s.forEach(function (site) { if (on(site[0])) { shownUnits++; any = true; } });
      if (any) shownSys++;
    });
    $('st-shown').textContent = shownSys + ' / ' + SYSLIST().length + ' sys · ' +
      shownUnits + ' ' + CFG.unit + 's';
  }

  /* ── category filtering, using Ed3d's own catObjs index ───────────────── */
  function counts() {
    var c = CATS.map(function () { return 0; });
    SYSLIST().forEach(function (s) { s.s.forEach(function (site) { c[site[0]]++; }); });
    return c;
  }

  function panelLayers() {
    var c = counts(), multi = 0, mixed = 0;
    SYSLIST().forEach(function (s) {
      if (s.s.length > 1) multi++;
      var t = {}; s.s.forEach(function (x) { t[x[0]] = 1; });
      if (Object.keys(t).length > 1) mixed++;
    });
    var sites = c.reduce(function (a, b) { return a + b; }, 0);
    var allOn = CATS.every(function (c) { return c.on; });
    var allOff = CATS.every(function (c) { return !c.on; });
    // The heading is the map's own name for what it filters, read off Ed3d's
    // category group rather than assumed. Several groups have no one name.
    var groups = [];
    CATS.forEach(function (cat, i) {
      if (c[i] && cat.group && groups.indexOf(cat.group) < 0) groups.push(cat.group);
    });
    var title = CFG.panel === 'star' ? 'Primary star'
              : (groups.length === 1 ? groups[0] : 'Site type');

    var h = '<div class="s-t">' + esc(title) + '</div>' +
      '<div class="s-sub"><b>' + SYSLIST().length + '</b> systems · <b>' + sites + '</b> ' + CFG.unit + 's</div>' +
      '<div class="selrow">' +
      '<button data-all="1"' + (allOn ? ' disabled' : '') + '>Select all</button>' +
      '<button data-all="0"' + (allOff ? ' disabled' : '') + '>Clear</button>' +
      '</div>' +
      // Part of the same control as the two buttons above: they say which
      // types are on, this says what "off" looks like. It belongs with them
      // rather than trailing the rows they act on.
      '<label class="hidechk"><input type="checkbox" id="hidefilt"' +
      (hideFiltered ? ' checked' : '') + '> Hide deselected entirely</label>';
    var lastGroup = null;
    CATS.forEach(function (cat, i) {
      var t = cat.name;
      if (!c[i]) return;
      if (groups.length > 1 && cat.group !== lastGroup) {
        lastGroup = cat.group;
        h += '<div class="lgrp">' + esc(cat.group) + '</div>';
      }
      h += '<div class="layer' + (on(i) ? '' : ' off') + (hoverType === t ? ' sel' : '') +
        '" data-t="' + i + '" role="button" tabindex="0" aria-pressed="' + on(i) + '">' +
        '<span class="sw" style="background:' + col(i) + '"></span>' +
        '<span class="nm" title="' + esc(t) + '">' + esc(t) + '</span>' +
        '<span class="ct">' + c[i] + '</span></div>';
    });
    var note = esc(CFG.note) +
      (multi ? (CFG.note ? '<br><br>' : '') + '<b>' + multi + '</b> systems hold more than one, <b>' +
        mixed + '</b> mixing types.' : '');
    if (note) h += '<div class="note">' + note + '</div>';
    if (CFG.templates) {
      h += '<div class="s-t sec">Site plan</div>';
      h += '<div class="tmplpick">' + CATS.map(function (cat, i) {
        if (!c[i]) return '';
        return '<button class="tchip' + (cat.name === hoverType ? ' on' : '') + '" data-t="' + i + '">' +
          '<span class="sw" style="background:' + col(i) + '"></span>' + esc(cat.name) + '</button>';
      }).join('') + '</div>';
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
      '<div class="note">Top down is the same view as the 2D button. Zoom and pan ' +
      'are the arrows in the bottom-right corner.</div>';
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
    h += '<div class="note">Your journal files are read in the browser and never ' +
      'uploaded — nothing leaves your machine. Every system you have jumped to is ' +
      'added to the map.</div>';
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
      '<div class="note">Turn off whatever gets in the way. System size makes the ' +
      'stars larger or smaller without changing what is shown.</div>' +
      '<div class="s-t" style="margin-top:18px">Lighting</div>' +
      '<div class="s-sub">Experimental</div>' +
      sw('hdr', 'HDR + bloom', disp.hdr) +
      '<div class="row" style="margin-top:10px"><span class="lb">Exposure</span>' +
      '<span class="vv" id="expval">—</span></div>' +
      '<input type="range" id="exprange" min="20" max="200" step="5" style="width:100%">' +
      '<div class="row" style="margin-top:10px"><span class="lb">Bloom</span>' +
      '<span class="vv" id="bloomval">—</span></div>' +
      '<input type="range" id="bloomrange" min="0" max="200" step="5" style="width:100%">' +
      '<div class="note">Keeps dense regions from washing out to white, so ' +
      'crowded clusters stay readable. Exposure sets the overall brightness; ' +
      'bloom adds a glow around the brightest systems — it suits sparse maps ' +
      'and tends to smear crowded ones, so it starts at zero.</div>';
  }

  function renderPanel() {
    var host = $('side');
    host.innerHTML = panel === 'layers'  ? panelLayers()
                   : panel === 'systems' ? panelSystems()
                   : panel === 'camera'  ? panelCamera()
                   : panel === 'routes'  ? panelRoutes()
                   : panelDisplay();
    // renderPanel replaces the panel's contents, so the resize grip — which
    // lives in the panel so it can sit on its edge — has to be put back.
    if (typeof sideGrip !== 'undefined' && sideGrip && !sideGrip.parentNode) {
      host.appendChild(sideGrip);
    }
    if (panel === 'systems') fillSysList();
    if (panel === 'layers' && CFG.templates) showTemplate(hoverType);
    if (panel === 'camera') syncCamera();
    if (panel === 'display') syncDisplay();
    if (panel === 'routes') wireDrop();
    if (panel === 'systems') {
      var f = $('sysfilter');
      if (f) {
        f.oninput = function () { sysQuery = this.value; resetSysList(); renderPanel(); $('sysfilter').focus(); };
        if (sysQuery) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
      }
      // Only chase the selection when it has actually changed. The panel
      // re-renders whenever the data does, and scrolling on every render
      // dragged the list away from wherever the reader had put it.
      var cur = host.querySelector('.sysrow.on');
      if (cur && sel && sel.n !== lastScrolledTo) {
        lastScrolledTo = sel.n;
        cur.scrollIntoView({ block: 'nearest' });
      }
      if (!sel) lastScrolledTo = null;
    }
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
      el.classList.toggle('sel', catName(+el.dataset.t) === t);
    });
  }

  /* rail + panel events (delegated, so re-rendering the panel is safe) */
  document.querySelector('.rail').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-p]'); if (!b) return;
    var p = b.dataset.p;
    if (p === panel && !$('side').classList.contains('hidden')) {
      $('side').classList.add('hidden');
      remember('collapsed', '1');
      b.classList.remove('on');
    } else {
      panel = p;
      $('side').classList.remove('hidden');
      remember('collapsed', '');
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

      setCatVisible(i, !on(i));
      renderPanel(); updateShown();
      return;
    }
    var srow = e.target.closest('.sysrow[data-sys]');
    if (srow) {
      var name = srow.dataset.sys;
      for (var k = 0; k < SYSLIST().length; k++) {
        if (SYSLIST()[k].n === name) { gotoSystem(SYSLIST()[k]); break; }
      }
      return;
    }
    var chip = e.target.closest('.tchip');
    if (chip) { showTemplate(catName(+chip.dataset.t)); renderPanel(); return; }
    var all = e.target.closest('[data-all]');
    if (all) { setAllCats(all.dataset.all === '1'); return; }
    var srt = e.target.closest('[data-sort]');
    if (srt) resetSysList();
    if (srt) { sysSort = srt.dataset.sort; renderPanel(); return; }
    var cam = e.target.closest('[data-cam]');
    if (cam) { doCamera(cam.dataset.cam); return; }
    var swt = e.target.closest('[data-sw]');
    if (swt) { doDisplay(swt.dataset.sw, !swt.classList.contains('on')); return; }
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
    if (e.target.id === 'hidefilt') {
      hideFiltered = e.target.checked;
      remember('hideFiltered', hideFiltered ? '1' : '0');
      syncFilteredVisibility();
      return;
    }
    if (e.target.id === 'sizerange') {
      sysSize = +e.target.value;
      remember('sysSize', sysSize);
      applySize();
      $('szval').textContent = sysSize;
    }
    if (e.target.id === 'exprange' && window.PostFX) {
      var v = +e.target.value / 100;
      remember('exposure', v);
      PostFX.setExposure(v);
      $('expval').textContent = v.toFixed(2);
    }
    if (e.target.id === 'bloomrange' && window.PostFX) {
      var b = +e.target.value / 100;
      remember('bloom', b);
      PostFX.setBloom(b);
      $('bloomval').textContent = b.toFixed(2);
    }
  });

  /* ── display ──────────────────────────────────────────────────────────
     These three fight the engine's own far-view logic: crossing the far-view
     threshold calls enableFarView/disableFarView, which reach in and set grid
     visibility, galaxy labels and the starfield themselves. So the panel keeps
     its own intent and re-asserts it on a timer rather than setting once. */
  var disp = {
    grid:   recallBool('disp.grid', true),
    galaxy: recallBool('disp.galaxy', true),
    stars:  recallBool('disp.stars', true),
    hdr:    recallBool('disp.hdr', true)
  };
  var hideFiltered = recallBool('hideFiltered', true);
  var sysSize = recallNum('sysSize', 20);  // flares got huge on zoom-out at 64

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
    // 20 is the slider's midpoint and reproduces the engine's own sizing, so
    // the control reads as "bigger/smaller than default" rather than as an
    // absolute. The clamp stays wide: it is there to stop flares swallowing
    // the screen at extreme zoom, not to do the scaling.
    Ed3d.systemSizeScale = sysSize / 20;
    Ed3d.effectScaleSystem = [Math.max(2, sysSize * 0.25), 400];
    if (typeof Action !== 'undefined') Action.prevScale = null;  // force recompute
    System.scaleSize = sysSize;
  }

  function syncDisplay() {
    var s = $('sizerange');
    if (s) { s.value = sysSize; $('szval').textContent = sysSize; }
    var e = $('exprange');
    if (e && window.PostFX) {
      e.value = Math.round(PostFX.exposure * 100);
      $('expval').textContent = PostFX.exposure.toFixed(2);
    }
    var bl = $('bloomrange');
    if (bl && window.PostFX) {
      bl.value = Math.round(PostFX.strength * 100);
      $('bloomval').textContent = PostFX.strength.toFixed(2);
    }
    Object.keys(disp).forEach(function (k) {
      var el = document.querySelector('[data-sw="' + k + '"]');
      if (el) { el.classList.toggle('on', disp[k]); el.setAttribute('aria-checked', disp[k]); }
    });
  }
  function doDisplay(k, state) {
    disp[k] = state;
    remember('disp.' + k, state ? '1' : '0');
    if (k === 'hdr' && window.PostFX) PostFX.toggle(state);
    applyDisplay(); syncDisplay();
  }

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
        invalidateSystems();
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
    // the card rebuilt five times a second — which is why its site
    // rows snapped back to the first and the left panel's hover kept being
    // dragged back to the selected site's type.
    if (sel && sel.n === p.name) return;
    var rec = null;
    for (var i = 0; i < SYSLIST().length; i++) if (SYSLIST()[i].n === p.name) { rec = SYSLIST()[i]; break; }
    if (!rec) return;
    sel = rec; cardType = null; renderCard();
    if (CFG.templates) showTemplate(catName(rec.s[0][0]));
  }, 200);

  /* ── the primary star, from the same place Signals gets it ──────────────
     Every map here knows a system's name and where it is, and nothing else.
     What the system actually *is* — what you arrive at, whether you can scoop
     there, how many bodies are worth the detour — lives in Canonn's system
     dump, which is what Signals reads.

     Those cloud functions are billed per invocation, so this asks on a click
     and never otherwise: not on hover, not for the systems list, not on load.
     What comes back is boiled down to the dozen fields the card prints and
     kept in localStorage. Star physics does not move, so a month is a safe
     life for an entry.

     Every step is allowed to fail. An unknown system, a browser with no
     network, a full localStorage — each ends with the block simply absent,
     because the rest of the card is still worth reading. */
  var Star = (function () {
    var API = 'https://us-central1-canonn-api-236217.cloudfunctions.net/query';
    var TTL = 30 * 24 * 3600 * 1000;
    var mem = {}, inflight = {};

    /* data/spectral-colors.json has been in this repo the whole time with
       nothing reading it. This is its consumer: in Elite a star's colour is
       how the game says what class it is, so the card paints the real one
       rather than inventing an accent. 293 bytes from our own origin, asked
       for once, and a failure only leaves the disc unlit. */
    /* The dump the digest was built from, kept whole for the rest of the
       session.

       The card reads four fields out of a response that runs to a couple of
       hundred kilobytes and used to drop the rest on the floor — and then the
       orrery, which wants exactly that response, asked for it again a click
       later. Now the second ask is free.

       Three deep: these are megabytes once parsed, and a reader moves between
       a handful of systems, not a hundred. */
    var dumps = [];
    function keepDump(name, sys) {
      if (!name || !sys) return;
      dumps = dumps.filter(function (d) { return d.name !== name; });
      dumps.unshift({ name: name, sys: sys });
      dumps = dumps.slice(0, 3);
    }

    var SPECTRAL = null;
    fetch('data/spectral-colors.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j) SPECTRAL = j; })
      .catch(function () {});

    /* undefined: not asked yet. null: asked, nothing to show. */
    function cached(name) {
      if (mem[name] !== undefined) return mem[name];
      var raw = recall('star.' + name);
      if (!raw) return undefined;
      try {
        var box = JSON.parse(raw);
        if (!box || Date.now() - box.t > TTL) return undefined;
        mem[name] = box.d;
        return box.d;
      } catch (e) { return undefined; }
    }

    function store(name, d) {
      mem[name] = d;
      remember('star.' + name, JSON.stringify({ t: Date.now(), d: d }));
    }

    /* One system's worth of dump, reduced to what the card prints. */
    function digest(sys) {
      if (!sys) return null;
      var bodies = sys.bodies || [];
      var stars = bodies.filter(function (b) { return b && b.type === 'Star'; });
      // mainStar is the arrival star. Falling back to the first one listed is
      // better than nothing on a system whose dump predates that flag.
      var main = null;
      stars.forEach(function (b) { if (b.mainStar && !main) main = b; });
      if (!main) main = stars[0];
      if (!main) return null;
      // In a multi-star system the arrival star is "<system> A"; saying so is
      // the difference between "there is a K3 here" and "the one you drop out
      // at is the K3". A lone star repeats the system name, so drop it.
      var label = (main.name || '').indexOf((sys.name || '') + ' ') === 0
        ? main.name.slice((sys.name || '').length + 1) : '';
      return {
        // The system's id64, so anything else that wants this system's dump —
        // the orrery does — can ask for it directly instead of resolving the
        // name again. Entries cached before this field existed simply lack it,
        // and the orrery falls back to its own lookup.
        id: sys.id64 || 0,
        n: main.name || '',
        lab: label,
        sub: main.subType || '',
        cls: main.spectralClass || '',
        lum: main.luminosity || '',
        k: main.surfaceTemperature || 0,
        mass: main.solarMasses || 0,
        rad: main.solarRadius || 0,
        age: main.age || 0,
        // K, G, B, F, O, A and M are the classes a fuel scoop can refuel from.
        scoop: /^[KGBFOAM]/.test(main.spectralClass || ''),
        stars: stars.length,
        bodies: sys.bodyCount || bodies.length,
        land: bodies.filter(function (b) { return b && b.isLandable; }).length
      };
    }

    async function get(url) {
      var r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }

    async function load(name) {
      var hit = await get(API + '/typeahead?q=' + encodeURIComponent(name));
      var row = hit && hit.min_max && hit.min_max[0];
      // typeahead is a prefix search, so it answers for names that merely
      // start with what was asked. Only an exact match is this system.
      if (!row || row.name !== name || !row.id64) return null;
      var dump = await get(API + '/codex/dump?id=' + row.id64 + '&caller=CanonnED3D');
      keepDump(name, dump && dump.system);
      return digest(dump && dump.system);
    }

    return {
      /** The whole dump for a system, if this session already has it. */
      dump: function (name) {
        var hit = dumps.filter(function (d) { return d.name === name; })[0];
        return hit ? hit.sys : null;
      },
      keep: keepDump,

      /** '#rrggbb' for a spectral class, or '' when the table cannot place it —
       *  which is honest: an unlit disc means unclassified, not "no star". */
      colour: function (cls) {
        if (!SPECTRAL || !cls) return '';
        var c = String(cls).toUpperCase();
        // "K3" is K, "DA" is D. Two-letter keys (WR) get first refusal.
        var key = SPECTRAL[c] ? c
                : SPECTRAL[c.slice(0, 2)] ? c.slice(0, 2)
                : SPECTRAL[c.charAt(0)] ? c.charAt(0) : '';
        if (!key) return '';
        // Wolf-Rayet carries two colours; the first is the one to draw.
        return '#' + String(SPECTRAL[key]).split(',')[0].replace(/^#/, '');
      },

      /** cb(summary | null). Called immediately when the answer is known. */
      get: function (name, cb) {
        var known = cached(name);
        if (known !== undefined) { cb(known); return; }
        if (inflight[name]) { inflight[name].push(cb); return; }
        inflight[name] = [cb];
        load(name).catch(function () { return undefined; }).then(function (d) {
          var waiting = inflight[name];
          delete inflight[name];
          // undefined is "the lookup broke", which is not a fact about the
          // system and must not be cached for a month.
          if (d !== undefined) store(name, d);
          waiting.forEach(function (fn) { try { fn(d === undefined ? null : d); } catch (e) {} });
        });
      }
    };
  })();

  function num(v, dp) { return v.toFixed(dp).replace(/\.?0+$/, '') || '0'; }

  /* How big to draw the disc. Radius in solar radii, on a flattened curve so a
     red dwarf still reads as a dot and a blue giant does not fill the card. */
  function discPx(rad) {
    if (!rad) return 12;
    return Math.round(Math.max(9, Math.min(24, 12 * Math.pow(rad, 0.4))));
  }

  /* One measurement: what it is, the number, and the unit — three jobs that
     used to share one undifferentiated mono run. The number is the datum and
     is set large and bright; the unit is a footnote beside it; the label sits
     above in condensed caps and gets out of the way. */
  function measure(label, value, unit) {
    return '<div><dt>' + label + '</dt><dd>' + value +
           (unit ? '<em>' + unit + '</em>' : '') + '</dd></div>';
  }

  function starHtml(d) {
    if (!d) return '';

    /* Sol is the reference every commander already has, so say so in words.
       "M☉" and "Gyr" are correct and unreadable; this is the same fact.

       Except where Sol is the wrong ruler. A neutron star is about 20 km
       across, which is 0.00003 solar radii and rounds to a flat "0 × Sun" —
       the card stating that a star has no size. Below a hundredth of Sol the
       measurement changes unit rather than losing the number: kilometres for
       radius, Jupiters for the brown dwarfs, which is how both are actually
       described. */
    var mass = !d.mass ? ['&#8212;', '']
      : d.mass < 0.02 ? [num(d.mass * 1047.57, 1), '&times; Jupiter']
      : [num(d.mass, 2), '&times; Sun'];
    var rad = !d.rad ? ['&#8212;', '']
      : d.rad < 0.01 ? [Math.round(d.rad * 696340).toLocaleString(), 'km']
      : [num(d.rad, 2), '&times; Sun'];

    var cells =
      measure('Surface temp', d.k ? Math.round(d.k).toLocaleString() : '&#8212;', d.k ? 'K' : '') +
      measure('Mass', mass[0], mass[1]) +
      measure('Radius', rad[0], rad[1]) +
      measure('Age',
        d.age ? (d.age >= 1000 ? num(d.age / 1000, 1) : d.age.toLocaleString()) : '&#8212;',
        d.age ? (d.age >= 1000 ? 'bn years' : 'm years') : '');

    var counts = [];
    if (d.bodies) counts.push(d.bodies + ' bod' + (d.bodies > 1 ? 'ies' : 'y'));
    if (d.stars > 1) counts.push(d.stars + ' stars');
    if (d.land) counts.push(d.land + ' landable');

    var colour = Star.colour(d.cls);
    var cls = (d.cls + ' ' + d.lum).trim();
    return '<div class="c-star"' + (colour ? ' style="--star:' + colour + '"' : '') + '>' +
      '<div class="c-star-h">' +
        '<span class="c-star-disc" style="--d:' + discPx(d.rad) + 'px"></span>' +
        '<span class="c-star-lb">Primary star</span>' +
        (cls ? '<b>' + esc(cls) + '</b>' : '') +
      '</div>' +
      (d.sub ? '<div class="c-star-n">' +
        (d.lab ? '<i>' + esc(d.lab) + '</i>' : '') + esc(d.sub) + '</div>' : '') +
      '<dl class="c-star-m">' + cells + '</dl>' +
      // Whether you can refuel is the one fact here you act on, so it gets its
      // own line and the colour the console uses for live data.
      '<div class="c-star-f">' +
        '<span class="c-star-scoop ' + (d.scoop ? 'yes' : 'no') + '">' +
          (d.scoop ? 'Fuel scoopable' : 'No fuel here') + '</span>' +
        (counts.length ? '<span class="c-star-c">' + esc(counts.join(' · ')) + '</span>' : '') +
      '</div>' +
    '</div>';
  }

  /* The same block with the numbers not in yet.

     It has to be the same *shape*, not a shorter placeholder: the two-line
     "looking up…" it replaces was 130px shorter than the answer, so the ruins
     list and every button jumped down the moment the lookup returned. The
     labels are known before the data is, so they are simply present, and the
     disc — unlit, searching — carries the fact that something is happening. */
  function starWaitHtml() {
    var cell = function (label) {
      return '<div><dt>' + label + '</dt><dd><span class="bar"></span></dd></div>';
    };
    return '<div class="c-star wait">' +
      '<div class="c-star-h">' +
        '<span class="c-star-disc"></span>' +
        '<span class="c-star-lb">Primary star</span></div>' +
      '<div class="c-star-n">Reading the system dump&#8230;</div>' +
      '<dl class="c-star-m">' + cell('Surface temp') + cell('Mass') +
        cell('Radius') + cell('Age') + '</dl>' +
      // Both footer lines are held open too, so the block is exactly as tall
      // waiting as it is answered and nothing below it moves.
      '<div class="c-star-f">' +
        '<span class="c-star-scoop"><span class="bar" style="width:46%"></span></span>' +
        '<span class="c-star-c"><span class="bar" style="width:70%"></span></span>' +
      '</div>' +
    '</div>';
  }

  /* Closing the card drops Ed3d's selection too.

     Without that the close button did nothing you could see. The poll above
     runs five times a second off Action.selectedPoint, which the engine
     leaves set after a click, so the card came straight back on the next
     tick. Clearing it also takes the 3D cursor off the map, which is what
     closing the card ought to mean. */
  function closeCard() {
    sel = null;
    var c = $('card');
    if (c) c.className = 'card hidden';
    if (typeof Action === 'undefined' || !Action) return;
    Action.selectedPoint = null;
    Action.oldSel = null;
    if (Action.disableSelection) Action.disableSelection();
  }

  /* Give a system the engine's own selection, so choosing it from the systems
     list or the palette looks like clicking it in the map: cursor on the
     point, selection set, grid moved under it. Picking from the list only
     flew the camera before, which left nothing at all marking which of the
     points in view you had actually asked for. */
  function selectInMap(rec) {
    if (typeof Action === 'undefined' || !Action) return;
    if (!window.System || !System.points) return;
    var pt = System.points[rec.idx];
    if (!pt) return;
    Action.oldSel = rec.idx;
    Action.selectedPoint = pt;
    if (Action.addCursorOnSelect) Action.addCursorOnSelect(pt.x, pt.y, pt.z);
    if (Action.moveGridTo) Action.moveGridTo(pt.x, pt.y, pt.z);
  }

  /* The orrery is a second WebGL context and a few hundred lines that most
     sessions never open, so it is fetched when it is first asked for. It is a
     module: the page's own import map is what resolves 'three' for it, which
     is why it can be injected from this plain script. */
  var orreryLoading = null;
  function loadOrrery() {
    if (window.Orrery) return Promise.resolve(window.Orrery);
    if (orreryLoading) return orreryLoading;
    orreryLoading = new Promise(function (resolve, reject) {
      var css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'css/orrery.css';
      document.head.appendChild(css);
      var js = document.createElement('script');
      js.type = 'module';
      js.src = 'js/orrery.js';
      js.onload = function () {
        window.Orrery ? resolve(window.Orrery) : reject(new Error('no Orrery'));
      };
      js.onerror = function () { reject(new Error('orrery failed to load')); };
      document.head.appendChild(js);
    });
    return orreryLoading;
  }

  function openOrrery(btn, name, id64) {
    var label = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Opening\u2026';
    loadOrrery().then(function (O) {
      btn.disabled = false; btn.innerHTML = label;
      O.open(name, id64);
    }).catch(function () {
      btn.disabled = false; btn.textContent = 'Orrery unavailable';
    });
  }

  /* The orrery paints the star in its real colour and reads the table from
     here rather than fetching it a second time. */
  window.CanonnConsole = window.CanonnConsole || {};
  window.CanonnConsole.starColour = function (cls) { return Star.colour(cls); };
  // One fetch, two readers: the card has already pulled this system's dump to
  // find its star, and the orrery wants the same bytes.
  window.CanonnConsole.systemDump = function (name) { return Star.dump(name); };
  window.CanonnConsole.keepSystemDump = function (name, sys) { Star.keep(name, sys); };

  function renderCard() {
    var s = sel, q = encodeURIComponent(s.n);

    /* What is in this system, told straight.

       These are two different things and the card used to run them together.
       s.s is one entry per *category* the point belongs to, not one per site:
       several ruins in a system share its coordinates, so Ed3d merges them
       into a single point. A system with two Alphas and a Beta produced "1
       ruin, 1 Alpha" and a stray category chip in the middle of the list,
       none of which described the system.

       The count comes from System's own record of how many entries merged.
       The types come from Ed3d.catObjs, which is the only place that knows
       every category a merged point ended up in — the point's own cat field
       only ever holds the first record's. */
    var count = s.entries || s.s.length || 1;
    var types = [];
    if (window.Ed3d && Ed3d.catObjs) {
      CATS.forEach(function (cat) {
        var list = Ed3d.catObjs[cat.id];
        if (list && list.indexOf(s.idx) > -1) types.push(cat);
      });
    }
    if (!types.length) types = s.s.map(function (x) { return CATS[x[0]]; }).filter(Boolean);



    var body = s.s.length && s.s[0][1]
      ? '<div class="c-body">' + safeHtml(s.s[0][1]) + '</div>'
      : '';

    var link = '';
    if (CFG.panel === 'star' && s.s[0] && s.s[0][2]) {
      link = '<div class="c-link">Guardian structure at <a href="?map=gs">' +
        esc(s.s[0][2]) + '</a> — open the Structures map</div>';
    }

    var c = $('card');
    c.className = 'card';
    c.innerHTML =
      '<div class="c-h"><div class="n">' + esc(s.n) + '</div>' +
        // Not id="cx": Ed3d's own coordinate readout already owns that id,
        // so getElementById returned its <span> and the close button was
        // wired to nothing on any page where the HUD renders first.
        '<button class="x" id="card-x" aria-label="Close">&times;</button></div>' +
      '<div class="c-meta">' + s.x + ' · ' + s.y + ' · ' + s.z + '<br>' +
        Math.round(Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z)).toLocaleString() + ' ly from Sol</div>' +
      '<div id="cstar"></div>' +
      '<div class="c-sec"><span>' + count + ' ' + CFG.unit + (count > 1 ? 's' : '') + '</span>' +
        '<b>' + esc(types.map(function (t) { return t.name; }).join(' · ')) + '</b></div>' +
      body + link +
      // No site plan here: the Layers panel already shows it, larger, and two
      // copies of the same drawing made the card twice as tall for nothing.
      // The chips above still choose which one that panel shows.
      '<div class="c-acts">' +
        // Signals is the destination for everything about a system — bodies,
        // orbital elements, materials, signal counts — and carries its own
        // links out to the other tools, so the map does not duplicate them.
        // Revealed only once the star lookup lands: the orrery reads the same
        // dump, so a system with no star in it has nothing to model, and a
        // button that always fails is worse than no button.
        '<button class="wide alt" id="correry" hidden>Open the orrery <span class="ax">&#9678;</span></button>' +
        '<a class="wide" href="https://signals.canonn.tech/?system=' + q + '" target="_blank" rel="noopener">Open in Signals <span class="ax">&#8599;</span></a>' +
        '<button id="ccopy">Copy name</button><button id="ccentre">Centre here</button>' +
      '</div>' +
      '<button class="c-reset" id="creset">Reset position</button>';
    $('creset').onclick = resetCardBox;

    /* The star block fills itself in. A system already in the cache answers
       inside this call, so there is no placeholder to flash on one you have
       opened before; anything that has to go to the network shows that it is
       looking, and a slow answer for a system you have already moved on from
       is dropped rather than written into someone else's card. */
    (function () {
      var want = s.n, answered = false;
      Star.get(want, function (d) {
        answered = true;
        if (!sel || sel.n !== want) return;
        var slot = $('cstar');
        if (slot) slot.innerHTML = starHtml(d);
        var orr = $('correry');
        if (orr && d) {
          orr.hidden = false;
          orr.onclick = function () { openOrrery(orr, want, d.id); };
        }
      });
      if (!answered) $('cstar').innerHTML = starWaitHtml();
    })();

    $('card-x').onclick = closeCard;
    makeCardMovable(c);
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
    // Deliberately NOT calling showTemplate() here. renderCard() runs on every
    // card refresh, and doing so yanked the left panel's highlight away from
    // whatever the pointer was hovering.
  }

  /* Select a system and fly the camera to it. Shared by the palette and the
     systems list so they behave identically. */
  function gotoSystem(rec) {
    sel = rec; cardType = null; renderCard();
    selectInMap(rec);
    if (CFG.templates) showTemplate(catName(rec.s[0][0]));
    if (typeof controls === 'undefined') return;
    controls.target.set(rec.x, rec.y, -rec.z);
    camera.position.set(rec.x - 120, rec.y + 90, -rec.z + 120);
    camera.lookAt(controls.target);
    controls.update();
    if (panel === 'systems') renderPanel();
  }

  /* ── systems list: what is actually on this map ────────────────────────
     The map index answers "which map"; nothing answered "what is on this one".
     Respects the layer toggles so it always agrees with the status strip. */
  function visibleSystems() {
    return SYSLIST().filter(function (r) {
      return r.s.some(function (site) { return on(site[0]); });
    });
  }

  /* The systems panel.

     Rendered in pages rather than all at once. Guardian Ruins is 212 rows, but
     codex.html finishes at nearly 35,000 — building that many nodes locked the
     panel up for seconds every time it was opened or filtered. Rows are
     appended as the reader scrolls instead, which keeps opening the panel
     instant whatever the map. */

  var SYS_PAGE = 80;
  var sysLimit = SYS_PAGE;
  var sysRowsCache = null;

  function sysRows() {
    if (sysRowsCache) return sysRowsCache;
    var q = sysQuery.toLowerCase();
    var rows = visibleSystems().filter(function (r) {
      return !q || r.n.toLowerCase().indexOf(q) > -1;
    });
    rows.forEach(function (r) {
      if (r._ly === undefined) r._ly = Math.round(Math.sqrt(r.x * r.x + r.y * r.y + r.z * r.z));
    });
    rows.sort(sysSort === 'name'
      ? function (a, b) { return a.n.localeCompare(b.n, undefined, { numeric: true }); }
      : function (a, b) { return a._ly - b._ly; });
    sysRowsCache = rows;
    return rows;
  }

  function resetSysList() { sysRowsCache = null; sysLimit = SYS_PAGE; }

  function sysRowHtml(r) {
    var types = {}; r.s.forEach(function (x) { types[x[0]] = 1; });
    var wedge = Object.keys(types).map(function (t) {
      return '<i style="background:' + col(+t) + '"></i>';
    }).join('');
    return '<div class="sysrow' + (sel && sel.n === r.n ? ' on' : '') + '" data-sys="' + esc(r.n) + '" ' +
      'role="button" tabindex="0" title="' + esc(r.n) + ' — ' + r.s.length + ' ' + CFG.unit +
      (r.s.length > 1 ? 's' : '') + '">' +
      '<span class="wedge">' + wedge + '</span>' +
      '<span class="nm">' + hl(r.n, sysQuery) + '</span>' +
      '<span class="ly">' + r._ly.toLocaleString() + '</span></div>';
  }

  /** Append the next page of rows; called on first render and while scrolling. */
  function fillSysList() {
    var list = document.querySelector('.syslist');
    if (!list) return;
    var rows = sysRows();
    var have = list.querySelectorAll('.sysrow').length;
    var want = Math.min(sysLimit, rows.length);
    if (have >= want) return;
    var html = '';
    for (var i = have; i < want; i++) html += sysRowHtml(rows[i]);
    list.insertAdjacentHTML('beforeend', html);
    var more = $('sysmore');
    if (more) more.textContent = want < rows.length
      ? 'Showing ' + want + ' of ' + rows.length + ' — scroll for more' : '';
  }

  function panelSystems() {
    var rows = sysRows();
    return '<div class="syshead">' +
      '<div class="s-t">Systems on this map</div>' +
      '<div class="s-sub"><b>' + rows.length + '</b> of ' + SYSLIST().length +
      (sysQuery ? ' matching' : ' shown') + '</div>' +
      '<input class="sysfilter" id="sysfilter" type="text" placeholder="Filter by name…" ' +
      'autocomplete="off" spellcheck="false" value="' + esc(sysQuery) + '">' +
      '<div class="syssort">' +
      '<button data-sort="name"' + (sysSort === 'name' ? ' class="on"' : '') + '>Name</button>' +
      '<button data-sort="dist"' + (sysSort === 'dist' ? ' class="on"' : '') + '>Distance</button>' +
      '</div></div>' +
      (rows.length ? '' : '<div class="note" style="margin:10px 13px">No system matches. Clear the ' +
        'filter, or re-enable a type in the Layers panel.</div>') +
      '<div class="syslist"></div>' +
      '<div class="sysmore" id="sysmore"></div>' +
      '<button class="totop" id="systotop" title="Back to the top">&#8593; Top</button>';
  }

  /* ── map index: the browsable alternative to searching ────────────────── */
  function openIndex() {
    var total = 0, h = '';
    CATALOGUE.forEach(function (g) {
      h += '<div class="idx-g"><div class="idx-gt">' + esc(g.g) +
        ' <span style="color:var(--dimmer)">' + g.items.length + '</span></div><div class="idx-list">';
      g.items.forEach(function (m) {
        total++;
        var cur = isCurrentPage(m.u);
        h += '<a class="idx-i' + (cur ? ' cur' : '') + '" href="' + esc(m.u) + '">' +
          '<div class="n">' + esc(m.n) + '</div>' +
          '<div class="d">' + esc(subtitle(m)) + '</div>' +
          '<div class="s">' + (cur ? 'Showing now' : 'Open') + '</div></a>';
      });
      h += '</div></div>';
    });
    $('idxbody').innerHTML = h;
    $('idxsub').textContent = total + ' maps';
    $('idxscrim').classList.add('open');
  }

  /* Most entries share a page and differ only by query string — codex.html
     alone served 48 of them — so the filename says nothing. The parameters do:
     "Biology · Amphora Plant" is what actually distinguishes one codex entry
     from the next. Where a page takes no parameters there is nothing useful to
     add, and the name stands on its own. */
  function subtitle(m) {
    var q = m.u.indexOf('?');
    if (q < 0) return '';
    var vals = [];
    new URLSearchParams(m.u.slice(q + 1)).forEach(function (v) {
      v = v.trim();
      if (v && vals.indexOf(v) < 0 && v.toLowerCase() !== m.n.toLowerCase()) vals.push(v);
    });
    return vals.join(' · ');
  }

  /* The nav linked the same page under many names — codex.html alone served 48
     entries, separated only by query string — so "am I on this one?" has to
     compare the parameters too, not just the filename. */
  function isCurrentPage(u) { return pageMatchScore(u) >= 0; }

  /* -1 when the URL is not this page at all; otherwise how many query
     parameters it pinned down, so the most specific match can win. */
  function pageMatchScore(u) {
    if (!u) return -1;
    var a = new URL(u, location.href);
    if (a.pathname !== location.pathname) return -1;
    var mine = new URLSearchParams(location.search), theirs = new URLSearchParams(a.search);
    var keys = [];
    theirs.forEach(function (v, k) { keys.push(k); });
    if (!keys.length) return mine.toString() ? -1 : 0;
    var all = keys.every(function (k) { return mine.get(k) === theirs.get(k); });
    return all ? keys.length : -1;
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
      g.items.forEach(function (m) { out.push({ n: m.n, u: m.u, g: g.g }); });
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
        return { k: 'map', t: m.n, m: isCurrentPage(m.u) ? 'showing' : m.g, u: m.u };
      }), ms.length > 6 ? ms.length + ' total — ⌘⇧M to browse' : '');
    }
    if (only !== 'maps') {
      grp('Canonn tools', TOOLS.filter(function (t) { return !lo || t[0].toLowerCase().indexOf(lo) > -1; })
        .map(function (t) { return { k: 'tool', t: t[0], m: t[1], u: t[2] }; }));
    }
    var localHits = 0;
    if (!only && lo.length > 0) {
      var hits = SYSLIST().filter(function (s) { return s.n.toLowerCase().indexOf(lo) > -1; });
      localHits = hits.length;
      grp('Systems on this map', hits.slice(0, 8).map(function (s) {
        var t = {}; s.s.forEach(function (x) { t[x[0]] = 1; });
        return { k: 'sys', t: s.n, m: Object.keys(t).map(function (k) { return catName(k); }).join(' · '), s: s };
      }), hits.length > 8 ? hits.length + ' matches' : '');
    }

    // Each map only holds its own systems, so searching one for Sol finds
    // nothing — which read as the search being broken rather than the system
    // being absent. Signals knows every system, so offer it as a way out
    // instead of a dead end. Only when nothing local matched, so it never gets
    // in the way of the results that are actually here.
    if (!only && lo.length > 1 && localHits === 0) {
      grp('Not on this map', [{
        k: 'tool',
        t: 'Look up "' + term + '" in Signals',
        m: 'every system',
        u: 'https://signals.canonn.tech/?system=' + encodeURIComponent(term)
      }]);
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
    if (r.k === 'sys') { closePal(); gotoSystem(r.s); return; }
    closePal();
    if (r.u) { location.href = r.u; }
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

  /* ── the system card can be moved and resized ───────────────────────────
     It sits over the map, so where it sits is a matter of what you are looking
     at. Position and size are remembered like the other preferences; the
     header drags, the bottom-right corner resizes, and "Reset position" puts
     it back. Both are clamped to the stage so it can never be dragged out of
     reach. */

  function clampCard(c, left, top, w, h) {
    var stage = c.parentNode.getBoundingClientRect();
    var width = Math.max(240, Math.min(w, stage.width - 20));
    var height = Math.max(160, Math.min(h, stage.height - 20));
    return {
      left: Math.max(0, Math.min(left, stage.width - width)),
      top: Math.max(0, Math.min(top, stage.height - height)),
      w: width, h: height
    };
  }

  function applyCardBox(c, box) {
    c.classList.add('moved');
    c.style.left = box.left + 'px';
    c.style.top = box.top + 'px';
    c.style.width = box.w + 'px';
    c.style.height = box.h + 'px';
    c.style.maxHeight = 'none';
  }

  function makeCardMovable(c) {
    if (c.querySelector('.c-grip')) return;   // survives every re-render

    var stored = recall('cardBox');
    if (stored) {
      var v = stored.split(',').map(Number);
      if (v.length === 4 && v.every(function (n) { return !isNaN(n); })) {
        applyCardBox(c, clampCard(c, v[0], v[1], v[2], v[3]));
      }
    }

    var grip = document.createElement('div');
    grip.className = 'c-grip';
    grip.title = 'Drag to resize';
    c.appendChild(grip);

    function remember_box() {
      var b = c.getBoundingClientRect(), st = c.parentNode.getBoundingClientRect();
      remember('cardBox', [Math.round(b.left - st.left), Math.round(b.top - st.top),
                           Math.round(b.width), Math.round(b.height)].join(','));
    }

    function drag(el, onMove, cls) {
      el.addEventListener('pointerdown', function (e) {
        if (e.target.closest('button, a')) return;
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        document.body.classList.add(cls);
        var b = c.getBoundingClientRect(), st = c.parentNode.getBoundingClientRect();
        var start = { x: e.clientX, y: e.clientY,
                      left: b.left - st.left, top: b.top - st.top, w: b.width, h: b.height };
        function move(ev) { onMove(start, ev.clientX - start.x, ev.clientY - start.y); }
        function up() {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          document.body.classList.remove(cls);
          remember_box();
        }
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
      });
    }

    drag(c.querySelector('.c-h'), function (s0, dx, dy) {
      applyCardBox(c, clampCard(c, s0.left + dx, s0.top + dy, s0.w, s0.h));
    }, 'card-dragging');

    /* The grip is on the bottom-left corner: the card sits against the right
       edge of the stage by default, so a right-hand grip pulled it away from
       the thing it is anchored to. Dragging left therefore widens, and the
       left edge is derived from the width that survived clamping rather than
       from the raw drag — otherwise the right edge crept once the card hit
       its minimum width. */
    drag(grip, function (s0, dx, dy) {
      var box = clampCard(c, s0.left, s0.top, s0.w - dx, s0.h + dy);
      box.left = Math.max(0, s0.left + s0.w - box.w);
      applyCardBox(c, box);
    }, 'card-dragging');
  }

  function resetCardBox() {
    var c = $('card');
    c.classList.remove('moved');
    c.style.left = c.style.top = c.style.width = c.style.height = c.style.maxHeight = '';
    remember('cardBox', '');
  }

  /* ── side panel: paging, resize and collapse ──────────────────────────── */

  var side = $('side');
  var sideGrip = null;

  side.addEventListener('scroll', function () {
    var top = $('systotop');
    if (top) top.classList.toggle('show', side.scrollTop > 400);
    if (panel !== 'systems') return;
    // Within a screen and a half of the end, put the next page in.
    if (side.scrollTop + side.clientHeight > side.scrollHeight - 600) {
      var rows = sysRows();
      if (sysLimit < rows.length) { sysLimit += SYS_PAGE; fillSysList(); }
    }
  });

  side.addEventListener('click', function (e) {
    if (e.target.closest('#systotop')) side.scrollTo({ top: 0, behavior: 'smooth' });
  });

  /* Width is a preference, so it is remembered per browser. Clamped on the way
     in as well as on the way out: a stored value from a wider window should not
     be able to leave the map with no room on a narrow one. */
  function setSideWidth(px) {
    var max = Math.max(260, Math.min(620, window.innerWidth - 420));
    var w = Math.max(240, Math.min(max, Math.round(px)));
    side.style.width = w + 'px';
    return w;
  }

  var storedWidth = parseInt(recall('sideWidth'), 10);
  if (storedWidth) setSideWidth(storedWidth);

  //-- The rail stays put; only the panel beside it collapses.
  if (recall('collapsed') === '1') {
    side.classList.add('hidden');
    var active = document.querySelector('.rail button.on');
    if (active) active.classList.remove('on');
  }

  var grip = sideGrip = document.createElement('div');
  grip.className = 'side-grip';
  grip.title = 'Drag to resize · double-click to reset';
  side.appendChild(grip);

  grip.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
    var startX = e.clientX, startW = side.getBoundingClientRect().width;
    function move(ev) { setSideWidth(startW + (ev.clientX - startX)); }
    function up() {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing');
      remember('sideWidth', Math.round(side.getBoundingClientRect().width));
      if (typeof refresh3dMapSize === 'function') refresh3dMapSize();
    }
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });

  grip.addEventListener('dblclick', function () {
    side.style.width = '';
    remember('sideWidth', '');
    if (typeof refresh3dMapSize === 'function') refresh3dMapSize();
  });

  /* ── bootstrap ──────────────────────────────────────────────────────────
     The page's own MapData-*.js calls Ed3d.init(), exactly as it always has;
     the console never drives the load. It waits for the engine to publish its
     systems and category filters, then reads both. That is the whole of the
     per-map integration — no map declares anything for the console. */
  (function whenReady(tries) {
    tries = tries || 0;
    var state = window.__ed3dTestState ? window.__ed3dTestState() : null;
    var haveSystems = window.System && System.points && System.points.length;
    var haveFilters = document.querySelectorAll('#filters .map_filter').length;
    // Every map registers Sagittarius A* first, so "some points exist" fires
    // almost immediately and long before the data has arrived — wait for the
    // engine to say it is done instead.
    var done = state ? state.dataComplete : haveSystems > 1;

    // Two separate waits. Data gets 20 s, because a slow source is still a
    // source. Filters only get 3 s after that, because a map with no
    // categories at all is legitimate and should not sit staring at an empty
    // panel for the full budget waiting for something that is never coming.
    if (tries < 200 && (!haveSystems || !done)) {
      return setTimeout(function () { whenReady(tries + 1); }, 100);
    }
    if (!haveFilters && tries < 230) {
      return setTimeout(function () { whenReady(tries + 1); }, 100);
    }

    CATS = readCats();
    consoleReady = true;
    hoverType = catName(0);
    $('mapname').textContent = MAPNAME;
    $('st-map').textContent = MAPNAME;
    // Most pages are titled "CanonnED3D - Maps", so every codex entry shared one
    // name in the tab bar, in history and in bookmarks. Name them properly.
    document.title = MAPNAME + ' — CanonnED3D';
    feedNow();

    renderPanel();
    updateShown();
    setInterval(tick, 250);

    // Open framed on the data. Pages inherit a fixed cameraPos, which on
    // several maps starts so far out the systems are invisible.
    setTimeout(function () {
      if (window.PostFX) {
        PostFX.setExposure(recallNum('exposure', PostFX.exposure));
        PostFX.setBloom(recallNum('bloom', PostFX.strength));
        if (disp.hdr) PostFX.enable();
      }
      frameData(); applySize(); applyDisplay(); syncDisplay();
      syncFilteredVisibility();
    }, 300);
  })();
})();
