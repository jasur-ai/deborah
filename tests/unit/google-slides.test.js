/**
 * Deborah — Google Slides Adapter (unit tests, Prompt 59)
 *
 * Pure schema: PKCE, incremental OAuth URL (drive.file only), full Drive
 * scope guard (§15), create presentation request, canonical blocks →
 * slide mapping, batchUpdate request builder (atomic), export request,
 * callback state CSRF, revoke params.
 */

import { describe, it, expect } from 'vitest';
import {
  buildPkcePair,
  buildGoogleAuthUrlParams,
  assertDriveFileScope,
  buildCreatePresentationRequest,
  mapCanonicalBlocksToSlides,
  buildBatchUpdateRequests,
  buildExportRequest,
  validateCallbackState,
  buildRevokeParams,
  GOOGLE_DRIVE_FILE_SCOPE,
} from '../../src/modules/google-slides/index.js';

describe('google-slides — PKCE + auth URL (§9.9)', () => {
  it('builds verifier + S256 challenge', () => {
    const p = buildPkcePair();
    expect(p.method).toBe('S256');
    expect(p.verifier.length).toBeGreaterThan(20);
    expect(p.challenge).toBeTruthy();
  });

  it('auth URL uses drive.file scope only (incremental OAuth)', () => {
    const p = buildGoogleAuthUrlParams({ clientId: 'g1', redirectUri: 'http://x/cb', state: 's1', challenge: 'ch1' });
    expect(p.get('scope')).toBe(GOOGLE_DRIVE_FILE_SCOPE);
    expect(p.get('scope')).not.toContain('drive.readonly');
    expect(p.get('access_type')).toBe('offline');
    expect(p.get('code_challenge_method')).toBe('S256');
  });
});

describe('google-slides — full Drive scope guard (§15)', () => {
  it('accepts drive.file', () => {
    expect(assertDriveFileScope(GOOGLE_DRIVE_FILE_SCOPE).ok).toBe(true);
  });

  it('accepts openid/email-only tokens', () => {
    expect(assertDriveFileScope('openid email').ok).toBe(true);
  });

  it('rejects full drive scope', () => {
    const r = assertDriveFileScope('https://www.googleapis.com/auth/drive');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/forbidden/i);
  });

  it('rejects drive.readonly', () => {
    const r = assertDriveFileScope('https://www.googleapis.com/auth/drive.readonly');
    expect(r.ok).toBe(false);
  });

  it('rejects scopes without drive.file and without identity', () => {
    const r = assertDriveFileScope('https://www.googleapis.com/auth/documents');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/drive\.file scope required/i);
  });
});

describe('google-slides — create + batchUpdate (§59-12)', () => {
  it('builds create presentation request with truncated title', () => {
    const r = buildCreatePresentationRequest({ title: 'Fotosintez — Biology 8-sinf' });
    expect(r.title).toBe('Fotosintez — Biology 8-sinf');
  });

  it('maps canonical blocks to slide texts', () => {
    const doc = {
      slides: [
        {
          id: 's1',
          title: 'Kirish',
          blocks: [
            { type: 'heading', content: { heading: 'Fotosintez' } },
            { type: 'bullets', content: { items: ['A', 'B'] } },
            { type: 'image', content: { url: 'x' } },
          ],
        },
      ],
    };
    const r = mapCanonicalBlocksToSlides(doc);
    expect(r.ok).toBe(true);
    expect(r.slides[0].texts).toEqual(['Fotosintez', 'A\nB']);
    expect(r.slides[0].title).toBe('Kirish');
  });

  it('rejects document without slides', () => {
    expect(mapCanonicalBlocksToSlides({}).ok).toBe(false);
  });

  it('builds atomic batchUpdate requests (createSlide + insertText + bullets)', () => {
    const requests = buildBatchUpdateRequests({
      slides: [{ slideIndex: 0, title: 'Kirish', texts: ['Fotosintez'] }],
    });
    const kinds = requests.map((r) => Object.keys(r)[0]);
    expect(kinds).toContain('createSlide');
    expect(kinds).toContain('insertText');
    expect(kinds).toContain('createParagraphBullets');
    expect(requests[0].createSlide.objectId).toBe('slide_1');
  });
});

describe('google-slides — export + revoke + state', () => {
  it('builds Drive export request params', () => {
    const r = buildExportRequest({ fileId: 'f1' });
    expect(r.fileId).toBe('f1');
    expect(r.mimeType).toBe('application/vnd.google-apps.presentation');
  });

  it('builds revoke params', () => {
    expect(buildRevokeParams({ token: 'tok' })).toEqual({ token: 'tok' });
  });

  it('validates callback state (CSRF)', () => {
    expect(validateCallbackState({ state: 'x', expected: 'x' }).ok).toBe(true);
    expect(validateCallbackState({ state: 'x', expected: 'y' }).ok).toBe(false);
  });
});
