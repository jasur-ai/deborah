# Edikit Design System — Governance (STEP 41 / S41.11)

> **Maqsad:** Design official launch'dan keyin drift qilmaydi — owner, kontribyutsiya
> jarayoni, deprecation policy va davriy audit aniq.

---

## 1. Design System Owner

| Rol | Mas'ul | Scope |
|-----|--------|-------|
| **Design System Owner** | `@design-system-owner` | Tokens, foundations, components, contexts — yakuniy authority |
| **Frontend Lead** | `@frontend-lead` | CSS/JS implementatsiya, view'lar bilan integratsiya |
| **Accessibility Owner** | `@a11y-owner` | WCAG 2.2 AA, COGA, axe gate |
| **Content Owner** | `@content-owner` | Copy, i18n, privacy/accessibility docs |
| **Product Owner** | `@product-owner` | Feature va qabul qarorlari |

`CODEOWNERS` da mapping: `public/design/` → DS owner, `public/css/` → DS owner +
frontend lead, `views/` → frontend lead + content owner.

## 2. Kontribyutsiya jarayoni

Har bir design o'zgarishi:

1. **PR template** — `design:check` (tokens + contrast + lint + perf + legacy + EJS)
   + `design:check:full` (axe + visual) o'tishi shart (S37/38/40 gate'lar).
2. **Slice qoidasi** (S40.04): bir PR'da foundation + barcha pages rewrite qilinmaydi.
3. **Visual baseline** — yangi UI har doim snapshot bilan; diff faqat review orqali.
4. **Reviewer'lar** — DS owner + a11y owner (agar UI o'zgarsa).
5. **Merge** — quyidagilardan kamida bittasi review'da bo'lishi kerak:
   - tokens/theme o'zgarishi → DS owner
   - komponent o'zgarishi → DS owner + frontend lead
   - view o'zgarishi → frontend lead + content owner

## 3. Token hierarchy (qoida)

```
semantic token  =  faqat primitive'ga refer qiladi
component token =  faqat semantic'ga refer qiladi (yoki primitive, hujjatlashtirilgan)
legacy alias    =  faqat semantic'ga refer qiladi (vaqtinchalik, S40.03)
raw color       =  faqat primitive'da (design-lint S37.01)
```

`scripts/validate-design-tokens.js` — schema + hierarchy + determinism tekshiradi.

## 4. Deprecation policy (S40.03/11)

| Bosqich | Tavsif | Muddat |
|---------|--------|--------|
| 1. Deprecate | Alias/component deprecated deb belgilanadi | Release N |
| 2. Sunset | Usage inventory'da 0 ga tushishi kuzatiladi | Release N+1..N+2 |
| 3. Remove | Legacy kod olib tashlanadi, changelog'da qayd | Release N+2+ |

**Qoidalar:**
- Legacy alias'lar **release'lar orasida qaytadan qo'shilmaydi** — `legacy:usage` regression'ni bloklaydi (S40.03).
- Har release'da `design-audit/legacy-usage.json` trend **kamayishi** kerak.
- Deprecation har doim `CHANGELOG.md` da hujjatlashtiriladi.

## 5. Quarterly audit

Har kvartal (yanvar/aprel/iyul/oktyabr):

1. **Usage trend** — `node scripts/legacy-usage.js` → legacy kamayishi + yangi qo'shilmasligi
2. **Token drift** — `node scripts/validate-design-tokens.js` + `check-contrast` 
3. **A11y spot check** — `npm run test:a11y` (axe) + manual keyboard/screen-reader
4. **Visual sample** — critical pages'da visual gate
5. **Perf sample** — `npm run perf:budget`
6. **Brand compliance** — evidence mark/palette qoidalariga moslik (brand-assets docs)
7. **Exception review** — `performance-budget.exceptions.json` va boshqa exception'lar
   muddati o'tganlarini tekshirish

Audit natijasi → `docs/design-system/audits/YYYY-QN.md` (qisqa: o'tgan/buzilgan +
action items). 

## 6. Exception policy

- Exception (budget/contrast/lint) har doim: **owner + expires + justification + measured**.
- Muddati o'tgan exception — **avtomatik fail** (S38.12).
- Exception'lar revyu har kvartal audit'da.

## 7. Brand guardrails

- **Evidence Mark** — faqat rasmiy SVG (monochrome/inverse/high-contrast variantlari).
- **Signal Rail / Response Mosaic / Three-view grammar** — approved asset docs'ga mos
  (docs/brand-assets.md).
- Yangi mark variantlari — DS owner + brand approval talab.

## 8. Release changelog

Har release'da `CHANGELOG.md`:
- Yangi / O'zgargan / Deprecated / Removed (design bo'yicha)
- `legacy:usage` trend qiymati
- Visual/axe/perf gate natijasi

---

*Ushbu hujjat STEP 41 — Final launch, governance va masterpiece acceptance bo'yicha.*
