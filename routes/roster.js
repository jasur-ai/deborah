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
import { requireAuth } from '../middleware/auth.js';
import { validateRosterFile } from '../src/modules/roster/validator.js';
import { parseRosterFile } from '../src/modules/roster/parser.js';
import {
  createStagingSession, getStagingSession, listStagingSessions,
  addParsedRows, generateParseReport, getParsedRows,
  commitStagingSession, deleteStagingSession,
  rollbackStagingSession, exportRowErrors, setSessionApproval,
} from '../src/modules/roster/staging.js';
import {
  detectColumnMapping, saveColumnMapping,
  loadColumnMapping, validateMappingCompleteness,
  validateRequiredFields, detectFileDuplicates,
  validateReferentialIntegrity, generateDiff,
  generatePreview, computeRosterHash,
} from '../src/modules/roster/mapper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const router = Router();

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
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }, // 10MB max, 1 file
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
router.use('/api/roster', requireAuth);

// ═══════════════════════════════════════════════════════════════════
// POST /api/roster/upload — Upload + parse + stage
// ═══════════════════════════════════════════════════════════════════

router.post('/api/roster/upload', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Fayl hajmi 10 MB dan oshmasligi kerak' });
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) return res.status(400).json({ error: 'Fayl yuklanmadi' });

    try {
      const filePath = req.file.path;
      const originalName = req.file.originalname;
      const mimeType = req.file.mimetype;

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
        uploadedBy: req.session?.user?.username || 'anonymous',
        totalRows: parseResult.totalRows,
        totalSheets: parseResult.totalSheets,
        warnings: [...(validation.warnings || []), ...(parseResult.warnings || [])],
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

router.post('/api/roster/sessions/:id/commit', async (req, res) => {
  try {
    const userId = req.session?.user?.username || 'admin';
    const result = await commitStagingSession(req.params.id, userId);
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
