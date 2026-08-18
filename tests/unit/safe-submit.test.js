/**
 * Deborah — Safe File/Code/Oral Submission unit tests (Prompt 44)
 *
 * Pure-schema coverage:
 *   - Upload session contract: kind validation, MIME allowlist, size limits
 *   - MIME/magic/hash: magic detection, declared-vs-magic mismatch
 *   - Quarantine state machine: FAIL-CLOSED (no verdict → unscannable)
 *   - Archive/macro/PDF active-content: zip-bomb ratio, macro markers,
 *     PDF JS detection
 *   - Code sandbox limits + static policy check (no hooks)
 *   - Chunk resume contract: contiguous offset, idempotent resend
 *   - Version/resubmission flow + signed receipt verify
 */

import { describe, it, expect } from 'vitest';
import {
  SUBMISSION_KINDS,
  UPLOAD_SESSION_STATUS,
  QUARANTINE_STATUS,
  resolveUploadLimits,
  validateUploadSessionCreate,
  validateSessionTransition,
  detectMagicMime,
  sha256Hex,
  evaluateMimeMatch,
  decideQuarantine,
  evaluateArchivePlan,
  scanForMacros,
  scanPdfForActiveContent,
  codeSandboxLimits,
  staticCodePolicyCheck,
  validateChunk,
  validateUploadComplete,
  evaluateTranscriptConfidence,
  checkResubmissionAllowed,
  validateVersionTransition,
  buildSubmissionReceipt,
  verifySubmissionReceipt,
  quarantineNeverPenalty,
  SAFE_SUBMIT_DEFAULTS,
} from '../../src/modules/safe-submit/index.js';

describe('SafeSubmit — upload session contract', () => {
  it('validates kind + sessionKey (pre-DB)', () => {
    expect(SUBMISSION_KINDS).toContain('file');
    expect(validateUploadSessionCreate({ sessionKey: 'k1', kind: 'file', declaredMime: 'application/pdf' }).ok).toBe(true);
    expect(validateUploadSessionCreate({ sessionKey: '', kind: 'file' }).ok).toBe(false);
    expect(validateUploadSessionCreate({ sessionKey: 'k2', kind: 'bogus' }).ok).toBe(false);
  });

  it('rejects declared MIME not in the per-kind allowlist', () => {
    const r = validateUploadSessionCreate({ sessionKey: 'k3', kind: 'code', declaredMime: 'application/x-msdownload' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not allowed for code/);
  });

  it('rejects files over the resolved per-kind size limit', () => {
    const limits = resolveUploadLimits({ kind: 'code' });
    const r = validateUploadSessionCreate({
      sessionKey: 'k4', kind: 'code', declaredMime: 'text/plain',
      expectedSize: limits.maxCodeSizeBytes + 1, limits,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/limit/);
  });

  it('enforces the session state machine', () => {
    expect(validateSessionTransition(UPLOAD_SESSION_STATUS.OPEN, UPLOAD_SESSION_STATUS.UPLOADING).ok).toBe(true);
    expect(validateSessionTransition(UPLOAD_SESSION_STATUS.OPEN, UPLOAD_SESSION_STATUS.ACCEPTED).ok).toBe(false);
    expect(validateSessionTransition(UPLOAD_SESSION_STATUS.COMPLETE, UPLOAD_SESSION_STATUS.QUARANTINED).ok).toBe(true);
    expect(validateSessionTransition(UPLOAD_SESSION_STATUS.ACCEPTED, UPLOAD_SESSION_STATUS.UPLOADING).ok).toBe(false);
  });
});

describe('SafeSubmit — MIME/magic/hash', () => {
  it('detects MIME from magic bytes (server-side)', () => {
    expect(detectMagicMime(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe('application/pdf');
    expect(detectMagicMime(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]))).toBe('application/zip');
    expect(detectMagicMime(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png');
    expect(detectMagicMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectMagicMime(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toBeNull();
  });

  it('produces stable sha256 hex', () => {
    const a = sha256Hex(Buffer.from('hello'));
    const b = sha256Hex(Buffer.from('hello'));
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('flags declared-vs-magic MIME mismatch (spoof attempt)', () => {
    const r = evaluateMimeMatch({ declaredMime: 'application/pdf', magicMime: 'application/zip' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/MIME mismatch/);
  });

  it('accepts OLE2 office container alias (doc/xls/ppt legacy)', () => {
    const r = evaluateMimeMatch({ declaredMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magicMime: 'application/msword' });
    expect(r.ok).toBe(true);
  });
});

describe('SafeSubmit — quarantine state machine (FAIL-CLOSED)', () => {
  it('no scan verdicts → unscannable (never clean)', () => {
    const d = decideQuarantine([]);
    expect(d.status).toBe(QUARANTINE_STATUS.UNSCANNABLE);
  });

  it('any infected → infected (highest severity)', () => {
    const d = decideQuarantine([{ verdict: 'clean' }, { verdict: 'infected' }]);
    expect(d.status).toBe(QUARANTINE_STATUS.INFECTED);
  });

  it('unscannable scanner → unscannable (no fail-open)', () => {
    const d = decideQuarantine([{ verdict: 'clean' }, { verdict: 'unscannable' }]);
    expect(d.status).toBe(QUARANTINE_STATUS.UNSCANNABLE);
  });

  it('suspicious → unscannable (manual review required)', () => {
    const d = decideQuarantine([{ verdict: 'suspicious' }]);
    expect(d.status).toBe(QUARANTINE_STATUS.UNSCANNABLE);
  });

  it('all clean → clean', () => {
    const d = decideQuarantine([{ verdict: 'clean' }, { verdict: 'clean' }]);
    expect(d.status).toBe(QUARANTINE_STATUS.CLEAN);
  });

  it('quarantine is NEVER a penalty (needs_review only)', () => {
    expect(quarantineNeverPenalty().ok).toBe(true);
  });
});

describe('SafeSubmit — archive/macro/PDF active-content checks', () => {
  it('rejects zip-bomb ratio (malicious decompression)', () => {
    const r = evaluateArchivePlan({ compressedBytes: 1024, entryCount: 5, estimatedDecompressedBytes: 1024 * 1000 });
    expect(r.verdict).toBe('infected');
    expect(r.reason).toMatch(/zip-bomb ratio/);
  });

  it('rejects excessive entry count', () => {
    const r = evaluateArchivePlan({ compressedBytes: 1024, entryCount: SAFE_SUBMIT_DEFAULTS.zipMaxEntries + 1, estimatedDecompressedBytes: 1024 });
    expect(r.verdict).toBe('infected');
    expect(r.reason).toMatch(/too many archive entries/);
  });

  it('rejects oversized decompressed total', () => {
    const r = evaluateArchivePlan({ compressedBytes: 1024, entryCount: 2, estimatedDecompressedBytes: SAFE_SUBMIT_DEFAULTS.zipMaxTotalDecompressedBytes + 1 });
    expect(r.verdict).toBe('infected');
  });

  it('clean archive passes', () => {
    const r = evaluateArchivePlan({ compressedBytes: 1024 * 10, entryCount: 3, estimatedDecompressedBytes: 1024 * 12 });
    expect(r.verdict).toBe('clean');
  });

  it('detects macro-enabled extensions and embedded VBA', () => {
    expect(scanForMacros({ fileName: 'malware.docm' }).hasMacro).toBe(true);
    expect(scanForMacros({ fileName: 'clean.docx', entryNames: ['word/vbaProject.bin'] }).hasMacro).toBe(true);
    expect(scanForMacros({ fileName: 'clean.docx', entryNames: ['word/document.xml'] }).hasMacro).toBe(false);
  });

  it('detects PDF active-content (JavaScript / Launch / EmbeddedFile)', () => {
    expect(scanPdfForActiveContent({ pdfText: '/Type /Catalog /OpenAction 0 0 R' }).verdict).toBe('suspicious');
    expect(scanPdfForActiveContent({ pdfText: '/EmbeddedFile' }).markers).toContain('/EmbeddedFile');
    expect(scanPdfForActiveContent({ pdfText: '1 0 obj << /Type /Catalog >>' }).verdict).toBe('clean');
  });
});

describe('SafeSubmit — code sandbox limits + static policy', () => {
  it('sandbox contract is immutable and locked down', () => {
    const c = codeSandboxLimits();
    expect(c.network).toBe('none');
    expect(c.memoryMB).toBeLessThanOrEqual(512);
    expect(c.cpuCores).toBeLessThanOrEqual(1);
    expect(c.timeoutSeconds).toBeLessThanOrEqual(10);
    expect(c.filesystem).toMatch(/readonly/);
  });

  it('static policy flags dangerous constructs (no hooks run)', () => {
    const r = staticCodePolicyCheck({ source: 'import socket; socket.connect(("x",1))' });
    expect(r.verdict).toBe('suspicious');
    expect(r.flags).toContain('python_socket');
    const clean = staticCodePolicyCheck({ source: 'def add(a,b): return a+b' });
    expect(clean.verdict).toBe('clean');
  });
});

describe('SafeSubmit — chunk resume contract', () => {
  it('accepts contiguous chunk', () => {
    expect(validateChunk({ chunkIndex: 0, offset: 0, size: 100, receivedSize: 0 }).ok).toBe(true);
  });

  it('rejects non-contiguous gap', () => {
    const r = validateChunk({ chunkIndex: 1, offset: 200, size: 100, receivedSize: 100 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/non-contiguous/);
  });

  it('allows idempotent resend of received chunk', () => {
    expect(validateChunk({ chunkIndex: 0, offset: 0, size: 100, receivedSize: 300 }).ok).toBe(true);
  });

  it('rejects oversize chunk', () => {
    const r = validateChunk({ chunkIndex: 0, offset: 0, size: SAFE_SUBMIT_DEFAULTS.chunkSizeBytes * 3, receivedSize: 0 });
    expect(r.ok).toBe(false);
  });

  it('validates upload completeness (size + chunk count)', () => {
    expect(validateUploadComplete({ receivedSize: 100, expectedSize: 100, receivedChunks: 2, totalChunks: 2 }).ok).toBe(true);
    expect(validateUploadComplete({ receivedSize: 99, expectedSize: 100, receivedChunks: 2, totalChunks: 2 }).ok).toBe(false);
    expect(validateUploadComplete({ receivedSize: 100, expectedSize: 100, receivedChunks: 1, totalChunks: 2 }).ok).toBe(false);
  });
});

describe('SafeSubmit — transcript confidence → manual listen', () => {
  it('low confidence → manual listen', () => {
    expect(evaluateTranscriptConfidence({ confidence: 0.4 }).manualListen).toBe(true);
  });
  it('empty transcript → manual listen', () => {
    expect(evaluateTranscriptConfidence({ confidence: 0.95, transcriptText: '' }).manualListen).toBe(true);
  });
  it('high confidence + text → no manual listen', () => {
    expect(evaluateTranscriptConfidence({ confidence: 0.95, transcriptText: 'hello' }).manualListen).toBe(false);
  });
});

describe('SafeSubmit — version/resubmission flow + signed receipt', () => {
  it('first version always allowed; resubmission requires authorization + open window', () => {
    expect(checkResubmissionAllowed({ currentVersion: 0 }).ok).toBe(true);
    const denied = checkResubmissionAllowed({ currentVersion: 1, attemptOpen: true, authorized: false });
    expect(denied.ok).toBe(false);
    expect(denied.reason).toMatch(/not authorized/);
    const closed = checkResubmissionAllowed({ currentVersion: 1, attemptOpen: false, authorized: true });
    expect(closed.ok).toBe(false);
    const ok = checkResubmissionAllowed({ currentVersion: 1, attemptOpen: true, authorized: true });
    expect(ok.ok).toBe(true);
    expect(ok.nextVersion).toBe(2);
  });

  it('caps max versions', () => {
    const r = checkResubmissionAllowed({ currentVersion: 5, attemptOpen: true, authorized: true, maxVersions: 5 });
    expect(r.ok).toBe(false);
  });

  it('enforces version state machine', () => {
    expect(validateVersionTransition('draft', 'submitted').ok).toBe(true);
    expect(validateVersionTransition('submitted', 'superseded').ok).toBe(true);
    expect(validateVersionTransition('superseded', 'submitted').ok).toBe(false);
  });

  it('signs and verifies a receipt (non-forgeable)', () => {
    const secret = 'test-secret-0123456789abcdefghijklmnopqrstuv';
    const receipt = buildSubmissionReceipt({ attemptId: 7, versionNo: 1, sessionKey: 'sk-1', sha256: 'a'.repeat(64), quarantineStatus: 'clean', secret });
    expect(receipt.signature).toHaveLength(64);
    expect(receipt.receiptToken).toBeTruthy();
    expect(verifySubmissionReceipt(receipt, secret)).toBe(true);
    // Tamper detection
    const tampered = { ...receipt, body: { ...receipt.body, attemptId: 8 } };
    expect(verifySubmissionReceipt(tampered, secret)).toBe(false);
    // Wrong secret
    expect(verifySubmissionReceipt(receipt, 'wrong-secret-0123456789abcdefghijklmnopq')).toBe(false);
  });
});
