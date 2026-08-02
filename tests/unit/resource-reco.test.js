/**
 * Edikit — Resource Recommendation Connectors (unit tests, Prompt 54)
 *
 * Pure schema tekshiruvi (hech qanday DB/I-O yo'q):
 *   - Provider normalization: openalex / semantic_scholar / crossref /
 *     core / youtube / rss raw → canonical record (§11.1).
 *   - Dedupe: DOI / URL / normalized-title hash (§11.2).
 *   - Ranking: §11.2 weights (0.35/0.18/0.12/0.10/0.10/0.05/0.05/0.05).
 *   - Quota / exponential backoff.
 *   - LLM hallucination guard: candidate retrieved subset bo'lishi shart
 *     (§11.4 — LLM bibliographic record yaratmaydi).
 *   - Citation / feedback / provider terms / transcript-scrape guard.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeProviderRecord,
  dedupeRecords,
  normalizeTitleForDedupe,
  titleDedupeHash,
  computeRecommendationScore,
  applyQuota,
  computeBackoff,
  assertLlmOnlyRanksRecords,
  formatCitation,
  validateFeedback,
  checkProviderTerms,
  detectTranscriptScrapeIntent,
  validateSearchRequest,
  searchQueryHash,
  detectEducationIntent,
  RANKING_WEIGHTS,
  RESOURCE_PROVIDERS,
  PROVIDER_TERMS,
} from '../../src/modules/resource-reco/index.js';

// ═══════════════════════════════════════════════════════════════════
// PROVIDER NORMALIZATION (§11.1)
// ═══════════════════════════════════════════════════════════════════

describe('resource-reco — provider normalization (Prompt 54 §11.1)', () => {
  it('openalex raw → canonical paper record', () => {
    const r = normalizeProviderRecord('openalex', {
      id: 'W123',
      title: 'Photosynthesis pathways',
      doi: '10.1000/xyz',
      authorships: [{ author: { display_name: 'Aziz Karimov' } }],
      language: 'en',
      is_oa: true,
      cited_by_count: 42,
      publication_date: '2025-03-01',
      abstract_inverted_index: { 'CO2': [0], 'fixation': [1] },
    });
    expect(r.ok).toBe(true);
    expect(r.record.title).toBe('Photosynthesis pathways');
    expect(r.record.doi).toBe('10.1000/xyz');
    expect(r.record.authors).toEqual(['Aziz Karimov']);
    expect(r.record.is_open_access).toBe(true);
    expect(r.record.citations).toBe(42);
    expect(r.record.url).toContain('doi.org/10.1000/xyz');
  });

  it('semantic_scholar raw → canonical with DOI from externalIds', () => {
    const r = normalizeProviderRecord('semantic_scholar', {
      paperId: 'SS1',
      title: 'AI in education',
      authors: [{ name: 'John Doe' }],
      externalIds: { DOI: '10.1/abc' },
      citationCount: 7,
      openAccessPdf: { url: 'https://x/paper.pdf' },
    });
    expect(r.ok).toBe(true);
    expect(r.record.doi).toBe('10.1/abc');
    expect(r.record.is_open_access).toBe(true);
    expect(r.record.type).toBe('paper');
  });

  it('crossref raw → canonical article', () => {
    const r = normalizeProviderRecord('crossref', {
      DOI: '10.2/def',
      title: ['Enzyme kinetics'],
      author: [{ given: 'Ali', family: 'Valiev' }],
      type: 'journal-article',
      'is-referenced-by-count': 3,
    });
    expect(r.ok).toBe(true);
    expect(r.record.type).toBe('article');
    expect(r.record.authors).toEqual(['Ali Valiev']);
    expect(r.record.citations).toBe(3);
  });

  it('core raw → canonical with OA state', () => {
    const r = normalizeProviderRecord('core', {
      id: 55,
      title: 'Open access research',
      authors: ['A', 'B'],
      oaState: 'oa',
      yearPublished: 2024,
    });
    expect(r.ok).toBe(true);
    expect(r.record.is_open_access).toBe(true);
    expect(r.record.type).toBe('paper');
  });

  it('youtube raw → canonical video with education intent metadata', () => {
    const r = normalizeProviderRecord('youtube', {
      id: { videoId: 'v1' },
      snippet: {
        title: 'Dars: fotosintez',
        channelTitle: 'Science Channel',
        description: 'O\u2018quv dars, talim uchun',
        publishedAt: '2025-01-01T00:00:00Z',
      },
      statistics: { viewCount: '500000' },
    });
    expect(r.ok).toBe(true);
    expect(r.record.type).toBe('video');
    expect(r.record.url).toContain('watch?v=v1');
    expect(r.record.metadata.educationIntent).toBe(true);
    expect(r.record.metadata.viewCount).toBe(500000);
  });

  it('rss raw → canonical news record', () => {
    const r = normalizeProviderRecord('rss', {
      guid: 'g1',
      title: 'Yangi ta\u2018lim islohoti',
      link: 'https://news.uz/1',
      pubDate: '2026-07-01',
    });
    expect(r.ok).toBe(true);
    expect(r.record.type).toBe('news');
    expect(r.record.url).toBe('https://news.uz/1');
  });

  it('rejects unsupported provider and missing title', () => {
    expect(normalizeProviderRecord('bogus', { title: 'x' }).ok).toBe(false);
    expect(normalizeProviderRecord('openalex', { id: 'W1' }).ok).toBe(false);
  });

  it('detectEducationIntent — talim/o\u2018quv signal', () => {
    expect(detectEducationIntent('Lesson about photosynthesis')).toBe(true);
    expect(detectEducationIntent('Funny cat video')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// DEDUPE (§11.2 DOI/URL/title)
// ═══════════════════════════════════════════════════════════════════

describe('resource-reco — dedupe (Prompt 54 §11.2)', () => {
  it('dedupes by DOI', () => {
    const r = dedupeRecords([
      { title: 'Paper A', doi: '10.1000/a' },
      { title: 'Paper A dup', doi: '10.1000/a' },
      { title: 'Paper B', doi: '10.1000/b' },
    ]);
    expect(r.ok).toBe(true);
    expect(r.unique).toHaveLength(2);
    expect(r.duplicates).toHaveLength(1);
  });

  it('dedupes by URL when no DOI', () => {
    const r = dedupeRecords([
      { title: 'X', url: 'https://example.com/1' },
      { title: 'X dup', url: 'https://example.com/1' },
    ]);
    expect(r.unique).toHaveLength(1);
  });

  it('dedupes by normalized title hash as last resort', () => {
    const r = dedupeRecords([
      { title: 'Photosynthesis: Basics!' },
      { title: 'photosynthesis basics' },
    ]);
    expect(r.unique).toHaveLength(1);
  });

  it('normalizeTitleForDedupe strips punctuation and collapses whitespace', () => {
    expect(normalizeTitleForDedupe('  Fotosintez — Asoslar!  ')).toBe('fotosintez asoslar');
    const h = titleDedupeHash('Fotosintez');
    expect(h).toHaveLength(32);
    expect(h).toBe(titleDedupeHash('Fotosintez')); // deterministic
  });
});

// ═══════════════════════════════════════════════════════════════════
// RANKING (§11.2)
// ═══════════════════════════════════════════════════════════════════

describe('resource-reco — weighted ranking (Prompt 54 §11.2)', () => {
  it('default weights sum to 1.00', () => {
    const sum = Object.values(RANKING_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 2);
  });

  it('perfect components → score 1.0', () => {
    const r = computeRecommendationScore({
      relevance: 1, authority: 1, recency: 1, citations: 1,
      pedagogy: 1, language: 1, license: 1, preference: 1,
    });
    expect(r.ok).toBe(true);
    expect(r.score).toBeCloseTo(1, 2);
  });

  it('zero components → score 0', () => {
    const r = computeRecommendationScore({});
    expect(r.score).toBe(0);
  });

  it('weighted breakdown matches §11.2', () => {
    const r = computeRecommendationScore({
      relevance: 1, authority: 0, recency: 0, citations: 0,
      pedagogy: 0, language: 0, license: 0, preference: 0,
    });
    expect(r.weighted.relevance).toBeCloseTo(0.35, 2);
    expect(r.score).toBeCloseTo(0.35, 2);
  });

  it('rejects non-finite component', () => {
    expect(computeRecommendationScore({ relevance: NaN }).ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// QUOTA / BACKOFF (§11.2 cache va batch shart)
// ═══════════════════════════════════════════════════════════════════

describe('resource-reco — quota and backoff (Prompt 54 §11.2)', () => {
  const now = Date.now();

  it('quota available when below limit', () => {
    const r = applyQuota({ used: 5, limit: 100, windowStart: now, now });
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(95);
  });

  it('quota exhausted when used >= limit', () => {
    const r = applyQuota({ used: 100, limit: 100, windowStart: now, now });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/quota exhausted/i);
  });

  it('no limit configured → not ok', () => {
    expect(applyQuota({ used: 0, limit: 0, windowStart: now, now }).ok).toBe(false);
  });

  it('expired window resets quota', () => {
    const r = applyQuota({ used: 100, limit: 100, windowStart: now - 25 * 3600 * 1000, now });
    expect(r.ok).toBe(true);
    expect(r.reset).toBe(true);
  });

  it('exponential backoff grows and stays bounded', () => {
    const a = computeBackoff({ retryCount: 0, baseMs: 1000, maxMs: 60000 });
    const b = computeBackoff({ retryCount: 3, baseMs: 1000, maxMs: 60000 });
    expect(a).toBeGreaterThanOrEqual(1000);
    expect(a).toBeLessThan(1500);
    expect(b).toBeGreaterThanOrEqual(8000);
    expect(b).toBeLessThan(12000);
    const capped = computeBackoff({ retryCount: 99, baseMs: 1000, maxMs: 60000 });
    expect(capped).toBeLessThanOrEqual(72000);
  });
});

// ═══════════════════════════════════════════════════════════════════
// LLM HALLUCINATION GUARD (§11.4)
// ═══════════════════════════════════════════════════════════════════

describe('resource-reco — LLM hallucination guard (Prompt 54 §11.4)', () => {
  const retrieved = [
    { title: 'Real paper', doi: '10.1/real' },
    { title: 'Second real', url: 'https://example.com/2' },
  ];

  it('candidates subset of retrieved → allowed', () => {
    const r = assertLlmOnlyRanksRecords({
      retrieved,
      candidates: [{ title: 'Real paper', doi: '10.1/real' }],
    });
    expect(r.ok).toBe(true);
    expect(r.allowed).toHaveLength(1);
  });

  it('LLM yaratgan hallucinated record → bloklanadi', () => {
    const r = assertLlmOnlyRanksRecords({
      retrieved,
      candidates: [
        { title: 'Real paper', doi: '10.1/real' },
        { title: 'HALLUCINATED fake paper', doi: '10.999/fake' },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/hallucinated/i);
    expect(r.allowed).toHaveLength(1);
  });

  it('title-based match works when no DOI/URL', () => {
    const r = assertLlmOnlyRanksRecords({
      retrieved: [{ title: 'Photosynthesis basics' }],
      candidates: [{ title: 'Photosynthesis: Basics!' }],
    });
    expect(r.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// CITATION / FEEDBACK / TERMS / TRANSCRIPT GUARD
// ═══════════════════════════════════════════════════════════════════

describe('resource-reco — citation, feedback, terms (Prompt 54 §15)', () => {
  it('formatCitation — APA-ish with DOI', () => {
    const c = formatCitation({
      title: 'Paper title',
      authors: ['Ali Valiev'],
      publication_date: '2024-06-01',
      doi: '10.1/abc',
    });
    expect(c).toContain('Ali Valiev');
    expect(c).toContain('(2024).');
    expect(c).toContain('https://doi.org/10.1/abc');
  });

  it('formatCitation handles no authors/date', () => {
    const c = formatCitation({ title: 'No authors' });
    expect(c).toContain('No authors');
  });

  it('validateFeedback — allowed actions + source_pack requires id', () => {
    expect(validateFeedback({ action: 'trust' }).ok).toBe(true);
    expect(validateFeedback({ action: 'source_pack' }).ok).toBe(false);
    expect(validateFeedback({ action: 'source_pack', sourcePackId: 1 }).ok).toBe(true);
    expect(validateFeedback({ action: 'delete' }).ok).toBe(false);
  });

  it('checkProviderTerms — youtube transcript scraping prohibited', () => {
    const yt = checkProviderTerms('youtube', {});
    expect(yt.ok).toBe(false);
    expect(yt.reason).toMatch(/transcript scraping is PROHIBITED/i);
    expect(PROVIDER_TERMS.youtube.quotaNote).toMatch(/search\.list 100 quota/i);
  });

  it('checkProviderTerms — crossref metadata only ok', () => {
    expect(checkProviderTerms('crossref', {}).ok).toBe(true);
    expect(PROVIDER_TERMS.crossref.fullText).toMatch(/metadata only/i);
  });

  it('detectTranscriptScrapeIntent blocks transcript endpoints', () => {
    expect(detectTranscriptScrapeIntent('https://www.youtube.com/api/timedtext?lang=uz').ok).toBe(false);
    expect(detectTranscriptScrapeIntent('https://www.youtube.com/watch?v=abc').ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SEARCH INPUT VALIDATION
// ═══════════════════════════════════════════════════════════════════

describe('resource-reco — search request validation', () => {
  it('accepts valid query', () => {
    const r = validateSearchRequest({ query: 'fotosintez', limit: 10, providers: ['openalex'] });
    expect(r.ok).toBe(true);
    expect(r.normalized.query).toBe('fotosintez');
  });

  it('rejects short query and bad limit', () => {
    expect(validateSearchRequest({ query: 'ab' }).ok).toBe(false);
    expect(validateSearchRequest({ query: 'fotosintez', limit: 0 }).ok).toBe(false);
    expect(validateSearchRequest({ query: 'fotosintez', limit: 100 }).ok).toBe(false);
  });

  it('rejects unsupported provider', () => {
    expect(validateSearchRequest({ query: 'x', providers: ['bogus'] }).ok).toBe(false);
  });

  it('defaults providers to all when empty', () => {
    const r = validateSearchRequest({ query: 'fotosintez' });
    expect(r.normalized.providers).toEqual(RESOURCE_PROVIDERS);
  });

  it('searchQueryHash deterministic + provider-order independent', () => {
    expect(searchQueryHash('x', ['a', 'b'])).toBe(searchQueryHash('x', ['b', 'a']));
    expect(searchQueryHash('x', ['a'])).not.toBe(searchQueryHash('y', ['a']));
  });
});
