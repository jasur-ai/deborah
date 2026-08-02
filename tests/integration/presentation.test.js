/**
 * Edikit — Canonical Presentation & Native Editor (integration tests, Prompt 56)
 *
 * Service qatlami: graceful degradation (PG'siz → 400/error), validate-before-
 * getDb, idempotent save, published-immutable guard. PostgreSQL yo'q muhitda
 * service'ning fail-closed xatti-harakati tekshiriladi.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('presentation — integration (Prompt 56 §19)', () => {
  let mod;
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../../src/infrastructure/postgres.js', () => ({ getDb: () => null }));
    mod = await import('../../src/modules/presentation/index.js');
  });

  const validDoc = {
    title: 'Fotosintez',
    language: 'uz',
    slides: [
      { id: 's1', layout: 'title-body', title: 'Intro', blocks: [{ type: 'bullets', content: { items: ['A'] } }] },
    ],
  };

  it('createPresentation — PG yo\u2018q → graceful error', async () => {
    const r = await mod.createPresentation({ title: 'X', document: validDoc });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PostgreSQL required/i);
  });

  it('createPresentation — invalid document rejected before DB', async () => {
    const r = await mod.createPresentation({ title: 'X', document: { slides: [] } });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/title is required|at least one slide/i);
  });

  it('createPresentation — provider raw leak rejected before DB (§15)', async () => {
    const r = await mod.createPresentation({
      title: 'X',
      document: validDoc,
      provider: { name: 'gamma', raw: { secretToken: 'sk-x' } },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/leak outside canonical model/i);
  });

  it('saveDocument — PG yo\u2018q → graceful error', async () => {
    const r = await mod.saveDocument({ presentationId: 1, document: validDoc });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PostgreSQL required/i);
  });

  it('saveDocument — invalid document rejected before DB', async () => {
    const r = await mod.saveDocument({ presentationId: 1, document: { slides: [] } });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/title is required|at least one slide/i);
  });

  it('rollbackToVersion — PG yo\u2018q → graceful error', async () => {
    const r = await mod.rollbackToVersion({ presentationId: 1, targetVersionId: 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PostgreSQL required/i);
  });

  it('rollbackToVersion — missing ids rejected before DB', async () => {
    const r = await mod.rollbackToVersion({});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/presentationId and targetVersionId are required/i);
  });

  it('diffVersionsOfPresentation — missing ids rejected before DB', async () => {
    const r = await mod.diffVersionsOfPresentation({});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/presentationId, fromVersionId, toVersionId are required/i);
  });

  it('reorderPresentationSlides — PG yo\u2018q → graceful error', async () => {
    const r = await mod.reorderPresentationSlides({ presentationId: 1, fromIndex: 0, toIndex: 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PostgreSQL required/i);
  });

  it('addComment — empty body rejected before DB', async () => {
    const r = await mod.addComment({ presentationId: 1, body: '' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/comment body is required/i);
  });

  it('exportPresentation — unsupported format rejected before DB', async () => {
    const r = await mod.exportPresentation({ presentationId: 1, format: 'docx' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unsupported export format/i);
  });

  it('exportPresentation — PG yo\u2018q → graceful error', async () => {
    const r = await mod.exportPresentation({ presentationId: 1, format: 'pptx' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PostgreSQL required/i);
  });

  it('publishPresentation — PG yo\u2018q → graceful error', async () => {
    const r = await mod.publishPresentation({ presentationId: 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PostgreSQL required/i);
  });

  it('runSlideQaOnVersion — PG yo\u2018q → graceful error', async () => {
    const r = await mod.runSlideQaOnVersion({ presentationId: 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PostgreSQL required/i);
  });

  it('getPresentationDashboard — PG yo\u2018q → empty graceful shape', async () => {
    const r = await mod.getPresentationDashboard();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PostgreSQL required/i);
    expect(Array.isArray(r.presentations)).toBe(true);
  });
});
