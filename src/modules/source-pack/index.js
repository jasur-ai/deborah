/**
 * Edikit — Source Pack & Secure RAG Ingestion Module Barrel
 *
 * Prompt 50 — teacher-approved source'lar (PDF/DOCX/PPTX/URL/text) ni
 * provenance/citation bilan safe corpusga aylantirish. Pure schema
 * (no I/O — SSRF, safe upload, extraction, isolation, provenance,
 * embedding namespace, tenant ACL, citation contract) + DB service
 * (graceful degradation without PG).
 */

export * from './source-pack.schema.js';
export * from './source-pack.service.js';
