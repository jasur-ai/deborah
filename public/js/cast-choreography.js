/**
 * Edikit — Cast Session Choreography UI (C3-14)
 * ---------------------------------------------
 * Composer: block add/reorder/duplicate/edit/delete + keyboard move up/down.
 * Dashboard: current/next block, elapsed/remaining, coverage, health.
 * Server authoritative validation — save'da TEMPLATE_INVALID xatolari ko'rsatiladi.
 */
(function () {
  'use strict';

  const BLOCK_LABELS = {
    LOBBY: 'Lobbi', INSTRUCTIONS: 'Ko‘rsatma', THINK: 'O‘ylash', QUESTION: 'Savol',
    CONFIDENCE: 'Ishonch', REVEAL: 'Natija', DISCUSS: 'Muhokama', REVOTE: 'Qayta ovoz',
    EXPLANATION: 'Tushuntirish', LEADERBOARD: 'Reyting', CLASS_GOAL: 'Sinf maqsadi',
    BREAK: 'Tanaffus', QUICK_PROMPT: 'Tezkor savol', REDEMPTION: 'Redemption', EXIT_TICKET: 'Chiqish bileti',
  };
  const BASE_SECONDS = {
    LOBBY: 20, INSTRUCTIONS: 15, THINK: 5, QUESTION: 30, CONFIDENCE: 5, REVEAL: 20,
    DISCUSS: 60, REVOTE: 30, EXPLANATION: 90, LEADERBOARD: 15, CLASS_GOAL: 30,
    BREAK: 60, QUICK_PROMPT: 30, REDEMPTION: 45, EXIT_TICKET: 60,
  };
  const DEFAULT_CONFIG = {
    LOBBY: {}, INSTRUCTIONS: { title: '', text: '', seconds: 0 }, THINK: { seconds: 5 },
    QUESTION: { questionId: null, scorable: true, seconds: 30 }, CONFIDENCE: {},
    REVEAL: { showCorrect: true }, DISCUSS: { seconds: 60 }, REVOTE: {},
    EXPLANATION: { mode: 'auto' }, LEADERBOARD: { visible: true }, CLASS_GOAL: {},
    BREAK: { seconds: 60 }, QUICK_PROMPT: { promptText: '', seconds: 30 },
    REDEMPTION: {}, EXIT_TICKET: { promptText: '' },
  };
  const QUESTION_DEP = new Set(['CONFIDENCE', 'REVEAL', 'REVOTE', 'EXPLANATION', 'REDEMPTION']);

  let ctx = null; // { $, send, announce, BOOT }
  let template = null;
  let templates = [];
  let dash = null;
  let tick = null;

  function $(id) { return document.getElementById(id); }

  function setContext(c) { ctx = c; }

  function blockDuration(b) {
    const s = Number(b.config?.seconds || 0);
    return s > 0 ? s : (BASE_SECONDS[b.type] || 15);
  }

  function clientValidate(t) {
    const errors = [];
    const blocks = t.blocks || [];
    if (blocks.length === 0) { errors.push('Kamida 1 blok qo‘shing'); }
    blocks.forEach((b, i) => {
      if (QUESTION_DEP.has(b.type)) {
        const before = blocks.slice(0, i);
        if (!before.some((x) => x.type === 'QUESTION')) {
          errors.push(`${b.id} (${BLOCK_LABELS[b.type]}) oldidan QUESTION blok kerak`);
        }
        if (b.type === 'REVEAL') {
          const lastQ = [...before].reverse().find((x) => x.type === 'QUESTION');
          if (lastQ && lastQ.config?.scorable === false) errors.push(`REVEAL oldidan "${lastQ.id}" scorable emas`);
        }
      }
    });
    if (t.mode === 'fully_auto') {
      blocks.forEach((b) => {
        if (b.type === 'LOBBY') return;
        const hasTimer = Number(b.config?.seconds || 0) > 0;
        if (!hasTimer && ['INSTRUCTIONS', 'CLASS_GOAL', 'BREAK', 'REDEMPTION'].includes(b.type)) {
          errors.push(`Fully-auto: "${b.id}" uchun timer (seconds) kerak`);
        }
      });
    }
    return errors;
  }

  function renderTemplateSelect() {
    const sel = $('chor-template-select');
    if (!sel || !ctx) return;
    sel.innerHTML = '';
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '— Yangi template —';
    sel.appendChild(opt);
    (templates || []).forEach((t) => {
      const o = document.createElement('option');
      o.value = t.templateId;
      o.textContent = `${t.name} (v${t.version} · ${t.blockCount} blok)`;
      sel.appendChild(o);
    });
    sel.value = template?.templateId || '';
  }

  function renderBlocks() {
    const wrap = $('chor-blocks');
    if (!wrap) return;
    wrap.innerHTML = '';
    (template?.blocks || []).forEach((b, idx) => {
      const row = document.createElement('div');
      row.className = 'chor-block' + (idx === 0 ? ' chor-block-first' : '');
      row.dataset.blockId = b.id;

      const head = document.createElement('div');
      head.className = 'chor-block-head';
      const num = document.createElement('span');
      num.className = 'chor-block-num';
      num.textContent = String(idx + 1).padStart(2, '0');
      head.appendChild(num);
      const label = document.createElement('span');
      label.className = 'chor-block-label';
      label.textContent = BLOCK_LABELS[b.type] || b.type;
      head.appendChild(label);
      const cfg = document.createElement('span');
      cfg.className = 'chor-block-cfg';
      cfg.textContent = configSummary(b);
      head.appendChild(cfg);

      const actions = document.createElement('div');
      actions.className = 'chor-block-actions';
      const mk = (txt, title, fn) => {
        const bt = document.createElement('button');
        bt.className = 'cast-btn cast-btn-sm';
        bt.textContent = txt;
        bt.title = title || '';
        bt.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
        actions.appendChild(bt);
      };
      mk('↑', 'Yuqoriga (Alt+↑)', () => move('up', b.id));
      mk('↓', 'Pastga (Alt+↓)', () => move('down', b.id));
      mk('⧉', 'Nusxalash', () => duplicate(b.id));
      mk('✎', 'Tahrirlash', () => edit(b.id));
      mk('🗑', 'O‘chirish', () => remove(b.id));
      head.appendChild(actions);
      row.appendChild(head);

      // Edit form (inline)
      const form = document.createElement('div');
      form.className = 'chor-block-edit';
      form.hidden = true;
      row.appendChild(form);
      row.addEventListener('click', () => {
        form.hidden = !form.hidden;
        if (!form.hidden) renderEditForm(b, form, idx);
      });
      wrap.appendChild(row);
    });
  }

  function configSummary(b) {
    const c = b.config || {};
    const parts = [];
    if (c.seconds) parts.push(c.seconds + 's');
    if (c.promptText) parts.push('“' + c.promptText.slice(0, 24) + (c.promptText.length > 24 ? '…' : '') + '”');
    if (c.title) parts.push(c.title);
    if (b.type === 'QUESTION' && c.questionId) parts.push(c.questionId);
    if (b.type === 'QUESTION' && c.scorable === false) parts.push('scorable:no');
    if (b.type === 'EXPLANATION' && c.mode !== 'auto') parts.push(c.mode);
    return parts.join(' · ');
  }

  function renderEditForm(b, form, idx) {
    form.innerHTML = '';
    const c = { ...(b.config || {}) };
    const fields = [];
    if ('seconds' in DEFAULT_CONFIG[b.type] || ['THINK', 'QUESTION', 'DISCUSS', 'BREAK', 'INSTRUCTIONS', 'QUICK_PROMPT'].includes(b.type)) {
      fields.push({ key: 'seconds', label: 'Vaqt (s)', type: 'number' });
    }
    if (b.type === 'INSTRUCTIONS') {
      fields.push({ key: 'title', label: 'Sarlavha', type: 'text' }, { key: 'text', label: 'Matn', type: 'text' });
    }
    if (b.type === 'QUESTION') {
      fields.push({ key: 'questionId', label: 'Savol ID (ixtiyoriy)', type: 'text' });
    }
    if (b.type === 'QUICK_PROMPT') {
      fields.push({ key: 'promptText', label: 'Savol matni', type: 'text' });
    }
    if (b.type === 'EXIT_TICKET') {
      fields.push({ key: 'promptText', label: 'Savol matni', type: 'text' });
    }
    fields.forEach((f) => {
      const lab = document.createElement('label');
      lab.className = 'chor-edit-field';
      const span = document.createElement('span');
      span.textContent = f.label;
      const inp = document.createElement('input');
      inp.className = 'cast-input';
      inp.type = f.type;
      inp.value = c[f.key] ?? '';
      inp.addEventListener('input', () => {
        c[f.key] = f.type === 'number' ? Number(inp.value) : inp.value;
      });
      lab.appendChild(span);
      lab.appendChild(inp);
      form.appendChild(lab);
    });
    if (b.type === 'QUESTION') {
      const lab = document.createElement('label');
      lab.className = 'chor-edit-field';
      const span = document.createElement('span');
      span.textContent = 'Scorable';
      const inp = document.createElement('input');
      inp.type = 'checkbox';
      inp.checked = c.scorable !== false;
      inp.addEventListener('change', () => { c.scorable = inp.checked; });
      lab.appendChild(span);
      lab.appendChild(inp);
      form.appendChild(lab);
    }
    const save = document.createElement('button');
    save.className = 'cast-btn cast-btn-sm cast-btn-primary';
    save.textContent = 'Saqlash';
    save.addEventListener('click', () => {
      applyEdit(b.id, c);
      form.hidden = true;
    });
    form.appendChild(save);
  }

  function applyEdit(blockId, config) {
    if (!template) return;
    template.blocks = template.blocks.map((b) => (b.id === blockId ? { ...b, config } : b));
    renderAll();
  }

  function move(dir, blockId) {
    if (!template) return;
    const idx = template.blocks.findIndex((b) => b.id === blockId);
    const target = dir === 'up' ? idx - 1 : idx + 1;
    if (target < 0 || target >= template.blocks.length) return;
    const blocks = [...template.blocks];
    const [m] = blocks.splice(idx, 1);
    blocks.splice(target, 0, m);
    template.blocks = blocks;
    renderAll();
  }

  function duplicate(blockId) {
    if (!template) return;
    const idx = template.blocks.findIndex((b) => b.id === blockId);
    const src = template.blocks[idx];
    const copy = { ...src, id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), config: JSON.parse(JSON.stringify(src.config)) };
    const blocks = [...template.blocks];
    blocks.splice(idx + 1, 0, copy);
    template.blocks = blocks;
    renderAll();
  }

  function remove(blockId) {
    if (!template) return;
    template.blocks = template.blocks.filter((b) => b.id !== blockId);
    renderAll();
  }

  function renderValidation() {
    const el = $('chor-validation');
    const dur = $('chor-duration');
    if (!el) return;
    if (!template) { el.textContent = ''; if (dur) dur.textContent = ''; return; }
    const errors = clientValidate(template);
    const total = (template.blocks || []).reduce((sum, b) => sum + blockDuration(b), 0);
    el.textContent = errors.length ? '⚠ ' + errors.join('; ') : '✅ Reja to‘g‘ri';
    el.className = 'orb-status ' + (errors.length ? 'chor-err' : 'chor-ok');
    if (dur) dur.textContent = `⏱ Taxminiy davomiylik: ${Math.round(total / 60 * 10) / 10} daqiqa (${total}s)`;
  }

  function renderAll() {
    renderBlocks();
    renderValidation();
  }

  function addBlock(type) {
    if (!template) return;
    const id = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    template.blocks = [...(template.blocks || []), { id, type, config: JSON.parse(JSON.stringify(DEFAULT_CONFIG[type] || {})) }];
    renderAll();
  }

  async function save() {
    if (!ctx || !template) return;
    const errors = clientValidate(template);
    if (errors.length) { ctx.announce('⚠ ' + errors.join('; '), true); return; }
    try {
      const ack = await ctx.send('cast:choreoSave', { template });
      if (ack.ok) {
        template.templateId = ack.templateId;
        template.version = ack.version;
        ctx.announce('💾 Template saqlandi (v' + ack.version + ')', false);
        refreshList();
      } else {
        ctx.announce(ack.error?.message || 'Saqlab bo‘lmadi', true);
      }
    } catch (e) {
      ctx.announce(e.message || 'Xatolik', true);
    }
  }

  async function refreshList() {
    if (!ctx) return;
    try {
      const ack = await ctx.send('cast:choreoList', {});
      if (ack.ok) { templates = ack.templates || []; renderTemplateSelect(); }
    } catch (_) { /* non-critical */ }
  }

  async function loadTemplate(templateId) {
    if (!ctx) return;
    if (!templateId) {
      template = { templateId: null, version: 1, name: '', mode: 'guided', blocks: [], ownerActorId: ctx.BOOT.actor.id };
      $('chor-name').value = '';
      $('chor-mode').value = 'guided';
      renderAll();
      return;
    }
    try {
      const ack = await ctx.send('cast:choreoLoad', { templateId });
      if (ack.ok && ack.template) {
        template = ack.template;
        $('chor-name').value = template.name || '';
        $('chor-mode').value = template.mode || 'guided';
        renderAll();
      } else {
        ctx.announce(ack.error?.message || 'Yuklab bo‘lmadi', true);
      }
    } catch (e) {
      ctx.announce(e.message || 'Xatolik', true);
    }
  }

  function preview() {
    if (!ctx || !template) return;
    const errors = clientValidate(template);
    const lines = (template.blocks || []).map((b, i) => `${i + 1}. ${BLOCK_LABELS[b.type]} — ${blockDuration(b)}s`).join('\n');
    const total = (template.blocks || []).reduce((s, b) => s + blockDuration(b), 0);
    ctx.announce((errors.length ? '⚠ ' + errors.join('; ') + '\n' : '') + lines + `\nJami: ${total}s`, false);
  }

  // ── Dashboard (item 13) ──
  function renderDashboard(d) {
    // Server payload'da _at yo'q — birinchi tick delta'ni noto'g'ri hisoblamasligi uchun
    if (d && !d._at) d = { ...d, _at: Date.now() };
    dash = d;
    const el = $('chor-dash');
    if (!el || !d) return;
    el.hidden = false;
    $('chor-current').textContent = d.current ? `${BLOCK_LABELS[d.current.type] || d.current.type} (${d.current.id})` : '—';
    $('chor-next').textContent = d.next ? `${BLOCK_LABELS[d.next.type] || d.next.type} (${d.next.id})` : (d.finished ? '✅ Tugadi' : '—');
    $('chor-elapsed').textContent = fmtMs(d.elapsedMs);
    $('chor-remaining').textContent = d.remainingMs === null ? '—' : fmtMs(d.remainingMs);
    $('chor-coverage').textContent = Math.round((d.coverage || 0) * 100) + '%';
    $('chor-health').textContent = d.health?.ok ? '✅ OK' : ('⚠ ' + (d.health?.issues || []).join('; '));
    $('chor-health').className = 'chor-cell-val ' + (d.health?.ok ? 'chor-ok' : 'chor-err');
  }

  function fmtMs(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '—';
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  function startTick() {
    if (tick) clearInterval(tick);
    tick = setInterval(() => {
      if (dash && ctx) {
        const extra = Date.now() - (dash._at || Date.now());
        renderDashboard({ ...dash, elapsedMs: (dash.elapsedMs || 0) + extra, remainingMs: dash.remainingMs === null ? null : Math.max(0, dash.remainingMs - extra), _at: Date.now() });
      }
    }, 1000);
  }

  // ── Init / wiring ──
  function wire() {
    const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
    const onChange = (id, fn) => { const el = $(id); if (el) el.addEventListener('change', fn); };
    const onInput = (id, fn) => { const el = $(id); if (el) el.addEventListener('input', fn); };

    on('btn-chor-add', () => addBlock($('chor-block-type').value));
    on('btn-chor-new', () => { loadTemplate(null); });
    on('btn-chor-save', () => save());
    on('btn-chor-preview', () => preview());
    onChange('chor-template-select', () => loadTemplate($('chor-template-select').value));
    onInput('chor-name', () => { if (template) template.name = $('chor-name').value; });
    onChange('chor-mode', () => { if (template) { template.mode = $('chor-mode').value; renderValidation(); } });
    on('btn-chor-next', async () => {
      try { await ctx.send('cast:choreoAdvance', {}); } catch (e) { ctx.announce(e.message || 'Xatolik', true); }
    });
    on('btn-chor-override', async () => {
      if (!dash) return;
      const blocks = (template || { blocks: [] }).blocks;
      if (!blocks.length) { ctx.announce('Template yuklanmagan', true); return; }
      const opts = blocks.filter((b, i) => i > (dash.currentIndex || 0)).map((b) => b.id);
      if (!opts.length) { ctx.announce('Oldinga sakrash uchun blok yo‘q', true); return; }
      const target = window.prompt('O‘tkazib yuborish kerak bo‘lgan blok ID: (masalan: ' + opts.slice(0, 3).join(', ') + ')');
      if (!target) return;
      try {
        const ack = await ctx.send('cast:choreoOverride', { blockId: target.trim() });
        if (!ack.ok) ctx.announce(ack.error?.message || 'Override amalga oshmadi', true);
      } catch (e) { ctx.announce(e.message || 'Xatolik', true); }
    });

    // Keyboard move (item 5 — Alt+↑ / Alt+↓)
    document.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        const active = document.querySelector('.chor-block:hover, .chor-block:focus-within');
        const sel = $('chor-blocks')?.querySelector('.chor-block');
        const block = active || sel;
        if (!block?.dataset?.blockId) return;
        e.preventDefault();
        move(e.key === 'ArrowUp' ? 'up' : 'down', block.dataset.blockId);
      }
    });

    startTick();
  }

  window.CastChoreography = {
    setContext,
    init() { wire(); },
    open() {
      refreshList();
      if (template) { $('chor-name').value = template.name || ''; $('chor-mode').value = template.mode || 'guided'; }
    },
    setTemplates(list) { templates = list || []; renderTemplateSelect(); },
    setTemplate(t) { template = t; },
    renderDashboard,
    renderAll,
    hasTemplate: () => Boolean(template),
  };
})();
