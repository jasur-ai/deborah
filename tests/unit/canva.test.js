/**
 * Edikit — Canva Button/Connect Adapter (unit tests, Prompt 59)
 *
 * Pure schema: PKCE pair build, auth URL params (minimal scopes only),
 * callback state CSRF check, Button onDesignOpen/onDesignPublish
 * validation, design → artifact mapping, scope allowlist guard,
 * import artifact mapping, temp URL guard.
 */

import { describe, it, expect } from 'vitest';
import {
  buildPkcePair,
  buildAuthUrlParams,
  validateCallbackState,
  validateButtonCallback,
  mapDesignToArtifact,
  assertCanvaScope,
  mapImportArtifact,
  mapTempUrl,
  CANVA_SCOPES,
  BUTTON_CALLBACKS,
} from '../../src/modules/canva/index.js';

describe('canva — PKCE (Prompt 59 §9.8)', () => {
  it('builds deterministic verifier + S256 challenge', () => {
    const p = buildPkcePair('somedeterministicseedvalue');
    expect(p.method).toBe('S256');
    expect(p.verifier).toBeTruthy();
    expect(p.challenge).toBeTruthy();
    expect(p.challenge).not.toBe(p.verifier);
  });

  it('builds different challenges for different seeds', () => {
    const a = buildPkcePair('seed-a');
    const b = buildPkcePair('seed-b');
    expect(a.challenge).not.toBe(b.challenge);
  });
});

describe('canva — auth URL params', () => {
  it('includes only minimal scopes (design:create:edit etc.)', () => {
    const p = buildAuthUrlParams({ clientId: 'c1', redirectUri: 'http://x/cb', state: 's1', challenge: 'ch1' });
    const scope = p.get('scope');
    expect(scope).toBe(CANVA_SCOPES.join(' '));
    expect(scope).not.toContain('account');
    expect(p.get('response_type')).toBe('code');
    expect(p.get('code_challenge_method')).toBe('S256');
  });
});

describe('canva — callback state CSRF', () => {
  it('accepts matching state', () => {
    expect(validateCallbackState({ state: 'abc123', expected: 'abc123' })).toEqual({ ok: true });
  });

  it('rejects mismatched state', () => {
    const r = validateCallbackState({ state: 'abc123', expected: 'abc124' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/CSRF/i);
  });

  it('rejects missing state', () => {
    expect(validateCallbackState({ state: '', expected: 'x' }).ok).toBe(false);
  });
});

describe('canva — Button callbacks (§59-07)', () => {
  it('validates onDesignPublish with designId + designUrl', () => {
    const r = validateButtonCallback({
      type: BUTTON_CALLBACKS.DESIGN_PUBLISH,
      designId: 'DAbc123',
      designUrl: 'https://www.canva.com/design/DAbc123/edit',
      state: 's1',
    });
    expect(r.ok).toBe(true);
    expect(r.type).toBe('onDesignPublish');
    expect(r.designId).toBe('DAbc123');
  });

  it('rejects unknown callback type', () => {
    const r = validateButtonCallback({ type: 'onSomethingElse', designId: 'D1' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/unknown button callback/i);
  });

  it('rejects publish without designUrl or editUrl', () => {
    const r = validateButtonCallback({ type: BUTTON_CALLBACKS.DESIGN_PUBLISH, designId: 'D1' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/designUrl or editUrl/i);
  });

  it('requires designId', () => {
    const r = validateButtonCallback({ type: BUTTON_CALLBACKS.DESIGN_OPEN });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/designId is required/i);
  });
});

describe('canva — design → artifact mapping', () => {
  it('maps design to canonical-only artifact (no provider lock-in)', () => {
    const m = mapDesignToArtifact({
      designId: 'D1',
      designUrl: 'https://www.canva.com/design/D1/edit',
      versionId: 3,
    });
    expect(m.kind).toBe('canva_design');
    expect(m.designId).toBe('D1');
    expect(m.versionId).toBe(3);
    expect(m.canonicalOnly).toBe(true);
  });
});

describe('canva — scope allowlist guard (§15)', () => {
  it('accepts minimal scopes', () => {
    expect(assertCanvaScope(['design:create:edit', 'design:export']).ok).toBe(true);
  });

  it('rejects full account scope', () => {
    const r = assertCanvaScope(['design:create:edit', 'account:read']);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/non-minimal/i);
  });

  it('handles space-separated string input', () => {
    const r = assertCanvaScope('design:create:edit account:read');
    expect(r.ok).toBe(false);
    expect(r.invalid).toContain('account:read');
  });
});

describe('canva — import artifact mapping', () => {
  it('maps supported import types', () => {
    expect(mapImportArtifact({ fileType: 'pptx', designId: 'D1' }).ok).toBe(true);
    expect(mapImportArtifact({ fileType: 'PDF', designId: 'D1' }).ok).toBe(true);
  });

  it('rejects unsupported import types', () => {
    const r = mapImportArtifact({ fileType: 'exe' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/unsupported import type/i);
  });
});

describe('canva — temporary URL guard', () => {
  it('accepts canva.com edit/view URLs', () => {
    expect(mapTempUrl({ url: 'https://www.canva.com/design/D1/edit' }).ok).toBe(true);
    expect(mapTempUrl({ url: 'https://canva.com/design/D1/view' }).ok).toBe(true);
  });

  it('rejects non-canva URLs (open redirect guard)', () => {
    const r = mapTempUrl({ url: 'https://evil.example.com/phish' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/canva\.com/i);
  });
});
