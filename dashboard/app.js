// Token Radar radar-3 dashboard: renders window.RADAR (written by main.ts),
// filters and sorts the board, opens a detail view per protocol, and lets
// the reader re-rank the board live by moving the model's weights. No
// network requests: every number comes from data.js.
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) { document.getElementById('board').textContent = 'No radar data loaded.'; return; }

  var FLOOR = 0.72;
  var SIGMA = 0.85;

  function $(id) { return document.getElementById(id); }
  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function moneyFull(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function pct(x) { return x === null || x === undefined ? '—' : (x > 0 ? '+' : '') + x.toFixed(1) + '%'; }
  function ageText(a) { return a === null || a === undefined ? '—' : a < 365 ? a + 'd' : (a / 365).toFixed(1) + 'y'; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  var state = { q: '', cat: '', chain: '', wl: false, sort: 'value', tab: 'pre', growth: 0.4, peak: 540, pct: 1 };

  function maturity(age, peak) {
    if (age === null || age === undefined) return 1;
    var x = Math.log(age + 30) - Math.log(peak + 30);
    return FLOOR + (1 - FLOOR) * Math.exp(-(x * x) / (2 * SIGMA * SIGMA));
  }

  function growthF(change) {
    if (change === null || change === undefined) return 1;
    return 1 + state.growth * (clamp(change, -50, 150) / 100);
  }

  function displayValue(r) {
    var mult = state.pct === 0 ? r.mult_lo : state.pct === 2 ? r.mult_hi : r.mult;
    return r.tvl * mult * growthF(r.change) * maturity(r.age, state.peak);
  }

  function visibleRows() {
    var rows = state.tab === 'live' ? liveAsRows() : D.rows;
    return rows.filter(function (r) {
      if (state.wl && !r.watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        if (r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function liveAsRows() {
    return D.live.map(function (l, i) {
      return {
        slug: l.slug, name: l.name, rank: i + 1, value: l.mcap_usd, low: l.mcap_usd, high: l.mcap_usd,
        category: l.category, chains: l.chains, primary: l.chains[0] || 'Ethereum', tvl: l.tvl_usd,
        change: l.change_7d, age: null, mult: l.mcap_tvl, mult_lo: l.mcap_tvl, mult_hi: l.mcap_tvl,
        growth: 1, maturity: 1, watchlist: false, steps: [], live: true,
      };
    });
  }

  function sortRows(rows) {
    var key = state.sort;
    var val = function (r) { return state.tab === 'live' ? r.value : displayValue(r); };
    var cmp = {
      value: function (a, b) { return val(b) - val(a); },
      tvl: function (a, b) { return b.tvl - a.tvl; },
      growth: function (a, b) { return (b.change === null ? -1e9 : b.change) - (a.change === null ? -1e9 : a.change); },
      age: function (a, b) { return (b.age === null ? -1 : b.age) - (a.age === null ? -1 : a.age); },
      name: function (a, b) { return a.name.localeCompare(b.name); },
      rank: function (a, b) { return a.rank - b.rank; },
    }[key] || cmp.value;
    return rows.slice().sort(cmp);
  }

  function rowHtml(r, i) {
    var v = state.tab === 'live' ? r.value : displayValue(r);
    var range = state.tab === 'live'
      ? '×' + r.mult.toFixed(2) + ' of TVL'
      : money(r.low) + ' – ' + money(r.high);
    var chg = r.change === null ? '<td class="num">—</td>'
      : '<td class="num ' + (r.change >= 0 ? 'pos' : 'neg') + '">' + pct(r.change) + '</td>';
    return '<tr data-slug="' + esc(r.slug) + '">'
      + '<td class="num">' + (state.tab === 'live' ? i + 1 : r.rank) + '</td>'
      + '<td class="name">' + esc(r.name) + (r.watchlist ? '<span class="star" title="On the watchlist">★ watchlist</span>' : '') + '</td>'
      + '<td>' + esc(r.category || '—') + '</td>'
      + '<td>' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>'
      + '<td class="num">' + money(r.tvl) + '</td>'
      + chg
      + '<td class="num">' + ageText(r.age) + '</td>'
      + '<td class="value">' + money(v) + '<span class="range">' + esc(range) + '</span></td>'
      + '</tr>';
  }

  function render() {
    var rows = sortRows(visibleRows());
    var tb = document.querySelector('#board-table tbody');
    tb.innerHTML = rows.map(rowHtml).join('');
    $('row-count').textContent = rows.length + ' of ' + (state.tab === 'live' ? D.live.length : D.rows.length)
      + (state.tab === 'live' ? ' token-bearing protocols' : ' pre-token protocols') + ' shown.';
    $('board').setAttribute('aria-busy', 'false');
  }

  function renderComps() {
    var tb = document.querySelector('#comps-table tbody');
    tb.innerHTML = D.model.comps.slice(0, 8).map(function (c) {
      return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.n + '</td>'
        + '<td class="num">' + c.median.toFixed(2) + '×</td>'
        + '<td class="num">' + c.p25.toFixed(2) + '–' + c.p75.toFixed(2) + '×</td></tr>';
    }).join('');
  }

  function renderMeta() {
    $('top-meta').innerHTML = '<span>Snapshot <b>' + esc(D.as_of) + '</b></span>'
      + '<span><b>' + D.rows.length + '</b> pre-token rows</span>'
      + '<span><b>' + D.watchlist_count + '</b> on the watchlist</span>'
      + '<span>Model <b>' + esc(D.version) + '</b></span>';
    $('facts').innerHTML = '<div><span>Protocols scanned</span><b>758</b></div>'
      + '<div><span>Watchlist floor</span><b>' + moneyFull(D.floor_usd) + '</b></div>'
      + '<div><span>Global comps median</span><b>' + D.model.global_multiple.toFixed(2) + '× TVL</b></div>'
      + '<div><span>Live-token comps</span><b>' + D.live.length + '</b></div>'
      + '<div><span>Source</span><b>DefiLlama</b></div>';
    $('asof').textContent = D.as_of;
  }

  function openDetail(slug) {
    var r = D.rows.find(function (x) { return x.slug === slug; });
    if (!r) return;
    var v = displayValue(r);
    var base = r.tvl * r.mult;
    var gf = growthF(r.change);
    var mf = maturity(r.age, state.peak);
    var bars = [
      ['TVL × comps multiple', money(base), 1],
      ['Growth factor (' + pct(r.change) + ' in 7d)', '×' + gf.toFixed(2), gf / 1.6],
      ['Maturity factor (' + ageText(r.age) + ')', '×' + mf.toFixed(2), mf],
      ['Implied value', money(v), 1],
    ];
    var steps = r.steps.map(function (s) {
      var lead = s.split(':')[0];
      return '<li><b>' + esc(lead) + ':</b> ' + esc(s.slice(lead.length + 1).trim()) + '</li>';
    }).join('');
    $('detail-body').innerHTML = '<h2>' + esc(r.name) + '</h2>'
      + '<p class="sub">Rank ' + r.rank + ' · ' + esc(r.category || 'Uncategorised') + ' · '
      + esc(r.chains.join(', ')) + (r.watchlist ? ' · ★ on the watchlist' : '') + '</p>'
      + '<h3>Implied value: ' + money(v) + ' <span class="muted">(' + money(r.low) + ' – ' + money(r.high) + ')</span></h3>'
      + '<div class="bars">' + bars.map(function (b) {
        return '<div class="bar-row"><span class="lbl">' + esc(b[0]) + '</span>'
          + '<span class="bar-track"><span class="bar-fill" style="width:' + Math.round(clamp(b[2], 0, 1) * 100) + '%"></span></span>'
          + '<span class="val">' + esc(b[1]) + '</span></div>';
      }).join('') + '</div>'
      + '<h3>Farm plan</h3><ol class="steps">' + steps + '</ol>'
      + '<p class="caveat">' + esc(r.name) + ' records no token in the snapshot — that is the record, '
      + 'not proof it has none. The implied value is this radar’s own claim, never a price.</p>';
    $('detail').showModal();
  }

  function fillSelect(id, values) {
    var sel = $(id);
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v; o.textContent = v;
      sel.appendChild(o);
    });
  }

  // controls
  fillSelect('category', [...new Set(D.rows.map(function (r) { return r.category; }).filter(Boolean))].sort());
  fillSelect('chain', [...new Set(D.rows.flatMap(function (r) { return r.chains; }))].sort());
  $('search').addEventListener('input', function (e) { state.q = e.target.value.trim(); render(); });
  $('category').addEventListener('change', function (e) { state.cat = e.target.value; render(); });
  $('chain').addEventListener('change', function (e) { state.chain = e.target.value; render(); });
  $('watchlist-only').addEventListener('change', function (e) { state.wl = e.target.checked; render(); });
  $('sort').addEventListener('change', function (e) { state.sort = e.target.value; render(); });
  document.querySelectorAll('#board-table thead th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      state.sort = th.getAttribute('data-sort');
      var sel = $('sort');
      if ([...sel.options].some(function (o) { return o.value === state.sort; })) sel.value = state.sort;
      render();
    });
  });
  document.querySelector('#board-table tbody').addEventListener('click', function (e) {
    var tr = e.target.closest('tr');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });
  $('tab-pre').addEventListener('click', function () {
    state.tab = 'pre';
    $('tab-pre').classList.add('active'); $('tab-live').classList.remove('active');
    render();
  });
  $('tab-live').addEventListener('click', function () {
    state.tab = 'live';
    $('tab-live').classList.add('active'); $('tab-pre').classList.remove('active');
    render();
  });

  // sandbox: re-rank live from the same figures
  function syncSandbox() {
    $('growth-out').textContent = state.growth.toFixed(2);
    $('peak-out').textContent = String(state.peak);
    $('pct-out').textContent = state.pct === 0 ? '25th' : state.pct === 2 ? '75th' : '50th';
    $('sandbox-note').textContent = 'Now ranking with growth weight ' + state.growth.toFixed(2)
      + ', maturity peak ' + state.peak + ' days, ' + $('pct-out').textContent + ' percentile comps.';
    render();
  }
  $('growth-weight').addEventListener('input', function (e) { state.growth = parseFloat(e.target.value); syncSandbox(); });
  $('peak-days').addEventListener('input', function (e) { state.peak = parseInt(e.target.value, 10); syncSandbox(); });
  $('comps-pct').addEventListener('input', function (e) { state.pct = parseInt(e.target.value, 10); syncSandbox(); });

  renderMeta();
  renderComps();
  render();
})();
