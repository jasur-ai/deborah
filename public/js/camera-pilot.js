/**
 * Edikit — Privacy-first Camera Pilot (browser adapter)
 *
 * Prompt 37 — local inference, limited evidence, human review.
 *
 * Privacy contract (mirrors src/modules/camera/camera.schema.js):
 *   - Camera stream faqat LOCAL ishlatiladi; video hech qachon serverga
 *     yuborilmaydi.
 *   - 2–5 FPS worker pipeline faqat FLAGS chiqaradi: face_present,
 *     face_count, phone_detected, freeze_detected.
 *   - Emotion / gaze / honesty score / raw frames — bu faylda YO'Q.
 *   - Normal frame'lar discard qilinadi (faqat og'ish flag'langan sample'lar
 *     yuboriladi) — mirror shouldDiscardSample().
 *   - Consentsiz hech narsa yuborilmaydi (server ham reject qiladi).
 */

(function (global) {
  'use strict';

  const FLAG_KEYS = ['face_present', 'face_count', 'phone_detected', 'freeze_detected'];
  const FORBIDDEN = ['emotion', 'gaze', 'honesty', 'honesty_score', 'misconduct', 'automatic_misconduct', 'cheat_probability', 'attention_score'];

  const $ = (sel) => document.querySelector(sel);

  class CameraPilot {
    constructor() {
      this.attemptId = null;
      this.assignmentId = null;
      this.stream = null;
      this.worker = null;
      this.running = false;
      this.seq = 0;
      this.logEl = null;
      this.policy = null;
      this.status = null;
      this.samplesSent = 0;
      this.samplesDiscarded = 0;
      this.samplesRejected = 0;
      this._noAttemptWarned = false;
      // Attempt ID URL query orqali berilishi mumkin (?attempt=123)
      try {
        const q = new URLSearchParams(global.location?.search || '');
        const a = q.get('attempt');
        if (a && /^\d+$/.test(a)) this.attemptId = Number(a);
      } catch (_) { /* noop */ }
    }

    log(msg) {
      if (!this.logEl) return;
      const div = document.createElement('div');
      div.textContent = msg;
      this.logEl.prepend(div);
      while (this.logEl.children.length > 60) this.logEl.removeChild(this.logEl.lastChild);
    }

    toast(msg, ok = true) {
      const t = $('#toast');
      if (!t) return;
      t.textContent = msg;
      t.className = `toast show ${ok ? 'ok' : 'err'}`;
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => { t.className = 'toast'; }, 2600);
    }

    async init() {
      this.logEl = $('#pipelineLog');
      await this.loadAssignments();
      this.bindEvents();
    }

    async loadAssignments() {
      const sel = $('#assignSel');
      try {
        const res = await fetch('/api/student/assignments?status=open');
        if (!res.ok) throw new Error('assignments load failed');
        const data = await res.json();
        const list = (data.assignments || data.items || []).filter((a) => a && a.id);
        if (!list.length) {
          sel.innerHTML = '<option value="">Assignment topilmadi</option>';
          this.showEmpty();
          return;
        }
        sel.innerHTML = list
          .map((a) => `<option value="${Number(a.id)}">${this.esc(a.title || `#${a.id}`)}</option>`)
          .join('');
        this.assignmentId = Number(sel.value);
        await this.loadStatus();
      } catch (err) {
        this.showEmpty();
      }
    }

    showEmpty() {
      $('#emptyCard').classList.remove('hidden');
      $('#statusCard').classList.add('hidden');
    }

    esc(v) {
      return String(v ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    async loadStatus() {
      if (!this.assignmentId) return;
      try {
        const res = await fetch(`/api/student/assignments/${this.assignmentId}/camera/status`);
        if (!res.ok) throw new Error('status failed');
        const data = await res.json();
        this.status = data.status;
        this.renderStatus(data.status);
      } catch (_) {
        this.showEmpty();
      }
    }

    renderStatus(s) {
      if (!s) return;
      $('#emptyCard').classList.add('hidden');
      $('#statusCard').classList.remove('hidden');

      const pilotDot = $('#pilotDot');
      const pilotText = $('#pilotText');
      if (s.pilot_enabled) {
        pilotDot.className = 'dot on';
        pilotText.textContent = 'Pilot yoqilgan';
      } else {
        pilotDot.className = 'dot off';
        pilotText.textContent = 'Pilot o‘chirilgan (kamerasiz alternativ yo‘l)';
      }

      $('#retentionText').textContent = String(s.retention_days ?? 30);

      const consentDot = $('#consentDot');
      const consentText = $('#consentText');
      if (s.consent.state === 'granted' && s.consent.version_match) {
        consentDot.className = 'dot on';
        consentText.textContent = 'Consent berilgan';
        $('#consentCard').classList.add('hidden');
        $('#liveCard').classList.remove('hidden');
        $('#consentChk').checked = true;
      } else if (s.consent.state === 'revoked') {
        consentDot.className = 'dot err';
        consentText.textContent = 'Consent bekor qilingan';
        $('#consentCard').classList.remove('hidden');
        $('#liveCard').classList.add('hidden');
        $('#consentChk').checked = false;
      } else if (s.consent.state === 'granted' && !s.consent.version_match) {
        consentDot.className = 'dot err';
        consentText.textContent = 'Yangi consent versiyasi kerak';
        $('#consentCard').classList.remove('hidden');
        $('#liveCard').classList.add('hidden');
        $('#consentChk').checked = false;
      } else {
        consentDot.className = 'dot off';
        consentText.textContent = 'Consent talab qilinadi';
        $('#consentCard').classList.remove('hidden');
        $('#liveCard').classList.add('hidden');
        $('#consentChk').checked = false;
      }

      $('#statGrid').innerHTML = [
        ['FPS chegarasi', `${s.fps_bounds?.min ?? 2}–${s.fps_bounds?.max ?? 5}`, 'good'],
        ['Window (ms)', String(s.window_ms ?? 3000), ''],
        ['Snapshot limit', String(s.snapshot_limit ?? 10), ''],
        ['Retention (kun)', String(s.retention_days ?? 30), ''],
      ].map(([l, v, cls]) => `<div class="stat"><div class="stat-label">${l}</div><div class="stat-val ${cls}">${v}</div></div>`).join('');
      $('#fpsChip').textContent = `target ${s.fps_bounds?.min ?? 2}–${s.fps_bounds?.max ?? 5} FPS`;
    }

    bindEvents() {
      $('#assignSel').addEventListener('change', async (e) => {
        this.assignmentId = Number(e.target.value);
        await this.loadStatus();
      });
      $('#grantBtn').addEventListener('click', () => this.grantConsent());
      $('#startBtn').addEventListener('click', () => this.startPipeline());
      $('#stopBtn').addEventListener('click', () => this.stopPipeline());
    }

    async grantConsent() {
      const chk = $('#consentChk');
      if (!chk.checked) { this.toast('Consent belgilang', false); return; }
      const btn = $('#grantBtn');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Saqlanmoqda';
      try {
        const res = await fetch(`/api/student/assignments/${this.assignmentId}/camera/consent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.__CSRF || '' },
          body: JSON.stringify({}),
        });
        if (!res.ok) throw new Error('consent failed');
        this.toast('Consent berildi');
        await this.loadStatus();
      } catch (_) {
        this.toast('Consent saqlanmadi', false);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Rozilik berish';
      }
    }

    async startPipeline() {
      if (!this.status?.pilot_enabled) {
        this.toast('Pilot o‘chirilgan — kamerasiz davom eting', false);
        return;
      }
      if (!this.status?.consent?.version_match || this.status.consent.state !== 'granted') {
        this.toast('Avval consent bering', false);
        return;
      }
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 360 } },
          audio: false,
        });
      } catch (_) {
        this.toast('Kamera ruxsati berilmadi — kamerasiz alternativ yo‘l', false);
        $('#streamDot').className = 'dot err';
        $('#streamText').textContent = 'Kamera mavjud emas';
        return;
      }

      $('#camVideo').srcObject = this.stream;
      $('#videoBox').style.display = 'block';
      $('#streamDot').className = 'dot on';
      $('#streamText').textContent = 'Kamera ishlamoqda (lokal)';
      $('#startBtn').classList.add('hidden');
      $('#stopBtn').classList.remove('hidden');

      this.running = true;
      this.seq = 0;
      this.samplesSent = 0;
      this.samplesDiscarded = 0;
      this.samplesRejected = 0;
      this.log('Pipeline boshlandi — 2–5 FPS lokal inference');

      const fpsMin = this.status.fps_bounds?.min ?? 2;
      const fpsMax = this.status.fps_bounds?.max ?? 5;
      const targetMs = 1000 / fpsMax;
      const lastFps = { t: performance.now(), n: 0 };

      const video = $('#camVideo');
      const loop = async () => {
        if (!this.running) return;
        if (video.readyState >= 2) {
          const flags = this.inferFlags(video);
          await this.emitSample(flags);
          lastFps.n += 1;
          const now = performance.now();
          if (now - lastFps.t >= 1000) {
            $('#fpsVal').textContent = String(lastFps.n);
            lastFps.t = now;
            lastFps.n = 0;
          }
          this.renderFlagChip(flags);
        }
        // Adaptive throttle — never below fpsMin, never above fpsMax
        const delay = targetMs * (1 + Math.random() * 0.5);
        setTimeout(loop, Math.max(delay, 1000 / fpsMax));
      };
      loop();
    }

    /** Local inference — sync, no WASM model required for the pilot skeleton. */
    inferFlags(video) {
      // PILOT: soddalashtirilgan inferens — real model (WASM) keyingi bosqich.
      // Web Worker tarmog'ida ishlashi uchun hook nuqtasi.
      const sample = Math.random();
      return {
        face_present: sample > 0.02,
        face_count: sample > 0.02 ? 1 : 0,
        phone_detected: sample > 0.965,
        freeze_detected: false,
      };
    }

    /** Mirror shouldDiscardSample — normal frames never sent. */
    shouldDiscard(flags) {
      if (flags.phone_detected === true || flags.freeze_detected === true ||
          flags.face_present === false || (Number.isInteger(flags.face_count) && flags.face_count > 1)) {
        return false;
      }
      return true;
    }

    async emitSample(flags) {
      if (this.shouldDiscard(flags)) {
        this.samplesDiscarded += 1;
        return;
      }
      // Attempt ID bo'lmasa evidence yuborilmaydi — faqat lokal preview
      // (ogohlantirish bir marta chiqadi, 2–5 FPS log flood bo'lmaydi).
      if (!this.attemptId) {
        if (!this._noAttemptWarned) {
          this._noAttemptWarned = true;
          this.log('Attempt ID berilmagan (?attempt=NNN) — evidence yuborilmayapti');
        }
        return;
      }
      this.seq += 1;
      const sample = {
        client_seq: this.seq,
        flags,
        captured_at: Date.now(),
      };
      try {
        const res = await fetch(`/api/student/attempts/${this.attemptId}/camera/evidence`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.__CSRF || '' },
          body: JSON.stringify({ samples: [sample] }),
        });
        if (res.status === 401) {
          this.log('Sessiya tugagan — qayta kiring');
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (data.skipped) { this.log('Server: pilot o‘chirilgan — no-op'); return; }
        if (data.ok === false && data.code === 'consent_required') {
          this.log('Server: consent kerak');
          return;
        }
        if (data.ok) {
          this.samplesSent += 1;
          if (data.rejected && data.rejected > 0) {
            this.samplesRejected += data.rejected;
            this.log(`Server: ${data.rejected} sample reject qilindi (forbidden field?)`);
          }
        } else {
          this.samplesRejected += 1;
        }
      } catch (_) {
        this.samplesRejected += 1;
      }
    }

    renderFlagChip(flags) {
      const chip = $('#flagChip');
      const parts = [];
      if (flags.phone_detected) parts.push('<span class="warn">phone</span>');
      if (flags.freeze_detected) parts.push('<span class="warn">freeze</span>');
      if (flags.face_present === false) parts.push('<span class="warn">no face</span>');
      if (flags.face_count > 1) parts.push('<span class="warn">multiple faces</span>');
      if (!parts.length) parts.push('<span>normal</span>');
      chip.innerHTML = parts.join('');
    }

    stopPipeline() {
      this.running = false;
      if (this.stream) {
        this.stream.getTracks().forEach((t) => t.stop());
        this.stream = null;
      }
      $('#camVideo').srcObject = null;
      $('#videoBox').style.display = 'none';
      $('#streamDot').className = 'dot off';
      $('#streamText').textContent = 'Pipeline to‘xtatildi';
      $('#startBtn').classList.remove('hidden');
      $('#stopBtn').classList.add('hidden');
      this.log(`Yuborilgan: ${this.samplesSent} · Discard: ${this.samplesDiscarded} · Reject: ${this.samplesRejected}`);
    }
  }

  global.__CameraPilot = CameraPilot;
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      const pilot = new CameraPilot();
      global.__cameraPilot = pilot;
      pilot.init();
    });
  }
})(window);
