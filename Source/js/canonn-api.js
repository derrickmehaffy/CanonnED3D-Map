/**
 * One address for Canonn's data.
 *
 * Twelve call sites across ten files each carried the whole endpoint as a
 * string literal, with the GCP region and the project id baked into every one
 * of them:
 *
 *     https://us-central1-canonn-api-236217.cloudfunctions.net/query/codex
 *
 * Which meant that moving the functions, changing region, putting a cache or a
 * proxy in front of them, or adding so much as a shared query parameter was a
 * ten-file edit with no way to tell whether you had found them all — and two
 * of the ten are data files nobody reads unless that map is broken.
 *
 * They all come through here now. Nothing else in the repository should ever
 * name that host again.
 *
 * A classic script, deliberately. Half the callers are ES modules — the HUD's
 * typeahead, the codex overlay, the orrery — and half are the classic data
 * files and the console, which cannot import anything. A global that both can
 * read is the same compat posture main.js already takes for the engine
 * singletons, and it is documented in test/README.md for the same reason.
 * Load it before anything that fetches; it is a few hundred bytes and has no
 * dependencies of its own.
 */
(function (root) {
  'use strict';

  /* The functions are deployed per-region, so the region is part of the host
     rather than of the path. Two roots hang off it: most data is behind the
     "query" function, and a couple of the route builders are their own
     functions at the top level. */
  var HOST = 'https://us-central1-canonn-api-236217.cloudfunctions.net';

  /** "a=1&b=two" from a plain object, skipping anything not set. */
  function search(params) {
    if (!params) return '';
    var parts = [];
    for (var k in params) {
      if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
      var v = params[k];
      if (v === undefined || v === null || v === '') continue;
      /* Commas stay commas. They are legal in a query string — RFC 3986 lists
         them as a sub-delimiter — and the list endpoints were called with raw
         commas before this existed. Encoding them to %2C is the kind of
         silent change that breaks one map nobody looks at until it matters. */
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v).replace(/%2C/g, ','));
    }
    return parts.length ? '?' + parts.join('&') : '';
  }

  root.CanonnAPI = {
    host: HOST,

    /**
     * A path under the "query" function, which is where nearly everything is.
     *   query('codex/dump', { id: 1234 })
     *   query('typeahead', { q: 'Sol' })
     */
    query: function (path, params) {
      return HOST + '/query/' + String(path || '').replace(/^\/+/, '') + search(params);
    },

    /**
     * A cloud function called directly, for the few that are not under
     * "query" — the route builders.
     *   fn('get_codex_route')
     *   fn('get_gmp_route', { startSystem: 'Sol', endSystem: 'Colonia' })
     */
    fn: function (name, params) {
      return HOST + '/' + String(name || '').replace(/^\/+/, '') + search(params);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
