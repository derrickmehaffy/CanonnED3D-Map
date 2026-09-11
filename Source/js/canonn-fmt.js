/**
 * Two formatters both halves of the site need.
 *
 * `esc` and `num` existed independently in console.js and orrery.js, and
 * console.js had two `esc` declarations in one scope — the later of which
 * silently won. They differed: one turned null into an empty string, the other
 * into the literal text "null", and the one that lost was the careful one. Two
 * copies of a function is a nuisance; two copies that disagree is a bug waiting
 * for the right input.
 *
 * A classic script setting one global, the same posture canonn-api.js and
 * canonn-palette.js take, and for the same reason: console.js is a classic
 * script and cannot import, while orrery.js is a module and can read a global
 * quite happily. Load it before either of them.
 */
(function (root) {
  'use strict';

  var HTML = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

  root.CanonnFmt = {
    /**
     * Text safe to drop into markup.
     *
     * Nullish becomes empty rather than the word "null", because every caller
     * here is interpolating a value that may simply be absent — a system with
     * no government, a body with no atmosphere — and "null" on screen is a
     * bug report waiting to be filed.
     */
    esc: function (s) {
      return String(s === null || s === undefined ? '' : s)
        .replace(/[&<>"]/g, function (c) { return HTML[c]; });
    },

    /**
     * A number at a given precision with the padding taken off: 1.50 reads as
     * 1.5, 2.00 as 2, and 0 as "0" rather than as an empty string.
     *
     * The strip has to be anchored to the decimal point. It was not, so with
     * dp = 0 there was no point for the regex to find and it ate the integer's
     * own zeros: num(1500, 0) came back "15" and num(100, 0) came back "1".
     * Live at orrery.js's millisecond readout, where two bodies half a
     * light-second apart reported "5 ms" instead of 500.
     */
    num: function (v, dp) {
      return Number(v).toFixed(dp)
        .replace(/(\.\d*?)0+$/, '$1')   // trailing zeros, but only after a point
        .replace(/\.$/, '')             // and the point itself if nothing is left
        || '0';
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
