/**
 * Deborah — Cast Security Test (T-04)
 * -----------------------------------
 * 16 item security scan. Real local-db adapter orqali:
 *   1. Answer-key scan (projections)
 *   2. Unauthorized role matrix
 *   3. CSRF validation
 *   4. Join-code brute-force rate limit
 *   5. Answer replay (first-wins immutability)
 *   6. Option ID manipulation
 *   7. Duplicate command
 *   8. Stale revision
 *   9. XSS nickname / open response
 *  10. Malicious SVG surface
 *  11. SSRF remote media surface
 *  12. Token query/referrer/log leak
 *  13. Projector privilege escalation
 *  14. Cross-tenant source/session access
 *  15. Log/support bundle secret scan
 *  16. Retention delete/restore
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSession, generateSessionId, generateJoinCode, putAnswerIfAbsent, upsertRole } from '../../services/cast/session-store.js';
import { initialState } from '../../services/cast/state-machine.js';
import { participantQuestionProjection, directorQuestionProjection, publicStateProjection, publicEvidenceProjection, revealProjection } from '../../services/cast/projections.js';
import { can, assertCan, ACTIONS, CAST_ROLES } from '../../services/cast/permissions.js';
import { sanitizeDisplayAlias, assertJoinCodeFormat } from '../../services/cast/join-service.js';
import { submitAnswer } from '../../services/cast/answer-service.js';
import { commitEvent } from '../../services/cast/event-store.js';
import { sanitizeLog, redactFreeText } from '../../services/cast/telemetry.js';
import { safeEventSummary } from '../../services/cast/support-bundle.js';
import { inspectSession, applyRetentionForSession, applyTombstonesOnRestore } from '../../services/cast/retention-job.js';
import { validateCsrf } from '../../middleware/error.js';
import { createEventRateLimiter } from '../../src/config/rate-limiter.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import fb from '../../firebase/admin.js';

const pubQ = [{ id: 'q_01', text: 'Savol', options: [{ id: 'o_a', text: 'A' }, { id: 'o_b', text: 'B' }, { id: 'o_c', text: 'C' }] }];
const privQ = [{ id: 'q_01', correctOptionIds: ['o_a'], options: [{ id: 'o_a' }, { id: 'o_b' }, { id: 'o_c' }] }];
const config = { scoring: { scorePolicy: 'accuracy' }, timer: { mode: 'off' } };

const adapter = {
  dbGet: (p) => fb.get(p),
  dbSet: (p, v) => fb.set(p, v),
  dbRemove: (p) => fb.remove(p),
  dbUpdate: (p, v) => fb.update(p, v),
};

beforeAll(async () => {
  snapshotDb();
});

afterAll(async () => {
  restoreDb();
});

async function makeSession() {
  const sessionId = generateSessionId();
  const joinCode = generateJoinCode();
  await createSession({
    sessionId,
    joinCode,
    meta: { title: 'Sec', tier: 'S' },
    config,
    state: initialState({ primaryDirectorId: 'user:dir', questionIds: pubQ.map((q) => q.id), questionCount: pubQ.length, choreography: null }),
    privateQuestions: privQ,
    publicQuestions: pubQ,
  });
  await upsertRole(sessionId, { actorId: 'user:dir', role: 'owner', assignedAt: Date.now(), assignedBy: 'user:dir' });
  return { sessionId, joinCode };
}

// ═══════════════════════════════════════════════════════════════
// Item 1: Answer-key scan — hech qaysi public projection'da
// correctOptionIds / explanation / rubric yo'q.
// ═══════════════════════════════════════════════════════════════
describe('T-04 item 1: answer-key leak scan (HTML/JS/Socket projections)', () => {
  const pubQ1 = { id: 'q1', type: 'mcq', text: 'T', options: [{ id: 'o1', text: 'A' }], isDouble: false };
  const privQ1 = { id: 'q1', correctOptionIds: ['o1'], explanation: 'chunki' };

  it('participantQuestionProjection — correctOptionIds/explanation YOQ', () => {
    const p = participantQuestionProjection(pubQ1, { phase: 'OPEN', revision: 1 });
    expect(p.correctOptionIds).toBeUndefined();
    expect(p.explanation).toBeUndefined();
    const json = JSON.stringify(p);
    expect(json).not.toContain('correctOptionIds');
    expect(json).not.toContain('chunki');
  });

  it('directorQuestionProjection — ataylab correct ids YOQ (director kanalida ham)', () => {
    const d = directorQuestionProjection(pubQ1, privQ1);
    expect(d.correctOptionIds).toBeUndefined();
    expect(d.hasExplanation).toBe(true); // faqat flag — qiymat emas
    expect(JSON.stringify(d)).not.toContain('chunki');
  });

  it('publicStateProjection — answer key/timer-leak YOQ', () => {
    const st = initialState({ primaryDirectorId: 'user:d', questionIds: ['q1'], questionCount: 1, choreography: null });
    const state = { ...st, questionId: 'q1', phase: 'QUESTION_OPEN', revision: 3, openedAt: 100, closesAt: 1000 };
    const pub = publicStateProjection(state);
    expect(pub.correctOptionIds).toBeUndefined();
    expect(JSON.stringify(pub)).not.toContain('correct');
  });

  it('publicEvidenceProjection — shaxsiy identity / correct-split YOQ', () => {
    const ev = { questionId: 'q1', accepted: 3, responseRate: 0.6, active: 3, eligible: 5, revision: 1, correct: 2, distribution: { o1: 2, o2: 1 } };
    const pub = publicEvidenceProjection(ev);
    expect(pub.correct).toBeUndefined();
    expect(pub.distribution).toBeUndefined();
    expect(pub.questionId).toBe('q1');
    expect(pub.accepted).toBe(3);
  });

  it('revealProjection — answer key FAQAT reveal paytida va policy-gated', () => {
    const r = revealProjection(privQ1, {});
    expect(r.correctOptionIds).toEqual(['o1']); // reveal — ruxsat etilgan
    expect(r.explanation).toBeUndefined(); // explanation policy bo'yicha
    const r2 = revealProjection(privQ1, { includeExplanation: true });
    expect(r2.explanation).toBe('chunki');
  });
});

// ═══════════════════════════════════════════════════════════════
// Item 2: Unauthorized role matrix — permission chegaralari.
// ═══════════════════════════════════════════════════════════════
describe('T-04 item 2: unauthorized role matrix', () => {
  it('participant (virtual rol) — faqat answer:submit + join', () => {
    expect(can('participant', ACTIONS.ANSWER_SUBMIT).allowed).toBe(true);
    expect(can('participant', ACTIONS.JOIN).allowed).toBe(true);
    expect(can('participant', ACTIONS.SESSION_START).allowed).toBe(false);
    expect(can('participant', ACTIONS.QUESTION_OPEN).allowed).toBe(false);
    expect(can('participant', ACTIONS.SESSION_END).allowed).toBe(false);
    expect(() => assertCan('participant', ACTIONS.SESSION_START)).toThrow();
  });

  it('projector_only — faqat projector:view', () => {
    expect(can(CAST_ROLES.PROJECTOR_ONLY, ACTIONS.PROJECTOR_VIEW).allowed).toBe(true);
    expect(can(CAST_ROLES.PROJECTOR_ONLY, ACTIONS.SESSION_START).allowed).toBe(false);
    expect(can(CAST_ROLES.PROJECTOR_ONLY, ACTIONS.ANSWER_SUBMIT).allowed).toBe(false);
  });

  it('moderator — moderate/remove, lekin session boshqaruvi YOQ', () => {
    expect(can(CAST_ROLES.MODERATOR, ACTIONS.MODERATE).allowed).toBe(true);
    expect(can(CAST_ROLES.MODERATOR, ACTIONS.SESSION_START).allowed).toBe(false);
    expect(can(CAST_ROLES.MODERATOR, ACTIONS.QUESTION_OPEN).allowed).toBe(false);
  });

  it('co_host — deyarli hamma, lekin quick_prompt/launch emas', () => {
    expect(can(CAST_ROLES.CO_HOST, ACTIONS.QUESTION_OPEN).allowed).toBe(true);
    expect(can(CAST_ROLES.CO_HOST, ACTIONS.SESSION_END).allowed).toBe(true);
    expect(can(CAST_ROLES.CO_HOST, ACTIONS.QUICK_PROMPT_LAUNCH).allowed).toBe(false);
  });

  it('owner — hamma action', () => {
    for (const action of Object.values(ACTIONS)) {
      expect(can(CAST_ROLES.OWNER, action).allowed).toBe(true);
    }
  });

  it('unknown role — hech narsa mumkin emas', () => {
    expect(can('hacker', ACTIONS.SESSION_START).allowed).toBe(false);
    expect(() => assertCan('hacker', ACTIONS.ANSWER_SUBMIT)).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════
// Item 3: CSRF — token'siz/noto'g'ri token POST 403.
// ═══════════════════════════════════════════════════════════════
describe('T-04 item 3: CSRF validation', () => {
  function mockRes() {
    const res = { statusCode: 0, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
  }

  it(`POST token'siz → 403`, () => {
    const req = { method: 'POST', body: {}, headers: {}, session: { csrfToken: 'abc' } };
    const res = mockRes();
    let nexted = false;
    validateCsrf(req, res, () => { nexted = true; });
    expect(res.statusCode).toBe(403);
    expect(nexted).toBe(false);
  });

  it(`POST noto'g'ri token → 403`, () => {
    const req = { method: 'POST', body: { _csrf: 'wrong' }, headers: {}, session: { csrfToken: 'abc' } };
    const res = mockRes();
    let nexted = false;
    validateCsrf(req, res, () => { nexted = true; });
    expect(res.statusCode).toBe(403);
  });

  it(`POST to'g'ri token (body _csrf) → next()`, () => {
    const req = { method: 'POST', body: { _csrf: 'abc' }, headers: {}, session: { csrfToken: 'abc' } };
    const res = mockRes();
    let nexted = false;
    validateCsrf(req, res, () => { nexted = true; });
    expect(nexted).toBe(true);
    expect(res.statusCode).toBe(0);
  });

  it(`POST to'g'ri token (x-csrf-token header) → next()`, () => {
    const req = { method: 'POST', body: {}, headers: { 'x-csrf-token': 'abc' }, session: { csrfToken: 'abc' } };
    const res = mockRes();
    let nexted = false;
    validateCsrf(req, res, () => { nexted = true; });
    expect(nexted).toBe(true);
  });

  it('GET — CSRF tekshirilmaydi (read-safe)', () => {
    const req = { method: 'GET', body: {}, headers: {}, session: {} };
    const res = mockRes();
    let nexted = false;
    validateCsrf(req, res, () => { nexted = true; });
    expect(nexted).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Item 4: Join-code brute-force — socket event rate limit.
// ═══════════════════════════════════════════════════════════════
describe('T-04 item 4: join-code brute-force rate limit', () => {
  it('player:checkCode — 30 ta ruxsat, 31-chi bloklanadi', () => {
    const counters = createEventRateLimiter();
    const c = counters['player:checkCode'];
    expect(c).toBeTruthy();
    for (let i = 0; i < 30; i++) {
      expect(c.check('ip-bruteforce').allowed).toBe(true);
    }
    expect(c.check('ip-bruteforce').allowed).toBe(false);
  });

  it('player:join — 10 ta ruxsat, 11-chi bloklanadi', () => {
    const counters = createEventRateLimiter();
    const c = counters['player:join'];
    for (let i = 0; i < 10; i++) {
      expect(c.check('ip-join').allowed).toBe(true);
    }
    expect(c.check('ip-join').allowed).toBe(false);
  });

  it(`boshqa IP — o'z limiti (izolyatsiya)`, () => {
    const counters = createEventRateLimiter();
    const c = counters['player:join'];
    for (let i = 0; i < 10; i++) c.check('ip-a').allowed;
    // ip-b hali toza
    expect(c.check('ip-b').allowed).toBe(true);
  });

  it('join code format — brute-force imkonsiz format tekshiruvi', () => {
    expect(() => assertJoinCodeFormat('<script>')).toThrow();
    expect(() => assertJoinCodeFormat('a'.repeat(100))).toThrow();
    expect(() => assertJoinCodeFormat('ab!cd')).toThrow();
    expect(assertJoinCodeFormat('ab12cd')).toBe('AB12CD');
  });
});

// ═══════════════════════════════════════════════════════════════
// Item 5: Answer replay — first-wins immutability: retry javobni
// hech qachon qayta yozmaydi, different commandId → duplicate rejected.
// ═══════════════════════════════════════════════════════════════
describe('T-04 item 5: answer replay (first-wins immutability)', () => {
  it(`same commandId retry — javob o'zgarmaydi (first-wins immutable)`, async () => {
    const { sessionId } = await makeSession();
    const rec = { participantId: 'p1', commandId: 'cmd-X', status: 'ACCEPTED', selectedOptionIds: ['o_a'], receivedAt: Date.now() };
    const first = await putAnswerIfAbsent({ sessionId, questionId: 'q_01', participantId: 'p1', attemptNo: 1, answerRecord: rec });
    expect(first.status).toBe('ACCEPTED');
    // Network retry — bir xil commandId
    await putAnswerIfAbsent({ sessionId, questionId: 'q_01', participantId: 'p1', attemptNo: 1, answerRecord: { ...rec, receivedAt: Date.now() } });
    // Javob o'zgarmagan (first-wins immutable) — retry hech qachon qayta yozmaydi
    const final = await fb.get(`cast_private/${sessionId}/answers/q_01/p1/1`);
    expect(final.val().selectedOptionIds).toEqual(['o_a']);
    expect(final.val().commandId).toBe('cmd-X');
  });

  it(`different commandId — duplicate rejected (javob qayta yozilmaydi)`, async () => {
    const { sessionId } = await makeSession();
    const rec = { participantId: 'p2', commandId: 'cmd-1', status: 'ACCEPTED', selectedOptionIds: ['o_a'], receivedAt: Date.now() };
    await putAnswerIfAbsent({ sessionId, questionId: 'q_01', participantId: 'p2', attemptNo: 1, answerRecord: rec });
    const dup = await putAnswerIfAbsent({
      sessionId, questionId: 'q_01', participantId: 'p2', attemptNo: 1,
      answerRecord: { participantId: 'p2', commandId: 'cmd-2', status: 'ACCEPTED', selectedOptionIds: ['o_b'], receivedAt: Date.now() },
    });
    expect(dup.status).toBe('ALREADY_ANSWERED');
  });
});

// ═══════════════════════════════════════════════════════════════
// Item 6: Option ID manipulation — noma'lum/noto'g'ri option
// INVALID_OPTION bilan rad etiladi (private validIds authoritative).
// ═══════════════════════════════════════════════════════════════
describe('T-04 item 6: option ID manipulation', () => {
  it(`noma'lum option id — INVALID_OPTION`, async () => {
    const { sessionId } = await makeSession();
    await expect(submitAnswer({
      sessionId, questionId: 'q_01', participantId: 'p1', commandId: 'c1',
      selectedOptionIds: ['o_hacked'], config,
    })).rejects.toMatchObject({ code: 'INVALID_OPTION' });
  });

  it(`takroriy option id — INVALID_OPTION`, async () => {
    const { sessionId } = await makeSession();
    await expect(submitAnswer({
      sessionId, questionId: 'q_01', participantId: 'p1', commandId: 'c2',
      selectedOptionIds: ['o_a', 'o_a'], config,
    })).rejects.toMatchObject({ code: 'INVALID_OPTION' });
  });

  it(`to'g'ri option — savol ochiq bo'lsa qabul qilinadi`, async () => {
    const { sessionId } = await makeSession();
    // Savolni ochamiz (phase check submitAnswer'da — QUESTION_OPEN bo'lishi shart)
    const st = initialState({ primaryDirectorId: 'user:dir', questionIds: ['q_01'], questionCount: 1, choreography: null });
    await commitEvent({
      sessionId,
      expectedRevision: null,
      event: { type: 'cast:questionOpened', payload: { questionId: 'q_01' }, serverAt: Date.now() },
      state: { ...st, phase: 'QUESTION_OPEN', questionId: 'q_01', questionPosition: 0, openedAt: Date.now() },
    });
    const r = await submitAnswer({
      sessionId, questionId: 'q_01', participantId: 'p1', commandId: 'c3',
      selectedOptionIds: ['o_a'], config,
    });
    expect(r.status).toBe('ACCEPTED');
  });
});

// ═══════════════════════════════════════════════════════════════
// Item 7: Duplicate command — signal dedupe + stale state guard.
// ═══════════════════════════════════════════════════════════════
describe('T-04 item 7: duplicate command', () => {
  it('bir xil event ikki marta commit qilinmaydi (revision guard)', async () => {
    const { sessionId } = await makeSession();
    const event = { type: 'cast:sessionStarted', payload: { startedAt: Date.now() }, serverAt: Date.now() };
    const state = initialState({ primaryDirectorId: 'user:dir', questionIds: ['q_01'], questionCount: 1, choreography: null });
    const res1 = await commitEvent({ sessionId, expectedRevision: null, event, state });
    // createSession allaqachon revision 1 yozgan — commit revision'ni oshiradi
    expect(res1.revision).toBeGreaterThan(0);
    // Eski (STALE) expectedRevision bilan qayta urinish — rad etiladi.
    // expectedRevision 0 falsy bo'lgani uchun curRev-1 dan eski qiymat beramiz.
    // (res1.revision > 0 assert qilingan — demak curRev-1 haqiqiy eski revision.)
    const staleRev = res1.revision - 1;
    expect(staleRev).toBeGreaterThan(0);
    await expect(commitEvent({ sessionId, expectedRevision: staleRev, event: { ...event, serverAt: Date.now() + 100 }, state })).rejects.toMatchObject({ code: 'STALE_REVISION' });
  });
});

// ═══════════════════════════════════════════════════════════════
// Item 8: Stale revision — eski expectedRevision commit rad etiladi.
// ═══════════════════════════════════════════════════════════════
describe('T-04 item 8: stale revision', () => {
  it(`eski expectedRevision bilan commit rad etiladi (STALE_REVISION)`, async () => {
    const { sessionId } = await makeSession();
    const st = initialState({ primaryDirectorId: 'user:dir', questionIds: ['q_01'], questionCount: 1, choreography: null });
    const r1 = await commitEvent({ sessionId, expectedRevision: null, event: { type: 'cast:sessionStarted', payload: {}, serverAt: Date.now() }, state: st });
    // Keyingi commit yangi expectedRevision bilan o'tadi
    const r2 = await commitEvent({ sessionId, expectedRevision: r1.revision, event: { type: 'cast:sessionStarted', payload: {}, serverAt: Date.now() + 10 }, state: st });
    expect(r2.revision).toBeGreaterThan(r1.revision);
    // Eski expectedRevision (r1) bilan — endi konflikt
    await expect(commitEvent({ sessionId, expectedRevision: r1.revision, event: { type: 'cast:sessionStarted', payload: {}, serverAt: Date.now() + 50 }, state: st })).rejects.toMatchObject({ code: 'STALE_REVISION' });
  });
});

// ═══════════════════════════════════════════════════════════════
// Item 9: XSS — nickname sanitizatsiyasi + free-text redaction.
// ═══════════════════════════════════════════════════════════════
describe('T-04 item 9: XSS nickname / open response', () => {
  it(`nickname <script> — rad etiladi`, () => {
    expect(() => sanitizeDisplayAlias('<script>alert(1)</script>')).toThrow();
    expect(() => sanitizeDisplayAlias('{onload=alert}')).toThrow();
    expect(() => sanitizeDisplayAlias('a>img')).toThrow();
  });

  it('nickname faqat invisible belgilar — rad etiladi', () => {
    expect(() => sanitizeDisplayAlias('\u200B\u200B')).toThrow(); // faqat ZWSP
    expect(() => sanitizeDisplayAlias('')).toThrow();
  });

  it('oddiy nickname — qabul qilinadi', () => {
    const r = sanitizeDisplayAlias('  Jasur  ');
    expect(r.displayAlias).toBe('Jasur');
  });

  it(`open response free-text — log'da redact qilinadi`, () => {
    const text = 'Menimcha javob A chunki <b>formula</b>';
    const red = redactFreeText(text);
    expect(red).toBeTruthy();
    expect(typeof red).toBe('string');
  });

  it(`redactFreeText — script tag raw log'ga kirmaydi`, () => {
    const red = redactFreeText('<script>alert(1)</script> xabar');
    expect(red).toMatch(/^\[REDACTED:/);
    expect(red).not.toContain('script');
  });
});

// ═══════════════════════════════════════════════════════════════
// Item 10/11: SVG / SSRF — attack surface tekshiruvi.
// Cast service kodida tashqi URL fetch qiluvchi media import YO'Q.
// ═══════════════════════════════════════════════════════════════
describe('T-04 item 10/11: SVG + SSRF remote media surface', () => {
  it(`cast service kodida outbound URL fetch (SSRF surface) yo'q`, () => {
    // Real check: cast service fayllarida user-supplied URL fetch qiladigan
    // import chaqiruvlari bo'lmasligi shart. Agar kelajakda media import
    // qo'shilsa — bu test FAIL qiladi va allowlist talab qilinadi.
    const sources = [
      'services/cast/projections.js',
      'services/cast/permissions.js',
      'services/cast/join-service.js',
      'services/cast/answer-service.js',
      'services/cast/telemetry.js',
      'services/cast/support-bundle.js',
      'services/cast/data-policy.js',
      'services/cast/retention-job.js',
    ];
    const blacklisted = ['fetch(', 'http.get', 'https.get', 'axios', 'node-fetch', 'require("http"', "require('http'", 'require("https"', "require('https'"];
    const { readFileSync, existsSync } = require('node:fs');
    for (const file of sources) {
      if (!existsSync(file)) continue;
      const content = readFileSync(file, 'utf8');
      for (const pattern of blacklisted) {
        // 'http.get' shakli endpoint URI'ga o'xshash emasligiga ishonch:
        // cast service'lar internal http client import qilmaydi.
        expect(content.includes(pattern)).toBe(false);
      }
    }
  });

  it(`SVG — cast service'lar media/upload mantiqini o'z ichiga olmaydi`, () => {
    const { readFileSync, existsSync } = require('node:fs');
    const files = ['services/cast/projections.js', 'services/cast/join-service.js', 'services/cast/answer-service.js'];
    for (const file of files) {
      if (!existsSync(file)) continue;
      const content = readFileSync(file, 'utf8');
      expect(content.includes('innerHTML')).toBe(false); // server-side raw HTML yo'q
      expect(content.includes('document.write')).toBe(false);
    }
    // Support bundle config hash bilan cheklangan — raw config yuklanmaydi
    const bundle = safeEventSummary([{ type: 'cast:questionOpened', revision: 1, at: 100, payload: { correctOptionIds: ['o_a'] } }]);
    expect(bundle[0].payload).toBeUndefined(); // payload hech qachon bundle'ga kirmaydi
    expect(JSON.stringify(bundle)).not.toContain('correctOptionIds');
  });
});

// ═══════════════════════════════════════════════════════════════
// Item 12: Token query/referrer/log leak — sanitizeLog redaction.
// ═══════════════════════════════════════════════════════════════
describe('T-04 item 12: token query/referrer/log leak', () => {
  it('sanitizeLog — token-like string redact qilinadi', () => {
    const out = sanitizeLog({ joinToken: 'eyJhbGciOiJIUzI1NiJ9.abc123def456', sessionId: 'cast_x' });
    expect(out.joinToken).toBe('[REDACTED]');
  });

  it('sanitizeLog — uzun string (raw content) redact qilinadi', () => {
    const out = sanitizeLog({ openResponse: 'a'.repeat(90) });
    expect(out.openResponse).toBe('[REDACTED]');
  });

  it('sanitizeLog — sensitive kalitlar redact (password/token/cookie)', () => {
    const out = sanitizeLog({ password: 'secret123', authToken: 'abc', safeField: 'ok' });
    expect(out.password).toBe('[REDACTED]');
    expect(out.authToken).toBe('[REDACTED]');
    expect(out.safeField).toBe('ok');
  });

  it('redactFreeText — moderator note raw emas', () => {
    const out = redactFreeText('token: eyJhbGciOiJIUzI1NiJ9.zzz.yyy');
    expect(out).not.toContain('eyJhbGci');
  });
});

// ═══════════════════════════════════════════════════════════════
// Item 13: Projector privilege escalation.
// ═══════════════════════════════════════════════════════════════
describe('T-04 item 13: projector privilege escalation', () => {
  it('projector_only rol faqat projector:view — boshqa hech narsa', () => {
    expect(can(CAST_ROLES.PROJECTOR_ONLY, ACTIONS.PROJECTOR_VIEW).allowed).toBe(true);
    const allActions = Object.values(ACTIONS).filter((a) => a !== ACTIONS.PROJECTOR_VIEW);
    for (const action of allActions) {
      expect(can(CAST_ROLES.PROJECTOR_ONLY, action).allowed).toBe(false);
    }
  });

  it('analyst_readonly — faqat analitika + projector', () => {
    expect(can(CAST_ROLES.ANALYST_READONLY, ACTIONS.ANALYZE).allowed).toBe(true);
    expect(can(CAST_ROLES.ANALYST_READONLY, ACTIONS.SESSION_START).allowed).toBe(false);
  });

  it(`participant projector'ga aylana olmaydi (virtual rol)`, () => {
    expect(can('participant', ACTIONS.PROJECTOR_VIEW).allowed).toBe(false);
    expect(can('participant', ACTIONS.MODERATE).allowed).toBe(false);
    expect(can('participant', ACTIONS.LEADERBOARD_SHOW).allowed).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// Item 14: Cross-tenant source/session access.
// ═══════════════════════════════════════════════════════════════
describe('T-04 item 14: cross-tenant source/session access', () => {
  it(`session'lar alohida key-space'da — boshqa session'ga idor yo'q`, async () => {
    const s1 = await makeSession();
    const s2 = await makeSession();
    expect(s1.sessionId).not.toBe(s2.sessionId);
    // s1 answer s2'ga oqib chiqmaydi (createSession har session'da answers:{} yaratadi —
    // konkret answer path'ini tekshiramiz)
    await putAnswerIfAbsent({ sessionId: s1.sessionId, questionId: 'q_01', participantId: 'p1', attemptNo: 1, answerRecord: { participantId: 'p1', commandId: 'c1', status: 'ACCEPTED', selectedOptionIds: ['o_a'], receivedAt: Date.now() } });
    const inS1 = await fb.get(`cast_private/${s1.sessionId}/answers/q_01/p1/1`);
    expect(inS1.exists()).toBe(true);
    const inS2 = await fb.get(`cast_private/${s2.sessionId}/answers/q_01/p1/1`);
    expect(inS2.exists()).toBe(false);
  });

  it(`join code session'ga biriktirilgan — boshqa session kod emas`, async () => {
    const { sessionId, joinCode } = await makeSession();
    const codeSnap = await fb.get(`cast_codes/${joinCode}`);
    expect(codeSnap.val().sessionId).toBe(sessionId);
  });
});

// ═══════════════════════════════════════════════════════════════
// Item 15: Log/support bundle secret scan.
// ═══════════════════════════════════════════════════════════════
describe('T-04 item 15: log/support bundle secret scan', () => {
  it('safeEventSummary — payload/option/raw YOQ, faqat summary', () => {
    const events = [
      { type: 'cast:answerSubmit', revision: 5, at: 100, payload: { selectedOptionIds: ['o_a'], participantId: 'p1' } },
      { type: 'cast:questionOpened', revision: 4, at: 90, summary: 'Savol ochildi' },
    ];
    const out = safeEventSummary(events);
    for (const ev of out) {
      expect(ev.payload).toBeUndefined();
      expect(ev.selectedOptionIds).toBeUndefined();
      expect(ev.participantId).toBeUndefined();
    }
    expect(out[0].type).toBe('cast:answersubmit');
  });

  it('sanitizeLog — support bundle audit raw secret saqlamaydi', () => {
    const log = sanitizeLog({ meta: { token: 'SECRET', apiKey: 'PRIVATE', email: 'a@b.c' } });
    expect(log.meta.token).toBe('[REDACTED]');
    expect(log.meta.apiKey).toBe('[REDACTED]');
    expect(log.meta.email).toBe('[REDACTED]');
  });
});

// ═══════════════════════════════════════════════════════════════
// Item 16: Retention delete/restore — tombstone restore-to'siq.
// ═══════════════════════════════════════════════════════════════
describe('T-04 item 16: retention delete/restore', () => {
  it(`expired session — answers delete + tombstone, restore'da tiklanmaydi`, async () => {
    const old = Date.now() - 400 * 24 * 3600 * 1000;
    const { sessionId } = await makeSession();
    await fb.update(`cast_sessions/${sessionId}/meta`, { created_at: old, ended_at: old + 1000 });
    await putAnswerIfAbsent({ sessionId, questionId: 'q_01', participantId: 'p1', attemptNo: 1, answerRecord: { participantId: 'p1', commandId: 'c1', status: 'ACCEPTED', selectedOptionIds: ['o_a'], receivedAt: Date.now() } });

    const res = await applyRetentionForSession(adapter, sessionId, { now: Date.now() });
    expect(res.deleted).toBeGreaterThan(0);
    expect(res.tombstoned).toBe(true);

    // Tombstone restore bloklaydi — ma'lumot qayta tiklanmaydi
    const ts = await applyTombstonesOnRestore(adapter, sessionId);
    expect(ts).toBeDefined();
    const snap = await fb.get(`cast_private/${sessionId}/answers`);
    expect(snap.exists()).toBe(false);
  });

  it('legal hold — delete bloklanadi', async () => {
    const old = Date.now() - 400 * 24 * 3600 * 1000;
    const { sessionId } = await makeSession();
    await fb.update(`cast_sessions/${sessionId}/meta`, { created_at: old, ended_at: old + 1000 });
    await fb.set(`cast_private/${sessionId}/governance/legal_holds`, [{ holdId: 'h', startedAt: Date.now() - 1000, until: Date.now() + 86400000 }]);
    const insp = await inspectSession(adapter, sessionId, { now: Date.now() });
    expect(insp.legalHold).toBe(true);
    expect(insp.expired.length).toBe(0);
  });
});
