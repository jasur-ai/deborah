# Edikit UI/UX — FAZA B: FOUNDATION (dizayn tizimi asosi)

> **Old shart:** Global Master Prompt (UI/UX) har promptdan oldin.
> **Source:** `research_ui_style_deep.md` (token arxitektura, tipografiya), `research_ui_tech_deep.md` (DTCG, modern CSS, theme), `research_ui_audit.md` (A-faza natijalari), `uploads/style.md` (OKLCH master 20.2, motion 6).

---

## B-00 — Foundation preflight

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `research_ui_style_deep.md` 1-4-bo'limlarini o'qib, token reja tuz (3 qavat: primitive→semantic→component).
03. `research_ui_tech_deep.md` 3-bo'limini o'qib, DTCG + Style Dictionary toolchain'ni tasdiqla (tokens.json manba).
04. Precondition: A-11 (AUDIT-FIX) yashil.
05. Hozirgi holatni inventarizatsiya qil: `public/css/style.css` token bloklari (--bg-*, --accent-*, --font-*, --ease-*), head.ejs theme script, theme.js.
06. Tanlov: `tokens.json` (W3C DTCG) + Style Dictionary build → `:root` CSS variables. Bitta manba, CI'da generatsiya.
07. Fayl reja:
   - `tokens/` katalog: `primitives.json`, `semantic.json`, `component.json` (yoki bitta tokens.json).
   - `style-dictionary` config (B-01).
   - Chiqish: `public/css/tokens.css` (generated).
08. Qaror: Tailwind ishlatilmaydi (native CSS + @layer + tokens — research_ui_tech_deep 1.2).
09. Baseline: `npm run typecheck`, `npm test` natijalari yoz.
10. Security/data guard: hech qanday secret tokens'da emas.
11. Unit test: existing smoke.
12. Integration/contract test: existing route smoke.
13. E2E/security test: workspace toza.
14. Mavjud testlarni ham ishlat.
15. `implementation-status-uiux.md` ga B-00 statusi yoz.
16. Global report formatida qaytar.
17. Stop condition: token reja tasdiqlanmasa.
18. Done condition: reja aniq, B-01 ready.
19. B-01 uchun: tokens.json — tayyor ekanini dalil bilan yoz.
20. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
21. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
22. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
23. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
24. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
25. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
26. A11y spot: keyboard focus, `aria` atributlari, kontrast — axe 0 critical (sahifa interaktiv bo'lsa majburiy).
27. Reduced-motion: bu o'zgarishda harakat bo'lsa — `prefers-reduced-motion: reduce` da o'chganligi tekshiriladi (A-03).
```

---

## B-01 — tokens.json (W3C DTCG) + Style Dictionary pipeline

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `research_ui_tech_deep.md` 3-bo'limidagi DTCG formatni qo'llash:
   - `$value` / `$type` sintaksis; `$type` inference (guruh darajasida).
   - 17 token turidan: color, dimension, fontFamily, fontWeight, duration, cubicBezier, number, string, shadow, border, transition, typography.
   - Alias: `{color.brand.blue-500}` — reference.
03. `tokens/` katalog + Style Dictionary:
   - `npm i -D style-dictionary` (v5) + config `sd.config.js`.
   - Build: CSS custom properties `:root` (light) + `[data-theme="dark"]` (dark) chiqishi.
   - Script: `"build:tokens": "style-dictionary build"` package.json'ga.
04. Primitive tokenlar (style.md 20.2 dan):
   - `color.brand.cobalt/cyan/amber` (light+dark L/C/H), `color.neutral.*` scale, `color.success/warning/danger`.
   - Har token 2 qiymat: hex fallback + oklch (css'da ikkala deklaratsiya).
05. Semantic tokenlar: `color.action`, `color.surface`, `color.text`, `color.border`, `color.bg`, `color.muted` — theme'ga bog'liq emas (mapping keyin).
06. Component tokenlar (keyingi B-09/10): btn-primary-bg, input-border...
07. Motion tokenlar (style.md 6): `duration.instant/quick/fast/ui/panel/page/brand`, `easing.standard/enter/exit/emphasis` — **bounce/elastic YO'Q**.
08. Typography tokenlar (keyingi B-06): fontFamily/fontSize/lineHeight.
09. Chiqish fayl `public/css/tokens.css` — head.ejs'da style.css dan OLDIN yuklanadi.
10. Security/data guard: tokens'da secret/PII yo'q.
11. Unit test: tokens.json valid (JSON schema $value/$type); build ishlaydi (regex/CI).
12. Integration/contract test: tokens.css da `--color-action` va `[data-theme="dark"]` blok bor.
13. E2E/security test: sahifalar tokens.css bilan yuklanadi; o'zgarish yo'q (visual).
14. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
15. `implementation-status-uiux.md` ga B-01 statusi yoz.
16. Global report formatida qaytar.
17. Stop condition: build ishlamasa yoki DTCG format bo'lmasa.
18. Done condition: tokens.json manba, tokens.css generatsiya, CI'da ishlaydi.
19. B-02 uchun: @layer arxitektura — tayyor.
20. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
21. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
22. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
23. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
```

---

## B-02 — CSS @layer + custom property arxitektura

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `public/css/style.css` boshiga @layer qatlamlarini qo'shish:
```css
@layer reset, tokens, base, components, utilities;
```
   - `reset`: minimal (box-sizing, margin 0, img max-width).
   - `tokens`: tokens.css ichida (layer ichiga `@import` yoki link — keyin CSS import tartibi).
   - `base`: body, headings, links, focus-visible.
   - `components`: .btn, .inp, .card, .nav...
   - `utilities`: .visually-hidden, .text-muted...
03. Specificity urush yo'q: `!important` ishlatilmaydi (mavjud bo'lsa olib tashlash, @layer tartibi bilan).
04. Hozirgi `:root` va `[data-theme]` bloklari `tokens` layer'iga ko'chiriladi (B-01 tokens.css bilan mos).
05. Inline `<style>` view'larda — faqat sahifaga xos qoidalar; umumiy komponentlar global'da (B-09/10 keyin view'larni tozalaydi).
06. `color-scheme: light dark` — :root'da (native scrollbar/form controls theme'ga mos).
07. `@property` qoidalari (B-04/05 uchun asos): `<color>`-typed tokenlar e'lon qilinadi (interpolatsiya uchun).
08. Security/data guard: hech qanday logika o'zgarmaydi.
09. Unit test: style.css da @layer mavjud (regex); !important soni kamaygan.
10. Integration/contract test: sahifalar yuklanadi, styling buzilmagan (screenshot diff).
11. E2E/security test: cascade to'g'ri (komponent qoidalari utilities'dan keyin override qila oladi).
12. GREP-CHECK: `grep -c "!important" public/css/*.css` — faqat A-03 reduced-motion qoidasida.
13. A11y: focus-visible global qoida.
14. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
15. `implementation-status-uiux.md` ga B-02 statusi yoz.
16. Global report formatida qaytar.
17. Stop condition: @layer yo'q yoki specificity urush qolsa.
18. Done condition: qatlamli arxitektura, !important minimal.
19. B-03 uchun: OKLCH palitra — tayyor.
20. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
21. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
22. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
23. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
```

---

## B-03 — OKLCH master palitra (light + dark + semantic tokenlar)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `uploads/style.md` 20.2 dagi master qiymatlarni tokens'ga to'liq ko'chirish:
   - LIGHT canvas `oklch(97.58% 0.0057 264.5)`, surface `oklch(100% 0 0)`, text `oklch(27.81% 0.0296 256.8)`, muted `oklch(49.12% 0.0364 263.3)`, action `oklch(52.32% 0.2007 262.9)`, success/warning/danger.
   - DARK canvas `oklch(16.00% 0.0249 264.6)`, surface `oklch(21.83% 0.0362 262.5)`, raised `oklch(25.28% 0.0430 262.6)`, text `oklch(93.56% 0.0121 259.8)`, muted `oklch(75.47% 0.0300 261.5)`, action `oklch(62.91% 0.1783 262.5)`.
03. Qoida (M3): light↔dark da **hue bir xil (262-264)**, faqat L/C o'zgaradi — ranglar "keskin o'zgarmaydi".
04. Semantic tokenlar (B-01 da e'lon qilingan) shu qiymatlarga mapping:
   - `--color-action` → cobalt; `--color-accent` (Signal Cyan), `--color-insight` (Amber).
   - `--color-success/warning/danger` — light/dark alohida (style.md 20.2).
05. Eski tokenlarni yangilari bilan bog'lash (style.css): `--accent: var(--color-action)` (kompatibilite — B-09/10 da tozalash).
06. Har token: `--x: #hex; --x: oklch(...);` (fallback birinchi).
07. Dark'da desaturatsiya: chroma dark'da pastroq (style.md 20.2 qiymatlari buni allaqachon qilgan — tekshir).
08. Tonal elevation (M3): shadow o'rniga surface tint — `--color-surface-raised: color-mix(in srgb, var(--color-action) 5%, var(--color-surface))` (dark'da ham ko'rinadi).
09. Off-black/off-white: #000 va #fff toza EMAS (style.md: #080D18 / #F5F7FB).
10. Security/data guard: tokens CSS'da; hech qanday JS o'zgarmaydi.
11. Unit test: tokens.css da oklch qiymatlari bor; dark blokda hue 262-264 (regex).
12. Integration/contract test: light+dark'da kontrast ≥4.5:1 (avtomatik kontrast test — Playwright/axe).
13. E2E/security test: barcha muhim sahifalarda light/dark kontrast AA.
14. GREP-CHECK: `grep -n "#3B82F6\|#2563EB" public/css/style.css` — asosiy accentlar token'ga o'tgan (eski hex'lar kamayadi).
15. A11y: kontrast barcha sahifada.
16. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
17. `implementation-status-uiux.md` ga B-03 statusi yoz.
18. Global report formatida qaytar.
19. Stop condition: dark'da hue o'zgargan bo'lsa yoki kontrast <4.5:1 bo'lsa.
20. Done condition: OKLCH master to'liq, light/dark bir oila, kontrast AA.
21. B-04 uchun: theme engine — tayyor.
22. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
23. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
24. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
25. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
26. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
```

---

## B-04 — Theme engine: Light/Dark/System, FOUC-free

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `views/partials/head.ejs` inline script'ini yangilash:
   - 3 rejim: `localStorage['edikit-theme'] = 'light' | 'dark' | 'system'`.
   - `system` bo'lsa: `matchMedia('(prefers-color-scheme: dark)')` dan aniqlash.
   - FOUC-free: `<html data-theme="...">` birinchi paint'dan oldin; `color-scheme` + `background-color` inline qo'yiladi (A-03/gaisdev pattern).
   - Default: **light** (education — huedserve) yoki system (birinchi marta).
03. `public/js/theme.js` yangilash:
   - `apply(pref)` — 'system' resolve qiladi; `data-theme` qo'yadi; `localStorage` saqlaydi.
   - `matchMedia('(prefers-color-scheme: dark)')` change listener — faqat 'system' rejimida qayta apply (rezolyutsiya).
   - `meta[name="theme-color"]` yangilanadi (light/dark qiymat).
   - Toggle tugmasi: header'da (top-right) — 3 holatli yoki Light/Dark ikki (System qo'shimcha menu'da).
04. `color-scheme` property: `:root { color-scheme: light dark; }` + `[data-theme="dark"] { color-scheme: dark; }` (native scrollbar/form).
05. `light-dark()` dan foydalanish (B-05 bilan): ba'zi component'larda ikkala qiymat bir qatorda (majburiy emas — token'lar asosiy).
06. Barcha view'lardagi `data-theme-toggle` tugmalari — bitta pattern (header'dan); `theme-floating` (bottom-right) olib tashlanadi (header'ga ko'chiriladi).
07. Security/data guard: localStorage faqat prefer; hech qanday PII emas.
08. Unit test: theme.js da 'system' handling bor (regex); default light.
09. Integration/contract test: system dark'da sahifa dark ochiladi (Playwright emulateMedia); FOUC yo'q (screenshot — boshlang'ich frame to'g'ri).
10. E2E/security test: toggle ishlaydi; localStorage saqlanadi; reload'da saqlanadi.
11. GREP-CHECK: `grep -rn "theme-floating" views/` = 0 (yangi header pattern); `grep -n "edikit-theme" views/partials/head.ejs` ≥ 1.
12. A11y: toggle aria-label + aria-pressed; kontrast.
13. i18n: toggle title 4 til (keyin).
14. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
15. `implementation-status-uiux.md` ga B-04 statusi yoz.
16. Global report formatida qaytar.
17. Stop condition: FOUC bo'lsa yoki 'system' ishlamasa.
18. Done condition: Light/Dark/System, FOUC-free, persist.
19. B-05 uchun: theme transition — tayyor.
20. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
21. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
22. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
23. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
```

---

## B-05 — Theme switch transition (@property + View Transitions, ≤500ms)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `@property` qoidalari (B-02 asosida) — `<color>`-typed tokenlar:
```css
@property --color-action { syntax: '<color>'; inherits: true; initial-value: #255EDB; }
```
   - Muhim tokenlar (bg, surface, text, border, action) — hammasi @property.
03. Theme switch'da silliq o'tish (research_ui_tech_deep 1.4, jonshamir):
   - Asosiy: CSS transition `background-color 400ms var(--ease-standard), color 400ms ...` — @property tokenlarda ishlaydi.
   - Kuchaytirilgan (ixtiyoriy, P2): `document.startViewTransition(() => apply(next))` — agar mavjud bo'lsa; `prefers-reduced-motion: reduce` da — INSTANT (no transition).
04. 900ms → **400-500ms max** (NN/g: 500ms chegara) — theme.js dagi eski 1050ms cleanup olib tashlanadi.
05. View Transitions qoidasi: `@supports (view-transition-name: none) { @media (prefers-reduced-motion: no-preference) { ... } }` — fallback oddiy transition.
06. Sahifa transition'lar (View Transitions API) — B-06 dan keyin C fazada (landing); B'da faqat theme switch.
07. Security/data guard: JS logika o'zgarmaydi; theme.js soddalashadi.
08. Unit test: theme.js da 900ms/1050ms yo'q; `@property` qoidalari tokens.css da (regex).
09. Integration/contract test: reduce'da instant; normal'da ~400ms (Playwright timing).
10. E2E/security test: theme switch'da FOUC/artifakt yo'q (screenshot); silliq.
11. GREP-CHECK: `grep -n "900\|1050" public/js/theme.js` = 0.
12. A11y: reduced-motion qat'iy; `transition: none` reduce'da.
13. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
14. `implementation-status-uiux.md` ga B-05 statusi yoz.
15. Global report formatida qaytar.
16. Stop condition: 500ms dan uzun yoki reduce'da animatsiya.
17. Done condition: theme switch ≤500ms, reduced-motion instant, FOUC-free.
18. B-06 uchun: tipografiya — tayyor.
19. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
20. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
21. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
22. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
23. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
24. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
```

---

## B-06 — Tipografiya tizimi (tokenlar, professional, 4-til glyph)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `research_ui_style_deep.md` 2-bo'limi asosida tipografiya tokenlarini B-01 tokens'ga qo'shish:
   - `font.family.display` = 'Manrope'; `font.family.body` = 'Inter' (A-01 dan).
   - `font.size.*`: 12/14/16/18/20/24/32/40 (rem).
   - `font.weight.*`: 400/500/600/700/800.
   - `line.height.*`: 1.25 (heading) / 1.5 (body) / 1.75 (relaxed).
03. Fluid tipografiya: `clamp()` display/heading uchun (timgraf 2026 — ratio token; `--font-size-display: clamp(2rem, 4vw + 1rem, 3.5rem)`).
04. Type scale qo'llash:
   - `.t-display` (landing H1), `.t-h1..h4`, `.t-body`, `.t-label`, `.t-caption` — utility yoki component sinflari.
   - Sarlavhalar 700-800, body 400-500; label uppercase small (auth'dagi .lbl pattern saqlanadi).
05. 4-til glyph tekshiruvi: Manrope/Inter — uz o', g', sh, ch + ў, қ, ғ kirill; `lang` atributi to'g'ri (uz-Latn/uz-Cyrl/ru/en).
   - Kirill uchun fallback: `system-ui` (agar Manrope kirillni to'liq qamramasa — tekshir).
06. `font-feature-settings` / `font-variant` — raqamlar uchun tabular-nums (statistika/ballar).
07. Matn uzunligi: body line-length 45-75ch (`.prose` kontainer).
08. `text-wrap: balance` — sarlavhalar; `text-wrap: pretty` — paragraf (2026 CSS — universal).
09. Eski view'larda font-family hardcode'lar (A-01 da tozalangan) — qayta tekshir: hamma `var(--font-*)`.
10. Security/data guard: font URL https, display=swap.
11. Unit test: tokens.css da font tokenlar (regex); type utility'lar mavjud.
12. Integration/contract test: sahifalarda yangi type class'lar ishlaydi (visual).
13. E2E/security test: 4 til glyph render (screenshot uz-Cyrl, ru); FOIT yo'q.
14. GREP-CHECK: `grep -rn "font-family:[^v]" views/ public/` — faqat var() ishlatilgan.
15. A11y: 16px body min; line-height 1.5+; contrast.
16. i18n: lang atributi; uzun ru matnlar overflow emas.
17. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
18. `implementation-status-uiux.md` ga B-06 statusi yoz.
19. Global report formatida qaytar.
20. Stop condition: hardcode font-family yoki glyph yo'q bo'lsa.
21. Done condition: tipografiya tizimi to'liq, professional, 4 til.
22. B-07 uchun: spacing/grid — tayyor.
```

---

## B-07 — Spacing/grid tizimi (8px, container queries, subgrid)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. Spacing tokenlar (B-01 ga): `--space-0/1/2/3/4/6/8/12/16/20/24/32/40/48/64` (0/2/4/8/12/16/20/24/32/40/48/64 px) — 8px grid asos.
03. Layout tokenlar: `--radius-sm/md/lg` (8/12/16px), `--shadow-sm/md/lg` (elevation), `--container-max` (1140px), `--gutter` (16/24px responsive).
04. Utility: `.space-y-*`, `.gap-*` yoki component'lar o'z padding'larida token ishlatadi (B-09).
05. Container queries (research_ui_tech_deep 1.2):
   - `.card-grid { container-type: inline-size; }` — kartalar o'lchamiga mos.
   - `@container (min-width: 400px) { ... }` — dashboard kartalar, panel qismlari.
   - Media query o'rniga component-level responsive.
06. Subgrid: `.grid { display:grid; grid-template-columns: subgrid; }` — kartalar align (dashboard).
07. Bento grid (2026 — research_ui_top_sites_deep 4.6): landing features / teacher dashboard uchun modulli bloklar (keyin C/F da).
08. 8px grid qoidasi: hamma spacing 8'ga karrali (4 istisno: mikro 2/6).
09. Mavjud padding/margin'lar token'ga o'tkaziladi (view'lar bo'yicha — B-09/10 da tozalash).
10. Security/data guard: CSS only.
11. Unit test: tokens.css da spacing scale (regex); container-type qoidalari bor.
12. Integration/contract test: container queries ishlaydi (turli width — Playwright).
13. E2E/security test: responsive 375/768/1440'da layout buzilmaydi (screenshot).
14. GREP-CHECK: `grep -rn "padding: [0-9]" views/` — token'ga o'tgan (kamayadi).
15. A11y: 44px touch target (B-09 komponentlar); spacing kontrastga ta'sir emas.
16. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
17. `implementation-status-uiux.md` ga B-07 statusi yoz.
18. Global report formatida qaytar.
19. Stop condition: spacing hardcode ko'p bo'lsa.
20. Done condition: spacing/grid tizimi, container queries, bento-ready.
21. B-08 uchun: motion tokenlar — tayyor.
22. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
23. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
24. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
25. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
26. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
27. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
```

---

## B-08 — Motion tokenlar + component motion recipes

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. Motion tokenlar (B-01 ga, style.md 6.2/6.3 dan):
   - `--motion-instant: 0ms; --motion-quick: 80ms; --motion-fast: 120ms; --motion-ui: 160ms; --motion-panel: 220ms; --motion-page: 320ms; --motion-brand: 500ms;`
   - `--ease-standard: cubic-bezier(.2,0,0,1); --ease-enter: cubic-bezier(.16,1,.3,1); --ease-exit: cubic-bezier(.4,0,1,1); --ease-emphasis: cubic-bezier(.2,.8,.2,1);`
   - **--ease-bounce/--ease-elastic style.css dan o'chiriladi** (style.md: No bounce/spring).
03. Component motion recipes (style.md 6.5):
   - Button: `transition: background-color var(--motion-ui) var(--ease-standard), border-color ..., color ..., transform var(--motion-quick);` hover `translateY(-1px)` (scale emas), active `scale(.99)`.
   - Card: hover border/surface 120ms; lift max translateY(-1px); shadow jump yo'q.
   - Modal: enter 200-220ms, exit 160ms; overlay fade.
   - Tooltip/dropdown: 140-160ms enter, 100-120ms exit.
   - Toast: 180ms enter, 140ms exit.
   - Page/phase: 240-320ms (View Transitions — C fazada).
04. Property qoidasi: faqat transform/opacity/background-color/border-color/color; width/height/filter animatsiya EMAS.
05. Infinite animatsiya faqat: spinner (`--motion` ichida), pulse-loading (cheklangan) — hech qanday dekorativ infinite.
06. Hozirgi view'lardagi `transition: all .4s` → aniq token'li transition (B-09/10 da tozalash; B'da qoida).
07. Security/data guard: CSS only.
08. Unit test: tokens.css da motion tokenlar (regex); style.css da --ease-bounce yo'q.
09. Integration/contract test: button hover 120ms (Playwright timing); reduced-motion'da instant.
10. E2E/security test: barcha animatsiyalar token'li; 60fps (compositor).
11. GREP-CHECK: `grep -rn "ease-bounce\|ease-elastic\|transition: all" public/css/ views/` = 0.
12. A11y: reduced-motion; motion hech qachon content bloklamaydi.
13. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
14. `implementation-status-uiux.md` ga B-08 statusi yoz.
15. Global report formatida qaytar.
16. Stop condition: bounce/elastic yoki `transition: all` qolsa.
17. Done condition: motion token'lari, recipes, reduced-motion.
18. B-09 uchun: komponent base — tayyor.
19. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
20. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
21. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
22. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
```

---

## B-09 — Komponent base: button, input, card (token'lar bilan)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `public/css/style.css` `@layer components` ichida BASE komponentlar:
   - `.btn` (token): `--btn-bg: var(--color-action); --btn-color: #fff; --btn-radius: var(--radius-md); --btn-pad: var(--space-3) var(--space-5); --btn-font: var(--font-body); min-height:44px;` — variantlar: `.btn-primary`, `.btn-ghost`, `.btn-danger`, `.btn-sm/.lg`, `.btn:disabled`.
   - `.inp` (input): `--inp-bg: var(--color-surface); --inp-border: var(--color-border); --inp-focus: var(--color-action);` focus ring 3px; 16px font (iOS zoom); min-height 44px.
   - `.card`: `--card-bg: var(--color-surface); --card-border: var(--color-border); --card-radius: var(--radius-lg); --card-pad: var(--space-5);` — hover: border-color 120ms.
03. Barcha eski `.btn-*`, `.inp`, `.card` class'lari shu base'ga bog'lanadi (mavjud view'lar sinmagan).
   - `login.ejs` dagi `.btn-primary` gradient → **flat** `var(--btn-bg)` (M3 solid container; style.md: official).
   - `.btn:hover { transform: translateY(-2px) }` → `translateY(-1px)` (B-08).
04. Focus-visible global: `:focus-visible { outline: 2px solid var(--color-action); outline-offset: 2px; }` (keyboard faqat).
05. Disabled state: opacity + `cursor: not-allowed`; contrast yetarli.
06. Loading state: `.btn .spinner` — 0.8s infinite faqat loading; `aria-busy`.
07. Security/data guard: CSS only; hech qanday JS logika o'zgarmaydi.
08. Unit test: components class'lar mavjud (regex); token ishlatilgan (hardcode emas).
09. Integration/contract test: login/panel sahifalari yangi komponentlar bilan ishlaydi (screenshot diff minimal).
10. E2E/security test: 44px target; focus visible; XSS yo'q.
11. GREP-CHECK: `grep -rn "linear-gradient(135deg" views/ public/css/style.css` = 0 (btn/logo gradient'lari tozalandi).
12. A11y: focus, kontrast, 44px.
13. i18n: label'lar (keyin).
14. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
15. `implementation-status-uiux.md` ga B-09 statusi yoz.
16. Global report formatida qaytar.
17. Stop condition: btn/input hardcode rang yoki gradient bo'lsa.
18. Done condition: base komponentlar token'li, professional, a11y.
19. B-10 uchun: form elementlar — tayyor.
20. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
21. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
22. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
23. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
24. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
25. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
```

---

## B-10 — Form elementlar: label, error state, :has() validatsiya

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `@layer components` da form base:
   - `.field` (label + input + helper/error kontainer).
   - `.lbl` (top-aligned label — fomr.io: eng tez) — `font-size: var(--font-size-sm); font-weight:600; color: var(--color-text-muted);`.
   - `.field-error`: `color: var(--color-danger); font-size: var(--font-size-sm);` + `aria-live="polite"`; error icon + text (rangga bog'liq emas).
   - `.inp[aria-invalid="true"]`: `border-color: var(--color-danger);` + `:focus-visible` danger ring.
03. `:has()` dan foydalanish (research_ui_tech_deep 1.2 — JS o'rniga):
   - `label:has(+ input:invalid) { color: var(--color-danger); }`
   - `form:has(:invalid) .btn-submit { opacity:.5; pointer-events:none; }` (agar kerak — lekin NIST: parol qoidasi bloklamaydi, faqat uzunlik; submit disable UX qarori).
04. Error state view'larga qo'llash: login/register (A-07/08 dagi msg+inline), keyin D fazada to'liq.
05. Helper text: `autocomplete`, placeholder ≠ label (label doim ko'rinadi).
06. `accent-color: var(--color-action)` — checkbox/radio native.
07. Parol show/hide component (A-07 dan) — global `.password-toggle` pattern.
08. Security/data guard: validatsiya server-side (UI faqat UX); XSS esc.
09. Unit test: form component'lar (regex); :has() qoidalari bor.
10. Integration/contract test: `form:has(:invalid)` ishlaydi (Playwright invalid input → button state).
11. E2E/security test: error aria-live; error rangga bog'liq emas (icon+text); XSS yo'q.
12. GREP-CHECK: `grep -rn "border-radius:10px;padding:11px" views/` — eski input style tozalangan (token'ga).
13. A11y: label-for, aria-invalid, aria-describedby, error focus.
14. i18n: error matnlari (keyin H).
15. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
16. `implementation-status-uiux.md` ga B-10 statusi yoz.
17. Global report formatida qaytar.
18. Stop condition: :has() yoki aria-invalid qo'llanilmasa.
19. Done condition: form base token'li, error state to'liq, :has() bilan.
20. B-11 uchun: header/nav — tayyor.
21. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
22. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
23. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
24. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
```

---

## B-11 — Header/nav base (sticky, 5-7 item, mobile hybrid)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `@layer components` da header/nav base:
   - `.site-header`: sticky top, `backdrop-filter: blur(12px)` (18px → 12px, perf), `border-bottom: 1px solid var(--color-border)`, bg `var(--color-surface)` semi.
   - `.site-nav`: 5-7 item max (NN/g); label qisqa (1-2 so'z); desktop'da inline.
   - `.nav-logo`: `font-family: var(--font-display); color: var(--color-text);` (gradient YO'Q).
   - `.nav-cta`: bitta primary btn (`.btn-sm`).
   - Theme toggle: header'da (top-right), `.icon-btn` (44px, aria-label).
03. Mobile: hybrid (research_ui_top_sites_deep / logoswebdesigns): 3-4 kritik item ko'rinadi (logo, login/CTA, theme) + hamburger secondary; hamburger menu: full-screen panel, keyboard, Esc yopish, focus trap.
04. `views/user/panel.ejs` navbar'ini base'ga bog'lash (Righteous/nav-logo gradient tozalangan — A-01).
05. `views/partials/head.ejs` da hech qanday nav — har sahifa o'z header'i (landing minimal, panel left-nav keyin E/F).
06. Landing header: minimal — logo + [Kirish] + [Bepul boshlash] (nav item kam — unbounce).
07. Sticky header balandligi rezerv (CLS yo'q): `--header-h: 60px`.
08. Security/data guard: nav'da auth'ga bog'liq linklar rolga qarab (render server-side; frontend'da yashirish emas).
09. Unit test: header base class'lar (regex); 5-7 item qoidasi test (index'da nav soni).
10. Integration/contract test: mobil 375px'da hamburger ishlaydi (Playwright).
11. E2E/security test: keyboard nav, focus trap, Esc; sticky CLS 0.
12. GREP-CHECK: `grep -rn "backdrop-filter: blur(18px)" views/` = 0.
13. A11y: skip-link (B-12), nav landmark, aria-current.
14. i18n: nav label'lar (keyin H).
15. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
16. `implementation-status-uiux.md` ga B-11 statusi yoz.
17. Global report formatida qaytar.
18. Stop condition: hamburger keyboard'da ishlamasa.
19. Done condition: header/nav base, sticky, hybrid mobile.
20. B-12 uchun: a11y base — tayyor.
21. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
22. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
23. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
24. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
25. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
```

---

## B-12 — A11y base (focus, contrast, keyboard, skip-link)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `@layer base` da global a11y:
   - `skip-link`: `.skip-link` — birinchi focus element, "Asosiy tarkibga o'tish", target `#main`.
   - `:focus-visible` global (B-09 da qo'yilgan — tekshir).
   - `html { scroll-behavior: smooth; }` — reduce'da off (A-03 qoidasi).
   - `::selection` contrast.
03. Kontrast tokenlar (B-03): text/muted/action — WCAG AA; `contrast-color()` (agar qo'llab-quvvatlansa) btn matni uchun.
04. Semantic HTML: header/nav/main/footer/section/heading ketma-ketligi; `lang` to'g'ri.
05. `aria` qoidalari: nav `aria-label`, current page `aria-current="page"`, error `aria-live`, modal focus trap, toggle `aria-pressed`.
06. `role="alert"` xato banner'lar uchun; `aria-describedby` helper.
07. Screen reader: hamma interaktiv label'ga ega (icon-only → aria-label).
08. Keyboard: barcha flow'lar (login, register, menu, modal) keyboard'da to'liq; no keyboard trap (modal bundan tashqari).
09. Range: barcha muhim sahifalarda axe 0 critical (landing, login, register, panel).
10. Security/data guard: no behavior o'zgarmaydi (faqat markup/aria).
11. Unit test: skip-link mavjud (regex); aria-labelledby.
12. Integration/contract test: keyboard flow Playwright (Tab order, focus visible).
13. E2E/security test: axe 0 critical barcha muhim sahifada; screen reader spot-check (NVDA/VoiceOver).
14. GREP-CHECK: `grep -rn "class=\"skip-link\"" views/` ≥ 1 (har sahifa partial orqali).
15. A11y: WCAG 2.2 AA base — asosiy qismlar.
16. i18n: skip-link matni 4 til (keyin).
17. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
18. `implementation-status-uiux.md` ga B-12 statusi yoz.
19. Global report formatida qaytar.
20. Stop condition: axe critical yoki keyboard trap bo'lsa.
21. Done condition: a11y base, axe 0, keyboard to'liq.
22. B-13 (checkpoint) uchun: tayyor ekanini dalil bilan yoz.
23. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
24. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
25. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
26. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
```

---

## B-13 — FOUNDATION checkpoint sign-off

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. B-faza qabul testlari (barchasi bajarilishi kerak):
   - `tokens.json` (DTCG $value/$type) + `npm run build:tokens` ishlaydi → tokens.css.
   - `@layer reset, tokens, base, components, utilities` style.css da.
   - OKLCH: light canvas oklch(97.58%...), dark oklch(16.00%...) — bir xil hue 262-264.
   - Theme: Light/Dark/System; FOUC-free; default light; `theme-floating` yo'q.
   - Theme switch ≤500ms; reduced-motion instant; --ease-bounce/elastic yo'q.
   - Tipografiya: Manrope/Inter, fluid clamp, 4-til glyph, hardcode font-family yo'q.
   - Spacing 8px scale; container queries; subgrid.
   - Motion token'lar; `transition: all` yo'q; infinite faqat loading.
   - Base komponentlar: .btn/.inp/.card token'li; gradient btn yo'q; 44px.
   - Form: label top, error inline, :has(), aria-invalid.
   - Header: sticky, 5-7 nav, mobile hybrid, theme toggle header'da.
   - A11y: skip-link, focus-visible, axe 0 muhim sahifalarda.
03. Full regression: `npm run typecheck` + `npm test` — natijalar.
04. GREP-CHECK jadvali (B bo'yicha) — hammasi 0/kerakli natija.
05. Visual tekshiruv: landing, login, panel — light/dark professional (screenshot).
06. Sign-off: operator checklist imzolaydi (B-faza yopiladi).
07. Security/data guard: critical yashirilmaydi.
08. Har yangi write path uchun tenant scope, authorization, validation tekshir.
09. Unit test: full B (yangi testlar).
10. Integration/contract test: foundation journey.
11. E2E/security test: full B E2E + axe.
12. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
13. `implementation-status-uiux.md` ga B-13 (CHECKPOINT) statusi, dalillar, sign-off yoz.
14. Global report formatida qaytar.
15. Stop condition: birorta qabul testi fail bo'lsa.
16. Done condition: Foundation to'liq, sign-off imzolangan.
17. Qolgan ishlar ro'yxati: C (Landing), D (Auth UI), E (User), F (Teacher), G (Cast), H (Admin/QA) — ko'chirilganini yoz.
18. Butun FAZA B yakunlandi — C-00 preflight'ga tayyor.
```

