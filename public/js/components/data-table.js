/* ═══════════════════════════════════════════════════════════════
   STEP 18 — Data table enhancer (S18.02/06/07/08)
   - Sortable headers (aria-sort, click toggles asc/desc)
   - Debounced search (S18.06: 150–250ms, loading, count, clear)
   - Filter chips + clear all (S18.07: state visible)
   - URL/query stable state (S18.08: back navigation saqlanadi)
   - Density preference in localStorage (S18.04)
   Usage:
     const t = new DataTable(document.querySelector('[data-dt]'), {
       sortable: true, search: true, density: true, key: 'users'
     });
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var DENSITY_KEY = 'edikit-dt-density';

  function DataTable(root, opts) {
    if (!root) return;
    opts = opts || {};
    this.root = root;
    this.table = root.querySelector('table') || root;
    this.tbody = this.table.querySelector('tbody');
    this.key = opts.key || 'dt';
    this.onRowFilter = opts.onRowFilter || null;

    // S18.08: URL/query state — ?dt_key=... 
    this.q = new URLSearchParams(global.location ? global.location.search : '');
    this._loadState();
    this._buildToolbar(opts);
    this._bindSort(opts);
    this._bindSearch();
    this._applyDensity();
    this._apply(); // boshlang'ich count/holatlarni render qiladi
  }

  DataTable.prototype._loadState = function () {
    var q = this.q;
    this.state = {
      sortKey: q.get(this.key + '_sort') || '',
      sortDir: q.get(this.key + '_dir') || '',
      search: q.get(this.key + '_q') || '',
      filters: {},
    };
  };

  DataTable.prototype._persist = function () {
    var key = this.key;
    var q = new URLSearchParams(global.location ? global.location.search : '');
    if (this.state.sortKey) q.set(key + '_sort', this.state.sortKey); else q.delete(key + '_sort');
    if (this.state.sortDir) q.set(key + '_dir', this.state.sortDir); else q.delete(key + '_dir');
    if (this.state.search) q.set(key + '_q', this.state.search); else q.delete(key + '_q');
    var qs = q.toString();
    var url = global.location ? global.location.pathname + (qs ? '?' + qs : '') : '';
    try { global.history.replaceState(null, '', url); } catch (e) { /* noop */ }
  };

  DataTable.prototype._buildToolbar = function (opts) {
    var self = this;
    if (!opts.search && !opts.density) return;

    // Existing toolbar? Reuse, else create above table.
    var toolbar = this.root.querySelector('.dt-toolbar');
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.className = 'dt-toolbar';
      this.table.parentNode.insertBefore(toolbar, this.table);
    }
    this.toolbar = toolbar;

    if (opts.search) {
      var searchWrap = document.createElement('div');
      searchWrap.className = 'dt-search' + (this.state.search ? ' has-value' : '');
      searchWrap.innerHTML =
        '<span class="dt-search-ico" aria-hidden="true">&#128269;</span>' +
        '<input type="search" class="dt-search-input" placeholder="Qidirish…" aria-label="Qidirish" value="' + this._esc(this.state.search) + '">' +
        '<span class="dt-search-status" aria-hidden="true"><span class="spinner spinner--sm"></span></span>' +
        '<button type="button" class="dt-search-clear" aria-label="Qidiruvni tozalash">&#10005;</button>';
      toolbar.appendChild(searchWrap);
      this.searchWrap = searchWrap;
      this.searchInput = searchWrap.querySelector('.dt-search-input');
      this.searchStatus = searchWrap.querySelector('.dt-search-status');
      this.searchClear = searchWrap.querySelector('.dt-search-clear');
    }

    var count = document.createElement('span');
    count.className = 'dt-count';
    count.setAttribute('role', 'status');
    toolbar.appendChild(count);
    this.count = count;

    if (opts.density) {
      var density = document.createElement('div');
      density.className = 'dt-density';
      density.setAttribute('role', 'group');
      density.setAttribute('aria-label', 'Zichlik');
      density.innerHTML =
        '<button type="button" data-density="default" aria-pressed="false">Standart</button>' +
        '<button type="button" data-density="compact" aria-pressed="false">Zich</button>';
      toolbar.appendChild(density);
      this.densityEl = density;
    }

    // Live region for SR announcements (S18.06) — role=status => implicit polite
    var live = document.createElement('div');
    live.className = 'dt-live';
    live.setAttribute('role', 'status');
    document.body.appendChild(live);
    this.live = live;

    // Filter chips container (S18.07)
    var filters = document.createElement('div');
    filters.className = 'dt-filters';
    filters.style.display = 'none';
    toolbar.appendChild(filters);
    this.filtersEl = filters;
  };

  DataTable.prototype._bindSort = function (opts) {
    var self = this;
    if (!opts.sortable) return;
    var ths = this.table.querySelectorAll('th[data-sort]');
    ths.forEach(function (th) {
      var key = th.getAttribute('data-sort');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dt-sort';
      btn.innerHTML = th.textContent + ' <span class="dt-sort-ico" aria-hidden="true">&#8597;</span>';
      th.textContent = '';
      th.appendChild(btn);
      // aria-sort from initial state
      if (self.state.sortKey === key) {
        th.setAttribute('aria-sort', self.state.sortDir === 'desc' ? 'descending' : 'ascending');
      }
      btn.addEventListener('click', function () {
        var isSame = self.state.sortKey === key;
        self.state.sortDir = isSame && self.state.sortDir === 'asc' ? 'desc' : 'asc';
        self.state.sortKey = key;
        ths.forEach(function (t) { t.removeAttribute('aria-sort'); });
        th.setAttribute('aria-sort', self.state.sortDir === 'asc' ? 'ascending' : 'descending');
        self._persist();
        self._apply();
        self._announce('Sartlangan: ' + key + ' (' + self.state.sortDir + ')');
      });
    });
  };

  DataTable.prototype._bindSearch = function () {
    var self = this;
    if (!this.searchInput) return;
    var debounceTimer = null;
    var DEBOUNCE_MS = 200; // S18.06: 150–250ms

    this.searchInput.addEventListener('input', function () {
      var val = this.value.trim();
      clearTimeout(debounceTimer);
      self.searchStatus.setAttribute('aria-hidden', 'false');
      self.searchStatus.textContent = '…';
      debounceTimer = setTimeout(function () {
        self.state.search = val;
        self.searchWrap.classList.toggle('has-value', !!val);
        self.searchStatus.setAttribute('aria-hidden', 'true');
        self.searchStatus.textContent = '';
        self._persist();
        self._apply();
        self._announce('Topildi: ' + self.count.textContent);
      }, DEBOUNCE_MS);
    });

    this.searchClear.addEventListener('click', function () {
      self.state.search = '';
      self.searchInput.value = '';
      self.searchWrap.classList.remove('has-value');
      self._persist();
      self._apply();
      self.searchInput.focus();
    });
  };

  DataTable.prototype.addFilterChip = function (label, value) {
    var self = this;
    this.state.filters[value] = label;
    this._renderChips();
    this._apply();
  };

  DataTable.prototype.removeFilterChip = function (value) {
    delete this.state.filters[value];
    this._renderChips();
    this._apply();
  };

  DataTable.prototype.clearFilters = function () {
    this.state.filters = {};
    this._renderChips();
    this._apply();
  };

  DataTable.prototype._renderChips = function () {
    var self = this;
    var keys = Object.keys(this.state.filters);
    if (!keys.length) { this.filtersEl.style.display = 'none'; return; }
    this.filtersEl.style.display = 'flex';
    this.filtersEl.innerHTML = '<span class="dt-filters-label">Filterlar:</span>';
    keys.forEach(function (k) {
      var chip = document.createElement('span');
      chip.className = 'dt-chip';
      chip.innerHTML = '<span>' + self._esc(self.state.filters[k]) + '</span>' +
        '<button type="button" aria-label="Olib tashlash: ' + self._esc(self.state.filters[k]) + '">&#10005;</button>';
      chip.querySelector('button').addEventListener('click', function () {
        self.removeFilterChip(k);
        self._announce('Filter olib tashlandi');
      });
      self.filtersEl.appendChild(chip);
    });
    var clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'dt-clear-all';
    clear.textContent = 'Barchasini tozalash';
    clear.addEventListener('click', function () {
      self.clearFilters();
      self._announce('Barcha filterlar tozalandi');
    });
    this.filtersEl.appendChild(clear);
  };

  DataTable.prototype._applyDensity = function () {
    var self = this;
    var saved = null;
    try { saved = global.localStorage.getItem(DENSITY_KEY); } catch (e) { /* noop */ }
    this.density = saved === 'compact' ? 'compact' : 'default';
    this._renderDensity();
    if (!this.densityEl) return;
    this.densityEl.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        self.density = this.getAttribute('data-density');
        try { global.localStorage.setItem(DENSITY_KEY, self.density); } catch (e) { /* noop */ }
        self._renderDensity();
      });
    });
  };

  DataTable.prototype._renderDensity = function () {
    this.table.setAttribute('data-density', this.density);
    if (this.densityEl) {
      this.densityEl.querySelectorAll('button').forEach(function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-density') === this.density ? 'true' : 'false');
      }, this);
    }
  };

  DataTable.prototype._matches = function (row) {
    var q = this.state.search.toLowerCase();
    if (q) {
      var txt = row.textContent.toLowerCase();
      if (txt.indexOf(q) === -1) return false;
    }
    for (var k in this.state.filters) {
      var v = this.state.filters[k];
      if (row.getAttribute('data-' + k) !== String(v)) return false;
    }
    return true;
  };

  DataTable.prototype._apply = function () {
    var self = this;
    var rows = Array.prototype.slice.call(this.tbody.querySelectorAll('tr'));
    var visible = rows.filter(function (r) { return self._matches(r); });

    // Sort
    if (this.state.sortKey) {
      var key = this.state.sortKey;
      var dir = this.state.sortDir === 'desc' ? -1 : 1;
      visible.sort(function (a, b) {
        var av = (a.getAttribute('data-' + key) || a.textContent.trim()).toLowerCase();
        var bv = (b.getAttribute('data-' + key) || b.textContent.trim()).toLowerCase();
        var an = parseFloat(av), bn = parseFloat(bv);
        if (!isNaN(an) && !isNaN(bn)) { return (an - bn) * dir; }
        return av < bv ? -dir : av > bv ? dir : 0;
      });
    }

    rows.forEach(function (r) { r.style.display = 'none'; });
    visible.forEach(function (r) { r.style.display = ''; });

    // Sort DOM tartibini ham yangilaydi (visual order = sort order)
    if (this.state.sortKey && visible.length > 1) {
      visible.forEach(function (r) { self.tbody.appendChild(r); });
    }

    // S18.10: horizontal overflow affordance — haqiqiy scroll check
    this._updateScrollAffordance();

    if (this.count) {
      this.count.innerHTML = '<b>' + visible.length + '</b> / ' + rows.length + ' ta';
    }
  };

  DataTable.prototype._updateScrollAffordance = function () {
    var wrap = this.root.querySelector('.dt-wrap') || this.table.closest('.dt-wrap');
    if (!wrap) return;
    var check = function () {
      var scrollable = wrap.scrollWidth > wrap.clientWidth + 4;
      wrap.classList.toggle('is-scrollable', scrollable);
    };
    if (this._affCheck) { wrap.removeEventListener('scroll', this._affCheck); }
    this._affCheck = check;
    wrap.addEventListener('scroll', check, { passive: true });
    check();
  };

  DataTable.prototype._announce = function (msg) {
    if (this.live) {
      this.live.textContent = '';
      // Force reflow for repeated announcements
      void this.live.offsetWidth;
      this.live.textContent = msg;
    }
  };

  DataTable.prototype._esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  global.DataTable = DataTable;
})(typeof window !== 'undefined' ? window : this);
