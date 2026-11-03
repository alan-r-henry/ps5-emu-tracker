// Searches, filters and sorts the games index with the same options as the tracker's playable-games section.
// A separate file rather than an inline script, so the Content Security Policy can forbid inline code.
// Without JavaScript the list stays A to Z and game.css hides the tools.
(function () {
  var list = document.getElementById('gp-index');
  var select = document.getElementById('gp-sort');
  var query = document.getElementById('gp-q');
  var emu = document.getElementById('gp-emu');
  var count = document.getElementById('gp-count');
  var none = document.getElementById('gp-nomatch');
  if (!list || !select) return;
  var items = Array.prototype.slice.call(list.children);
  var titles = new Map(items.map(function (li) { return [li, li.querySelector('a').textContent]; }));
  var byTitle = function (a, b) { return titles.get(a).localeCompare(titles.get(b), undefined, { sensitivity: 'base' }); };

  // Newest or highest first; games missing the value always go last, then A to Z.
  function by(key, numeric) {
    return function (a, b) {
      var x = a.dataset[key], y = b.dataset[key];
      if (x == null || y == null) return x == null ? (y == null ? byTitle(a, b) : 1) : -1;
      var d = numeric ? Number(y) - Number(x) : y.localeCompare(x);
      return d || byTitle(a, b);
    };
  }
  var orders = { tested: by('tested'), title: byTitle, popularity: by('ratings', true), released: by('released'), fps: by('fps', true) };

  function sort(key) {
    list.append.apply(list, items.slice().sort(orders[key] || byTitle));
  }

  // Every word must appear in the title or a title ID, so "gta v" and "ppsa03420" both find GTA V.
  function filter() {
    var words = (query ? query.value : '').toLowerCase().split(/\s+/).filter(Boolean);
    var on = emu ? emu.value : '';
    var shown = 0;
    items.forEach(function (li) {
      var q = li.dataset.q || '';
      var hit = (!on || (' ' + li.dataset.emu + ' ').indexOf(' ' + on + ' ') >= 0) &&
        words.every(function (w) { return q.indexOf(w) >= 0; });
      li.hidden = !hit;
      if (hit) shown++;
    });
    if (none) none.hidden = shown > 0;
    if (count) count.textContent = words.length || on ? shown + (shown === 1 ? ' game matches' : ' games match') : '';
  }

  // The choices live in the address, so a filtered or sorted list can be shared or bookmarked.
  function remember() {
    var url = new URL(location.href);
    var set = function (k, v) { if (v) url.searchParams.set(k, v); else url.searchParams.delete(k); };
    set('sort', select.value === 'title' ? '' : select.value);
    set('q', query ? query.value.trim() : '');
    set('emulator', emu ? emu.value : '');
    history.replaceState(null, '', url);
  }

  var params = new URLSearchParams(location.search);
  var wanted = params.get('sort');
  if (wanted && orders[wanted]) {
    select.value = wanted;
    sort(wanted);
  }
  if (query && params.get('q')) query.value = params.get('q');
  if (emu && params.get('emulator')) {
    emu.value = params.get('emulator');
    if (emu.selectedIndex < 0) emu.value = '';
  }
  filter();

  select.addEventListener('change', function () {
    sort(select.value);
    remember();
  });
  if (query) query.addEventListener('input', function () { filter(); remember(); });
  if (emu) emu.addEventListener('change', function () { filter(); remember(); });
})();
