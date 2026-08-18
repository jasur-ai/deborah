/**
 * Deborah — Resource Recommendation Connectors (e2e/security tests, Prompt 54)
 *
 * Security & data guards (§15):
 *   - LLM bibliographic record yaratmaydi — assertLlmOnlyRanksRecords
 *     hallucinated candidate'ni bloklaydi.
 *   - YouTube transcript scraping taqiqlangan — checkProviderTerms +
 *     detectTranscriptScrapeIntent bloklaydi.
 *   - Citation output verified metadata'dan formatlanadi.
 *   - Ranking "why recommended" breakdown §11.2 weights bo'yicha.
 */

import { describe, it, expect } from 'vitest';
import {
  assertLlmOnlyRanksRecords,
  checkProviderTerms,
  detectTranscriptScrapeIntent,
  formatCitation,
  computeRecommendationScore,
  normalizeProviderRecord,
  dedupeRecords,
  PROVIDER_TERMS,
  RANKING_WEIGHTS,
} from '../../src/modules/resource-reco/index.js';

describe('resource-reco — e2e/security (Prompt 54 §15-17)', () => {
  it('SECURITY: LLM hallucinated reference bloklanadi — citation faqat real recorddan', () => {
    // Provider API real record qaytardi
    const n1 = normalizeProviderRecord('crossref', {
      DOI: '10.1000/real',
      title: ['Verified photosynthesis paper'],
      author: [{ given: 'Ali', family: 'Valiev' }],
    });
    expect(n1.ok).toBe(true);
    const retrieved = [n1.record];

    // LLM faqat shu recordni ranklashi mumkin
    const good = assertLlmOnlyRanksRecords({
      retrieved,
      candidates: [{ title: 'Verified photosynthesis paper', doi: '10.1000/real' }],
    });
    expect(good.ok).toBe(true);
    expect(formatCitation(good.allowed[0])).toContain('https://doi.org/10.1000/real');

    // LLM o\u2018zi "ixtiro qilgan" paper — bloklanadi
    const bad = assertLlmOnlyRanksRecords({
      retrieved,
      candidates: [
        { title: 'Verified photosynthesis paper', doi: '10.1000/real' },
        { title: 'Totally fake paper', doi: '10.9999/fake' },
      ],
    });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toMatch(/hallucinated/i);
  });

  it('SECURITY: YouTube transcript scraping to\u2018liq taqiqlangan', () => {
    const yt = checkProviderTerms('youtube', {});
    expect(yt.ok).toBe(false);
    expect(PROVIDER_TERMS.youtube.transcriptScraping).toBe(true);

    // Transcript endpoint'larga request — blok
    expect(detectTranscriptScrapeIntent('https://www.youtube.com/api/timedtext?v=x').ok).toBe(false);
    expect(detectTranscriptScrapeIntent('https://example.com/transcript').ok).toBe(false);
    // Oddiy video URL — ruxsat
    expect(detectTranscriptScrapeIntent('https://www.youtube.com/watch?v=x').ok).toBe(true);
  });

  it('SECURITY: LLM record yaratmaydi — dedupe + ranking faqat retrieved ustida', () => {
    const n1 = normalizeProviderRecord('openalex', {
      id: 'W1',
      title: 'Real paper',
      doi: '10.1/a',
      cited_by_count: 10,
      publication_date: '2025-01-01',
    });
    const n2 = normalizeProviderRecord('openalex', {
      id: 'W2',
      title: 'Real paper dup',
      doi: '10.1/a',
    });
    const d = dedupeRecords([n1.record, n2.record]);
    expect(d.unique).toHaveLength(1);

    const s = computeRecommendationScore({
      relevance: 0.9, authority: 0.8, recency: 0.7, citations: 0.5,
      pedagogy: 0.6, language: 1, license: 1, preference: 0.5,
    });
    expect(s.ok).toBe(true);
    expect(s.score).toBeGreaterThan(0.6);
    // §11.2 weights hujjatga mos
    expect(RANKING_WEIGHTS.relevance).toBe(0.35);
    expect(RANKING_WEIGHTS.preference).toBe(0.05);
  });

  it('UI: why-recommended breakdown ranked score bo\u2018yicha tartiblanadi', () => {
    const a = computeRecommendationScore({
      relevance: 1, authority: 1, recency: 1, citations: 1,
      pedagogy: 1, language: 1, license: 1, preference: 1,
    });
    const b = computeRecommendationScore({});
    expect(a.score).toBeGreaterThan(b.score);
    expect(a.weighted.relevance).toBeCloseTo(0.35, 2);
  });
});
