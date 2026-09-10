import * as THREE from 'three';

/**
 * Three things jQuery did that plain DOM calls do not, kept because the file
 * leans on them in a dozen places each.
 *
 * `show` is the fiddly one. jQuery's .show() clears the inline display and, if
 * the element is still hidden by a stylesheet, writes the default display for
 * its tag. Both halves matter here: #system-search-results is hidden by
 * `display:none` in styles.css, so clearing the inline value alone would leave
 * the typeahead permanently invisible; while #hud and #systemDetails are hidden
 * by `display:none !important` in console.css, which an inline value cannot
 * beat either way, so those calls stay as inert as they already were.
 */
function hudShow(el) {
  if (!el) return;
  el.style.display = '';
  if (getComputedStyle(el).display === 'none') el.style.display = 'block';
}

function hudHide(el) {
  if (el) el.style.display = 'none';
}

/**
 * jQuery's delegated .on(type, selector, fn): listen on a container, act when
 * the event came from something matching the selector, with `this` set to that
 * match — which every handler here reads.
 */
function hudDelegate(root, types, selector, handler) {
  if (!root) return;
  types.split(' ').forEach(function (type) {
    root.addEventListener(type, function (e) {
      var match = e.target.closest ? e.target.closest(selector) : null;
      if (match && root.contains(match)) handler.call(match, e);
    });
  });
}

/** Bind one handler to several event types, the way .on('a b c', fn) did. */
function hudOn(el, types, handler) {
  if (!el) return;
  types.split(' ').forEach(function (type) { el.addEventListener(type, handler); });
}

var HUD = {

  'container': null,
  'initialized': false,

  /**
   * Called after each batch completes. Only runs full setup once;
   * on subsequent calls just refreshes the per-category counts.
   */
  'init': function () {

    if (this.initialized) {
      // Just refresh the counts â€” don't re-bind events or re-init controls
      this.updateFilterCounts();
      return;
    }
    this.initialized = true;
    Loader.update('Init HUD');
    this.initHudAction();
    this.initControls();
    this.initNavControls();

  },

  /**
   * Update the (count) suffix on each filter label in place.
   * Safe to call repeatedly â€” replaces any existing count span.
   */
  'updateFilterCounts': function () {
    document.querySelectorAll('.map_filter').forEach(function (el) {
      var idCat = el.dataset.filter;
      var count = (Ed3d.catObjs[idCat] && Ed3d.catObjs[idCat].length) || 0;
      el.querySelectorAll('.filter-count').forEach(function (n) { n.remove(); });
      if (count > 1) {
        el.insertAdjacentHTML('beforeend', '<span class="filter-count"> (' + count + ')</span>');
      }
    });
  },

  /**
   *
   */
  'create': function (container) {

    this.container = container;

    var root = document.getElementById(this.container);

    if (root && !root.querySelector('#controls') && Ed3d.withOptionsPanel == true) {

      root.insertAdjacentHTML('beforeend',
        '  <div id="controls">' +
        '    <a data-view="3d" class="view selected">3D</a>' +
        '    <a data-view="top" class="view">2D</a>' +
        //'    <a data-view="top" class="view">RED</a>'+  // TMP route edit button
        '    <a data-view="infos" class="' + (Ed3d.showGalaxyInfos ? 'selected' : '') + '">i</a>' +
        '    <a data-view="options">' + Ico.cog + '</a>' +
        '    <div id="options" style="display:none;"></div>' +
        '  </div>'
      );
      this.createSubOptions();

      //-- Optionnal button to go fuulscreen

      if (Ed3d.withFullscreenToggle) {
        var full = document.createElement('a');
        full.id = 'tog-fullscreen';
        full.innerHTML = 'Fullscreen';
        full.addEventListener('click', function () {
          var box = document.getElementById(container);
          if (box) box.classList.toggle('map-fullscreen');
          refresh3dMapSize();
        });
        var controls = document.getElementById('controls');
        if (controls) controls.insertBefore(full, controls.firstChild);
      }


    }

    // --- 3D Navigation Controls (Zoom + Pan) ---
    if (root && !root.querySelector('#nav-controls')) {
      root.insertAdjacentHTML('beforeend',
        '<div id="nav-controls">' +
        '  <div class="nav-zoom">' +
        '    <a id="nav-zoom-in" class="nav-btn" title="Zoom In"><i class="fa fa-plus"></i></a>' +
        '    <a id="nav-zoom-out" class="nav-btn" title="Zoom Out"><i class="fa fa-minus"></i></a>' +
        '  </div>' +
        '  <div class="nav-pan">' +
        '    <a id="nav-pan-up" class="nav-btn" title="Pan Up"><i class="fa fa-chevron-up"></i></a>' +
        '    <div class="nav-pan-row">' +
        '      <a id="nav-pan-left" class="nav-btn" title="Pan Left"><i class="fa fa-chevron-left"></i></a>' +
        '      <a id="nav-pan-reset" class="nav-btn" title="Reset View"><i class="fa fa-dot-circle-o"></i></a>' +
        '      <a id="nav-pan-right" class="nav-btn" title="Pan Right"><i class="fa fa-chevron-right"></i></a>' +
        '    </div>' +
        '    <a id="nav-pan-down" class="nav-btn" title="Pan Down"><i class="fa fa-chevron-down"></i></a>' +
        '  </div>' +
        '</div>'
      );
    }

    if (!Ed3d.withHudPanel || !root) return;

    root.insertAdjacentHTML('beforeend', '<div id="hud"></div>');
    document.getElementById('hud').insertAdjacentHTML('beforeend',
      '<div>' +
      '    <h2>Infos</h2>' +
      '     Dist. Sol <span id="distsol"></span>' +
      '    <div id="coords" class="coords">' +
      '      <span id="cx"></span><span id="cy"></span><span id="cz"></span></div>' +
      '      <p id="infos"></p>' +
      '    </div>' +
      '  <div id="system-search">' +
      '    <div id="system-search-heading"><h2>System Search</h2><button id="file-upload-btn" title="Upload route / journal files"><i class="fa fa-folder-open"></i></button></div>' +
      '    <div id="system-search-wrap">' +
      '      <input type="text" id="system-search-input" placeholder="System name..." autocomplete="off" />' +
      '      <ul id="system-search-results"></ul>' +
      '    </div>' +
      '  </div>' +
      '  <div id="filters">' +
      '  </div>' +
      '</div>'
    );

    // Append HUD toggle button as a sibling to #hud inside the container
    root.insertAdjacentHTML('beforeend',
      '<button id="hud-toggle" title="Collapse panel" aria-label="Collapse panel" aria-expanded="true">' +
      '<i class="fa fa-chevron-left"></i>' +
      '</button>'
    );

    var addClass = (Ed3d.popupDetail ? 'class="popup-detail"' : '');
    root.insertAdjacentHTML('beforeend', '<div id="systemDetails" style="display:none;"' + addClass + '></div>');

  },

  /**
   * Create option panel
   */
  'createSubOptions': function () {

    var options = document.getElementById('options');
    if (!options) return;

    function subOption(label, onClick) {
      var a = document.createElement('a');
      a.className = 'sub-opt active';
      a.innerHTML = label;
      a.addEventListener('click', function () {
        onClick();
        a.classList.toggle('active');
      });
      options.appendChild(a);
    }

    //-- Toggle milky way
    subOption('Toggle Milky Way', function () {
      var state = Galaxy.milkyway[0].visible;
      Galaxy.milkyway[0].visible = !state;
      Galaxy.milkyway[1].visible = !state;
      Galaxy.milkyway2D.visible = !state;
    });

    //-- Toggle Grid
    subOption('Toggle grid', function () {
      Ed3d.grid1H.toggleGrid();
      Ed3d.grid1K.toggleGrid();
      Ed3d.grid1XL.toggleGrid();
    });

  },

  /**
   * Controls init for camera views
   */
  'initControls': function () {

    document.querySelectorAll('#controls a').forEach(function (link) {
      link.addEventListener('click', function (e) {

      if (link.classList.contains('view')) {
        document.querySelectorAll('#controls a.view').forEach(function (v) {
          v.classList.remove('selected');
        });
        link.classList.add('selected');
      }

      var view = link.dataset.view;


      switch (view) {

        case 'top':
          Ed3d.isTopView = true;
          var moveFrom = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
          var moveCoords = { x: controls.target.x, y: controls.target.y + 500, z: controls.target.z };
          HUD.moveCamera(moveFrom, moveCoords);
          break;

        case '3d':
          Ed3d.isTopView = false;
          var moveFrom = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
          var moveCoords = { x: controls.target.x - 100, y: controls.target.y + 500, z: controls.target.z + 500 };
          HUD.moveCamera(moveFrom, moveCoords);
          break;

        case 'infos':
          if (!Ed3d.showGalaxyInfos) {
            Ed3d.showGalaxyInfos = true;
            Galaxy.infosShow();
          } else {
            Ed3d.showGalaxyInfos = false;
            Galaxy.infosHide();
          }
          link.classList.toggle('selected');
          break;

        case 'options':
          var opts = document.getElementById('options');
          if (opts) {
            if (getComputedStyle(opts).display === 'none') hudShow(opts);
            else hudHide(opts);
          }
          break;

      }

      });
    });

  },

  /**
   * Move camera to a target
   */
  'moveCamera': function (from, to) {

    Ed3d.tween = new TWEEN.Tween(from, { override: true }).to(to, 800)
      .start()
      .onUpdate(function () {
        camera.position.set(from.x, from.y, from.z);
      })
      .onComplete(function () {
        controls.update();
      });

  },

  /**
   *
   */
  'initHudAction': function () {

    //-- HUD panel toggle button
    (function () {
      var toggle = document.getElementById('hud-toggle');

      function getActivePanel() {
        // jQuery's :visible was "has a box" — offsetWidth/Height or a client
        // rect — not a display check, so keep it that way.
        var details = document.getElementById('systemDetails');
        var visible = details &&
          (details.offsetWidth > 0 || details.offsetHeight > 0 ||
           details.getClientRects().length > 0);
        return visible ? details : document.getElementById('hud');
      }

      function syncTogglePosition(animate) {
        if (!toggle) return;
        var panel = getActivePanel();
        if (!panel) return;
        var collapsed = panel.classList.contains('hud-collapsed');
        // .outerWidth() is the border box, which is what offsetWidth reports.
        var targetLeft = collapsed ? 0 : panel.offsetWidth;
        if (animate) {
          toggle.style.left = targetLeft + 'px';
        } else {
          toggle.style.transition = 'none';
          toggle.style.left = targetLeft + 'px';
          setTimeout(function () { toggle.style.transition = ''; }, 50);
        }
      }

      // Expose so openHudDetails / closeHudDetails can reposition the button
      HUD.repositionToggle = function (animate) {
        syncTogglePosition(animate !== false);
      };

      // Set initial position without animation
      syncTogglePosition(false);

      hudOn(toggle, 'click touchend', function (e) {
        e.preventDefault();
        var panel = getActivePanel();
        if (!panel) return;
        var collapsed = panel.classList.toggle('hud-collapsed');
        toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        toggle.setAttribute('title', collapsed ? 'Expand panel' : 'Collapse panel');
        toggle.setAttribute('aria-label', collapsed ? 'Expand panel' : 'Collapse panel');
        toggle.querySelectorAll('i').forEach(function (icon) {
          icon.classList.toggle('fa-chevron-left', !collapsed);
          icon.classList.toggle('fa-chevron-right', collapsed);
        });
        syncTogglePosition(true);
      });
    })();

    //-- Disable 3D controls when mouse hover the Hud
    //   .hover(over, out) was mouseenter/mouseleave, which do not bubble.
    document.querySelectorAll('canvas').forEach(function (cv) {
      cv.addEventListener('mouseenter', function () { controls.enabled = true; });
      cv.addEventListener('mouseleave', function () { controls.enabled = false; });
    });

    //-- Disable 3D controls when mouse is over either HUD panel
    document.querySelectorAll('#hud, #systemDetails').forEach(function (panel) {
      panel.addEventListener('mouseenter', function () { controls.enabled = false; });
      panel.addEventListener('mouseleave', function () { controls.enabled = true; });
    });

    //-- Prevent ALL pointer/scroll/click events from leaking through the HUD
    //   panels into OrbitControls.  Must be a DIRECT binding (not delegated)
    //   so stopPropagation fires before the event bubbles to #ed3dmap where
    //   OrbitControls is registered.
    document.querySelectorAll('#hud, #systemDetails').forEach(function (panel) {
      hudOn(panel, 'mousedown pointerdown touchstart touchmove touchend wheel click contextmenu',
        function (e) { e.stopPropagation(); });
    });

    hudHide(document.getElementById('systemDetails'));

    // -----------------------------------------------------------------------
    // File Upload Dialog
    // -----------------------------------------------------------------------
    (function () {

      // Inject overlay once into the map container
      if (!document.getElementById('file-upload-overlay')) {
        var overlay = document.createElement('div');
        overlay.id = 'file-upload-overlay';
        overlay.innerHTML =
          '<div id="file-upload-dialog">' +
          '  <button id="file-upload-close" title="Close">&times;</button>' +
          '  <h3>Upload Files</h3>' +
          '  <p>Upload your journals or other JSON files that contain system names and coordinates and these will be displayed on the map.</p>' +
          '  <label id="file-upload-drop" for="file-upload-input">' +
          '    <i class="fa fa-cloud-upload"></i>' +
          '    Click or drag &amp; drop JSON or CSV files here' +
          '    <input id="file-upload-input" type="file" accept=".json,application/json,.csv,text/csv" multiple>' +
          '  </label>' +
          '  <div id="file-upload-messages"></div>' +
          '</div>';
        document.getElementById('ed3dmap').appendChild(overlay);
      }

      var overlay = document.getElementById('file-upload-overlay');
      var drop = document.getElementById('file-upload-drop');
      var input = document.getElementById('file-upload-input');
      var messages = document.getElementById('file-upload-messages');
      var routeCounter = 0;

      function openDialog() {
        overlay.classList.add('active');
      }
      function closeDialog() {
        overlay.classList.remove('active');
      }

      var openBtn = document.getElementById('file-upload-btn');
      if (openBtn) openBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openDialog();
      });
      var closeBtn = document.getElementById('file-upload-close');
      if (closeBtn) closeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        closeDialog();
      });
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeDialog();
      });

      // Prevent overlay pointer events leaking to the map
      hudOn(overlay, 'mousedown pointerdown touchstart wheel click contextmenu', function (e) {
        e.stopPropagation();
      });

      // Drag & drop styling
      hudOn(drop, 'dragover dragenter', function (e) {
        e.preventDefault();
        e.stopPropagation();
        drop.classList.add('drag-over');
      });
      hudOn(drop, 'dragleave dragend drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
        drop.classList.remove('drag-over');
      });
      drop.addEventListener('drop', function (e) {
        // jQuery wrapped the event; dataTransfer is on the native one, which
        // is what a plain listener already receives.
        var files = e.dataTransfer.files;
        processFiles(files);
      });
      // No manual click handler needed â€” the <label for> wires the input natively.
      input.addEventListener('change', function () {
        processFiles(input.files);
        input.value = '';
      });

      /** Keep the newest line in view. Was $messages.scrollTop(scrollHeight). */
      function scrollMessages() {
        messages.scrollTop = messages.scrollHeight;
      }

      /** Append a message line and return it, so callers can keep updating it. */
      function addMessage(text, type) {
        var m = document.createElement('div');
        m.className = 'fu-msg ' + (type || 'info');
        m.textContent = text;
        messages.appendChild(m);
        scrollMessages();
        return m;
      }

      function setDropLoading(on) {
        if (on) {
          drop.classList.add('loading');
          drop.querySelectorAll('.fa').forEach(hudHide);
          if (!drop.querySelector('.fu-spinner')) {
            drop.insertAdjacentHTML('afterbegin', '<span class="fu-spinner"></span><br>');
          }
          drop.querySelectorAll('.fu-spinner').forEach(hudShow);
        } else {
          drop.classList.remove('loading');
          drop.querySelectorAll('.fu-spinner').forEach(function (n) { n.remove(); });
          drop.querySelectorAll('.fa').forEach(hudShow);
        }
      }

      var pendingFiles = 0;

      function processFiles(files) {
        if (!files || files.length === 0) return;
        pendingFiles += files.length;
        setDropLoading(true);
        for (var i = 0; i < files.length; i++) {
          (function (file) {
            addMessage('Reading ' + file.name + '\u2026', 'info');
            var reader = new FileReader();
            reader.onload = function (evt) {
              processRawText(file.name, evt.target.result, fileDone);
            };
            reader.onerror = function () {
              addMessage(file.name + ': Failed to read file.', 'error');
              fileDone();
            };
            reader.readAsText(file);

            function fileDone() {
              if (--pendingFiles === 0) {
                setDropLoading(false);
                var btn = document.createElement('button');
                btn.className = 'fu-done-btn';
                btn.textContent = '\u2713 Done - click here to close';
                btn.addEventListener('click', closeDialog);
                messages.appendChild(btn);
                scrollMessages();
              }
            }
          })(files[i]);
        }
      }


      // Accepts Spansh and Canonn route files (job/parameters/result, state/status optional)
      function isGenericRouteFile(data) {
        return data &&
          typeof data.job === 'string' &&
          data.parameters !== undefined &&
          data.result !== undefined &&
          Array.isArray(data.result);
      }

      // Legacy: Spansh neutron-router route
      function isSpanshRoute(data) {
        return data &&
          typeof data.job === 'string' &&
          typeof data.state === 'string' &&
          typeof data.status === 'string' &&
          data.parameters !== undefined &&
          data.result !== undefined;
      }

      // A small palette of distinct colours for per-commander routes
      var CMDR_PALETTE = [
        0xFF9D00, 0x00BFFF, 0x7FFF00, 0xFF69B4, 0xDA70D6,
        0x40E0D0, 0xFF6347, 0xADFF2F, 0xFFD700, 0x87CEEB
      ];
      var cmdrColorMap = {};  // cmdrName -> THREE.Color hex
      var cmdrColorIdx = 0;

      function cmdrColor(name) {
        if (!cmdrColorMap[name]) {
          cmdrColorMap[name] = CMDR_PALETTE[cmdrColorIdx % CMDR_PALETTE.length];
          cmdrColorIdx++;
        }
        return cmdrColorMap[name];
      }

      function parseJsonl(text) {
        // JSONL: one JSON object per line, blank lines ignored.
        // Also handles the "pretty-printed objects run together" format in the
        // sample (no comma between top-level objects, just whitespace).
        var lines = text.split('\n');
        var results = [];
        var buf = '';
        for (var i = 0; i < lines.length; i++) {
          var l = lines[i].trim();
          if (!l) continue;
          buf += l;
          try {
            results.push(JSON.parse(buf));
            buf = '';
          } catch (e) {
            // incomplete yet – accumulate more lines
          }
        }
        return results;
      }

      function isJournalJsonl(events) {
        // Must be an array of objects and at least one must have an "event" field
        return Array.isArray(events) && events.length > 0 &&
          events.some(function (e) { return e && typeof e.event === 'string'; });
      }

      function isSpanshSearch(data) {
        return data &&
          typeof data.count === 'number' &&
          typeof data.from === 'number' &&
          typeof data.search_reference === 'string' &&
          data.reference !== undefined &&
          Array.isArray(data.results);
      }

      function isNavRoute(data) {
        return data && data.event === 'NavRoute' &&
          Array.isArray(data.Route) && data.Route.length > 0 &&
          Array.isArray(data.Route[0].StarPos);
      }

      function handleParsedFile(filename, data, done) {
        if (isSpanshSearch(data)) {
          displaySpanshSearch(filename, data, done);
          return;
        }
        if (isNavRoute(data)) {
          var jumps = data.Route.map(function (s) {
            return { system: s.StarSystem, x: s.StarPos[0], y: s.StarPos[1], z: s.StarPos[2] };
          });
          var from = jumps[0].system;
          var to = jumps[jumps.length - 1].system;
          displaySpanshRoute(filename, from, to, jumps, done);
          return;
        }
        if (isSpanshRoute(data)) {
          if (data.state !== 'completed' || data.status !== 'ok') {
            addMessage(filename + ': Spansh route is not yet completed (state: ' + data.state + ').', 'error');
            done();
            return;
          }
          // Determine from/to — may be in result or parameters depending on format
          var fromSys = (data.result && data.result.source_system) ||
            (data.parameters && data.parameters.source_system) || '';
          var toSys = (data.result && data.result.destination_system) ||
            (data.parameters && data.parameters.destination_system) || '';
          // Format A: result.system_jumps — each jump has a 'system' field
          var jumps = data.result && data.result.system_jumps;
          // Format B: result.jumps — each jump has a 'name' field; normalise to format A
          if (!jumps || jumps.length === 0) {
            var rawJumps = data.result && data.result.jumps;
            if (rawJumps && rawJumps.length > 0) {
              jumps = rawJumps.map(function (j) {
                return { system: j.name, x: j.x, y: j.y, z: j.z };
              });
            }
          }
          // Format C: result is an array of waypoints (Canonn/Spansh export)
          if ((!jumps || jumps.length === 0) && Array.isArray(data.result)) {
            jumps = data.result.map(function (wp) {
              var sys = wp.system || wp.name || '';
              return { system: sys, x: wp.x, y: wp.y, z: wp.z };
            }).filter(function (j) { return j.system && j.x !== undefined && j.y !== undefined && j.z !== undefined; });
          }
          if (!jumps || jumps.length === 0) {
            addMessage(filename + ': Spansh route has no system jumps.', 'error');
            done();
            return;
          }
          displaySpanshRoute(filename, fromSys, toSys, jumps, done);
          return;
        }
        // New: Generic route file (Canonn/Spansh route export)
        if (isGenericRouteFile(data)) {
          // Try to extract system list from result array
          var jumps = data.result.map(function (wp) {
            // Accept both {name, x, y, z} and {system, x, y, z}
            var sys = wp.system || wp.name || '';
            return { system: sys, x: wp.x, y: wp.y, z: wp.z };
          }).filter(function (j) { return j.system && j.x !== undefined && j.y !== undefined && j.z !== undefined; });
          var fromSys = jumps.length > 0 ? jumps[0].system : '';
          var toSys = jumps.length > 0 ? jumps[jumps.length - 1].system : '';
          if (jumps.length === 0) {
            addMessage(filename + ': Route file has no valid systems.', 'error');
            done();
            return;
          }
          displaySpanshRoute(filename, fromSys, toSys, jumps, done);
          return;
        }
        addMessage(filename + ': Unrecognised file format. Expected a route or system list JSON.', 'error');
        done();
      }

      // Overridden below to also handle raw JSONL text
      var _handleParsedFile = handleParsedFile;

      // -----------------------------------------------------------------------
      // CSV support
      // -----------------------------------------------------------------------

      // Map of normalised header key -> priority (lower = higher priority)
      var NAME_HEADERS = { 'systemname': 0, 'system': 1, 'name': 2 };
      var X_HEADERS = { 'coordx': 0, 'x': 1 };
      var Y_HEADERS = { 'coordy': 0, 'y': 1 };
      var Z_HEADERS = { 'coordz': 0, 'z': 1 };

      // Normalise a header for matching: lowercase, strip non-alphanumeric
      function normaliseHeader(h) {
        return h.toLowerCase().replace(/[^a-z0-9]/g, '');
      }

      // Pick the best matching column from a row's field list for a given priority map
      function pickColumn(fields, priorityMap) {
        var best = null;
        var bestPriority = Infinity;
        fields.forEach(function (f) {
          var key = normaliseHeader(f);
          if (priorityMap.hasOwnProperty(key) && priorityMap[key] < bestPriority) {
            best = f;
            bestPriority = priorityMap[key];
          }
        });
        return best;
      }

      function displayCsvSystems(filename, systems, done) {
        if (!System.particleGeo) System.initParticleSystem();
        var status = addMessage('Adding systems\u2026', 'info');

        var i = 0;
        function addNext() {
          if (i < systems.length) {
            var s = systems[i++];
            System.create({ name: s.system, coords: { x: s.x, y: s.y, z: s.z } });
            status.textContent = '[' + i + '/' + systems.length + '] ' + s.system;
            scrollMessages();
            setTimeout(addNext, 0);
          } else {
            System.endParticleSystem();
            status.classList.replace('info', 'success');
            status.textContent = filename + ': Loaded \u2014 ' + systems.length + ' system(s) from CSV.';
            scrollMessages();
            done();
          }
        }
        addNext();
      }

      function parseCsvText(filename, text, done) {
        if (typeof Papa === 'undefined') {
          addMessage(filename + ': CSV parser (PapaParse) not available.', 'error');
          done(); return;
        }
        var result = Papa.parse(text, { header: true, skipEmptyLines: true, dynamicTyping: false });

        if (!result.data || result.data.length === 0) {
          addMessage(filename + ': CSV file is empty or has no data rows.', 'error');
          done(); return;
        }

        var fields = result.meta.fields || [];
        var nameCol = pickColumn(fields, NAME_HEADERS);
        var xCol = pickColumn(fields, X_HEADERS);
        var yCol = pickColumn(fields, Y_HEADERS);
        var zCol = pickColumn(fields, Z_HEADERS);

        if (!nameCol) {
          addMessage(filename + ': CSV has no recognised system name column. Expected Name, System, or SystemName.', 'error');
          done(); return;
        }
        if (!xCol || !yCol || !zCol) {
          var missing = [!xCol && 'X', !yCol && 'Y', !zCol && 'Z'].filter(Boolean).join(', ');
          addMessage(filename + ': CSV is missing coordinate column(s): ' + missing + '. Expected X/Y/Z or CoordX/CoordY/CoordZ.', 'error');
          done(); return;
        }

        var systems = [];
        result.data.forEach(function (row) {
          var sysName = row[nameCol] ? String(row[nameCol]).trim() : '';
          var x = parseFloat(row[xCol]);
          var y = parseFloat(row[yCol]);
          var z = parseFloat(row[zCol]);
          if (sysName && !isNaN(x) && !isNaN(y) && !isNaN(z)) {
            systems.push({ system: sysName, x: x, y: y, z: z });
          }
        });

        if (systems.length === 0) {
          addMessage(filename + ': No valid rows found in CSV (check that Name and X/Y/Z columns have values).', 'error');
          done(); return;
        }

        addMessage(filename + ': Parsed ' + systems.length + ' system(s) from CSV.', 'info');
        displayCsvSystems(filename, systems, done);
      }

      // -----------------------------------------------------------------------

      function processRawText(filename, text, done) {
        // Handle CSV files by extension
        if (/\.csv$/i.test(filename)) {
          parseCsvText(filename, text, done);
          return;
        }
        // Try JSONL first
        var events = parseJsonl(text);
        if (isJournalJsonl(events)) {
          // A single NavRoute event parses as a one-element JSONL array but
          // should be handled as a plain JSON object, not a journal log.
          if (events.length === 1 && isNavRoute(events[0])) {
            handleParsedFile(filename, events[0], done);
            return;
          }
          handleJournalEvents(filename, events, done);
          return;
        }
        // Fall back to standard JSON object
        var data;
        try { data = JSON.parse(text); } catch (e) {
          addMessage(filename + ': Not valid JSON \u2014 ' + e.message, 'error');
          done(); return;
        }
        handleParsedFile(filename, data, done);
      }

      function handleJournalEvents(filename, events, done) {
        // Collect per-commander system lists
        var cmdrs = {};          // name -> [{ system, x, y, z }]
        var currentCmdr = 'Unknown';

        events.forEach(function (ev) {
          if (!ev || typeof ev.event !== 'string') return;
          if (ev.event === 'Commander' && ev.Name) {
            currentCmdr = ev.Name;
          }
          if ((ev.event === 'FSDJump' || ev.event === 'Location' || ev.event === 'CarrierJump') &&
            ev.StarSystem && Array.isArray(ev.StarPos) && ev.StarPos.length === 3) {
            if (!cmdrs[currentCmdr]) cmdrs[currentCmdr] = [];
            var last = cmdrs[currentCmdr];
            // Deduplicate consecutive identical systems
            if (!last.length || last[last.length - 1].system !== ev.StarSystem) {
              last.push({ system: ev.StarSystem, x: ev.StarPos[0], y: ev.StarPos[1], z: ev.StarPos[2] });
            }
          }
        });

        var cmdrNames = Object.keys(cmdrs);
        if (cmdrNames.length === 0) {
          addMessage(filename + ': No FSDJump/Location events with coordinates found.', 'error');
          done(); return;
        }

        // Display each commander sequentially
        var ci = 0;
        function nextCmdr() {
          if (ci >= cmdrNames.length) { done(); return; }
          var cmdrName = cmdrNames[ci++];
          var systems = cmdrs[cmdrName];
          addMessage(filename + ' \u2014 Commander ' + cmdrName + ': ' + systems.length + ' systems.', 'info');
          displayJournalRoute(filename, cmdrName, systems, nextCmdr);
        }
        nextCmdr();
      }

      function displayJournalRoute(filename, cmdrName, systems, done) {
        var idx = ++routeCounter;
        var name = 'journal-route-' + idx;
        var color = cmdrColor(cmdrName);

        if (!System.particleGeo) System.initParticleSystem();

        var status = addMessage('Adding ' + cmdrName + '\u2026', 'info');

        var i = 0;
        function addNext() {
          if (i < systems.length) {
            var s = systems[i++];
            System.create({ name: s.system, coords: { x: s.x, y: s.y, z: s.z } });
            status.textContent = '[' + i + '/' + systems.length + '] ' + cmdrName + ': ' + s.system;
            scrollMessages();
            setTimeout(addNext, 0);
          } else {
            finishJournalRoute();
          }
        }

        function finishJournalRoute() {
          System.endParticleSystem();

          if (systems.length > 1) {
            var journalRouteVerts = [];
            systems.forEach(function (s) {
              journalRouteVerts.push(s.x, s.y, -s.z);
            });
            var geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(journalRouteVerts), 3));
            var lineMat = new THREE.LineBasicMaterial({ color: color });
            var line = new THREE.Line(geo, lineMat);
            line.name = name;
            scene.add(line);
          }

          status.classList.replace('info', 'success');
          status.textContent = cmdrName + ': ' + systems.length + ' systems plotted.';
          scrollMessages();
          done();
        }

        addNext();
      }

      function displaySpanshSearch(filename, data, done) {
        // Deduplicate by system name — multiple bodies can share the same system.
        // Body-search results use system_name/system_x/y/z; system-search results
        // use name/x/y/z directly on each result entry.
        var seen = {};
        var systems = [];
        data.results.forEach(function (r) {
          var sysName = r.system_name || r.name;
          var sx = (r.system_x !== undefined) ? r.system_x : r.x;
          var sy = (r.system_y !== undefined) ? r.system_y : r.y;
          var sz = (r.system_z !== undefined) ? r.system_z : r.z;
          if (sysName && sx !== undefined && sy !== undefined && sz !== undefined && !seen[sysName]) {
            seen[sysName] = true;
            systems.push({ system: sysName, x: sx, y: sy, z: sz });
          }
        });

        if (systems.length === 0) {
          addMessage(filename + ': Spansh search result has no systems.', 'error');
          done(); return;
        }

        if (!System.particleGeo) System.initParticleSystem();

        var ref = data.reference ? data.reference.name : '';
        var status = addMessage('Adding systems\u2026', 'info');

        var i = 0;
        function addNext() {
          if (i < systems.length) {
            var s = systems[i++];
            System.create({ name: s.system, coords: { x: s.x, y: s.y, z: s.z } });
            status.textContent = '[' + i + '/' + systems.length + '] ' + s.system;
            scrollMessages();
            setTimeout(addNext, 0);
          } else {
            System.endParticleSystem();
            status.classList.replace('info', 'success');
            status.textContent = filename + ': Loaded \u2014 ' + systems.length + ' system(s)' +
              (ref ? ' near ' + ref : '') + ' (results ' +
              data.from + '\u2013' + (data.from + systems.length - 1) +
              ' of ' + data.count + ').';
            scrollMessages();
            done();
          }
        }
        addNext();
      }

      function displaySpanshRoute(filename, from, to, jumps, done) {
        var idx = ++routeCounter;
        var name = 'spansh-route-' + idx;

        // Ensure the particle system is ready (it should be after initial load)
        if (!System.particleGeo) System.initParticleSystem();

        // Live status line that updates with each system name
        var status = addMessage('Adding systems\u2026', 'info');

        // Add systems one at a time yielding to the browser between each so
        // the status line and spinner actually repaint.
        var i = 0;
        function addNext() {
          if (i < jumps.length) {
            var jump = jumps[i++];
            System.create({
              name: jump.system,
              coords: { x: jump.x, y: jump.y, z: jump.z }
            });
            status.textContent = '[' + i + '/' + jumps.length + '] ' + jump.system;
            scrollMessages();
            setTimeout(addNext, 0);
          } else {
            // All systems added â€” flush particles and draw the route line
            finishRoute();
          }
        }

        function finishRoute() {
          // Flush particles first so the new systems appear
          System.endParticleSystem();

          // Build a line through all jump coordinates.
          // The scene uses negated Z (same convention as System.create).
          var spanshRouteVerts = [];
          jumps.forEach(function (jump) {
            spanshRouteVerts.push(jump.x, jump.y, -jump.z);
          });
          var geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(spanshRouteVerts), 3));

          var lineMat = new THREE.LineBasicMaterial({ color: 0xFF9D00 });
          var line = new THREE.Line(geo, lineMat);
          line.name = name;
          scene.add(line);

          // Replace the live status line with a final success message
          status.classList.replace('info', 'success');
          status.textContent = filename + ': Loaded \u2014 ' + jumps.length + ' jumps from \u201c' + from + '\u201d to \u201c' + to + '\u201d.';
          scrollMessages();
          done();
        }

        addNext();
      }

    })();

    //-- Add Count filters (initial pass â€” use updateFilterCounts for subsequent updates)
    HUD.updateFilterCounts();

    //-- Add map filters (delegated so dynamically-added filters also respond)
    hudDelegate(document.getElementById('filters'), 'click', '.map_filter', function (e) {
      e.preventDefault();
      var idCat = this.dataset.filter;
      // data-active starts as "1" in the markup addFilter writes. jQuery's
      // .data() handed back a number and stored one; dataset keeps strings, and
      // the arithmetic below coerces either the same way.
      var active = this.dataset.active;
      active = (Math.abs(active - 1));

      //------------------------------------------------------------------------
      //-- Single item by once

      if (!Ed3d.hudMultipleSelect) {

        document.querySelectorAll('.map_filter').forEach(function (f) {
          f.classList.add('disabled');
        });

        //-- Toggle systems particles
        System.points.forEach(function (point, index) {
          point.visible = 0;
          point.filtered = 0;
          System.setColor(index, new THREE.Color('#111111'));
          active = 1;
        });


        //-- Toggle routes
        if (Ed3d.catObjsRoutes.length > 0)
          Ed3d.catObjsRoutes.forEach(function (listGrpRoutes) {
            if (listGrpRoutes != undefined)
              listGrpRoutes.forEach(function (indexRoute) {
                scene.getObjectByName(indexRoute).visible = false;
                if (scene.getObjectByName(indexRoute + '-first') != undefined)
                  scene.getObjectByName(indexRoute + '-first').visible = false;
                if (scene.getObjectByName(indexRoute + '-last') != undefined)
                  scene.getObjectByName(indexRoute + '-last').visible = false;
              });
          });

      }

      //------------------------------------------------------------------------
      //-- multiple select

      var center = null;
      var nbPoint = 0;
      var pointFar = null;

      //-- Toggle routes

      if (Ed3d.catObjsRoutes.length > 0 && Ed3d.catObjsRoutes[idCat])
        Ed3d.catObjsRoutes[idCat].forEach(function (indexRoute) {
          var isVisible = scene.getObjectByName(indexRoute).visible;
          if (isVisible == undefined) isVisible = true;
          isVisible = (isVisible ? false : true);
          scene.getObjectByName(indexRoute).visible = isVisible;
          if (scene.getObjectByName(indexRoute + '-first') != undefined)
            scene.getObjectByName(indexRoute + '-first').visible = isVisible;
          if (scene.getObjectByName(indexRoute + '-last') != undefined)
            scene.getObjectByName(indexRoute + '-last').visible = isVisible;
        });

      //-- Toggle systems particles

      (Ed3d.catObjs[idCat] || []).forEach(function (indexPoint) {

        var obj = System.points[indexPoint];

        System.setColor(indexPoint, (active == 1)
          ? obj.color
          : new THREE.Color('#111111'));

        obj.visible = (active == 1);
        obj.filtered = (active == 1);

        //-- Sum coords to detect the center & detect the most far point
        if (center == null) {
          center = new THREE.Vector3(obj.x, obj.y, obj.z);
          pointFar = new THREE.Vector3(obj.x, obj.y, obj.z);
        } else {
          center.set(
            (center.x + obj.x),
            (center.y + obj.y),
            (center.z + obj.z)
          );
          if (
            (Math.abs(pointFar.x) - Math.abs(obj.x)) +
            (Math.abs(pointFar.y) - Math.abs(obj.y)) +
            (Math.abs(pointFar.z) - Math.abs(obj.z)) < 0
          ) {
            pointFar.set(obj.x, obj.y, obj.z);
          }
        }
        nbPoint++;

      });

      if (nbPoint == 0) return;

      //------------------------------------------------------------------------
      //-- Calc center of all selected points

      center.set(
        Math.round(center.x / nbPoint),
        Math.round(center.y / nbPoint),
        -Math.round(center.z / nbPoint)
      );

      this.dataset.active = active;
      this.classList.toggle('disabled');

      //-- If current selection is no more visible, disable active selection
      if (Action.oldSel != null && !Action.oldSel.visible) Action.disableSelection();

      //-- Calc max distance from center of selection
      var distance = pointFar.distanceTo(center) + 200;

      //-- Set new camera & target position
      //Ed3d.playerPos = [center.x,center.y,center.z];
      //Ed3d.cameraPos = [
      //  center.x + (Math.floor((Math.random() * 100) + 1)-50), //-- Add a small rotation effect
      //  center.y + distance,
      //  center.z - distance
      //];

      //Action.moveInitalPosition();
    });


    HUD.initSystemSearch();

  },


  /**
   * Init filter list â€” safe to call multiple times with growing category sets.
   * New groups and items are appended; existing ones are skipped.
   */

  'initFilters': function (categories) {

    Loader.update('HUD Filter...');

    // Ensure we have a stable map of typeFilter â†’ groupId so we can
    // append new items into the correct existing group on subsequent calls.
    if (!HUD.filterGroupIds) HUD.filterGroupIds = {};
    var grpNb = Object.keys(HUD.filterGroupIds).length + 1;

    Object.keys(categories).forEach(function (typeFilter) {
      var values = categories[typeFilter];

      if (typeof values === "object") {

        var groupId;
        var isNewGroup = !HUD.filterGroupIds[typeFilter];

        if (isNewGroup) {
          // Create the group header and container
          groupId = 'group_' + grpNb;
          HUD.filterGroupIds[typeFilter] = groupId;
          var filtersEl = document.getElementById('filters');
          if (filtersEl) {
            filtersEl.insertAdjacentHTML('beforeend', '<h2>' + typeFilter + '</h2>');
            filtersEl.insertAdjacentHTML('beforeend', '<div id="' + groupId + '"></div>');
          }
          grpNb++;
        } else {
          groupId = HUD.filterGroupIds[typeFilter];
        }

        var nbFilters = values.length;
        var count = isNewGroup ? 0 : document.querySelectorAll('#' + groupId + ' .filter').length;
        var visible = true;
        var addedAny = false;

        Object.keys(values).forEach(function (key) {
          var val = values[key];

          // Skip items already registered
          if (Ed3d.catObjs[key] !== undefined) return;

          visible = true;

          //-- Manage view limit if activated
          if (Ed3d.categoryAutoCollapseSize !== false) {
            count++;
            if (count > Ed3d.categoryAutoCollapseSize) visible = false;
          }

          //-- Add filter
          HUD.addFilter(groupId, key, val, visible);
          Ed3d.catObjs[key] = [];
          addedAny = true;

        });

        // Add/update the "See more" toggle if needed
        if (addedAny && visible == false && document.querySelectorAll('#' + groupId + ' .show_childs').length === 0) {
          var group = document.getElementById(groupId);
          if (group) {
            group.insertAdjacentHTML('beforeend',
              '<a class="show_childs">' +
              '+ See more' +
              '</a>'
            );
            // Bound to the group, not to the link just added: .append() returned
            // the original selection, so .click() landed here. Kept as it was —
            // any click inside the group expands it — because moving it to the
            // link changes what the panel does, which is not this change's job.
            group.addEventListener('click', function () {
              HUD.expandFilters(groupId);
            });
          }
        }
      }

    });


  },

  /**
   * Expand filter
   */

  /**
   * System typeahead search
   */
  'initSystemSearch': function () {

    var currentSuggestions = [];
    var debounceTimer = null;
    var activeIndex = -1;

    function getApiUrl(q) {
      return window.CanonnAPI.query('typeahead', { q: q });
    }

    function results() {
      return document.getElementById('system-search-results');
    }

    function closeResults() {
      var ul = results();
      if (ul) {
        hudHide(ul);
        ul.innerHTML = '';
      }
      activeIndex = -1;
    }

    function items() {
      var ul = results();
      return ul ? Array.prototype.slice.call(ul.querySelectorAll('li')) : [];
    }

    function selectSystem(name) {
      // Case-insensitive match in fetched suggestions
      var nameLower = name.toLowerCase();
      var found = null;
      for (var i = 0; i < currentSuggestions.length; i++) {
        if (currentSuggestions[i].name.toLowerCase() === nameLower) {
          found = currentSuggestions[i];
          break;
        }
      }
      if (!found) return;

      var box = document.getElementById('system-search-input');
      if (box) box.value = found.name;
      closeResults();

      // Check if system already exists on the map (case-insensitive)
      var existingIndex = -1;
      if (System.particleGeo !== null) {
        var verts = System.points;
        for (var j = 0; j < verts.length; j++) {
          if (verts[j].name && verts[j].name.toLowerCase() === nameLower) {
            existingIndex = j;
            break;
          }
        }
      }

      var infoHtml = '<a href="https://signals.canonn.tech/?system=' +
        encodeURIComponent(found.name) + '" target="_blank">View on Signals</a>';

      if (existingIndex >= 0) {
        // System already on map â€” navigate to it
        var selPoint = System.points[existingIndex];
        if (!selPoint.infos) selPoint.infos = infoHtml;
        Action.moveToObj(existingIndex, selPoint);
      } else {
        // System not on map â€” add it as a new pin then navigate
        System.create({
          name: found.name,
          coords: { x: found.x, y: found.y, z: found.z },
          infos: infoHtml
        });
        System.endParticleSystem();
        var newIndex = System.points.length - 1;
        var newPoint = System.points[newIndex];
        Action.moveToObj(newIndex, newPoint);
      }
    }

    hudDelegate(document, 'input', '#system-search-input', function () {
      clearTimeout(debounceTimer);
      var q = this.value.trim();
      if (q.length < 2) {
        closeResults();
        return;
      }
      debounceTimer = setTimeout(function () {
        fetch(getApiUrl(q))
          .then(function (res) { return res.json(); })
          .then(function (data) {
            currentSuggestions = (data && data.min_max) ? data.min_max : [];
            var values = (data && data.values) ? data.values : [];
            var ul = results();
            if (!ul) return;
            ul.innerHTML = '';
            if (values.length === 0) {
              hudHide(ul);
              return;
            }
            values.forEach(function (name) {
              var li = document.createElement('li');
              li.textContent = name;
              li.addEventListener('click', function () { selectSystem(li.textContent); });
              ul.appendChild(li);
            });
            activeIndex = -1;
            // styles.css hides this list outright, so it needs a real display
            // value rather than an empty one — see hudShow.
            hudShow(ul);
          })
          .catch(function (err) {
            console.warn('system search failed', err);
          });
      }, 300);
    });

    hudDelegate(document, 'keydown', '#system-search-input', function (e) {
      var list = items();
      if (!list.length) return;

      function highlight(index) {
        list.forEach(function (li) { li.classList.remove('active'); });
        if (list[index]) list[index].classList.add('active');
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex = Math.min(activeIndex + 1, list.length - 1);
        highlight(activeIndex);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = Math.max(activeIndex - 1, 0);
        highlight(activeIndex);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeIndex >= 0 && list[activeIndex]) {
          selectSystem(list[activeIndex].textContent);
        } else if (list.length > 0) {
          selectSystem(list[0].textContent);
        }
      } else if (e.key === 'Escape') {
        closeResults();
      }
    });

    document.addEventListener('click', function (e) {
      if (!(e.target.closest && e.target.closest('#system-search-wrap'))) {
        closeResults();
      }
    });

  },

  'expandFilters': function (groupId) {

    var group = document.getElementById(groupId);
    if (group) group.classList.add('open');

    var hud = document.getElementById('hud');
    if (hud) hud.classList.add('enlarge');


  },

  /**
   * Init on-screen 3D navigation buttons (Zoom In/Out + Pan 4-directions + Reset)
   */
  'initNavControls': function () {

    var navControls = document.getElementById('nav-controls');
    if (!navControls) return;

    var _navTimer = null;

    function startRepeat(fn) {
      fn();
      _navTimer = setInterval(fn, 80);
    }

    function stopRepeat() {
      if (_navTimer !== null) {
        clearInterval(_navTimer);
        _navTimer = null;
      }
    }

    function zoomIn() {
      var dir = new THREE.Vector3().subVectors(camera.position, controls.target);
      var dist = dir.length() * 0.9;
      var minDist = controls.minDistance || 1;
      if (dist < minDist) dist = minDist;
      dir.setLength(dist);
      camera.position.copy(controls.target).add(dir);
      controls.update();
    }

    function zoomOut() {
      var dir = new THREE.Vector3().subVectors(camera.position, controls.target);
      var dist = dir.length() * 1.1;
      var maxDist = controls.maxDistance || 60000;
      if (dist > maxDist) dist = maxDist;
      dir.setLength(dist);
      camera.position.copy(controls.target).add(dir);
      controls.update();
    }

    function panCamera(dx, dy) {
      var dist = camera.position.distanceTo(controls.target);
      var speed = dist * 0.04;
      var right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
      var up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
      var offset = new THREE.Vector3()
        .addScaledVector(right, dx * speed)
        .addScaledVector(up, dy * speed);
      camera.position.add(offset);
      controls.target.add(offset);
      controls.update();
    }

    function bindNavBtn(id, fn) {
      hudOn(document.getElementById(id), 'mousedown touchstart', function (e) {
        e.preventDefault();
        e.stopPropagation();
        startRepeat(fn);
      });
    }

    hudOn(document, 'mouseup touchend touchcancel', stopRepeat);

    bindNavBtn('nav-zoom-in', zoomIn);
    bindNavBtn('nav-zoom-out', zoomOut);
    bindNavBtn('nav-pan-up', function () { panCamera(0, 1); });
    bindNavBtn('nav-pan-down', function () { panCamera(0, -1); });
    bindNavBtn('nav-pan-left', function () { panCamera(-1, 0); });
    bindNavBtn('nav-pan-right', function () { panCamera(1, 0); });

    hudOn(document.getElementById('nav-pan-reset'), 'mousedown touchstart', function (e) {
      e.preventDefault();
      e.stopPropagation();
      Action.moveInitalPosition();
    });

    // Block all pointer events from leaking through to OrbitControls
    hudOn(navControls, 'mousedown pointerdown touchstart wheel click contextmenu', function (e) {
      e.stopPropagation();
    });

  },

  /**
   * Remove filters list
   */

  'removeFilters': function () {

    var filtersEl = document.querySelector('#hud #filters');
    if (filtersEl) filtersEl.innerHTML = '';

  },


  /**
   *
   */
  'addFilter': function (groupId, idCat, val, visible) {

    //-- Add material, if custom color defined, use it
    var back = '#fff';
    var addClass = '';

    if (val.color != undefined) {
      Ed3d.addCustomMaterial(idCat, val.color);
      back = '#' + val.color;
    }

    if (!visible) {
      addClass += ' hidden';
    }

    //-- Add html link
    var group = document.getElementById(groupId);
    if (group) group.insertAdjacentHTML('beforeend',
      '<a class="map_filter' + addClass + '" data-active="1" data-filter="' + idCat + '">' +
      '<span class="check" style="background:' + back + '"> </span>' + val.name +
      '</a>'
    );
  },

  /**
   *
   */
  'openHudDetails': function () {
    hudHide(document.getElementById('hud'));
    var details = document.getElementById('systemDetails');
    if (details) {
      details.classList.remove('hud-collapsed');
      hudShow(details);
      // The .hover() that used to be chained on here bound the same pair of
      // handlers initHudAction already binds on #systemDetails — and bound
      // another pair on every open, so they piled up for the life of the page.
    }
    // Restore toggle icon to open state and reposition against the detail panel
    HUD.resetToggleIcon();
    if (HUD.repositionToggle) HUD.repositionToggle(true);
  },
  /**
   *
   */
  'closeHudDetails': function () {
    var details = document.getElementById('systemDetails');
    if (details) {
      hudHide(details);
      details.classList.remove('hud-collapsed');
    }
    var hud = document.getElementById('hud');
    if (hud) {
      hud.classList.remove('hud-collapsed');
      hudShow(hud);
    }
    // Restore toggle icon and reposition against the main hud panel
    HUD.resetToggleIcon();
    if (HUD.repositionToggle) HUD.repositionToggle(false);
  },

  /** The open-panel state of the collapse button, set from both details paths. */
  'resetToggleIcon': function () {
    var toggle = document.getElementById('hud-toggle');
    if (!toggle) return;
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('title', 'Collapse panel');
    toggle.setAttribute('aria-label', 'Collapse panel');
    toggle.querySelectorAll('i').forEach(function (icon) {
      icon.classList.remove('fa-chevron-right');
      icon.classList.add('fa-chevron-left');
    });
  },

  /**
   *
   */

  'setInfoPanel': function (index, point) {

    var html =
      '<h2>' + point.name + '</h2>' +
      '<div class="coords">' +
      '  <span>' + point.x + '</span><span>' + point.y + '</span><span>' + (-point.z) + '</span>' +
      '</div>' +
      (point.infos != undefined && point.infos !== '' ? '<div>' + point.infos + '</div>' : '') +
      '<div class="hover-distance"></div>' +
      '<div id="nav">' +
      '</div>';

    var details = document.getElementById('systemDetails');
    if (!details) return;
    details.innerHTML = html;

    //-- Add navigation

    var nav = details.querySelector('#nav');
    if (!nav) return;
    [['<', function () { Action.moveNextPrev(index - 1, -1); }],
     ['X', function () { HUD.closeHudDetails(); }],
     ['>', function () { Action.moveNextPrev(index + 1, 1); }]
    ].forEach(function (pair) {
      var a = document.createElement('a');
      a.textContent = pair[0];
      a.addEventListener('click', pair[1]);
      nav.appendChild(a);
    });

  },


  /**
   * Add Shape text
   */

  'addText': function (id, textShow, x, y, z, size, addToObj, isPoint) {

    // r185 dropped THREE.FontUtils; Ed3d.font (loaded once in Ed3d.init())
    // provides the equivalent synchronous generateShapes(text, size). Guard
    // in case this runs before the async load has completed.
    if (!Ed3d.font) return;

    if (addToObj == undefined) addToObj = scene;
    if (isPoint == undefined) isPoint = false;

    var textShapes = Ed3d.font.generateShapes(textShow, size);

    var textGeo = new THREE.ShapeGeometry(textShapes);

    if (Ed3d.textSel[id] == undefined) {
      var textMesh = new THREE.Mesh(textGeo, new THREE.MeshBasicMaterial({
        color: 0xffffff
      }));
    } else {
      var textMesh = Ed3d.textSel[id];
    }

    textMesh.geometry = textGeo;
    textMesh.geometry.needsUpdate = true;

    if (isPoint) {
      textMesh.position.set(addToObj.x, addToObj.y, addToObj.z);
      textMesh.name = id;
      scene.add(textMesh);
    } else {
      textMesh.position.set(x, y, z);
      addToObj.add(textMesh);
    }

    Ed3d.textSel[id] = textMesh;

  },

  /**
   * Add Shape text
   */

  'rotateText': function (id) {

    //y = -Math.abs(y);

    if (Ed3d.textSel[id] != undefined)
      if (Ed3d.isTopView) {
        Ed3d.textSel[id].rotation.set(-Math.PI / 2, 0, 0);
      } else {
        Ed3d.textSel[id].rotation.x = 0;
        Ed3d.textSel[id].rotation.y = camera.rotation.y;
        Ed3d.textSel[id].rotation.z = 0;
      }

  }
}


export { HUD };
