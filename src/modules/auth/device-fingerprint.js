/**
 * Deborah — Device fingerprint storage (AUTH A-28, user_devices)
 * -------------------------------------------------------------------
 * `users.{userId}.devices.{fingerprintHash}`:
 *   { first_seen, last_seen, lastCity, lastIpHash, userAgent, trusted, riskEvents[] }
 *
 * Privacy (guide §14 — majburiy):
 *   - FAQAT fingerprint HASH saqlanadi (raw telemetry/raw canvas yo'q).
 *   - risk_events faqat hash'lar (ipHash) — IP hech qachon saqlanmaydi.
 *   - Retention: risk_events oxirgi 20 ta (slice).
 *   - DSAR/delete: user bilan birga o'chadi (users/{id} scope).
 *   - userAgent faqat parseDevice agregati (qurilma/brauzer) — emas, raw UA
 *     saqlanadi lekin hech qachon UI/preview'ga chiqmaydi (A-09 invariant).
 */
import { fb } from '../../../firebase/admin.js';
import { ipHash, withQueueLock } from './new-device.js';
import { cityFromIp } from './geo-lite.js';

const RISK_EVENTS_MAX = 20; // retention — oxirgi 20 event

/** Fingerprint hash formati: 16-64 belgili hex (FNV-1a/SHA — client'dan). */
export function isFingerprintHash(value) {
  return typeof value === 'string' && /^[a-f0-9]{16,64}$/i.test(value);
}

/** Sanitize: hash key'ni path-safe qiladi (safeKey emas — case lower qiladi). */
function devicePath(userId, fingerprintHash) {
  return `users/${userId}/devices/${String(fingerprintHash).toLowerCase()}`;
}

/** Device record'ni o'qiydi (yo'q bo'lsa null). */
export async function getDevice(userId, fingerprintHash) {
  if (!userId || !isFingerprintHash(fingerprintHash)) return null;
  try {
    const snap = await fb.get(devicePath(userId, fingerprintHash));
    return snap.exists() ? snap.val() : null;
  } catch (_) {
    return null;
  }
}

/**
 * Device record yaratadi/yangilaydi (last_seen, last_city, last_ip_hash,
 * risk_events append + retention). Per-user queue mutex (new-device.js
 * withQueueLock) — parallel login'lar read-modify-write'ni race qilib
 * risk_events yo'qotmasin (review: A-09 cap/dedupe race'i bilan bir xil).
 * @returns yangi record.
 */
export async function touchDevice({ userId, fingerprintHash, ipAddress, userAgent, riskEvents }) {
  if (!userId || !isFingerprintHash(fingerprintHash)) return null;
  return withQueueLock(userId, async () => {
    const now = Date.now();
    const existing = await getDevice(userId, fingerprintHash);
    const city = cityFromIp(ipAddress);
    const record = {
      first_seen: existing?.first_seen ?? now,
      last_seen: now,
      last_city: city ?? existing?.last_city ?? null,
      last_ip_hash: ipHash(ipAddress) ?? existing?.last_ip_hash ?? null,
      user_agent: userAgent ? String(userAgent).substring(0, 500) : existing?.user_agent ?? null,
      trusted: existing?.trusted === true,
      // Retention: oxirgi RISK_EVENTS_MAX (privacy — qisqa)
      risk_events: [...(existing?.risk_events || []), ...(riskEvents || [])].slice(-RISK_EVENTS_MAX),
    };
    await fb.set(devicePath(userId, fingerprintHash), record);
    return record;
  });
}

/** Trusted flag'ni o'rnatadi (user confirm, guide §07). */
export async function setDeviceTrusted(userId, fingerprintHash, trusted) {
  if (!userId || !isFingerprintHash(fingerprintHash)) return { ok: false, error: 'bad_fingerprint' };
  const path = devicePath(userId, fingerprintHash);
  const snap = await fb.get(path);
  if (!snap.exists()) return { ok: false, error: 'device_not_found' };
  await fb.set(path, { ...snap.val(), trusted: trusted === true, trustedAt: Date.now() });
  return { ok: true };
}

/**
 * Device ro'yxati — UI uchun PII-minimal ko'rinish:
 * faqat { hash, first_seen, last_seen, trusted } — userAgent/ipHash YO'Q.
 */
export async function listDevices(userId) {
  if (!userId) return [];
  try {
    const snap = await fb.get(`users/${userId}/devices`);
    if (!snap.exists()) return [];
    const raw = snap.val() || {};
    return Object.entries(raw)
      .map(([hash, d]) => ({
        hash,
        firstSeen: d.first_seen ?? null,
        lastSeen: d.last_seen ?? null,
        trusted: d.trusted === true,
      }))
      .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  } catch (_) {
    return [];
  }
}
