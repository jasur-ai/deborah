/**
 * Edikit — Roster File Parser
 *
 * Parses XLSX and CSV roster files with security controls:
 *   - No formula execution (sheet_to_json mode)
 *   - Unicode/email/name normalization
 *   - Row/sheet/cell limit enforcement
 *   - Staging data with row-level errors
 *
 * Uses the SheetJS (xlsx) library for XLSX parsing.
 * CSV is parsed via built-in CSV parsing in SheetJS.
 *
 * @module roster/parser
 */

import XLSX from 'xlsx';

// ── Limits ──
const MAX_ROWS = 5000;
const MAX_COLUMNS = 100;
const MAX_CELL_LENGTH = 1000;

// ═══════════════════════════════════════════════════════════════════
// Unicode / Email / Name Normalization
// ═══════════════════════════════════════════════════════════════════

/**
 * Normalize a string value: trim, collapse whitespace, normalize Unicode.
 */
export function normalizeValue(value) {
  if (value === null || value === undefined) return '';
  const str = String(value).trim();
  // Normalize Unicode (NFKC: compatibility decomposition + canonical composition)
  return str.normalize('NFKC').replace(/\s+/g, ' ');
}

/**
 * Normalize an email address: lowercase, trim, remove trailing dots.
 */
export function normalizeEmail(email) {
  if (!email) return '';
  return normalizeValue(email)
    .toLowerCase()
    .replace(/\.+$/, '')       // Remove trailing dots
    .replace(/^\.+/, '');      // Remove leading dots
}

/**
 * Normalize a person name: capitalize first letters, trim.
 */
export function normalizeName(name) {
  if (!name) return '';
  const normalized = normalizeValue(name);
  // Capitalize first letter of each word, but keep common lowercase prefixes
  return normalized.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Normalize a username: lowercase, alphanumeric only, max 30 chars.
 */
export function normalizeUsername(username) {
  if (!username) return '';
  return normalizeValue(username)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 30);
}

// ═══════════════════════════════════════════════════════════════════
// XLSX Parser (sandboxed — no formula execution)
// ═══════════════════════════════════════════════════════════════════

/**
 * Parse an XLSX file into structured rows.
 * No formulas are executed — SheetJS's sheet_to_json returns raw values.
 *
 * @param {string} filePath - Path to the XLSX file
 * @returns {Object} { sheets, totalRows, totalSheets, errors, warnings }
 */
export function parseXlsx(filePath) {
  const errors = [];
  const warnings = [];

  let workbook;
  try {
    workbook = XLSX.readFile(filePath, {
      type: 'file',
      cellFormula: false,       // Don't evaluate formulas!
      cellHTML: false,          // Don't parse HTML
      cellNF: false,            // Don't generate number formats
      sheetStubs: false,        // Don't generate stub cells
      raw: true,                // Keep raw values (not formatted strings)
      dense: false,             // Use normal array-of-arrays
      codepage: undefined,      // Default encoding
    });
  } catch (err) {
    errors.push({ type: 'parse_error', message: `Failed to parse XLSX: ${err.message}` });
    return { sheets: [], totalRows: 0, totalSheets: 0, errors, warnings };
  }

  const sheetNames = workbook.SheetNames;

  if (sheetNames.length === 0) {
    errors.push({ type: 'empty_workbook', message: 'Workbook contains no sheets' });
    return { sheets: [], totalRows: 0, totalSheets: 0, errors, warnings };
  }

  const sheets = [];
  let totalRows = 0;

  for (const sheetName of sheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;

    // Convert sheet to JSON array of objects (first row = headers)
    let jsonData;
    try {
      jsonData = XLSX.utils.sheet_to_json(worksheet, {
        defval: '',              // Default empty cell value
        raw: true,               // Don't format
        header: 1,               // Array of arrays
      });
    } catch (err) {
      errors.push({ type: 'sheet_parse_error', sheet: sheetName, message: err.message });
      continue;
    }

    if (!jsonData || jsonData.length === 0) {
      warnings.push({ type: 'empty_sheet', sheet: sheetName, message: 'Sheet is empty' });
      continue;
    }

    // Separate header row from data rows
    const headerRow = jsonData[0] || [];
    const dataRows = jsonData.slice(1);

    if (dataRows.length > MAX_ROWS) {
      warnings.push({
        type: 'row_limit', sheet: sheetName,
        message: `Sheet has ${dataRows.length} rows, truncating to ${MAX_ROWS}`,
      });
    }

    const truncatedData = dataRows.slice(0, MAX_ROWS);
    const sheetRows = [];

    for (let rowIdx = 0; rowIdx < truncatedData.length; rowIdx++) {
      const row = truncatedData[rowIdx];
      const rowObj = {};
      let hasContent = false;

      for (let colIdx = 0; colIdx < Math.min(headerRow.length, MAX_COLUMNS); colIdx++) {
        const rawValue = row[colIdx];
        const normalized = normalizeValue(rawValue !== undefined ? rawValue : '');
        const safeValue = normalized.length > MAX_CELL_LENGTH
          ? normalized.substring(0, MAX_CELL_LENGTH)
          : normalized;

        if (safeValue) hasContent = true;
        rowObj[String(headerRow[colIdx] || `col_${colIdx}`)] = safeValue;
      }

      if (hasContent) {
        sheetRows.push({ rowIndex: rowIdx + 2, data: rowObj }); // +2 for 1-based + header
      }
    }

    sheets.push({
      name: sheetName,
      headers: headerRow.map(h => normalizeValue(String(h || ''))).filter(Boolean),
      rows: sheetRows,
      rowCount: sheetRows.length,
    });

    totalRows += sheetRows.length;
  }

  return {
    sheets,
    totalRows,
    totalSheets: sheets.length,
    errors,
    warnings,
  };
}

// ═══════════════════════════════════════════════════════════════════
// CSV Parser (via SheetJS)
// ═══════════════════════════════════════════════════════════════════

/**
 * Parse a CSV file.
 * Uses SheetJS's CSV parsing which handles most CSV dialects.
 *
 * @param {string} filePath
 * @param {Object} [options] - { delimiter, encoding }
 * @returns {Object} { sheets, totalRows, errors, warnings }
 */
export function parseCsv(filePath, options = {}) {
  let workbook;
  try {
    workbook = XLSX.readFile(filePath, {
      type: 'file',
      raw: true,
      cellFormula: false,
      // CSV-specific: detect delimiter, encoding
      rawSheets: false,
      codepage: options.encoding || undefined,
      // Auto-detect delimiter if not specified
      FS: options.delimiter || undefined,
    });
  } catch (err) {
    return {
      sheets: [], totalRows: 0, totalSheets: 0,
      errors: [{ type: 'parse_error', message: `Failed to parse CSV: ${err.message}` }],
      warnings: [],
    };
  }

  // Reuse XLSX parser's sheet-to-rows logic
  const sheetNames = workbook.SheetNames;
  const sheets = [];
  let totalRows = 0;

  for (const sheetName of sheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;

    let jsonData;
    try {
      jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: true, header: 1 });
    } catch (err) {
      continue;
    }

    if (!jsonData || jsonData.length === 0) continue;

    const headerRow = jsonData[0] || [];
    const dataRows = jsonData.slice(1).slice(0, MAX_ROWS);
    const sheetRows = [];

    for (const row of dataRows) {
      const rowObj = {};
      let hasContent = false;
      for (let colIdx = 0; colIdx < Math.min(headerRow.length, MAX_COLUMNS); colIdx++) {
        const safeValue = normalizeValue(row[colIdx] !== undefined ? row[colIdx] : '');
        if (safeValue) hasContent = true;
        rowObj[normalizeValue(String(headerRow[colIdx] || `col_${colIdx}`))] = safeValue;
      }
      if (hasContent) sheetRows.push({ data: rowObj });
    }

    sheets.push({ name: sheetName, headers: headerRow.map(h => normalizeValue(String(h || ''))).filter(Boolean), rows: sheetRows, rowCount: sheetRows.length });
    totalRows += sheetRows.length;
  }

  return { sheets, totalRows, totalSheets: sheets.length, errors: [], warnings: [] };
}

// ═══════════════════════════════════════════════════════════════════
// Auto-detect & Parse
// ═══════════════════════════════════════════════════════════════════

/**
 * Parse a roster file (auto-detect XLSX vs CSV based on extension).
 *
 * @param {string} filePath - Temporary file path
 * @param {string} extension - '.xlsx' or '.csv'
 * @param {Object} [options]
 * @returns {Object} { sheets, totalRows, totalSheets, errors, warnings }
 */
export function parseRosterFile(filePath, extension, options = {}) {
  if (extension === '.csv') {
    return parseCsv(filePath, options);
  }
  return parseXlsx(filePath);
}
