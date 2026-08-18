/**
 * AUTH B-36 — Teacher extra: appeal, co-teacher, bulk invite
 * ---------------------------------------------------------------------------
 *  POST /api/teacher/appeal            — rad etilgan teacher apellyatsiyasi
 *  POST /api/teacher/co-teachers       — asosiy teacher co-teacher qo'shadi
 *  POST /api/teacher/co-teachers/remove— asosiy teacher olib tashlaydi
 *  GET  /api/teacher/co-teachers       — kurs scope'ida ro'yxat (owner/co)
 *  POST /admin/api/teachers/bulk-invite— admin: CSV/XLSX → batch teacher invite
 *
 * Security: appeal faqat teacher_rejected (cooldown o'tgach); co-teacher faqat
 * approved teacher + kurs owner; co_teacher admin emas (escalation yo'q).
 */
import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { isApprovedTeacher } from '../middleware/roles.js';
import { submitTeacherApplication, getCooldownUntil, TEACHER_COOLDOWN_MS } from '../src/modules/auth/teacher-approval.js';
import { logAuthEvent, AUDIT_ACTIONS } from '../src/modules/auth/audit.js';
import { recordMetric } from '../src/telemetry/index.js';
import {
  addCoTeacher, removeCoTeacher, listCoTeachers, isCourseTeacher,
} from '../src/modules/teacher/co-teacher.js';
import { parseBulkTeacherFile, createBulkTeacherInvites, BULK_MAX_PER_BATCH } from '../src/modules/roster/bulk-invite.js';
import { fb } from '../firebase/admin.js';

const router = Router();

// ── Multer: bulk fayl yuklash (xotiraga emas — diskka, 2MB cap) ──
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deborah-bulk-'));
const upload = multer({
  storage: multer.diskStorage({ destination: uploadDir }),
  limits: { fileSize: 2 * 1024 * 1024 },
});

// ═══════════════════════════════════════════════════════════════════
// §11/§12 — Appeal: rad etilgan teacher apellyatsiyasi
// ═══════════════════════════════════════════════════════════════════
router.post('/api/teacher/appeal', requireAuth, async (req, res) => {
  try {
    const userKey = req.session.user.safeKey;
    const userSnap = await fb.get(`users/${userKey}`).catch(() => null);
    const role = userSnap && userSnap.exists() ? userSnap.val().role : null;
    if (role !== 'teacher_rejected') {
      return res.status(403).json({ ok: false, error: 'only_rejected_teacher' });
    }

    // §11: cooldown o'tgan bo'lishi shart (B-16 §14)
    const decidedAt = userSnap.val().teacher_decision_at || 0;
    const until = getCooldownUntil(decidedAt);
    if (Date.now() < until) {
      const remainingMs = until - Date.now();
      await logAuthEvent({
        action: AUDIT_ACTIONS.TEACHER_COOLDOWN_BLOCK,
        outcome: 'blocked',
        method: 'appeal',
        actorId: userKey,
        details: { remainingMs },
      }).catch(() => {});
      return res.status(429).json({
        ok: false, error: 'cooldown_active',
        retryAfter: Math.ceil(remainingMs / 1000),
      });
    }

    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (reason.length < 20 || reason.length > 500) {
      return res.status(400).json({ ok: false, error: 'reason_length' });
    }
    if (/<[a-z][\s\S]*>/i.test(reason) || /javascript:/i.test(reason)) {
      return res.status(400).json({ ok: false, error: 'invalid_reason' });
    }

    const u = userSnap.val();
    const result = await submitTeacherApplication({
      userKey,
      username: u.username || userKey,
      email: u.email || '',
      name: u.display_name || u.username || '',
      university: u.teacher_application?.university || '',
      subject: u.teacher_application?.subject || '',
      experience: String(u.teacher_application?.experience || ''),
      reason,
      lang: u.settings?.lang || 'uz',
      appeal: true,
    });
    if (!result.ok) {
      return res.status(result.error === 'duplicate_application' ? 409 : 400)
        .json({ ok: false, error: result.error });
    }

    // §12: apellyatsiya = qayta ko'rib chiqish — rol teacher_pending'ga
    // qaytadi (admin queue B-29 uni ko'radi); rejection marker tozalanadi.
    const roleVersion = Date.now();
    await fb.set(`users/${userKey}/role`, 'teacher_pending');
    await fb.set(`users/${userKey}/role_version`, roleVersion);
    await fb.remove(`users/${userKey}/teacher_rejection_reason`).catch(() => {});
    await fb.remove(`users/${userKey}/teacher_cooldown_until`).catch(() => {});
    if (req.session.user) {
      req.session.user.role = 'teacher_pending';
      req.session.user.roleVersion = roleVersion;
    }

    // §16: appeal_created audit + metric
    await logAuthEvent({
      action: AUDIT_ACTIONS.APPEAL_CREATED,
      outcome: 'success',
      method: 'user',
      actorId: userKey,
      details: { appId: result.appId },
    }).catch(() => {});
    try {
      recordMetric('auth.teacher_appeal_created', 1, { type: 'counter' });
    } catch (_) { /* fail-soft */ }

    return res.json({ ok: true, appId: result.appId });
  } catch (err) {
    console.error('[teacher:appeal]', err?.message || err);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// §09/§10 — Co-teacher (owner-scoped, max 3, invite-based)
// ═══════════════════════════════════════════════════════════════════
router.post('/api/teacher/co-teachers', requireAuth, async (req, res) => {
  try {
    const userKey = req.session.user.safeKey;
    const role = req.session.user.role;
    if (!isApprovedTeacher(role)) {
      return res.status(403).json({ ok: false, error: 'teacher_only' });
    }
    const { courseCode, email, name } = req.body || {};
    if (!courseCode || !email) {
      return res.status(400).json({ ok: false, error: 'course_email_required' });
    }
    const r = await addCoTeacher({
      ownerKey: userKey,
      courseCode,
      email,
      name: typeof name === 'string' ? name : '',
      lang: req.session.user.lang || 'uz',
    });
    if (!r.ok) {
      const code = r.error === 'course_owned' ? 403
        : (r.error === 'co_teacher_limit' ? 409 : 400);
      return res.status(code).json({ ok: false, error: r.error });
    }
    return res.json({ ok: true, ...(r.token ? { devToken: r.token } : {}) });
  } catch (err) {
    console.error('[teacher:co-teachers]', err?.message || err);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

router.post('/api/teacher/co-teachers/remove', requireAuth, async (req, res) => {
  try {
    const userKey = req.session.user.safeKey;
    const { courseCode, coTeacherKey } = req.body || {};
    if (!courseCode || !coTeacherKey) {
      return res.status(400).json({ ok: false, error: 'invalid_input' });
    }
    const r = await removeCoTeacher({ ownerKey: userKey, courseCode, coTeacherKey });
    if (!r.ok) {
      const code = r.error === 'forbidden' ? 403 : (r.error === 'not_found' ? 404 : 400);
      return res.status(code).json({ ok: false, error: r.error });
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

router.get('/api/teacher/co-teachers', requireAuth, async (req, res) => {
  try {
    const userKey = req.session.user.safeKey;
    const courseCode = typeof req.query.courseCode === 'string' ? req.query.courseCode : '';
    // Scope: faqat owner yoki shu kursning co-teacher'i ko'radi (IDOR yo'q)
    const allowed = await isCourseTeacher(userKey, courseCode);
    if (!allowed) return res.status(403).json({ ok: false, error: 'forbidden' });
    const r = await listCoTeachers(courseCode);
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
    return res.json({ ok: true, owner: r.owner, coTeachers: r.coTeachers });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// §06/§07 — Bulk teacher invite (admin)
// ═══════════════════════════════════════════════════════════════════
router.post('/admin/api/teachers/bulk-invite', requireAdmin, upload.single('file'), async (req, res) => {
  let filePath = null;
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'file_required' });
    filePath = req.file.path;
    if (!/\.(csv|xlsx|xls)$/i.test(req.file.originalname || '')) {
      return res.status(400).json({ ok: false, error: 'csv_or_xlsx_only' });
    }

    const { rows, invalid } = await parseBulkTeacherFile(filePath);
    const result = await createBulkTeacherInvites({
      rows,
      by: req.session.admin?.username || req.session.user?.safeKey || null,
      lang: req.query.lang || 'uz',
    });

    return res.json({
      ok: true,
      report: {
        parsed: rows.length,
        created: result.created,
        skipped: result.skipped,
        invalid: invalid.length,
        errors: result.errors.slice(0, 20), // xato ro'yxati (§23)
        invalidRows: invalid.slice(0, 20),
        maxPerBatch: BULK_MAX_PER_BATCH,
      },
    });
  } catch (err) {
    console.error('[teacher:bulk-invite]', err?.message || err);
    return res.status(500).json({ ok: false, error: 'server' });
  } finally {
    if (filePath) fs.unlink(filePath).catch(() => {});
  }
});

export default router;
