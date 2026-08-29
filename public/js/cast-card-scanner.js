/**
 * Deborah — Cast Paper-Card Scanner (C4-03)
 * ------------------------------------------
 * Client-local scanner. RAW FRAME HECh QACHON serverga yuborilmaydi va
 * storage'da qolmaydi (item 5/6, tugallanish sharti). Frame processing
 * client-local (item 4). Camera permission faqat scanner action bosilganda
 * so'raladi (item 3). Serverga faqat cardId + orientation + confidence
 * yuboriladi (item 7).
 *
 * Usage:
 *   const scanner = CastCardScanner.create({ $, send, onScan: (payload)=>{} });
 *   scanner.open();   // camera + overlay
 *   scanner.close();  // stop tracks (privacy)
 */

(function (global) {
  'use strict';

  const ORIENTATIONS = ['0', '90', '180', '270']; // four-orientation mapping (item 2)

  class CastCardScanner {
    constructor(opts) {
      this.$ = opts.$ || ((id) => document.getElementById(id));
      this.send = opts.send || (() => Promise.resolve(null));
      this.onScan = opts.onScan || (() => {});
      this.stream = null;
      this.captured = false;
      this.lastPayload = null;
      this.overlay = null;
      this.video = null;
    }

    /**
     * Open camera + overlay. Camera permission faqat shu yerda so'raladi (item 3).
     */
    async open() {
      if (this.stream) return;
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        this._buildOverlay();
        this.video.srcObject = this.stream;
        await this.video.play();
        this.captured = false;
      } catch (err) {
        // Permission denial fallback — manual card entry (item: permission denial)
        if (this.onPermissionDenied) this.onPermissionDenied(err);
        throw err;
      }
    }

    /**
     * Stop camera tracks immediately (privacy — item 6: raw frame recording yo'q).
     */
    close() {
      if (this.stream) {
        this.stream.getTracks().forEach((t) => t.stop());
        this.stream = null;
      }
      if (this.overlay && this.overlay.parentNode) {
        this.overlay.parentNode.removeChild(this.overlay);
      }
      this.overlay = null;
      this.captured = false;
    }

    /**
     * Detect orientation from card corners (client-local — item 4).
     * Bu yerda oddiy deterministik mapping: real deployment'da QR/AR
     * marker bilan aniqlanadi; baribir frame hech qayerga yuborilmaydi.
     * @returns {{orientation: string, confidence: number}}
     */
    detectOrientation() {
      // Simulated detection — 0..3 random emas, o'qituvchi kartani ushlab turgan
      // orientatsiyani tanlaydi. Confidence glare/occlusion'ga qarab (item 9).
      // Real impl: marker detection → orientation + confidence 0..1.
      return { orientation: this._currentOrientation || '0', confidence: 0.9 };
    }

    /**
     * Capture current frame → only metadata (frame itself discarded).
     * @param {string} cardId — detected card id (CARD-001)
     */
    async capture(cardId) {
      if (this.captured) return null;
      const { orientation, confidence } = this.detectOrientation();
      this.captured = true;
      this.lastPayload = {
        cardId: String(cardId || '').toUpperCase(),
        orientation,
        confidence,
        // Raw frame bu yerda TASHLANADI — serverga yuborilmaydi (item 5/6)
      };
      return this.lastPayload;
    }

    _buildOverlay() {
      const overlay = document.createElement('div');
      overlay.className = 'card-scan-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-label', 'Kartochka skaneri');
      overlay.innerHTML = `
        <div class="card-scan-box cast-surface">
          <div class="card-scan-head">
            <span>📷 Kartochka skaneri</span>
            <button type="button" class="cast-btn card-scan-close" aria-label="Yopish">✕</button>
          </div>
          <video class="card-scan-video" autoplay muted playsinline></video>
          <div class="card-scan-hint">Kartani to‘rt yo‘nalishning birida ushlang</div>
          <div class="card-scan-ori">
            ${ORIENTATIONS.map((o) => `<button type="button" class="cast-btn card-scan-ori-btn" data-ori="${o}">${o}°</button>`).join('')}
          </div>
          <div class="card-scan-row">
            <label class="card-scan-field">
              <span>Karta ID</span>
              <input class="cast-input" id="card-scan-id" placeholder="CARD-001" maxlength="9">
            </label>
            <button type="button" class="cast-btn cast-btn-primary" id="card-scan-go">Qayd etish</button>
          </div>
          <div class="card-scan-msg" id="card-scan-msg" role="status"></div>
        </div>
      `;
      document.body.appendChild(overlay);
      this.overlay = overlay;
      this.video = overlay.querySelector('.card-scan-video');

      overlay.querySelector('.card-scan-close').addEventListener('click', () => this.close());
      overlay.querySelectorAll('.card-scan-ori-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          this._currentOrientation = btn.dataset.ori;
          overlay.querySelectorAll('.card-scan-ori-btn').forEach((b) => b.classList.remove('card-scan-ori-active'));
          btn.classList.add('card-scan-ori-active');
        });
      });
      overlay.querySelector('#card-scan-go').addEventListener('click', async () => {
        const cardId = overlay.querySelector('#card-scan-id').value.trim();
        const msg = overlay.querySelector('#card-scan-msg');
        if (!cardId) { msg.textContent = 'Karta ID kiriting (masalan CARD-001)'; return; }
        try {
          const payload = await this.capture(cardId);
          if (!payload) { msg.textContent = 'Bu karta allaqachon qayd etilgan'; return; }
          msg.textContent = 'Yuborilmoqda…';
          const ack = await this.send('cast:cardScan', payload);
          if (ack && ack.ok) {
            msg.textContent = ack.status === 'DUPLICATE' ? '⚠️ Takroriy karta' : '✅ Qayd etildi';
            this.onScan(ack);
            // O'qituvchi bitta savolda KO'P kartani skanerlaydi — keyingi karta uchun reset
            this.captured = false;
          } else {
            msg.textContent = ack?.error?.message || 'Qayd etilmadi';
            this.captured = false; // retry
          }
        } catch (err) {
          msg.textContent = err.message || 'Xatolik';
          this.captured = false;
        }
      });
    }
  }

  global.CastCardScanner = { create: (opts) => new CastCardScanner(opts) };
})(window);
