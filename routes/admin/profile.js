/**
 * S34e — ADMIN PROFILE API (real funksiyalar)
 * ─────────────────────────────────────────────────────────────
 *  Passkeylar      — WebAuthn ro'yxat/qo'shish/o'chirish (admin:{username} ga bog'lanadi)
 *  Sessiyalar      — DB'da kuzatilgan admin sessiyalar + revoke (middleware tekshiradi)
 *  API kalitlar    — real kalitlar (sha256 hash DB'da, to'liq kalit FAQAT yaratishda)
 *  Loglar          — o'z audit yozuvlari + CSV/JSON eksport
 *  MFA             — holat (backup kodlar /admin/mfa'da)
 * Barchasi requireAdmin; seziiv amallar requireRecentAdminAuth (parol reauth).
 */
import { Router } from 'express';
import crypto from 'crypto';
import { fb } from '../../firebase/admin.js';
import { requireAdmin, requireRecentAdminAuth } from '../../middleware/auth.js';
import {
  generateRegistrationChallenge,
  verifyRegistrationResponseFlow,
  listPasskeys,
  removePasskey,
} from '../../src/modules/auth/webauthn.js';
import { getMfaStatus, ADMIN_MFA_ACCOUNT_FALLBACK } from './profile-helpers.js';
import { logAuthEvent, AUDIT_ACTIONS } from '../../src/modules/auth/audit.js';

const router = Router();

const adminUserId = (req) => `admin:${req.session?.admin?.username || 'admin'}`;
const adminName = (req) => req.session?.admin?.username || 'admin';

/* ══════════════ PASSKEYLAR ══════════════ */

router.get('/api/admin/profile/passkeys', requireAdmin, async (req, res) => {
  try {
    const passkeys = await listPasskeys(adminUserId(req));
    return res.json({ ok: true, passkeys, count: passkeys.length, max: 25 });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

router.post('/api/admin/profile/passkey/options', requireAdmin, requireRecentAdminAuth, async (req, res) => {
  try {
    const rp = undefined; // webauthn.js Host header'dan deriv qiladi (env ustun)
    const options = await generateRegistrationChallenge(req.session, {
      userId: adminUserId(req),
      userName: adminName(req),
    }, rp);
    if (!options) return res.status(400).json({ ok: false, error: 'options_failed' });
    return res.json({ ok: true, options });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

router.post('/api/admin/profile/passkey/verify', requireAdmin, requireRecentAdminAuth, async (req, res) => {
  try {
    const result = await verifyRegistrationResponseFlow(req.session, req.body || {});
    if (!result.ok) return res.status(400).json({ ok: false, error: result.error || 'verify_failed' });
    logAuthEvent({
      action: 'admin_passkey_added', outcome: 'success', method: 'webauthn',
      actorId: adminName(req), ipAddress: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});
    return res.json({ ok: true, credential: result.credential });
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.code || 'verify_failed' });
  }
});

router.post('/api/admin/profile/passkey/remove', requireAdmin, requireRecentAdminAuth, async (req, res) => {
  const { credentialId } = req.body || {};
  if (!credentialId || typeof credentialId !== 'string') return res.status(400).json({ ok: false, error: 'bad_request' });
  try {
    const r = await removePasskey(credentialId, adminUserId(req));
    if (!r.ok) return res.status(r.error === 'last_passkey' ? 409 : 404).json({ ok: false, error: r.error });
    logAuthEvent({
      action: 'admin_passkey_removed', outcome: 'success', method: 'webauthn',
      actorId: adminName(req), ipAddress: req.ip,
    }).catch(() => {});
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

/* ══════════════ SESIYALAR ══════════════ */
/* grantAdminSession (auth.js) har kirishda admin_sessions/{sid} yozadi;
   requireAdmin revoked flag'ni memo-cache bilan tekshiradi. */

router.get('/api/admin/profile/sessions', requireAdmin, async (req, res) => {
  try {
    const snap = await fb.get('admin_sessions');
    const all = snap.exists() ? snap.val() : {};
    const now = Date.now();
    const mine = Object.entries(all)
      .map(([sid, s]) => ({ sid, ...s }))
      .filter((s) => s.username === adminName(req))
      .sort((a, b) => (b.loginAt || 0) - (a.loginAt || 0));
    // 30 kundan eski yozuvlarni o'chirish (hygiene)
    for (const s of mine) {
      if (!s.revoked && s.loginAt && now - s.loginAt > 30 * 24 * 3600e3) {
        fb.remove(`admin_sessions/${s.sid}`).catch(() => {});
      }
    }
    return res.json({
      ok: true,
      current: req.sessionID,
      sessions: mine.slice(0, 25).map((s) => ({
        sid: s.sid,
        current: s.sid === req.sessionID,
        ip: s.ip || '—',
        userAgent: s.userAgent || '—',
        loginAt: s.loginAt || null,
        lastSeen: s.lastSeen || s.loginAt || null,
        revoked: !!s.revoked,
      })),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

router.post('/api/admin/profile/sessions/revoke', requireAdmin, async (req, res) => {
  const { sid, all } = req.body || {};
  try {
    if (all === true) {
      const snap = await fb.get('admin_sessions');
      const entries = Object.entries(snap.exists() ? snap.val() : {});
      let n = 0;
      for (const [id, s] of entries) {
        if (s.username === adminName(req) && id !== req.sessionID && !s.revoked) {
          await fb.set(`admin_sessions/${id}/revoked`, true);
          await fb.set(`admin_sessions/${id}/revokedAt`, Date.now());
          n++;
        }
      }
      logAuthEvent({ action: 'admin_sessions_revoked_all', outcome: 'success', actorId: adminName(req), details: { count: n } }).catch(() => {});
      return res.json({ ok: true, revoked: n });
    }
    if (!sid || typeof sid !== 'string' || sid === req.sessionID) {
      return res.status(400).json({ ok: false, error: 'bad_sid' });
    }
    const snap = await fb.get(`admin_sessions/${sid}`);
    if (!snap.exists() || snap.val().username !== adminName(req)) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }
    await fb.set(`admin_sessions/${sid}/revoked`, true);
    await fb.set(`admin_sessions/${sid}/revokedAt`, Date.now());
    logAuthEvent({ action: 'admin_session_revoked', outcome: 'success', actorId: adminName(req), details: { sid: sid.slice(0, 8) } }).catch(() => {});
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

/* ══════════════ API KALITLAR ══════════════ */
/* Real kalitlar: dba_<base64url 24B>; DB'da FAQAT sha256 hash + prefix.
   To'liq kalit FAQAT yaratish paytida bir marta ko'rsatiladi. */

const hashKey = (k) => crypto.createHash('sha256').update(k).digest('hex');

router.get('/api/admin/profile/api-keys', requireAdmin, async (req, res) => {
  try {
    const snap = await fb.get('admin_api_keys');
    const all = snap.exists() ? snap.val() : {};
    const keys = Object.entries(all)
      .map(([id, k]) => ({ id, name: k.name, prefix: k.prefix, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt || null, revoked: !!k.revoked }))
      .filter((k) => k.name) // admin uchun yaratilganlar
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return res.json({ ok: true, keys });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

router.post('/api/admin/profile/api-keys', requireAdmin, requireRecentAdminAuth, async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ ok: false, error: 'name_required' });
  try {
    const raw = 'dba_' + crypto.randomBytes(24).toString('base64url');
    const id = 'k_' + crypto.randomBytes(6).toString('hex');
    await fb.set(`admin_api_keys/${id}`, {
      name,
      prefix: raw.slice(0, 12),
      keyHash: hashKey(raw),
      owner: adminName(req),
      createdAt: Date.now(),
      revoked: false,
    });
    logAuthEvent({ action: 'admin_api_key_created', outcome: 'success', actorId: adminName(req), details: { id, name } }).catch(() => {});
    return res.json({ ok: true, id, name, key: raw, note: 'Kalit FAQAT hozir ko‘rsatiladi — uni saqlab qo‘ying.' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

router.post('/api/admin/profile/api-keys/revoke', requireAdmin, requireRecentAdminAuth, async (req, res) => {
  const { id } = req.body || {};
  if (!id || typeof id !== 'string') return res.status(400).json({ ok: false, error: 'bad_id' });
  try {
    const snap = await fb.get(`admin_api_keys/${id}`);
    if (!snap.exists()) return res.status(404).json({ ok: false, error: 'not_found' });
    await fb.set(`admin_api_keys/${id}/revoked`, true);
    await fb.set(`admin_api_keys/${id}/revokedAt`, Date.now());
    logAuthEvent({ action: 'admin_api_key_revoked', outcome: 'success', actorId: adminName(req), details: { id } }).catch(() => {});
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

/* ══════════════ MUHMOLAR (MFA holati) ══════════════ */

router.get('/api/admin/profile/mfa', requireAdmin, async (req, res) => {
  try {
    const s = await getMfaStatus(ADMIN_MFA_ACCOUNT_FALLBACK || adminName(req));
    return res.json({ ok: true, mfa: s, settingsUrl: '/admin/mfa' });
  } catch (e) {
    return res.json({ ok: true, mfa: { status: 'unknown' }, settingsUrl: '/admin/mfa' });
  }
});

/* ══════════════ LOGYLES (o'z audit + eksport) ══════════════ */

async function myAuditEntries(name, limit = 500) {
  const snap = await fb.get('audit_logs');
  const all = snap.exists() ? snap.val() : {};
  return Object.values(all)
    .filter((e) => e && (e.actorId === name || e.userId === name))
    .sort((a, b) => (b.at || b.timestamp || 0) - (a.at || a.timestamp || 0))
    .slice(0, limit)
    .map((e) => ({
      at: e.at || e.timestamp || 0,
      action: e.action || e.type || '-',
      outcome: e.outcome || '-',
      method: e.method || '',
      ip: e.ipAddress || e.ip || '',
    }));
}

router.get('/api/admin/profile/logs', requireAdmin, async (req, res) => {
  const format = String(req.query.format || 'json').toLowerCase();
  try {
    const rows = await myAuditEntries(adminName(req), Math.min(parseInt(req.query.limit) || 300, 1000));
    if (format === 'csv') {
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = ['vaqt,amal,holat,usul,ip', ...rows.map((r) => [new Date(r.at).toISOString(), r.action, r.outcome, r.method, r.ip].map(esc).join(','))].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="deborah-admin-loglar-${Date.now()}.csv"`);
      return res.send('\ufeff' + csv);
    }
    res.setHeader('Content-Disposition', `attachment; filename="deborah-admin-loglar-${Date.now()}.json"`);
    return res.json({ ok: true, exportedAt: Date.now(), count: rows.length, entries: rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

export default router;
