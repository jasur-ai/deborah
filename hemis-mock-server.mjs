#!/usr/bin/env node
/**
 * Edikit — HEMIS MOCK OAUTH2 SERVER (lokal, xavfsiz, sizsiz)
 * ---------------------------------------------------------
 * GitHub'dagi haqiqiy javob tuzilishidan qurildi:
 *   - research_repos_deep.md 2.3 (student/employee real JSON)
 *   - homidjonov/hemis-oauth web/index.php (endpoint yo'llari)
 *   - fork Raxmatilla97 (client_id=8 pattern)
 *
 * Endpoint'lar (student.hemis.uz ga o'xshash):
 *   GET  /oauth/authorize?client_id&redirect_uri&response_type=code&state
 *   GET  /dashboard/login          (CSRF + cookie)
 *   POST /dashboard/login          (FormStudentLogin[login]/[password])
 *   GET  /oauth/access-token?code  (or POST form)
 *   GET  /oauth/api/user?fields    (Bearer token)
 *
 * Ishlatish:  node hemis-mock-server.mjs   (port 8090)
 * Test:       HEMIS_BASE_URL=http://localhost:8090 node hemis-live-test.mjs
 */
import http from 'node:http';

const PORT = process.env.PORT || 8090;
const MOCK_USER = { login: '999211100098', password: 'test' }; // mock credential (local)
const REDIRECT_OK = 'http://hemis-oauth-test.lc/index.php';

// ── Haqiqiy javob (student — research_repos 2.3 dan, PII o'chirilgan) ──
const REAL_STUDENT_USER = {
  id: 181,
  uuid: '197a0e1d-da1a-01e3-2cfd-df0840653980',
  student_id_number: '999211100098',
  type: 'student',
  roles: [],
  name: 'Talaba Test',
  login: '999211100098',
  email: '',
  phone: '',
  picture: 'https://univer.hemis.uz/static/crop/2/1/120_120_90_2170006031.jpg',
  firstname: 'TALABA',
  surname: 'TEST',
  patronymic: 'XXX',
  birth_date: '14-02-2022',
  university_id: 999,
  groups: [
    {
      id: 62,
      name: 'Y_D 01 gurux',
      curriculum: { id: 48, name: 'Yuridika oquv reja dars uchun' },
      education_lang: { code: 11, name: "O'zbek" },
      education_form: { code: 11, name: 'Kunduzgi' },
      education_type: { code: 11, name: 'Bakalavr' },
    },
  ],
  data: {
    first_name: 'TALABA', second_name: 'TEST', third_name: 'XXX',
    full_name: 'TEST TALABA XXX', short_name: 'TEST T. X.',
    student_id_number: '999211100098',
    image: 'https://univer.hemis.uz/static/crop/2/1/320_320_90_2170006031.jpg',
    birth_date: 1644796800, email: '', phone: '',
    gender: { code: 11, name: 'Erkak' },
    university: 'HEMIS axborot tizimi universiteti',
    specialty: { code: '60420100', name: 'Yurisprudensiya (faoliyat turlari bo\'yicha)' },
    studentStatus: { code: 14, name: 'Bitirgan' },
    educationForm: { code: 11, name: 'Kunduzgi' },
    educationType: { code: 11, name: 'Bakalavr' },
    paymentForm: { code: 11, name: 'Davlat granti' },
    group: { id: 62, name: 'Y_D 01 gurux', educationLang: { code: 11, name: "O'zbek" } },
    faculty: { id: 68, name: 'fakultet(yuridika dars uchun)', code: '999-117', structureType: { code: 11, name: 'Fakultet' } },
    educationLang: { code: 11, name: "O'zbek" },
    level: { code: 11, name: '1-kurs' },
    semester: { id: 325, code: 11, name: '1-semestr', current: '', education_year: { code: 2021, name: '2021-2022', current: '' } },
    address: 'KOGON SHAHRI', country: { code: 'UZ', name: "O'zbekiston" },
    province: { code: 1726, name: 'Toshkent shahri', _parent: 1726 },
    district: { code: 1726262, name: 'Uchtepa tumani', _parent: 1726 },
    socialCategory: { code: 10, name: 'Boshqa' },
    accommodation: { code: 15, name: 'Talabalar turar joyida' },
    hash: '31940425fa1c411af790b2ddb98985e294bab4f50091e2c8bff45e65ad3c572b',
  },
};

// ── Cookie/session (lokal) ──
const sessions = new Map(); // sid -> {loggedIn}

function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie || '';
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function setCookie(res, sid) {
  res.setHeader('Set-Cookie', `frontend=${sid}; Path=/; HttpOnly; SameSite=Lax`);
}

function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'content-type': 'application/json', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => resolve(d));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const cookies = parseCookies(req);
  const sid = cookies['frontend'] || `mock_${Math.random().toString(36).slice(2)}`;

  // ── GET /oauth/authorize ──
  if (path === '/oauth/authorize' && req.method === 'GET') {
    const cid = url.searchParams.get('client_id');
    if (!cid) return send(res, 400, { error: 'missing client_id' });
    // HEMIS pattern: client qabul → login'ga yo'naltirish
    res.writeHead(302, { location: `http://localhost:${PORT}/dashboard/login` });
    return res.end();
  }

  // ── GET /dashboard/login ──
  if (path === '/dashboard/login' && req.method === 'GET') {
    const html = `<html><body>
      <form method="POST">
        <input name="FormStudentLogin[login]" value=""><br>
        <input name="FormStudentLogin[password]" type="password" value=""><br>
        <input type="hidden" name="_csrf-frontend" value="MOCKCSRF123">
        <button>Login</button>
      </form></body></html>`;
    res.writeHead(200, { 'content-type': 'text/html', 'Set-Cookie': `frontend=${sid}; Path=/; HttpOnly` });
    return res.end(html);
  }

  // ── POST /dashboard/login ──
  if (path === '/dashboard/login' && req.method === 'POST') {
    const body = await readBody(req);
    const params = new URLSearchParams(body);
    const login = params.get('FormStudentLogin[login]');
    const pass = params.get('FormStudentLogin[password]');
    if (login === MOCK_USER.login && pass === MOCK_USER.password) {
      sessions.set(sid, { loggedIn: true });
      // success → callback URL'ga code bilan yo'naltirish (hemis-oauth-test.lc)
      const redirect = url.searchParams.get('redirect_uri') || REDIRECT_OK;
      res.writeHead(302, { location: `${redirect}?code=MOCKCODE_${sid}`, 'Set-Cookie': `frontend=${sid}; Path=/; HttpOnly` });
      return res.end();
    }
    // fail → login'ga qaytish (HEMIS pattern — xato xabar yo'q)
    res.writeHead(302, { location: '/dashboard/login', 'Set-Cookie': `frontend=${sid}; Path=/; HttpOnly` });
    return res.end();
  }

  // ── GET/POST /oauth/access-token ──
  if (path === '/oauth/access-token') {
    const body = req.method === 'POST' ? await readBody(req) : req.url.split('?')[1] || '';
    const params = new URLSearchParams(body);
    const code = params.get('code') || url.searchParams.get('code');
    if (!code || !code.startsWith('MOCKCODE_')) return send(res, 401, { error: 'invalid_grant' });
    return send(res, 200, {
      access_token: `mock_at_${code.slice(9)}`,
      refresh_token: `mock_rt_${code.slice(9)}`,
      expires_in: 3600,
      token_type: 'Bearer',
    });
  }

  // ── GET /oauth/api/user ──
  if (path === '/oauth/api/user') {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer mock_at_')) return send(res, 401, { error: 'invalid_token' });
    return send(res, 200, REAL_STUDENT_USER);
  }

  send(res, 404, { error: 'not_found' });
});

server.on('error', (e) => console.error('Mock server error:', e.message));

server.listen(PORT, () => {
  console.log(`✓ HEMIS Mock OAuth2 server ishlamoqda: http://localhost:${PORT}`);
  console.log(`  Mock login: ${MOCK_USER.login} / ${MOCK_USER.password} (lokal)`);
  console.log(`  Test: HEMIS_BASE_URL=http://localhost:${PORT} node hemis-live-test.mjs`);
});
