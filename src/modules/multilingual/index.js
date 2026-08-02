/**
 * Edikit — Uzbek Latin/Cyrillic & Terminology Layer
 *
 * Prompt 63 — uz-Latn, uz-Cyrl, ru va en content/version/search'ni
 * birinchi-class qilish (research.md §58). Deterministic transliteration,
 * terminology bank (versioned), original-text-preserving translations,
 * identity proper names, cross-script search.
 *
 * Security (§15, §58.2/58.4): transliteration ≠ translation/psychometric
 * equivalence; original text doim saqlanadi; identity name alohida.
 */

export * from './multilingual.schema.js';
export * from './multilingual.service.js';
