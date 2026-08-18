/**
 * Edikit — Roster Upload & Staging API Routes
 *
 * Endpoints:
 *   POST   /api/roster/upload     — Upload and parse a roster file (XLSX/CSV)
 *   GET    /api/roster/sessions   — List staging sessions
 *   GET    /api/roster/sessions/:id      — Get staging session details
 *   GET    /api/roster/sessions/:id/report — Get parse report
 *   GET    /api/roster/sessions/:id/rows — Get parsed rows
 *   POST   /api/roster/sessions/:id/commit — Commit staging session
 *   DELETE /api/roster/sessions/:id      — Delete staging session
 *
 * All endpoints require authentication.
 */

import { Router } from 'express';
import multer from 'multer';
import { fb } from '../firebase/admin.js';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { requireAuth, requireMfaStepUp } from '../middleware/auth.js';
import { audit, AUDIT_ACTIONS } from '../src/modules/auth/audit.js';
// AUTH B-12: invite sahifasi i18n (4 til)
import { AUTH_COPY, AUTH_LANGS, resolveAuthLang } from '../data/auth-i18n.js';
import { validateRosterFile, ROSTER_CONFIG } from '../src/modules/roster/validator.js';
import { parseRosterFile } from '../src/modules/roster/parser.js';
import {
  createStagingSession, getStagingSession, listStagingSessions,
  addParsedRows, generateParseReport, getParsedRows,
  commitStagingSession, deleteStagingSession,
  rollbackStagingSession, exportRowErrors, setSessionApproval,
  purgeExpiredStagingSessions,
  buildRowStatusReport, reconcileSession,
} from '../src/modules/roster/staging.js';
import {
  createInvitesForSession,
  acceptInvite,
  revokeInvite,
  listInvites,
  getPendingInviteSummary,
  sendInviteEmails,
  expireOverdueInvites,
  checkInviteSendLimit,
  getInviteByHash,
} from '../src/modules/roster/invites.js';
import {
  detectColumnMapping, saveColumnMapping,
  loadColumnMapping, validateMappingCompleteness,
  validateRequiredFields, detectFileDuplicates,
  validateReferentialIntegrity, generateDiff,
  generatePreview, computeRosterHash,
} from '../src/modules/roster/mapper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const router = Router();

// ── C-11: Roster auth — student (requireAuth) YOKI admin sessiyasi ──
// Admin UI (/admin/roster) roster API'larini chaqiradi; admin sessiyasida
// req.session.user yo'q (faqat req.session.admin) — shuning uchun admin
// ham o'tkaziladi (privileged session ⊃ student scope). Global requireAuth
// O'ZGARTIRILMAYDI — bu faqat roster route'lariga xos.
function requireRosterAuth(req, res, next) {
  if (req.session && req.session.admin) return next();
  return requireAuth(req, res, next);
}

// Commit uchun MFA step-up — admin sessiyasi o'z MFA'ni /admin darajasida
// o'tkazgan (requireAdmin + admin MFA), bu yerda student MFA talab qilinmaydi.
function requireRosterMfaStepUp(req, res, next) {
  if (req.session && req.session.admin) return next();
  return requireMfaStepUp(req, res, next);
}

// ── Teacher/Admin rol tekshiruvi (AUTH A-11 review fix: invite PII IDOR) ──
// Invite route'lari email/identity kabi PII qaytaradi — har qanday student
// emas, faqat teacher/admin/board ko'ra olishi kerak.
function requireRosterManager(req, res, next) {
  const role = req.session?.user?.role;
  if (req.session?.admin?.username || ['teacher', 'admin', 'board'].includes(role)) {
    return next();
  }
  return res.status(403).json({ error: 'Forbidden: teacher/admin required' });
}

// ── Multer: temporary upload directory ──
const uploadDir = path.resolve(os.tmpdir(), 'edikit-roster-uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    cb(null, `roster-${unique}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: ROSTER_CONFIG.maxFileSize, files: 1 }, // config: 10MB max, 1 file
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.csv'].includes(ext)) return cb(null, true);
    cb(new Error(`Invalid file type: ${ext}. Only .xlsx and .csv are allowed.`));
  },
});

// ── All roster endpoints require auth. Scoped to THIS router's own
//    /api/roster/* namespace (NOT the bare /api prefix) — a bare
//    router.use('/api', requireAuth) would also intercept /api/admin/*
//    routes from other routers and 401 them even with a valid admin
//    session (requireAuth only accepts student sessions). ──

// AUTH B-12 §07/§08: invite link — GET /invite/:token (PUBLIC, no-referrer).
// Token validatsiya: mavjud, 7 kun ichida, ishlatilmagan, revoke emas →
// invite.ejs render; aks holda aniq xato UX (muddati o'tgan → yangi so'rash).
// Brute-force qarshi per-IP rate limit (B-12 §15/§27).
const INVITE_VIEW_MAX = 30; // 30/15 daqiqa per IP
const INVITE_VIEW_WINDOW_MS = 15 * 60 * 1000;
const inviteViewAttempts = new Map(); // ip -> [timestamps]
function checkInviteViewLimit(ip) {
  const now = Date.now();
  const key = String(ip || 'unknown');
  const arr = (inviteViewAttempts.get(key) || []).filter((t) => now - t < INVITE_VIEW_WINDOW_MS);
  if (arr.length >= INVITE_VIEW_MAX) return { allowed: false };
  arr.push(now);
  inviteViewAttempts.set(key, arr);
  if (inviteViewAttempts.size > 5000) {
    const oldest = inviteViewAttempts.keys().next().value;
    inviteViewAttempts.delete(oldest);
  }
  return { allowed: true };
}

router.get('/invite/:token', async (req, res) => {
  // §10: Referrer-Policy no-referrer + token URL'da log'ga tushmasligi uchun
  res.setHeader('Referrer-Policy', 'no-referrer');

  // AUTH B-12 §15: per-IP brute-force rate limit
  const viewLimit = checkInviteViewLimit(req.ip);
  if (!viewLimit.allowed) {
    return res.status(429).render('error', {
      title: '429',
      message: "Ko'p urinish — 15 daqiqadan keyin qayta urinib ko'ring",
      status: 429,
    });
  }

  const lang = resolveAuthLang(req.query.lang || req.cookies?.lang);
  const copy = AUTH_COPY[lang];

  try {
    const result = await getInviteByHash(req.params.token);

    // AUTH B-12 §17: invite_view audit (har ko'rish emas — valid/invalid
    // faqat bitta record; audit spam bo'lmasligi uchun invalid'da ham bir marta)
    await audit({
      action: AUDIT_ACTIONS.INVITE_VIEW,
      outcome: result.ok ? 'success' : 'blocked',
      resourceType: 'roster_invite',
      resourceId: req.params.token,
      details: { ok: result.ok, reason: result.ok ? null : result.error },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});

    if (!result.ok) {
      // B-12 §08: aniq xato UX — muddati o'tgan va ishlatilgan alohida
      const expired = String(result.error || '').includes('muddati');
      const used = String(result.error || '').includes('ishlatilgan');
      return res.status(404).render('error', {
        title: '404',
        message: used
          ? copy.invite.errors.used
          : (expired ? copy.invite.errors.expired : copy.invite.errors.invalid),
        status: 404,
        linkText: copy.invite.requestNew,
      });
    }

    // B-12 §06: to'liq aktivatsiya sahifasi
    return res.render('user/invite', {
      title: copy.invite.title,
      description: copy.invite.sub,
      lang,
      AUTH_LANGS,
      copy,
      csrfToken: res.locals.csrfToken || '',
      oidcEnabled: true, // B-10: oidc router mount qilingan; link /auth/google
      tokenHash: req.params.token,
      inviteInfo: result.invite,
    });
  } catch (err) {
    res.status(500).render('error', { title: '500', message: err.message, status: 500 });
  }
});

// AUTH A-11 §13 — Invite aktivatsiyasi (PUBLIC — student session talab qilmaydi).
// requireAuth'dan OLDIN mount qilinadi; CSRF exemption server.js'da.
router.post('/api/roster/invites/accept', async (req, res) => {
  try {
    const result = await acceptInvite({
      token: req.body?.token,
      username: req.body?.username,
      password: req.body?.password,
      email: req.body?.email,
      // AUTH D-24 §10: qonuniy rozilik (forma checkbox) — majburiy
      consent: req.body?.consent,
    });
    if (!result.ok) {
      // AUTH B-13 §10: takroriy ishlatilgan invite → 409 Conflict
      const conflict = String(result.error || '').includes('ishlatilgan');
      return res.status(conflict ? 409 : 400).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.use('/api/roster', requireRosterAuth);

// ═══════════════════════════════════════════════════════════════════
// POST /api/roster/upload — Upload + parse + stage
// ═══════════════════════════════════════════════════════════════════

router.post('/api/roster/upload', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `Fayl hajmi ${ROSTER_CONFIG.maxFileSize / 1024 / 1024} MB dan oshmasligi kerak` });
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) return res.status(400).json({ error: 'Fayl yuklanmadi' });

    try {
      const filePath = req.file.path;
      const originalName = req.file.originalname;
      const mimeType = req.file.mimetype;
      const userId = req.session?.user?.username || 'anonymous';

      // A-10 §26: 24 soat retention — muddati o'tgan staging sessiyalarni tozalash (fail-soft)
      purgeExpiredStagingSessions().catch(() => {});

      // 1. Validate file (security checks)
      const validation = await validateRosterFile(filePath, originalName, mimeType);
      if (!validation.ok) {
        // Clean up temp file
        try { fs.unlinkSync(filePath); } catch (_) {}
        return res.status(400).json({ error: validation.errors.join('; '), details: validation.results });
      }

      // 2. Parse the file
      const parseResult = parseRosterFile(filePath, validation.extension);
      if (parseResult.errors.length > 0 && parseResult.totalRows === 0) {
        try { fs.unlinkSync(filePath); } catch (_) {}
        return res.status(400).json({ error: 'Faylni parse qilishda xatolik', details: parseResult.errors });
      }

      // 3. Create staging session
      const sessionId = await createStagingSession({
        filename: originalName,
        extension: validation.extension,
        fileSize: validation.size,
        uploadedBy: userId,
        totalRows: parseResult.totalRows,
        totalSheets: parseResult.totalSheets,
        warnings: [...(validation.warnings || []), ...(parseResult.warnings || [])],
      });

      // A-10 §16: privileged action audit (roster_uploaded + roster_parse)
      await audit({
        action: AUDIT_ACTIONS.ROSTER_UPLOADED,
        userId,
        resourceType: 'roster_staging',
        resourceId: sessionId,
        details: {
          filename: originalName,
          extension: validation.extension,
          size: validation.size,
          totalRows: parseResult.totalRows,
        },
      });
      await audit({
        action: AUDIT_ACTIONS.ROSTER_PARSE,
        userId,
        resourceType: 'roster_staging',
        resourceId: sessionId,
        details: {
          sheets: parseResult.totalSheets,
          rows: parseResult.totalRows,
          errors: parseResult.errors.length,
          warnings: (parseResult.warnings || []).length,
        },
      });

      // 4. Store parsed rows in staging
      for (const sheet of parseResult.sheets) {
        await addParsedRows(sessionId, sheet.name, sheet.rows);
      }

      // 5. Generate report
      const report = await generateParseReport(sessionId);

      // 6. Clean up temp file
      try { fs.unlinkSync(filePath); } catch (_) {}

      res.status(201).json({
        ok: true,
        sessionId,
        report,
      });
    } catch (err) {
      // Clean up temp file on error
      try { if (req.file) fs.unlinkSync(req.file.path); } catch (_) {}
      res.status(500).json({ error: err.message });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/roster/sessions — List staging sessions
// ═══════════════════════════════════════════════════════════════════

router.get('/api/roster/sessions', async (req, res) => {
  try {
    const sessions = await listStagingSessions({
      status: req.query.status,
      limit: parseInt(req.query.limit) || 20,
    });
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/roster/sessions/:id — Get session details
// ═══════════════════════════════════════════════════════════════════

router.get('/api/roster/sessions/:id', async (req, res) => {
  try {
    const session = await getStagingSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/roster/sessions/:id/report — Parse report
// ═══════════════════════════════════════════════════════════════════

router.get('/api/roster/sessions/:id/report', async (req, res) => {
  try {
    const report = await generateParseReport(req.params.id);
    if (report.error) return res.status(404).json(report);
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/roster/sessions/:id/rows — Get parsed rows
// ═══════════════════════════════════════════════════════════════════

router.get('/api/roster/sessions/:id/rows', async (req, res) => {
  try {
    const rows = await getParsedRows(req.params.id, req.query.sheet);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/roster/sessions/:id/commit — Commit staging to DB
// ═══════════════════════════════════════════════════════════════════

// AUTH A-30 §09: roster commit — fresh MFA shart (teacher viaMfa / admin
// step-up). MFA yoqilmagan sessiya (viaMfa yo'q) o'tadi — regression yo'q.
router.post('/api/roster/sessions/:id/commit', requireRosterMfaStepUp, async (req, res) => {
  try {
    const userId = req.session?.user?.username || 'admin';
    // AUTH A-11 §10: idempotency hash — /preview dan olinadi; qayta commit
    // (bir xil hash) reject qilinadi.
    const result = await commitStagingSession(req.params.id, userId, {
      hash: req.body?.hash || null,
    });
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/roster/sessions/:id/map — Detect/apply column mapping
// ═══════════════════════════════════════════════════════════════════

router.post('/api/roster/sessions/:id/map', async (req, res) => {
  try {
    const sessionId = req.params.id;
    const { mapping } = req.body;

    // Get parsed rows
    const rows = await getParsedRows(sessionId);
    if (!rows || rows.length === 0) {
      return res.status(400).json({ error: 'No parsed rows found. Upload a file first.' });
    }

    let result;

    if (mapping) {
      // Admin provided explicit mapping — save it
      await saveColumnMapping(sessionId, mapping);
      const completeness = validateMappingCompleteness(mapping);
      result = { mapping, autoDetected: false, completeness };
    } else {
      // Auto-detect mapping
      const existingMapping = await loadColumnMapping(sessionId);
      result = await detectColumnMapping(rows, existingMapping?.mapping);
      result.autoDetected = true;

      // Auto-save if all columns mapped
      if (result.unmapped.length === 0) {
        await saveColumnMapping(sessionId, result.mapping);
      }
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/roster/sessions/:id/preview — Get admin preview
// ═══════════════════════════════════════════════════════════════════

router.get('/api/roster/sessions/:id/preview', async (req, res) => {
  try {
    const sessionId = req.params.id;

    // Load mapping
    const savedMapping = await loadColumnMapping(sessionId);
    if (!savedMapping) {
      return res.status(400).json({ error: 'No column mapping found. POST /map first.' });
    }
    const mapping = savedMapping.mapping;

    // Check completeness
    const completeness = validateMappingCompleteness(mapping);

    // Get parsed rows
    const rows = await getParsedRows(sessionId);
    if (!rows || rows.length === 0) {
      return res.status(400).json({ error: 'No parsed rows found.' });
    }

    // Validate required fields
    const requiredValidation = validateRequiredFields(rows, mapping);

    // Detect duplicates
    const duplicates = detectFileDuplicates(rows, mapping);

    // Check referential integrity
    const refIntegrity = await validateReferentialIntegrity(rows, mapping);

    // Load existing state for diff
    const usersSnap = await fb.get('users');
    const enrollmentsSnap = await fb.get('enrollments');
    const groupsSnap = await fb.get('groups');

    const existingState = {
      users: usersSnap.exists() ? usersSnap.val() : {},
      enrollments: enrollmentsSnap.exists() ? enrollmentsSnap.val() : {},
      groups: groupsSnap.exists() ? groupsSnap.val() : {},
    };

    // Generate diff
    const diff = generateDiff(rows, mapping, existingState);

    // Generate preview text
    const preview = generatePreview(diff);

    // Compute idempotency hash
    const hash = computeRosterHash(rows, mapping);

    res.json({
      sessionId,
      mapping,
      completeness,
      validation: {
        requiredFields: requiredValidation,
        duplicates,
        referentialIntegrity: refIntegrity,
      },
      diff,
      preview,
      hash,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/roster/sessions/:id/approve — Admin approval
// ═══════════════════════════════════════════════════════════════════

router.post('/api/roster/sessions/:id/approve', async (req, res) => {
  try {
    const { approve } = req.body;
    const userId = req.session?.user?.username || 'admin';
    await setSessionApproval(req.params.id, approve !== false, userId);
    res.json({ ok: true, approved: approve !== false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/roster/sessions/:id/rollback — Rollback commit
// ═══════════════════════════════════════════════════════════════════

router.post('/api/roster/sessions/:id/rollback', async (req, res) => {
  try {
    const result = await rollbackStagingSession(req.params.id);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/roster/sessions/:id/errors/download — Export row errors
// ═══════════════════════════════════════════════════════════════════

router.get('/api/roster/sessions/:id/errors/download', async (req, res) => {
  try {
    const result = await exportRowErrors(req.params.id);
    if (result.error) return res.status(404).json(result);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="roster-errors-${req.params.id}.json"`);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// AUTH A-11 §11/§29 — Row status + reconciliation
// ═══════════════════════════════════════════════════════════════════

router.get('/api/roster/sessions/:id/rows/status', async (req, res) => {
  try {
    const report = await buildRowStatusReport(req.params.id);
    if (report.error) return res.status(404).json(report);
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/roster/sessions/:id/reconcile', async (req, res) => {
  try {
    const result = await reconcileSession(req.params.id);
    if (result.error) return res.status(404).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// AUTH A-11 §13-15 — Invite boshqaruvi (auth talab qiladi)
// ═══════════════════════════════════════════════════════════════════

// Invite boshqaruvi — teacher/admin rol talab qiladi (PII: email/identity)
// AUTH B-11 §13: invite yaratish rate limit — 50/soat per teacher.
router.post('/api/roster/sessions/:id/invites', requireRosterManager, (req, res, next) => {
  const limit = checkInviteSendLimit(req.session?.user?.safeKey || req.session?.user?.username || 'roster-manager');
  if (!limit.allowed) {
    return res.status(429).json({ error: 'Invite limit: 50/soat', retryAfterSeconds: limit.retryAfterSeconds });
  }
  next();
}, async (req, res) => {
  try {
    const result = await createInvitesForSession(req.params.id, {
      channel: req.body?.channel || 'email',
    });
    if (!result.ok) return res.status(400).json(result);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AUTH B-11 §09: invite email'larini yuborish (batch, idempotent).
// Auto-send: createInvitesForSession emas, alohida route — teacher nazorat
// qiladi; abuse qarshi bir xil 50/soat limit.
router.post('/api/roster/invites/send', requireRosterManager, (req, res, next) => {
  const limit = checkInviteSendLimit(req.session?.user?.safeKey || req.session?.user?.username || 'roster-manager');
  if (!limit.allowed) {
    return res.status(429).json({ error: 'Invite limit: 50/soat', retryAfterSeconds: limit.retryAfterSeconds });
  }
  next();
}, async (req, res) => {
  try {
    const result = await sendInviteEmails({
      inviteIds: Array.isArray(req.body?.inviteIds) ? req.body.inviteIds : null,
      lang: req.body?.lang || 'uz',
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AUTH B-11 §12: expiry job trigger (server boot'da ham ishlaydi; admin
// qo'lda chaqirishi uchun route ham bor).
router.post('/api/roster/invites/expire-overdue', requireRosterManager, async (req, res) => {
  try {
    const result = await expireOverdueInvites();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/roster/sessions/:id/invites', requireRosterManager, async (req, res) => {
  try {
    const result = await listInvites(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/roster/invites/:tokenHash/revoke', requireRosterManager, async (req, res) => {
  try {
    const result = await revokeInvite(req.params.tokenHash);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Teacher (P1): "N talaba aktivatsiya qilmadi" summary
router.get('/api/roster/invites/pending-summary', requireRosterManager, async (req, res) => {
  try {
    res.json(await getPendingInviteSummary());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// DELETE /api/roster/sessions/:id — Delete staging session
// ═══════════════════════════════════════════════════════════════════

router.delete('/api/roster/sessions/:id', async (req, res) => {
  try {
    const result = await deleteStagingSession(req.params.id);
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
