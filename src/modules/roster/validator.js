/**
 * Edikit — Roster File Validator
 *
 * Security validation for uploaded roster files (XLSX/CSV):
 *   1. Extension allowlist (.xlsx, .csv)
 *   2. MIME type validation
 *   3. Magic bytes / file signature verification
 *   4. File size limits (per file, per row, per cell)
 *   5. Macro / external relation detection (XLSX)
 *   6. ZIP bomb ratio check (XLSX is a ZIP archive)
 *   7. Antivirus / quarantine interface
 *
 * ESM-compatible: uses dynamic import for child_process to avoid ESM/CJS conflicts.
 * Gracefully degrades when external tools (unzip, ClamAV) are unavailable.
 */

import fs from 'fs';
import path from 'path';

// ── Lazy child_process (ESM-safe) ──
let _execSync = null;
try {
  // Dynamic import is ESM-safe; falls back to null if unavailable
  _execSync = (await import('child_process')).execSync;
} catch (_) { /* child_process not available */ }

// ── Configuration ──
export const ROSTER_CONFIG = {
  maxFileSize: 10 * 1024 * 1024,    // 10 MB
  maxRows: 5000,
  maxColumns: 100,
  maxCellLength: 1000,
  maxSheets: 10,
  maxZipRatio: 50,
  allowedExtensions: ['.xlsx', '.csv'],
  allowedMimeTypes: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv', 'application/csv', 'text/plain',
  ],
  magicBytes: { xlsx: [0x50, 0x4B, 0x03, 0x04], csv: null },
};

// ── Validation Result ──
export class ValidationResult {
  constructor({ ok, error, warnings = [], details = {} }) {
    this.ok = ok; this.error = error; this.warnings = warnings; this.details = details;
  }
  static pass(d) { return new ValidationResult({ ok: true, details: d || {} }); }
  static fail(e, w) { return new ValidationResult({ ok: false, error: e, warnings: w || [] }); }
}

export function validateExtension(filename) {
  if (!filename || typeof filename !== 'string') return ValidationResult.fail('Filename is required');
  const ext = path.extname(filename).toLowerCase();
  if (!ROSTER_CONFIG.allowedExtensions.includes(ext)) return ValidationResult.fail(`Invalid extension "${ext}". Allowed: ${ROSTER_CONFIG.allowedExtensions.join(', ')}`);
  return ValidationResult.pass({ extension: ext });
}

export function validateMimeType(mimeType) {
  if (!mimeType) return ValidationResult.fail('MIME type is required');
  const n = mimeType.toLowerCase().split(';')[0].trim();
  if (!ROSTER_CONFIG.allowedMimeTypes.includes(n)) return ValidationResult.fail(`Invalid MIME type "${mimeType}"`);
  return ValidationResult.pass({ mimeType: n });
}

export function validateMagicBytes(filePath, extension) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    if (extension === '.xlsx') {
      const exp = ROSTER_CONFIG.magicBytes.xlsx;
      for (let i = 0; i < exp.length; i++) {
        if (buf[i] !== exp[i]) return ValidationResult.fail(`Invalid XLSX signature. Expected ZIP bytes, got ${Array.from(buf.slice(0, 4))}`);
      }
    }
    return ValidationResult.pass({ magicBytes: Array.from(buf.slice(0, 4)) });
  } catch (err) {
    return ValidationResult.fail(`Magic byte check failed: ${err.message}`);
  }
}

export function validateFileSize(filePath) {
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) return ValidationResult.fail('Not a regular file');
    if (stats.size === 0) return ValidationResult.fail('File is empty');
    if (stats.size > ROSTER_CONFIG.maxFileSize) return ValidationResult.fail(`File too large (${(stats.size / 1024 / 1024).toFixed(2)} MB). Max: ${(ROSTER_CONFIG.maxFileSize / 1024 / 1024).toFixed(2)} MB`);
    return ValidationResult.pass({ size: stats.size });
  } catch (err) {
    return ValidationResult.fail(`Cannot read file size: ${err.message}`);
  }
}

export function validateZipRatio(filePath, extension) {
  if (extension !== '.xlsx') return ValidationResult.pass({ skipZipCheck: true });
  try {
    const stats = fs.statSync(filePath);
    const cs = stats.size;
    if (_execSync) {
      try {
        const result = _execSync(`unzip -l "${filePath}" 2>&1 | tail -n +4 | head -n -2 | awk '{print $1}'`, { encoding: 'utf-8', timeout: 5000 });
        const sizes = result.trim().split('\n').filter(Boolean).map(s => parseInt(s, 10)).filter(n => !isNaN(n));
        const totalUncompressed = sizes.reduce((a, b) => a + b, 0);
        if (totalUncompressed > 0) {
          const ratio = totalUncompressed / cs;
          if (ratio > ROSTER_CONFIG.maxZipRatio) return ValidationResult.fail(`Suspicious ratio (${ratio.toFixed(1)}x). Possible ZIP bomb!`);
          return ValidationResult.pass({ compressedSize: cs, uncompressedSize: totalUncompressed, ratio });
        }
      } catch (_) { /* unzip not available */ }
    }
    return ValidationResult.pass({ skipZipCheck: true, compressedSize: cs });
  } catch (_) { return ValidationResult.pass({ skipZipCheck: true }); }
}

export function validateNoMacros(filePath, extension) {
  // Skip macro check for CSV files — they can't contain macros
  if (extension !== '.xlsx') return ValidationResult.pass({ skipMacroCheck: true });
  const warnings = [];
  if (_execSync) {
    try {
      const vba = _execSync(`unzip -l "${filePath}" 2>&1 | grep -iE 'vba|macro|script' || true`, { encoding: 'utf-8', timeout: 5000 });
      if (vba.trim()) warnings.push(`VBA/macro content detected: ${vba.trim().substring(0, 200)}`);
    } catch (_) {}
    try {
      const rels = _execSync(`unzip -l "${filePath}" 2>&1 | grep -iE 'hyperlink|external|ole|activex' || true`, { encoding: 'utf-8', timeout: 5000 });
      if (rels.trim()) warnings.push(`External references detected: ${rels.trim().substring(0, 200)}`);
    } catch (_) {}
  }
  return ValidationResult.pass({ macroWarnings: warnings });
}

export function validateRowLimits(rows, sheets) {
  if (sheets > ROSTER_CONFIG.maxSheets) return ValidationResult.fail(`Too many sheets (${sheets}). Max: ${ROSTER_CONFIG.maxSheets}`);
  if (rows > ROSTER_CONFIG.maxRows) return ValidationResult.fail(`Too many rows (${rows}). Max: ${ROSTER_CONFIG.maxRows}`);
  return ValidationResult.pass({ totalRows: rows, totalSheets: sheets });
}

export function validateCellContent(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return s.length > ROSTER_CONFIG.maxCellLength ? s.substring(0, ROSTER_CONFIG.maxCellLength) : s;
}

// ═══════════════════════════════════════════════════════════════════
// 8. Antivirus / Quarantine Interface
// ═══════════════════════════════════════════════════════════════════

/**
 * Run antivirus scan on a file (placeholder for ClamAV integration).
 *
 * In production, configure CLAMAV_HOST env var to enable scanning.
 * Falls back gracefully when ClamAV is not configured.
 *
 * @param {string} filePath - Path to file to scan
 * @returns {Promise<{ ok: boolean, infected: boolean, virus?: string, message: string }>}
 */
export async function scanFile(filePath) {
  const clamavHost = process.env.CLAMAV_HOST;
  if (!clamavHost) {
    return { ok: true, infected: false, message: 'Antivirus not configured — file accepted without scan' };
  }

  try {
    // ClamAV scan via TCP socket (simplified)
    const net = await import('net');
    return new Promise((resolve) => {
      const client = new net.Socket();
      const timeout = setTimeout(() => {
        client.destroy();
        resolve({ ok: true, infected: false, message: 'Antivirus scan timed out — file accepted' });
      }, 10000);

      client.connect(3310, clamavHost, () => {
        // INSTREAM scan protocol
        client.write(`zINSTREAM\0`);
        const data = fs.readFileSync(filePath);
        // Send chunks
        let offset = 0;
        const CHUNK = 64 * 1024;
        while (offset < data.length) {
          const chunk = data.slice(offset, offset + CHUNK);
          const sizeBuf = Buffer.alloc(4);
          sizeBuf.writeUInt32BE(chunk.length);
          client.write(Buffer.concat([sizeBuf, chunk]));
          offset += CHUNK;
        }
        // End marker
        const endBuf = Buffer.alloc(4, 0);
        client.write(endBuf);
      });

      let response = '';
      client.on('data', (data) => { response += data.toString(); });
      client.on('close', () => {
        clearTimeout(timeout);
        if (response.includes('FOUND')) {
          const parts = response.split(':');
          resolve({ ok: false, infected: true, virus: parts[1]?.trim() || 'unknown', message: `Virus detected: ${response}` });
        } else {
          resolve({ ok: true, infected: false, message: 'File clean' });
        }
      });
      client.on('error', () => {
        clearTimeout(timeout);
        resolve({ ok: true, infected: false, message: 'Antivirus unavailable — file accepted' });
      });
    });
  } catch (_) {
    return { ok: true, infected: false, message: 'Antivirus not available — file accepted' };
  }
}

/**
 * Quarantine a file by moving it to a quarantine directory.
 * Removes the original file after quarantining to prevent re-processing.
 *
 * @param {string} filePath - Original file path
 * @param {string} reason - Reason for quarantine
 * @returns {Promise<string>} Quarantine path
 */
export async function quarantineFile(filePath, reason) {
  const quarantineDir = path.resolve(process.cwd(), 'quarantine');
  if (!fs.existsSync(quarantineDir)) fs.mkdirSync(quarantineDir, { recursive: true });
  const dest = path.join(quarantineDir, `quarantined-${Date.now()}-${path.basename(filePath)}`);
  fs.copyFileSync(filePath, dest);
  fs.writeFileSync(dest + '.reason', reason, 'utf-8');
  // Remove original after quarantining
  try { fs.unlinkSync(filePath); } catch (_) { /* best-effort */ }
  return dest;
}

// ═══════════════════════════════════════════════════════════════════
// 9. Full Validation Pipeline
// ═══════════════════════════════════════════════════════════════════

export async function validateRosterFile(filePath, originalName, mimeType) {
  const results = [];

  const extResult = validateExtension(originalName);
  results.push({ check: 'extension', ...extResult });
  if (!extResult.ok) return { ok: false, errors: [extResult.error], results };
  const ext = extResult.details.extension;

  const mimeResult = validateMimeType(mimeType);
  results.push({ check: 'mime', ...mimeResult });
  if (!mimeResult.ok && ext !== '.csv') return { ok: false, errors: [mimeResult.error], results };

  const magicResult = validateMagicBytes(filePath, ext);
  results.push({ check: 'magic', ...magicResult });
  if (!magicResult.ok) return { ok: false, errors: [magicResult.error], results };

  const sizeResult = validateFileSize(filePath);
  results.push({ check: 'size', ...sizeResult });
  if (!sizeResult.ok) return { ok: false, errors: [sizeResult.error], results };

  const zipResult = validateZipRatio(filePath, ext);
  results.push({ check: 'zip_ratio', ...zipResult });
  if (!zipResult.ok) return { ok: false, errors: [zipResult.error], results };

  const macroResult = validateNoMacros(filePath, ext);
  results.push({ check: 'macro', ...macroResult });

  // 7. Optional: virus scan
  const scanResult = await scanFile(filePath);
  results.push({ check: 'antivirus', ok: scanResult.ok, warnings: scanResult.infected ? [`Virus detected: ${scanResult.virus || 'unknown'}`] : [] });
  if (scanResult.infected) {
    await quarantineFile(filePath, `Virus: ${scanResult.virus || 'unknown'}`);
    return { ok: false, errors: [`File contains malware: ${scanResult.virus || 'unknown'}. File quarantined.`], results };
  }

  const allWarnings = [];
  for (const r of results) {
    if (r.warnings?.length) allWarnings.push(...r.warnings);
    if (r.details?.macroWarnings?.length) allWarnings.push(...r.details.macroWarnings);
  }

  return { ok: true, extension: ext, size: sizeResult.details.size, warnings: allWarnings, results };
}
