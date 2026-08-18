# Edikit Brand Assets — STYLE STEP 05

Evidence-Led institutional identita. Ushbu hujjat brand assetlarining yagona manbasi.

## 1. Asset inventar

| Asset | Fayl | Variantlar |
|-------|------|-----------|
| Evidence Mark | `public/images/brand/evidence-mark.svg` | cobalt, monochrome, inverse, high-contrast |
| Wordmark lockup | `public/images/brand/wordmark-horizontal.svg` | horizontal (subtitle bilan) |
| Wordmark compact | `public/images/brand/wordmark-compact.svg` | mark + nom, subtitle'siz |
| Mark-only | `public/images/brand/evidence-mark.svg` | faqat mark (favicon/nav) |
| Signal Rail | `public/design/brand.css` (`.sr-rail`) | current / live / attention / error |
| Response Mosaic | `public/design/brand.css` (`.rm-mosaic`) | static / live / reduced-motion |

## 2. Evidence Mark — tuzilish (S05.01)

Optical grid 8px bo'yicha:

- **Signal node** — yuqorida joylashgan nuqta; "jonli" holatni bildiradi
- **Vertical rail** — 3px kenglikdagi vertikal chiziq; to'planish/tartibni bildiradi
- **3 evidence tick** — o'suvchi kenglikda (11/16/21); to'planayotgan dalilni bildiradi

Tanilish: 16, 24, 32 va 64px da test qilingan (`tests/visual/brand-assets.spec.js`).
Favicon 16px da legible — gradient ishlatilmaydi, solid cobalt.

## 3. Lockup qoidalari (S05.04)

| Lockup | Minimal kenglik | Ishlatilish |
|--------|----------------|-------------|
| Horizontal | 140px | Landing header, docs, presentations |
| Compact | 96px | Tor header'lar, admin nav |
| Mark-only | 16px | Favicon, avatarlar, favicon-ga yaqin joylar |

**Clear-space:** mark atrofida kamida x-height (matn balandligi) bo'sh joy saqlanadi.
**Taqiqlangan:** mark'ni strech qilish, gradient qo'shish, glow/filter qo'shish,
rangni tasdiqlanmagan variantga almashtirish, "Edikit" nomini boshqa shriftda yozish.

## 4. Variant tanlash (S05.02)

| Kontekst | Variant |
|----------|---------|
| Standart (oq/oqimtir fon) | cobalt |
| Matn rangiga mos (ikonalar) | monochrome (`currentColor`) |
| Qorong'i fon (nav, hero) | inverse |
| Yuqori kontrast talab (forced-colors) | high-contrast |
| Gradient/logo | **taqiqlangan** (faqat marketing illustration) |

## 5. Three-view composition (S05.07)

Product screenshot grammatikasi — `Director / Projector / Participant`:

1. **Director** — yuqori o'ng burchak, eng katta frame, `0°` burchak, eng kuchli shadow
2. **Projector** — o'ng pastda, o'rta kattalik, `8°` burilish, o'rta shadow
3. **Participant** — chap pastda, eng kichik frame, `12°` burilish, eng yengil shadow

Label'lar doim bir xil: `Director — Dashboard`, `Projector — Live`, `Participant — Mobile`.
Frame order: Director → Projector → Participant (chapdan o'ngga, kattadan kichikka).

## 6. Verbal asset (S05.08)

```
Ask → See → Adapt      (EN)
So'ra → Ko'r → Moslashtir   (UZ)
```

- Landing, docs va presentations'da bir xil yoziladi — boshqa variatsiya ishlatilmaydi.
- Arrow `→` ishlatiladi, `>` yoki `->` emas.
- Copy'da birinchi uchraydigan joyda ham EN, ham UZ berilishi mumkin.

## 7. Evidence Gradient policy (S05.09)

- **Product UI'da gradient taqiqlangan.** Primary button solid cobalt (`--edikit-semantic-color-action-primary`).
- Gradient faqat marketing/illustration contextida — OG image, poster, presentation cover.
- `logo-icon.svg` (favicon/app icon) solid cobalt rounded-square + white mark — gradient'siz.

## 8. Borrowed/cartoon asset migration (S05.10)

Inventar natijasi:

| Asset | Joyi | Holat |
|-------|------|-------|
| Cartoon characters (wolf, kai, blade...) | `characters/cartoon-chars.js` — game mode | ✅ Game-scoped — default brand identity emas; `/play` join/host ekranlarida faqat game mode'da |
| Shield / lightning / trophy / particles | `style.css`, `main.js`, `index.ejs` | ✅ Mavjud emas (grep 0 natija) — olib tashlash talab qilinmaydi |
| Eski gradient "nuqta+E" mark | `logo-icon.svg`, `logo-text.svg` | 🔄 Almashtirildi → Evidence Mark (STEP 05) |

Cartoon'lar game mode feature'iga tegishli; institutional brand yuzasida (landing, nav,
admin) ishlatilmaydi.

## 9. Alt / aria-hidden policy (S05.11)

- **Logo alt har doim `"Edikit"`** — hamma joyda (nav, admin, game, favicon).
- Dekorativ assetlar (rail, mosaic cell'lar) — `aria-hidden="true"` yoki qo'shni
  matn/semantik element orqali tasvirlanadi.
- Evidence Mark SVG'da `role="img"` + `aria-label="Edikit Evidence Mark"` — standalone
  ishlatilganda; lockup'da `role="img"` + `aria-label="Edikit"`.
- Icon'lar (`svgIcon()` helper) — mavjud `icon-inline` bilan dekorativ.

## 10. Blind-recognition prototype (S05.12)

`public/brand/gallery.html` — nom/wordmark olib tashlangan, faqat mark/rail/mosaic
ko'rinadigan prototype. Tanilish testi: 3 panel (Evidence Mark, Signal Rail, Response
Mosaic) alohida ko'rsatiladi — foydalanuvchi qaysi biri Edikit ekanini tanlaydi.

## 10a. Wordmark font limitation (S05.03 — texnik eslatma)

`wordmark-*.svg` fayllarida `Righteous` font `font-family` orqali ko'rsatiladi.
**SVG `<img>` kontekstida ishlatilganda** tashqi font'lar yuklanmaydi —
Righteous Google Font sahifadan kirib bormaydi, shuning uchun wordmark
`Segoe UI`/system-ui fallback'ga tushadi. Bu `logo-text.svg`'da ham mavjud
(oldingi xatti-harakat bilan bir xil).

To'liq font identifikasiyasi kerak bo'lgan joylarda (docs, presentation):
inline SVG yoki `<svg><use>` ishlatiladi yoki matn path'ga convert qilinadi.
Hozirgi `gallery.html` shu fallback bilan screenshot'lanadi (deterministic).

## 11. Tekshiruv

```bash
npm run brand:validate    # SVG struktura/variant qoidalari
npm run test:visual       # legibility + diff gate (brand-assets.spec.js)
```
