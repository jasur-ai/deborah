/**
 * Deborah — Cast Field Pilot Metrics (T-06)
 * ----------------------------------------
 * Admin `/api/cast/telemetry` dan pilot metrikalarini yig'adi va
 * signed field report uchun jadval chiqaradi:
 *   setup time, join completion, ACK success, coverage, recovery,
 *   unplanned stop, ACK p95, teacher load (feedback input).
 *
 * Ishlatish:
 *   node scripts/cast-pilot-metrics.js --base http://localhost:3457
 *   node scripts/cast-pilot-metrics.js --base URL --user admin --pass X --tier F2 --eligible 28
 *
 * Kerakli env (agar flag berilmasa):
 *   CAST_PILOT_BASE     (default http://localhost:3457)
 *   CAST_PILOT_USER     (default admin)
 *   CAST_PILOT_PASS     (default admin)
 *   CAST_PILOT_TIER     (default F0)
 *   CAST_PILOT_ELIGIBLE (sinfdagi haqiqiy o'quvchi soni — join completion uchun)
 *
 * Eslatma: `connections` counter'ga director+projector socket'lari ham kiradi,
 * shuning uchun join completion `connections` asosida hisoblanmaydi — teacher
 * `--eligible N` bilan haqiqiy ro'yxat sonini berishi kerak. Berilmasa metrika
 * manual deb ko'rsatiladi (stopwatch kabi runbook'da qayd etiladi).
 */

/* eslint-disable no-console */

// .env dan ADMIN creds o'qiymiz (agar dotenv mavjud bo'lsa)
try {
  const { config } = await import('dotenv');
  config();
} catch (_) { /* dotenv yo'q — env'lar allaqachon set qilingan */ }

const BASE = process.env.CAST_PILOT_BASE || 'http://localhost:3457';
const USER = process.env.CAST_PILOT_USER || process.env.ADMIN_USER || 'admin';
const PASS = process.env.CAST_PILOT_PASS || process.env.ADMIN_PASS || 'admin';
const TIER = process.env.CAST_PILOT_TIER || 'F0';
const ELIGIBLE = Number(process.env.CAST_PILOT_ELIGIBLE) || 0;

// ── CLI flag'lar (--key value) ──
const argv = process.argv.slice(2);
function flag(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}
const base = flag('base', BASE);
const user = flag('user', USER);
const pass = flag('pass', PASS);
const tier = flag('tier', TIER);
const eligible = Number(flag('eligible', ELIGIBLE)) || 0;

// ── Mini cookie jar ──
const cookieJar = {};

function storeCookies(res) {
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of setCookie) {
    const [pair] = c.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) cookieJar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
}

function cookieHeader() {
  return Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function fetchJson(path, opts = {}) {
  const res = await fetch(`${base}${path}`, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      cookie: cookieHeader(),
    },
  });
  storeCookies(res);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// ── Login (GET cookie+CSRF → POST form-urlencoded) ──
function csrfFrom(html) {
  const m = String(html).match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}

async function rawFetch(path, opts = {}) {
  return fetch(`${base}${path}`, {
    ...opts,
    headers: { ...(opts.headers || {}), cookie: cookieHeader() },
  });
}

async function login() {
  // 1) GET /admin/login — SET-COOKIE'ni saqlaymiz (CSRF session'ga bog'langan)
  const loginPageRes = await rawFetch('/admin/login');
  storeCookies(loginPageRes);
  const loginPage = await loginPageRes.text();
  const loginCsrf = csrfFrom(loginPage);
  if (!loginCsrf) throw new Error('admin-login-csrf not found in page');

  // 2) POST /admin/login — session.regenerate() yangi cookie + CSRF beradi
  const loginRes = await rawFetch('/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: user, password: pass, _csrf: loginCsrf }),
    redirect: 'manual',
  });
  storeCookies(loginRes);
  if (![200, 302].includes(loginRes.status)) {
    throw new Error(`Admin login fail (${loginRes.status})`);
  }
  console.log(`✅ Admin login OK (${user})`);
}

// ── Tier target ──
function tierTargets(t) {
  const map = {
    F0: { setupS: 60, ackP95: 800 },
    F1: { setupS: 90, ackP95: 800 },
    F2: { setupS: 120, ackP95: 1000 },
    F3: { setupS: 180, ackP95: 1500 },
    F4: { setupS: 240, ackP95: 2000 },
    F5: { setupS: 300, ackP95: 2500 },
    F6: { setupS: 360, ackP95: 3000 },
  };
  return map[t] || map.F0;
}

// ── Metrics ──
function pct(a, b) {
  if (!b) return null;
  return Math.round((a / b) * 1000) / 10;
}

async function collect() {
  await login();
  const { status, body } = await fetchJson('/api/cast/telemetry');
  if (status !== 200) {
    throw new Error(`Telemetry fail (${status}): ${JSON.stringify(body).slice(0, 120)}`);
  }

  const counters = body.counters || {};
  const ack = body.ack || {};
  // join completion: faqat teacher bergan `--eligible` bilan hisoblanadi.
  // (connections counter'da director+projector ham bor — formula soxta bo'lardi)
  const joinCompletion = eligible > 0 ? pct(counters.joins, eligible) : null;
  const ackSuccess = pct(counters.acks - counters.ackErrors, counters.acks);
  // coverage = o'rtacha har bir joined o'quvchiga to'g'ri keladigan ACK'lar
  // (engagement proxy — barcha ACK turlari: answer+join+state+host)
  // DIQQAT: acks barcha turlarni sanagani uchun 100% oshib ketadi — bu
  // pass/fail emas, faqat ma'lumot. Aniq answer coverage uchun kelajakda
  // alohida `answers` counter kerak (hozir METRIC_COUNTERS'da yo'q).
  const coverage = pct(counters.acks, counters.joins);
  const recovery = pct(counters.recoverySuccess, counters.recovery);
  const answerP95 = ack.answer?.p95 ?? null;

  const t = tierTargets(tier);

  const rows = [
    ['Setup time', '— (manual, stopwatch)', `<${t.setupS}s`, 'manual'],
    ['Join completion', joinCompletion === null ? `— (--eligible N)` : `${joinCompletion}%`, '≥95%', joinCompletion === null ? '—' : (joinCompletion >= 95 ? '✅' : '❌')],
    ['ACK success', ackSuccess === null ? '—' : `${ackSuccess}%`, '≥98%', ackSuccess === null ? '—' : (ackSuccess >= 98 ? '✅' : '❌')],
    ['Coverage (proxy)', coverage === null ? '—' : `${coverage}%`, 'info', coverage === null ? '—' : 'ℹ️ (barcha ACK turlari)'],
    ['Recovery', recovery === null ? '—' : `${recovery}%`, '≥95%', recovery === null ? '—' : (recovery >= 95 ? '✅' : '❌')],
    ['ACK p95 (answer)', answerP95 === null ? '—' : `${answerP95}ms`, `<${t.ackP95}ms`, answerP95 === null ? '—' : (answerP95 < t.ackP95 ? '✅' : '❌')],
    ['Unplanned stop', '— (manual)', '0', 'manual'],
  ];

  console.log('\n' + '═'.repeat(58));
  console.log(`   🎓 Cast Field Pilot Metrics — Tier ${tier}`);
  console.log(`   ${new Date().toISOString()}`);
  console.log('═'.repeat(58));
  console.log('│ Metrika'.padEnd(26) + '│ Qiymat'.padEnd(14) + '│ Maqsad'.padEnd(12) + '│ Holat │');
  console.log('├'.padEnd(1) + '─'.repeat(57));
  for (const [name, value, target, status2] of rows) {
    console.log('│ ' + name.padEnd(24) + '│ ' + String(value).padEnd(12) + '│ ' + target.padEnd(10) + '│ ' + String(status2).padEnd(5) + '│');
  }
  console.log('═'.repeat(58));
  console.log('Counters raw: ' + JSON.stringify(counters));
  console.log('Gauges: ' + JSON.stringify(body.gauges || {}));

  // Stop signal
  const sev0 = [];
  if (ackSuccess !== null && ackSuccess < 98) sev0.push('ACK success < 98% (accepted-answer loss xavfi)');
  if (recovery !== null && recovery < 95) sev0.push('Recovery < 95%');
  if (sev0.length) {
    console.log('\n🚨 SEV-0 SIGNAL: ' + sev0.join('; ') + ' — sessionni to\'xtatish kerak!');
    process.exit(1);
  }
  console.log('\n✅ SEV-0 signal yo\'q. Signed field report bilan keyingi tierga o\'tish mumkin.');
}

collect().catch((err) => {
  console.error('❌ Pilot metrics fail:', err.message);
  process.exit(1);
});
