/**
 * Deborah — QTI Import/Export API Routes
 *
 * REST API for QTI package import, staging, and export:
 *   - Upload & security validation
 *   - Parse & interaction mapping
 *   - Staging preview & review workflow
 *   - Commit to item bank
 *   - Export to QTI format
 */

import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  validateQtiPackage,
  computeQtiFileHash,
  validateManifestIntegrity,
} from '../src/modules/qti/qti-security.js';

import {
  parseQtiPackage,
} from '../src/modules/qti/qti-parser.js';

import {
  createQtiPackage,
  getQtiPackage,
  listQtiPackages,
  deleteQtiPackage,
  updateQtiPackage,
  createStagingItems,
  getStagingItems,
  getStagingItem,
  updateStagingItemReview,
  batchUpdateStagingReviews,
  commitQtiStaging,
  generateStagingReport,
  findExistingPackageByHash,
} from '../src/modules/qti/qti-staging.js';

import {
  exportItemToQti,
  exportAssessmentToQti,
  generateManifest,
} from '../src/modules/qti/qti-export.js';

const router = Router();

// ── Multer setup (temp directory for uploaded QTI packages) ──
const upload = multer({
  dest: path.join(os.tmpdir(), 'deborah-qti-uploads'),
  limits: { fileSize: 60 * 1024 * 1024 }, // 60MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.zip', '.qti', '.zipx'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only .zip, .qti, and .zipx files are allowed'));
    }
  },
});

// ═══════════════════════════════════════════════════════════════════
// PACKAGE UPLOAD & VALIDATION
// ═══════════════════════════════════════════════════════════════════

/**
 * POST /api/qti/upload — Upload a QTI package with security validation.
 */
router.post('/api/qti/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const filePath = req.file.path;
    const originalName = req.file.originalname;
    const mimeType = req.file.mimetype;
    const userId = req.session?.user?.id || req.session?.admin?.id;
    const targetBankId = req.body.target_bank_id ? parseInt(req.body.target_bank_id) : null;

    // ── 1. Security validation ──
    const securityResult = await validateQtiPackage(filePath, originalName, mimeType);
    if (!securityResult.ok) {
      // Clean up temp file
      try { fs.unlinkSync(filePath); } catch (_) { /* best effort */ }
      return res.status(400).json({ error: securityResult.errors.join('; '), details: securityResult });
    }

    // ── 2. Check for duplicate (idempotency) ──
    if (securityResult.hash) {
      const existing = await findExistingPackageByHash(securityResult.hash);
      if (existing) {
        // Clean up temp file
        try { fs.unlinkSync(filePath); } catch (_) { /* best effort */ }
        return res.status(200).json({
          message: 'Package already imported',
          existingPackageId: existing.id,
          status: existing.status,
        });
      }
    }

    // ── 3. Create package record ──
    const pkg = await createQtiPackage({
      original_filename: originalName,
      file_hash: securityResult.hash,
      file_size: securityResult.size,
      package_format: req.body.package_format || 'qti_21',
      status: 'validated',
      security_checks: Object.fromEntries(
        securityResult.results.map(r => [r.check, r.ok ? 'ok' : (r.warnings?.length ? 'warning' : 'failed')])
      ),
      warnings: securityResult.warnings,
      uploaded_by: userId,
      target_bank_id: targetBankId,
    });

    // ── 4. Extract and parse ──
    try {
      const extractDir = path.join(os.tmpdir(), `deborah-qti-extract-${pkg.id}`);
      if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true });
      fs.mkdirSync(extractDir, { recursive: true });

      // Extract ZIP
      const { execSync } = await import('child_process');
      try {
        execSync(`unzip -o "${filePath}" -d "${extractDir}" 2>&1`, { timeout: 30000 });
      } catch (err) {
        // Try with 7z as fallback
        try {
          execSync(`7z x "${filePath}" -o"${extractDir}" -y 2>&1`, { timeout: 30000 });
        } catch (_) {
          throw new Error('Failed to extract QTI package: no unzip or 7z available');
        }
      }

      // Read manifest
      let manifestXml = null;
      let manifestPath = path.join(extractDir, 'imsmanifest.xml');
      if (!fs.existsSync(manifestPath)) {
        // Try subdirectory
        const dirs = fs.readdirSync(extractDir).filter(d =>
          fs.statSync(path.join(extractDir, d)).isDirectory()
        );
        for (const dir of dirs) {
          const candidate = path.join(extractDir, dir, 'imsmanifest.xml');
          if (fs.existsSync(candidate)) {
            manifestXml = fs.readFileSync(candidate, 'utf-8');
            manifestPath = candidate;
            break;
          }
        }
      } else {
        manifestXml = fs.readFileSync(manifestPath, 'utf-8');
      }

      if (!manifestXml) {
        throw new Error('imsmanifest.xml not found in QTI package');
      }

      // Get all ZIP entries
      const zipEntries = [];
      function walkDir(dir, prefix) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relPath = prefix ? path.join(prefix, entry.name) : entry.name;
          if (entry.isDirectory()) walkDir(fullPath, relPath);
          else zipEntries.push(relPath);
        }
      }
      walkDir(extractDir, '');

      // Validate manifest integrity
      const integrityResult = validateManifestIntegrity(zipEntries, manifestXml);
      if (!integrityResult.ok) {
        await updateQtiPackage(pkg.id, { status: 'failed', errors: [integrityResult.error] });
        return res.status(400).json({ error: integrityResult.error });
      }

      // ── 5. Parse items ──
      const parseResult = await parseQtiPackage(extractDir, manifestXml, zipEntries);

      // Update package with parse results
      await updateQtiPackage(pkg.id, {
        status: 'parsed',
        parse_results: parseResult.report,
        manifest_json: parseResult.manifest || {},
        errors: [],
        warnings: [...securityResult.warnings, ...parseResult.warnings],
      });

      // ── 6. Create staging items ──
      const stagingItems = await createStagingItems(pkg.id, parseResult.items);

      await updateQtiPackage(pkg.id, { status: 'staging' });

      // Clean up temp files
      try { fs.unlinkSync(filePath); } catch (_) { /* best effort */ }
      try { fs.rmSync(extractDir, { recursive: true }); } catch (_) { /* best effort */ }

      res.status(201).json({
        packageId: pkg.id,
        status: 'staging',
        report: parseResult.report,
        itemsCount: stagingItems.length,
        stagingItems,
        warnings: parseResult.warnings,
      });

    } catch (parseErr) {
      await updateQtiPackage(pkg.id, { status: 'failed', errors: [parseErr.message] });
      try { fs.unlinkSync(filePath); } catch (_) { /* best effort */ }
      res.status(400).json({ error: `Parse failed: ${parseErr.message}`, packageId: pkg.id });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// PACKAGE LISTING & DETAILS
// ═══════════════════════════════════════════════════════════════════

router.get('/api/qti/packages', async (req, res) => {
  try {
    const packages = await listQtiPackages({
      status: req.query.status,
      limit: parseInt(req.query.limit || '50'),
      offset: parseInt(req.query.offset || '0'),
    });
    res.json(packages);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/api/qti/packages/:id', async (req, res) => {
  try {
    const pkg = await getQtiPackage(parseInt(req.params.id));
    if (!pkg) return res.status(404).json({ error: 'Package not found' });
    res.json(pkg);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/api/qti/packages/:id', async (req, res) => {
  try {
    const result = await deleteQtiPackage(
      parseInt(req.params.id),
      req.session?.user?.id || req.session?.admin?.id
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// STAGING ITEMS
// ═══════════════════════════════════════════════════════════════════

router.get('/api/qti/packages/:id/staging', async (req, res) => {
  try {
    const items = await getStagingItems(parseInt(req.params.id));
    res.json(items);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/api/qti/staging/:id', async (req, res) => {
  try {
    const item = await getStagingItem(parseInt(req.params.id));
    if (!item) return res.status(404).json({ error: 'Staging item not found' });
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/api/qti/staging/:id/review', async (req, res) => {
  try {
    const result = await updateStagingItemReview(parseInt(req.params.id), {
      reviewStatus: req.body.review_status,
      reviewNotes: req.body.review_notes,
      userId: req.session?.user?.id || req.session?.admin?.id,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/api/qti/staging/batch-review', async (req, res) => {
  try {
    const items = (req.body.items || []).map(item => ({
      id: parseInt(item.id),
      reviewStatus: item.review_status,
      reviewNotes: item.review_notes,
    }));
    const results = await batchUpdateStagingReviews(
      items,
      req.session?.user?.id || req.session?.admin?.id
    );
    res.json({ results });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// COMMIT TO ITEM BANK
// ═══════════════════════════════════════════════════════════════════

router.post('/api/qti/packages/:id/commit', async (req, res) => {
  try {
    const packageId = parseInt(req.params.id);
    const targetBankId = req.body.target_bank_id
      ? parseInt(req.body.target_bank_id)
      : null;

    if (!targetBankId) {
      return res.status(400).json({ error: 'target_bank_id is required' });
    }

    const result = await commitQtiStaging(
      packageId,
      targetBankId,
      req.session?.user?.id || req.session?.admin?.id
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// STAGING REPORT
// ═══════════════════════════════════════════════════════════════════

router.get('/api/qti/packages/:id/report', async (req, res) => {
  try {
    const report = await generateStagingReport(parseInt(req.params.id));
    if (!report) return res.status(404).json({ error: 'Package not found' });
    res.json(report);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════

router.post('/api/qti/export/item', async (req, res) => {
  try {
    const xml = exportItemToQti(req.body.item, {
      includePrivateKey: req.body.include_private_key === true,
    });
    res.type('application/xml').send(xml);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/api/qti/export/assessment', async (req, res) => {
  try {
    const xml = exportAssessmentToQti(req.body.assessment);
    res.type('application/xml').send(xml);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/api/qti/export/manifest', async (req, res) => {
  try {
    const xml = generateManifest(req.body.manifest);
    res.type('application/xml').send(xml);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
