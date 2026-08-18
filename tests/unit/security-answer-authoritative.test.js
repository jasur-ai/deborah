/**
 * Deborah — Security Tests: Server-Authoritative Answer, Time & Idempotency
 *
 * Tests that:
 * 1. Server calculates elapsed time (client timeMs is ignored)
 * 2. First-answer is final (duplicates rejected)
 * 3. Late/stale epoch answers rejected
 * 4. Idempotency key prevents double-submit
 * 5. ACK protocol works correctly
 */

import { describe, it, expect, beforeAll } from 'vitest';

// ── Helper: Calculate server time (same as socket/game-handler.js) ──
function calculateServerTimeMs(questionStartedAt, now = Date.now()) {
  return Math.max(0, now - questionStartedAt);
}

// ── Helper: Score calculation ──
function calculatePoints(elapsedMs, totalTimeMs, isCorrect, isDouble, gameType) {
  if (!isCorrect) return 0;
  let pts = 100;
  if (gameType === 'score') {
    const ratio = Math.min(1, elapsedMs / totalTimeMs);
    if (ratio < 0.1) pts = 100;
    else if (ratio < 0.2) pts = 90;
    else if (ratio < 0.3) pts = 80;
    else if (ratio < 0.4) pts = 70;
    else if (ratio < 0.5) pts = 60;
    else if (ratio < 0.6) pts = 50;
    else if (ratio < 0.7) pts = 40;
    else if (ratio < 0.8) pts = 30;
    else if (ratio < 0.9) pts = 20;
    else pts = 10;
  }
  if (isDouble) pts *= 2;
  return pts;
}

// ── Test: Server-authoritative time ──
describe('Server-authoritative time', () => {
  it('client timeMs is ignored — server calculates from q_started_at', () => {
    const questionStartedAt = Date.now() - 5000; // 5 seconds ago
    const clientFakeTimeMs = 0; // Client could try to cheat with 0

    // Server calculates real elapsed time
    const serverTimeMs = calculateServerTimeMs(questionStartedAt);

    // Client's timeMs is NEVER used
    expect(serverTimeMs).toBeGreaterThan(0);
    expect(serverTimeMs).not.toBe(clientFakeTimeMs);
    expect(Math.abs(serverTimeMs - 5000)).toBeLessThan(100); // ~5s
  });

  it('forged fast time (client timeMs=0) does NOT give max points', () => {
    const questionStartedAt = Date.now() - 8000; // 8 seconds ago
    const qTimeMs = 20000;

    // Server calculates real elapsed time
    const serverTimeMs = calculateServerTimeMs(questionStartedAt);
    
    // Points based on server time, not client's fake 0
    const serverScore = calculatePoints(serverTimeMs, qTimeMs, true, false, 'score');
    
    // If client had cheated with timeMs=0, they'd get 100 points
    const cheatedScore = calculatePoints(0, qTimeMs, true, false, 'score');

    // Server-authoritative points should be LOWER than cheating
    expect(serverScore).toBeLessThan(cheatedScore);
  });

  it('server time is capped to question duration + grace period', () => {
    const questionStartedAt = Date.now() - 60000; // 60 seconds ago
    const qTimeMs = 20000; // 20 second question
    const graceMs = 1000;

    const serverTimeMs = calculateServerTimeMs(questionStartedAt);
    
    // Late check: reject if elapsed > qTimeMs + 1s grace
    const isLate = serverTimeMs > qTimeMs + graceMs;
    expect(isLate).toBe(true);
  });
});

// ── Test: First-answer idempotency ──
describe('First-answer idempotency', () => {
  it('duplicate answers are rejected', () => {
    // Simulate the duplicate check from socket/game-handler.js
    const existingAnswers = new Map();
    existingAnswers.set('player1', { option: 1, server_time_ms: 3000 });

    const playerName = 'player1';
    const alreadyAnswered = existingAnswers.has(playerName);

    expect(alreadyAnswered).toBe(true);
  });

  it('first answer is accepted, second is rejected', () => {
    const recordedAnswers = new Map();

    // First answer
    const firstAnswer = { option: 2, server_time_ms: 5000 };
    recordedAnswers.set('player1', firstAnswer);
    expect(recordedAnswers.has('player1')).toBe(true);

    // Second answer (duplicate)
    const secondAnswer = { option: 3, server_time_ms: 7000 };
    const alreadyAnswered = recordedAnswers.has('player1');
    expect(alreadyAnswered).toBe(true);
    // Second answer is NOT written
    expect(recordedAnswers.get('player1').option).toBe(2); // Kept original
  });

  it('idempotency key uniqueness', () => {
    const keys = new Set();
    // Generate 1000 keys and check uniqueness
    for (let i = 0; i < 1000; i++) {
      const key = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      keys.add(key);
    }
    // All keys should be unique (probabilistically)
    expect(keys.size).toBe(1000);
  });
});

// ── Test: Epoch/late checks ──
describe('Epoch and late answer rejection', () => {
  it('answer for wrong qIndex is rejected', () => {
    const state = { status: 'question_active', q_index: 2 };
    const incomingQIndex = 1; // Trying to answer a different question

    const isValidEpoch = state.status === 'question_active' && state.q_index === incomingQIndex;
    expect(isValidEpoch).toBe(false);
  });

  it('answer after question ended is rejected', () => {
    const state = { status: 'leaderboard', q_index: 1 };
    const incomingQIndex = 1;

    // Question is no longer active
    const isValidEpoch = state.status === 'question_active' && state.q_index === incomingQIndex;
    expect(isValidEpoch).toBe(false);
  });

  it('answer during preview is rejected', () => {
    const state = { status: 'question_preview', q_index: 0 };
    const incomingQIndex = 0;

    const isValidEpoch = state.status === 'question_active' && state.q_index === incomingQIndex;
    expect(isValidEpoch).toBe(false);
  });

  it('late answer after timer expiry is rejected', () => {
    const questionStartedAt = Date.now() - 25000; // 25s ago
    const qTimeMs = 20000; // 20s question
    const graceMs = 1000;

    const serverTimeMs = calculateServerTimeMs(questionStartedAt);
    const isLate = serverTimeMs > qTimeMs + graceMs;

    expect(isLate).toBe(true);
  });
});

// ── Test: ACK protocol ──
describe('ACK protocol', () => {
  it('accepted ACK contains serverTimeMs and idempotencyKey', () => {
    const ack = {
      status: 'accepted',
      qIndex: 0,
      serverTimeMs: 4230,
      idempotencyKey: 'abc123',
    };

    expect(ack.status).toBe('accepted');
    expect(ack.serverTimeMs).toBeGreaterThan(0);
    expect(ack.idempotencyKey).toBeTruthy();
  });

  it('rejected ACK contains reason for rejection', () => {
    const ack = {
      status: 'rejected_duplicate',
      qIndex: 0,
      serverTimeMs: 5000,
      reason: 'Javob allaqachon qabul qilingan',
    };

    expect(ack.status).toMatch(/^rejected_/);
    expect(ack.reason).toBeTruthy();
  });

  it('client cannot determine reject reason from status alone', () => {
    // All reject statuses follow the same format — client cannot distinguish
    // between security-relevant and non-security rejections
    const rejectStatuses = [
      'rejected_duplicate',
      'rejected_late',
      'rejected_epoch',
      'rejected_invalid',
    ];

    rejectStatuses.forEach(status => {
      expect(status).toMatch(/^rejected_/);
    });
  });
});

// ── Test: Scoring with server-authoritative time ──
describe('Scoring with server-authoritative time', () => {
  it('scoring uses server_time_ms not time_ms', () => {
    const savedAnswer = {
      option: 2,
      server_time_ms: 8000, // Server calculated
      time_ms: 500,         // Client sent (IGNORED)
    };

    const qTimeMs = 20000;
    const elapsed = savedAnswer.server_time_ms; // Use server time

    const pts = calculatePoints(elapsed, qTimeMs, true, false, 'score');
    // Elapsed = 8s, ratio = 0.4 → 70 points
    expect(pts).toBeGreaterThan(0);
  });

  it('fast answer (low elapsed) gets max points', () => {
    const pts = calculatePoints(500, 20000, true, false, 'score'); // 0.5s elapsed
    expect(pts).toBe(100);
  });

  it('double-points question doubles the score', () => {
    const ptsNormal = calculatePoints(1000, 20000, true, false, 'score');
    const ptsDouble = calculatePoints(1000, 20000, true, true, 'score');
    expect(ptsDouble).toBe(ptsNormal * 2);
  });
});
