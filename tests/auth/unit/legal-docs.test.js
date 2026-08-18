/**
 * AUTH D-24 §18 — Legal docs (privacy/terms/cookies) unit testlari.
 * ---------------------------------------------------------------------------
 *  - 4 til × 3 hujjat mavjud (string check).
 *  - Bir xil bo'lim strukturasi (section id'lar mos).
 *  - Bo'sh matn yo'q; version + changelog + lastReviewed bor.
 *  - Secret yo'q (parol/token/secret so'zlari matnda emas); havolalar allowlist.
 *  - Cookie bo'limi: 3rd-party yo'q; session/remember/CSRF (non-HttpOnly).
 */

import { describe, it, expect } from 'vitest';
import {
  LEGAL_DOCS,
  LEGAL_LANGS,
  LEGAL_VERSION,
  LEGAL_LAST_REVIEWED,
  LEGAL_CONTACT,
  getLegalDoc,
  getLegalMeta,
  resolveLegalLang,
} from '../../../src/modules/legal/legal-docs.js';

const DOCS = ['privacy', 'terms', 'cookies'];

describe('AUTH D-24 §18 — legal docs struktura', () => {
  it('4 til × 3 hujjat mavjud, har biri to\'liq', () => {
    expect(LEGAL_LANGS).toEqual(['uz', 'uz-cyrl', 'ru', 'en']);
    for (const lang of LEGAL_LANGS) {
      for (const doc of DOCS) {
        const d = LEGAL_DOCS[lang]?.[doc];
        expect(d, `${lang}/${doc} mavjud`).toBeTruthy();
        expect(d.title, `${lang}/${doc} title`).toBeTruthy();
        expect(d.sections.length, `${lang}/${doc} sections`).toBeGreaterThanOrEqual(5);
      }
    }
  });

  it('4 tilda bir xil bo\'lim strukturasi (section id\'lar mos)', () => {
    const ref = {};
    for (const doc of DOCS) {
      ref[doc] = LEGAL_DOCS.uz[doc].sections.map((s) => s.id);
    }
    for (const lang of LEGAL_LANGS) {
      for (const doc of DOCS) {
        const ids = LEGAL_DOCS[lang][doc].sections.map((s) => s.id);
        expect(ids, `${lang}/${doc} section ids`).toEqual(ref[doc]);
      }
    }
  });

  it('bo\'sh matn / bo\'sh sarlavha yo\'q (barcha til va hujjatlarda)', () => {
    for (const lang of LEGAL_LANGS) {
      for (const doc of DOCS) {
        for (const s of LEGAL_DOCS[lang][doc].sections) {
          expect(s.heading.trim().length, `${lang}/${doc}/${s.id} heading`).toBeGreaterThan(0);
          expect(s.body.length, `${lang}/${doc}/${s.id} body`).toBeGreaterThan(0);
          for (const p of s.body) {
            expect(p.trim().length, `${lang}/${doc}/${s.id} paragraph`).toBeGreaterThan(10);
          }
        }
      }
    }
  });

  it('version + changelog + lastReviewed ko\'rsatilgan', () => {
    expect(LEGAL_VERSION).toBe('1.0.0');
    expect(LEGAL_LAST_REVIEWED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const lang of LEGAL_LANGS) {
      for (const doc of DOCS) {
        const d = LEGAL_DOCS[lang][doc];
        expect(d.version).toBe(LEGAL_VERSION);
        expect(d.lastReviewed).toBe(LEGAL_LAST_REVIEWED);
        expect(d.changelog.length).toBeGreaterThanOrEqual(1);
        expect(d.changelog[0].version).toBe(LEGAL_VERSION);
      }
    }
  });
});

describe('AUTH D-24 §15 — security/data guard', () => {
  it('hujjatda secret yo\'q (parol/token/secret jumlalari matnda emas)', () => {
    for (const lang of LEGAL_LANGS) {
      for (const doc of DOCS) {
        const text = LEGAL_DOCS[lang][doc].sections.map((s) => s.heading + ' ' + s.body.join(' ')).join(' ').toLowerCase();
        // «parol» so'zi parol SIYOSATI kontekstida ishlatiladi (terms/password bo'limi)
        // — lekin haqiqiy secret qiymat (hash/raw) ko'rinishida bo'lmasligi kerak.
        expect(text, `${lang}/${doc} secret token`).not.toMatch(/\b(secret|api[_-]?key|password:)\b/);
        expect(text).not.toContain('$argon2');
        expect(text).not.toContain('BEGIN PRIVATE KEY');
      }
    }
  });

  it('email havolalar allowlist (security@deborah.uz / support@deborah.uz)', () => {
    for (const lang of LEGAL_LANGS) {
      for (const doc of DOCS) {
        const text = LEGAL_DOCS[lang][doc].sections.map((s) => s.body.join(' ')).join(' ');
        for (const m of text.matchAll(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi)) {
          expect(['security@deborah.uz', 'support@deborah.uz'], `${lang}/${doc} email`).toContain(m[0].toLowerCase());
        }
      }
    }
  });

  it('legal contact har hujjatda ko\'rsatilgan', () => {
    expect(LEGAL_CONTACT.security).toBe('security@deborah.uz');
    expect(LEGAL_CONTACT.support).toBe('support@deborah.uz');
  });
});

describe('AUTH D-24 §09 — cookie bo\'limi kontrakti', () => {
  it('session / remember-me / CSRF (non-HttpOnly) / 3rd-party yo\'q', () => {
    const en = LEGAL_DOCS.en.cookies.sections.map((s) => ({ id: s.id, text: s.body.join(' ').toLowerCase() }));
    const get = (id) => en.find((s) => s.id === id)?.text || '';
    expect(get('session')).toContain('connect.sid');
    expect(get('session')).toContain('httponly');
    expect(get('remember')).toContain('selector');
    expect(get('csrf')).toContain('non-httponly');
    expect(get('thirdparty')).toContain('does not use third-party cookies');
  });
});

describe('AUTH D-24 — getLegalDoc / getLegalMeta / resolveLegalLang', () => {
  it('getLegalDoc: lang + doc → to\'liq hujjat (version, contact)', () => {
    const d = getLegalDoc('ru', 'privacy');
    expect(d).toBeTruthy();
    expect(d.lang).toBe('ru');
    expect(d.doc).toBe('privacy');
    expect(d.version).toBe(LEGAL_VERSION);
    expect(d.contact.security).toBe('security@deborah.uz');
    expect(d.sections.length).toBeGreaterThan(0);
  });

  it('noma\'lum lang → default uz; noma\'lum doc → null', () => {
    expect(getLegalDoc('fr', 'privacy').lang).toBe('uz');
    expect(getLegalDoc('uz', 'license')).toBeNull();
    expect(resolveLegalLang('kk')).toBe('uz');
    expect(resolveLegalLang('en')).toBe('en');
  });

  it('getLegalMeta: version + langs + contact', () => {
    const meta = getLegalMeta();
    expect(meta.version).toBe(LEGAL_VERSION);
    expect(meta.langs).toEqual(LEGAL_LANGS);
    expect(meta.contact.security).toBe('security@deborah.uz');
  });
});
