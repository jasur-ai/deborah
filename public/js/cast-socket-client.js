/**
 * Deborah — Cast Socket Client
 * ----------------------------
 * sendCommand(type, payload) — command/event envelope + ACK.
 * - commandId: crypto.randomUUID()
 * - knownRevision: client known revision
 * - ACK timeout 5s, retry same commandId
 * - event dedupe (bounded LRU)
 */

(function (global) {
  'use strict';

  const ACK_TIMEOUT_MS = 5000;
  const MAX_EVENT_DEDUPE = 200;

  class CastSocketClient {
    constructor(opts) {
      this.socket = opts.socket; // socket.io client
      this.revision = opts.initialRevision || 1;
      this.sessionId = opts.sessionId || null;
      this.actorId = opts.actorId || null;
      this.onEvent = opts.onEvent || (() => {});
      this.onError = opts.onError || (() => {});
      this.pendingAcks = new Map(); // commandId -> {resolve, timer}
      this.eventIds = new Set();
      this.eventQueue = []; // FIFO for LRU eviction

      this._bindSocket();
    }

    _bindSocket() {
      const s = this.socket;
      s.on('cast:error', (data) => this.onError(data));

      // Dedupe + dispatch all cast:* events
      s.onAny((eventName, data) => {
        if (!String(eventName).startsWith('cast:')) return;
        // Events carry revision for gap detection
        if (data && data.eventId && this.eventIds.has(data.eventId)) return; // dedupe
        if (data && data.eventId) {
          this.eventIds.add(data.eventId);
          this.eventQueue.push(data.eventId);
          if (this.eventQueue.length > MAX_EVENT_DEDUPE) {
            const evict = this.eventQueue.shift();
            this.eventIds.delete(evict);
          }
        }
        if (data && typeof data.revision === 'number' && data.revision > this.revision) {
          this.revision = data.revision;
        }
        this.onEvent(eventName, data);
      });
    }

    /**
     * Send a command with envelope + ACK.
     * @returns {Promise<object>} ack result
     */
    sendCommand(type, payload, opts = {}) {
      const commandId = opts.commandId || crypto.randomUUID();
      const envelope = {
        commandId,
        sessionId: this.sessionId,
        actorId: this.actorId,
        expectedRevision: this.revision,
        type,
        payload: payload || {},
        sentAtClient: Date.now(),
      };

      return new Promise((resolve, reject) => {
        if (this.pendingAcks.has(commandId)) {
          // Same command in flight → return existing promise
          return this.pendingAcks.get(commandId).promise;
        }

        const timeout = setTimeout(() => {
          this.pendingAcks.delete(commandId);
          // Retry same commandId (idempotent server-side)
          if (!opts.noRetry) {
            this.sendCommand(type, payload, { commandId, noRetry: true }).then(resolve, reject);
          } else {
            reject(new Error('ACK_TIMEOUT'));
          }
        }, opts.ackTimeout || ACK_TIMEOUT_MS);

        const promise = new Promise((res, rej) => {
          this.pendingAcks.set(commandId, { promise, resolve: res, reject: rej, timer: timeout });
          this.socket.emit(type, envelope, (ack) => {
            clearTimeout(timeout);
            this.pendingAcks.delete(commandId);
            if (ack && ack.ok) {
              if (typeof ack.newRevision === 'number') this.revision = ack.newRevision;
              res(ack);
            } else {
              const err = ack && ack.error ? ack.error : { code: 'UNKNOWN' };
              const e = new Error(err.message || 'Xatolik');
              e.code = err.code;
              e.details = err;
              rej(e);
            }
          });
        });

        this.pendingAcks.get(commandId).promise = promise;
        return promise;
      });
    }

    /** Update known revision after snapshot recovery */
    setRevision(rev) {
      this.revision = rev;
    }
  }

  global.CastSocketClient = CastSocketClient;
})(window);
