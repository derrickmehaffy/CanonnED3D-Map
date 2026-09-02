// Entry module. Imports every engine singleton and republishes it on window
// before anything initialises.
//
// Engine files call each other by bare name (HUD.create(), System.count, ...)
// and the 30 data files in Source/data/ do the same. Rather than converting
// those into imports — which would create real cycles, since Ed3d, HUD and
// Action all reference each other — every singleton is assigned to window
// here. Bare references resolve against the global object at call time, and
// nothing cross-references at module-evaluation time.
//
// This is the same compatibility posture the design doc chose for the data
// files, applied one layer inward. Phase 2 may tighten it; Phase 1 does not.

import { Ed3d, Loader, getEngineState, routes, isFarView } from './ed3dmap.js';
import { Grid } from './components/grid.class.js';
import { Ico } from './components/icon.class.js';
import { HUD } from './components/hud.class.js';
import { Action } from './components/action.class.js';
import { Route } from './components/route.class.js';
import { System } from './components/system.class.js';
import { Galaxy } from './components/galaxy.class.js';
import { Heatmap } from './components/heat.class.js';

Object.assign(window, {
  Ed3d: Ed3d,
  Loader: Loader,
  Grid: Grid,
  Ico: Ico,
  HUD: HUD,
  Action: Action,
  Route: Route,
  System: System,
  Galaxy: Galaxy,
  Heatmap: Heatmap,
  // route.class.js and hud.class.js index into `routes` as a bare global.
  // It's a plain array, populated later by mutating indices (routes[id] =
  // ...), so publishing the reference once here is enough — no wrapper
  // needed, unlike scene/camera below.
  routes: routes
});

// grid.class.js and action.class.js read `isFarView` as a bare global to
// gate far-view behaviour. Unlike `routes`, it's a boolean primitive that
// ed3dmap.js *reassigns* (isFarView = true/false) inside enableFarView() /
// disableFarView(), so a one-time copy would go stale. `isFarView` above is
// a live ES module binding — reading it always sees ed3dmap.js's current
// value — so a getter that reads the import keeps window.isFarView current
// without needing a setter (nothing outside ed3dmap.js ever assigns to it).
Object.defineProperty(window, 'isFarView', {
  get: function () { return isFarView; },
  configurable: true
});

// scene/camera/controls/renderer/container are created inside initScene().
// Ed3d.initScene() is called early in launchMap(), and everything launchMap()
// does afterward — Grid.init(), HUD.create(), Galaxy.addGalaxyCenter(),
// System.create() while streaming in the initial data — runs synchronously
// within that same call and reads scene/camera/etc. as bare globals. Wrapping
// launchMap() itself (publishing only after it returns) is too late: those
// component-module calls happen before launchMap() returns, so window.scene
// would still be undefined when they run. Wrapping initScene() instead
// republishes the state the moment it exists, before any of that runs.
var originalInitScene = Ed3d.initScene;
Ed3d.initScene = function () {
  var result = originalInitScene.apply(this, arguments);
  Object.assign(window, getEngineState());
  return result;
};

// Signal that the engine is ready. Pages call their data file's init() from a
// DOMContentLoaded handler, which fires after all deferred scripts, so this
// has always run by then.
window.__ed3dReady = true;
