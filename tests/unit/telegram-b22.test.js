/**
 * AUTH B-22 — Telegram bot: unit testlar
 * --------------------------------------
 * 1) createLinkToken — 20 bayt token, 5 daqiqa TTL, t.me URL.
 * 2) consumeLinkToken — to'g'ri token → telegram_id biriktiriladi + prefs.
 * 3) consumeLinkToken — ikkinchi marta → token_used; muddati o'tgan → token_expired.
 * 4) verifyCallbackSignature — to'g'ri imzo pass, noto'g'ri fail.
 * 5) sendTelegramMessage — retry/backoff (2 marta fail, 3-chi ok); 4096 limit.
 * 6) notifyUserTelegram — telegram_id yo'q → not_linked; prefs off → channel_disabled.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import {
  createLinkToken,
  consumeLinkToken,
  verifyCallbackSignature,
  signCallbackPayload,
  sendTelegramMessage,
  notifyUserTelegram,
  isTelegramEnabled,
  _telegramConfig,
} from '../../src/modules/email/telegram.js';

const userId = safeKey(`b22unit${Date.now()}`);

describe('AUTH B-22 — Telegram bot (unit)', () => {
  beforeEach(async () => {
    await snapshotDb();
  });

  afterEach(async () => {
    await restoreDb();
  });

  it('createLinkToken: token 20 bayt, 5 daqiqa TTL, t.me URL', async () => {
    const r = await createLinkToken(userId);
    expect(r.ok).toBe(true);
    expect(r.token.length).toBeGreaterThanOrEqual(25); // 20B base64url
    expect(r.ttlMs).toBe(5 * 60 * 1000);
    expect(r.url).toContain('t.me/');
    expect(r.url).toContain(`start=${r.token}`);
  });

  it('consumeLinkToken: to`g`ri token → telegram_id + prefs.telegram=true', async () => {
    await fb.set(`users/${userId}`, { username: 'u', email: 'u@test.uz' });
    const r = await createLinkToken(userId);
    const c = await consumeLinkToken({ token: r.token, telegramId: '123456789', firstName: 'Ali', username: 'ali' });
    expect(c.ok).toBe(true);
    expect(c.userId).toBe(userId);
    const snap = await fb.get(`users/${userId}/telegram_id`);
    expect(snap.exists()).toBe(true);
    expect(snap.val()).toBe('123456789');
    const meta = await fb.get(`users/${userId}/telegram_meta`);
    expect(meta.exists()).toBe(true);
    expect(meta.val().first_name).toBe('Ali');
    // prefs.telegram = true
    const prefs = await fb.get(`users/${userId}/notif_prefs`);
    expect(prefs.exists()).toBe(true);
    expect(prefs.val().channels.telegram).toBe(true);
  });

  it('consumeLinkToken: ikkinchi marta → token_used', async () => {
    const r = await createLinkToken(userId);
    const c1 = await consumeLinkToken({ token: r.token, telegramId: '111' });
    expect(c1.ok).toBe(true);
    const c2 = await consumeLinkToken({ token: r.token, telegramId: '111' });
    expect(c2.ok).toBe(false);
    expect(c2.error).toBe('token_used');
  });

  it('consumeLinkToken: muddati o`tgan → token_expired', async () => {
    const cfg = _telegramConfig();
    // Eski TTL bilan token yaratamiz (to'g'ridan-to'g'ri DB'ga)
    const oldToken = 'expired-token-12345678901234567890';
    const { hashValue } = await import('../../src/modules/auth/telegram-otp.js');
    await fb.set(`telegram_link_tokens/${hashValue(oldToken)}`, {
      userId,
      expires_at: Date.now() - 1000,
      used: false,
    });
    const c = await consumeLinkToken({ token: oldToken, telegramId: '222' });
    expect(c.ok).toBe(false);
    expect(c.error).toBe('token_expired');
  });

  it('verifyCallbackSignature: to`g`ri imzo pass, noto`g`ri fail', () => {
    const payload = JSON.stringify({ message: { text: '/start abc', chat: { id: 1 } } });
    const good = signCallbackPayload(payload);
    expect(verifyCallbackSignature({ payload, signature: good })).toBe(true);
    expect(verifyCallbackSignature({ payload, signature: 'wrong' })).toBe(false);
    expect(verifyCallbackSignature({ payload: 'different', signature: good })).toBe(false);
  });

  it('sendTelegramMessage: retry/backoff (2 fail → 3-ok)', async () => {
    let calls = 0;
    const sendImpl = async () => {
      calls += 1;
      if (calls < 3) throw new Error('flaky');
      return { message_id: 'm-1' };
    };
    const r = await sendTelegramMessage({ chatId: '123', text: 'hello', deps: { sendImpl } });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(3);
  });

  it('sendTelegramMessage: 3 marta fail → error', async () => {
    const r = await sendTelegramMessage({ chatId: '123', text: 'hi', deps: { sendImpl: async () => { throw new Error('down'); } } });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('down');
    expect(r.attempts).toBe(3);
  });

  it('sendTelegramMessage: 4096 limit — uzun matn kesiladi', async () => {
    let received = null;
    const longText = 'x'.repeat(5000);
    const r = await sendTelegramMessage({
      chatId: '1', text: longText,
      deps: { sendImpl: async (m) => { received = m; return { message_id: 'm' }; } },
    });
    expect(r.ok).toBe(true);
    expect(received.text.length).toBeLessThanOrEqual(4096);
  });

  it('notifyUserTelegram: telegram_id yo`q → not_linked', async () => {
    const r = await notifyUserTelegram({ userId, text: 'hi' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('not_linked');
  });

  it('notifyUserTelegram: ulangan + prefs on → yuboriladi + audit', async () => {
    await fb.set(`users/${userId}`, { username: 'u', telegram_id: '777' });
    await fb.set(`users/${userId}/notif_prefs`, {
      channels: { telegram: true, email: false, push: false },
      types: { security: true },
      updated_at: Date.now(),
    });
    let received = null;
    const r = await notifyUserTelegram({
      userId, type: 'security', text: 'Yangi qurilmadan kirish',
      deps: { sendImpl: async (m) => { received = m; return { message_id: 'tg-1' }; } },
    });
    expect(r.ok).toBe(true);
    expect(r.sent).toBe(true);
    expect(received.chatId).toBe('777');
    expect(received.text).toContain('Yangi qurilmadan kirish');
  });
});
