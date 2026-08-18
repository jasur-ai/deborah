# Design Token Owners & Change Policy (S04.11)

## Ownership model

| Qatlam | Fayl | Owner | Approval |
|--------|------|-------|----------|
| Primitive | `primitive.color.json` | **Design** (visual designer / brand lead) | Brand assetlarni o'zgartirish — design review talab |
| Semantic | `semantic.{theme}.json` | **Design System** (frontend infra + a11y) | Theme parity + contrast gate (S04.05) |
| Typography / Layout | `typography.json`, `layout.json` | **Design System** | Scale o'zgarishi — design review |
| Component | (keyingi STEP'lar) | **Component owner** | Component-scoped override — owner PR |

## Change policy

1. **Primitive o'zgarishi** — `semantic.*` fayllarida `$description` yangilanadi;
   hech qachon semantic qiymat primitive'ga yozilmaydi.
2. **Semantic o'zgarishi** — `npm run design:tokens:check` (theme parity) +
   `design-audit/contrast-fixture.json` (WCAG 4.5:1) tekshiriladi.
3. **Yangi token** — faqat kerakli qatlamga: primitive (appearance),
   semantic (intent). Primitive'ni component CSS'ida to'g'ridan-to'g'ri
   ishlatish **taqiqlanadi** (S04.03) — doim semantic alias orqali.
4. **O'chirish** — oldin `design-audit/baseline-scan.md` dan foydalanishni
   tekshiring; backward alias kerak bo'lsa S04.08 deprecation comment bilan.
5. **CI gate** — `design:tokens:check` + `design:tokens:build` diff toza
   bo'lishi shart (generated CSS commit qilinadi).

## Intent-based naming (S04.04)

```
color.action.primary        → CTA / asosiy action
color.action.signal         → live/current indicator (Signal Cyan)
color.action.insight        → attention/insight (Insight Amber)
color.surface.default       → page bg
color.surface.raised        → card
color.text.muted            → secondary text
motion.modal.enter          → modal enter animatsiya
```

## Alias qoidasi (S04.03)

Component CSS'da faqat `--edikit-semantic-*` variable'lari ishlatiladi.
`--edikit-primitive-*` faqat semantic fayllar ichida alias manbai sifatida
ruxsat etiladi.
