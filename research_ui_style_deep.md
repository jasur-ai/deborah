# Edikit STYLE SYSTEM + O'ZBEKISTON KONTEKSTI — DEEP RESEARCH (token arxitektura, tipografiya, spacing, microcopy, mahalliy kontekst)

> **Holat:** research bosqichi. `uploads/style.md` — 46 bo'limli spec mavjud (325+ manba, OKLCH master, motion tokenlari, landing blueprint). Bu hujjat style.md'ni **yangicha evidence bilan mustahkamlaydi** va O'zbekiston kontekstini qo'shadi: design token arxitektura, tipografiya, spacing/grid, microcopy standartlari, va UZ raqamli ekotizim (my.edu.uz, HEMIS, DataReportal).

---

## 1. Design token arxitektura (evidence)

### 1.1. Uch qavatli strategiya (timgraf + JISEM 2025 + design.dev + reddit Figma)

```text
QAVAT 1 — PRIMITIVE (foundation/global):
   --blue-500, --gray-100, --font-size-base, --spacing-4
   (platform-agnostic; brand qiymatlar)
QAVAT 2 — SEMANTIC (alias/role):
   --color-action, --color-surface, --color-text, --color-border
   (ma'no — theme'ga bog'liq emas; "Separate Foundation from Semantic" — JISEM)
QAVAT 3 — COMPONENT:
   --btn-primary-bg, --input-border-color, --card-surface
   (komponentga bog'langan)
```

Qoidalar (reddit Figma — Optimal-Ad-2816; timgraf):
- **"Primitive → Semantic"** — 2 kolleksiya asos; component-specific kerak bo'lsa 3-chi
- **Naming: "Purpose+VALUE"** — `spacing-4=4px`, `border-radius-8=8px` — s/m/l/xl emas (skalalanmaydi)
- **Fluid typography** — token "ratio" (golden ratio/major third) — viewport'ga mos (timgraf 2026)
- **Token sprawl qarshi** — qat'iy hierarchy; 5000 tokens strukturasiз — muammo (timgraf)
- **Style Dictionary** (Amazon) — bitta manba → CSS/JS/platform (JISEM)
- **Tegishli birliklar:** rem (font), spacing px (yoki rem) — izchil (designsystemscollective)

### 1.2. Theming (Material 3 evidence — resumelens, claudepluginhub)

- **Color roles** — primary/on-primary/primary-container/on-primary-container/surface/on-surface/surface-variant/outline/error (M3)
- **Light↔dark inversion:** primary light T40 → dark T80; container T90 → T30; **hue/chroma bir xil, faqat tone** (claudepluginhub) — "ranglar keskin o'zgarmasligi"ning asosiy mexanizmi
- **Tonal elevation** — shadow o'rniga surface tint (`color-mix(srgb, primary 5-8%, surface)`) — dark'da ham ko'rinadi (claudepluginhub)
- **@property** — `<color>`-typed token → silliq interpolatsiya (carmenansio)
- **oklch** — perceptual L; dark'da "flip lightness" kifoya (csstools)

### 1.3. Edikit token tekshiruvi (style.md 20.2 bilan mos)

style.md master palitra allaqachon shu qoidalarga mos:
- Light action `oklch(52.32% 0.2007 262.9)` / Dark action `oklch(62.91% 0.1783 262.5)` — **bir xil hue 262.9/262.5, faqat L va C o'zgargan** → M3 inversion qoidasiga to'liq mos
- Light canvas L97.58 / Dark canvas L16 — off-black (soft #080D18, #000 emas) → dark mode best practice (LogRocket/dev.to)
- Dark'da chroma pasaygan (0.20→0.18) — desaturatsiya qoidasi (LogRocket/Netguru)

---

## 2. Tipografiya — evidence

### 2.1. Tipografiya qoidalari (designsystemscollective + design.dev + timgraf)

- **Small-to-large band:** label/helper → body → subhead/head → hero display (designsystemscollective)
- **rem/em** — scaling; line length komfort (45-75 chars body) (designsystemscollective)
- **Kontrast** — rangga bog'liq emas; WCAG (designsystemscollective)
- **Tokenlar:** font-family, size, weight, line-height, letter-spacing (design.dev)
- **2-3 font max** (multipurposethemes LMS: "two or three font styles maximum")
- **Fluid scale** — ratio token (timgraf)
- **Universitar daraja:** sans-serif legibility; "quirkly fonts amateur-ish, ultra-generic lazy" (gapsystudio) — o'rtasi: distinctive lekin professional (style.md 42 "official but recognizable")

### 2.2. Edikit tipografiya talablari (UZ kontekst)

- **Uzbek lotin + kirill** — glyph support majburiy (o', g', sh, ch + ў, қ, ғ) — font tanlovida ko'rsatilgan (style.md 29: font subset)
- Latin/UTF-8; Cyrillic professional tarjima (transliteratsiya emas)
- **4 til** — uz-Latn, uz-Cyrl, ru, en — BCP-47; uzun matnlar (ru) layout sig'ishi
- Dyslexia/a11y: 16px+ body; line-height 1.5+

---

## 3. Spacing / grid — evidence

- **8px grid** (designsystemscollective HexaGrid: 12-column, 8-pixel utility grid)
- **Token spacing scale:** 0/2/4/8/12/16/20/24/32/40/48/64 (design.dev + reddit Figma)
- **Density:** teacher high-density / landing spacious — token orqali (style.md 5)
- **Whitespace = qiymat** ("you aren't paying per pixel" — SQLGene; minimalist 19% better conversion — landing-page.io)
- **Responsive frames** — breakpoint'lar bilan bog'langan (designsystemscollective)

---

## 4. Microcopy / UX writing — evidence

### 4.1. Qoidalar (userpilot, medium ebabatunde, designsystemscollective, koruux, letsgroto)

- **Button: verb bilan, aniq, natija bilan** — "Send Message" > "Submit"; "Create Account" > "Register" (designsystemscollective)
- **Error: empatik + nima xato + keyingi qadam** ("This file exceeds the 5MB limit" — aniq yechim bilan) (medium)
- **Proactive microcopy** — xatoni oldini olish ("Upload PDF or JPG (max 5MB)") (medium)
- **Empty state = imkoniyat** — Notion: demo + onboarding checklist (userpilot)
- **Trust microcopy** — sensitive action'da reassurance ("Ma'lumotlar Ministry of Education...") (medium)
- **Tone: inson, professional** — "friendly, conversational builds trust" (designsystemscollective)
- **Consistency** — terminology glossary (letsgroto); style guide: tone, grammar, do/don't (letsgroto)
- **Test** — A/B button/tooltip/empty state (letsgroto)

### 4.2. Edikit microcopy spec (universitar ton)

```text
BUTTON:
  [Kirish] [Ro'yxatdan o'tish] [Test yaratish] [Cast boshlash] [Bepul boshlash]
ERROR:
  "Parol noto'g'ri. Qayta urinib ko'ring yoki parolni tiklang."
  (empathy + next step — authgear)
EMPTY STATE:
  "Hozircha testlar yo'q. Birinchi testni yarating — 3 daqiqa ketadi."
  (outcome timeframe — webanatomy 21% opportunity)
TRUST:
  "Ma'lumotlar O'zbekistonda saqlanadi · Hech qachon uchinchi shaxsga berilmaydi"
CONFIRM:
  "O'zgarishlar saqlandi"
LOCKOUT:
  "Xavfsizlik uchun hisob 5 daqiqaga bloklandi. Keyinroq urinib ko'ring."
```

---

## 5. O'ZBEKISTON KONTEKSTI — raqamli ekotizim

### 5.1. Raqamlar (DataReportal Digital 2026: Uzbekistan + Kursiv)

| Ko'rsatkich | Qiymat | Manba |
|---|---|---|
| Internet foydalanuvchilar | **33.1 mln (89% aholi)** | [datareportal](https://datareportal.com/reports/digital-2026-uzbekistan) |
| Mobil ulanishlar | 33.9 mln (91.1%) — 95.6% 3G/4G/5G | [datareportal](https://datareportal.com/reports/digital-2026-uzbekistan) |
| Median mobil tezlik | **55.5 Mbps** (yiliga +53%) | [kursiv](https://uz.kursiv.media/en/2025-11-09/how-internet-is-changing-uzbekistan-key-figures-for-2025/) |
| Fixed broadband | 86.7 Mbps (+25%) | [kursiv](https://uz.kursiv.media/en/2025-11-09/how-internet-is-changing-uzbekistan-key-figures-for-2025/) |
| Offline qolgan | 11% (asosan qishloq, keksa) | [datareportal](https://datareportal.com/reports/digital-2026-uzbekistan) |
| Uy internet | ~79% (10+ yosh) | [ts2.tech](https://ts2.tech/en/uzbekistans-internet-makeover-blazing-speeds-new-satellites-and-lingering-barriers/) |

**Xulosa:** UZ'da internet deyarli universal, **mobil dominant** — Edikit **mobile-first** bo'lishi shart; tezlik yaxshilangan (55 Mbps) — lekin qishloqda past bo'lishi mumkin → **low-bandwidth tolerant** (SSR EJS, minimal JS, WebP).

### 5.2. Mahalliy raqamli ta'lim ekotizimi (o'rganilgan)

- **my.edu.uz** — Yagona ta'lim xizmatlari portali (Raqamli ta'lim markazi) — qabul, ko'chirish, magistratura; SMS OTP orqali kirish (perfectum.uz ro'yxati)
- **HEMIS** — talaba: ma'lumotnoma onlayn, davomat, jadval, baholar, transkript, diplom, nazorat jadvallari; HEMIS Mobile + Telegram bot (my_edu_uz telegram)
- **my.hemis.uz** — HEMIS yangi talqini
- **MyMaktab** (UZINFOCOM) — maktabga qabul/ko'chirish arizalar — **ariza holatini kuzatish** UX'i
- **e-edu.uz** — qabul jarayonlari yangiliklari
- **Kontrakt/litsey/transfer.edu.uz** — SMS OTP auth

**Edikit uchun saboqlar:**
1. **OTP/SMS orqali kirish** — O'zbekiston davlat platformalarida odatiy → Edikit'da OTP login (email) + Telegram OTP (B-22) — tanish pattern
2. **Holat kuzatish** (MyMaktab) — ariza/test statusi aniq ko'rinishi — Edikit teacher approval (B-29) va test statuslariga qo'llash
3. **Transkript/diplom** — HEMIS'da transkript yuklab olish — Edikit portfolio (A-12) bilan uyg'un
4. **Rasmiy platformalar soddaligi** — davlat portallari sodda (UXDT trust) — Edikit "official" lekin chiroyliroq
5. **UZ'da dark mode** — mahalliy portallar asosan light; Edikit light default, dark bonus (huedserve: education'da light "professional" qabul qilinadi)

### 5.3. Mobil UX (UZ uchun)

- Talabalar telefon asosiy qurilma → auth + student panel **mobile-first**
- OTP autofill (iOS/Android) — SMS tekshiruvi keng
- Telegram — UZ'da dominant messenjer → Telegram OTP/bildirishnoma (B-22) muhim
- Past tezlikda: SSR, kichik JS, WebP, lazy load

---

## 6. Dark mode — education uchun xulosa

- **Light default** — education'da "professional/clear" (huedserve: 55% education apps light)
- **Dark to'liq sifatli** — 80% user dark xohlaydi (stellar), lekin education'da kontekst (sinf projektori — light yaxshiroq)
- **Nazorat** — Light/Dark/System (LogRocket/Smashing)
- **Silliq o'tish** — @property/View Transition; FOUC yo'q (jonshamir, gaisdev)
- **Off-black** — #000 emas (dev.to); desaturatsiya (LogRocket); tonal elevation (M3)

---

## 7. Qabul mezonlari (style tizimi tasdiqlanganda)

1. Token: 3 qavat (primitive→semantic→component); naming "Purpose+VALUE"; Style Dictionary
2. OKLCH master (style.md 20.2); har token hex fallback + oklch
3. @property `<color>` tokenlar; silliq theme interpolatsiya
4. Tipografiya: rem, fluid ratio, glyph (o'/g'/ў/қ/ғ), 2-3 font
5. Spacing: 8px grid, token scale
6. Microcopy: style guide (tone, terminology, do/don't) — 4 til
7. UZ kontekst: mobile-first, OTP pattern, Telegram, transkript/portfolio, davlat-platforma tanishligi
8. Dark: light default + dark sifatli + system rejim

---

## 8. Manbalar

timgraf.com (token architecture 2026) · jisem-journal.com (token system) · design.dev (tokens) · reddit r/FigmaDesign (spacing tokens) · designsystemscollective.com (typography styles, microcopy) · datareportal.com (Digital 2026 Uzbekistan) · uz.kursiv.media (UZ internet figures) · ts2.tech (UZ internet) · t.me/s/my_edu_uz (my.edu.uz/HEMIS) · play.google.com (MyMaktab) · perfectum.uz (edu portals) · e-edu.uz · userpilot.com (UX writing examples) · medium (microcopy ebabatunde) · letsgroto.com (UX writing guide) · koruux.com · resumelens.org (M3 theming) · claudepluginhub.com (M3 elevation) · carmenansio.com (@property) · csstools.io (oklch) · LogRocket (dark mode) · Smashing (inclusive dark) · Netguru (dark tips) · stellar (dark stats) · huedserve (dark vs light education)
