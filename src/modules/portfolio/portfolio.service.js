/**
 * Edikit — Portfolio service (AUTH A-12)
 * --------------------------------------
 * Local-DB (fb) based portfolio storage:
 *   - portfolio_profiles/{userId}      — user's portfolio meta (isPublic)
 *   - portfolio_items/{itemId}         — evidence items (default-private)
 *   - portfolio_share_grants/{tokenHash} — selective share links
 *
 * Security model (A-12 §07, §12, §17):
 *   - Every item is private by default (opt-in visibility).
 *   - Every owner-scoped call reads `userId` from the session — items and
 *     grants are validated against the owner (IDOR-safe).
 *   - Share links are unguessable 48-byte tokens; only the hash is stored.
 *   - Public payloads never expose raw submission data.
 *   - Privileged actions emit audit events (portfolio:import/share/revoke).
 */

import crypto from 'crypto';
import { fb } from '../../../firebase/admin.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import { safeKey } from '../../../utils/helpers.js';
import { parseTranscriptFile } from './transcript.parser.js';
import { buildTranscriptPdf } from './transcript.pdf.js';

const ITEMS_PATH = 'portfolio_items';
const PROFILES_PATH = 'portfolio_profiles';
const GRANTS_PATH = 'portfolio_share_grants';

export const ITEM_VISIBILITY = { PRIVATE: 'private', SHARED: 'shared', PUBLIC: 'public' };
const ALLOWED_VISIBILITY = new Set(Object.values(ITEM_VISIBILITY));
export const ITEM_KINDS = [
  'proposal', 'outline', 'source_shortlist', 'draft', 'teacher_feedback',
  'reflection', 'oral_defense', 'credential', 'result', 'certificate',
];

function uid() {
  return crypto.randomBytes(8).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function evidenceHash(item) {
  const e = item?.evidence || {};
  return crypto
    .createHash('sha256')
    .update([e.subject, e.grade, e.credit, e.semester].join('|'))
    .digest('hex');
}

async function profileKey(userId) {
  const key = safeKey(String(userId));
  const path = `${PROFILES_PATH}/${key}`;
  const snap = await fb.get(path);
  if (snap.exists()) return snap.val();
  const profile = { userId: String(userId), isPublic: false, createdAt: Date.now(), updatedAt: Date.now() };
  await fb.set(path, profile);
  return profile;
}

function itemView(item) {
  if (!item) return null;
  return {
    id: item.id,
    kind: item.kind || 'draft',
    title: item.title || '',
    visibility: item.visibility || ITEM_VISIBILITY.PRIVATE,
    contentMeta: item.contentMeta || {},
    evidence: item.evidence || {},
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

/** Public share view — curated fields only (no raw submission). */
function publicItemView(item) {
  if (!item) return null;
  const e = item.evidence || {};
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    visibility: item.visibility,
    createdAt: item.createdAt,
    evidence:
      item.kind === 'result' || item.kind === 'certificate'
        ? { subject: e.subject, grade: e.grade, credit: e.credit, semester: e.semester, group: e.group || '' }
        : { summary: String(e.summary || '').slice(0, 500) },
  };
}

// ── Reads ────────────────────────────────────────────────────────────

/** My portfolio items (owner-scoped). */
export async function listItems({ userId = 0 } = {}) {
  const key = safeKey(String(userId));
  const snap = await fb.get(ITEMS_PATH);
  const all = snap.exists() ? snap.val() : {};
  const items = Object.values(all)
    .filter((it) => it.userId === key || it.userId === String(userId))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .map(itemView);
  const profile = await profileKey(userId);
  return { portfolio: { isPublic: !!profile.isPublic }, items };
}

/** Public portfolio — only public items, curated fields. */
export async function getPublicPortfolio({ userId = 0 } = {}) {
  const key = safeKey(String(userId));
  const snap = await fb.get(ITEMS_PATH);
  const all = snap.exists() ? snap.val() : {};
  const items = Object.values(all)
    .filter((it) => (it.userId === key || it.userId === String(userId)) && it.visibility === ITEM_VISIBILITY.PUBLIC)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .map(publicItemView);
  return { items };
}

// ── Writes ───────────────────────────────────────────────────────────

/** Add a manual evidence item — ALWAYS default-private (opt-in model). */
export async function addItem({ userId = 0, kind = 'draft', title = '', contentMeta = {}, evidence = {} } = {}) {
  if (!ALLOWED_KIND(kind)) return { ok: false, error: `invalid item kind: ${kind}` };
  if (!String(title || '').trim()) return { ok: false, error: 'title required' };
  const id = uid();
  const now = Date.now();
  const item = {
    id,
    userId: String(userId),
    kind,
    title: String(title).trim().slice(0, 200),
    visibility: ITEM_VISIBILITY.PRIVATE,
    contentMeta: contentMeta || {},
    evidence: evidence || {},
    createdAt: now,
    updatedAt: now,
  };
  await fb.set(`${ITEMS_PATH}/${id}`, item);
  return { ok: true, itemId: id, item: itemView(item) };
}

/**
 * Import a transcript file into portfolio items.
 * Idempotent per row: rows with an identical evidence hash are skipped.
 */
export async function importTranscript({ userId = 0, filePath = '', extension = '', consent = false } = {}) {
  if (!consent) return { ok: false, code: 'consent_required', error: 'Data-residency consent required' };
  if (!filePath) return { ok: false, code: 'no_file', error: 'file required' };

  const { items, warnings } = await parseTranscriptFile(filePath, extension);

  const snap = await fb.get(ITEMS_PATH);
  const all = snap.exists() ? snap.val() : {};
  const existing = new Set(
    Object.values(all)
      .filter((it) => it.userId === String(userId))
      .map((it) => evidenceHash(it)),
  );

  const created = [];
  const skipped = [];
  const now = Date.now();
  for (const src of items) {
    const hash = evidenceHash(src);
    if (existing.has(hash)) { skipped.push(src.title); continue; }
    existing.add(hash);
    const id = uid();
    const item = {
      id,
      userId: String(userId),
      kind: src.kind || 'result',
      title: src.title.slice(0, 200),
      visibility: ITEM_VISIBILITY.PRIVATE, // A-12 §12 default-private
      contentMeta: { aiUseLevel: 'A0', imported: true },
      evidence: src.evidence || {},
      evidenceHash: hash,
      createdAt: now,
      updatedAt: now,
    };
    await fb.set(`${ITEMS_PATH}/${id}`, item);
    created.push(itemView(item));
  }

  await audit(AUDIT_ACTIONS.PORTFOLIO_IMPORT, {
    actor: String(userId),
    target: 'portfolio_items',
    detail: { file: String(filePath).split('/').pop(), created: created.length, skipped: skipped.length, warnings: warnings.length },
  });

  return { ok: true, created: created.length, skipped: skipped.length, items: created, warnings };
}

/** Set visibility (owner-only): private | shared | public. */
export async function setVisibility({ userId = 0, itemId = '', visibility = ITEM_VISIBILITY.PRIVATE } = {}) {
  if (!ALLOWED_VISIBILITY.has(visibility)) return { ok: false, error: `invalid visibility: ${visibility}` };
  const path = `${ITEMS_PATH}/${itemId}`;
  const snap = await fb.get(path);
  if (!snap.exists()) return { ok: false, error: 'item not found' };
  const item = snap.val();
  if (item.userId !== String(userId)) return { ok: false, code: 'forbidden', error: 'not your item' }; // IDOR guard
  await fb.set(`${path}/visibility`, visibility);
  await fb.set(`${path}/updatedAt`, Date.now());
  return { ok: true, itemId, visibility, item: itemView({ ...item, visibility }) };
}

/** Delete item (owner-only). */
export async function deleteItem({ userId = 0, itemId = '' } = {}) {
  const path = `${ITEMS_PATH}/${itemId}`;
  const snap = await fb.get(path);
  if (!snap.exists()) return { ok: false, error: 'item not found' };
  const item = snap.val();
  if (item.userId !== String(userId)) return { ok: false, code: 'forbidden', error: 'not your item' }; // IDOR guard
  await fb.remove(path);
  await audit(AUDIT_ACTIONS.PORTFOLIO_DELETE, {
    actor: String(userId),
    target: 'portfolio_items',
    detail: { itemId, kind: item.kind },
  });
  return { ok: true, itemId };
}

// ── Share grants (A-12 §12: share only with student permission) ─────

/**
 * Create a selective share grant for an item. Only the owner can share;
 * the item must not be private. Returns an unguessable link token.
 */
export async function createShareGrant({ userId = 0, itemId = '', viewerEmail = null, expiresAt = null } = {}) {
  const path = `${ITEMS_PATH}/${itemId}`;
  const snap = await fb.get(path);
  if (!snap.exists()) return { ok: false, error: 'item not found' };
  const item = snap.val();
  if (item.userId !== String(userId)) return { ok: false, code: 'forbidden', error: 'not your item' }; // IDOR guard
  if (item.visibility === ITEM_VISIBILITY.PRIVATE) {
    return { ok: false, error: 'item is private — set visibility to shared/public first' };
  }

  const token = crypto.randomBytes(48).toString('hex');
  const grant = {
    id: uid(),
    itemId,
    userId: String(userId),
    viewerEmail: viewerEmail ? String(viewerEmail).toLowerCase().slice(0, 200) : null,
    expiresAt: expiresAt || null,
    status: 'active',
    createdAt: Date.now(),
    revokedAt: null,
  };
  await fb.set(`${GRANTS_PATH}/${hashToken(token)}`, grant);

  await audit(AUDIT_ACTIONS.PORTFOLIO_SHARE, {
    actor: String(userId),
    target: 'portfolio_items',
    detail: { itemId, viewerEmail: grant.viewerEmail, expiresAt: grant.expiresAt },
  });

  const url = `/share/${token}`;
  return { ok: true, token, url, grant: { id: grant.id, expiresAt: grant.expiresAt } };
}

/** Revoke a grant (owner-only). */
export async function revokeShareGrant({ userId = 0, grantId = '' } = {}) {
  const snap = await fb.get(GRANTS_PATH);
  const all = snap.exists() ? snap.val() : {};
  const entry = Object.entries(all).find(([, g]) => g.id === grantId);
  if (!entry) return { ok: false, error: 'grant not found' };
  const [tokenHash, grant] = entry;
  if (grant.userId !== String(userId)) return { ok: false, code: 'forbidden', error: 'not your grant' }; // IDOR guard
  await fb.set(`${GRANTS_PATH}/${tokenHash}/status`, 'revoked');
  await fb.set(`${GRANTS_PATH}/${tokenHash}/revokedAt`, Date.now());
  await audit(AUDIT_ACTIONS.PORTFOLIO_REVOKE, {
    actor: String(userId),
    target: 'portfolio_share_grants',
    detail: { grantId, itemId: grant.itemId },
  });
  return { ok: true, grantId };
}

/**
 * Resolve a share token to a public item view.
 * Access requires an active, non-expired grant AND item not private.
 */
export async function resolveShareToken({ token = '', viewerEmail = null } = {}) {
  const tokenHash = hashToken(token);
  const snap = await fb.get(`${GRANTS_PATH}/${tokenHash}`);
  if (!snap.exists()) return { ok: false, error: 'invalid or revoked share link' };
  const grant = snap.val();
  if (grant.status !== 'active') return { ok: false, error: 'share link revoked' };
  if (grant.expiresAt && Date.now() > grant.expiresAt) return { ok: false, error: 'share link expired' };
  if (grant.viewerEmail) {
    const viewer = String(viewerEmail || '').toLowerCase();
    if (!viewer || viewer !== grant.viewerEmail) {
      return { ok: false, code: 'viewer_required', error: 'this link is restricted to a specific email' };
    }
  }

  const itemSnap = await fb.get(`${ITEMS_PATH}/${grant.itemId}`);
  if (!itemSnap.exists()) return { ok: false, error: 'item no longer exists' };
  const item = itemSnap.val();
  if (item.visibility === ITEM_VISIBILITY.PRIVATE) return { ok: false, error: 'item is private' };
  return { ok: true, item: publicItemView(item), grant: { viewerEmail: grant.viewerEmail, expiresAt: grant.expiresAt } };
}

// ── Export (A-12 §13) ────────────────────────────────────────────────

/** Rows for the transcript PDF: semester, subject, grade, credit. */
export async function exportTranscriptRows({ userId = 0 } = {}) {
  const snap = await fb.get(ITEMS_PATH);
  const all = snap.exists() ? snap.val() : {};
  return Object.values(all)
    .filter((it) => it.userId === String(userId) && it.evidence?.subject)
    .sort((a, b) => (a.evidence.semester || '').localeCompare(b.evidence.semester || '', 'en', { numeric: true }))
    .map((it) => ({
      semester: it.evidence.semester || '',
      subject: it.evidence.subject,
      grade: it.evidence.grade || '',
      credit: it.evidence.credit || '',
    }));
}

/** Build a transcript PDF buffer + filename for a user. */
export async function buildUserTranscriptPdf({ userId = 0, displayName = '' } = {}) {
  const rows = await exportTranscriptRows({ userId });
  const pdf = buildTranscriptPdf({ rows, studentName: displayName, title: 'Transkript' });
  const filename = `transkript-${safeKey(String(userId))}.pdf`;
  return { buffer: pdf, filename, rows: rows.length };
}

function ALLOWED_KIND(kind) {
  return ITEM_KINDS.includes(kind);
}

export { profileKey as ensurePortfolioProfile, publicItemView, evidenceHash };
