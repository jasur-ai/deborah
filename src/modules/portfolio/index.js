/**
 * Edikit — Portfolio module (AUTH A-12)
 * -------------------------------------
 * Transcript/diploma import + evidence portfolio on the local DB.
 */
export * from './portfolio.service.js';
export { parseTranscriptFile, parsePdfText, pdfLinesToItems, mapExcelRowToItem, PortfolioImportError, SUPPORTED_EXTENSIONS, MAX_FILE_BYTES } from './transcript.parser.js';
export { buildTranscriptPdf, toAscii } from './transcript.pdf.js';
export { t, catalogFor, resolveLocale, PORTFOLIO_LOCALES } from './i18n.js';
