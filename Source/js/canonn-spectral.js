/**
 * A star's colour from its spectral class.
 *
 * This existed twice — console.js for the system card's disc, orrery.js for the
 * star it draws — and the two copies disagreed. The orrery tried key lengths
 * 3, then 2, then 1; the console only 2, then 1. So "TTS" was added to
 * data/spectral-colors.json for the orrery and the console could never reach
 * it: a T Tauri star came out `#aa2c51`, the deep magenta of a T-class brown
 * dwarf four thousand degrees colder, on one surface and `#ffcb9c` on the
 * other. A commander looking at the card and the orrery side by side saw two
 * different stars.
 *
 * One table, fetched once, and one lookup. A classic script setting one
 * global, the posture canonn-api.js, canonn-fmt.js, canonn-palette.js and
 * canonn-filters.js already take, and for the same reason: console.js is a
 * classic script and cannot import, while orrery.js is a module and reads a
 * global perfectly well.
 */
(function (root) {
  'use strict';

  var TABLE = null;
  var asked = null;

  root.CanonnSpectral = {
    /**
     * Fetch the table once. Safe to call from anywhere, any number of times —
     * every caller gets the same promise.
     *
     * A missing table leaves every disc unlit, which is honest: it means
     * unclassified, not "no star". Not worth failing a page over, but it is
     * worth saying out loud, because the alternative is every star silently
     * grey and no way to tell why.
     */
    load: function () {
      if (!asked) {
        asked = fetch('data/spectral-colors.json')
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) {
            if (!j) console.warn('CanonnSpectral: spectral-colors.json did not load; stars will be unlit');
            TABLE = j || {};
            return TABLE;
          })
          .catch(function (e) {
            console.warn('CanonnSpectral: spectral-colors.json failed; stars will be unlit', e);
            TABLE = {};
            return TABLE;
          });
      }
      return asked;
    },

    /** The raw table, or null before load() has resolved. */
    table: function () { return TABLE; },

    /**
     * '#rrggbb' for a spectral class, or '' when the table cannot place it.
     *
     * Longest key first, and that ordering is the whole point of this file.
     * "K3" is K and "DA" is D, but "TTS6" is a T Tauri star and emphatically
     * not a T-class brown dwarf.
     */
    colour: function (cls) {
      if (!TABLE || !cls) return '';
      var c = String(cls).toUpperCase();
      var key = TABLE[c] ? c
              : TABLE[c.slice(0, 3)] ? c.slice(0, 3)
              : TABLE[c.slice(0, 2)] ? c.slice(0, 2)
              : TABLE[c.charAt(0)] ? c.charAt(0) : '';
      if (!key) return '';
      // Wolf-Rayet carries two colours; the first is the one to draw.
      return '#' + String(TABLE[key]).split(',')[0].replace(/^#/, '');
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
