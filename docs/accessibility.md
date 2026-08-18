# Accessibility Statement — Edikit (STYLE S36.12)

**Yangilangan:** 2026-08-08

## Maqsad

Edikit WCAG 2.2 AA darajasida foydalanish mumkin bo'lishiga intiladi.
Bu hujjat — tested scope, known limitations, kontakt va yangilanish sanasini
**honest** ko'rsatadi (S36.12).

## Tested scope

| Flow | Axe (serious/critical) | Keyboard | Screen reader |
|------|------------------------|----------|---------------|
| Landing `/` | ✅ 0 | ✅ | 🟡 qisman |
| Auth (login/register/forgot/reset) | ✅ 0 | ✅ | 🟡 qisman |
| User panel / test kutubxonasi | ✅ 0 | ✅ | 🟡 qisman |
| Test builder | ✅ 0 | ✅ | 🟡 qisman |
| Admin dashboard / VIP | ✅ 0 | ✅ | — |
| Cast Setup Studio | ✅ 0 | ✅ | 🟡 qisman |
| Cast Director | ✅ 0 | ✅ | ✅ |
| Cast Projector | ✅ 0 | ✅ | 🟡 qisman |
| Cast Participant | ✅ 0 | ✅ | ✅ |
| Error / offline sahifalari | ✅ 0 | ✅ | — |

- **Axe**: `tests/a11y/audit.spec.js` — serious/critical = CI failure (S36.02).
- **Statik audit**: `node scripts/a11y-audit.js` — touch target (44px, dense exception
  `.btn-sm` 32px documented), reduced-motion, forced-colors, focus-visible, rem reflow.
- **Keyboard flows**: join→answer→saved→reveal; create→Cast→pause→close (S36.03).

## WCAG 2.2 AA qamrov

- **1.4.3/1.4.11 (Contrast)**: barcha token juftliklari contrast testida —
  `tests/unit/accessibility.test.js`.
- **1.4.4 (Resize text)**: rem-based typography; 200% zoom reflow spec —
  `tests/a11y/audit.spec.js`.
- **2.4.7 (Focus Visible)**: `:focus-visible` 25+ faylda; focus ring token.
- **2.5.8 (Target Size)**: interaktiv elementlar min 44px; Participant 48px;
  `.btn-sm` dense variant 32px — documented exception (S09.09).
- **2.3.3 (Animation)**: `prefers-reduced-motion: reduce` 24 faylda.
- **1.3.1 (Info/Relationships)**: landmarks, aria-labelledby, live regionlar.

## Known limitations

1. **NVDA+Chrome / VoiceOver+Safari** to'liq smoke testlari release checklistda
   manual qilinadi (S36.04) — CI'da avtomatik emas.
2. **Cast Projector / Game Host** real-time ekranlari — screen reader'da qisman
   sinovdan o'tgan; jonli o'zgarishlar live region orqali e'lon qilinadi.
3. **320px/400% reflow** — asosiy sahifalarda test qilingan; juda uzun test nomlari
   ekstremal holatlarda truncate bo'lishi mumkin (title attribute bilan).
4. **Text-spacing override** (1.4.12) — fixed-height elementlar auditda kuzatiladi;
   interaktiv elementlar min-height bilan himoyalangan.

## Contact

Agar accessibility muammosi topsangiz: repository issue tracker orqali
yoki support kanalida xabar bering. Ekran o'quvchisi ishlatayotganingizni,
sahifa URL'ini va kutilgan natijani yozing.

## Sinov jarayoni

```bash
# Statik audit (CI gate, browser'siz)
node scripts/a11y-audit.js

# Axe browser audit (WCAG 2.2 AA, serious/critical = fail)
NODE_ENV=test npx playwright test --project=a11y-audit tests/a11y/

# Contrast math unit testlari
npx vitest run tests/unit/accessibility.test.js
```

Ushbu hujjat har release'da yangilanadi (tested scope + limitations + date).
