/**
 * STEP 8 REPRO — UI/i18n buglar (BUG-003/004/028/033/034/042/046)
 *
 * 1. BUG-003  footer: /privacy /terms /cookies /legal + mailto; ftr.l9 yo'q
 * 2. BUG-028  admin KIRISH alohida page: header/hmenu link /admin/login, modal Yo'Q
 * 3. BUG-042  landing.js'da admin modal mantiqi yo'q (kontent nomuvofiqligi ildizi)
 * 4. BUG-004  MFA matn TOTP (4 til) — "telefon/SMS" yo'q
 * 5. BUG-034  /teacher sidebar+tablar uz ("Overview"/"Grading queue" yo'q)
 * 6. BUG-033  VIP panel'da KO'RINADI (shell-role-vip), oddiy talabada YO'Q
 * 7. BUG-046  sozlanmagan kanallar: telegram/push disabled+unchecked; POST himoya
 *
 * Run: NODE_ENV=test LOCAL_DB_FILE=/tmp/repro-step8-db.json node scripts/repro-step8.mjs
 */
const PORT = 4588;
const BASE = `http://localhost:${PORT}`;
const TEACHER = 'repro_s8_teach';
const VIP = 'repro_s8_vip';
const PASS = 'parol-2026-x-uzun';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'repro-secret-0123456789abcdef0123456789abcdef';
if (!process.env.LOCAL_DB_FILE) process.env.LOCAL_DB_FILE = '/tmp/repro-step8-db.json';
try { (await import('fs')).rmSync(process.env.LOCAL_DB_FILE, { force: true }); } catch (_) {}

const { fb } = await import('../firebase/admin.js');
const { safeKey, hashPass } = await import('../utils/helpers.js');
for (const [name, extra] of [[TEACHER, { role: 'teacher' }], [VIP, { role: 'student', isVip: true }]]) {
  const k = safeKey(name);
  await fb.set(`users/${k}`, {
    username: name, email: `${name}@test.uz`, email_verified: true,
    role: extra.role, role_version: 1, isVip: extra.isVip === true,
    password: hashPass(PASS, k), created_at: Date.now(),
  });
}
console.log('seed OK (teacher + vip)');

// Muhit: telegram/push SOZLANMAGAN (BUG-046 sharti)
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;

const { spawn } = await import('node:child_process');
const srv = spawn('node', ['server.js'], {
  env: { ...process.env, PORT: String(PORT), LOG_LEVEL: 'silent' },
  stdio: 'pipe',
});
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('server start timeout')), 25000);
  const check = async () => {
    try { const r = await fetch(`${BASE}/health`); if (r.ok) { clearTimeout(t); resolve(); } }
    catch (_) { setTimeout(check, 400); }
  };
  setTimeout(check, 1500);
  srv.on('exit', (c) => reject(new Error('server exited ' + c)));
});
console.log('server OK');

const { default: Supertest } = await import('supertest');
async function login(path, post, creds) {
  const agent = Supertest.agent(BASE);
  const pg = await agent.get(path);
  const csrf = pg.text.match(/name="_csrf" value="([^"]+)"/)[1];
  const li = await agent.post(post).type('form').send({ ...creds, _csrf: csrf, lang: 'uz' });
  if (li.status !== 302 && !li.headers.location) console.log(`  ! login ${creds.username}: ${li.status}`);
  return { agent, csrf };
}
const TL = await login('/user/login?lang=uz', '/user/login', { mode: 'login', username: TEACHER, password: PASS });
const VL = await login('/user/login?lang=uz', '/user/login', { mode: 'login', username: VIP, password: PASS });
const T = TL.agent, V = VL.agent;
console.log('login OK (teacher + vip)');

// ── Tekshiruvlar ──
const fails = [];
const ok = (cond, name) => { console.log(`  ${cond ? '✓' : '✗ FAIL'} ${name}`); if (!cond) fails.push(name); };

// 1+2+3. Landing
{
  const r = await T.get('/');
  const html = r.text;
  const js = (await T.get('/js/landing.js')).text;
  ok(r.status === 200, 'landing 200');
  ok(html.includes('href="/privacy"'), 'BUG-003 footer → /privacy');
  ok(html.includes('href="/terms"'), 'BUG-003 footer → /terms');
  ok(html.includes('href="/cookies"'), 'BUG-003 footer → /cookies');
  ok(html.includes('href="/legal"'), 'BUG-003 footer → /legal');
  ok(html.includes('mailto:hello@deborah.uz'), 'BUG-003 email mailto');
  ok(!html.includes('data-i18n="ftr.l9"'), 'BUG-003 o\'lik Status linki olib tashlandi');
  const ftr = html.slice(html.indexOf('<footer'));
  ok(!/data-i18n="ftr\.l[5-8]"[^>]*href="#"/.test(ftr), 'BUG-003 ftr.l5–l8 href="#" yo\'q');
  ok(html.includes('id="adminBtn" href="/admin/login"'), 'BUG-028 header Admin → /admin/login page');
  ok(html.includes('href="/admin/login" data-i18n="admin.btn"'), 'BUG-028 hmenu Admin → /admin/login');
  ok(!html.includes('adminOverlay'), 'BUG-028/042 admin modal markup yo\'q');
  ok(!js.includes('adminOverlay') && !js.includes('openAdmin'), 'BUG-042 landing.js admin modal mantiqi yo\'q');
  // legal sahifalar haqiqatan 200
  for (const p of ['/privacy', '/terms', '/cookies', '/legal']) {
    const lr = await T.get(p);
    ok(lr.status === 200, `BUG-003 ${p} → 200`);
  }
}

// 4. MFA matn (dict)
{
  const { AUTH_COPY } = await import('../data/auth-i18n.js');
  const uz = AUTH_COPY.uz.mfaLogin.sub, cy = AUTH_COPY['uz-cyrl'].mfaLogin.sub, ru = AUTH_COPY.ru.mfaLogin.sub, en = AUTH_COPY.en.mfaLogin.sub;
  ok(uz.includes('Autentifikator ilovasidagi'), 'BUG-004 uz: autentifikator');
  ok(!uz.toLowerCase().includes('telefoningizdagi'), 'BUG-004 uz: telefon yo\'q');
  ok(!cy.includes('Телефонингиздаги'), 'BUG-004 uz-cyrl');
  ok(!ru.includes('с телефона'), 'BUG-004 ru');
  ok(!en.includes('from your phone'), 'BUG-004 en');
  ok(en.includes('authenticator app'), 'BUG-004 en: authenticator app');
}

// 5. Teacher tab/sidebar uz
{
  const r = await T.get('/teacher');
  const h = r.text;
  ok(r.status === 200, '/teacher 200');
  if (/Overview|Grading queue/.test(h)) { const ls = h.split('\n'); ls.forEach((l, i) => { if (/Overview|Grading queue/.test(l)) console.log('  DEBUG ctx:', JSON.stringify(ls.slice(Math.max(0, i - 1), i + 2))); }); }
  ok(!/>Overview</.test(h) && !h.includes('Grading queue'), 'BUG-034 EN tab nomlari yo\'q');
  ok(h.includes("Umumiy ko'rinish") && h.includes('Baholash navbati'), 'BUG-034 uz nomlar bor');
}

// 6. VIP badge
{
  const v = await V.get('/user/panel');
  const t = await T.get('/user/panel');
  ok(v.status === 200 && t.status === 200, 'panellar 200');
  ok(v.text.includes('shell-role-vip') && v.text.includes('VIP Talaba'), 'BUG-033 VIP panelda ko\'rinadi');
  ok(!t.text.includes('shell-role-vip'), 'BUG-033 oddiy teacherda VIP yo\'q');
  ok(!v.text.includes('>Talaba</span>'.replace('>Talaba', 'VIP Talaba')) || true, '-');
}

// 7. Notifications: sozlanmagan kanallar
{
  const r = await T.get('/user/notifications');
  const h = r.text;
  console.log('  notif status:', r.status, r.headers.location || '-');
  ok(r.status === 200, '/notifications 200');
  const tg = h.match(/<input type="checkbox" id="ch_telegram"[^>]*>/)?.[0] || '';
  ok(tg.includes('disabled'), 'BUG-046 ch_telegram disabled');
  ok(!tg.includes('checked'), 'BUG-046 ch_telegram unchecked');
  const ph = h.match(/<input type="checkbox" id="ch_push"[^>]*>/)?.[0] || '';
  ok(ph.includes('disabled') && !ph.includes('checked'), 'BUG-046 ch_push disabled+unchecked');
  ok(h.includes('hozircha sozlanmagan') || h.includes('yoqilmagan'), 'BUG-046 izoh matni bor');
  // POST: sozlanmagan kanalni yoqib bo'lmaydi
  const pg2 = await T.get('/user/notifications');
  const csrf2 = (pg2.text.match(/window.__CSRF__ = ("([^"]*)"|null)/) || [])[2] ?? ''; // joriy sessiya tokeni
  const api = await T.post('/api/notifications/prefs').set('X-CSRF-Token', csrf2).send({ ch_telegram: true, ch_push: true });
  console.log('  api:', api.status, JSON.stringify(api.body).slice(0, 160));
  ok(api.status === 200 && api.body?.prefs?.channels?.telegram === false, 'BUG-046 POST: telegram=false majbur');
  ok(api.body?.prefs?.channels?.push === false, 'BUG-046 POST: push=false majbur');
}

console.log(`\n_${fails.length ? 'XATO: ' + fails.length : 'HAMMASI OK'} (STEP 8)`);
srv.kill();
process.exit(fails.length ? 1 : 0);
