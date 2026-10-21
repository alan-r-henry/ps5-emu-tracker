// Sorts the A to Z games index with the same options as the tracker's playable-games section.
// A separate file rather than an inline script, so the Content Security Policy can forbid inline code.
// Without JavaScript the list stays A to Z and game.css hides the sort menu.
(function () {
  var list = document.getElementById('gp-index');
  var select = document.getElementById('gp-sort');
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

  function apply(sort) {
    list.append.apply(list, items.slice().sort(orders[sort] || byTitle));
  }

  var wanted = new URLSearchParams(location.search).get('sort');
  if (wanted && orders[wanted]) {
    select.value = wanted;
    apply(wanted);
  }
  select.addEventListener('change', function () {
    apply(select.value);
    var url = new URL(location.href);
    if (select.value === 'title') url.searchParams.delete('sort'); else url.searchParams.set('sort', select.value);
    history.replaceState(null, '', url);
  });
})();
