/* ═══════════════════════════════════════════════════════════════
   STEP 19 — Chart va evidence visualization components
   S19.01: question-to-chart matrix (distribution bar, revote paired
          bar, confidence 2x2, progress line, tiny counts table).
   S19.02: faqat bar/line/table — non-comparable chart turlari ishlatilmaydi.
   S19.03: label + value + numerator/denominator + context + action.
   S19.04: stable option order (response kelganda o'zgarmaydi).
   S19.05: CVD-safe — color + shape marker (bars get pattern class).
   S19.06: accessible data-table alternative.
   S19.07: direct labels (tooltip hover-only EMAS).
   S19.08: live update 120–180ms interruptible transition.
   S19.09: no-response neutral pattern (incorrectdan farqli).
   S19.10: insufficient-evidence state + sample threshold.
   S19.12: CSV export with accessible headers.
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var CSS_VARS = {
    s1: 'var(--deborah-data-viz-series-1, #2563EB)',
    s2: 'var(--deborah-data-viz-series-2, #06B6D4)',
    s3: 'var(--deborah-data-viz-series-3, #F59E0B)',
    s4: 'var(--deborah-data-viz-series-4, #10B981)',
    s5: 'var(--deborah-data-viz-series-5, #8B5CF6)',
    correct: 'var(--deborah-data-viz-correct, #16A34A)',
    incorrect: 'var(--deborah-data-viz-incorrect, #DC2626)',
    neutral: 'var(--deborah-semantic-color-text-muted, #94A3B8)',
  };

  // CVD-safe markers — grayscale'da ham farqlanadi (S19.05)
  var SHAPES = ['■', '▲', '●', '◆', '✚'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function pct(count, total) {
    if (!total) return 0;
    return Math.round((count / total) * 1000) / 10;
  }

  /* ── S19.10: sample threshold ── */
  function hasEnoughEvidence(total, threshold) {
    return total >= (threshold == null ? 3 : threshold);
  }

  /* ── S19.01: Distribution horizontal bar ──
     data: { options: [{id,label,count,correct,noResponse}], total, sampleThreshold }
     order: options array order = stable (S19.04). */
  function distributionBar(root, data) {
    if (!root) return null;
    var opts = data.options || [];
    var total = data.total || 0;
    var enough = hasEnoughEvidence(total, data.sampleThreshold);

    if (!enough) {
      root.innerHTML =
        '<div class="ev-insufficient" role="status">' +
        '<span class="ev-insufficient-ico" aria-hidden="true">ℹ</span>' +
        '<div><div class="ev-insufficient-title">Yetarli dalil yo‘q</div>' +
        '<div class="ev-insufficient-sub">' + total + ' ta javob — minimal ' + (data.sampleThreshold || 3) + ' ta kerak</div></div></div>';
      return null;
    }

    // Metric header: label + value + numerator/denominator (S19.03)
    var html = '<div class="ev-metric">' +
      '<div class="ev-metric-head"><span class="ev-metric-label">' + esc(data.label || '') + '</span>' +
      '<span class="ev-metric-value">' + total + ' <span class="ev-metric-unit">javob</span></span></div>' +
      (data.context ? '<div class="ev-metric-context">' + esc(data.context) + '</div>' : '') +
      '</div>';

    html += '<div class="ev-dist">';
    opts.forEach(function (o, i) {
      var c = o.count || 0;
      var p = pct(c, total);
      var shape = SHAPES[i % SHAPES.length];
      var cls = 'ev-dist-row';
      if (o.correct) cls += ' is-correct';
      if (o.noResponse) cls += ' is-no-response';
      html +=
        '<div class="' + cls + '" data-shape="' + shape + '">' +
        '<span class="ev-dist-opt" title="' + esc(o.label || o.id || '') + '">' +
        '<span class="ev-dist-marker" aria-hidden="true">' + shape + '</span>' +
        esc(o.label || o.id || '') + '</span>' +
        '<span class="ev-dist-track" role="img" aria-label="' + esc(o.label || o.id || '') + ': ' + p + '%">' +
        '<span class="ev-dist-bar" style="width:' + Math.max(2, p) + '%;background:' + (CSS_VARS['s' + (i + 1)] || CSS_VARS.s1) + '"></span>' +
        '</span>' +
        '<span class="ev-dist-num"><b>' + p + '%</b> <span class="ev-dist-frac">' + c + '/' + total + '</span></span>' +
        '</div>';
    });
    html += '</div>';

    // S19.09: no-response neutral line
    if (data.noResponse != null) {
      html += '<div class="ev-nr" role="status"><span class="ev-nr-dot" aria-hidden="true"></span>' +
        'Javob bermagan: <b>' + data.noResponse + '</b></div>';
    }

    root.innerHTML = html;
    // S19.08: interruptible live-update transition (reduced-motion'dan tashqari)
    if (data.animate !== false && (!window.matchMedia || !window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      root.querySelectorAll('.ev-dist-bar').forEach(function (bar) {
        var target = parseFloat(bar.style.width) || 0;
        bar.style.width = '0%';
        animateWidth(bar, 0, target, 160);
      });
    }
    // Accessible table alternative (S19.06) — appended after bars
    root.appendChild(tableAlternative(data, opts, total));
    return root;
  }

  /* ── S19.06: Accessible data table alternative ── */
  function tableAlternative(data, opts, total) {
    var tbl = document.createElement('details');
    tbl.className = 'ev-table-alt';
    var sum = document.createElement('summary');
    sum.textContent = 'Jadval ko‘rinishi';
    tbl.appendChild(sum);

    var t = document.createElement('table');
    var thead = '<thead><tr><th scope="col">Variant</th><th scope="col" class="dt-num">Javoblar</th><th scope="col" class="dt-num">Foiz</th></tr></thead>';
    var rows = opts.map(function (o) {
      return '<tr><th scope="row">' + esc(o.label || o.id || '') + '</th>' +
        '<td class="dt-num">' + (o.count || 0) + '</td>' +
        '<td class="dt-num">' + pct(o.count || 0, total) + '%</td></tr>';
    }).join('');
    t.innerHTML = thead + '<tbody>' + rows + '</tbody>';
    tbl.appendChild(t);
    return tbl;
  }

  /* ── S19.08: Interruptible transition helper ──
     Oldin boshlangan transition to'xtatiladi — rolling odometer yo'q. */
  function animateWidth(bar, from, to, ms) {
    // start'ni birinchi rAF timestamp'idan olamiz — performance.now()'ga bog'liq emas,
    // shuning uchun clock fixed/test muhitida ham t >= 0 kafolatlanadi (S19.08)
    var start = null;
    function step(now) {
      if (start === null) start = now;
      var t = Math.min(1, Math.max(0, (now - start) / ms));
      if (t >= 1) {
        // CSS transition (S19.08) rAF final'ida ortda qolib, screenshot'ni beqaror
        // qilmasligi uchun o'chiriladi — bar target'da to'xtaydi.
        bar.style.transition = 'none';
        bar.style.width = to + '%';
        return;
      }
      // ease-out cubic — dramatic emas
      var eased = 1 - Math.pow(1 - t, 3);
      bar.style.width = (from + (to - from) * eased) + '%';
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ── S19.01: Revote paired bar (before vs after) ── */
  function revotePair(root, data) {
    if (!root) return null;
    var opts = data.options || [];
    var beforeTotal = data.beforeTotal || 0;
    var afterTotal = data.afterTotal || 0;

    var html = '<div class="ev-metric"><div class="ev-metric-head">' +
      '<span class="ev-metric-label">' + esc(data.label || '') + '</span>' +
      '<span class="ev-metric-value">' + afterTotal + ' <span class="ev-metric-unit">qayta ovoz</span></span></div></div>';

    html += '<div class="ev-pair">';
    opts.forEach(function (o, i) {
      var b = pct(o.before || 0, beforeTotal);
      var a = pct(o.after || 0, afterTotal);
      var shape = SHAPES[i % SHAPES.length];
      html +=
        '<div class="ev-pair-row">' +
        '<span class="ev-dist-opt"><span class="ev-dist-marker" aria-hidden="true">' + shape + '</span>' + esc(o.label || o.id || '') + '</span>' +
        '<div class="ev-pair-bars">' +
        '<div class="ev-pair-line"><span class="ev-pair-lbl">Oldin</span>' +
        '<span class="ev-dist-track"><span class="ev-dist-bar is-before" style="width:' + Math.max(2, b) + '%;background:' + (CSS_VARS['s' + (i + 1)] || CSS_VARS.s1) + '"></span></span>' +
        '<span class="ev-dist-num">' + b + '%</span></div>' +
        '<div class="ev-pair-line"><span class="ev-pair-lbl">Keyin</span>' +
        '<span class="ev-dist-track"><span class="ev-dist-bar is-after" style="width:' + Math.max(2, a) + '%;background:' + (CSS_VARS['s' + (i + 1)] || CSS_VARS.s1) + '"></span></span>' +
        '<span class="ev-dist-num"><b>' + a + '%</b></span></div>' +
        '</div></div>';
    });
    html += '</div>';
    root.innerHTML = html;
    root.appendChild(tableAlternative(data, opts.map(function (o) {
      return { label: o.label, id: o.id, count: o.after, correct: o.correct };
    }), afterTotal));
    return root;
  }

  /* ── S19.01: Confidence 2×2 grid ── */
  function confidenceGrid(root, data) {
    if (!root) return null;
    var cells = data.cells || []; // [{label, value, hint}]
    var html = '<div class="ev-metric"><div class="ev-metric-head">' +
      '<span class="ev-metric-label">' + esc(data.label || 'Ishonch') + '</span></div></div>';
    html += '<div class="ev-conf-grid" role="table" aria-label="' + esc(data.label || 'Ishonch matritsasi') + '">';
    cells.forEach(function (c, i) {
      var shape = SHAPES[i % SHAPES.length];
      html += '<div class="ev-conf-cell" role="row">' +
        '<div class="ev-conf-cell-head"><span class="ev-dist-marker" aria-hidden="true">' + shape + '</span>' + esc(c.label) + '</div>' +
        '<div class="ev-conf-cell-val"><b>' + esc(c.value) + '</b></div>' +
        (c.hint ? '<div class="ev-conf-cell-hint">' + esc(c.hint) + '</div>' : '') +
        '</div>';
    });
    html += '</div>';
    root.innerHTML = html;
    return root;
  }

  /* ── S19.01: Progress line (comparable) ── */
  function progressLine(root, data) {
    if (!root) return null;
    var points = data.points || [];
    var max = data.max || 100;
    var min = data.min || 0;
    var range = Math.max(1, max - min);
    var w = 260, h = 60, pad = 4;
    var step = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
    var coords = points.map(function (p, i) {
      var x = pad + i * step;
      var y = h - pad - ((p.value - min) / range) * (h - pad * 2);
      return { x: x, y: y, p: p };
    });
    var line = coords.map(function (c) { return c.x.toFixed(1) + ',' + c.y.toFixed(1); }).join(' ');

    var html = '<div class="ev-metric"><div class="ev-metric-head">' +
      '<span class="ev-metric-label">' + esc(data.label || '') + '</span>' +
      '<span class="ev-metric-value">' + esc(data.latest != null ? data.latest : '') + '</span></div></div>';
    html += '<div class="ev-line" role="img" aria-label="' + esc(data.ariaLabel || 'Progress') + '">' +
      '<svg viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true">' +
      '<polyline class="ev-line-path" points="' + line + '"/>';
    coords.forEach(function (c, i) {
      html += '<circle class="ev-line-dot" cx="' + c.x.toFixed(1) + '" cy="' + c.y.toFixed(1) + '" r="3" data-shape="' + SHAPES[i % SHAPES.length] + '"/>';
    });
    html += '</svg><div class="ev-line-labels">';
    points.forEach(function (p, i) {
      html += '<span class="ev-line-lbl"><span class="ev-dist-marker" aria-hidden="true">' + SHAPES[i % SHAPES.length] + '</span>' + esc(p.label || '') + '</span>';
    });
    html += '</div></div>';
    // Direct values (S19.07 — tooltip hover-only emas)
    html += '<div class="ev-line-values">';
    points.forEach(function (p) {
      html += '<span class="ev-line-val"><b>' + esc(p.value) + '</b></span>';
    });
    html += '</div>';
    root.innerHTML = html;
    return root;
  }

  /* ── S19.12: CSV export with accessible headers ── */
  function exportCSV(data) {
    var opts = data.options || [];
    var total = data.total || 0;
    var lines = ['Variant,Javablar,Foiz'];
    opts.forEach(function (o) {
      lines.push('"' + (o.label || o.id || '').replace(/"/g, '""') + '",' + (o.count || 0) + ',' + pct(o.count || 0, total) + '%');
    });
    return lines.join('\n');
  }

  function downloadCSV(data, filename) {
    var blob = new Blob([exportCSV(data)], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'evidence.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  global.CastCharts = {
    distributionBar: distributionBar,
    revotePair: revotePair,
    confidenceGrid: confidenceGrid,
    progressLine: progressLine,
    exportCSV: exportCSV,
    downloadCSV: downloadCSV,
    hasEnoughEvidence: hasEnoughEvidence,
    animateWidth: animateWidth,
    SHAPES: SHAPES,
  };
})(typeof window !== 'undefined' ? window : this);
