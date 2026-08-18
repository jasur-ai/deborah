/**
 * AUTH A-02 — Session idle timeout helper unit testlar
 * Pure funksiyalar: isSessionExpired / shouldTouch / loginReturnUrl / safeReturnUrl.
 */
import { describe, it, expect } from 'vitest';
import {
  isSessionExpired,
  shouldTouch,
  loginReturnUrl,
  safeReturnUrl,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_TOUCH_INTERVAL_MS,
} from '../../src/modules/auth/session-timeout.js';

describe('AUTH A-02 — session-timeout helpers', () => {
  const now = 1_800_000_000_000;

  it('isSessionExpired: 30 daqiqadan oshgan harakatsizlik → true', () => {
    expect(isSessionExpired(now - 31 * 60 * 1000, now, DEFAULT_IDLE_TIMEOUT_MS)).toBe(true);
  });

  it('isSessionExpired: faol sessiya (30 daqiqa ichida) → false', () => {
    expect(isSessionExpired(now - 10 * 60 * 1000, now, DEFAULT_IDLE_TIMEOUT_MS)).toBe(false);
    expect(isSessionExpired(now - DEFAULT_IDLE_TIMEOUT_MS, now, DEFAULT_IDLE_TIMEOUT_MS)).toBe(false); // chegara — teng emas
  });

  it('isSessionExpired: lastActiveAt yo\'q (yangi sessiya) → fail-open false', () => {
    expect(isSessionExpired(undefined, now)).toBe(false);
    expect(isSessionExpired(null, now)).toBe(false);
  });

  it('shouldTouch: throttling — 5 daqiqa ichida yozilmaydi', () => {
    expect(shouldTouch(now - 60 * 1000, now, DEFAULT_TOUCH_INTERVAL_MS)).toBe(false);
    expect(shouldTouch(now - 5 * 60 * 1000, now, DEFAULT_TOUCH_INTERVAL_MS)).toBe(true); // chegara
    expect(shouldTouch(now - 10 * 60 * 1000, now, DEFAULT_TOUCH_INTERVAL_MS)).toBe(true);
    expect(shouldTouch(undefined, now)).toBe(true); // birinchi marta
  });

  it('loginReturnUrl: ichki relative path encode qilinadi', () => {
    expect(loginReturnUrl('/user/panel')).toBe(encodeURIComponent('/user/panel'));
    // AUTH A-05: allowlist prefiksi bo'lishi shart — query string saqlanadi
    expect(loginReturnUrl('/assignments?testId=12&x=1')).toContain('%3F');
    expect(loginReturnUrl('//evil.example')).toBe(encodeURIComponent('/user/panel')); // protocol-relative blok
    expect(loginReturnUrl('https://evil.example')).toBe(encodeURIComponent('/user/panel'));
    expect(loginReturnUrl(undefined)).toBe(encodeURIComponent('/user/panel'));
    expect(loginReturnUrl('/test-arena?x=1')).toBe(encodeURIComponent('/user/panel')); // allowlist'da yo'q
  });

  it('safeReturnUrl: open-redirect himoyasi', () => {
    expect(safeReturnUrl('/user/panel')).toBe('/user/panel');
    expect(safeReturnUrl('/teacher')).toBe('/teacher');
    expect(safeReturnUrl('//evil.example')).toBe('/user/panel');
    expect(safeReturnUrl('https://evil.example')).toBe('/user/panel');
    expect(safeReturnUrl('javascript:alert(1)')).toBe('/user/panel');
    expect(safeReturnUrl(undefined)).toBe('/user/panel');
    expect(safeReturnUrl('')).toBe('/user/panel');
  });

  it('safeReturnUrl (AUTH A-05): allowlist — ruxsat etilgan prefikslar', () => {
    // Guide A-05 §13: /, /panel, /assignments, /teacher/*, /admin/*
    expect(safeReturnUrl('/')).toBe('/');
    expect(safeReturnUrl('/panel')).toBe('/panel');
    expect(safeReturnUrl('/assignments')).toBe('/assignments');
    expect(safeReturnUrl('/teacher/overview')).toBe('/teacher/overview');
    expect(safeReturnUrl('/admin/dashboard')).toBe('/admin/dashboard');
    expect(safeReturnUrl('/user/security-profile')).toBe('/user/security-profile');
    expect(safeReturnUrl('/game/lobby')).toBe('/game/lobby');
    expect(safeReturnUrl('/cast/join?code=12345')).toBe('/cast/join?code=12345');
  });

  it('safeReturnUrl (AUTH A-05): allowlist — boshqa path\'lar default\'ga', () => {
    // Allowlist'da yo'q segmentlar rad etiladi (XSS/open-redirect qisqaradi)
    expect(safeReturnUrl('/noma-lum-yo-l')).toBe('/user/panel');
    expect(safeReturnUrl('/static/logo.svg')).toBe('/user/panel');
    expect(safeReturnUrl('/uploads/1.png')).toBe('/user/panel');
    expect(safeReturnUrl('/favicon.ico')).toBe('/user/panel');
    // /api — idle timeout'dan keyin API so'rovlar qaytishi uchun ruxsat
    expect(safeReturnUrl('/api/user/stats')).toBe('/api/user/stats');
  });

  it('safeReturnUrl (AUTH A-05): path-traversal normalizatsiya', () => {
    // .. segmentlar olib tashlanadi: '/user/../../evil' → 'evil' → allowlist'da yo'q
    expect(safeReturnUrl('/user/../../evil')).toBe('/user/panel');
    expect(safeReturnUrl('/teacher/../../static/x')).toBe('/user/panel');
    // /user/../admin → normalize '/admin' — admin allowlist'da (xavfsiz,
    // admin middleware himoya qiladi) — shuning uchun qabul qilinadi
    expect(safeReturnUrl('/user/../admin')).toBe('/user/../admin');
    // Normal path hali ham ishlaydi
    expect(safeReturnUrl('/assignments/../user/panel')).toBe('/assignments/../user/panel');
  });
});
