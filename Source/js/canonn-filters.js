/**
 * The three-level dropdown filter above the HUD: Science / Class / Name, plus
 * an "Odyssey only" checkbox.
 *
 * This was 88 byte-identical lines in MapData-NHSS.js, MapData-Codex.js and
 * MapData-Cmdr.js — the same builder, the same `toggleFilterHeader`, the same
 * `getURLParameter` and `sortObj` beside them. Three copies of a thing is three
 * places to fix it, and the jQuery it was written in had to come out of all
 * three anyway, so it comes out once here.
 *
 * A classic script setting one global, the same posture canonn-api.js,
 * canonn-fmt.js and canonn-palette.js take, and for the same reason: the data
 * loaders are classic scripts and cannot import. Load it before them.
 */
(function (root) {
  'use strict';

  /** One query-string parameter, or null. */
  function param(name) {
    return decodeURIComponent(
      (new RegExp('[?|&]' + name + '=' + '([^&;]+?)(&|#|;|$)').exec(location.search)
        || [null, ''])[1].replace(/\+/g, '%20')
    ) || null;
  }

  /**
   * A copy of `obj` whose keys are in alphabetical order, recursively. Objects
   * keep string keys in insertion order, so rebuilding one in sorted order is
   * what makes it iterate sorted.
   *
   * It returns a copy — it does not sort in place. All three loaders called it
   * as a statement and threw the result away, so the dropdowns were never
   * actually sorted; `build` uses the return value.
   */
  function sortObj(obj) {
    return Object.keys(obj).sort().reduce(function (result, key) {
      result[key] = (/boolean|number|string/).test(typeof obj[key]) || !obj[key]
        ? obj[key]
        : sortObj(obj[key]);
      return result;
    }, {});
  }

  function dropdown(name, placeholder) {
    var sel = document.createElement('select');
    sel.name = name;
    sel.id = 'select_' + name;
    sel.className = 'filter_dropdown';
    sel.appendChild(option('', placeholder));
    return sel;
  }

  function option(value, label) {
    var opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    return opt;
  }

  /**
   * Show or hide the block after a filter heading, then re-click the links
   * inside it.
   *
   * `$(el).trigger('click')` ran jQuery's handlers and then the native method,
   * guarding itself against seeing its own synthetic event twice; a plain
   * `el.click()` dispatches once and jQuery-bound handlers still hear it, so
   * the count is the same either way.
   */
  function toggleFilterHeader(event) {
    var next = event.target.nextElementSibling;
    // jQuery's .next('div') matches only the immediate sibling, and only if it
    // is a div — it does not go looking further down the list.
    if (!next || next.tagName !== 'DIV') return;
    next.style.display = getComputedStyle(next).display === 'none' ? '' : 'none';
    var links = next.querySelectorAll('a');
    for (var i = 0; i < links.length; i++) links[i].click();
  }

  /**
   * Build the filter form from a hierarchy of
   * `{ hud_category: { sub_class: { english_name: { platform } } } }` and mount
   * it at the top of `#filters`.
   *
   * A category only appears if something under it survives the filtering, which
   * is why the two `found` flags exist: asking for one name should not leave
   * every other class listed with nothing in it.
   */
  function build(hierarchy, urlParams) {
    var sorted = sortObj(hierarchy);

    var hudmenu = dropdown('hud_category', '-- Science --');
    var submenu = dropdown('sub_class', '-- Class --');
    var namemenu = dropdown('english_name', '-- Name --');

    Object.keys(sorted).forEach(function (hud_category) {
      if (urlParams.hud_category && urlParams.hud_category !== hud_category) return;

      var sub_found = false;
      Object.keys(sorted[hud_category]).forEach(function (sub_class) {
        if (urlParams.sub_class && urlParams.sub_class !== sub_class) return;

        var name_found = false;
        var last_english_short = '';
        Object.keys(sorted[hud_category][sub_class]).forEach(function (english_name) {
          if (urlParams.english_name && english_name.indexOf(urlParams.english_name) < 0) return;
          if (urlParams.platform
            && sorted[hud_category][sub_class][english_name].platform !== urlParams.platform) return;

          // Names arrive as "Thing - variant"; the dropdown lists the thing.
          // Sorted keys put the variants of one name next to each other, so
          // comparing against the last one is enough to collapse them.
          var english_short = english_name.split(' - ')[0];
          if (english_short === last_english_short) return;
          last_english_short = english_short;

          namemenu.appendChild(option(english_short, english_short));
          name_found = true;
        });

        if (name_found) {
          submenu.appendChild(option(sub_class, sub_class));
          sub_found = true;
        }
      });

      if (sub_found) hudmenu.appendChild(option(hud_category, hud_category));
    });

    var form = document.createElement('form');
    form.id = 'filters_form';
    form.action = '';
    form.method = 'get';

    form.appendChild(hudmenu);
    form.appendChild(submenu);

    var box = document.createElement('span');
    box.className = 'checkbox';
    box.innerHTML = '<label for="filters_check_legacy">Odyssey only'
      + '<input type="checkbox" id="filters_check_legacy" name="platform" value="odyssey">'
      + '<span class="fakebox"></span></label>';
    if (urlParams.platform === 'odyssey') box.querySelector('input').checked = true;
    form.appendChild(box);

    form.appendChild(namemenu);

    // Reflect the choice already in the URL back into the dropdowns.
    Object.keys(urlParams).forEach(function (p) {
      if (p === 'platform' || !urlParams[p]) return;
      var opt = form.querySelector('#select_' + p + ' option[value="' + urlParams[p] + '"]');
      if (opt) opt.selected = true;
    });

    // Changing anything reloads the page with the new parameters.
    var inputs = form.querySelectorAll('select, .checkbox input');
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].addEventListener('change', function () { form.submit(); });
    }

    var filters = document.getElementById('filters');
    if (!filters) return form;
    filters.insertBefore(form, filters.firstChild);

    var heads = filters.querySelectorAll('h2');
    for (var h = 0; h < heads.length; h++) {
      heads[h].style.cursor = 'pointer';
      heads[h].addEventListener('click', toggleFilterHeader);
    }
    return form;
  }

  root.CanonnFilters = {
    param: param,
    sortObj: sortObj,
    build: build,
    toggleFilterHeader: toggleFilterHeader
  };
})(typeof window !== 'undefined' ? window : globalThis);
