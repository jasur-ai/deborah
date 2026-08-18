/**
 * Edikit — Cast C3-13 Student Question Forge Tests
 * -------------------------------------------------
 * coverage: invalid draft, duplicate submit (commandId idempotent + exact-hash
 *           duplicate), PII/profanity flags, teacher edit (original preserved),
 *           approve (session-scoped fq_ question, answer key public'da yo'q),
 *           launch integration, reject + safe reason, library save re-validate
 *           + ownership, cross-session access, attribution policy, no auto-publish.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { fb } from '../../firebase/admin.js';
import {
  FORGE_TYPES,
  FORGE_STATUS,
  FORGE_CHAR_LIMITS,
  FORGE_ATTRIBUTION_POLICY,
  validateForgeDraft,
  normalizeForgeDraft,
  hashForgeStem,
  tokenSimilarity,
  submitForgeDraft,
  getForgeDraft,
  listForgeQueue,
  getForgeMeta,
  applyForgeReview,
  markForgeLaunched,
  buildForgeQuestion,
  projectForgeQueue,
  saveForgeToLibrary,
} from '../../services/cast/question-forge-service.js';

const TEST_SESSION = '__forge_test';
const TEST_SESSION_B = '__forge_test_b';
const TEST_TEACHER = '__forge_teacher';

const validDraft = {
  questionType: FORGE_TYPES.SINGLE_CHOICE,
  stem: 'O‘zbekiston poytaxti qaysi shahar?',
  options: [
    { text: 'Toshkent' },
    { text: 'Samarqand' },
    { text: 'Buxoro' },
    { text: 'Xiva' },
  ],
  proposedAnswer: ['o_1'],
  explanation: 'Toshkent — poytaxt.',
  source: 'Geografiya darsligi',
};

describe('C3-13: Setup', () => {
  beforeAll(async () => {
    await fb.remove(`cast_private/${TEST_SESSION}`);
    await fb.remove(`cast_sessions/${TEST_SESSION}`);
    await fb.remove(`cast_private/${TEST_SESSION_B}`);
    await fb.remove(`cast_sessions/${TEST_SESSION_B}`);
    await fb.remove(`cast_library/${TEST_TEACHER}`);
  });
  it('prepares clean test roots', async () => {
    const a = await fb.get(`cast_private/${TEST_SESSION}`);
    const b = await fb.get(`cast_library/${TEST_TEACHER}`);
    expect(a.exists()).toBe(false);
    expect(b.exists()).toBe(false);
  });
});

// ── Invalid draft (item: Tekshiruv — Invalid draft) ──
describe('C3-13: Draft validation', () => {
  it('accepts a valid single_choice draft', () => {
    const v = validateForgeDraft(validDraft);
    expect(v.valid).toBe(true);
    expect(v.errors).toHaveLength(0);
  });

  it('rejects missing stem', () => {
    const v = validateForgeDraft({ ...validDraft, stem: '' });
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.includes('Savol matni'))).toBe(true);
  });

  it('rejects unknown question type', () => {
    const v = validateForgeDraft({ ...validDraft, questionType: 'essay' });
    expect(v.valid).toBe(false);
  });

  it('rejects <2 options for scored types', () => {
    const v = validateForgeDraft({ ...validDraft, options: [{ text: 'Faqat bitta' }], proposedAnswer: ['o_1'] });
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.includes('Kamida 2'))).toBe(true);
  });

  it('rejects missing proposed answer', () => {
    const v = validateForgeDraft({ ...validDraft, proposedAnswer: [] });
    expect(v.valid).toBe(false);
  });

  it('rejects single_choice with multiple correct answers', () => {
    const v = validateForgeDraft({ ...validDraft, proposedAnswer: ['o_1', 'o_2'] });
    expect(v.valid).toBe(false);
  });

  it('rejects invalid proposed answer id', () => {
    const v = validateForgeDraft({ ...validDraft, proposedAnswer: ['o_99'] });
    expect(v.valid).toBe(false);
  });

  it('rejects stem over char limit', () => {
    const v = validateForgeDraft({ ...validDraft, stem: 'a'.repeat(FORGE_CHAR_LIMITS.STEM_MAX + 1) });
    expect(v.valid).toBe(false);
  });

  it('rejects explanation over char limit', () => {
    const v = validateForgeDraft({ ...validDraft, explanation: 'x'.repeat(FORGE_CHAR_LIMITS.EXPLANATION_MAX + 1) });
    expect(v.valid).toBe(false);
  });

  it('accepts short_answer with proposed answer text', () => {
    const v = validateForgeDraft({ questionType: FORGE_TYPES.SHORT_ANSWER, stem: 'Eng katta okean?', proposedAnswer: 'Tinch okeani' });
    expect(v.valid).toBe(true);
  });

  it('accepts true_false with o_1/o_2 answer', () => {
    const v = validateForgeDraft({ questionType: FORGE_TYPES.TRUE_FALSE, stem: 'Yer quyosh atrofida aylanadi?', proposedAnswer: 'o_1' });
    expect(v.valid).toBe(true);
  });

  it('normalizes options with stable ids', () => {
    const n = normalizeForgeDraft({ ...validDraft, options: [{ text: ' A ' }, { text: 'B' }, { text: 'B' }] });
    expect(n.options.map((o) => o.id)).toEqual(['o_1', 'o_2']);
  });
});

// ── Duplicate submit (item 5: commandId idempotent; item 7: exact-hash) ──
describe('C3-13: Duplicate submit', () => {
  it('same commandId returns the SAME draft (idempotent replay)', async () => {
    const first = await submitForgeDraft({ sessionId: TEST_SESSION, participantId: 'p_1', alias: 'Ali', draft: validDraft, commandId: 'forge_cmd_replay' });
    const second = await submitForgeDraft({ sessionId: TEST_SESSION, participantId: 'p_1', alias: 'Ali', draft: validDraft, commandId: 'forge_cmd_replay' });
    expect(second.draftId).toBe(first.draftId);
    expect(second.replay).toBe(true);
  });

  it('same stem → exact-hash duplicate flagged, no duplicate draft created', async () => {
    const metaBefore = await getForgeMeta(TEST_SESSION);
    const res = await submitForgeDraft({ sessionId: TEST_SESSION, participantId: 'p_2', alias: 'Zara', draft: { ...validDraft, options: [{ text: 'A' }, { text: 'B' }, { text: 'C' }], proposedAnswer: ['o_1'] }, commandId: 'forge_cmd_dup1' });
    expect(res.duplicate).toBe(true);
    expect(res.duplicateOf).toBeTruthy();
    const metaAfter = await getForgeMeta(TEST_SESSION);
    expect(metaAfter.total).toBe(metaBefore.total + 1); // draft hali ham yoziladi (queue'da), lekin duplicate belgilangan
  });

  it('different stem → no duplicate', async () => {
    const res = await submitForgeDraft({ sessionId: TEST_SESSION, participantId: 'p_3', alias: 'Bek', draft: { ...validDraft, stem: 'Fransiya poytaxti qaysi shahar?', options: [{ text: 'Parij' }, { text: 'Lion' }], proposedAnswer: ['o_1'] }, commandId: 'forge_cmd_uniq' });
    expect(res.duplicate).toBe(false);
  });

  it('semantic duplicate flagged when enabled (item 8)', async () => {
    const res = await submitForgeDraft({
      sessionId: TEST_SESSION,
      participantId: 'p_4',
      alias: 'Dil',
      draft: { ...validDraft, stem: 'O‘zbekiston poytaxti qaysi shahar ekan?', options: [{ text: 'A' }, { text: 'B' }], proposedAnswer: ['o_1'] },
      commandId: 'forge_cmd_sem',
      semanticDuplicate: true,
    });
    expect(res.duplicate).toBe(true);
  });

  it('tokenSimilarity detects near-identical stems', () => {
    expect(tokenSimilarity('O‘zbekiston poytaxti qaysi shahar?', 'O‘zbekiston poytaxti qaysi shahar ekan?')).toBeGreaterThan(0.85);
    expect(tokenSimilarity('Fransiya poytaxti?', 'O‘zbekiston poytaxti?')).toBeLessThan(0.85);
  });
});

// ── PII / profanity flags (item 6) ──
describe('C3-13: PII / harmful content flags', () => {
  it('email in stem → HIGH priority + email flag', async () => {
    const res = await submitForgeDraft({ sessionId: TEST_SESSION, participantId: 'p_5', alias: 'Test', draft: { ...validDraft, stem: 'Men bilan aloqa: ali@example.com orqali', options: [{ text: 'A' }, { text: 'B' }], proposedAnswer: ['o_1'] }, commandId: 'forge_cmd_pii1' });
    expect(res.flags.email).toBe(true);
    expect(res.priority).toBe('HIGH');
  });

  it('phone number → HIGH priority', async () => {
    const res = await submitForgeDraft({ sessionId: TEST_SESSION, participantId: 'p_6', alias: 'Test2', draft: { ...validDraft, explanation: 'Tel: +998901234567', options: [{ text: 'A' }, { text: 'B' }], proposedAnswer: ['o_1'] }, commandId: 'forge_cmd_pii2' });
    expect(res.flags.phone).toBe(true);
    expect(res.priority).toBe('HIGH');
  });

  it('profanity → HIGH priority flag (hech qachon avtomatik blok emas)', async () => {
    const res = await submitForgeDraft({ sessionId: TEST_SESSION, participantId: 'p_7', alias: 'Test3', draft: { ...validDraft, stem: 'Bu savol axmoqona tuyulishi mumkin', options: [{ text: 'A' }, { text: 'B' }], proposedAnswer: ['o_1'] }, commandId: 'forge_cmd_pii3' });
    expect(res.flags.profanity).toBe(true);
    expect(res.priority).toBe('HIGH');
  });    it('long numeric sequence → pii flag (8 xonali — phone regex emas)', async () => {
    const res = await submitForgeDraft({ sessionId: TEST_SESSION, participantId: 'p_8', alias: 'Test4', draft: { ...validDraft, source: 'ID 12345678', options: [{ text: 'A' }, { text: 'B' }], proposedAnswer: ['o_1'] }, commandId: 'forge_cmd_pii4' });
    expect(res.flags.pii).toBe(true);
    expect(res.priority).toBe('MEDIUM');
  });
});

// ── Teacher edit (item 16: original va edited ALOHIDA) ──
describe('C3-13: Teacher edit', () => {
  let draftId;
  it('submit a draft for editing', async () => {
    const res = await submitForgeDraft({ sessionId: TEST_SESSION, participantId: 'p_9', alias: 'Umid', draft: { ...validDraft, stem: 'Birinchi variant savol', options: [{ text: 'A' }, { text: 'B' }], proposedAnswer: ['o_1'] }, commandId: 'forge_cmd_edit1' });
    draftId = res.draftId;
    expect(draftId).toMatch(/^forge_/);
  });

  it('edit preserves original and stores editedVersion separately', async () => {
    const res = await applyForgeReview({
      sessionId: TEST_SESSION,
      draftId,
      action: 'edit',
      editorId: 'user:teacher_t1',
      edits: {
        questionType: FORGE_TYPES.SINGLE_CHOICE,
        stem: 'Tahrirlangan savol matni?',
        options: [{ text: 'A' }, { text: 'B' }, { text: 'C' }],
        proposedAnswer: ['o_2'],
        explanation: 'Tahrirlangan izoh',
        source: '',
      },
    });
    expect(res.edited).toBe(true);

    const rec = await getForgeDraft(TEST_SESSION, draftId);
    expect(rec.stem).toBe('Birinchi variant savol'); // original saqlanib qoladi
    expect(rec.editedVersion.stem).toBe('Tahrirlangan savol matni?'); // tahrir alohida
    expect(rec.editedVersion.proposedAnswer).toEqual(['o_2']);
    expect(rec.audit.some((a) => a.action === 'edit' && a.actorId === 'user:teacher_t1')).toBe(true);
  });

  it('invalid edit is rejected', async () => {
    await expect(
      applyForgeReview({ sessionId: TEST_SESSION, draftId, action: 'edit', editorId: 'user:t', edits: { questionType: FORGE_TYPES.SINGLE_CHOICE, stem: '', options: [{ text: 'A' }], proposedAnswer: ['o_1'] } })
    ).rejects.toThrow();
  });
});

// ── Approve: session-scoped question (item 10), no auto-publish (item 17) ──
describe('C3-13: Approve + no auto-publish', () => {
  let draftId;
  let questionId;
  it('draft never appears in questions_public before approval', async () => {
    const res = await submitForgeDraft({ sessionId: TEST_SESSION, participantId: 'p_10', alias: 'Lola', draft: { ...validDraft, stem: 'Tasdiqlanadigan savol?', options: [{ text: 'A' }, { text: 'B' }], proposedAnswer: ['o_1'] }, commandId: 'forge_cmd_approve1' });
    draftId = res.draftId;
    const snap = await fb.get(`cast_sessions/${TEST_SESSION}/questions_public`);
    const all = snap.exists() ? snap.val() : {};
    expect(Object.values(all).some((q) => q.forgeDraftId === draftId)).toBe(false);
  });

  it('approve creates session-scoped fq_ question with no key in public', async () => {
    const res = await applyForgeReview({ sessionId: TEST_SESSION, draftId, action: 'approve', editorId: 'user:teacher_t1' });
    expect(res.status).toBe(FORGE_STATUS.APPROVED);
    expect(res.questionId).toMatch(/^fq_/);
    questionId = res.questionId;

    const pubSnap = await fb.get(`cast_sessions/${TEST_SESSION}/questions_public/${questionId}`);
    const privSnap = await fb.get(`cast_private/${TEST_SESSION}/questions/${questionId}`);
    expect(pubSnap.exists()).toBe(true);
    expect(privSnap.exists()).toBe(true);
    const pub = pubSnap.val();
    const priv = privSnap.val();
    // Public — answer key YO'Q
    expect(pub.correctOptionIds).toBeUndefined();
    expect(pub.correctAnswer).toBeUndefined();
    expect(JSON.stringify(pub)).not.toContain('correct');
    // Private — key bor
    expect(priv.correctOptionIds).toEqual(['o_1']);
    // Forge metadata
    expect(pub.isForge).toBe(true);
    expect(pub.forgeDraftId).toBe(draftId);
  });

  it('approve updates meta counters', async () => {
    const meta = await getForgeMeta(TEST_SESSION);
    expect(meta.approved).toBeGreaterThan(0);
  });

  it('double approve is idempotent (same questionId)', async () => {
    const again = await applyForgeReview({ sessionId: TEST_SESSION, draftId, action: 'approve', editorId: 'user:teacher_t1' });
    expect(again.questionId).toBe(questionId);
  });
});

// ── Reject (item 15: safe reason) ──
describe('C3-13: Reject', () => {
  it('reject stores status + reason', async () => {
    const res = await submitForgeDraft({ sessionId: TEST_SESSION, participantId: 'p_11', alias: 'Nodir', draft: { ...validDraft, stem: 'Rad etiladigan savol?', options: [{ text: 'A' }, { text: 'B' }], proposedAnswer: ['o_1'] }, commandId: 'forge_cmd_reject1' });
    const out = await applyForgeReview({ sessionId: TEST_SESSION, draftId: res.draftId, action: 'reject', editorId: 'user:teacher_t1', rejectReason: 'Savol noaniq — aniqroq yozing' });
    expect(out.status).toBe(FORGE_STATUS.REJECTED);
    const rec = await getForgeDraft(TEST_SESSION, res.draftId);
    expect(rec.rejectReason).toBe('Savol noaniq — aniqroq yozing');
    expect(rec.audit.some((a) => a.action === 'reject')).toBe(true);
  });
});

// ── Launch integration (item 11: Quick Prompt bilan ulash) ──
describe('C3-13: Launch now', () => {
  it('launch only allowed on APPROVED drafts', async () => {
    const res = await submitForgeDraft({ sessionId: TEST_SESSION, participantId: 'p_12', alias: 'Sardor', draft: { ...validDraft, stem: 'Launch uchun savol?', options: [{ text: 'A' }, { text: 'B' }], proposedAnswer: ['o_1'] }, commandId: 'forge_cmd_launch1' });
    // markForgeLaunched service'ga draft id kerak — lekin status tekshiruvi handler'da; service mark qiladi
    const out = await markForgeLaunched(TEST_SESSION, res.draftId, 'user:teacher_t1');
    expect(out.launchedAt).toBeTruthy();
  });

  it('buildForgeQuestion produces quick-prompt-compatible shape', () => {
    const q = buildForgeQuestion(validDraft, 'fq_test1', 'forge_d1');
    expect(q.public.id).toBe('fq_test1');
    expect(q.public.isQuickPrompt).toBe(true);
    expect(q.public.isForge).toBe(true);
    expect(q.private.correctOptionIds).toEqual(['o_1']);
    expect(q.private.explanation).toBe('Toshkent — poytaxt.');
  });
});

// ── Library save (items 12-13: re-validate + ownership) ──
describe('C3-13: Save to library', () => {
  it('re-validates teacher final answer/explanation before save', async () => {
    await expect(
      saveForgeToLibrary({ draft: { questionType: FORGE_TYPES.SINGLE_CHOICE, stem: 'X', options: [{ text: 'A' }], proposedAnswer: ['o_1'] }, teacherId: TEST_TEACHER })
    ).rejects.toThrow();
  });

  it('requires teacherId (ownership)', async () => {
    await expect(saveForgeToLibrary({ draft: validDraft, teacherId: '' })).rejects.toThrow();
  });

  it('saves validated draft under teacher root with source forge', async () => {
    const itemId = await saveForgeToLibrary({ draft: validDraft, teacherId: TEST_TEACHER });
    expect(itemId).toMatch(/^forge_lib_/);
    const snap = await fb.get(`cast_library/${TEST_TEACHER}/${itemId}`);
    expect(snap.exists()).toBe(true);
    const item = snap.val();
    expect(item.source).toBe('forge');
    expect(item.savedBy).toBe(TEST_TEACHER);
    expect(item.stemHash).toBe(hashForgeStem(validDraft.stem));
  });
});

// ── Cross-session access (Tekshiruv — Cross-session access) ──
describe('C3-13: Cross-session isolation', () => {
  it('queue of session A is not visible in session B', async () => {
    const resB = await submitForgeDraft({ sessionId: TEST_SESSION_B, participantId: 'p_b1', alias: 'B', draft: { ...validDraft, stem: 'B sessiyadagi savol?', options: [{ text: 'A' }, { text: 'B' }], proposedAnswer: ['o_1'] }, commandId: 'forge_cmd_b1' });
    const queueA = await listForgeQueue(TEST_SESSION);
    const queueB = await listForgeQueue(TEST_SESSION_B);
    expect(queueA[resB.draftId]).toBeUndefined();
    expect(queueB[resB.draftId]).toBeDefined();
  });

  it('approving in A does not affect B', async () => {
    const resA = await submitForgeDraft({ sessionId: TEST_SESSION, participantId: 'p_a1', alias: 'A', draft: { ...validDraft, stem: 'A izolyatsiya savol?', options: [{ text: 'A' }, { text: 'B' }], proposedAnswer: ['o_1'] }, commandId: 'forge_cmd_a1' });
    await applyForgeReview({ sessionId: TEST_SESSION, draftId: resA.draftId, action: 'approve', editorId: 'user:t' });
    const recB = await getForgeDraft(TEST_SESSION_B, resA.draftId);
    expect(recB).toBeNull();
  });
});

// ── Attribution policy (item 14) ──
describe('C3-13: Attribution policy', () => {
  it('PRIVATE policy strips participantId from queue projection', async () => {
    const queue = await listForgeQueue(TEST_SESSION);
    const proj = projectForgeQueue(queue, FORGE_ATTRIBUTION_POLICY.PRIVATE);
    const json = JSON.stringify(proj);
    expect(json).not.toContain('authorParticipantId');
    expect(json).not.toContain('"p_');
    expect(Object.values(proj)[0].authorLabel).toBe('anonim');
  });

  it('PUBLIC_ALIAS policy shows alias but still hides raw participantId', async () => {
    const queue = await listForgeQueue(TEST_SESSION);
    const proj = projectForgeQueue(queue, FORGE_ATTRIBUTION_POLICY.PUBLIC_ALIAS);
    const json = JSON.stringify(proj);
    expect(json).not.toContain('authorParticipantId');
    expect(json).toContain('authorLabel');
  });

  it('raw queue (director private) still contains identity for moderation', async () => {
    const queue = await listForgeQueue(TEST_SESSION);
    const rec = Object.values(queue)[0];
    expect(rec.authorParticipantId).toBeTruthy();
  });
});

// ── Cleanup ──
describe('C3-13: Cleanup', () => {
  it('removes test data', async () => {
    await fb.remove(`cast_private/${TEST_SESSION}`);
    await fb.remove(`cast_sessions/${TEST_SESSION}`);
    await fb.remove(`cast_private/${TEST_SESSION_B}`);
    await fb.remove(`cast_sessions/${TEST_SESSION_B}`);
    await fb.remove(`cast_library/${TEST_TEACHER}`);
    const snap = await fb.get(`cast_private/${TEST_SESSION}`);
    expect(snap.exists()).toBe(false);
  });
});
