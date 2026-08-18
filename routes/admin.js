/**
 * Deborah — Admin Panel Routes
 * Users, Fans (Mock), PRE Tests, Results, Stats
 */

import { Router } from 'express';
import { fb } from '../firebase/admin.js';
import { requireAdmin, requireAdminMfaStepUp } from '../middleware/auth.js';
// AUTH A-30: privileged action audit (admin:action)
import { AUDIT_ACTIONS, logAuthEvent } from '../src/modules/auth/audit.js';
import { recordMetric } from '../src/telemetry/index.js';
import { DB_PATHS } from '../utils/constants.js';
import crypto from 'crypto';
import { safeKey } from '../utils/helpers.js';
// AUTH A-19/B-15: teacher approval + B-34 signup review queue
import teacherRoutes from './admin/teachers.js';
import signupReviewRoutes from './admin/signup-reviews.js';
// C4-08: institution governance — policy CRUD, publish, diff, migration preview, audit export
import {
  createInstitutionPolicy,
  updateDraftPolicy,
  publishPolicy,
  deprecatePolicy,
  bumpPolicyVersion,
  diffPolicies,
  resolveEffectivePolicy,
  assertInstitutionPolicyNotBypassed,
  isApprovedPreset,
  migrationPreviewForSavedPresets,
  pinSessionPolicy,
  governanceAuditExport,
  isSameTenant,
  INSTITUTION_POLICY_ROOT,
  INSTITUTION_POLICY_PATH,
} from '../services/cast/institution-policy.js';
import { PRESET_REGISTRY } from '../services/cast/presets.js';

const router = Router();

router.use(requireAdmin);
router.use(teacherRoutes);
router.use(signupReviewRoutes);

// ── Dashboard ──
router.get('/dashboard', async (req, res) => {
  try {
    const [usersSnap, gamesSnap, fansSnap] = await Promise.all([
      fb.get(DB_PATHS.USERS),
      fb.get(DB_PATHS.GAME_SESSIONS),
      fb.get(DB_PATHS.MOCK_FANS),
    ]);

    const users = usersSnap.val() || {};
    let totalTests = 0;
    Object.values(users).forEach(u => {
      totalTests += u.tests ? Object.keys(u.tests).length : 0;
    });

    const stats = {
      usersCount: Object.keys(users).length,
      gamesCount: gamesSnap.exists() ? Object.keys(gamesSnap.val() || {}).length : 0,
      testsCount: totalTests,
      fansCount: fansSnap.exists() ? Object.keys(fansSnap.val() || {}).length : 0,
    };

    res.render('admin/dashboard', {
      title: 'Admin Panel',
      stats,
      users: Object.entries(users)
        .sort((a, b) => (b[1].created_at || 0) - (a[1].created_at || 0))
        // STYLE S33.03: password hash/client hech qachon API'ga chiqmaydi
        .map(([key, u]) => ({
          key,
          username: u.username || key,
          created_at: u.created_at || 0,
          tests: u.tests ? Object.keys(u.tests).length : 0,
          isVip: !!u.isVip,
          vipGrantedBy: u.vipGrantedBy || null,
          vipGrantedAt: u.vipGrantedAt || null,
        })),
      fans: [],
      preGroups: [],
      results: [],
      activeTab: req.query.tab || 'danger',
      // AUTH D-10 §13: 4 til admin copy (AUTH_COPY[lang].admin)
      adminCopy: await adminCopyFor(req),
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    res.render('admin/dashboard', {
      title: 'Admin Panel',
      stats: { usersCount: 0, gamesCount: 0, testsCount: 0, fansCount: 0 },
      users: [], fans: [], preGroups: [], results: [],
      activeTab: 'danger',
      error: err.message,
      adminCopy: await adminCopyFor(req),
    });
  }
});

// AUTH D-10 §13: admin UI copy — 4 til (AUTH_COPY[lang].admin).
// users/audit JS `window.__ADMIN_COPY__` dan o'qiydi (yo'q bo'lsa fallback).
async function adminCopyFor(req) {
  try {
    const { resolveAuthLang, AUTH_COPY } = await import('../data/auth-i18n.js');
    return AUTH_COPY[resolveAuthLang(String(req.query.lang || 'uz'))]?.admin || {};
  } catch (_) {
    return {};
  }
}

// ── C-08: User Management sahifasi (ro'yxat, qidiruv, filter, pagination) ──
// Alohida sahifa — dashboard'dan ajratilgan (C-08 §06: views/admin/users.ejs)
router.get('/users', async (req, res) => {
  try {
    res.render('admin/users', {
      title: 'Foydalanuvchilar',
      csrfToken: req.session?.csrfToken || '',
      adminName: req.session?.admin?.username || 'admin',
      adminCopy: await adminCopyFor(req),
    });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ── C-09: Audit dashboard sahifasi (auth_audit ro'yxati + aggregate'lar) ──
router.get('/audit', async (req, res) => {
  try {
    res.render('admin/audit', {
      title: 'Audit jurnali',
      csrfToken: req.session?.csrfToken || '',
      adminName: req.session?.admin?.username || 'admin',
      adminCopy: await adminCopyFor(req),
    });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ── AUTH D-32 §26 + E-07: Email cost dashboard (email_cost/{YYYY-MM}/{provider} + budget) ──
router.get('/email-cost', async (req, res) => {
  try {
    const snap = await fb.get('email_cost');
    const raw = snap.exists() ? snap.val() || {} : {};
    const rows = [];
    let totalCost = 0;
    let totalCount = 0;
    for (const [month, providers] of Object.entries(raw)) {
      for (const [provider, rec] of Object.entries(providers || {})) {
        const cost = Number(rec.cost || 0);
        const count = Number(rec.count || 0);
        totalCost += cost;
        totalCount += count;
        rows.push({ month, provider, cost, count, updatedAt: rec.updatedAt || 0 });
      }
    }
    rows.sort((a, b) => (b.month + '|' + b.provider).localeCompare(a.month + '|' + a.provider));
    const { budgetStatus, getBudgetAlerts } = await import('../src/modules/email/budget.js');
    const [status, alerts] = await Promise.all([budgetStatus(), getBudgetAlerts()]);
    res.render('admin/email-cost', {
      title: 'Email xarajat',
      rows,
      totalCost: Math.round(totalCost * 1000) / 1000,
      totalCount,
      monthCost: status.monthCost,
      budget: status.budget,
      budgetSource: status.budgetSource,
      overBudget: status.level === 'exceeded',
      level: status.level, // ok | warn | exceeded (E-07)
      pct: status.pct,
      warnThresholdPct: status.warnThresholdPct,
      alerts,
      month: status.month,
      csrfToken: req.session?.csrfToken || '',
      budgetMsg: req.query.budget === 'saved' ? 'saved' : req.query.budget === 'invalid' ? 'invalid' : '',
      adminName: req.session?.admin?.username || 'admin',
      adminCopy: await adminCopyFor(req),
    });
  } catch (err) {
    console.error('Email cost dashboard error:', err);
    res.status(500).send(err.message);
  }
});

// ── E-07: Monthly report CSV download (admin) ──
router.get('/email-cost/report.csv', async (req, res) => {
  try {
    const { monthlyReportCsv } = await import('../src/modules/email/budget.js');
    const csv = await monthlyReportCsv(String(req.query.month || '').slice(0, 7) || null);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="email-cost-${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ── E-07: Budget config (admin) — DB'ga yozadi, env faqat default ──
router.post('/email-cost/budget', async (req, res) => {
  try {
    const { setBudgetConfig } = await import('../src/modules/email/budget.js');
    const result = await setBudgetConfig(req.body?.amount, req.session?.admin?.username || 'admin');
    res.redirect(`/admin/email-cost?budget=${result.ok ? 'saved' : 'invalid'}`);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ── C-11: Roster import sahifasi (HEMIS Excel/CSV — staging→mapping→diff→commit) ──
router.get('/roster', async (req, res) => {
  try {
    const { ROSTER_COPY, resolveRosterLang } = await import('../data/roster-i18n.js');
    const lang = resolveRosterLang(String(req.query.lang || 'uz'));
    res.render('admin/roster', {
      title: 'Roster import',
      csrfToken: req.session?.csrfToken || '',
      adminName: req.session?.admin?.username || 'admin',
      rosterCopy: ROSTER_COPY[lang] || ROSTER_COPY.uz,
      rosterLang: lang,
    });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ── C-09 §06: Audit ro'yxati — filter (action/method/outcome), qidiruv, pagination ──
router.get('/api/audit', async (req, res) => {
  try {
    const { listAuthAudit } = await import('../src/modules/auth/audit.js');
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 25));
    const now = Date.now();
    const range = String(req.query.range || '24h');
    const rangeMs = range === '7d' ? 7 * 86400000 : range === '30d' ? 30 * 86400000 : 24 * 3600000;
    const result = await listAuthAudit({
      action: String(req.query.action || ''),
      method: String(req.query.method || ''),
      outcome: String(req.query.outcome || ''),
      q: String(req.query.q || ''),
      from: now - rangeMs,
      to: now,
      page,
      pageSize,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── C-09 §07: Aggregate'lar — login rate, lockout, teacher, risk, HIBP, abuse ──
router.get('/api/audit/aggregates', async (req, res) => {
  try {
    const { auditAggregates } = await import('../src/modules/auth/audit.js');
    const now = Date.now();
    const range = String(req.query.range || '24h');
    const rangeMs = range === '7d' ? 7 * 86400000 : range === '30d' ? 30 * 86400000 : 24 * 3600000;
    const agg = await auditAggregates({ from: now - rangeMs, to: now });
    // Login success/fail rate (%) — aggregate'lar uchun
    const totalAuth = agg.login_success + agg.login_fail;
    agg.login_fail_rate = totalAuth ? Math.round((agg.login_fail / totalAuth) * 100) : 0;
    res.json(agg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * AUTH D-10 §26: CSV hujayra — formula-injection himoyasi (OWASP / ODF 1.2).
 * `=`/`+`/`-`/`@` (boshlang'ich bo'shliq/tab bilan ham) bilan boshlanadigan
 * qiymatlar Excel'da formula sifatida ishga tushishi mumkin — `'` prefiks
 * qo'shib, matn sifatida ochilishi kafolatlanadi. Boshqa hamma belgilar
 * o'zgarishsiz (ip_hash/action/actor_id allaqachon PII-minimal).
 */
function csvCell(value) {
  let s = String(value == null ? '' : value);
  if (/^[\t\r\x20]*[=+\-@]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

// ── C-09 §09: Security report eksport CSV (PII minimal — hash'lar) ──
router.get('/api/audit/export', async (req, res) => {
  try {
    const { listAuthAudit } = await import('../src/modules/auth/audit.js');
    const now = Date.now();
    const rangeMs = 30 * 86400000; // retention: 30 kun (C-09 §11)
    const result = await listAuthAudit({
      from: now - rangeMs, to: now, page: 1, pageSize: 100000,
    });
    // PII minimal: ts, action, outcome, method, actor_id, ip_hash — detail'da
    // parol/token/OTP bo'lmasligi kafolat (logAuthEvent redaction).
    const header = ['ts', 'action', 'outcome', 'method', 'actor_id', 'ip_hash'];
    const rows = result.items.map((e) => [
      new Date(e.ts).toISOString(), e.action, e.outcome, e.method, e.actor_id, e.ip_hash,
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map(csvCell).join(','))
      .join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="auth-audit-${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Load fans ──
router.get('/api/fans', async (req, res) => {
  try {
    const snap = await fb.get(DB_PATHS.MOCK_FANS);
    const fans = snap.val() || {};
    const list = Object.entries(fans)
      .sort((a, b) => (a[1].name || '').localeCompare(b[1].name || ''))
      .map(([key, f]) => ({
        key, name: f.name || key,
        count: f.count || (f.questions ? f.questions.length : 0),
        createdAt: f.createdAt || 0,
      }));
    res.json({ fans: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Save fan ──
router.post('/api/fans/save', async (req, res) => {
  try {
    const { name, questions } = req.body;
    if (!name || !questions?.length) return res.status(400).json({ error: 'Invalid data' });
    const fanKey = safeKey(name) + '_' + Date.now().toString(36);
    const slim = questions.map(q => ({
      num: q.num, text: q.text, correctLetter: q.correctLetter, correctText: q.correctText,
      options: q.options.map(o => ({ text: o.text, letter: o.letter, isCorrect: o.isCorrect }))
    }));
    await fb.set(`${DB_PATHS.MOCK_FANS}/${fanKey}`, { name: name.trim(), count: slim.length, questions: slim, createdAt: Date.now() });
    res.json({ success: true, key: fanKey });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Delete fan ──
router.post('/api/fans/delete', async (req, res) => {
  try {
    await fb.remove(`${DB_PATHS.MOCK_FANS}/${req.body.key}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Update fan questions ──
router.post('/api/fans/update', async (req, res) => {
  try {
    const { key, questions } = req.body;
    const slim = questions.map(q => ({
      num: q.num, text: q.text, correctLetter: q.correctLetter,
      correctText: q.correctText,
      options: q.options.map(o => ({ text: o.text, letter: o.letter, isCorrect: o.isCorrect }))
    }));
    await fb.set(`${DB_PATHS.MOCK_FANS}/${key}/questions`, slim);
    await fb.set(`${DB_PATHS.MOCK_FANS}/${key}/count`, slim.length);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Load PRE groups ──
router.get('/api/pre-groups', async (req, res) => {
  try {
    const snap = await fb.get(DB_PATHS.PRE_GROUPS);
    const groups = snap.val() || {};
    const list = Object.entries(groups)
      .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0))
      .map(([key, g]) => ({
        key, title: g.title || key, chunks: g.chunks || [],
        total: g.total || 0, count: g.count || 0, createdAt: g.createdAt || 0,
      }));
    res.json({ groups: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Save PRE test (supports editKey for editing existing groups) ──
router.post('/api/pre-groups/save', async (req, res) => {
  try {
    const { title, chunks, editKey } = req.body;
    if (!title || !chunks?.length) return res.status(400).json({ error: 'Invalid data' });

    let groupKey = editKey || null;

    if (!groupKey) {
      const groupsSnap = await fb.get(DB_PATHS.PRE_GROUPS);
      const groups = groupsSnap.val() || {};
      for (const [k, g] of Object.entries(groups)) {
        if (g.title === title.trim()) { groupKey = k; break; }
      }
    }

    if (!groupKey) groupKey = safeKey(title) + '_' + Date.now().toString(36);

    const chunkList = chunks.map(c => ({
      id: c.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: c.name || `Subtest ${(c.index || 0) + 1}`,
      questions: c.questions || [],
      count: c.questions?.length || 0,
    }));

    const total = chunkList.reduce((sum, c) => sum + c.count, 0);

    await fb.set(`${DB_PATHS.PRE_GROUPS}/${groupKey}`, {
      title: title.trim(), chunks: chunkList, total, count: chunkList.length,
      createdAt: Date.now(), authorUid: DB_PATHS.PRE_AUTHOR_UID,
    });

    res.json({ success: true, key: groupKey });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Delete PRE group ──
router.post('/api/pre-groups/delete', async (req, res) => {
  try { await fb.remove(`${DB_PATHS.PRE_GROUPS}/${req.body.key}`); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── API: Delete user ──
router.post('/api/users/delete', requireAdminMfaStepUp, async (req, res) => {
  try {
    await fb.remove(`${DB_PATHS.USERS}/${req.body.key}`);
    // AUTH A-30 §10: privileged action audit (kim, qachon, nima, IP hash)
    logAuthEvent({
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      outcome: 'success',
      method: 'admin',
      actorId: req.session?.admin?.username || null,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { action: 'user:delete', resource: req.body?.key },
    }).catch(() => {});
    res.json({ success: true });
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── API: Get results ──
router.get('/api/results', async (req, res) => {
  try {
    const snap = await fb.get(DB_PATHS.RESULTS);
    const data = snap.val() || {};
    const list = Object.entries(data)
      .sort((a, b) => (b[1].date || 0) - (a[1].date || 0))
      .map(([code, r]) => ({
        code, testName: r.test_name || 'Test', host: r.host || '',
        date: r.date || 0, totalPlayers: r.totalPlayers || 0,
        leaderboard: r.leaderboard || [],
      }));
    res.json({ results: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Delete result ──
router.post('/api/results/delete', async (req, res) => {
  try { await fb.remove(`${DB_PATHS.RESULTS}/${req.body.code}`); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── API: Get stats ──
router.get('/api/stats', async (req, res) => {
  try {
    const [usersSnap, gamesSnap, fansSnap, resultsSnap] = await Promise.all([
      fb.get(DB_PATHS.USERS), fb.get(DB_PATHS.GAME_SESSIONS),
      fb.get(DB_PATHS.MOCK_FANS), fb.get(DB_PATHS.RESULTS),
    ]);

    const users = usersSnap.val() || {};
    let totalTests = 0;
    Object.values(users).forEach(u => totalTests += u.tests ? Object.keys(u.tests).length : 0);

    const games = gamesSnap.val() || {};
    let activeGames = 0;
    Object.values(games).forEach(g => { if (g.state?.status && g.state.status !== 'ended') activeGames++; });

    const results = resultsSnap.val() || {};
    let totalPlayers = 0;
    Object.values(results).forEach(r => totalPlayers += r.totalPlayers || 0);

    const fans = fansSnap.val() || {};
    const fanStats = Object.entries(fans).map(([k, f]) => ({
      name: f.name || k, count: f.count || (f.questions?.length || 0), attempts: f.attempts || 0,
    }));

    res.json({
      userCount: Object.keys(users).length, totalTests, activeGames,
      resultsCount: Object.keys(results).length, totalPlayers,
      fansCount: Object.keys(fans).length, fanStats,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── AUTH C-02 §09/§10: Lockout support — block / unblock / unlock ──
// (reauth + MFA step-up + audit — privileged actions)

// Support manual unlock: lockout'ni erta olib tashlash (permanent blok emas)
router.post('/api/users/unlock', requireAdminMfaStepUp, async (req, res) => {
  try {
    const { supportUnlock } = await import('../src/modules/auth/lockout.js');
    const key = String(req.body?.key || '').trim();
    if (!key) return res.status(400).json({ error: 'key required' });
    const result = await supportUnlock(key, {
      actorId: req.session?.admin?.username || 'admin',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    if (!result.ok) return res.status(409).json({ error: result.error, code: result.code || 'LOCKED' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin permanent blok: users.status = 'blocked' (C-08 §29: sabab MAJBURIY)
router.post('/api/users/block', requireAdminMfaStepUp, async (req, res) => {
  try {
    const { adminBlockUser } = await import('../src/modules/auth/lockout.js');
    const key = String(req.body?.key || '').trim();
    if (!key) return res.status(400).json({ error: 'key required' });
    const reason = String(req.body?.reason || '').trim().slice(0, 500);
    if (!reason) return res.status(400).json({ error: 'reason required' }); // §29
    await adminBlockUser(key, {
      actorId: req.session?.admin?.username || 'admin',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      reason,
    });
    // C-08 §07: blok → barcha sessiyalar revoke (login blok + faol sessiyalar)
    try {
      const { revokeByUser } = await import('../src/modules/auth/session-manager.js');
      await revokeByUser(key, { reason: 'admin_block' });
    } catch (_) { /* session revoke fail-soft */ }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin blokni olib tashlash
router.post('/api/users/unblock', requireAdminMfaStepUp, async (req, res) => {
  try {
    const { adminUnblockUser } = await import('../src/modules/auth/lockout.js');
    const key = String(req.body?.key || '').trim();
    if (!key) return res.status(400).json({ error: 'key required' });
    await adminUnblockUser(key, {
      actorId: req.session?.admin?.username || 'admin',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Get all users (VIP tab + C-08 user management) ──
// C-08: email/role/status/name qo'shildi (admin PII minimal — email
// admin'ga ko'rinadi, guide §28). Qidiruv (username/email) + filter
// (role/status) + pagination (page/pageSize) client'da emas — server'da.
router.get('/api/users', async (req, res) => {
  try {
    const usersSnap = await fb.get(DB_PATHS.USERS);
    const users = usersSnap.val() || {};
    const entries = Object.entries(users)
      .sort((a, b) => (b[1].created_at || 0) - (a[1].created_at || 0));

    // C-08 §06: qidiruv (username/email, case-insensitive)
    const q = String(req.query.q || '').trim().toLowerCase();
    const role = String(req.query.role || '').trim();
    const status = String(req.query.status || '').trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 25));

    let filtered = entries;
    if (q) {
      filtered = filtered.filter(([, u]) => {
        const uname = String(u.username || '').toLowerCase();
        const email = String(u.email || '').toLowerCase();
        return uname.includes(q) || email.includes(q);
      });
    }
    if (role) filtered = filtered.filter(([, u]) => (u.role || 'student') === role);
    if (status) filtered = filtered.filter(([, u]) => (u.status || 'active') === status);

    const total = filtered.length;
    const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);
    const list = pageItems.map(([key, u]) => ({
      key,
      username: u.username || key,
      name: u.name || u.username || key,
      email: u.email || null,
      role: u.role || 'student',
      status: u.status || 'active',
      created_at: u.created_at || 0,
      lastLoginAt: u.last_login || u.last_login_at || 0,
      isVip: !!u.isVip,
      vipGrantedAt: u.vipGrantedAt || null,
      vipGrantedBy: u.vipGrantedBy || null,
      vipRevokedAt: u.vipRevokedAt || null,
    }));
    res.json({ users: list, total, page, pageSize });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── C-08 §10: rol o'zgartirish (student↔teacher, admin only) ──
// role_version oshiriladi → eski sessiyalar bekor (A-02 regenerate),
// session revoke (B-25) + audit role_changed. Blok sabab majburiy emas
// bu yerda (rol o'zgarishi emas, blok — §29 faqat blok uchun).
router.post('/api/users/role', requireAdminMfaStepUp, async (req, res) => {
  try {
    const { revokeByUser } = await import('../src/modules/auth/session-manager.js');
    const key = String(req.body?.key || '').trim();
    const newRole = String(req.body?.role || '').trim();
    if (!key) return res.status(400).json({ error: 'key required' });
    const allowed = ['student', 'teacher', 'proctor', 'marker', 'board'];
    if (!allowed.includes(newRole)) {
      return res.status(400).json({ error: 'invalid role' });
    }

    const snap = await fb.get(`users/${key}`);
    if (!snap.exists()) return res.status(404).json({ error: 'not found' });
    const oldRole = snap.val().role || 'student';
    if (oldRole === newRole) {
      return res.json({ success: true, unchanged: true }); // idempotent
    }

    await fb.set(`users/${key}/role`, newRole);
    // A-02: rol versiyasi — eski sessiyalar qayta o'qiladi (revoke bilan birga)
    const roleVersion = (typeof snap.val().role_version === 'number' ? snap.val().role_version : 0) + 1;
    await fb.set(`users/${key}/role_version`, roleVersion);
    // B-25 §07: barcha sessiyalarni bekor qilish — "user qayta kiring"
    await revokeByUser(key, { reason: 'role_changed' });

    logAuthEvent({
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      outcome: 'success',
      method: 'admin',
      actorId: req.session?.admin?.username || null,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { action: 'role:change', resource: key, from: oldRole, to: newRole },
    }).catch(() => {});
    try { recordMetric('auth.admin_user_role_change', 1, { type: 'counter' }); } catch (_) {}
    res.json({ success: true, from: oldRole, to: newRole });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── C-08 §11: barcha sessiyalarni yakunlash (B-25 revokeByUser) ──
router.post('/api/users/revoke-sessions', requireAdminMfaStepUp, async (req, res) => {
  try {
    const { revokeByUser } = await import('../src/modules/auth/session-manager.js');
    const key = String(req.body?.key || '').trim();
    if (!key) return res.status(400).json({ error: 'key required' });
    const result = await revokeByUser(key, { reason: 'admin_revoke' });
    logAuthEvent({
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      outcome: 'success',
      method: 'admin',
      actorId: req.session?.admin?.username || null,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { action: 'user:revoke-sessions', resource: key, count: result.count },
    }).catch(() => {});
    res.json({ success: true, count: result.count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── VIP Management Page ──
router.get('/vip', async (req, res) => {
  try {
    const usersSnap = await fb.get(DB_PATHS.USERS);
    const users = usersSnap.val() || {};
    
    res.render('admin/vip', {
      title: 'VIP Foydalanuvchilar',
      users: Object.entries(users)
        .sort((a, b) => (b[1].created_at || 0) - (a[1].created_at || 0))
        .map(([key, u]) => ({
          key,
          username: u.username || key,
          isVip: !!u.isVip,
          created_at: u.created_at || 0,
          vipGrantedAt: u.vipGrantedAt || null,
          vipGrantedBy: u.vipGrantedBy || null,
          vipRevokedAt: u.vipRevokedAt || null,
          vipPlainPassword: u.vipPlainPassword || null,
        })),
    });
  } catch (err) {
    console.error('VIP page error:', err);
    res.render('admin/vip', { title: 'VIP Foydalanuvchilar', users: [], error: err.message });
  }
});

// ── API: Grant VIP ──
router.post('/api/vip/grant', requireAdminMfaStepUp, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username required' });

    const userKey = safeKey(username);
    const snap = await fb.get(`${DB_PATHS.USERS}/${userKey}`);
    
    if (!snap.exists()) {
      return res.status(404).json({ error: 'Bunday foydalanuvchi topilmadi' });
    }

    // Generate random password for VIP user
    // Generate random VIP management password (stored separately, does NOT change user's login password)
    const vipPass = Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6);

    await fb.update(`${DB_PATHS.USERS}/${userKey}`, {
      isVip: true,
      vipGrantedAt: Date.now(),
      vipGrantedBy: req.session.admin?.username || 'admin',
      vipPlainPassword: vipPass,
      // NOTE: password field is NOT overwritten — user keeps their original login password
    });

    // STYLE S33.03: plain password client'ga hech qachon qaytmaydi —
    // admin UI'da credential oshkor etilmaydi (faqat success status).
    res.json({ success: true, username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Revoke VIP ──
router.post('/api/vip/revoke', requireAdminMfaStepUp, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username required' });

    const userKey = safeKey(username);
    const snap = await fb.get(`${DB_PATHS.USERS}/${userKey}`);
    
    if (!snap.exists()) {
      return res.status(404).json({ error: 'Bunday foydalanuvchi topilmadi' });
    }

    await fb.update(`${DB_PATHS.USERS}/${userKey}`, {
      isVip: false,
      vipRevokedAt: Date.now(),
      // Keep vipGrantedAt/vipGrantedBy for audit trail
    });

    res.json({ success: true, username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// C4-08 — Institution governance API
// Tenant scope: ushbu instance'da admin bitta institution'ni boshqaradi;
// tenantId default 'default' — cross-tenant access tekshiruvlari ishga tushadi.
// ═══════════════════════════════════════════════════════════════
const INSTITUTION_TENANT = () => req => (req.session?.admin?.tenantId || 'default');

async function readPolicies(tenantId) {
  const root = `${INSTITUTION_POLICY_ROOT()}/${tenantId}`;
  const snap = await fb.get(root);
  return snap.exists() ? snap.val() : {};
}

// ── List policies + effective + presets ──
router.get('/api/cast/policies', async (req, res) => {
  try {
    const tenantId = INSTITUTION_TENANT()(req);
    const policies = await readPolicies(tenantId);
    const list = Object.values(policies);
    const effective = resolveEffectivePolicy(list);
    res.json({
      tenantId,
      policies: list.map((p) => ({
        policyId: p.policyId,
        name: p.name,
        version: p.version,
        status: p.status,
        effectiveDate: p.effectiveDate || null,
        publishedAt: p.publishedAt || null,
        approvedPresets: p.approvedPresets || [],
        lockedFields: p.lockedFields || {},
        limits: p.limits || {},
        isEffective: effective ? effective.policyId === p.policyId && p.version === effective.version : false,
      })),
      effective: effective ? { policyId: effective.policyId, version: effective.version } : null,
      presets: Object.values(PRESET_REGISTRY).map((p) => ({ id: p.id, version: p.version, labelKey: p.labelKey })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get single policy (full detail) ──
router.get('/api/cast/policies/:policyId', async (req, res) => {
  try {
    const tenantId = INSTITUTION_TENANT()(req);
    const snap = await fb.get(`${INSTITUTION_POLICY_PATH(tenantId, req.params.policyId)}`);
    if (!snap.exists()) return res.status(404).json({ error: 'Policy topilmadi' });
    const policy = snap.val();
    // Cross-tenant guard (item 14)
    if (!isSameTenant(policy, tenantId)) return res.status(403).json({ error: 'Cross-tenant access bloklandi' });
    res.json({ policy });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Create draft policy (item 1, 5) ──
router.post('/api/cast/policies', async (req, res) => {
  try {
    const tenantId = INSTITUTION_TENANT()(req);
    const { name, approvedPresets, lockedFields, limits, effectiveDate } = req.body || {};
    // Locked field katalog'da bo'lmagan path'lar rad etiladi (item 4)
    const unknown = [...Object.keys(lockedFields || {}), ...Object.keys(limits || {})]
      .filter((p) => !['scoring.maxSpeedWeight', 'join.maxPlayers', 'leaderboard.anonymizeLowRanks', 'leaderboard.visibility', 'leaderboard.finalVisibility', 'moderation.publicChat', 'moderation.directMessages', 'moderation.questionWall', 'moderation.openTextVisibility', 'moderation.publicIdentity', 'join.identity', 'recording.enabled', 'media.externalImages', 'ai.mayExecuteLiveActions', 'ai.cohostMode', 'personalProgress.visibility'].includes(p));
    if (unknown.length > 0) {
      return res.status(400).json({ error: 'Noma lum governance field: ' + unknown.join(', ') });
    }
    if (approvedPresets && approvedPresets.length > 0) {
      const bad = approvedPresets.filter((id) => !PRESET_REGISTRY[id]);
      if (bad.length > 0) return res.status(400).json({ error: 'Noma lum preset: ' + bad.join(', ') });
    }
    const policy = createInstitutionPolicy({
      tenantId,
      name,
      approvedPresets,
      lockedFields,
      limits,
      effectiveDate: effectiveDate || null,
      createdBy: req.session?.admin?.username || null,
    });
    await fb.set(INSTITUTION_POLICY_PATH(tenantId, policy.policyId), policy);
    res.json({ success: true, policy });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Update draft policy (item 5) ──
router.put('/api/cast/policies/:policyId', async (req, res) => {
  try {
    const tenantId = INSTITUTION_TENANT()(req);
    const path = INSTITUTION_POLICY_PATH(tenantId, req.params.policyId);
    const snap = await fb.get(path);
    if (!snap.exists()) return res.status(404).json({ error: 'Policy topilmadi' });
    const policy = snap.val();
    if (!isSameTenant(policy, tenantId)) return res.status(403).json({ error: 'Cross-tenant access bloklandi' });
    const { name, approvedPresets, lockedFields, limits, effectiveDate } = req.body || {};
    let next = updateDraftPolicy(
      policy,
      {
        ...(name ? { name } : {}),
        ...(approvedPresets ? { approvedPresets } : {}),
        ...(lockedFields ? { lockedFields } : {}),
        ...(limits ? { limits } : {}),
        ...(effectiveDate !== undefined ? { effectiveDate } : {}),
      },
      req.session?.admin?.username || null
    );
    await fb.set(path, next);
    res.json({ success: true, policy: next });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Publish (admin + confirmation, item 6) ──
router.post('/api/cast/policies/:policyId/publish', async (req, res) => {
  try {
    const tenantId = INSTITUTION_TENANT()(req);
    const path = INSTITUTION_POLICY_PATH(tenantId, req.params.policyId);
    const snap = await fb.get(path);
    if (!snap.exists()) return res.status(404).json({ error: 'Policy topilmadi' });
    const policy = snap.val();
    if (!isSameTenant(policy, tenantId)) return res.status(403).json({ error: 'Cross-tenant access bloklandi' });
    const next = publishPolicy(policy, {
      by: req.session?.admin?.username || null,
      confirm: !!(req.body && req.body.confirm === true),
    });
    await fb.set(path, next);
    res.json({ success: true, policy: next });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Deprecate (item 5) ──
router.post('/api/cast/policies/:policyId/deprecate', async (req, res) => {
  try {
    const tenantId = INSTITUTION_TENANT()(req);
    const path = INSTITUTION_POLICY_PATH(tenantId, req.params.policyId);
    const snap = await fb.get(path);
    if (!snap.exists()) return res.status(404).json({ error: 'Policy topilmadi' });
    const policy = snap.val();
    if (!isSameTenant(policy, tenantId)) return res.status(403).json({ error: 'Cross-tenant access bloklandi' });
    const next = deprecatePolicy(policy, { by: req.session?.admin?.username || null });
    await fb.set(path, next);
    res.json({ success: true, policy: next });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Bump version (item 7) ──
router.post('/api/cast/policies/:policyId/version', async (req, res) => {
  try {
    const tenantId = INSTITUTION_TENANT()(req);
    const path = INSTITUTION_POLICY_PATH(tenantId, req.params.policyId);
    const snap = await fb.get(path);
    if (!snap.exists()) return res.status(404).json({ error: 'Policy topilmadi' });
    const policy = snap.val();
    if (!isSameTenant(policy, tenantId)) return res.status(403).json({ error: 'Cross-tenant access bloklandi' });
    const { name, lockedFields, limits, approvedPresets, effectiveDate } = req.body || {};
    const next = bumpPolicyVersion(policy, {
      name, lockedFields, limits, approvedPresets, effectiveDate,
      by: req.session?.admin?.username || null,
    });
    await fb.set(INSTITUTION_POLICY_PATH(tenantId, next.policyId), next);
    res.json({ success: true, policy: next });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Diff (item 8) ──
router.post('/api/cast/policies/diff', async (req, res) => {
  try {
    const { policyA, policyB } = req.body || {};
    if (!policyA || !policyB) return res.status(400).json({ error: 'policyA va policyB talab qilinadi' });
    res.json({ diff: diffPolicies(policyA, policyB) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Migration preview (item 10) ──
// Saved teacher preset'larni policy bilan solishtiradi — qaysi preset
// locked field'ga mos kelmaydi. Endpoint GET: user saved presets'ni
// cast_saved_presets/{userId} dan o'qiydi.
router.get('/api/cast/policies/:policyId/migration-preview', async (req, res) => {
  try {
    const tenantId = INSTITUTION_TENANT()(req);
    const path = INSTITUTION_POLICY_PATH(tenantId, req.params.policyId);
    const snap = await fb.get(path);
    if (!snap.exists()) return res.status(404).json({ error: 'Policy topilmadi' });
    const policy = snap.val();
    if (!isSameTenant(policy, tenantId)) return res.status(403).json({ error: 'Cross-tenant access bloklandi' });
    const savedSnap = await fb.get('cast_saved_presets');
    const all = savedSnap.exists() ? savedSnap.val() : {};
    const saved = Object.entries(all).flatMap(([userId, presets]) =>
      Object.entries(presets || {}).map(([id, p]) => ({ id, userId, name: p.name || id, overrides: p.overrides || {} }))
    );
    res.json({ preview: migrationPreviewForSavedPresets(saved, policy) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Audit export (item 13) ──
router.get('/api/cast/policies/:policyId/audit', async (req, res) => {
  try {
    const tenantId = INSTITUTION_TENANT()(req);
    const path = INSTITUTION_POLICY_PATH(tenantId, req.params.policyId);
    const snap = await fb.get(path);
    if (!snap.exists()) return res.status(404).json({ error: 'Policy topilmadi' });
    const policy = snap.val();
    if (!isSameTenant(policy, tenantId)) return res.status(403).json({ error: 'Cross-tenant access bloklandi' });
    res.json({ audit: governanceAuditExport(policy) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
