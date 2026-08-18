import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkSignupVelocity,
  recordSignup,
  checkDomainReputation,
  recordDomainSignup,
  createSignupReview,
  listSignupReviews,
  resolveSignupReview,
  signupReviewDepth,
} from '../../src/modules/auth/bot-guard.js';
import { fb } from '../../firebase/admin.js';

// Har testdan oldin B-34 DB yozuvlarini tozalaymiz (per-invocation temp DB).
beforeEach(async () => {
  await fb.remove('signup_velocity').catch(() => {});
  await fb.remove('signup_domain_history').catch(() => {});
  await fb.remove('signup_reviews').catch(() => {});
});

describe('B-34 — signup velocity', () => {
  it('per-IP yumshoq: 15/soat, 16-chi blok (velocity_ip)', async () => {
    const ip = '10.0.0.77';
    for (let i = 0; i < 15; i += 1) {
      const r = await checkSignupVelocity({ ip });
      expect(r.allowed).toBe(true);
    }
    const blocked = await checkSignupVelocity({ ip });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe('velocity_ip');
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('per-fingerprint qattiq: 10/soat, 11-chi blok (velocity_fp)', async () => {
    const fp = 'a'.repeat(16); // 16 hex belgi — {16,64} talabiga mos
    for (let i = 0; i < 10; i += 1) {
      const r = await checkSignupVelocity({ ip: '10.0.0.9', fingerprint: fp });
      expect(r.allowed).toBe(true);
    }
    const blocked = await checkSignupVelocity({ ip: '10.0.0.9', fingerprint: fp });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe('velocity_fp');
  });

  it('turli IP/fingerprint alohida bucket — biri bloklansa ikkinchisi ishlaydi', async () => {
    const fpA = 'a'.repeat(16);
    for (let i = 0; i < 10; i += 1) {
      await checkSignupVelocity({ ip: '10.0.0.1', fingerprint: fpA });
    }
    expect((await checkSignupVelocity({ ip: '10.0.0.1', fingerprint: fpA })).allowed).toBe(false);
    // Boshqa fingerprint — hali yumshoq ishlaydi
    const fpB = 'b'.repeat(16);
    expect((await checkSignupVelocity({ ip: '10.0.0.1', fingerprint: fpB })).allowed).toBe(true);
  });

  it('noto\'g\'ri fingerprint (8 belgi) → null sifatida o\'tkazib yuboriladi (faqat IP)', async () => {
    const r = await checkSignupVelocity({ ip: '10.0.0.5', fingerprint: 'deadbeef' });
    expect(r.allowed).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(0);
  });

  it('recordSignup counter\'larni oshiradi — keyingi tekshiruv buni ko\'radi', async () => {
    const ip = '10.0.0.33';
    const fp = 'c'.repeat(16);
    await recordSignup({ ip, fingerprint: fp });
    await recordSignup({ ip, fingerprint: fp });
    // recordSignup faqat counter — 2 ta yozuv bor, velocity 15 dan kam
    const r = await checkSignupVelocity({ ip, fingerprint: fp });
    expect(r.allowed).toBe(true);
    // score ham hisoblanadi (2/15)
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(1);
  });
});

describe('B-34 — email domain reputation', () => {
  it('yangi domain → known:false; record\'dan keyin known:true', async () => {
    const d = 'brandnew-domain-xyz.uz';
    expect((await checkDomainReputation(d)).known).toBe(false);
    await recordDomainSignup(d);
    expect((await checkDomainReputation(d)).known).toBe(true);
    expect((await checkDomainReputation(d)).count).toBe(1);
  });

  it('domain yo\'q → doim known (fail-safe)', async () => {
    expect((await checkDomainReputation(null)).known).toBe(true);
    expect((await checkDomainReputation('')).known).toBe(true);
  });
});

describe('B-34 — signup review queue', () => {
  it('create → pending ro\'yxatda; approve → approved', async () => {
    const created = await createSignupReview({
      userId: 'u123', reason: 'velocity', score: 0.9,
      ipHash: 'a1b2c3', fingerprintHash: 'd'.repeat(16), domain: 'x.uz',
    });
    expect(created.ok).toBe(true);
    expect(created.id).toBeTruthy();

    const pending = await listSignupReviews({ status: 'pending' });
    expect(pending.length).toBe(1);
    expect(pending[0].userId).toBe('u123');
    expect(pending[0].status).toBe('pending');

    const r = await resolveSignupReview({ id: created.id, decision: 'approve', adminId: 'admin' });
    expect(r.ok).toBe(true);
    expect((await listSignupReviews({ status: 'approved' })).length).toBe(1);
    // User'ga blok flag YO'Q (approve)
    const u = await fb.get('users/u123');
    expect(u.exists() ? u.val().signup_review_blocked : undefined).toBeUndefined();
  });

  it('reject → user bloklanadi (signup_review_blocked flag)', async () => {
    const created = await createSignupReview({
      userId: 'u_rej', reason: 'domain', score: 0.5,
      ipHash: 'deadbeef', fingerprintHash: null, domain: 'spam.xyz',
    });
    const r = await resolveSignupReview({ id: created.id, decision: 'reject', adminId: 'admin' });
    expect(r.ok).toBe(true);
    const u = await fb.get('users/u_rej');
    expect(u.exists()).toBe(true);
    expect(u.val().signup_review_blocked.at).toBeGreaterThan(0);
    expect(u.val().signup_review_blocked.reason).toBe('domain');
  });

  it('not-found / not-pending → xato', async () => {
    const nf = await resolveSignupReview({ id: 'nope', decision: 'approve' });
    expect(nf.error).toBe('not-found');
    const created = await createSignupReview({ userId: 'u2', reason: 'velocity' });
    await resolveSignupReview({ id: created.id, decision: 'reject' });
    const again = await resolveSignupReview({ id: created.id, decision: 'approve' });
    expect(again.error).toBe('not-pending');
  });

  it('userId/reason majburiy — yuborilmasa ok:false (register buzilmaydi)', async () => {
    expect((await createSignupReview({ reason: 'velocity' })).ok).toBe(false);
    expect((await createSignupReview({ userId: 'u3' })).ok).toBe(false);
  });

  it('PII minimal — record\'da faqat hash\'lar, raw IP/device signal yo\'q', async () => {
    const created = await createSignupReview({
      userId: 'u4', reason: 'velocity', score: 0.8,
      ipHash: 'h-1a2b3c4d', fingerprintHash: 'e'.repeat(16), domain: 'x.uz',
    });
    const snap = await fb.get(`signup_reviews/${created.id}`);
    const rec = snap.val();
    expect(rec.ipHash).toBe('h-1a2b3c4d');
    expect(rec.fingerprintHash).toBe('e'.repeat(16));
    // Raw PII yo'q: userAgent/user-agent raw IP hech qayerda saqlanmasin
    const raw = JSON.stringify(rec);
    expect(raw).not.toContain('10.0.0.');
    expect(rec.status).toBe('pending');
  });

  it('signupReviewDepth — pending soni', async () => {
    await createSignupReview({ userId: 'u5', reason: 'velocity' });
    await createSignupReview({ userId: 'u6', reason: 'domain' });
    expect(await signupReviewDepth()).toBe(2);
    const pending = await listSignupReviews();
    await resolveSignupReview({ id: pending[0].id, decision: 'approve' });
    expect(await signupReviewDepth()).toBe(1);
  });
});
