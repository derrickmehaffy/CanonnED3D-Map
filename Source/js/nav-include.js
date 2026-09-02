/**
 * Local replacement for w3schools' w3data.js.
 *
 * Implements only the w3-include-html behaviour this site uses.  The function
 * name and attribute are kept identical so pages need only swap the script
 * src; per-page logic that toggles the attribute (see ida-data.html) keeps
 * working unchanged.  nav.html contains no nested includes, so a single pass
 * is sufficient.
 *
 * Once every matched element has been injected, this also dispatches a
 * window 'resize' event. ed3dmap.js's #edmap sizing (adjustMapToNav, top of
 * that file) previously relied on a MutationObserver that is disconnected at
 * window 'load' -- if the nav injection resolved after load (the normal
 * case, since fetch() is always async), adjustMapToNav() never ran again and
 * #edmap kept its unsized CSS height. ed3dmap.js already has a permanent
 * 'resize' listener wired to adjustMapToNav(), so firing one synthetic
 * resize right after injection re-triggers correct sizing with no change
 * needed there.
 */
function w3IncludeHTML(callback) {

  var nodes = document.querySelectorAll('[w3-include-html]');

  if (nodes.length === 0) {
    if (typeof callback === 'function') callback();
    return;
  }

  var pending = nodes.length;

  Array.prototype.forEach.call(nodes, function (el) {

    var file = el.getAttribute('w3-include-html');

    fetch(file)
      .then(function (res) {
        if (!res.ok) throw new Error(res.status + ' ' + file);
        return res.text();
      })
      .then(function (html) {
        el.innerHTML = html;
      })
      .catch(function (err) {
        el.innerHTML = '';
        console.error('nav include failed:', err);
      })
      .then(function () {
        el.removeAttribute('w3-include-html');
        pending -= 1;
        if (pending === 0) {
          window.dispatchEvent(new Event('resize'));
          if (typeof callback === 'function') callback();
        }
      });
  });
}
