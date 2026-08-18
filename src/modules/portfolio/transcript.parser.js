/**
 * Edikit — Transcript / diploma parser (AUTH A-12 §08-09)
 * --------------------------------------------------------
 * Safe file parsing for portfolio import:
 *   - Excel (.xlsx/.csv): reuses the A-10 roster parser (parseRosterFile),
 *     then maps HEMIS columns (fan/baho/kredit/semestr/guruh) to items.
 *   - PDF (.pdf): extracts text with pdf-parse (server-side, no active
 *     content execution), then maps transcript lines to items.
 *
 * Safety guards (A-12 §08, §29):
 *   - File size capped (MAX_FILE_BYTES) — checked before read.
 *   - PDF parse wrapped in try/catch + timeout + destroy() (memory/time limit).
 *   - No scripts, no rendering — text extraction only. Malformed PDF → error.
 *   - Unsupported extensions rejected at the route layer too.
 */

import fs from 'fs';
import path from 'path';
// E-05 muhit fix: pdf-parse (pdfjs) faqat PDF parse paytida yuklanadi —
// server start'da `DOMMatrix is not defined` (Windows @napi-rs/canvas yo'q)
// xatosini oldini oladi. A-12 §29 memory limit ruhiga ham mos (lazy load).
import { parseRosterFile } from '../roster/parser.js';

const MAX_FILE_BYTES = 8 * 1024 * 1024; // A-12 §29 memory/time limit (8 MB)
const PDF_PARSE_TIMEOUT_MS = 10_000;
const MAX_IMPORT_ITEMS = 200; // transcript rows cap per file

const SUPPORTED_EXTENSIONS = ['.pdf', '.xlsx', '.csv'];

// ── HEMIS column aliases (A-10 mapper bilan mos) ─────────────────────
const SUBJECT_ALIASES = [
  'fan', 'fan_nomi', 'fan nomi', 'subject', 'subject_name', 'discipline',
  'predmet', 'предмет', 'дисциплина', 'kurs_nomi', 'course', 'course_name',
];
const GRADE_ALIASES = [
  'baho', 'ball', 'grade', 'mark', 'оценка', 'балл', 'natija', 'result',
];
const CREDIT_ALIASES = ['kredit', 'credit', 'кредит'];
const SEMESTER_ALIASES = ['semestr', 'semester', 'семестр'];
const GROUP_ALIASES = ['guruh', 'group', 'группа'];
const YEAR_ALIASES = ['yil', 'year', 'akademik_yil', 'академик_йил', 'учебный_год'];

/** Normalize a header label for fuzzy matching. */
function normHeader(h) {
  return String(h || '')
    .toLowerCase()
    .trim()
    .replace(/['’`]/g, '')
    .replace(/[\s._-]+/g, '_');
}

/** Guard against formula injection — never return values starting with '='. */
function safeCell(v) {
  const s = String(v ?? '').trim();
  return s.startsWith('=') ? '' : s;
}

/** First alias value present in a (normalized-key) row object. */
function firstOf(normRow, aliases) {
  for (const alias of aliases) {
    const n = normHeader(alias);
    if (n in normRow) return normRow[n];
  }
  return '';
}

/**
 * Map an Excel data row into a transcript item.
 * Headers are matched case-insensitively against HEMIS aliases
 * (fan/discipline, baho/оценка, kredit/кредит, semestr/semester, …).
 * Returns null if no subject found.
 */
export function mapExcelRowToItem(rowData, { fileName = '', sheet = '' } = {}) {
  // normalized header → raw (sanitized) value lookup
  const normRow = {};
  for (const [k, v] of Object.entries(rowData || {})) {
    normRow[normHeader(k)] = safeCell(v);
  }

  const subject = firstOf(normRow, SUBJECT_ALIASES);
  if (!subject || subject.length < 2) return null;

  return {
    kind: 'result',
    title: subject,
    evidence: {
      subject,
      grade: firstOf(normRow, GRADE_ALIASES),
      credit: firstOf(normRow, CREDIT_ALIASES),
      semester: firstOf(normRow, SEMESTER_ALIASES),
      group: firstOf(normRow, GROUP_ALIASES),
      year: firstOf(normRow, YEAR_ALIASES),
      source: 'excel',
      fileName,
      sheet,
    },
  };
}

// ── PDF text → transcript items ──────────────────────────────────────

const SEMESTER_RE =
  /^(?:\s*\d{1,2}[-–.\s]*)?semestr\s*\d{1,2}|^\d{1,2}[-–.]?\s*семестр|^семестр\s*\d{1,2}/i;

/** Two trailing numbers → [subject, grade, credit]. */
function parseSubjectLine(line) {
  // "Oliy matematika 5 4" | "Математика 4 2" | "Subject — 5, kredit 4" | "Subject 86 (kredit 4)"
  let m = line.match(/^(.*?)[\s:;|–—-]+(\d{1,3}(?:[.,]\d+)?)\s+(\d{1,3}(?:[.,]\d+)?)\s*$/);
  if (!m) m = line.match(/^(.*?)[\s:;|–—-]+(\d{1,3}(?:[.,]\d+)?)\s*$/);
  if (!m) return null;
  const subject = m[1].replace(/^[-–—•\s]+/, '').replace(/[-–—•\s]+$/, '').trim();
  if (subject.length < 3) return null;
  const nums = m.slice(2).filter(Boolean).map((n) => n.replace(',', '.'));
  let grade = nums[nums.length - 1];
  let credit = null;
  if (nums.length >= 2) {
    const penultimate = Number(nums[nums.length - 2]);
    const last = Number(nums[nums.length - 1]);
    // HEMIS tipik: grade 2..5, credit odatda 1..8 yoki o'nlik
    if (penultimate >= 2 && penultimate <= 5) { grade = String(penultimate); credit = nums[nums.length - 1]; }
    else if (last >= 2 && last <= 5) { grade = String(last); credit = nums[nums.length - 2]; }
    else { grade = nums[nums.length - 1]; credit = nums[nums.length - 2]; }
  }
  return { subject, grade, credit };
}

const NOISE_RE =
  /^(fan|baho|ball|grade|credit|kredit|semestr|o'quv|курс|учебн|предмет|дисципл|ота|фан|баҳо|балл|семестр|imzo|raisi|dekan|rektor|ф.и.ш|f.i.sh|talaba|студент|transkript|транскрипт|diplom|диплом|reyting|рейтинг)/i;

/** Parse extracted PDF text lines into transcript items. */
export function pdfLinesToItems(text, { fileName = '' } = {}) {
  const items = [];
  let currentSemester = '';
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (SEMESTER_RE.test(line)) {
      const m = line.match(/(\d{1,2})/);
      currentSemester = m ? m[1] : currentSemester;
      continue;
    }
    if (NOISE_RE.test(line)) continue;
    const parsed = parseSubjectLine(line);
    if (!parsed) continue;
    items.push({
      kind: 'result',
      title: parsed.subject,
      evidence: {
        subject: parsed.subject,
        grade: parsed.grade,
        credit: parsed.credit,
        semester: currentSemester,
        group: '',
        year: '',
        source: 'pdf',
        fileName,
      },
    });
    if (items.length >= MAX_IMPORT_ITEMS) break;
  }
  return items;
}

// ── Public entry ─────────────────────────────────────────────────────

/**
 * Parse a transcript file into portfolio items.
 * @returns {Promise<{items: Array, warnings: string[], sourceMeta: object}>}
 */
export async function parseTranscriptFile(filePath, extension) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new PortfolioImportError('unsupported_format', `Unsupported file type: ${ext}`);
  }

  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_BYTES) {
    throw new PortfolioImportError('file_too_large', `File exceeds ${MAX_FILE_BYTES} bytes limit`);
  }

  const warnings = [];
  const fileName = path.basename(filePath);

  if (ext === '.pdf') {
    const text = await parsePdfText(filePath);
    if (!text || text.trim().length === 0) {
      warnings.push('Matn qatlami topilmadi — skanlangan PDF bo\'lishi mumkin. Qo\'lda kiriting.');
      return { items: [], warnings, sourceMeta: { ext, pages: 0 } };
    }
    const items = pdfLinesToItems(text, { fileName });
    if (items.length === 0) {
      warnings.push('PDF\'dan fan/baho/kredit qatorlari aniqlanmadi. Qo\'lda kiriting.');
    }
    return { items, warnings, sourceMeta: { ext, chars: text.length } };
  }

  // Excel / CSV → reuse A-10 roster parser
  const parsed = parseRosterFile(filePath, ext);
  if (parsed.errors && parsed.errors.length > 0) {
    throw new PortfolioImportError('parse_error', parsed.errors[0]?.message || 'Excel parse error');
  }
  const items = [];
  for (const sheet of parsed.sheets || []) {
    for (const row of sheet.rows || []) {
      const item = mapExcelRowToItem(row.data, { fileName, sheet: sheet.name });
      if (item) items.push(item);
      if (items.length >= MAX_IMPORT_ITEMS) break;
    }
    if (items.length >= MAX_IMPORT_ITEMS) break;
  }
  if (items.length === 0) {
    warnings.push('Fayldan fan/baho/kredit qatorlari aniqlanmadi. Ustunlar: fan, baho, kredit (HEMIS shablonini tekshiring).');
  }
  return { items, warnings, sourceMeta: { ext, sheets: (parsed.sheets || []).length } };
}

/** Safe PDF text extraction with size + time limits. */
export async function parsePdfText(filePath) {
  let buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch (err) {
    throw new PortfolioImportError('pdf_read_error', `Cannot read PDF: ${err.message}`);
  }
  if (buffer.length > MAX_FILE_BYTES) {
    throw new PortfolioImportError('file_too_large', 'PDF exceeds size limit');
  }
  // Magic bytes: %PDF-
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new PortfolioImportError('invalid_pdf', 'File is not a valid PDF');
  }

  let parser;
  try {
    const { PDFParse } = await import('pdf-parse');
    parser = new PDFParse({ data: buffer });
    const textPromise = parser.getText();
    // timeout'dan keyin yoki destroy'dan so'ng unhandled rejection bo'lmasin
    // (asl xato hali ham race orqali tarqaladi → pdf_parse_error)
    textPromise.catch(() => {});
    const result = await Promise.race([
      textPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('PDF parse timeout')), PDF_PARSE_TIMEOUT_MS),
      ),
    ]);
    return result?.text || '';
  } catch (err) {
    throw new PortfolioImportError('pdf_parse_error', `PDF parse failed: ${err.message}`);
  } finally {
    if (parser && typeof parser.destroy === 'function') {
      parser.destroy().catch(() => {});
    }
  }
}

/** Custom error carrying a stable `code` for the route layer. */
export class PortfolioImportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PortfolioImportError';
    this.code = code;
  }
}

export { SUPPORTED_EXTENSIONS, MAX_FILE_BYTES };
