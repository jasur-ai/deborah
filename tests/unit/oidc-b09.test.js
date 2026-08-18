/**
 * AUTH B-09/B-10 — Google ↔ password linking + setup kontrakti
 * ------------------------------------------------------------------
 *  findOrCreateUser status mashinasi (B-10):
 *    'login'  — mavjud google user yoki verified email → parol account LINK
 *    'setup'  — yangi verified user → account hali yaratilmaydi (rol modal)
 *    'blocked'— unverified / parolsiz / google_sub conflict → kirish YO'Q
 */

import { describe, it, expect, beforeAll } from 'vitest';

let oidc;
beforeAll(async () => {
  oidc = await import('../../src/modules/auth/oidc.js');
});

async function fbRef() {
  return (await import('../../firebase/admin.js')).fb;
}

async function safeKeyRef() {
  return (await import('../../utils/helpers.js')).safeKey;
}

describe('AUTH B-09/B-10 — Google ↔ password account linking', () => {
  it('B-10: yangi verified user → status setup, account yaratilmaydi, index yozilmaydi', async () => {
    const fb = await fbRef();
    const safeKey = await safeKeyRef();
    const stamp = Date.now() % 1000000;
    const email = `b10new-${stamp}@example.com`;
    const result = await oidc.findOrCreateUser({
      sub: `gsub-n-${stamp}`, email, emailVerified: true, name: 'New',
    });
    expect(result.status).toBe('setup');
    // Account HENUZ yo'q (setup POST'da yaratiladi)
    const userSnap = await fb.get(`users/${safeKey(`google:gsub-n-${stamp}`)}`);
    expect(userSnap.exists()).toBe(false);
    // Email index ham yozilmaydi (account yo'q)
    const idx = await fb.get(`users_email_index/${safeKey(email)}`);
    expect(idx.exists()).toBe(false);
  });

  it('B-10: yangi UNverified user → blocked (google_email_unverified)', async () => {
    const stamp = Date.now() % 1000000;
    const result = await oidc.findOrCreateUser({
      sub: `gsub-u-${stamp}`, email: `b10unv-${stamp}@example.com`,
      emailVerified: false, name: 'Unv',
    });
    expect(result.status).toBe('blocked');
    expect(result.error).toBe('google_email_unverified');
  });

  it('B-09 §08: verified email + parol account → LINK (status login)', async () => {
    const fb = await fbRef();
    const safeKey = await safeKeyRef();
    const stamp = Date.now() % 1000000;
    const email = `b09link-${stamp}@example.com`;
    const localKey = `b09local-${stamp}`;
    await fb.set(`users_email_index/${safeKey(email)}`, localKey);
    await fb.set(`users/${localKey}`, {
      username: `b09u${stamp}`, email, password: 'hashed-pass',
      created_at: Date.now(), safeKey: localKey,
    });

    const result = await oidc.findOrCreateUser({
      sub: `gsub-b09-${stamp}`, email, emailVerified: true, name: 'Linker',
    });
    expect(result.status).toBe('login');
    expect(result.user.safeKey).toBe(localKey);
    expect(result.user.linked).toBe(true);
    const after = await fb.get(`users/${localKey}`);
    expect(after.val().google_sub).toBe(`gsub-b09-${stamp}`);
    expect(after.val().auth_provider).toBe('password+google');
  });

  it('B-09 §09: unverified email → blocked (link yo\'q)', async () => {
    const fb = await fbRef();
    const safeKey = await safeKeyRef();
    const stamp = Date.now() % 1000000;
    const email = `b09unv-${stamp}@example.com`;
    const localKey = `b09unvlocal-${stamp}`;
    await fb.set(`users_email_index/${safeKey(email)}`, localKey);
    await fb.set(`users/${localKey}`, {
      username: `b09uv${stamp}`, email, password: 'hashed-pass',
      created_at: Date.now(), safeKey: localKey,
    });

    const result = await oidc.findOrCreateUser({
      sub: `gsub-b09u-${stamp}`, email, emailVerified: false, name: 'Unverified',
    });
    expect(result.status).toBe('blocked');
    const after = await fb.get(`users/${localKey}`);
    expect(after.val().google_sub).toBeUndefined();
  });

  it('B-09 §11: parolsiz account (Google-only) → blocked', async () => {
    const fb = await fbRef();
    const safeKey = await safeKeyRef();
    const stamp = Date.now() % 1000000;
    const email = `b09nopw-${stamp}@example.com`;
    const localKey = `b09nopwlocal-${stamp}`;
    await fb.set(`users_email_index/${safeKey(email)}`, localKey);
    await fb.set(`users/${localKey}`, {
      username: `b09np${stamp}`, email, email_verified: true,
      created_at: Date.now(), safeKey: localKey, // password yo'q
    });

    const result = await oidc.findOrCreateUser({
      sub: `gsub-b09n-${stamp}`, email, emailVerified: true, name: 'NoPw',
    });
    expect(result.status).toBe('blocked');
  });

  it('B-09 review fix: boshqa google_sub bog\'langan bo\'lsa → takeover blok', async () => {
    const fb = await fbRef();
    const safeKey = await safeKeyRef();
    const stamp = Date.now() % 1000000;
    const email = `b09conf-${stamp}@example.com`;
    const localKey = `b09conflocal-${stamp}`;
    await fb.set(`users_email_index/${safeKey(email)}`, localKey);
    await fb.set(`users/${localKey}`, {
      username: `b09cf${stamp}`, email, password: 'hashed-pass',
      google_sub: `gsub-owner-${stamp}`, // allaqachon boshqa Google'ga bog'langan
      created_at: Date.now(), safeKey: localKey,
    });

    const result = await oidc.findOrCreateUser({
      sub: `gsub-attacker-${stamp}`, email, emailVerified: true, name: 'Attacker',
    });
    expect(result.status).toBe('blocked'); // takeover blok
    const after = await fb.get(`users/${localKey}`);
    expect(after.val().google_sub).toBe(`gsub-owner-${stamp}`); // eski sub saqlanadi
  });

  it('B-09 §08: idempotent — ikkinchi chaqiruv yana LINK (status login)', async () => {
    const fb = await fbRef();
    const safeKey = await safeKeyRef();
    const stamp = Date.now() % 1000000;
    const email = `b09idem-${stamp}@example.com`;
    const localKey = `b09idemlocal-${stamp}`;
    await fb.set(`users_email_index/${safeKey(email)}`, localKey);
    await fb.set(`users/${localKey}`, {
      username: `b09id${stamp}`, email, password: 'hashed-pass',
      created_at: Date.now(), safeKey: localKey,
    });
    const gsub = `gsub-b09i-${stamp}`;

    const r1 = await oidc.findOrCreateUser({ sub: gsub, email, emailVerified: true, name: 'A' });
    const r2 = await oidc.findOrCreateUser({ sub: gsub, email, emailVerified: true, name: 'B' });
    expect(r1.status).toBe('login');
    expect(r2.status).toBe('login');
    expect(r1.user.safeKey).toBe(localKey);
    expect(r2.user.safeKey).toBe(localKey);
    const after = await fb.get(`users/${localKey}`);
    expect(after.val().google_sub).toBe(gsub);
  });

  it('B-10: mavjud google user → status login (isNew false)', async () => {
    const fb = await fbRef();
    const safeKey = await safeKeyRef();
    const stamp = Date.now() % 1000000;
    const sub = `gsub-existing-${stamp}`;
    const gKey = safeKey(`google:${sub}`);
    await fb.set(`users/${gKey}`, {
      username: `gex${stamp}`, email: `gex-${stamp}@example.com`,
      password: '', auth_provider: 'google', google_sub: sub,
      created_at: Date.now(), safeKey: gKey,
    });

    const result = await oidc.findOrCreateUser({
      sub, email: `gex-${stamp}@example.com`, emailVerified: true, name: 'Existing',
    });
    expect(result.status).toBe('login');
    expect(result.user.safeKey).toBe(gKey);
    expect(result.user.isNew).toBe(false);
  });
});
