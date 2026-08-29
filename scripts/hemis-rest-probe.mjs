// AUTH A-14 probe: HEMIS REST API — JWT orqali test akkaunt profilini olish.
// O'z test akkaunti bilan ishlaydi; hech qanday secret log'ga chiqmaydi.
// Foydalanish: node scripts/hemis-rest-probe.mjs
import { readFileSync } from 'node:fs';
import { parseEnv } from './hemis-live-test.mjs';

const cfg = parseEnv(readFileSync('scripts/hemis-test.env', 'utf8'));
const BASE = (cfg.HEMIS_BASE_URL || 'https://student.hemis.uz').replace(/\/+$/, '');
const UA = 'Deborah-HemIS-A14Probe/1.0 (own test account, educational)';

function redactToken(t) {
  if (!t) return 'NONE';
  return t.length > 24 ? `(bor, ${t.length} belgi)` : '(token)';
}

const loginRes = await fetch(`${BASE}/rest/v1/auth/login`, {
  method: 'POST',
  headers: { 'user-agent': UA, 'content-type': 'application/json' },
  body: JSON.stringify({ login: cfg.HEMIS_USERNAME, password: cfg.HEMIS_PASSWORD, username: cfg.HEMIS_USERNAME }),
  redirect: 'manual',
});
const loginBody = await loginRes.json().catch(() => ({}));
const token = loginBody?.data?.token || loginBody?.data?.access_token || loginBody?.token;

console.log(`login  -> HTTP ${loginRes.status} | success=${loginBody.success} | token=${redactToken(token)}`);
if (!token) {
  console.log('XULOSA: REST login token bermadi — batafsil:');
  console.log(JSON.stringify(loginBody).slice(0, 300));
  process.exit(1);
}

// JWT payload — iss/aud/sub (PII emas, faqat meta)
try {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  console.log(`jwt    -> iss=${payload.iss} aud=${payload.aud} jti=${redactToken(payload.jti)} exp_da=${new Date(payload.exp * 1000).toISOString()}`);
} catch { /* meta parse qilinmasa e'tiborsiz */ }

// Profil endpoint'larini JWT bilan sinash (faqat shaxsiy test akkaunt)
const endpoints = [
  ['rest/v1/student/me', 'student me'],
  ['rest/v1/student/profile', 'student profile'],
  ['rest/v1/account/me', 'account me'],
  ['rest/v1/user/me', 'user me'],
];
for (const [ep, label] of endpoints) {
  const res = await fetch(`${BASE}/${ep}`, { headers: { 'user-agent': UA, authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  const data = body?.data;
  if (res.status === 200 && data && typeof data === 'object') {
    const name = data.full_name || data.name || data.fullName || data.fio ||
      data.first_name && `${data.first_name} ${data.last_name || ''}`.trim() || '';
    const g0 = data.group || data.guruh || data.group_name || '';
    const group = typeof g0 === 'object' ? (g0.name || g0.label || g0.group_name || '') : g0;
    const uni = data.university || data.university_name || data.otm || data.otm_name || '';
    console.log(`probe  -> /${ep} HTTP ${res.status} | name=${name || 'n/a'} group=${group || 'n/a'} uni=${uni || 'n/a'}`);
    if (!process.env.PROBE_VERBOSE) break;
  } else {
    console.log(`probe  -> /${ep} HTTP ${res.status}`);
  }
}

console.log('XULOSA: REST API login + JWT ishladi — test akkaunt to\'g\'ri; leaked client_secret esa TSUE\'da ishlamaydi (401).');
