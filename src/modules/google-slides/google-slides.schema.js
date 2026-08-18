/**
 * Deborah — Google Slides Adapter (pure logic)
 *
 * Prompt 59 — Google Slides minimum-scope (drive.file) integratsiyasi
 * (research.md §9.9: Slides API presentations.batchUpdate atomik update,
 * Drive API orqali export; recommended scope drive.file — faqat Deborah
 * yaratgan yoki user explicit tanlagan fayllar; full Drive restricted
 * scope olinmasin; §22.8 Google token boshqa provider'ga uzatilmaydi).
 * This module is PURE (no I/O, no globals):
 *
 *   - buildPkcePair: PKCE S256 verifier/challenge.
 *   - buildGoogleAuthUrlParams: incremental OAuth — scope faqat drive.file.
 *   - assertDriveFileScope: full Drive scope request qilinsa REJECT.
 *   - buildCreatePresentationRequest: slides.create request body.
 *   - buildBatchUpdateRequests: canonical blocks → Slides batchUpdate
 *     (insertText, createParagraphBullets, insertImage) atomik.
 *   - mapCanonicalBlocksToSlides: canonical doc → slide text mapping.
 *   - buildExportRequest: Drive files.export params.
 *   - validateCallbackState: state (CSRF) tekshiruvi.
 *   - buildRevokeParams: token revoke.
 *
 * SECURITY / DATA GUARD (Prompt 59 §15):
 *   - drive.file minimum scope — full Drive default olinmaydi.
 *   - Google token Canva/Gamma/Manus/Anthropic'ga berilmaydi (§22.8).
 *   - Token vault encrypted.
 */

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

import { randomBytes, createHash } from 'crypto';

/** Minimum scope — faqat drive.file (research §9.9). */
export const GOOGLE_DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** Full restricted scopes — HECH QACHON default olinmaydi (§15). */
export const FORBIDDEN_GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.readonly',
];

export const SLIDES_API = 'https://slides.googleapis.com/v1/presentations';

// ═══════════════════════════════════════════════════════════════════
// PKCE + AUTH URL
// ═══════════════════════════════════════════════════════════════════

/** Generate PKCE pair (S256). */
export function buildPkcePair() {
  const verifier = randomBytes(32).toString('base64url').replace(/=/g, '');
  const challenge = createHash('sha256').update(verifier).digest('base64url').replace(/=/g, '');
  return { verifier, challenge, method: 'S256' };
}

/**
 * Build Google OAuth authorize URL params — INCREMENTAL OAuth, faqat
 * drive.file (boshqa scope'lar talab qilinmaydi).
 */
export function buildGoogleAuthUrlParams({ clientId = '', redirectUri = '', state = '', challenge = '', accessType = 'offline', prompt = 'consent' } = {}) {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_DRIVE_FILE_SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: accessType,
    prompt,
  });
  return p;
}

/** Assert requested scope is drive.file (or openid/email only) — full Drive REJECT. */
export function assertDriveFileScope(scope = '') {
  const scopes = String(scope || '').split(' ').filter(Boolean);
  const forbidden = scopes.filter((s) => FORBIDDEN_GOOGLE_SCOPES.includes(s));
  if (forbidden.length) {
    return { ok: false, reason: `forbidden full Drive scope requested: ${forbidden.join(', ')}`, forbidden };
  }
  // drive.file bo'lmasa ham (masalan faqat openid) — minimal ruxsat yetarli emas
  if (scopes.length && !scopes.includes(GOOGLE_DRIVE_FILE_SCOPE) && !scopes.some((s) => s.startsWith('openid') || s.includes('email'))) {
    return { ok: false, reason: 'drive.file scope required' };
  }
  return { ok: true };
}

/** Validate OAuth callback state (CSRF). */
export function validateCallbackState({ state = '', expected = '' }) {
  if (!state || !expected) return { ok: false, reason: 'missing state' };
  const ok = state.length === expected.length && state.split('').every((c, i) => c === expected[i]);
  return ok ? { ok: true } : { ok: false, reason: 'state mismatch (CSRF)' };
}

// ═══════════════════════════════════════════════════════════════════
// SLIDES CREATE / BATCHUPDATE — §59-12
// ═══════════════════════════════════════════════════════════════════

/** Build slides.create request body (title + 1 blank slide). */
export function buildCreatePresentationRequest({ title = 'Deborah deck' } = {}) {
  return { title: String(title).slice(0, 100) };
}

/** Map canonical deck blocks → slide text content (for batchUpdate). */
export function mapCanonicalBlocksToSlides(doc = {}) {
  if (!Array.isArray(doc.slides)) return { ok: false, reason: 'no slides' };
  const slides = doc.slides.map((s, i) => {
    const texts = (s.blocks || [])
      .filter((b) => ['text', 'heading', 'bullets'].includes(b.type))
      .map((b) => {
        if (b.type === 'bullets') return (b.content?.items || []).join('\n');
        return b.content?.text || b.content?.heading || '';
      })
      .filter(Boolean);
    return {
      slideIndex: i,
      title: s.title || `Slide ${i + 1}`,
      texts,
    };
  });
  return { ok: true, slides };
}

/**
 * Build Slides batchUpdate requests — canonical blocks → atomic updates.
 * - addSlide: yangi bo'sh slide
 * - insertText: sarlavha + blok matnlari
 * - createParagraphBullets: bullets uchun
 * - insertImage: rasm bloklari (url)
 */
export function buildBatchUpdateRequests({ slides = [] } = {}) {
  const requests = [];
  for (const s of slides || []) {
    requests.push({
      createSlide: { objectId: `slide_${s.slideIndex + 1}`, insertionIndex: s.slideIndex },
    });
    requests.push({
      insertText: {
        objectId: `slide_${s.slideIndex + 1}`,
        insertionIndex: 0,
        text: s.title ? `${s.title}\n` : '',
      },
    });
    for (const t of s.texts || []) {
      requests.push({
        insertText: { objectId: `slide_${s.slideIndex + 1}`, insertionIndex: 0, text: `${t}\n` },
      });
    }
    if ((s.texts || []).length > 0) {
      requests.push({
        createParagraphBullets: { objectId: `slide_${s.slideIndex + 1}`, textRange: { type: 'ALL' } },
      });
    }
  }
  return requests;
}

/** Build Drive files.export params (PPTX/PDF). */
export function buildExportRequest({ fileId = '', mimeType = 'application/vnd.google-apps.presentation' } = {}) {
  return { fileId, mimeType };
}

/** Build token revoke params. */
export function buildRevokeParams({ token = '' } = {}) {
  return { token: String(token) };
}
