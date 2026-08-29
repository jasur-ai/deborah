/**
 * AUTH D-32 — Email detail: provider abstraction, failover, cost
 *
 * Failover trigger (§25: 5x xato / 1 daqiqa → secondary + auto-recovery),
 * cost tracking (§08/§26), webhook IP allowlist (§27), headers (§11).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const { sendEmail, getProviderOrder, activeProvider, recordProviderResult, resetFailoverState, failoverStatus, emailCostPerUnit, recordEmailCost } = await import('../../../src/modules/email/provider.js');
const { isWebhookIpAllowed, processEmailWebhook } = await import('../../../src/modules/email/webhook.js');

describe('AUTH D-32 — email detail (provider failover + cost)', () => {
  afterEach(() => {
    resetFailoverState();
  });

  /* ── Failover (§07/§25) ── */
  it('1) getProviderOrder — primary → secondary, default mock→smtp', () => {
    const order = getProviderOrder({ EMAIL_PROVIDER_PRIMARY: 'postmark', EMAIL_PROVIDER_SECONDARY: 'smtp' });
    expect(order).toEqual(['postmark', 'smtp']);
    expect(getProviderOrder({})).toEqual(['mock', 'smtp']);
  });

  it('2) activeProvider — normal holatda primary', () => {
    resetFailoverState();
    expect(activeProvider({ EMAIL_PROVIDER_PRIMARY: 'postmark', EMAIL_PROVIDER_SECONDARY: 'smtp' })).toBe('postmark');
  });

  it('3) recordProviderResult — 5x xato (1 daqiqa ichida) → secondary ga switch', () => {
    resetFailoverState();
    let last = null;
    for (let i = 0; i < 4; i++) last = recordProviderResult(false, { EMAIL_PROVIDER_SECONDARY: 'smtp' });
    expect(last.switched).toBe(false);
    last = recordProviderResult(false, { EMAIL_PROVIDER_SECONDARY: 'smtp' });
    expect(last.switched).toBe(true);
    expect(failoverStatus().active).toBe('secondary');
  });

  it('4) auto-recovery — secondary muvaffaqiyat → primary qaytadi', () => {
    resetFailoverState();
    for (let i = 0; i < 5; i++) recordProviderResult(false, { EMAIL_PROVIDER_SECONDARY: 'smtp' });
    const r = recordProviderResult(true, { EMAIL_PROVIDER_SECONDARY: 'smtp' });
    expect(r.recovered).toBe(true);
    expect(failoverStatus().active).toBeNull();
  });

  it('5) sendEmail — primary fail → secondary failover ishlaydi (sendImpl)', async () => {
    resetFailoverState();
    const sendImpl = vi.fn(async () => { throw new Error('primary-down'); });
    const r = await sendEmail(
      { to: 'a@b.com', subject: 'test', html: '<p>x</p>' },
      { provider: 'mock', sendImpl, checkSuppressed: async () => false },
    );
    // sendImpl bir xil bo'lgani uchun secondary ham fail → send-failed (xabar yo'qolmaydi, queue saqlaydi)
    expect(r.ok).toBe(false);
    expect(r.error).toBe('send-failed');
  });

  it('6) sendEmail — secondary muvaffaqiyatli bolsa failedOver=true', async () => {
    resetFailoverState();
    // failover state'ni secondary ga o'tkazamiz (5x fail bilan)
    for (let i = 0; i < 5; i++) recordProviderResult(false, { EMAIL_PROVIDER_SECONDARY: 'smtp' });
    // primary retry (3x) fail → secondary urinish (4-chi call) success
    let calls = 0;
    const sendImpl = vi.fn(async () => {
      calls += 1;
      if (calls <= 3) throw new Error('primary-down');
      return { messageId: `secondary-ok-${calls}` };
    });
    const r = await sendEmail(
      { to: 'a@b.com', subject: 'test', html: '<p>x</p>' },
      { provider: 'mock', sendImpl, checkSuppressed: async () => false },
    );
    expect(r.ok).toBe(true);
    expect(r.failedOver).toBe(true);
    expect(r.provider).toBe('smtp');
  });

  /* ── Cost tracking (§08/§26) ── */
  it('7) emailCostPerUnit — per-provider narx', () => {
    expect(emailCostPerUnit('postmark')).toBeGreaterThan(0);
    expect(emailCostPerUnit('mock')).toBe(0);
  });

  it('8) recordEmailCost — fail-soft (fb yoq muhitda ham ishlaydi)', async () => {
    const res = await recordEmailCost({ provider: 'postmark', count: 2 });
    expect(res.provider).toBe('postmark');
    expect(res.count).toBe(2);
    expect(typeof res.cost).toBe('number');
  });

  /* ── Webhook IP allowlist (§27) ── */
  it('9) isWebhookIpAllowed — allowlist mos kelishi/kelmasligi', () => {
    const env = { EMAIL_WEBHOOK_IP_ALLOWLIST: '1.2.3.4,5.6.7.8' };
    expect(isWebhookIpAllowed('1.2.3.4', env)).toBe(true);
    expect(isWebhookIpAllowed('9.9.9.9', env)).toBe(false);
    expect(isWebhookIpAllowed('1.2.3.4', {})).toBe(true); // allowlist yo'q — token yetarli
    expect(isWebhookIpAllowed(null, env)).toBe(false);
  });

  it('10) processEmailWebhook — IP ruxsatsiz bolsa reject', async () => {
    const env = { EMAIL_WEBHOOK_IP_ALLOWLIST: '1.2.3.4' };
    const r = await processEmailWebhook(
      { MessageID: 'm1', Type: 'HardBounce', Email: 'a@b.com' },
      { ip: '9.9.9.9', env },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe('ip-not-allowed');
  });
});
