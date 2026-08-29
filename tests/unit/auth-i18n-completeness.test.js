/**
 * AUTH D-11 — AUTH_COPY 4 til to'liqligi va sifati (unit)
 * -----------------------------------------------------------------
 *  - Har til (uz, uz-cyrl, ru, en) bir xil kalit to'plamiga ega
 *    (chuqur dot-notation), hech qanday kalit yetishmaydi.
 *  - Interpolation placeholder'lari ({n}, {name}, {err}...) har tilda bir xil.
 *  - Hech qanday tarjima bo'sh string emas; uz-Cyrl uz-latn dan farqli
 *    (transliteratsiya emas — haqiqiy kirill yozuvi).
 *  - uz-Cyrl da ruscha qoldiq belgilar yo'q ("Ы"/"ы" — o'zbek kirill
 *    alifbosida mavjud emas) va ruscha so'z qoldiqlari tekshirilmaydi
 *    (lug'at nisbati orqali).
 */
import { describe, it, expect } from 'vitest';
import { AUTH_COPY } from '../../data/auth-i18n.js';

const LANGS = ['uz', 'uz-cyrl', 'ru', 'en'];

function flattenKeys(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flattenKeys(v, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

function flattenStrings(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flattenStrings(v, path));
    } else {
      out[path] = String(v);
    }
  }
  return out;
}

describe('AUTH D-11 — AUTH_COPY 4 til to\'liqligi', () => {
  it('4 til mavjud', () => {
    for (const l of LANGS) expect(AUTH_COPY[l], `${l} mavjud`).toBeTruthy();
  });

  it('har til bir xil kalit to\'plamiga ega (uz asos)', () => {
    const base = flattenKeys(AUTH_COPY.uz).sort();
    expect(base.length).toBeGreaterThan(100);
    for (const l of LANGS) {
      const keys = flattenKeys(AUTH_COPY[l]).sort();
      expect(keys, `${l} kalitlari uz bilan bir xil`).toEqual(base);
    }
  });

  it('hech qanday tarjima bo\'sh string emas', () => {
    for (const l of LANGS) {
      const strings = flattenStrings(AUTH_COPY[l]);
      for (const [path, s] of Object.entries(strings)) {
        expect(s.trim().length, `${l}.${path} bo'sh emas`).toBeGreaterThan(0);
      }
    }
  });

  it('interpolation placeholder\'lari har tilda bir xil', () => {
    const base = flattenStrings(AUTH_COPY.uz);
    for (const l of LANGS) {
      const strings = flattenStrings(AUTH_COPY[l]);
      for (const [path, s] of Object.entries(strings)) {
        const basePh = base[path].match(/\{\w+\}/g) || [];
        const lPh = s.match(/\{\w+\}/g) || [];
        expect(lPh.sort(), `${l}.${path} placeholder'lari mos`).toEqual(basePh.sort());
      }
    }
  });
});

describe('AUTH D-11 — uz-Cyrl tarjima sifati', () => {
  it('uz-Cyrl uz-Latn dan farqli (transliteratsiya emas — haqiqiy kirill)', () => {
    const uz = flattenStrings(AUTH_COPY.uz);
    const cyrl = flattenStrings(AUTH_COPY['uz-cyrl']);
    let different = 0;
    for (const [path, s] of Object.entries(uz)) {
      if (cyrl[path] !== s) different++;
    }
    // Ko'p qismi farqli bo'lishi kerak (kirill alifbosi), lekin ba'zi
    // so'zlar bir xil bo'lishi mumkin (Admin, MFA, email) — chegara 60%.
    expect(different / Object.keys(uz).length).toBeGreaterThan(0.6);
  });

  it('uz-Cyrl da "Ы"/"ы" belgisi yo\'q (o\'zbek kirill alifbosida yo\'q — ruscha qoldiq)', () => {
    const cyrl = flattenStrings(AUTH_COPY['uz-cyrl']);
    for (const [path, s] of Object.entries(cyrl)) {
      expect(s, `${path} da Ы yo'q`).not.toMatch(/[Ыы]/);
    }
  });

  it('ru va en native (uz-Cyrl dan farqli)', () => {
    const cyrl = flattenStrings(AUTH_COPY['uz-cyrl']);
    const ru = flattenStrings(AUTH_COPY.ru);
    const en = flattenStrings(AUTH_COPY.en);
    let ruDiff = 0;
    let enDiff = 0;
    for (const path of Object.keys(cyrl)) {
      if (ru[path] !== cyrl[path]) ruDiff++;
      if (en[path] !== cyrl[path]) enDiff++;
    }
    expect(ruDiff / Object.keys(cyrl).length).toBeGreaterThan(0.9);
    expect(enDiff / Object.keys(cyrl).length).toBeGreaterThan(0.9);
  });
});
