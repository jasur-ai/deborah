/* ═══════════════════════════════════════════════════════════════
   Deborah — AI Assist UI (09/2026, v1: frontend-only)
   - AI_MODE='mock': javoblar lokal AIMock'dan (backend keyin ulanadi).
     Backend tayyor bo'lganda: AI_MODE='api' + AIBackend endpointlari —
     UI o'zgarmaydi (shartnoma: {questions[]} va {insights[]}).
   - Mavjud kodga tegilmaydi: builder'ga faqat window.__TB_AI_BRIDGE
     orqali yoziladi; natija paneli window.__PR_RESULT__ o'qiydi.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var AI_MODE = 'mock'; // 'mock' | 'api' (backend keyin)

  /* ── Util ── */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) { // deterministik (bir mavzu — bir natija)
    var t = seed + 0x6D2B79F5;
    return function () {
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ═══════════════ MOCK ENGINE (backend o'rniga, v1) ═══════════════ */
  var AIMock = {
    generateQuestions: function (opts) {
      var topic = (opts.topic || '').trim() || 'Umumiy bilim';
      var text = (opts.text || '').trim();
      var count = Math.max(1, Math.min(10, +opts.count || 5));
      var seed = hashStr(topic + '|' + text.slice(0, 200) + '|' + count);
      var R = rng(seed);
      var out = [];
      var sentences = text ? text.split(/(?<=[.!?])\s+/).filter(function (s) { return s.trim().length > 25; }) : [];
      for (var i = 0; i < count; i++) {
        if (sentences.length && R() < 0.45) {
          out.push(this._fromSentence(sentences[Math.floor(R() * sentences.length)], R));
        } else if (R() < 0.3) {
          out.push(this._trueFalse(topic, R, i));
        } else {
          out.push(this._singleChoice(topic, R, i));
        }
      }
      return out;
    },
    _singleChoice: function (topic, R, i) {
      var angles = [
        'asosiy tushunchasi nimadan iborat', 'eng muhim xususiyati qaysi',
        'amalda qayerda qo‘llaniladi', 'tarkibiy qismlaridan biri qaysi',
        'to‘g‘ri ta’rifi qaysi qatorda berilgan', 'asosiy farqi nimada'
      ];
      var a = angles[Math.floor(R() * angles.length)];
      var corrects = [
        '«' + topic + '» ' + a + ' — darslikdagi asosiy ta’rif',
        'Nazariy asoslarga ko‘ra to‘g‘ri javob shu',
        'Amaliy misollar tahlilidan kelib chiqqan xulosa'
      ];
      var wrongs = [
        'Umumiy holatda uchraydigan, ammo bu mavzuga oid bo‘lmagan holat',
        'Qisman to‘g‘ri, ammo to‘liq javob bera olmaydigan variant',
        'Boshqa mavzuga tegishli tushuncha',
        'Faqat maxsus sharoitda to‘g‘ri bo‘ladigan istisno',
        'Keng tarqalgan noto‘g‘ri tasavvur'
      ];
      var correct = corrects[Math.floor(R() * corrects.length)];
      var opts = [correct];
      var pool = wrongs.slice();
      while (opts.length < 4 && pool.length) opts.push(pool.splice(Math.floor(R() * pool.length), 1)[0]);
      // aralashtirish
      for (var k = opts.length - 1; k > 0; k--) {
        var j = Math.floor(R() * (k + 1));
        var t = opts[k]; opts[k] = opts[j]; opts[j] = t;
      }
      return {
        type: 'single_choice', text: topic + ' ' + a + '?',
        options: opts, correct: opts.indexOf(correct),
        explanation: 'MockJS: backend ulanmaguncha namuna variantlar. Haqiqiy AI keyin almashtiradi.'
      };
    },
    _trueFalse: function (topic, R, i) {
      var claims = [
        '«' + topic + '» tushunchasi faqat nazariy ahamiyatga ega',
        '«' + topic + '» amaliyotda keng qo‘llaniladi',
        '«' + topic + '» bo‘yicha asosiy qoidalar barcha holatlarda bir xil ishlaydi'
      ];
      var isTrue = R() < 0.5;
      return {
        type: 'true_false', text: claims[i % claims.length] + ' — to‘g‘rimi?',
        options: ['To‘g‘ri', 'Noto‘g‘ri'], correct: isTrue ? 0 : 1, explanation: ''
      };
    },
    _fromSentence: function (sentence, R) {
      var words = sentence.trim().split(/\s+/).filter(function (w) { return w.replace(/[^a-zA-Zo‘g‘shchO‘G‘SHCH]/g, '').length > 4; });
      if (words.length < 2) return this._trueFalse('Matn', R, 0);
      var target = words[Math.floor(R() * words.length)];
      var clean = target.replace(/[.,;:!?()«»"']/g, '');
      var masked = sentence.replace(target, '_____');
      var distract = ['mazmunan yaqin so‘z', 'shaklan o‘xshash so‘z', 'teskari ma’noli so‘z'];
      var opts = [clean].concat(distract);
      for (var k = opts.length - 1; k > 0; k--) {
        var j = Math.floor(R() * (k + 1));
        var t = opts[k]; opts[k] = opts[j]; opts[j] = t;
      }
      return {
        type: 'single_choice', text: 'Bo‘sh o‘rinni to‘ldiring: ' + masked,
        options: opts, correct: opts.indexOf(clean), explanation: ''
      };
    },
    analyzeResult: function (res) {
      var p = res.percent, total = res.total, wrong = res.wrong || [];
      var ins = [];
      var level = p >= 86 ? 'a’lo' : p >= 71 ? 'yaxshi' : p >= 56 ? 'o‘rtacha' : 'past';
      ins.push({
        icon: '📊', title: 'Umumiy xulosa',
        html: 'Natijangiz <b>' + p + '%</b> — ' + level + ' daraja. ' +
          (wrong.length ? 'Jami <b>' + wrong.length + '</b> ta savolda xato bor — ularni quyida ko‘ring.' : 'Xatosiz! 🎉')
      });
      if (wrong.length) {
        var items = wrong.slice(0, 5).map(function (w) { return '<li>' + esc(w.text) + '</li>'; }).join('');
        ins.push({ icon: '🎯', title: 'Qayta ko‘rib chiqish kerak', html: '<ul>' + items + '</ul>' + (wrong.length > 5 ? '<p>…va yana ' + (wrong.length - 5) + ' ta.</p>' : '') });
        ins.push({
          icon: '💡', title: 'Tavsiya',
          html: 'Xato savollarni «Qayta yechish — faqat xatolar» bilan takrorlang. Har birini tushunib yechsangiz, keyingi urinishda <b>' + Math.min(100, p + wrong.length * 5) + '%+</b> real maqsad.'
        });
      } else {
        ins.push({ icon: '🚀', title: 'Keyingi qadam', html: 'Bu mavzu o‘zlashtirildi. Keyingi mavzuga o‘ting yoki qiyinroq test sinab ko‘ring.' });
      }
      if (total >= 10 && p >= 56 && p < 86) {
        ins.push({ icon: '📈', title: 'O‘sish rejasi', html: '3 kunda 2 marta takrorlash — mustahkamlashning eng samarali usuli (spaced repetition).' });
      }
      return ins;
    }
  };

  /* ═══════════════ BACKEND CLIENT (v2: backend ulanganda) ═══════════════
     Shartnoma:
       POST /api/ai/assist/generate {topic,text,count} → {questions:[{type,text,options,correct,explanation}]}
       POST /api/ai/assist/analyze  {percent,correct,total,wrong:[{text}]} → {insights:[{icon,title,html}]}
     Hozir: AI_MODE='mock' → AIMock ishlaydi. Backend tayyor bo'lganda
     faqat AI_MODE='api' qilinadi — UI va chaqiruv joylari o'zgarmaydi. */
  var AIBackend = {
    generate: function (opts) {
      if (AI_MODE !== 'api') return Promise.resolve(AIMock.generateQuestions(opts));
      return fetch('/api/ai/assist/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts)
      }).then(function (r) { return r.json(); }).then(function (d) { return d.questions || []; });
    },
    analyze: function (res) {
      if (AI_MODE !== 'api') return Promise.resolve(AIMock.analyzeResult(res));
      return fetch('/api/ai/assist/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(res)
      }).then(function (r) { return r.json(); }).then(function (d) { return d.insights || []; });
    }
  };

  /* ═══════════════ UI: GENERATE MODAL ═══════════════ */
  function openGenerateModal(onInsert) {
    var overlay = document.createElement('div');
    overlay.className = 'ai-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'AI bilan savol yaratish');
    overlay.innerHTML =
      '<div class="ai-modal">' +
        '<div class="ai-modal-head"><span class="ai-spark">✨</span><h2>AI bilan savol yaratish</h2>' +
        '<span class="ai-badge">beta</span>' +
        '<button type="button" class="ai-modal-close" data-close aria-label="Yopish">✕</button></div>' +
        '<div class="ai-modal-body">' +
          '<div class="ai-tabs" role="tablist">' +
            '<button type="button" class="ai-tab" data-tab="topic" role="tab" aria-selected="true">📝 Mavzu</button>' +
            '<button type="button" class="ai-tab" data-tab="text" role="tab" aria-selected="false">📄 Matn</button>' +
            '<button type="button" class="ai-tab" data-tab="file" role="tab" aria-selected="false">📎 Fayl</button>' +
          '</div>' +
          '<div data-pane="topic"><div class="ai-field"><label for="ai-topic">Mavzu</label>' +
            '<input class="ai-input" id="ai-topic" placeholder="Masalan: Fotosintez, Kvadrat tenglamalar…"></div></div>' +
          '<div data-pane="text" hidden><div class="ai-field"><label for="ai-text">Matn (darslik paragrafi, konspekt…)</label>' +
            '<textarea class="ai-textarea" id="ai-text" placeholder="Matnni bu yerga joylashtiring…"></textarea></div></div>' +
          '<div data-pane="file" hidden><div class="ai-field"><label>Matnli fayl (.txt, .md — brauzerda o‘qiladi)</label>' +
            '<label class="ai-file"><input type="file" id="ai-file" accept=".txt,.md,.text">📎 <span id="ai-file-name">Fayl tanlash…</span></label>' +
            '<div class="ai-note">PDF/Word — tez kunda (backend bilan). Hozir .txt/.md qo‘llanadi.</div></div></div>' +
          '<div class="ai-row"><div class="ai-field"><label for="ai-count">Savollar soni</label>' +
            '<select class="ai-select" id="ai-count"><option>3</option><option selected>5</option><option>7</option><option>10</option></select></div>' +
            '<div class="ai-field"><label>&nbsp;</label><button type="button" class="ai-trigger" id="ai-go" style="width:100%;justify-content:center"><span class="ai-spark">✨</span> Yaratish</button></div></div>' +
          '<div id="ai-out"></div>' +
        '</div>' +
        '<div class="ai-modal-foot" hidden><button type="button" class="ai-trigger" id="ai-insert"><span class="ai-spark">＋</span> <span id="ai-insert-txt">Qo‘shish</span></button></div>' +
      '</div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('open'); });

    var currentTab = 'topic';
    var fileText = '';
    var generated = [];
    function close() {
      overlay.classList.remove('open');
      setTimeout(function () { overlay.remove(); }, 200);
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', function (e) { if (e.target === overlay || e.target.closest('[data-close]')) close(); });
    overlay.querySelectorAll('.ai-tab').forEach(function (t) {
      t.addEventListener('click', function () {
        currentTab = t.dataset.tab;
        overlay.querySelectorAll('.ai-tab').forEach(function (x) { x.setAttribute('aria-selected', x === t ? 'true' : 'false'); });
        overlay.querySelectorAll('[data-pane]').forEach(function (p) { p.hidden = p.dataset.pane !== currentTab; });
      });
    });
    var fileInput = overlay.querySelector('#ai-file');
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      overlay.querySelector('#ai-file-name').textContent = f.name + ' (' + Math.round(f.size / 1024) + ' KB)';
      var rd = new FileReader();
      rd.onload = function () { fileText = String(rd.result || '').slice(0, 20000); };
      rd.readAsText(f);
    });

    var out = overlay.querySelector('#ai-out');
    var foot = overlay.querySelector('.ai-modal-foot');
    overlay.querySelector('#ai-go').addEventListener('click', function () {
      var topic = overlay.querySelector('#ai-topic').value.trim();
      var text = currentTab === 'text' ? overlay.querySelector('#ai-text').value.trim()
        : currentTab === 'file' ? fileText : '';
      if (currentTab === 'topic' && !topic) { overlay.querySelector('#ai-topic').focus(); return; }
      if (currentTab !== 'topic' && !text) { out.innerHTML = '<div class="ai-note">Avval matn/fayl kiriting.</div>'; return; }
      var count = +overlay.querySelector('#ai-count').value;
      out.innerHTML = '<div class="ai-progress"><i id="ai-bar"></i></div>' +
        '<div class="ai-thinking"><span class="ai-dots"><i></i><i></i><i></i></span> AI savollar tuzmoqda…</div>';
      foot.hidden = true;
      var bar = out.querySelector('#ai-bar');
      var p = 0;
      var tick = setInterval(function () { p = Math.min(92, p + 14); if (bar) bar.style.width = p + '%'; }, 160);
      // mock "o'ylash" pauzasi — API ulanganda real kutish bo'ladi
      setTimeout(function () {
        AIBackend.generate({ topic: topic, text: text, count: count }).then(function (qs) {
          clearInterval(tick);
          generated = qs || [];
          if (!generated.length) { out.innerHTML = '<div class="ai-note">Hech narsa yaratilmadi. Boshqa mavzu sinang.</div>'; return; }
          out.innerHTML = generated.map(function (q, i) {
            var typeName = q.type === 'true_false' ? 'To‘g‘ri/Noto‘g‘ri' : 'Bitta javobli';
            var opts = (q.options || []).map(function (o, j) {
              return '<div>' + (j === q.correct ? '<b>● ' + esc(o) + '</b>' : '○ ' + esc(o)) + '</div>';
            }).join('');
            return '<label class="ai-preview-item"><input type="checkbox" data-i="' + i + '" checked>' +
              '<span><span class="ai-preview-q">' + (i + 1) + '. ' + esc(q.text) + '</span>' +
              '<span class="ai-preview-type">' + typeName + '</span>' +
              '<span class="ai-preview-o" style="display:block;margin-top:4px">' + opts + '</span></span></label>';
          }).join('') + '<span class="ai-mock-tag">✨ AI namuna (mock) — backend keyin ulanadi</span>';
          foot.hidden = false;
          updateInsertTxt();
          out.querySelectorAll('input[type=checkbox]').forEach(function (c) {
            c.addEventListener('change', updateInsertTxt);
          });
        });
      }, AI_MODE === 'api' ? 0 : 900);
      function updateInsertTxt() {
        var n = out.querySelectorAll('input[type=checkbox]:checked').length;
        overlay.querySelector('#ai-insert-txt').textContent = 'Tanlanganlarni qo‘shish (' + n + ')';
      }
    });
    overlay.querySelector('#ai-insert').addEventListener('click', function () {
      var sel = [];
      out.querySelectorAll('input[type=checkbox]:checked').forEach(function (c) {
        var q = generated[+c.dataset.i];
        if (q) sel.push(q);
      });
      if (!sel.length) return;
      close();
      if (typeof onInsert === 'function') onInsert(sel);
    });
    setTimeout(function () { var f = overlay.querySelector('#ai-topic'); if (f) f.focus(); }, 120);
  }

  /* ═══════════════ UI: TAHLIL PANEL ═══════════════ */
  function openAnalysisPanel(res) {
    var old = document.querySelector('.ai-panel');
    if (old) old.remove();
    var panel = document.createElement('aside');
    panel.className = 'ai-panel';
    panel.setAttribute('role', 'complementary');
    panel.setAttribute('aria-label', 'AI tahlil');
    panel.innerHTML =
      '<div class="ai-panel-head"><span class="ai-spark">✨</span><h2>AI tahlil</h2>' +
      '<button type="button" class="ai-modal-close" data-close aria-label="Yopish" style="margin-left:auto">✕</button></div>' +
      '<div class="ai-panel-body"><div class="ai-thinking"><span class="ai-dots"><i></i><i></i><i></i></span> Natija tahlil qilinmoqda…</div></div>';
    document.body.appendChild(panel);
    requestAnimationFrame(function () { panel.classList.add('open'); });
    function close() {
      panel.classList.remove('open');
      setTimeout(function () { panel.remove(); }, 240);
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    panel.querySelector('[data-close]').addEventListener('click', close);
    var body = panel.querySelector('.ai-panel-body');
    setTimeout(function () {
      AIBackend.analyze(res).then(function (insights) {
        body.innerHTML =
          '<div class="ai-score-ring"><div class="ai-score-num">' + res.percent + '%</div>' +
          '<div class="ai-score-cap">' + res.correct + ' / ' + res.total + ' to‘g‘ri javob</div></div>' +
          (insights || []).map(function (s) {
            return '<div class="ai-insight"><h3>' + esc(s.icon || '✨') + ' ' + esc(s.title || '') + '</h3><div>' + (s.html || '') + '</div></div>';
          }).join('') +
          '<span class="ai-mock-tag">✨ AI namuna (mock) — backend keyin ulanadi</span>';
      });
    }, AI_MODE === 'api' ? 0 : 700);
  }

  /* ═══════════════ AUTO-MOUNT (mavjud sahifalarga qo'shilish) ═══════════════ */
  function mount() {
    // 1) Test builder — AI generate tugmasi
    var genBtn = document.getElementById('tb-ai-generate');
    if (genBtn && !genBtn.dataset.aiMounted) {
      genBtn.dataset.aiMounted = '1';
      genBtn.addEventListener('click', function () {
        openGenerateModal(function (questions) {
          var bridge = window.__TB_AI_BRIDGE;
          if (bridge && typeof bridge.insert === 'function') {
            bridge.insert(questions);
          } else {
            alert('Builder topilmadi — sahifani yangilab qayta urining.');
          }
        });
      });
    }
    // 2) Natija ekranlari — AI tahlil tugmasi
    var anBtn = document.getElementById('pr-ai-analysis');
    if (anBtn && !anBtn.dataset.aiMounted) {
      anBtn.dataset.aiMounted = '1';
      anBtn.addEventListener('click', function () {
        var res = window.__PR_RESULT__;
        if (!res) { alert('Natija topilmadi.'); return; }
        openAnalysisPanel(res);
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
  // practice natija kech render bo'ladi — kuzatuvchi (faqat tugma uchun)
  try {
    var mo = new MutationObserver(function () { mount(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(function () { mo.disconnect(); }, 30000);
  } catch (_) {}

  // tashqi API (kelajakda boshqa sahifalar uchun)
  window.DeborahAI = { openGenerateModal: openGenerateModal, openAnalysisPanel: openAnalysisPanel, mode: AI_MODE };
})();
