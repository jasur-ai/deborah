/**
 * Edikit — Cast Projector Client
 * --------------------------------
 * Public screen — private data olmaydi. Read-only.
 */

(function () {
  'use strict';

  const BOOT = window.__BOOT__;
  if (!BOOT || !BOOT.sessionId) return;

  const socket = io(BOOT.socketPath || '/socket.io', { withCredentials: true, transports: ['websocket', 'polling'] });
  const $ = (id) => document.getElementById(id);
  let closesAt = null;
  let timerInterval = null;
  let a11y = null;

  // C4-04: accessibility bootstrap (projector — muted audio uchun visual text item 12)
  if (window.CastA11yInit) {
    a11y = window.CastA11yInit({ role: 'projector' });
  }

  // C4-05: i18n
  let t = (k, v) => k;
  if (window.CastI18n) {
    window.CastI18n.init({ locale: BOOT.locale || 'uz-Latn' }).then((api) => { t = api.t; });
  }

  const client = new CastSocketClient({
    socket,
    sessionId: BOOT.sessionId,
    initialRevision: BOOT.initialRevision || 1,
    onEvent: (eventName, data) => handleEvent(eventName, data),
    onError: (data) => { /* projector silent on error */ },
  });

  function startTimer() {
    stopTimer();
    // C4-04 (item 6/7): threshold announcement (30/10/5/0)
    if (a11y && a11y.watchTimer) {
      a11y.watchTimer({
        getRemaining: () => (closesAt ? Math.max(0, Math.round((closesAt - Date.now()) / 1000)) : null),
        announce: (msg) => {
          const el = document.getElementById('status-live');
          if (el) el.textContent = msg;
        },
      });
    }
    timerInterval = setInterval(() => {
      const num = $('proj-timer-num');
      const label = $('proj-timer-label');
      const wrap = $('proj-timer');
      if (!closesAt) { num.textContent = '—'; label.textContent = ''; return; }
      const remaining = Math.max(0, Math.round((closesAt - Date.now()) / 1000));
      // S30.06: number + label + ring — flashing yo'q, critical'da label ham
      num.textContent = remaining + 's';
      label.textContent = remaining <= 10 ? 'vaqt tugayapti' : 'qoldi';
      wrap.classList.toggle('is-critical', remaining <= 10);
      wrap.classList.toggle('urgent', remaining <= 10);
    }, 1000);
  }
  function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    if (a11y && a11y.stopTimerWatcher) a11y.stopTimerWatcher();
    const wrap = $('proj-timer');
    if (wrap) { wrap.classList.remove('is-critical', 'urgent'); }
  }

  let currentJoinCode = null;

  // S30.02: QR kod — server-side SVG endpoint (identity yo'q, faqat join link)
  function renderQR(code) {
    const img = $('proj-qr');
    if (!img) return;
    if (!code) { img.hidden = true; return; }
    const url = `https://${location.host}/play?code=${code}`;
    img.onerror = () => { img.hidden = true; };
    img.src = '/cast/qr?d=' + encodeURIComponent(url);
    img.hidden = false;
  }

  // S30.03: kod minimize chip — click'da yana katta lobby ko'rinadi
  function showCodeChip(code) {
    const chip = $('proj-code-chip');
    const val = $('proj-code-chip-val');
    if (!chip) return;
    if (!code) { chip.hidden = true; return; }
    val.textContent = code;
    chip.hidden = false;
  }

  function renderLobby(data) {
    $('proj-lobby').hidden = false;
    $('proj-question').hidden = true;
    $('proj-reveal').hidden = true;
    $('proj-code-chip').hidden = true;
    if (data.joinCode) {
      currentJoinCode = data.joinCode;
      $('proj-code').textContent = data.joinCode;
      $('proj-link').textContent = `https://${location.host}/play?code=${data.joinCode}`;
      renderQR(data.joinCode);
    }
  }

  // S30.04/10: font floor — uzun savol matnida o'lcham kichrayadi (ellipsis yo'q)
  // Eslatma: qisqa savolda inline style tozalanadi (keyingi savolda eski kichraygan o'lcham qolmaydi)
  function applyFontFloor(el, floorPx) {
    if (!el) return;
    const len = el.textContent.length;
    el.style.fontSize = ''; // oldingi inline o'lchamni reset — CSS clamp asosiga qaytadi
    if (len <= 140) return;
    let size = parseFloat(getComputedStyle(el).fontSize) || floorPx;
    if (len > 240) size = Math.max(floorPx, size - 12);
    else size = Math.max(floorPx, size - 6);
    el.style.fontSize = size + 'px';
  }

  // S30.05: option — shape + letter + text (rangga bog'liq emas)
  const OPT_SHAPES = ['▲', '●', '◆', '★', '✦'];
  const OPT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
  function renderOptionRow(o, i, isCorrect) {
    const row = document.createElement('div');
    row.className = 'proj-option' + (isCorrect ? ' correct' : '');
    row.innerHTML =
      `<span class="opt-letter opt-sym-${(i % 5) + 1}" aria-hidden="true">${OPT_LETTERS[i % 6]}</span>` +
      `<span class="symbol opt-sym-${(i % 5) + 1}" aria-hidden="true">${OPT_SHAPES[i % 5]}</span>` +
      `<span>${escapeHtml(o.text)}</span>`;
    return row;
  }

  function renderQuestion(q, phase) {
    $('proj-lobby').hidden = true;
    $('proj-question').hidden = false;
    $('proj-reveal').hidden = true;
    $('proj-q-text').textContent = q.text;
    applyFontFloor($('proj-q-text'), 26);
    const wrap = $('proj-options');
    wrap.innerHTML = '';
    q.options.forEach((o, i) => { wrap.appendChild(renderOptionRow(o, i, false)); });
    if (q.closesAt) { closesAt = q.closesAt; startTimer(); }
    else { stopTimer(); $('proj-timer-num').textContent = '—'; $('proj-timer-label').textContent = ''; }
    // S30.03: savol davrida kod kichik chip sifatida
    if (currentJoinCode) showCodeChip(currentJoinCode);
  }

  // S30.07: public distribution — max 5 bar (shape + count + percent), static
  function renderDistribution(dist, total) {
    const box = $('proj-dist');
    const bars = $('proj-dist-bars');
    if (!box || !bars) return;
    if (!Array.isArray(dist) || dist.length === 0) { box.hidden = true; return; }
    const top = dist.slice(0, 5);
    const max = Math.max(1, ...top.map((d) => d.count || 0));
    bars.innerHTML = '';
    const lastQ = window.__lastQuestion;
    const correct = new Set((window.__lastCorrectIds || []));
    top.forEach((d, i) => {
      const row = document.createElement('div');
      row.className = 'proj-dist-row';
      const isCorrect = correct.has(d.optionId);
      const pct = Math.round(((d.count || 0) / (total || max || 1)) * 100);
      const optionIdx = (lastQ?.options || []).findIndex((o) => o.id === d.optionId);
      const letter = optionIdx >= 0 ? OPT_LETTERS[optionIdx % 6] : String(i + 1);
      const shape = OPT_SHAPES[i % 5];
      row.innerHTML =
        `<span class="proj-dist-symbol opt-sym-${(i % 5) + 1}" aria-hidden="true">${letter}</span>` +
        `<div class="proj-dist-track"><div class="proj-dist-bar${isCorrect ? ' is-correct' : ''}" style="width:${Math.round(((d.count || 0) / max) * 100)}%"></div></div>` +
        `<span class="proj-dist-num">${d.count} · ${pct}%${isCorrect ? ' ✓' : ''}</span>`;
      bars.appendChild(row);
    });
    box.hidden = false;
  }

  function renderReveal(data) {
    $('proj-lobby').hidden = true;
    $('proj-question').hidden = true;
    $('proj-reveal').hidden = false;
    $('proj-code-chip').hidden = true;
    stopTimer();
    const correct = new Set(data.correctOptionIds || []);
    window.__lastCorrectIds = data.correctOptionIds || [];
    $('proj-reveal-text').textContent = $('proj-q-text').textContent || 'Javoblar';
    const wrap = $('proj-reveal-options');
    wrap.innerHTML = '';
    const lastQ = window.__lastQuestion;
    (lastQ?.options || []).forEach((o, i) => {
      const row = renderOptionRow(o, i, correct.has(o.id));
      const span = row.querySelector('span:last-child');
      if (correct.has(o.id)) span.textContent = o.text + ' ✓';
      wrap.appendChild(row);
    });
    // S30.07: teacher reveal'dan keyin public distribution
    renderDistribution(data.distribution, data.distributionTotal);
    if (data.explanation) {
      $('proj-explanation').hidden = false;
      $('proj-explanation').textContent = '💡 ' + data.explanation;
    } else {
      $('proj-explanation').hidden = true;
    }
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function handleEvent(eventName, data) {
    switch (eventName) {
      case 'cast:participantJoined': {
        const c = $('proj-count');
        if (data.count !== undefined) c.textContent = t('proj.count', { n: data.count });
        break;
      }
      case 'cast:questionPreview':
        if (data.thinkSeconds) { $('proj-q-meta').textContent = `Fikrlash vaqti: ${data.thinkSeconds}s`; }
        break;
      case 'cast:questionOpened':
        $('proj-q-meta').textContent = `Savol ${(data.question?.position ?? '')}`;
        if (data.question) {
          window.__lastQuestion = data.question;
          renderQuestion(data.question, 'QUESTION_OPEN');
        }
        break;
      case 'cast:questionPaused':
        stopTimer();
        $('proj-timer-num').textContent = '⏸';
        $('proj-timer-label').textContent = 'pauza';
        break;
      case 'cast:questionResumed':
        closesAt = data.payload?.closesAt;
        startTimer();
        break;
      case 'cast:timeAdded':
        closesAt = data.payload?.closesAt;
        startTimer();
        break;
      case 'cast:questionClosed':
      case 'cast:questionLocked':
        stopTimer();
        $('proj-timer-num').textContent = '—';
        $('proj-timer-label').textContent = '';
        break;
      case 'cast:questionRevealed':
        renderReveal(data);
        break;
      case 'cast:answerCount':
        if (data.total) $('proj-answered').textContent = t('proj.answered', { a: data.answered, t: data.total });
        break;
      case 'cast:goalProgress': {
        // Aggregate only — individual ayb/rank ko'rsatilmaydi
        const goal = $('proj-goal');
        if (!goal || !data.progress) break;
        if (!data.progress.type) { goal.hidden = true; break; }
        goal.hidden = false;
        $('proj-goal-fill').style.width = Math.min(100, data.progress.percent) + '%';
        const unitLabels = { accuracy_threshold: '% aniqlik', knowledge_points: ' ball', misconceptions_resolved: ' ta hal', mastery_rounds: ' ta raund' };
        $('proj-goal-meta').textContent =
          `${data.progress.current}${unitLabels[data.progress.type] || ''} / ${data.progress.target}`;
        break;
      }
      case 'cast:goalComplete': {
        const el = $('proj-goal-complete');
        if (el) {
          el.hidden = false;
          // Reduced-motion celebration (CSS animation handles it)
          el.classList.remove('celebrate');
          void el.offsetWidth; // restart animation
          el.classList.add('celebrate');
        }
        break;
      }
      case 'cast:confusionAggregate': {
        // C3-10: anonim aggregate — identity yo'q
        const wrap = $('proj-confusion');
        const chips = $('proj-confusion-chips');
        if (!wrap || !chips) break;
        const counts = data.counts || {};
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        if (total === 0) { wrap.hidden = true; break; }
        wrap.hidden = false;
        chips.innerHTML = '';
        const labels = { confused: '🤔', too_fast: '⚡', technical_issue: '🔧', need_example: '💡' };
        Object.entries(counts).forEach(([sig, count]) => {
          if (!count) return;
          const chip = document.createElement('span');
          chip.className = 'proj-confusion-chip';
          chip.textContent = `${labels[sig] || sig} ${count}`;
          chips.appendChild(chip);
        });
        break;
      }
      case 'cast:wallPublic': {
        // C3-10: faqat tasdiqlangan matnlar, identity yo'q
        const wrap = $('proj-wall');
        const list = $('proj-wall-list');
        if (!wrap || !list) break;
        const items = data.items || [];
        if (items.length === 0) { wrap.hidden = true; break; }
        wrap.hidden = false;
        list.innerHTML = '';
        items.slice(0, 6).forEach((item) => {
          const row = document.createElement('div');
          row.className = 'proj-wall-item';
          row.textContent = item.text;
          list.appendChild(row);
        });
        break;
      }
      case 'cast:leaderboardUpdated': {
        // STYLE S32: public Top-N — neutral list, max 5 (server allaqachon clamps)
        if (data.mode !== 'public_top_n') break;
        const wrap = $('proj-leaderboard');
        const list = $('proj-leaderboard-list');
        if (!wrap || !list) break;
        const entries = (data.topN && data.topN.entries) || [];
        wrap.hidden = false;
        window.CastLeaderboard.renderRows(list, entries, {
          emptyMessage: 'Reyting hali yo‘q',
        });
        if (data.topN && data.topN.hiddenCount > 0) {
          // S32.02: pastki o'rinlar yashirin — o'rniga yumshoq izoh
          const note = document.createElement('li');
          note.className = 'lb-row lb-row--empty';
          const span = document.createElement('span');
          span.className = 'lb-empty-msg';
          span.textContent = `Yana ${data.topN.hiddenCount} ishtirokchi bor`;
          note.appendChild(span);
          list.appendChild(note);
        }
        break;
      }
      case 'cast:poeObservationStarted': {
        // C3-11: kuzatuv media — xavfsiz (URL/text, identity yo'q)
        const card = $('proj-poe-media-card');
        const wrap = $('proj-poe-media');
        if (!card || !wrap) break;
        card.hidden = false;
        wrap.innerHTML = '';
        const media = data.media;
        if (media && (media.type === 'image' || media.type === 'animation' || media.type === 'video')) {
          const el = document.createElement(media.type === 'video' ? 'video' : 'img');
          el.src = media.url;
          if (media.type === 'video') { el.controls = true; el.muted = true; el.playsInline = true; el.autoplay = true; }
          el.className = 'proj-poe-img';
          wrap.appendChild(el);
        } else if (media) {
          const box = document.createElement('div');
          box.className = 'proj-poe-text';
          box.textContent = media.text || '';
          wrap.appendChild(box);
        }
        if (media && media.caption) {
          const cap = document.createElement('div');
          cap.className = 'proj-poe-caption';
          cap.textContent = media.caption;
          wrap.appendChild(cap);
        }
        break;
      }
      case 'cast:poeExplanationOpened': {
        // Kuzatuv kartasini yopamiz
        const card = $('proj-poe-media-card');
        if (card) card.hidden = true;
        break;
      }
      case 'cast:poeAnalysisPublic': {
        // C3-11: aggregate (identity yo'q) + approved exemplars
        const card = $('proj-poe-analysis-card');
        const agg = $('proj-poe-agg');
        if (!card || !agg) break;
        card.hidden = false;
        agg.innerHTML = '';
        const pattern = data.aggregatePattern || {};
        const line = document.createElement('div');
        line.className = 'proj-poe-agg-line';
        line.textContent = `Ishtirokchilar: ${pattern.participants || 0} — bashoratdan o‘zgargan: ${pattern.changed || 0} (${pattern.changeRate || 0}%)`;
        agg.appendChild(line);
        (pattern.topTransitions || []).slice(0, 3).forEach((t) => {
          const row = document.createElement('div');
          row.className = 'proj-poe-agg-row';
          row.textContent = `${t.transition} — ${t.count}`;
          agg.appendChild(row);
        });
        const exWrap = $('proj-poe-exemplars');
        if (exWrap) {
          exWrap.innerHTML = '';
          (data.exemplars || []).slice(0, 3).forEach((ex) => {
            const row = document.createElement('div');
            row.className = 'proj-poe-exemplar';
            row.textContent = '💡 ' + ex.text;
            exWrap.appendChild(row);
          });
        }
        break;
      }
      // C3-12 Open-Response Semantic Board
      case 'cast:orbOpened': {
        // Yig'ilmoqda — board teacher confirmationisiz ko'rinmaydi
        const orb = $('proj-orb');
        if (!orb) break;
        orb.hidden = false;
        const st = $('proj-orb-status');
        const grid = $('proj-orb-grid');
        if (st) st.textContent = '⏳ Javoblar yig‘ilmoqda…';
        if (grid) grid.innerHTML = '';
        break;
      }
      case 'cast:orbClosed': {
        const st = $('proj-orb-status');
        if (st) st.textContent = '🧮 O‘qituvchi guruhlashmoqda…';
        break;
      }
      case 'cast:orbProjector': {
        // FAQAT teacherConfirmed cluster'lar — identity yo'q (item 12-13)
        const orb = $('proj-orb');
        const grid = $('proj-orb-grid');
        if (!orb || !grid) break;
        const board = data.board || {};
        const clusters = board.clusters || [];
        if (!clusters.length) { orb.hidden = true; break; }
        orb.hidden = false;
        const st = $('proj-orb-status');
        if (st) st.textContent = `✅ ${board.confirmedClusters || 0} guruh tasdiqlangan`;
        grid.innerHTML = '';
        clusters.forEach((c) => {
          const card = document.createElement('div');
          card.className = 'proj-orb-cluster';
          const head = document.createElement('div');
          head.className = 'proj-orb-cluster-head';
          const label = document.createElement('span');
          label.className = 'proj-orb-cluster-label';
          label.textContent = c.label || '(labelsiz)';
          const count = document.createElement('span');
          count.className = 'proj-orb-cluster-count';
          count.textContent = c.count || 0;
          head.append(label, count);
          card.appendChild(head);
          if (c.exemplar) {
            const ex = document.createElement('div');
            ex.className = 'proj-orb-exemplar';
            ex.textContent = `“${c.exemplar}”`;
            card.appendChild(ex);
          }
          grid.appendChild(card);
        });
        break;
      }
      case 'cast:orbEnded': {
        const orb = $('proj-orb');
        if (orb) orb.hidden = true;
        break;
      }
      case 'cast:sessionEnded':
        stopTimer();
        $('proj-question').hidden = true;
        $('proj-reveal').hidden = true;
        $('proj-lobby').hidden = false;
        $('proj-count').textContent = t('session.ended') !== 'session.ended' ? t('session.ended') : 'Sessiya tugadi';
        // STYLE S32.09: session complete — max 1 expressive celebration (reduced-motion skip)
        if (window.CastLeaderboard && $('proj-leaderboard')) {
          $('proj-leaderboard').hidden = false;
          window.CastLeaderboard.celebrate(document.body, { budget: 1, tone: 'complete' });
        }
        break;
    }
  }

  // S30.03: kod chip click — katta lobbi qayta ko'rinadi (teacher ham qayta ochishi mumkin)
  const codeChip = $('proj-code-chip');
  if (codeChip) {
    codeChip.addEventListener('click', () => {
      // Boshqa ekranlarni yopamiz — faqat lobby ko'rinadi (question/reveal ustiga chiqmaydi)
      $('proj-question').hidden = true;
      $('proj-reveal').hidden = true;
      $('proj-lobby').hidden = false;
      if (currentJoinCode) { $('proj-code').textContent = currentJoinCode; renderQR(currentJoinCode); }
    });
  }

  socket.on('connect', () => {
    client.sendCommand('cast:getSnapshot', {}).then((res) => {
      if (res.state && res.state.phase !== 'LOBBY_OPEN' && res.question) {
        renderQuestion(res.question, res.state.phase);
      }
    }).catch(() => {});
  });

  window.__lastQuestion = null;
})();
