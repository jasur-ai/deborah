import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';

vi.mock('../../src/modules/email/provider.js', () => ({
  sendEmail: vi.fn(),
}));

import { sendEmail } from '../../src/modules/email/provider.js';
import { sendVerifyCode } from '../../src/modules/auth/email-verify.js';

const ENV_KEYS = [
  'NODE_ENV', 'EMAIL_PROVIDER', 'EMAIL_PROVIDER_PRIMARY', 'EMAIL_PROVIDER_SECONDARY',
  'POSTMARK_SERVER_TOKEN', 'EMAIL_API_KEY', 'SMTP_HOST',
];
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

beforeAll(() => snapshotDb());
afterAll(() => {
  restoreDb();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('email verification delivery failures', () => {
  it('fails clearly in production when no real provider is configured, without creating an OTP', async () => {
    process.env.NODE_ENV = 'production';
    process.env.EMAIL_PROVIDER = 'mock';
    delete process.env.EMAIL_PROVIDER_PRIMARY;
    delete process.env.EMAIL_PROVIDER_SECONDARY;
    delete process.env.POSTMARK_SERVER_TOKEN;
    delete process.env.EMAIL_API_KEY;
    delete process.env.SMTP_HOST;

    const userKey = `verify_unconfigured_${Date.now()}`;
    const result = await sendVerifyCode({ userKey, email: 'learner@example.test' });

    expect(result).toMatchObject({ ok: false, error: 'email_provider_not_configured', httpStatus: 503 });
    expect(sendEmail).not.toHaveBeenCalled();
    expect((await fb.get(`email_verify_last/${safeKey(userKey)}`)).exists()).toBe(false);
  });

  it('invalidates an undelivered OTP and clears the resend cooldown for retry', async () => {
    process.env.NODE_ENV = 'test';
    sendEmail.mockResolvedValue({ ok: false, error: 'transport-down' });
    const userKey = `verify_delivery_failed_${Date.now()}`;

    const result = await sendVerifyCode({ userKey, email: 'learner@example.test' });

    expect(result).toMatchObject({ ok: false, error: 'send_failed', httpStatus: 502 });
    const latest = await fb.get(`email_verify_last/${safeKey(userKey)}`);
    expect(latest.val()).toEqual({ at: 0, lookupKey: '' });
    const records = (await fb.get('email_verify')).val() || {};
    const failedRecord = Object.values(records).find((record) => record?.userKey === userKey);
    expect(failedRecord).toMatchObject({ used: true, delivery_failed: true });
  });
});
