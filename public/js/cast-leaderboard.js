/* ─────────────────────────────────────────────────────────────────────
   Cast Leaderboard (STYLE S32) — shared renderer
   - Public Top-N (max 5) neutral list; low ranks hidden (server-side)
   - Personal projection participant-private (rank + neighbors)
   - Team leaderboard (individual low performance reveal qilinmaydi)
   - Ties / late join / no-score stable rows
   - Enter stagger max 40ms × 5 (total 200ms); no falling/reorder motion
   - Celebration budget: ordinary 0–2 subtle, session complete max 1
   ───────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const MEDAL_TONES = {
    1: 'lb-medal--gold',
    2: 'lb-medal--silver',
    3: 'lb-medal--bronze',
  };

  // CVD-safe subtle tones — rang + belgi + label (rangga tayanilmaydi)
  const MEDAL_LABEL = { 1: '1', 2: '2', 3: '3' };

  // Server projection'da score faqat scoreDisplay sifatida keladi (privacy-safe).
  // Empty scoreDisplay = exact score ochilmaydi (S32.02) yoki ball yo'q.
  const noScore = (e) => {
    if (!e) return true;
    if (e.scoreDisplay != null) return e.scoreDisplay === '' || e.scoreDisplay == null || e.scoreDisplay === '0';
    return e.score === 0 || e.score == null;
  };
  const safeAlias = (alias) => String(alias || '—').slice(0, 24);

  function rowEl(entry, { index = 0, isSelf = false, rankLabel = null } = {}) {
    const row = document.createElement('li');
    const cls = ['lb-row'];
    if (isSelf) cls.push('lb-row--self');
    if (entry.rank <= 3 && !noScore(entry)) cls.push('lb-row--top');
    row.className = cls.join(' ');
    if (index <= 4) {
      // S32.07: enter stagger max 40ms × 5 → total 200ms
      row.style.setProperty('--lb-stagger', `${index * 40}ms`);
    }

    const rank = document.createElement('span');
    rank.className = 'lb-rank';
    rank.setAttribute('aria-label', `o'rin ${entry.rank}`);
    const rankInner = document.createElement('span');
    rankInner.className = 'lb-rank-num';
    if (entry.rank <= 3 && !noScore(entry)) {
      rankInner.className += ` ${MEDAL_TONES[entry.rank]}`;
      rankInner.textContent = MEDAL_LABEL[entry.rank];
      rankInner.setAttribute('aria-hidden', 'true');
    } else {
      rankInner.textContent = String(entry.rank);
    }
    rank.appendChild(rankInner);

    const name = document.createElement('span');
    name.className = 'lb-name';
    name.textContent = safeAlias(entry.displayAlias);
    if (isSelf) {
      name.setAttribute('aria-label', `${safeAlias(entry.displayAlias)} — siz`);
    }

    const score = document.createElement('span');
    score.className = 'lb-score';
    if (noScore(entry)) {
      score.textContent = '—';
      row.classList.add('lb-row--noshow');
    } else {
      // Server scoreDisplay (privacy-safe — showExactScore=false bo'lsa faqat o'rin)
      score.textContent = entry.scoreDisplay != null && entry.scoreDisplay !== '' ? String(entry.scoreDisplay) : String(entry.score);
    }
    score.setAttribute('aria-label', rankLabel || `${entry.rank}-o'rin: ${entry.scoreDisplay || entry.score || '—'} ball`);

    row.append(rank, name, score);
    return row;
  }

  function emptyRow(message) {
    const row = document.createElement('li');
    row.className = 'lb-row lb-row--empty';
    const span = document.createElement('span');
    span.className = 'lb-empty-msg';
    span.textContent = message;
    row.appendChild(span);
    return row;
  }

  /**
   * Render a list container with rows.
   * @param {HTMLElement} host — mount point (list element expected)
   * @param {Array} rows — projection entries [{rank, displayAlias, score}]
   * @param {object} opts — { selfParticipantId, emptyMessage }
   */
  function renderRows(host, rows = [], opts = {}) {
    if (!host) return;
    host.textContent = '';
    const list = host.tagName === 'OL' || host.tagName === 'UL' ? host : document.createElement('ol');
    if (list !== host) {
      list.className = 'lb-list';
      host.appendChild(list);
      host = list;
    }
    if (!rows || !rows.length) {
      host.appendChild(emptyRow(opts.emptyMessage || 'Reyting hali yo‘q'));
      return;
    }
    rows.forEach((entry, i) => {
      const isSelf = opts.selfParticipantId && entry.participantId === opts.selfParticipantId;
      host.appendChild(rowEl(entry, { index: i, isSelf }));
    });
  }

  /**
   * Personal projection panel — personal best + progress over peer comparison (S32.05).
   */
  function renderPersonal(host, personal, opts = {}) {
    if (!host) return;
    host.textContent = '';
    if (!personal) {
      const p = document.createElement('p');
      p.className = 'lb-personal-empty';
      p.textContent = opts.emptyMessage || 'Hozircha ball yo‘q — keyingi savolda qatnashing';
      host.appendChild(p);
      return;
    }
    const box = document.createElement('div');
    box.className = 'lb-personal';

    const rankLine = document.createElement('p');
    rankLine.className = 'lb-personal-rank';
    rankLine.textContent = `${personal.rank}-o‘rin`;
    rankLine.setAttribute('aria-label', `Sizning o‘rningiz: ${personal.rank}`);

    const peers = document.createElement('ol');
    peers.className = 'lb-list lb-list--compact';
    personal.neighbors.forEach((n, i) => {
      peers.appendChild(rowEl(n, { index: i, isSelf: n.participantId === personal.participantId }));
    });
    box.append(rankLine, peers);
    host.appendChild(box);
  }

  /**
   * Team leaderboard — jamoa names + score; individual low performance yo'q (S32.06).
   */
  function renderTeam(host, entries = [], opts = {}) {
    if (!host) return;
    host.textContent = '';
    if (!entries.length) {
      host.appendChild(emptyRow(opts.emptyMessage || 'Jamoalar hali shakllanmagan'));
      return;
    }
    entries.forEach((entry, i) => {
      const li = document.createElement('li');
      li.className = 'lb-row lb-row--team';
      if (i <= 4) li.style.setProperty('--lb-stagger', `${i * 40}ms`);
      const rank = document.createElement('span');
      rank.className = 'lb-rank-num';
      rank.textContent = String(entry.rank);
      const name = document.createElement('span');
      name.className = 'lb-name';
      name.textContent = safeAlias(entry.name);
      const score = document.createElement('span');
      score.className = 'lb-score';
      score.textContent = String(entry.score);
      li.append(rank, name, score);
      host.appendChild(li);
    });
  }

  /**
   * Celebration budget (S32.09/S32.10): 500–800ms one-shot, reduced-motion aware.
   * @param {HTMLElement} host
   * @param {number} budget — 0 (none), 1 (session complete), 2 (ordinary success)
   */
  function celebrate(host, { budget = 0, tone = 'subtle' } = {}) {
    if (!host || budget <= 0) return;
    const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return; // S32.10: static equivalent — host already shows content
    const el = document.createElement('div');
    el.className = `lb-celebration lb-celebration--${tone}`;
    el.setAttribute('role', 'status');
    el.textContent = tone === 'complete' ? '🎉 Ajoyib! Dars yakunlandi' : '👏 Barakalla!';
    host.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
    // Safety net — animation biron sababga ishlamasa 900ms'dan keyin tozalanadi
    setTimeout(() => el.remove(), 900);
  }

  window.CastLeaderboard = {
    renderRows,
    renderPersonal,
    renderTeam,
    celebrate,
  };
})();
