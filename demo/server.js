/**
 * Deborah — Demo server (Node.js / Express)
 * ----------------------------------------
 * Faqat demo. GitHub/Render'ga tegishli emas.
 * Sahifalar: / (index), /cast, /dashboard (login talab), /user/login (POST).
 * Login — index.ejs'dagi mavjud auth forma orqali (user1).
 */
import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;

const app = express();

// EJS view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Body parser (login POST uchun)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Static: /public → demo/public
app.use(express.static(path.join(__dirname, 'public')));

// ── Demo user'lar (faqat demo — real loyihada Firebase) ──
const DEMO_USERS = {
  user1: {
    email: 'user1@gmail.com',
    password: '1234',
    name: 'User1',
    role: 'student',
    group: 'KIB-22-1',
    university: 'Toshkent Axborot Texnologiyalari Universiteti',
  },
};

// ── In-memory session (demo — restart'da tozalanadi) ──
const sessions = new Map(); // token -> username

function getUserFromReq(req) {
  const m = (req.headers.cookie || '').match(/demo_sid=([^;]+)/);
  if (!m) return null;
  const uname = sessions.get(m[1]);
  return uname ? DEMO_USERS[uname] : null;
}

// ── Index (landing) ──
app.get('/', (req, res) => {
  res.render('index', {
    title: 'Deborah — o\'qituvchilar uchun AI yordamchi',
    lang: 'uz',
    theme: 'dark',
  });
});

// ── Login POST — index.ejs'dagi fLogin formadan keladi ──
app.post('/user/login', (req, res) => {
  const email = String(req.body.email || req.body.username || '').trim().toLowerCase();
  const pass = String(req.body.password || '');

  const uname = email.split('@')[0].toLowerCase(); // user1@gmail.com → user1
  const u = DEMO_USERS[uname];
  const ok = u && (u.email.toLowerCase() === email || uname === email) && u.password === pass;

  if (!ok) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  const token = crypto.randomBytes(16).toString('hex');
  sessions.set(token, uname);
  res.setHeader('Set-Cookie', `demo_sid=${token}; Path=/; HttpOnly; SameSite=Lax`);
  return res.json({ ok: true, redirect: '/dashboard?curtain=1' });
});

// ── Logout ──
app.get('/user/logout', (req, res) => {
  const m = (req.headers.cookie || '').match(/demo_sid=([^;]+)/);
  if (m) sessions.delete(m[1]);
  res.setHeader('Set-Cookie', 'demo_sid=; Path=/; Max-Age=0');
  res.redirect('/');
});

// ── Dashboard (login talab; user1 bo'lmasa → /#auth) ──
app.get('/dashboard', (req, res) => {
  const user = getUserFromReq(req);
  if (!user) return res.redirect('/#auth');
  res.render('dashboard', {
    title: 'Deborah — Kabinet',
    lang: 'uz',
    theme: 'dark',
    user,
    // Parda faqat kirishdan keyin (action) — oddiy ochishda yo'q
    curtain: req.query.curtain === '1' ? '1' : '0',
  });
});

// ── Testlar ──
app.get('/tests', (req, res) => {
  const user = getUserFromReq(req);
  if (!user) return res.redirect('/#auth');
  res.render('tests', { title: 'Deborah — Testlar', lang: 'uz', theme: 'dark', user, curtain: '0' });
});

// ── Natijalar ──
app.get('/results', (req, res) => {
  const user = getUserFromReq(req);
  if (!user) return res.redirect('/#auth');
  res.render('results', { title: 'Deborah — Natijalar', lang: 'uz', theme: 'dark', user, curtain: '0' });
});

// ── Profil ──
app.get('/profile', (req, res) => {
  const user = getUserFromReq(req);
  if (!user) return res.redirect('/#auth');
  res.render('profile', { title: 'Deborah — Profil', lang: 'uz', theme: 'dark', user, curtain: '0' });
});

// ── Cast (savolni sinf ekraniga uzatish) ──
app.get('/cast', (req, res) => {
  res.render('cast', {
    title: 'Deborah — savolni sinf ekraniga uzatish',
    lang: 'uz',
    theme: 'dark',
  });
});

// ── Cast projector (sinf ekrani) ──
app.get('/cast/projector', (req, res) => {
  res.render('cast-projector', {
    title: 'Deborah — Cast proyektor',
    lang: 'uz',
    theme: 'dark',
  });
});

// 404
app.use((req, res) => {
  res.status(404).render('index', { title: '404', lang: 'uz', theme: 'dark' });
});

app.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║  Deborah — DEMO                     ║`);
  console.log(`  ║  http://localhost:${PORT}  (index)      ║`);
  console.log(`  ║  /dashboard (user1 / 1234)           ║`);
  console.log(`  ║  /cast                              ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);
});
