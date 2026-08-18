/**
 * Edikit — Cast Load Socket Client (C5-09 item 1)
 * -------------------------------------------------
 * Real socket.io-client asosida ishlaydigan synthetic participant.
 *
 * - Sessiyaga join qiladi (cast:join)
 * - Savol ochilishini kutyapti (cast:questionOpened)
 * - Javob yuboradi (cast:answerSubmit) va ACK latency o'lchaydi
 * - ACK loss / retry / timeout'ni qayd qiladi (ground truth)
 *
 * Bitta client = bitta virtual participant. Generator ularni masshtablab
 * ochadi (S..XXL tier). Hech qanday haqiqiy PII/answer-key kiritilmaydi.
 *
 * @example
 *   const bot = new CastLoadClient({ baseUrl, sessionId, joinCode, name });
 *   await bot.connect();
 *   await bot.waitQuestionOpened(15000);
 *   const ack = await bot.submitAnswer(questionId, [optionId], attemptNo);
 *   await bot.disconnect();
 */

import { io } from 'socket.io-client';

let nextId = 1;

export class CastLoadClient {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl — http://host:port
   * @param {string} opts.sessionId
   * @param {string} opts.joinCode
   * @param {string} [opts.name]
   * @param {object} [opts.metrics] — shared metrics sink (arrays of {t0,t1,ok,err})
   */
  constructor(opts) {
    this.baseUrl = opts.baseUrl;
    this.sessionId = opts.sessionId;
    this.joinCode = opts.joinCode;
    this.name = opts.name || `bot_${nextId++}`;
    this.participantId = null;
    this.metrics = opts.metrics || { acks: [], joins: [], answers: [], errors: [] };
    this.cookie = opts.cookie || null; // director socket uchun session cookie
    this._sock = null;
    this._ackWaiters = new Map(); // commandId -> {resolve, reject, timer, t0}
    this._openedWaiters = [];
  }

  get connected() {
    return !!this._sock && this._sock.connected;
  }

  async connect(timeoutMs = 10000) {
    const extra = {};
    // Cookie faqat polling transport'da yuboriladi (websocket handshake'da emas) —
    // birinchi transport polling qilib qo'yiladi (cast-synthetic-monitor bilan bir xil yondash).
    if (this.cookie) extra.extraHeaders = { Cookie: this.cookie };
    this._sock = io(this.baseUrl, {
      transports: ['polling', 'websocket'],
      reconnection: false,
      timeout: timeoutMs,
      ...extra,
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.name}: connect timeout`)), timeoutMs);
      this._sock.once('connect', () => { clearTimeout(timer); resolve(); });
      this._sock.once('connect_error', (e) => { clearTimeout(timer); reject(new Error(`${this.name}: connect_error ${e && e.message}`)); });
    });
    // Ack + event handlerlar
    this._sock.on('cast:ack', (ack) => this._onAck(ack));
    this._sock.on('cast:questionOpened', (ev) => {
      for (const w of this._openedWaiters.splice(0)) w(ev);
    });
    return this;
  }

  /**
   * Join session (lobby). Return joinAck yoki xato.
   */
  async join(timeoutMs = 10000) {
    const ack = await this._send('cast:join', {
      sessionId: this.sessionId,
      payload: {
        joinCode: this.joinCode,
        displayName: this.name,
        avatarId: 'load',
        delivery: 'remote',
      },
    }, timeoutMs);
    if (ack.ok) this.participantId = ack.participantId || null;
    return ack;
  }

  /**
   * Savol ochilishini kutadi. Payload'dan question + option id'larni qaytaradi.
   */
  async waitQuestionOpened(timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this._openedWaiters.indexOf(onEv);
        if (i >= 0) this._openedWaiters.splice(i, 1);
        reject(new Error(`${this.name}: questionOpened timeout`));
      }, timeoutMs);
      const onEv = (ev) => {
        clearTimeout(timer);
        const q = ev && ev.question;
        if (!q || !q.questionId || !Array.isArray(q.options) || q.options.length === 0) {
          return reject(new Error(`${this.name}: opened event malformed`));
        }
        resolve(q);
      };
      this._openedWaiters.push(onEv);
    });
  }

  /**
   * Javob yuborish — ACK latency + loss o'lchaydi.
   * @returns {Promise<{ok:boolean, latencyMs:number, ack:object}>}
   */
  async submitAnswer(questionId, selectedOptionIds, attemptNo = 1, timeoutMs = 10000) {
    const t0 = Date.now();
    const commandId = `load_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      const ack = await this._send('cast:answerSubmit', {
        sessionId: this.sessionId,
        commandId,
        payload: { questionId, selectedOptionIds, attemptNo },
      }, timeoutMs);
      const latencyMs = Date.now() - t0;
      this.metrics.acks.push({ t0, latencyMs, ok: !!ack.ok, command: 'answerSubmit' });
      this.metrics.answers.push({ t0, latencyMs, ok: !!ack.ok });
      return { ok: !!ack.ok, latencyMs, ack };
    } catch (err) {
      const latencyMs = Date.now() - t0;
      this.metrics.acks.push({ t0, latencyMs, ok: false, err: err.message });
      this.metrics.errors.push({ t0, kind: 'answerSubmit', err: err.message });
      throw err;
    }
  }

  /** Director: join (faqat owner/co_host — session cookie bilan). */
  async directorJoin(timeoutMs = 10000) {
    const ack = await this._send('cast:directorJoin', { sessionId: this.sessionId, payload: {} }, timeoutMs);
    if (ack.ok) this.directorJoined = true;
    return ack;
  }

  /** Director: savol ochish (faqat host uchun). */
  async questionOpen(timeoutMs = 10000) {
    return this._send('cast:questionOpen', { sessionId: this.sessionId, payload: {} }, timeoutMs);
  }

  /** Director: savol yopish. */
  async questionClose(timeoutMs = 10000) {
    return this._send('cast:questionClose', { sessionId: this.sessionId, payload: {} }, timeoutMs);
  }

  /** Director: reveal. */
  async questionReveal(timeoutMs = 10000) {
    return this._send('cast:questionReveal', { sessionId: this.sessionId, payload: {} }, timeoutMs);
  }

  /** Director: sessiya start (lobby yopiladi). */
  async sessionStart(timeoutMs = 10000) {
    return this._send('cast:sessionStart', { sessionId: this.sessionId, payload: {} }, timeoutMs);
  }

  async disconnect() {
    if (this._sock) {
      this._sock.removeAllListeners();
      this._sock.close();
      this._sock = null;
    }
  }

  // ── Internal: envelope yuborish + ack kutish ──
  _send(event, payload, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (!this._sock || !this._sock.connected) {
        return reject(new Error(`${this.name}: socket not connected for ${event}`));
      }
      const commandId = payload.commandId || `${event}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const envelope = {
        type: event,
        sessionId: payload.sessionId,
        commandId,
        payload: payload.payload || {},
        sentAtClient: Date.now(),
      };
      const timer = setTimeout(() => {
        this._ackWaiters.delete(commandId);
        reject(new Error(`${this.name}: ack timeout for ${event} (${timeoutMs}ms)`));
      }, timeoutMs);
      this._ackWaiters.set(commandId, {
        resolve,
        reject,
        timer,
        t0: Date.now(),
        event,
      });
      try {
        this._sock.emit(event, envelope, (ack) => {
          // Socket.io ack callback (server ackSend) — uni ham qabul qilamiz
          const w = this._ackWaiters.get(commandId);
          if (w) {
            clearTimeout(w.timer);
            this._ackWaiters.delete(commandId);
            w.resolve(ack || { ok: false });
          }
        });
      } catch (err) {
        clearTimeout(timer);
        this._ackWaiters.delete(commandId);
        reject(err);
      }
    });
  }

  _onAck(ack) {
    if (!ack || !ack.commandId) return;
    const w = this._ackWaiters.get(ack.commandId);
    if (!w) return;
    clearTimeout(w.timer);
    this._ackWaiters.delete(ack.commandId);
    w.resolve(ack);
  }
}

/**
 * Metrics agregatsiyasi (item 17 — ground truth).
 */
export function summarizeMetrics(metrics, totalExpected) {
  const acks = metrics.acks;
  const latencies = acks.filter((a) => a.ok).map((a) => a.latencyMs).sort((a, b) => a - b);
  const okCount = acks.filter((a) => a.ok).length;
  const pct = (p) => {
    if (latencies.length === 0) return 0;
    const idx = Math.min(latencies.length - 1, Math.ceil((p / 100) * latencies.length) - 1);
    return latencies[Math.max(0, idx)];
  };
  const accepted = metrics.answers.filter((a) => a.ok).length;
  return {
    totalCommands: acks.length,
    okCount,
    lost: acks.length - okCount,
    acceptedAnswers: accepted,
    expectedAnswers: totalExpected,
    acceptedLoss: Math.max(0, totalExpected - accepted),
    latency: {
      p50: pct(50),
      p95: pct(95),
      p99: pct(99),
      max: latencies.length ? latencies[latencies.length - 1] : 0,
    },
    errorCount: metrics.errors.length,
  };
}
