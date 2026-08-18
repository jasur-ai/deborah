import { describe, it, expect } from 'vitest';
import { LANDING_LANGS, LANDING_COPY } from '../../data/landing.js';

describe('STEP 21 — Landing copy integrity (data/landing.js)', () => {
  it('S21.01/07 — fake proof claim lari copy da yo\'q', () => {
    const banned = [
      '24/7',
      'Official platform',
      'Rasmiy platforma',
      'Официальная платформа',
      'Расмий платформа',
      '10,000+',
      '10 000+',
      '100,000+',
      '100 000+',
      'Universities trust us',
      'Universitetlar ishonadi',
      'Университеты доверяют',
      'Университетлар ишонади',
    ];
    for (const lang of LANDING_LANGS) {
      const raw = JSON.stringify(LANDING_COPY[lang]);
      for (const b of banned) {
        expect(raw, `${lang} da "${b}" topildi`).not.toContain(b);
      }
    }
  });

  it('S21.02 — hero promise-led, eyebrow va participantCta bor', () => {
    for (const lang of LANDING_LANGS) {
      const h = LANDING_COPY[lang].hero;
      expect(h.badge).toBeTruthy();
      expect(h.badge.toLowerCase()).not.toContain('official');
      expect(h.badge.toLowerCase()).not.toContain('rasmiy');
      expect(h.h1.length).toBeGreaterThan(10);
      expect(h.ctaPrimary).toBeTruthy();
      expect(h.ctaSecondary).toBeTruthy();
      expect(h.participantCta).toBeTruthy();
      expect(h.proofLine).toBeUndefined();
    }
  });

  it('S21.03 — sub teacher task+outcome, vague so\'zlar yo\'q', () => {
    const vague = ['zamonaviy', 'modern', 'premium', 'revolutionary', 'innovative', 'kuchli'];
    for (const lang of LANDING_LANGS) {
      const sub = LANDING_COPY[lang].hero.sub.toLowerCase();
      for (const v of vague) {
        expect(sub, `${lang} da vague "${v}"`).not.toContain(v);
      }
      expect(sub.length).toBeGreaterThan(40);
    }
  });

  it('S21.05 — how Ask/See/Adapt: teacherSteps 3 ta, first = ask', () => {
    const firstKeywords = { uz: 'savol', ru: 'задайте', en: 'ask', 'uz-cyrl': 'савол' };
    for (const lang of LANDING_LANGS) {
      const steps = LANDING_COPY[lang].how.teacherSteps;
      expect(steps).toHaveLength(3);
      expect(steps[0].title.toLowerCase()).toContain(firstKeywords[lang]);
      expect(steps[2].title.toLowerCase()).toMatch(/mosl|мосл|adapt|адапт/i);
    }
  });

  it('S21.08 — trust 4 item, icon+link, internal doc linklar', () => {
    for (const lang of LANDING_LANGS) {
      const t = LANDING_COPY[lang].trust;
      expect(t.title).toBeTruthy();
      expect(t.readMore).toBeTruthy();
      expect(t.items).toHaveLength(4);
      for (const item of t.items) {
        expect(['privacy', 'camera', 'a11y', 'rank']).toContain(item.icon);
        expect(item.link).toMatch(/^\/(privacy|security|accessibility)$/);
      }
    }
  });

  it('S21.06 — admin footer utility string bor', () => {
    for (const lang of LANDING_LANGS) {
      expect(LANDING_COPY[lang].footer.admin).toBeTruthy();
      expect(LANDING_COPY[lang].footer.colUtility).toBeTruthy();
    }
  });

  it('S21.09 — footer kolonnalar stringlari to\'liq', () => {
    for (const lang of LANDING_LANGS) {
      const f = LANDING_COPY[lang].footer;
      for (const key of ['colProduct', 'productFeatures', 'productDemo', 'productHow', 'productRoles', 'colCast', 'castJoin', 'colLegal', 'terms', 'privacy', 'security', 'accessibility', 'langs', 'telegram']) {
        expect(f[key], `${lang}.footer.${key}`).toBeTruthy();
      }
    }
  });

  it('S21.07 — cta.proof yo\'q, stats section yo\'q', () => {
    for (const lang of LANDING_LANGS) {
      const c = LANDING_COPY[lang];
      expect(c.cta.proof).toBeUndefined();
      expect(c.stats).toBeUndefined();
    }
  });

  it('S22.05 — stage sub-object barcha tilda to\'liq (demo label)', () => {
    for (const lang of LANDING_LANGS) {
      const s = LANDING_COPY[lang].stage;
      for (const key of ['label', 'participants', 'question', 'coverage', 'discuss', 'correct']) {
        expect(s[key], `${lang}.stage.${key}`).toBeTruthy();
      }
      expect(s.participants).toMatch(/30/);
      expect(s.phoneValues).toHaveLength(4);
      expect(s.phoneValues[0]).toBeTruthy();
    }
  });

  it('S22.07 — stage visual static (animatsiya yo\'q) copy da', () => {
    for (const lang of LANDING_LANGS) {
      const raw = JSON.stringify(LANDING_COPY[lang]);
      expect(raw).not.toContain('points');
      expect(raw).not.toContain('confetti');
    }
  });

  it('S21.10 — apostrophe consistency: faqat to\'g\'ri apostrof ishlatiladi', () => {
    for (const lang of ['uz', 'en']) {
      const raw = JSON.stringify(LANDING_COPY[lang]);
      // Tipik xato: 'yaqin apostrof yoki uchta apostrof ketma-ketligi
      expect(raw).not.toMatch(/''/);
      expect(raw).not.toMatch(/’/); // typographic apostrophe copy da ishlatilmaydi
    }
  });
});
