/**
 * Edikit — Teacher Approval Routes (AUTH A-19)
 *
 * Admin teacher arizalarini ko'radi va tasdiqlaydi/rad etadi.
 *
 * SECURITY:
 *   - router.use(requireAdmin) — faqat admin (session.admin).
 *   - CSRF: global csrf middleware server.js'da qo'llanadi (POST).
 *   - Rate limit: /admin/api prefiksi server.js'da adminApiLimiter bilan
 *     himoyalangan.
 *   - IDOR: approve/reject userId parametri bo'yicha — faqat shu user'ning
 *     role'ini teacher_pending holatidan o'zgartira oladi (faqat oldinga).
 *   - role transition faqat admin; role_version oshiriladi (AUTH A-02:
 *     eski sessiyalar bekor qilinadi).
 */

import { Router } from 'express';
import { fb } from '../../firebase/admin.js';
import { requireAdmin, requireRecentAdminAuth, requireAdminMfaStepUp } from '../../middleware/auth.js';
import { safeKey } from '../../utils/helpers.js';

// AUTH D-10 §13: admin UI copy — 4 til (AUTH_COPY[lang].admin).
// users/audit JS `window.__ADMIN_COPY__` dan o'qiydi (yo'q bo'lsa fallback).
async function adminCopyFor(req) {
  try {
    const { resolveAuthLang, AUTH_COPY } = await import('../../data/auth-i18n.js');
    return AUTH_COPY[resolveAuthLang(String(req.query.lang || 'uz'))]?.admin || {};
  } catch (_) {
    return {};
  }
}
import { AUDIT_ACTIONS, logAuthEvent } from '../../src/modules/auth/audit.js';
import { DB_PATHS } from '../../utils/constants.js';
import CONFIG from '../../src/config/env.js';
// AUTH B-14: state machine service — transition + schema + cooldown
import { decideTeacherApplication } from '../../src/modules/auth/teacher-approval.js';
import { revokeByUser } from '../../src/modules/auth/session-manager.js';
// AUTH D-06 §06: auth_teacher_approval_total{outcome}
import { recordMetric } from '../../src/telemetry/index.js';

// ── AUTH A-25 §10-§14: Entra PIM darajasidagi approval lifecycle ──
const APPROVAL_WINDOW_MS = CONFIG.TEACHER_APPROVAL_WINDOW_MS || 72 * 60 * 60 * 1000;   // 72 soat
const ESCALATION_MS = CONFIG.TEACHER_ESCALATION_MS || 7 * 24 * 60 * 60 * 1000;         // 7 kun
const REMINDER_EVERY_MS = 24 * 60 * 60 * 1000;                                          // eslatma: 24 soatda bir
const SUPER_ADMIN = CONFIG.ADMIN_USER;                                                  // eskalatsiya — super-admin
const MIN_JUSTIFICATION = 10;                                                           // majburiy asoslash (belgi)

const router = Router();
router.use(requireAdmin);

/** Pending ariza yoshi bo'yicha holat (A-25 §11): normal | window-exceeded | escalated. */
function approvalState(appliedAt, now = Date.now()) {
  if (typeof appliedAt !== 'number' || !appliedAt) return { level: 'normal', ageMs: 0 };
  const ageMs = now - appliedAt;
  if (ageMs > ESCALATION_MS) return { level: 'escalated', ageMs };
  if (ageMs > APPROVAL_WINDOW_MS) return { level: 'window-exceeded', ageMs };
  return { level: 'normal', ageMs };
}

/**
 * A-25 §11/§13: ariza oynasi o'tib ketganda eslatma (24h bir marta) + audit.
 * Email infra mavjud — admin emaili env'da bo'lsa yuboriladi, aks holda
 * audit + UI badge yetarli (fire-and-forget, hech qachon bloklamaydi).
 */
async function maybeSendWindowReminder({ userId, appliedAt }) {
  const { level, ageMs } = approvalState(appliedAt);
  if (level === 'normal') return;
  try {
    const snap = await fb.get(`users/${userId}/teacher_application/reminder_sent_at`);
    const last = snap.exists() ? snap.val() : 0;
    if (Date.now() - (last || 0) < REMINDER_EVERY_MS) return;
    await fb.set(`users/${userId}/teacher_application/reminder_sent_at`, Date.now());
    logAuthEvent({
      action: AUDIT_ACTIONS.TEACHER_ESCALATED,
      outcome: level === 'escalated' ? 'escalated' : 'reminded',
      method: 'admin',
      actorId: userId,
      ipAddress: null,
      userAgent: null,
      details: { ageMs, level },
    }).catch(() => {});
  } catch (_) { /* non-critical */ }
}

/** A-25 §12: admin o'z arizasini qaror qila olmaydi + eskalatsiya faqat super-admin. */
async function assertDecisionAllowed(req, userId, appliedAt) {
  const adminName = req.session?.admin?.username || '';
  const userSnap = await fb.get(`users/${userId}`);
  const u = userSnap.exists() ? userSnap.val() : {};
  if (u.username && adminName && String(u.username).toLowerCase() === String(adminName).toLowerCase()) {
    return { ok: false, error: 'self_approve', message: 'Admin o\'z arizasini qaror qila olmaydi' };
  }
  const { level } = approvalState(appliedAt || u.teacher_application?.appliedAt || 0);
  if (level === 'escalated' && adminName !== SUPER_ADMIN) {
    return { ok: false, error: 'escalated', message: '7 kundan oshgan arizani faqat super-admin qaror qiladi' };
  }
  return { ok: true };
}

/** Justification validatsiya (A-25 §12): majburiy, min 10 belgi. */
function parseJustification(body, fallback) {
  const raw = String(body?.justification || body?.reason || fallback || '').trim();
  if (raw.length < MIN_JUSTIFICATION) return null;
  return raw.slice(0, 500);
}

// ── Admin UI: Teacher arizalari (B-15: filter + qidiruv + pagination) ──
const TEACHER_PAGE_SIZE = 20;
const TEACHER_FILTERS = ['pending', 'approved', 'rejected', 'all'];

router.get('/teachers', async (req, res) => {
  try {
    const filter = TEACHER_FILTERS.includes(req.query.filter) ? req.query.filter : 'pending';
    const q = String(req.query.q || '').trim().toLowerCase().slice(0, 100);
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);

    // B-14 canonical record'lar (subject/experience/full_name) — user_id bo'yicha index
    const appsSnap = await fb.get('teacher_applications');
    const appsByUser = {};
    if (appsSnap.exists()) {
      for (const app of Object.values(appsSnap.val())) {
        const prev = appsByUser[app.user_id];
        if (!prev || app.created_at > prev.created_at) appsByUser[app.user_id] = app;
      }
    }

    const usersSnap = await fb.get(DB_PATHS.USERS);
    const rows = [];
    // Badge: filter/qidiruvdan MUSTAQIL global pending soni (B-15 review fix)
    let pendingTotal = 0;
    if (usersSnap.exists()) {
      const users = usersSnap.val();
      for (const [key, u] of Object.entries(users)) {
        const role = u.role;
        if (role !== 'teacher_pending' && role !== 'teacher_rejected' && role !== 'teacher') continue;
        if (role === 'teacher_pending') pendingTotal++;
        const app = appsByUser[key] || {};
        const entry = {
          id: key,
          username: u.username || key,
          email: u.email || '',
          fullName: app.full_name || u.display_name || u.name || u.username || key,
          university: app.university || u.teacher_application?.university || '',
          subject: app.subject || '',
          experience: app.experience || '',
          reason: app.reason || u.teacher_application?.reason || '',
          // A-25 eskalatsiya/oyna: inline appliedAt asosiy (approve/reject ham
          // shu qiymatni ishlatadi); canonical created_at faqat fallback.
          appliedAt: u.teacher_application?.appliedAt || app.created_at || u.created_at || 0,
          role,
          decidedAt: u.teacher_decision_at || 0,
          decidedBy: u.teacher_decision_by || '',
          rejectionReason: u.teacher_rejection_reason || '',
        };
        // B-15 §06: qidiruv — ism/email/universitet/fan bo'yicha
        if (q) {
          const hay = [entry.username, entry.email, entry.fullName, entry.university, entry.subject]
            .join(' ').toLowerCase();
          if (!hay.includes(q)) continue;
        }
        // B-15 §06: filter
        if (filter === 'pending' && role !== 'teacher_pending') continue;
        if (filter === 'approved' && role !== 'teacher') continue;
        if (filter === 'rejected' && role !== 'teacher_rejected') continue;
        rows.push(entry);
      }
    }

    rows.sort((a, b) =>
      filter === 'pending' ? a.appliedAt - b.appliedAt : b.decidedAt - a.decidedAt);

    // Pagination
    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / TEACHER_PAGE_SIZE));
    const pageRows = rows.slice((page - 1) * TEACHER_PAGE_SIZE, page * TEACHER_PAGE_SIZE);

    // AUTH A-25 §11/§13: approval oynasi holati + eslatma (fire-and-forget)
    for (const p of pageRows) {
      if (p.role === 'teacher_pending') {
        p.approval = approvalState(p.appliedAt);
        maybeSendWindowReminder({ userId: p.id, appliedAt: p.appliedAt }).catch(() => {});
      }
    }

    res.render('admin/teachers', {
      title: "Teacher arizalari",
      rows: pageRows,
      total,
      filter,
      q: req.query.q || '',
      page,
      totalPages,
      pendingCount: pendingTotal,
      // admin nav context (views/admin dashboard bilan bir xil pattern)
      csrfToken: req.session?.csrfToken || '',
      // AUTH D-10 §13: 4 til admin copy (AUTH_COPY[lang].admin) — __ADMIN_COPY__ kontrakti
      adminCopy: await adminCopyFor(req),
    });
  } catch (err) {
    console.error('Teacher list error:', err);
    res.status(500).render('error', {
      title: '500 — Server xatosi',
      message: "Ro'yxatni yuklashda xatolik yuz berdi",
      status: 500,
    });
  }
});

// ── API: pending ro'yxat (admin JS uchun) ──
router.get('/api/teachers/pending', async (req, res) => {
  try {
    const usersSnap = await fb.get(DB_PATHS.USERS);
    const pending = [];
    if (usersSnap.exists()) {
      const users = usersSnap.val();
      for (const [key, u] of Object.entries(users)) {
        if (u.role === 'teacher_pending') {
          pending.push({
            id: key,
            username: u.username || key,
            email: u.email || '',
            university: u.teacher_application?.university || '',
            reason: u.teacher_application?.reason || '',
            appliedAt: u.teacher_application?.appliedAt || u.created_at || 0,
          });
        }
      }
    }
    pending.sort((a, b) => a.appliedAt - b.appliedAt);
    // AUTH A-25 §11: approval holati + eslatma trigger
    for (const p of pending) {
      p.approval = approvalState(p.appliedAt);
      maybeSendWindowReminder({ userId: p.id, appliedAt: p.appliedAt }).catch(() => {});
    }
    res.json({ ok: true, pending });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── API: Tasdiqlash (teacher_pending → teacher) — AUTH A-25 Entra PIM ──
// Re-auth (10 daqiqa), justification (min 10), no self-approve, eskalatsiya.
router.post('/api/teachers/:id/approve', requireRecentAdminAuth, requireAdminMfaStepUp, async (req, res) => {
  try {
    const userId = safeKey(req.params.id);
    if (!userId) return res.status(400).json({ ok: false, error: 'invalid_user' });

    const snap = await fb.get(`users/${userId}/role`);
    const role = snap.exists() ? snap.val() : null;
    // Faqat teacher_pending holatidan tasdiqlash mumkin (oldindan o'tib bo'lmaydi)
    if (role !== 'teacher_pending') {
      return res.status(409).json({ ok: false, error: 'not_pending', role });
    }

    // AUTH A-25 §12: justification majburiy (min 10 belgi)
    const justification = parseJustification(req.body, null);
    if (!justification) {
      return res.status(400).json({ ok: false, error: 'justification_required' });
    }

    // AUTH A-25 §12/§11: o'z arizasini qaror qilmaslik + eskalatsiya
    const appSnap = await fb.get(`users/${userId}/teacher_application/appliedAt`);
    const appliedAt = appSnap.exists() ? appSnap.val() : 0;
    const allow = await assertDecisionAllowed(req, userId, appliedAt);
    if (!allow.ok) {
      return res.status(403).json({ ok: false, error: allow.error, message: allow.message });
    }

    // AUTH B-14 §09/§11: state machine service — transition + canonical record
    // + YAGONA audit (ip/userAgent/ageMs service'ga uzatiladi — dublikat yo'q)
    const now = Date.now();
    const decide = await decideTeacherApplication({
      userKey: userId,
      decision: 'approve',
      by: req.session?.admin?.username || 'admin',
      justification,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      ageMs: approvalState(appliedAt).ageMs,
    });
    if (!decide.ok) {
      return res.status(409).json({ ok: false, error: decide.error, role: decide.role });
    }

    // Xabar (A-19 §11): email/Telegram infra P2 — hozircha user record + audit
    await fb.set(`users/${userId}/notification_last`, {
      type: 'teacher_approved',
      message: 'Tabriklaymiz, o\'qituvchi sifatida tasdiqlandingiz!',
      at: now,
    }).catch(() => {});

    // AUTH A-23: teacher_approved email (user email bo'lsa; fire-and-forget)
    const userSnap = await fb.get(`users/${userId}`);
    const uData = userSnap.exists() ? userSnap.val() : {};
    if (uData.email && uData.email_verified) {
      const { renderTeacherApproved } = await import('../../src/modules/email/templates.js');
      const { sendEmail } = await import('../../src/modules/email/provider.js');
      const tpl = renderTeacherApproved({ username: uData.username || userId, lang: uData.lang || 'uz' });
      await sendEmail({
        to: uData.email,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
        tag: 'teacher_approved',
      }).catch((err) => console.warn('[email:teacher_approved] send failed:', err?.message || err));
    }

    // AUTH B-25 §06: rol o'zgarganda (teacher_pending → teacher) eski sessiyalar
    // revoke — pending holatida ochilgan sessiyalar yangi rolni bilmaydi.
    try {
      await revokeByUser(userId, { reason: 'teacher_approve' });
    } catch (_) { /* non-critical */ }
    // AUTH D-06 §06: teacher approval metric (Prometheus)
    try { recordMetric('auth_teacher_approval_total', 1, { type: 'counter', labels: { outcome: 'approved' } }); } catch (_) {}

    res.json({ ok: true, role: 'teacher' });
  } catch (err) {
    console.error('Teacher approve error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── API: Rad etish (teacher_pending → teacher_rejected + sabab) — A-25 ──
router.post('/api/teachers/:id/reject', requireRecentAdminAuth, requireAdminMfaStepUp, async (req, res) => {
  try {
    const userId = safeKey(req.params.id);
    if (!userId) return res.status(400).json({ ok: false, error: 'invalid_user' });

    // AUTH A-25 §12: justification majburiy (min 10 belgi) — sabab ham shu yerda
    const justification = parseJustification(req.body, null);
    if (!justification) {
      return res.status(400).json({ ok: false, error: 'justification_required' });
    }

    const snap = await fb.get(`users/${userId}/role`);
    const role = snap.exists() ? snap.val() : null;
    if (role !== 'teacher_pending') {
      return res.status(409).json({ ok: false, error: 'not_pending', role });
    }

    // AUTH A-25 §12/§11: o'z arizasini qaror qilmaslik + eskalatsiya
    const appSnap = await fb.get(`users/${userId}/teacher_application/appliedAt`);
    const appliedAt = appSnap.exists() ? appSnap.val() : 0;
    const allow = await assertDecisionAllowed(req, userId, appliedAt);
    if (!allow.ok) {
      return res.status(403).json({ ok: false, error: allow.error, message: allow.message });
    }

    // AUTH B-14 §09/§11: state machine service — transition + cooldown_until
    // + YAGONA audit (ip/userAgent/ageMs service'ga uzatiladi)
    const now = Date.now();
    const decide = await decideTeacherApplication({
      userKey: userId,
      decision: 'reject',
      by: req.session?.admin?.username || 'admin',
      justification,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      ageMs: approvalState(appliedAt).ageMs,
    });
    if (!decide.ok) {
      return res.status(409).json({ ok: false, error: decide.error, role: decide.role });
    }

    // Xabar (A-19 §12): sabab bilan — user record (email infra P2)
    await fb.set(`users/${userId}/notification_last`, {
      type: 'teacher_rejected',
      message: 'Arizangiz rad etildi',
      reason: justification,
      at: now,
    }).catch(() => {});

    // AUTH B-25 §06: rol o'zgarganda (teacher_pending → teacher_rejected)
    // eski sessiyalar ham revoke qilinadi.
    try {
      await revokeByUser(userId, { reason: 'teacher_reject' });
    } catch (_) { /* non-critical */ }
    // AUTH D-06 §06: teacher approval metric (Prometheus)
    try { recordMetric('auth_teacher_approval_total', 1, { type: 'counter', labels: { outcome: 'rejected' } }); } catch (_) {}

    res.json({ ok: true, role: 'teacher_rejected' });
  } catch (err) {
    console.error('Teacher reject error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
