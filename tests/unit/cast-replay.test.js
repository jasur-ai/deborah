import { describe, it, expect } from 'vitest';
import {
  replaySessionState,
  replayTimeline,
  migrateEvents,
  latestEventSchemaVersion,
  EVENT_SCHEMA_MIGRATIONS,
  GOLDEN_FIXTURES,
  verifyAgainstGolden,
  projectTeacherReplay,
  projectReplayWall,
  projectStudentReplay,
  projectAuditReplay,
  projectWallContent,
  markDeletedQuestions,
  DELETED_CONTENT_MARKER,
  REPLAY_CAMERA_PERMISSION,
  sanitizeEventForLog,
} from '../../services/cast/replay-service.js';
import { WALL_MODERATION_STATE } from '../../services/cast/moderation-service.js';
import {
  createReflection,
  updateReflection,
  projectReflection,
  REFLECTION_FIELDS,
} from '../../services/cast/reflection-service.js';

function makeEvent(type, revision, payload = {}, serverAt = 1000 + revision * 100) {
  return { eventId: `evt_${revision}`, sessionId: 'cast_1', revision, type, serverAt, payload };
}

describe('C5-02: replaySessionState', () => {
  it('deterministic — bir xil eventlar bir xil state beradi', () => {
    const args = { primaryDirectorId: 'd', questionIds: ['q1'], questionCount: 1 };
    const events = [
      makeEvent('cast:sessionStarted', 1, { startedAt: 1100 }),
      makeEvent('cast:questionOpened', 2, { questionId: 'q1', closesAt: 2000 }),
      makeEvent('cast:sessionEnded', 3, { endedAt: 3000 }),
    ];
    const a = replaySessionState({ initialStateArgs: args, events });
    const b = replaySessionState({ initialStateArgs: args, events });
    expect(a.state.phase).toBe('ENDED');
    expect(a.state.endedAt).toBe(3000);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(a.finalRevision).toBe(3);
  });

  it('tartibsiz eventlar sort qilinadi', () => {
    const args = { primaryDirectorId: 'd', questionIds: ['q1'], questionCount: 1 };
    const events = [
      makeEvent('cast:questionOpened', 2, { questionId: 'q1' }),
      makeEvent('cast:sessionStarted', 1, { startedAt: 1100 }),
    ];
    const { state } = replaySessionState({ initialStateArgs: args, events });
    expect(state.questionId).toBe('q1');
    expect(state.phase).not.toBe('ENDED');
  });

  it('empty events — boshlang ich holat', () => {
    const args = { primaryDirectorId: 'd', questionIds: ['q1'], questionCount: 1 };
    const { state } = replaySessionState({ initialStateArgs: args, events: [] });
    expect(state.phase).toBe('LOBBY_OPEN');
  });
});

describe('C5-02: golden fixtures (item 9)', () => {
  it('barcha golden fixtures otadi', () => {
    for (const fixture of GOLDEN_FIXTURES) {
      const r = verifyAgainstGolden(fixture);
      expect(r.ok, `${fixture.name}: ${r.mismatch.join(', ')}`).toBe(true);
    }
  });

  it('fixtures deterministik — ikki marta bir xil natija', () => {
    const f = GOLDEN_FIXTURES[0];
    const a = verifyAgainstGolden(f);
    const b = verifyAgainstGolden(f);
    expect(JSON.stringify(a.actual)).toBe(JSON.stringify(b.actual));
  });
});

describe('C5-02: schema migration', () => {
  it('migrateEvents identity (hali migratsiyalar yo q)', () => {
    const events = [makeEvent('cast:sessionStarted', 1)];
    expect(migrateEvents(events)).toEqual(events);
  });

  it('registry latest version > 1', () => {
    expect(latestEventSchemaVersion()).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(EVENT_SCHEMA_MIGRATIONS)).toBe(true);
  });
});

describe('C5-02: replayTimeline', () => {
  it('har revision frame beradi', () => {
    const args = { primaryDirectorId: 'd', questionIds: ['q1'], questionCount: 1 };
    const events = [
      makeEvent('cast:sessionStarted', 1, { startedAt: 1100 }),
      makeEvent('cast:sessionEnded', 2, { endedAt: 2000 }),
    ];
    const frames = replayTimeline({ initialStateArgs: args, events });
    expect(frames.length).toBe(3); // initial + 2 event
    expect(frames[0].state.phase).toBe('LOBBY_OPEN');
    expect(frames[2].state.phase).toBe('ENDED');
  });
});

describe('C5-02: projectTeacherReplay', () => {
  it('timeline + actions + distributions + misconception markers', () => {
    const events = [
      makeEvent('cast:sessionStarted', 1),
      makeEvent('cast:questionOpened', 2, { questionId: 'q1' }),
      makeEvent('cast:discussionStarted', 3, { questionId: 'q1' }),
    ];
    const answersByQuestion = {
      q1: { p1: { isCorrect: true, selectedOptionIds: ['a'] }, p2: { isCorrect: false, selectedOptionIds: ['b'] } },
    };
    const misconceptions = { q1: { b: { misconceptionId: 'formula_mixup', confirmed: true, teacherExplanation: 'Izoh' } } };
    const t = projectTeacherReplay({ events, answersByQuestion, misconceptions, network: {} });
    expect(t.timeline).toHaveLength(3);
    expect(t.actions.some((a) => a.type === 'cast:discussionStarted')).toBe(true);
    expect(t.distributions[0].accepted).toBe(2);
    expect(t.misconceptionMarkers).toHaveLength(1);
    expect(t.cameraPermissionRequested).toBe(false);
  });

  it('raw payload timeline logda yoq', () => {
    const events = [makeEvent('cast:questionOpened', 1, { questionId: 'q1', secret: 'ANSWER_KEY' })];
    const t = projectTeacherReplay({ events });
    const tlJson = JSON.stringify(t.timeline);
    expect(tlJson).not.toContain('ANSWER_KEY');
  });
});

describe('C5-02: projectStudentReplay', () => {
  it('faqat own response + approved explanation; boshqa student YO Q', () => {
    const answersByQuestion = {
      q1: { p1: { isCorrect: true, selectedOptionIds: ['a'] }, p2: { isCorrect: false, selectedOptionIds: ['b'] } },
    };
    const misconceptions = { q1: { b: { confirmed: true, teacherExplanation: 'Izoh' } } };
    const r = projectStudentReplay({ participantId: 'p1', answersByQuestion, misconceptions, questions: { q1: { text: 'S?' } } });
    expect(r.items).toHaveLength(1);
    expect(JSON.stringify(r)).not.toContain('p2');
    expect(JSON.stringify(r)).not.toContain('rank');
    expect(r.privateScope).toBe(true);
  });

  it('approved explanation beriladi', () => {
    const answersByQuestion = { q1: { p1: { isCorrect: false, selectedOptionIds: ['b'] } } };
    const misconceptions = { q1: { b: { confirmed: true, teacherExplanation: 'Tushuntirish' } } };
    const r = projectStudentReplay({ participantId: 'p1', answersByQuestion, misconceptions, questions: {} });
    expect(r.items[0].approvedExplanation).toBe('Tushuntirish');
  });
});

describe('C5-02: projectAuditReplay', () => {
  it('PII-safe aggregate — faqat counts', () => {
    const events = [
      makeEvent('cast:sessionStarted', 1),
      makeEvent('cast:questionOpened', 2),
      makeEvent('cast:sessionEnded', 3),
    ];
    const a = projectAuditReplay({ events });
    expect(a.eventCount).toBe(3);
    expect(a.typeCounts['cast:sessionStarted']).toBe(1);
    expect(a.durationMs).toBeGreaterThan(0);
    expect(JSON.stringify(a)).not.toContain('participant');
  });
});

describe('C5-02: projectWallContent', () => {
  it('REDACTED → redactedText, WITHDRAWN → marker, RECEIVED → yashirin', () => {
    expect(projectWallContent({ moderationState: WALL_MODERATION_STATE.APPROVED, text: 'savol' }).show).toBe(true);
    const red = projectWallContent({ moderationState: WALL_MODERATION_STATE.REDACTED, redactedText: '***' });
    expect(red.show).toBe(true);
    expect(red.text).toBe('***');
    const wd = projectWallContent({ moderationState: WALL_MODERATION_STATE.WITHDRAWN });
    expect(wd.show).toBe(false);
    expect(wd.marker).toBeTruthy();
    const rec = projectWallContent({ moderationState: WALL_MODERATION_STATE.RECEIVED });
    expect(rec.show).toBe(false);
  });
});

describe('C5-02: projectReplayWall', () => {
  it('redacted/withdrawn/received projection', () => {
    const items = {
      w1: { contentId: 'w1', priority: 'LOW', submittedAt: 1, moderationState: WALL_MODERATION_STATE.APPROVED, text: 'savol' },
      w2: { contentId: 'w2', priority: 'LOW', moderationState: WALL_MODERATION_STATE.REDACTED, redactedText: '***' },
      w3: { contentId: 'w3', priority: 'HIGH', moderationState: WALL_MODERATION_STATE.WITHDRAWN },
      w4: { contentId: 'w4', priority: 'LOW', moderationState: WALL_MODERATION_STATE.RECEIVED, text: 'yashirin' },
    };
    const out = projectReplayWall(items);
    const byId = Object.fromEntries(out.map((x) => [x.contentId, x]));
    expect(byId.w1.show).toBe(true);
    expect(byId.w2.text).toBe('***');
    expect(byId.w3.show).toBe(false);
    expect(byId.w3.marker).toBeTruthy();
    expect(byId.w4.show).toBe(false);
    expect(JSON.stringify(out)).not.toContain('yashirin'); // RECEIVED raw yo'q
  });
});

describe('C5-02: markDeletedQuestions', () => {
  it('ochirilgan savol — marker, mavjud — normal', () => {
    const out = markDeletedQuestions({ answersByQuestion: { q1: {}, q2: {} }, existingQuestions: { q1: { text: 'x' } } });
    const q1 = out.find((x) => x.questionId === 'q1');
    const q2 = out.find((x) => x.questionId === 'q2');
    expect(q1.deleted).toBe(false);
    expect(q2.deleted).toBe(true);
    expect(q2.marker).toBe(DELETED_CONTENT_MARKER);
  });
});

describe('C5-02: no camera permission', () => {
  it('default replay camera/mic so ramaydi', () => {
    expect(REPLAY_CAMERA_PERMISSION.requested).toBe(false);
  });
});

describe('C5-02: reflection service', () => {
  it('createReflection — 5 field, sentToEvaluation false', () => {
    const r = createReflection({
      sessionId: 'cast_1',
      teacherId: 'user:t1',
      fields: { surpriseQuestion: 'A', nextLessonAction: 'B' },
    });
    expect(r.sentToEvaluation).toBe(false);
    expect(r.fields.surpriseQuestion).toBe('A');
    expect(REFLECTION_FIELDS).toHaveLength(5);
  });

  it('updateReflection — faqat berilgan fieldlar', () => {
    const r = createReflection({ sessionId: 'c', teacherId: 't', fields: { surpriseQuestion: 'A' } });
    const u = updateReflection(r, { fields: { itemToRevise: 'Q1' } });
    expect(u.fields.surpriseQuestion).toBe('A'); // eski saqlanadi
    expect(u.fields.itemToRevise).toBe('Q1');
    expect(u.sentToEvaluation).toBe(false);
  });

  it('too long throws REFLECTION_TOO_LONG (3 field x 2000 = limit)', () => {
    expect(() =>
      createReflection({
        sessionId: 'c',
        teacherId: 't',
        fields: { surpriseQuestion: 'x'.repeat(2000), evidenceChangedAfterAction: 'y'.repeat(2000), itemToRevise: 'z'.repeat(2000) },
      })
    ).toThrow('REFLECTION_TOO_LONG');
  });

  it('projectReflection — PII-safe, faqat fieldlar', () => {
    const r = createReflection({ sessionId: 'c', teacherId: 'user:t1', fields: { impact: 'x' } });
    const p = projectReflection(r);
    expect(p.teacherId).toBeUndefined(); // teacherId chiqmaydi
    expect(p.fields.impact).toBe('x');
  });
});

describe('C5-02: sanitizeEventForLog', () => {
  it('raw answer payloadlar filtrlanadi', () => {
    const safe = sanitizeEventForLog(makeEvent('cast:questionClosed', 1, { closesAt: 1, secretKey: 'XXX' }));
    expect(JSON.stringify(safe)).not.toContain('XXX');
    expect(safe.payload.closesAt).toBe(1);
  });

  it('nested object (poeFlow/contract) logga tushmaydi — scalar-only', () => {
    const safe = sanitizeEventForLog(makeEvent('cast:questionOpened', 1, { questionId: 'q1', poeFlow: { contract: { correct: 'B' } }, contract: { answer: 'X' } }));
    const str = JSON.stringify(safe);
    expect(str).not.toContain('correct');
    expect(str).not.toContain('answer');
    expect(str).not.toContain('contract');
    expect(str).not.toContain('poeFlow');
    expect(safe.payload.questionId).toBe('q1');
  });
});
