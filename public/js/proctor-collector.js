/**
 * Deborah — Uch-strike Client Collector (browser adapter)
 *
 * Prompt 34 — visibility/fullscreen incidentlarini yig'ib server classifier'ga
 * yuboradi (research.md §31.1 layer 1 — RAW EVIDENCE ONLY). Classification
 * faqat SERVER tomonda: bu collector hech qachon "strike" deb hukm qilmaydi.
 *
 * Contract (mirrors src/modules/proctor/proctor.schema.js):
 *   - Har incident: { clientSeq, eventType, startedAt, durationMs, deviceId,
 *     epoch } — client_seq monotonic per (attempt, device).
 *   - Blur/network/camera — ham yig'iladi (raw evidence), lekin server ularni
 *     technical deb classify qiladi (strike emas, §15).
 *   - Offline buffer: network yo'q bo'lsa event'lar in-memory queue'da saqlanadi
 *     va online bo'lganda batch bo'lib yuboriladi (§09).
 *   - Server har event'ga server_received_at + hash chain qo'shadi (§31.5).
 *
 * Usage (ES module):
 *   import { ProctorCollector } from '/js/proctor-collector.js';
 *   const collector = new ProctorCollector({ attemptId, epoch, sessionSecret });
 *   await collector.init();
 *   collector.start();   // listens to visibilitychange/fullscreenchange/blur
 *   collector.stop();
 */

(function (global) {
  'use strict';

  const MAX_BUFFER = 200;

  function monotonicNow() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  /**
   * ProctorCollector — raw browser evidence collector for one attempt.
   */
  class ProctorCollector {
    /**
     * @param {Object} opts
     * @param {number} opts.attemptId
     * @param {number} opts.epoch - attempt epoch (bumped on teacher reopen)
     * @param {string} opts.deviceId - matches the offline journal device id
     */
    constructor({ attemptId, epoch, deviceId = 'dev-proctor' }) {
      this.attemptId = attemptId;
      this.epoch = epoch;
      this.deviceId = deviceId;
      this.buffer = [];
      this.seq = 0;
      this.listeners = [];
      this.running = false;
      this.activeIncident = null; // { type, startedAt, timer }
    }

    /** Attach the browser event listeners. */
    start() {
      if (this.running) return;
      this.running = true;

      const onVisibility = () => {
        if (document.hidden) {
          this._begin('visibility_hidden');
        } else {
          this._end('visibility_hidden');
        }
      };
      const onFullscreen = () => {
        if (!document.fullscreenElement) {
          this._begin('fullscreen_exit');
        } else {
          this._end('fullscreen_exit');
        }
      };
      const onBlur = () => this._record('blur', 0);
      const onOffline = () => this._record('network_offline', 0);
      const onOnline = () => this._flush(); // network back — send the buffer
      const onCameraError = () => this._record('camera_failure', 0);

      document.addEventListener('visibilitychange', onVisibility);
      document.addEventListener('fullscreenchange', onFullscreen);
      window.addEventListener('blur', onBlur);
      window.addEventListener('offline', onOffline);
      window.addEventListener('online', onOnline);
      window.addEventListener('error', (e) => {
        if (e && e.message && /getUserMedia|NotAllowedError|NotFoundError/i.test(e.message)) {
          onCameraError();
        }
      });

      this.listeners = [onVisibility, onFullscreen, onBlur, onOffline, onOnline];
    }

    /** Remove listeners + flush the buffer. */
    stop() {
      if (!this.running) return;
      this.running = false;
      this._flush();
      document.removeEventListener('visibilitychange', this.listeners[0]);
      document.removeEventListener('fullscreenchange', this.listeners[1]);
      window.removeEventListener('blur', this.listeners[2]);
      window.removeEventListener('offline', this.listeners[3]);
      window.removeEventListener('online', this.listeners[4]);
      this.listeners = [];
    }

    /** Start timing a focus-loss incident (visibility/fullscreen). */
    _begin(type) {
      if (this.activeIncident) return; // already tracking — dedupe client-side
      this.activeIncident = { type, startedAt: monotonicNow() };
    }

    /** End timing the incident and enqueue it. */
    _end(type) {
      if (!this.activeIncident || this.activeIncident.type !== type) return;
      const durationMs = Math.max(0, Math.round(monotonicNow() - this.activeIncident.startedAt));
      this.activeIncident = null;
      this._record(type, durationMs);
    }

    /**
     * Enqueue a raw event. client_seq is monotonic per (attempt, device).
     * When the network is down the event stays in the buffer (§09).
     */
    _record(eventType, durationMs) {
      this.seq += 1;
      const event = {
        clientSeq: this.seq,
        eventType,
        startedAt: Date.now(),
        durationMs,
        deviceId: this.deviceId,
        epoch: this.epoch,
      };
      this.buffer.push(event);
      if (navigator.onLine === false) return; // offline — wait for 'online'
      this._flush();
    }

    /** Send buffered events as a batch (idempotent — server dedupes by client_seq). */
    async _flush() {
      if (this.buffer.length === 0) return;
      const batch = this.buffer.splice(0, MAX_BUFFER);
      try {
        const res = await fetch(`/api/student/attempts/${this.attemptId}/proctor/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ events: batch }),
        });
        if (!res.ok) {
          // Server rejected — restore the batch to the FRONT of the buffer.
          this.buffer.unshift(...batch);
          if (this.buffer.length > MAX_BUFFER * 3) this.buffer.length = MAX_BUFFER * 3; // bound memory
        }
      } catch (_) {
        this.buffer.unshift(...batch); // network error — retry later
      }
    }

    /** Pending (unsent) event count — for the UI. */
    pendingCount() {
      return this.buffer.length;
    }
  }

  global.ProctorCollector = ProctorCollector;
})(typeof window !== 'undefined' ? window : globalThis);
