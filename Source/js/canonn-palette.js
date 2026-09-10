/**
 * Stable colours for map categories.
 *
 * Eight of the map data files used to set their category colours with
 * `randomColor()`, evaluated as the file loaded. That meant Guardian Ruins site
 * types, Thargoid barnacle classes and five other maps came up a different
 * colour on every visit. It never looked broken, because the legend and the
 * points always agreed with each other — but nobody could ever learn that a
 * colour means a site type, which is the whole job of a legend.
 *
 * The scheme, rather than a list of arbitrary distinct colours:
 *
 *   the hue says what kind of thing it is,
 *   the shade says which type within that kind.
 *
 * The five kinds are the ones the orrery's own signal legend already commits
 * to in orrery.css — Guardian purple, Thargoid yellow-green, biology green,
 * geology orange, human grey — so a Guardian ruin is the same colour whether
 * you meet it on the galaxy map or in a system. That agreement is the reason
 * for anchoring to them rather than picking eight new colours.
 *
 * A classic script setting one global, deliberately, the same posture as
 * canonn-api.js: the data files are classic scripts and cannot import. Load it
 * before any MapData-*.js.
 */
(function (root) {
  'use strict';

  /* The anchors, verbatim from orrery.css so the two cannot drift:
     .orrery{--bio:#6FBF73;--geo:#D08B3C;--gua:#A98BE0;--thg:#B9D94A;--hum:#93A3B1} */
  var KIND = {
    guardian: '#A98BE0',
    thargoid: '#B9D94A',
    bio:      '#6FBF73',
    geo:      '#D08B3C',
    human:    '#93A3B1'
  };

  /* Not a kind: "Unknown" and "Unclassified" categories exist on several maps
     and mean "we have not been told", which is worth looking like nothing
     rather than like a sixth kind of thing. */
  var UNKNOWN = '#6E7F8D';

  function toHsl(hex) {
    var n = parseInt(hex.slice(1), 16);
    var r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    var h = 0, s = 0, l = (mx + mn) / 2;
    if (d) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s * 100, l * 100];
  }

  function toHex(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = Math.max(0, Math.min(100, s)) / 100;
    l = Math.max(0, Math.min(100, l)) / 100;
    var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1));
    var m = l - c / 2, seg = Math.floor(h / 60) % 6;
    var rgb = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][seg];
    return '#' + rgb.map(function (v) {
      return ('0' + Math.round((v + m) * 255).toString(16)).slice(-2);
    }).join('').toUpperCase();
  }

  root.CanonnPalette = {
    kind: KIND,
    unknown: UNKNOWN,

    /**
     * One step within a kind: `of('guardian', 0, 4)` is the first of four
     * Guardian shades.
     *
     * Lightness carries most of the separation and the hue rotates a little
     * with it, because a ramp of pure lightness on one hue reads as a mistake
     * where a slight turn reads as a family. A single-category map gets the
     * anchor untouched.
     *
     * Returns "#RRGGBB". Ed3d wants it without the hash, and every call site
     * strips it the same way it always did.
     */
    of: function (kind, i, n) {
      var anchor = KIND[kind] || KIND.human;
      if (!n || n < 2) return anchor;
      var hsl = toHsl(anchor);
      var t = i / (n - 1);                    // 0 … 1
      /* Around the anchor rather than away from it, so the middle of a long
         ramp is the colour the legend elsewhere uses. */
      return toHex(hsl[0] + (t - 0.5) * 26,
                   hsl[1] - (t - 0.5) * 14,
                   hsl[2] + (0.5 - t) * 30);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
