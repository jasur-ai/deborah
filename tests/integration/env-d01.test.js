/**
 * AUTH D-01 — Config/env schema (integration)
 *
 * Production'da invalid/incomplete config server start'ni bloklashi kerak
 * (fail-fast, Prompt 02 §07). Child process orqali tekshiramiz — env.js
 * import vaqtida buildConfig() ishlaydi va NODE_ENV=production'da
 * xato bo'lsa process.exit(1) qiladi.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';

const ENV_JS = join(dirname(fileURLToPath(import.meta.url)), '../../src/config/env.js');

function runProdEnv(extraEnv = {}) {
  // Windows: import() file:// URL talab qiladi (auth-load-test.js'dagi usul)
  const url = pathToFileURL(ENV_JS).href;
  const res = spawnSync(process.execPath, ['-e', `import('${url}')`], {
    env: {
      NODE_ENV: 'production',
      SESSION_SECRET: 'a-very-long-secret-key-that-is-safe-42-ok',
      ADMIN_USER: 'prodadmin',
      ADMIN_PASS: 'prodpass123!',
      TURNSTILE_SECRET_KEY: '0x00-valid-test-secret',
      COOKIE_SECURE: 'true',
      BASE_URL: 'https://deborah.uz',
      ...extraEnv,
    },
    encoding: 'utf8',
    timeout: 20000,
  });
  return { status: res.status, stderr: res.stderr || '' };
}

describe('AUTH D-01 — production fail-fast', () => {
  it('valid production config → start davom etadi (exit 0 emas, import OK)', () => {
    const { status } = runProdEnv();
    expect(status).toBe(0);
  });

  it('SESSION_SECRET < 32 → start fail (exit 1)', () => {
    const { status, stderr } = runProdEnv({ SESSION_SECRET: 'sixteen-char-secret' });
    expect(status).toBe(1);
    expect(stderr).toContain('SESSION_SECRET');
  });

  it('COOKIE_SECURE yo\'q → start fail', () => {
    const { status, stderr } = runProdEnv({ COOKIE_SECURE: undefined });
    expect(status).toBe(1);
    expect(stderr).toContain('COOKIE_SECURE');
  });

  it('BASE_URL yo\'q → start fail', () => {
    const { status, stderr } = runProdEnv({ BASE_URL: undefined });
    expect(status).toBe(1);
    expect(stderr).toContain('BASE_URL');
  });

  it('TURNSTILE_SECRET_KEY yo\'q → start fail (B-08)', () => {
    const { status, stderr } = runProdEnv({ TURNSTILE_SECRET_KEY: undefined });
    expect(status).toBe(1);
    expect(stderr).toContain('TURNSTILE_SECRET_KEY');
  });

  it('default admin credential (admin/admin) → start fail', () => {
    const { status, stderr } = runProdEnv({ ADMIN_USER: 'admin', ADMIN_PASS: 'admin' });
    expect(status).toBe(1);
    expect(stderr).toContain('DEFAULT ADMIN');
  });

  it('postmark providersiz token → start fail', () => {
    const { status, stderr } = runProdEnv({ EMAIL_PROVIDER: 'postmark' });
    expect(status).toBe(1);
    expect(stderr).toContain('POSTMARK_SERVER_TOKEN');
  });

  it('smtp providersiz host → start fail', () => {
    const { status, stderr } = runProdEnv({ EMAIL_PROVIDER: 'smtp' });
    expect(status).toBe(1);
    expect(stderr).toContain('SMTP_HOST');
  });

  it('secret logda emas (redaction: token qiymati stderrda korinmaydi)', () => {
    const { stderr } = runProdEnv({
      // Xato chiqarishi kerak — lekin secret qiymatning o'zi log'da bo'lmasligi
      SESSION_SECRET: 'a-very-long-secret-key-that-is-safe-42-ok',
    });
    // Hech qanday secret qiymat log'da ko'rinmaydi (faqat field nomi)
    expect(stderr).not.toContain('safe-42-ok');
    expect(stderr).not.toContain('prodpass123');
  });
});
