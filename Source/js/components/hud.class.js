import * as THREE from 'three';

/**
 * Three things jQuery did that plain DOM calls do not, kept because the file
 * leans on them several times each.
 *
 * These elements are hidden by an inline `display:none` that this file wrote,
 * so clearing it is all showing them takes. `hudShow` used to carry a second
 * branch that forced a real display value when a stylesheet was also hiding
 * the element; the one element that needed it was the HUD's typeahead, which
 * has since been removed, and #hud's own `display:none !important` in
 * console.css cannot be beaten by an inline value anyway. Dead either way.
 */
function hudShow(el) {
  if (el) el.style.display = '';
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
