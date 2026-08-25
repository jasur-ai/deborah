# Edikit Evidence-Led Institutional Design — yakuniy implementation master plan

> **Maqsad:** `style.md`dagi 325-source researchni production UI’ga xatosiz ko‘chirish  
> **Repository:** `https://github.com/jasur-ai/edikit.git`  
> **Base commit:** `5447052` — `huh major ones`  
> **Status:** faqat implementation jarayoni; application source code ushbu hujjatda o‘zgartirilmagan  
> **Final design authority:** `style.md`, ayniqsa 36–46-bo‘limlar  
> **Bajarish tartibi:** STEP 01 dan STEP 41 gacha ketma-ket; gate o‘tmasdan keyingi release productionga chiqmaydi

---

## Hujjatdan foydalanish qoidasi

Har `STEP` ichida kamida 12 ta aniq bajarish yo‘riqnomasi mavjud. Har yo‘riqnoma alohida commit/task sifatida yopilishi mumkin. `Tugallanish sharti` bajarilmaguncha step completed qilinmaydi.

Release bosqichlari:

```text
F0 — build va audit foundation
F1 — tokens, theme, typography, motion
F2 — reusable components
F3 — landing va authentication
F4 — teacher workspace va test builder
F5 — Cast Director / Projector / Participant
F6 — admin, content, accessibility, performance
F7 — user research, rollout va final launch
```

Branch tavsiyasi:

```text
design/f0-foundation
design/f1-tokens
design/f2-components
design/f3-landing-auth
design/f4-workspace-builder
design/f5-cast
design/f6-quality
design/f7-launch
```

---

## F0 — Buildni barqaror qilish va o‘lchov bazasi

### STEP 01 — Repository baseline, backup va scope lock

#### Natija

Fresh clone holati, current UI metrics, test natijalari va design scope qayta tiklanadigan baseline sifatida saqlanadi.

#### Asosiy fayllar

```text
style.md
package.json
package-lock.json
public/css/style.css
public/css/admin.css
public/js/theme.js
views/**/*.ejs
scripts/
```

#### Batafsil yo‘riqnoma

- [ ] **S01.01** `git rev-parse HEAD`, `git status --short`, Node va npm versiyalarini `design-audit/baseline.md`ga yozing; audited commit `5447052` ekanini va local o‘zgarishlarni aniq ko‘rsating.
- [ ] **S01.02** `npm ci` bilan clean dependency install bajaring; install warning va vulnerability summary’ni baselinega yozing, lekin bu stepda dependency versiyalarini o‘zgartirmang.
- [ ] **S01.03** `npm test`ni ishga tushirib stdout/stderr’ni `design-audit/test-before.txt`ga saqlang; failure soni va qaysi route/view sabab bo‘lganini alohida jadval qiling.
- [ ] **S01.04** `public`, `views`, `routes`, `scripts` bo‘yicha file inventory yarating; har UI faylning line count, inline `<style>`, inline `style=`, `<script>` va `!important` sonini hisoblang.
- [ ] **S01.05** raw hex, rgb/rgba, `transition: all`, infinite animation, tiny font va fixed-height text containerlar uchun baseline scanner ishga tushiring; natijani machine-readable JSON va Markdown qilib saqlang.
- [ ] **S01.06** `style.md`dagi final authority qoidasini team README yoki implementation plan boshiga link qiling; oldingi rang draftlariga nisbatan 36–46-bo‘limlar ustunligini qayd eting.
- [ ] **S01.07** UI redesign scope’ni landing, auth, workspace, builder, Cast, admin, error/PWA deb lock qiling; backend functional redesignni alohida scope sifatida belgilang.
- [ ] **S01.08** Har release uchun alohida feature flag strategiyasini yozing: `DESIGN_V4_TOKENS`, `DESIGN_V4_LANDING`, `DESIGN_V4_CAST`, `DESIGN_V4_ADMIN`.
- [ ] **S01.09** Existing data va seed fayllar testlar tomonidan o‘zgarishi mumkinligini qayd eting; browser/test ishga tushgandan keyin `data/db.json`ni avtomatik restore qilish helper script yarating.
- [ ] **S01.10** Screenshot va audit artifactlari Gitga kiritiladimi yoki CI artifact bo‘ladimi, aniq belgilang; temporary browser filesni `.gitignore`ga qo‘shing.
- [ ] **S01.11** Har bosqich uchun rollback nuqtasini belgilang; token alias compatibility olib tashlanmaguncha oldingi viewlar ishlashini talab qiling.
- [ ] **S01.12** Scope lock review o‘tkazing: product, frontend, accessibility va teacher representative kim approval berishini `OWNERS.md` yoki audit hujjatida belgilang.

#### Tekshiruv

```text
Baseline commit/hash mavjud
Before-test log mavjud
UI metric JSON mavjud
Scope va feature flags yozilgan
Working tree’da tasodifiy data o‘zgarishi yo‘q
```

#### Tugallanish sharti

Baseline’ni boshqa mashinada qayta yaratish mumkin va keyingi vizual farqlar aniq o‘lchanadi.

---

### STEP 02 — EJS render blockerlarini yopish va all-view compile gate

#### Natija

Teacher panel va admin dashboard HTTP 500 bermaydi; barcha EJS viewlar CI’da compile qilinadi.

#### Asosiy fayllar

```text
views/user/panel.ejs
views/admin/dashboard.ejs
scripts/debug-ejs.js
scripts/test-views.js
package.json
```

#### Batafsil yo‘riqnoma

- [ ] **S02.01** `views/user/panel.ejs:222`dagi `icon(.moon., 16)` expressionini `icon('moon', 16)`ga almashtiring; faqat syntax fix qiling, redesignni bu commitga aralashtirmang.
- [ ] **S02.02** `views/admin/dashboard.ejs:16`dagi ayni syntax xatoni xuddi shu formatda tuzating; rendered icon registry’da `moon` mavjudligini tekshiring.
- [ ] **S02.03** `find views -name '*.ejs'` natijasidagi har viewni `ejs.compile()` orqali compile qiladigan `scripts/test-views.js` yarating.
- [ ] **S02.04** Include pathlari to‘g‘ri resolve bo‘lishi uchun compilerga `filename` va minimal locals fixture bering; syntax error qaysi fayl/qator ekanini aniq chiqaring.
- [ ] **S02.05** Dynamic local talab qiladigan viewlar uchun fixture registry yarating: landing, login, panel, builder, host, enter, admin, error.
- [ ] **S02.06** `npm run test:views` scriptini qo‘shing va asosiy `npm test`dan oldin ishga tushiring; compile failure’da process exit code `1` bo‘lsin.
- [ ] **S02.07** HTTP smoke scriptda `/`, `/play`, `/user/login`, authenticated `/user/panel`, `/admin/dashboard`, `/error-test` route holatlarini tekshiring.
- [ ] **S02.08** Authenticated smoke uchun seed credentialni test-only fixture orqali oling; production credentialni hardcode qilmang.
- [ ] **S02.09** Panel va dashboard response body’da expected heading/landmark mavjudligini tekshiring; faqat status 200 bilan cheklanib qolmang.
- [ ] **S02.10** EJS syntax lintga optional chaining/template literal false-positive bermaydigan konfiguratsiya tanlang; actual compile natijasini authoritative gate qiling.
- [ ] **S02.11** `npm test`dan keyin `data/db.json` o‘zgarsa restore qiling; test suite working tree’ni dirty qoldirmasin.
- [ ] **S02.12** Fixdan keyin dark/light authenticated screenshotsni baseline sifatida qayta oling; 500 error screenshotlarini `before` artifact sifatida saqlang.

#### Tekshiruv

```bash
npm run test:views
npm test
git status --short
```

#### Tugallanish sharti

Barcha EJS compile bo‘ladi, `/user/panel` va `/admin/dashboard` authenticated holda 200 qaytaradi, testlar data faylini o‘zgartirmaydi.

---

### STEP 03 — Visual audit automation va screenshot matrix

#### Natija

Har theme, viewport va state uchun takrorlanuvchi screenshot/audit harness yaratiladi.

#### Asosiy fayllar

```text
playwright.config.js
tests/visual/*.spec.js
scripts/design-audit.js
design-audit/fixtures.json
package.json
```

#### Batafsil yo‘riqnoma

- [ ] **S03.01** Playwright configda desktop 1440×900, small desktop 1280×800, tablet 768×1024, mobile 390×844 va 320×568 projectlar yarating.
- [ ] **S03.02** Projector uchun 1920×1080, 1280×720 va 1024×768 screenshot projectlarini alohida qo‘shing.
- [ ] **S03.03** Har route uchun deterministic seed fixture va stable clock yarating; relative date, random player, animation frame vizual diffni buzmasin.
- [ ] **S03.04** Light, dark, high-contrast-light, high-contrast-dark va reduced-motion contextlarini localStorage/media emulation orqali test qiling.
- [ ] **S03.05** Rest, hover, focus-visible, active, selected, loading, empty, error va long-text fixturelarini component/page testlarga qo‘shing.
- [ ] **S03.06** Fonts ready bo‘lishini `document.fonts.ready` bilan kuting; screenshot oldidan transition/animationni test policy bo‘yicha freeze qiling.
- [ ] **S03.07** Dynamic Socket sahifalarda fake deterministic events yoki test namespace ishlating; real network timing screenshotga ta’sir qilmasin.
- [ ] **S03.08** Screenshot nomlashni `{page}--{state}--{theme}--{viewport}.png` formatida standartlashtiring.
- [ ] **S03.09** Pixel diff thresholdni sahifa bo‘yicha belgilang; anti-aliasing uchun kichik tolerance, layout/color o‘zgarishlari uchun qat’iy gate ishlating.
- [ ] **S03.10** Failed diffda actual, expected va diff artifactlarini CI’dan yuklab olish imkonini yarating.
- [ ] **S03.11** Screenshot update faqat explicit `npm run test:visual:update` bilan amalga oshsin; ordinary test baseline’ni yozib yubormasin.
- [ ] **S03.12** Visual matrix coverage report yarating; har critical page barcha required theme/viewport/state kombinatsiyasiga ega ekanini tekshiring.

#### Tekshiruv

```text
Critical routes screenshot qilinadi
Theme/viewport nomlari deterministic
Font va animation flake yo‘q
CI diff artifact beradi
Baseline update explicit
```

#### Tugallanish sharti

Design o‘zgarishi bir command bilan barcha critical sahifalarda vizual tekshiriladi.

---

## F1 — Token, identity va foundation

### STEP 04 — DTCG token source-of-truth arxitekturasi

#### Natija

Primitive, semantic va component tokenlar bitta standart manbadan CSS’ga generatsiya qilinadi.

#### Asosiy fayllar

```text
public/design/tokens/*.tokens.json
public/design/generated/*.css
scripts/build-design-tokens.js
scripts/validate-design-tokens.js
package.json
```

#### Batafsil yo‘riqnoma

- [ ] **S04.01** `public/design/tokens` katalogini primitive, semantic light/dark/high-contrast, typography, spacing, radius, elevation, motion va data-viz fayllariga ajrating.
- [ ] **S04.02** Har tokenni DTCG `$type`, `$value`, `$description` formatida yozing; appearance nomlari primitive, intent nomlari semantic qatlamda bo‘lsin.
- [ ] **S04.03** Primitive tokenni component CSS’da to‘g‘ridan-to‘g‘ri ishlatishni taqiqlang; semantic alias orqali resolve qiling.
- [ ] **S04.04** `color.action.primary`, `color.surface.default`, `color.text.muted`, `motion.modal.enter` kabi intent-based naming convention yarating.
- [ ] **S04.05** Theme fayllarida bir xil semantic pathlar mavjudligini validator bilan tekshiring; light’da bor token dark’da yo‘q qolmasin.
- [ ] **S04.06** Alias cycle, unresolved reference, duplicate token va invalid color-space qiymatini build failure qiling.
- [ ] **S04.07** Generated CSS’ni deterministic tartibda yozing; generated file qo‘lda tahrir qilinmasligini banner comment bilan belgilang.
- [ ] **S04.08** Existing `--bg`, `--card`, `--text`, `--muted`, `--accent` uchun vaqtinchalik backward aliaslar yarating va deprecation comment qo‘shing.
- [ ] **S04.09** Token builddan keyin CSS, JSON flat map va contrast-test fixture generatsiya qiling.
- [ ] **S04.10** `npm run design:tokens:build` va `design:tokens:check` scriptlarini yarating; CI generated diffni tekshirsin.
- [ ] **S04.11** Token owner va change policy yozing: primitive/design owner, semantic/design-system owner, component/component owner.
- [ ] **S04.12** `style.md`dagi final Edikit Cobalt/Signal/Insight qiymatlarini source tokenlarda reference qiling; oldingi draft action blue’larini final brand aliasga map qiling.

#### Tekshiruv

```text
DTCG schema valid
Alias cycle 0
Theme path mismatch 0
Generated CSS deterministic
Legacy alias mavjud, yangi code semantic token ishlatadi
```

#### Tugallanish sharti

Bitta token source light/dark/high-contrast CSS’ni generatsiya qiladi va component raw rangga muhtoj emas.

---

### STEP 05 — Evidence-Led Institutional brand assetlari

#### Natija

Edikit generic blue SaaS’dan ajraladigan, official va takrorlanadigan visual assetlarga ega bo‘ladi.

#### Asosiy fayllar

```text
public/images/brand/evidence-mark.svg
public/images/brand/wordmark-*.svg
public/design/brand.css
docs/brand-assets.md
views/partials/*.ejs
```

#### Batafsil yo‘riqnoma

- [ ] **S05.01** Evidence Mark uchun vertical rail, uch evidence tick va bitta signal node’dan iborat optical grid yarating; 16, 24, 32 va 64pxda tanilishini test qiling.
- [ ] **S05.02** Markni monochrome, cobalt, inverse va high-contrast variantlarda chizing; gradient logo default bo‘lmasin.
- [ ] **S05.03** Wordmarkni Manrope/approved custom lettering bilan qayta ko‘rib chiqing; current image whitespace va optical alignmentni tozalang.
- [ ] **S05.04** Logo lockup uchun horizontal, compact va mark-only variantlar, minimum size va clear-space qoidalarini yozing.
- [ ] **S05.05** Signal Rail’ni 3px semantic component primitive sifatida yarating; current, live, attention va error meaninglarini rang+marker bilan belgilang.
- [ ] **S05.06** Response Mosaic’ni 5×5 responsive cell pattern sifatida yarating; static, live-demo va reduced-motion variantlarini belgilang.
- [ ] **S05.07** Three-view product composition uchun Director, Projector va Participant frame order, angle, shadow va label grammarini lock qiling.
- [ ] **S05.08** `Ask → See → Adapt` / `So‘ra → Ko‘r → Moslashtir` verbal assetini landing, docs va presentationsda bir xil yozish qoidasi bilan belgilang.
- [ ] **S05.09** Evidence Gradientni faqat approved marketing/illustration contextiga cheklang; product primary buttonni solid cobalt qoldiring.
- [ ] **S05.10** Shield, lightning, trophy, random particles va borrowed cartoon assetlarni default brand identitydan olib tashlash migration ro‘yxatini tuzing.
- [ ] **S05.11** Har brand assetga `aria-hidden` yoki meaningful alt policy yozing; logo alt har doim “Edikit” bo‘lsin.
- [ ] **S05.12** Name/logo olib tashlangan blind-recognition prototype tayyorlang; Evidence Mark, Signal Rail va Response Mosaic alohida tanilish testiga tayyor bo‘lsin.

#### Tekshiruv

```text
16px favicon legible
Monochrome and forced-color usable
Asset usage documented
Borrowed/cartoon identity default emas
Blind recognition prototype mavjud
```

#### Tugallanish sharti

Edikit identity faqat ko‘k rangga emas, owned shape va composition assetlariga tayanadi.

---

### STEP 06 — Final rang, contrast va CVD pipeline

#### Natija

Light/dark/high-contrast ranglar production contrast, alpha compositing va color-vision testlardan o‘tadi.

#### Asosiy fayllar

```text
public/design/tokens/primitives.tokens.json
public/design/tokens/semantic.*.tokens.json
scripts/check-contrast.js
scripts/check-cvd.js
tests/design/color.test.js
```

#### Batafsil yo‘riqnoma

- [ ] **S06.01** Final brand palette’ni kiriting: Cobalt `#1746D1`, dark action `#7AA8FF`, Signal `#007C91/#52D0D8`, Insight `#9B5E00/#F2B84B`, Ink `#0C1426`, Paper `#F6F8FC`.
- [ ] **S06.02** Har brand rang uchun OKLCH master va sRGB fallback saqlang; browser support bo‘lmasa fallback bir xil semantic rolni bersin.
- [ ] **S06.03** Light canvas/surface/sunken va dark canvas/surface/raised neutral scale’larini semantic tokenlarga ulang.
- [ ] **S06.04** Normal text pairlarini ≥4.5:1, large text va meaningful graphical/control pairlarini ≥3:1 avtomatik tekshiring.
- [ ] **S06.05** Teacher/projector primary text uchun imkon qadar ≥7:1 target qo‘ying; normative fail/pass WCAG 2.2 formula bilan qiling.
- [ ] **S06.06** Alpha tokenlarning real composited rangini canvas, surface va raised surface ustida hisoblang; raw rgba qiymatni mustaqil contrast deb qabul qilmang.
- [ ] **S06.07** Gradient ustidagi text uchun eng yomon stop/pixel regionni test qiling; kerak bo‘lsa solid scrim token ishlating.
- [ ] **S06.08** Protanopia, deuteranopia, tritanopia va grayscale screenshot testlarini chart, answer option, status va focus state’larda bajaring.
- [ ] **S06.09** Statuslarni color+icon+text, answerlarni color+shape+letter bilan redundantly encode qiling.
- [ ] **S06.10** High-contrast theme’da muted textni kuchaytiring, bordersni 3:1ga olib chiqing va shadow dependency’ni olib tashlang.
- [ ] **S06.11** Forced-colors mode’da ButtonText, CanvasText, Highlight va HighlightText system colorsga map qiling; `forced-color-adjust:none` istisnolarini allowlist qiling.
- [ ] **S06.12** CI contrast reportda token pair, ratio, theme va component usage’ni chiqaring; thresholdga juda yaqin pair uchun 0.2–0.5 buffer talab qiling.

#### Tekshiruv

```text
Light/dark semantic pair pass 100%
CVD screenshot meaning saqlaydi
Gradient text pass
Forced colors usable
Raw rgba contrast assumption yo‘q
```

#### Tugallanish sharti

Rang tizimi official, yaqqol va barcha theme/accessibility variantlarda o‘qiladigan bo‘ladi.

---

### STEP 07 — Theme engine: system, light, dark va high contrast

#### Natija

Bitta source-of-truth theme engine FOUC’siz va 900ms universal transition’siz ishlaydi.

#### Asosiy fayllar

```text
views/partials/head.ejs
public/js/theme.js
public/design/generated/tokens.*.css
public/design/foundations/theme.css
```

#### Batafsil yo‘riqnoma

- [ ] **S07.01** Theme state’ni `system|light|dark|hc-light|hc-dark` qilib belgilang; resolved qiymatni `data-resolved-theme`ga yozing.
- [ ] **S07.02** Head ichidagi tiny synchronous script local preference va `prefers-color-scheme`ni first paintdan oldin resolve qilsin.
- [ ] **S07.03** `body.theme-light`, `body.light` va duplicate selectorlarni migration jadvali bo‘yicha bitta HTML attribute modeliga o‘tkazing.
- [ ] **S07.04** `color-scheme: light|dark`ni resolved theme bilan native form controlsga qo‘llang.
- [ ] **S07.05** `meta-theme-color`ni real canvas token bilan sinxron qiling; current `#DEE1ED` va actual canvas mismatchni yo‘qoting.
- [ ] **S07.06** `[data-theme-transition] *` universal 900ms transitionni olib tashlang; faqat root canvas/text uchun 120–180ms optional crossfade ishlating.
- [ ] **S07.07** Reduced motion’da theme switch instant bo‘lsin; View Transition API ishlatilsa root crossfade 180msdan oshmasin.
- [ ] **S07.08** System preference runtime’da o‘zgarsa faqat user explicit override qilmaganida theme update qiling.
- [ ] **S07.09** Theme controlni icon-only ambiguous button emas, accessible `System / Light / Dark` menu/segmented control sifatida yarating.
- [ ] **S07.10** Projector theme’ni OS preference’dan ajrating; Classroom Light/Dark/High Contrast session setting sifatida saqlang.
- [ ] **S07.11** Print stylesheetda official light tokens va hidden interactive controls ishlating.
- [ ] **S07.12** Theme boot, toggle, refresh, system change, reduced motion va no-localStorage holatlari uchun unit/E2E test yozing.

#### Tekshiruv

```text
First-paint flash yo‘q
One theme attribute model
900ms universal transition yo‘q
System preference ishlaydi
Projector theme mustaqil
```

#### Tugallanish sharti

Theme har sahifada bir xil ishlaydi va light mode xira gray haze qaytarmaydi.

---

### STEP 08 — Typography, font loading va glyph QA

#### Natija

Official, mature va recognizable typography Source Sans 3 + Manrope + IBM Plex Mono bilan ishlaydi.

#### Asosiy fayllar

```text
public/fonts/*.woff2
public/design/tokens/typography.tokens.json
public/design/foundations/typography.css
views/partials/head.ejs
```

#### Batafsil yo‘riqnoma

- [ ] **S08.01** Source Sans 3 Variable’ni UI/body, Manrope Variable’ni marketing/display va IBM Plex Mono’ni code/timer/numeric context uchun license bilan self-host qiling.
- [ ] **S08.02** Latin Extended va Cyrillic subsetlarida O‘/G‘ apostrophe variantlari, Uzbek Cyrillic va Russian glyphlar mavjudligini test qiling.
- [ ] **S08.03** WOFF2 fayllar uchun `font-display: swap` qo‘llang; decorative display fontda `optional` variantni performance test bilan solishtiring.
- [ ] **S08.04** Fallback metric shiftni kamaytirish uchun `size-adjust`, `ascent-override`, `descent-override` va `line-gap-override` qiymatlarini o‘lchang.
- [ ] **S08.05** Faqat critical UI normal variable fontni preload qiling; barcha weights/fontlarni preload qilmang.
- [ ] **S08.06** Semantic type rolesni tokenlashtiring: hero, page title, section title, card title, body, body large, label, metadata, badge, projector question/option.
- [ ] **S08.07** Body defaultni 16px/1.55+, metadata’ni 14pxdan past bo‘lmagan qilib belgilang; current `.58–.76rem` operational labelsni migratsiya qiling.
- [ ] **S08.08** Weight discipline’ni 400/500/600/700 qilib qo‘llang; 800 faqat rare display, 900 faqat logo artwork bo‘lsin.
- [ ] **S08.09** Timer, join code, score va table numbersga `tabular-nums lining-nums` qo‘llang.
- [ ] **S08.10** Body copy’ni 50–75ch, form hint/errorni readable line length, projector textni distance-based minimum bilan cheklang.
- [ ] **S08.11** 200% zoom, text-spacing override va font-load failure’da clipping/overlap yo‘qligini screenshot test qiling.
- [ ] **S08.12** Current Righteous usage inventory tuzing; logo artworkdan tashqari question, leaderboard va app headersni mature type rolesga ko‘chiring.

#### Tekshiruv

```text
Font files self-hosted
Cyrillic/Uzbek glyph pass
Body 16px, metadata 14px+
CLS font shift targetdan past
Righteous operational UI’da yo‘q
```

#### Tugallanish sharti

Typography professional, o‘qiladigan, locale-safe va network failure’da ham barqaror bo‘ladi.

### STEP 09 — Spacing, grid, radius va elevation foundation

#### Natija

Barcha sahifalarda bir xil 4px spacing, content-driven grid va mature shape grammar ishlaydi.

#### Asosiy fayllar

```text
public/design/tokens/spacing.tokens.json
public/design/tokens/radius.tokens.json
public/design/tokens/elevation.tokens.json
public/design/foundations/layout.css
```

#### Batafsil yo‘riqnoma

- [ ] **S09.01** Primitive spacing scale’ni `0,4,8,12,16,20,24,32,40,48,64,80,96` qilib yarating; current 2px intervaldagi ortiqcha tokenlarni semantic aliasesga qisqartiring.
- [ ] **S09.02** Landing 1200px, workspace 1280–1440px, reading 65ch, auth 420–460px va Setup Studio 880–960px container tokenlarini yarating.
- [ ] **S09.03** Desktop 12-column/24px gutter, tablet 8-column/20px, mobile 4-column/16px grid primitive’larini yozing.
- [ ] **S09.04** Radius grammatikasini lock qiling: control 8px, card 12px, modal/hero 16px, pill faqat status/chip.
- [ ] **S09.05** Teacher/admin layoutda angular structure va 8–12px radius, participantda 12–16px comfort radius qo‘llang; 22–32px bubble cardsni olib tashlang.
- [ ] **S09.06** Elevationni canvas, surface, sticky/dropdown, modal va toast qatlamlariga ajrating; z-index tokenlari bilan moslang.
- [ ] **S09.07** Light theme’da subtle border + limited shadow, dark theme’da surface luminance + border first strategiyasini qo‘llang.
- [ ] **S09.08** Nested radius parentdan 4px kichik bo‘lishi va nested card ichida ortiqcha card ishlatilmasligi qoidalarini linter/reviewga qo‘shing.
- [ ] **S09.09** Default comfortable va optional compact density tokenlarini yarating; compact mode faqat teacher/admin’da ishlasin.
- [ ] **S09.10** Common-region spacing yetarli bo‘lgan joyda divider/borderlarni olib tashlang; har sectionni box ichiga solmang.
- [ ] **S09.11** 320px, 600–900px foldable/tablet va 1920px+ ultra-wide layoutlarda container va gaplarni test qiling.
- [ ] **S09.12** Inline hard-coded padding/radius/shadow inventoryni semantic tokenlarga migration ro‘yxati bilan bog‘lang.

#### Tekshiruv

```text
4px primitive scale
Radius grammar consistent
Nested card clutter yo‘q
Desktop/mobile grid pass
Compact mode scoped
```

#### Tugallanish sharti

Layout white-space bilan guruhlanadi, lekin haddan tashqari bo‘sh yoki card-heavy ko‘rinmaydi.

---

### STEP 10 — Semantic motion va reduced-motion foundation

#### Natija

`transition: all` va default infinite animationlar o‘rniga purpose-based, interruptible motion ishlaydi.

#### Asosiy fayllar

```text
public/design/tokens/motion.tokens.json
public/design/foundations/motion.css
public/js/motion.js
public/css/style.css
views/**/*.ejs
```

#### Batafsil yo‘riqnoma

- [ ] **S10.01** Duration tokenlarini 0, 80, 120, 160, 220, 320, 500 va 800ms qilib yarating; usage intentni feedback, hover, popup, modal, page va milestone deb nomlang.
- [ ] **S10.02** Easing tokenlarini standard, enter, exit va emphasisga ajrating; bounce/elastic productive UI’dan chiqarilsin.
- [ ] **S10.03** Existing 62 ta `transition: all` usage’ni property-specific transitionga almashtirish inventory tuzing.
- [ ] **S10.04** Existing 23 infinite animationni loading, functional yoki decorative deb tasniflang; decorative ambient looplarni default olib tashlang.
- [ ] **S10.05** Hover/pressni 80–120ms, popupni 120–160ms, modalni 200–220ms, page/phase transitionni 240–320ms bilan cheklang.
- [ ] **S10.06** Exit durationni enterning 65–80%iga belgilang; dismissed element next actionni kutdirmasin.
- [ ] **S10.07** Interactive transition current computed state’dan yangi state’ga o‘tsin; repeated click animation queue yaratmasin.
- [ ] **S10.08** Transform va opacity’ni primary motion property qiling; width, height, margin, top/left va large box-shadow animatsiyasini taqiqlang.
- [ ] **S10.09** `prefers-reduced-motion: reduce`da decorative motionni olib tashlang, functional state’ni static equivalent bilan ko‘rsating.
- [ ] **S10.10** `@starting-style`, `transition-behavior` va View Transitions’ni progressive enhancement sifatida `@supports` bilan qo‘llang.
- [ ] **S10.11** Keyboard-triggered frequent actionsga decorative transform bermang; focus ring instant va barqaror bo‘lsin.
- [ ] **S10.12** Low-end Android va DevTools Long Animation Frames bilan modal, theme, Cast phase va landing demo motionini profil qiling.

#### Tekshiruv

```text
transition: all = 0
Default decorative infinite animation = 0
Reduced motion task parity
No layout animation
Frequent action ≤160ms
```

#### Tugallanish sharti

Motion interface’ni tezroq va tushunarli his qildiradi, keyingi taskni to‘smaydi.

---

## F2 — Reusable component system

### STEP 11 — Reset, base, focus va utility foundation

#### Natija

Global CSS page-specific legacy qoidalarsiz predictable base va accessibility foundation beradi.

#### Asosiy fayllar

```text
public/design/foundations/reset.css
public/design/foundations/base.css
public/design/foundations/focus.css
public/design/foundations/utilities.css
public/css/style.css
```

#### Batafsil yo‘riqnoma

- [ ] **S11.01** Box sizing, media max-width, button/input font inheritance va body margin resetini minimal foundation fayliga ko‘chiring.
- [ ] **S11.02** Body background/textni semantic tokensga ulang; fixed radial ambient overlay’ni global body’dan olib tashlang.
- [ ] **S11.03** Link default/hover/focus/visited qoidalarini content va app contextga ajrating; color-only link bo‘lmasin.
- [ ] **S11.04** `:focus-visible` uchun 3px focus token va 3px offset qo‘llang; sticky header ostida focus obscured bo‘lmasin.
- [ ] **S11.05** Forced-colors focus, selection va control boundary overridesini foundationga qo‘shing.
- [ ] **S11.06** `.sr-only`, skip-link, scroll-margin va landmark utilities yarating.
- [ ] **S11.07** Scrollbar customizationni minimal qiling; Firefox va forced-colors fallbackni saqlang.
- [ ] **S11.08** Utility classlarni spacing/layout tokenlari bilan cheklang; visual component stylingni utility orqali tarqatmang.
- [ ] **S11.09** Global `table`, `button`, `input` selectorlari page-specific componentni tasodifan o‘zgartirmasligini scope qiling.
- [ ] **S11.10** Cascade layers yarating: `reset`, `tokens`, `foundations`, `components`, `contexts`, `utilities`, `overrides`.
- [ ] **S11.11** `!important` usage’ni reduced-motion/forced-colors kabi documented istisno allowlistiga tushiring.
- [ ] **S11.12** Existing `public/css/style.css`ni compatibility entrypoint qiling va yangi layer fayllarni import qiling; bir martada barcha legacy qoidani o‘chirmang.

#### Tekshiruv

```text
Focus barcha control’da ko‘rinadi
Global ambient overlay yo‘q
Cascade order documented
Forced colors pass
Legacy pages buzilmagan
```

#### Tugallanish sharti

Yangi componentlar predictably render bo‘ladi va global selector driftiga uchramaydi.

---

### STEP 12 — Button, icon button, badge va action hierarchy

#### Natija

Barcha sahifalar bir xil action hierarchy va complete microstate’li buttonlardan foydalanadi.

#### Asosiy fayllar

```text
public/design/components/button.css
public/design/components/icon-button.css
public/design/components/badge.css
views/partials/components/*.ejs
utils/icons.js
```

#### Batafsil yo‘riqnoma

- [ ] **S12.01** Button variantlarini primary, secondary, quiet, danger, link va icon deb belgilang; har variant semantic token ishlatsin.
- [ ] **S12.02** Size’larni 32px dense-only, 40px default, 44px important desktop va 48px mobile/frequent participant qilib yarating.
- [ ] **S12.03** Rest, hover, active, focus-visible, loading, disabled va selected state’larni theme/high-contrast bilan to‘liq chizing.
- [ ] **S12.04** Button loading holatida width/label saqlansin; `Saqlanmoqda…` kabi action text spinner bilan birga qolsin.
- [ ] **S12.05** Har action groupda bitta primary filled button qoldiring; secondary/danger visual weightini pasaytiring.
- [ ] **S12.06** Danger actionni red semantic style va confirmation/undo policy bilan bog‘lang; delete blue bo‘lmasin.
- [ ] **S12.07** Icon-only buttonni 44px hit area, accessible name va tooltip bilan yarating; icon 20–24pxdan katta bo‘lmasin.
- [ ] **S12.08** Toggle icon buttonga `aria-pressed` va selected marker bering; faqat icon rangini o‘zgartirish bilan cheklanmang.
- [ ] **S12.09** Badge variantlarini neutral, info, success, warning, dangerga cheklang; badge text 1–2 so‘z bo‘lsin.
- [ ] **S12.10** Current gradient primary buttonlarni solid Edikit Cobaltga o‘tkazing; gradient faqat approved brand art’da qolsin.
- [ ] **S12.11** Emojili button/iconlarni `utils/icons.js`dagi yagona SVG familyga ko‘chiring; mixed arrows/glyph iconsni yo‘qoting.
- [ ] **S12.12** Button component visual testsini barcha states, themes, long Uzbek labels va 200% zoom bilan yozing.

#### Tekshiruv

```text
One primary per group
Danger semantic
44/48px targets
Loading width stable
Gradient button default emas
```

#### Tugallanish sharti

Action hierarchy sahifadan sahifaga o‘zgarmaydi va user next actionni bir qarashda topadi.

---

### STEP 13 — Input, textarea, select va form validation

#### Natija

Form controls official, readable va visible label/error/hint anatomy bilan ishlaydi.

#### Asosiy fayllar

```text
public/design/components/input.css
public/design/components/select.css
public/design/components/form.css
views/partials/components/form-*.ejs
```

#### Batafsil yo‘riqnoma

- [ ] **S13.01** Form field anatomy’ni label, required/optional, control, hint, error va countga standartlashtiring.
- [ ] **S13.02** Placeholderni label o‘rnida ishlatishni to‘xtating; placeholder faqat format/example bo‘lsin.
- [ ] **S13.03** Desktop controlni 44px, mobile’ni 48px minimum qiling; mobile input font 16pxdan kichik bo‘lmasin.
- [ ] **S13.04** Input boundary kerak bo‘lsa adjacent surfacega ≥3:1 control-border token ishlating; current faint `.04–.10` borderlarni almashtiring.
- [ ] **S13.05** Focus state ring+border bilan layout shift qilmasin; hover va focus vizual jihatdan farqli bo‘lsin.
- [ ] **S13.06** Error state danger border+icon+text bilan, warning amber+text bilan, success faqat zarur holatda ko‘rsatilsin.
- [ ] **S13.07** Read-only va disabled state’ni ajrating; read-only text readable va copyable bo‘lsin.
- [ ] **S13.08** HTML `autocomplete`, `inputmode`, `type`, `maxlength`, `aria-describedby` va server error mappingni to‘g‘ri qo‘llang.
- [ ] **S13.09** Form submit xatosida user inputni saqlang; error summary first invalid fieldga link bersin.
- [ ] **S13.10** Password fieldga show/hide, caps-lock hint va password-manager-compatible markup qo‘shing.
- [ ] **S13.11** Native select simple case’da saqlansin; custom combobox faqat typeahead/complex requirement bo‘lsa APG pattern bilan yaratiladi.
- [ ] **S13.12** Long error, 200% zoom, text-spacing override, keyboard va screen-reader E2E testlarini yozing.

#### Tekshiruv

```text
Visible labels 100%
Control border visible
Error text+icon
Mobile input 16px+
Input server error after failure saqlanadi
```

#### Tugallanish sharti

Formlar professional ko‘rinadi va user xatoni tushunib, ma’lumotni yo‘qotmasdan tuzata oladi.

---

### STEP 14 — Radio, checkbox, switch, selectable card, tabs va accordion

#### Natija

Selection/disclosure patternlari native semantics va complete keyboard behavior bilan ishlaydi.

#### Asosiy fayllar

```text
public/design/components/selection.css
public/design/components/tabs.css
public/design/components/accordion.css
public/js/components/tabs.js
public/js/components/accordion.js
```

#### Batafsil yo‘riqnoma

- [ ] **S14.01** Radio’ni one-of-many, checkbox’ni independent choices, switch’ni immediate on/off setting uchun ishlatish qoidalarini component docsga yozing.
- [ ] **S14.02** Cast mode cardlarini hidden native radio + full-card label + visible check marker bilan yarating.
- [ ] **S14.03** Selected state’ni 2px cobalt border, soft fill va marker bilan ko‘rsating; animated scale ishlatmang.
- [ ] **S14.04** Disabled selectionga inline explanation va `aria-describedby` bering; opacity-only state bo‘lmasin.
- [ ] **S14.05** Checkbox/radio custom marklari forced-colors’da system color bilan ko‘rinsin.
- [ ] **S14.06** Switch update pending bo‘lsa status ko‘rsatsin; server failure’da old statega qaytib, error aytsin.
- [ ] **S14.07** Tabsga `tablist/tab/tabpanel`, arrow-key navigation, Home/End va focus/selection separation qo‘shing.
- [ ] **S14.08** Tab content auto-rotate qilmasin; URL/deep-link kerak bo‘lsa selected tabni encode qiling.
- [ ] **S14.09** Accordion headerni `button` va `aria-expanded/controls` bilan yarating; current `div onclick`larni migratsiya qiling.
- [ ] **S14.10** Accordion motionni grid rows/opacity bilan 180–220ms qiling; reduced motion instant bo‘lsin.
- [ ] **S14.11** Nested interactive linkni selectable card label ichiga joylashtirmang; secondary actionni card tashqarisiga/overflowga o‘tkazing.
- [ ] **S14.12** Selection, tabs va accordionni keyboard, touch, screen reader, high-contrast va long-label fixturelarda test qiling.

#### Tekshiruv

```text
Native semantics
Arrow keyboard tabs
Accordion div-onclick yo‘q
Selected state color-only emas
Reduced-motion parity
```

#### Tugallanish sharti

Selection va disclosure controls familiar, official va assistive technology bilan to‘liq ishlaydi.

---

### STEP 15 — Dialog, popover, menu, tooltip va toast

#### Natija

Overlay va transient feedbacklar focus, motion, content va priority qoidalariga mos bo‘ladi.

#### Asosiy fayllar

```text
public/design/components/dialog.css
public/design/components/popover.css
public/design/components/tooltip.css
public/design/components/toast.css
public/js/components/overlays.js
```

#### Batafsil yo‘riqnoma

- [ ] **S15.01** Native `<dialog>` yoki WAI-ARIA modal pattern asosida reusable dialog shell yarating.
- [ ] **S15.02** Small confirmation, medium form, large Setup Studio va mobile full-screen variantlarini tokenlashtiring.
- [ ] **S15.03** Dialog title, close 44px, body scroll, sticky footer va focus trapni standard qiling.
- [ ] **S15.04** Initial focusni taskga qarab belgilang; destructive confirmationda focus danger actionga avtomatik tushmasin.
- [ ] **S15.05** Escape va overlay click policy’ni dirty/pending/destructive state bo‘yicha aniq boshqaring; close’dan keyin trigger focusini tiklang.
- [ ] **S15.06** Dialog enter 200–220ms, exit 140–160ms; reduced motion instant; background content inert bo‘lsin.
- [ ] **S15.07** Popover/menu arrow navigation, outside click, Escape va trigger expanded state bilan ishlasin.
- [ ] **S15.08** Tooltipni supplemental textga cheklang; interactive/required content uchun popover yoki inline help ishlating.
- [ ] **S15.09** Toastni success/info/warning/errorga ajrating; critical error faqat toastda qolmasin.
- [ ] **S15.10** Toast desktop top-right, mobile bottom safe-area’da ko‘rinsin; max 3 va live-region priority aniq bo‘lsin.
- [ ] **S15.11** Current `main.js`dagi inline CSS/HTML confirm va toast generatorlarini reusable semantic componentsga ko‘chiring.
- [ ] **S15.12** Focus trap, nested-dialog rejection, long content, pending submit, screen reader va reduced motion testlarini yozing.

#### Tekshiruv

```text
Focus trap/restore
No nested modal
Critical info toast-only emas
Motion ≤220ms
Inline visual JS CSS yo‘q
```

#### Tugallanish sharti

Overlaylar predictable, accessible va product bo‘ylab bir xil ko‘rinadi.

---

### STEP 16 — Loading, progress, empty, error va offline states

#### Natija

Har kutish va bo‘sh holat task/durationga mos, truthful va actionable bo‘ladi.

#### Asosiy fayllar

```text
public/design/components/skeleton.css
public/design/components/progress.css
public/design/components/empty-state.css
public/design/components/message.css
views/error.ejs
public/js/main.js
```

#### Batafsil yo‘riqnoma

- [ ] **S16.01** <300ms kutiladigan actionda loader ko‘rsatmaslik; 300ms–2s inline spinner/status, measurable long taskda determinate progress qoidasini implement qiling.
- [ ] **S16.02** Skeletonni full-page structured load, card/list/tablega cheklang; modal shell, toast va submit action uchun skeleton ishlatmang.
- [ ] **S16.03** Skeleton final layoutga yaqin bo‘lsin va 3–5 representative itemdan oshmasin; reduced motionda shimmer o‘chsin.
- [ ] **S16.04** Button pending holatida original action label va width saqlansin; duplicate submit bloklansin.
- [ ] **S16.05** Empty state turlarini first-use, no-results, permission, system-error va completionga ajrating.
- [ ] **S16.06** First-use empty state title, one-sentence value, primary action va optional template/exampledan iborat bo‘lsin.
- [ ] **S16.07** No-results state query/filter summary va “Filtrlarni tozalash” actionini bersin; data yo‘q deb noto‘g‘ri aytmasin.
- [ ] **S16.08** Error message “nima bo‘ldi + nima saqlandi/affected + nima qilish kerak” formatida yozilsin; raw stack chiqmasin.
- [ ] **S16.09** Offline/reconnect state selection va unsaved data’ni saqlasin; reconnect progress va retry/cancel actionini ko‘rsatsin.
- [ ] **S16.10** Full-screen loading overlay’ni faqat initial critical shellga cheklang; page ichidagi later fetchlar section-level state bo‘lsin.
- [ ] **S16.11** `aria-busy`, live status va progress value semanticsni qo‘shing; announcementlar flood qilmasin.
- [ ] **S16.12** Empty/loading/error/offline visual testsini light/dark/mobile/long Uzbek copy bilan yozing.

#### Tekshiruv

```text
Loader durationga mos
Skeleton correct contexts only
Empty states actionable
Offline data saqlanadi
Error raw stack bermaydi
```

#### Tugallanish sharti

User tizim nima qilayotganini va keyin nima qilishi kerakligini har state’da tushunadi.

### STEP 17 — App shell, navigation va responsive wayfinding

#### Natija

Landing, teacher va admin navigationlari role/taskga mos, responsive va consistent bo‘ladi.

#### Asosiy fayllar

```text
views/partials/nav.ejs
views/partials/app-shell.ejs
public/design/components/navigation.css
public/js/components/navigation.js
views/user/panel.ejs
views/admin/dashboard.ejs
```

#### Batafsil yo‘riqnoma

- [ ] **S17.01** Public, teacher, admin va Cast navigation IA’larini alohida yozing; bitta universal navbarni barcha contextga majburlamang.
- [ ] **S17.02** Public nav’da Product, Teachers, Cast, Ready tests, Resources, Login va primary CTA qoldiring; Adminni footer utilityga o‘tkazing.
- [ ] **S17.03** Teacher shell’da Home, My tests, Ready tests, Results, Cast sessions va Templates navigationini yarating.
- [ ] **S17.04** Characters va VIPni teacher primary nav’dan olib, profile/settings yoki participant contextiga o‘tkazing.
- [ ] **S17.05** Active nav state’ni soft fill + text weight + indicator bilan ko‘rsating; hover active statega o‘xshamasin.
- [ ] **S17.06** Mobile’da desktop sidebarni shunchaki yashirmang; accessible drawer yoki 3–5 item bottom nav + More pattern yarating.
- [ ] **S17.07** Drawer openingda focus trap, Escape, overlay close va trigger focus restore qo‘shing.
- [ ] **S17.08** Sticky header balandligi, safe-area va `scroll-margin-top`ni tokenlashtiring.
- [ ] **S17.09** Breadcrumbni deep builder/admin hierarchy’da ishlating; landing va shallow pages’da qo‘shmang.
- [ ] **S17.10** Keyboard tab order visual orderga mos bo‘lsin; skip link main contentga olib borsin.
- [ ] **S17.11** User role/account menu’da theme, language, accessibility va logoutni group qiling; destructive logout primary nav emphasis olmasin.
- [ ] **S17.12** Public/teacher/admin shelllarni 320px, 768px, 1024px va 1920pxda visual/keyboard test qiling.

#### Tekshiruv

```text
Role-based IA
Mobile replacement mavjud
Active/hover distinct
Skip link/focus ishlaydi
Admin public hero’da yo‘q
```

#### Tugallanish sharti

User qayerdaligini va primary destinationsni har viewportda tushunadi.

---

### STEP 18 — Table, filter, search va density components

#### Natija

Teacher/admin data-heavy interfeyslar card clutter o‘rniga accessible list/table va efficient filters ishlatadi.

#### Asosiy fayllar

```text
public/design/components/table.css
public/design/components/filter-bar.css
public/js/components/data-table.js
views/user/panel.ejs
views/admin/dashboard.ejs
```

#### Batafsil yo‘riqnoma

- [ ] **S18.01** Teacher test library va admin users/results uchun column priority va desktop table/list anatomy belgilang.
- [ ] **S18.02** Table header semantic `<th scope>`, sortable button va `aria-sort` bilan ishlasin.
- [ ] **S18.03** Names/text left, numeric metrics right, timestamps consistent locale format va actions last column bo‘lsin.
- [ ] **S18.04** Default row 44–48px, compact 36–40px bo‘lsin; user density preference teacher/admin’da saqlansin.
- [ ] **S18.05** Row hover, focus-within, selected, pending, error va bulk selection state’larini tokenlashtiring.
- [ ] **S18.06** Search 150–250ms debounce, loading status, result count va clear action bilan ishlasin.
- [ ] **S18.07** Active filters removable chiplar va “Barchasini tozalash” bilan ko‘rinsin; hidden filter state bo‘lmasin.
- [ ] **S18.08** Sort va filter state URL/query yoki local state’da stable bo‘lsin; back navigationda yo‘qolmasin.
- [ ] **S18.09** Mobile’da priority columns list/cardga reflow bo‘lsin; desktop table’ni 320pxga siqmang.
- [ ] **S18.10** Horizontal overflow kerak bo‘lsa visible affordance va sticky first/action columnni ehtiyotkor qo‘llang.
- [ ] **S18.11** Loading/empty/error rows valid table semantics va accessible text bilan ishlasin.
- [ ] **S18.12** Long username/test title, 200% zoom, keyboard sort/filter va screen-reader announcement testlarini yozing.

#### Tekshiruv

```text
Sortable semantics
Density modes
Mobile reflow
Filter state visible
Numeric alignment/tabular nums
```

#### Tugallanish sharti

Data-heavy UI compact, readable va quick-scan bo‘ladi, lekin tiny textga tushmaydi.

---

### STEP 19 — Chart va evidence visualization components

#### Natija

Responsive-teaching evidence simple, stable, accessible va action-oriented ko‘rsatiladi.

#### Asosiy fayllar

```text
public/design/components/charts.css
public/design/tokens/data-viz.tokens.json
public/js/components/charts.js
views/cast/director.ejs
views/cast/projector.ejs
```

#### Batafsil yo‘riqnoma

- [ ] **S19.01** Question-to-chart matrixni implement qiling: distribution horizontal bar, revote paired bar, confidence 2×2, progress comparable line, tiny counts table.
- [ ] **S19.02** Pie, 3D chart, gauge va rainbow/jet palette’ni component registrydan chiqarib tashlang.
- [ ] **S19.03** Har metricga label, value, numerator/denominator, context, uncertainty va action slot bering.
- [ ] **S19.04** Distribution option orderini response kelganda o‘zgartirmang; bar axis range current question davomida stable bo‘lsin.
- [ ] **S19.05** Chart seriesda color+shape/marker/line-dash/direct label ishlating; CVD va grayscale testdan o‘tkazing.
- [ ] **S19.06** Har chart uchun text takeaway va accessible data table alternative yarating.
- [ ] **S19.07** Tooltip hover-only bo‘lmasin; keyboard/touch access yoki direct labels bilan asosiy data ko‘rinsin.
- [ ] **S19.08** Live update 120–180ms interruptible transition bilan ishlasin; rolling odometer yoki dramatic reorder ishlatmang.
- [ ] **S19.09** Technical failure/no response’ni incorrectdan alohida neutral pattern bilan ko‘rsating.
- [ ] **S19.10** “Insufficient evidence” state va minimum sample thresholdni visual componentga qo‘shing.
- [ ] **S19.11** Projector chart labelsni ≥24px, barsni ≥16px qiling; Director chart compact variantdan alohida bo‘lsin.
- [ ] **S19.12** Screen reader summary floodini throttle qiling va CSV exportni accessible headerlar bilan bering.

#### Tekshiruv

```text
No pie/3D/gauge default
Stable option order
Table alternative
CVD-safe
Projector distance labels readable
```

#### Tugallanish sharti

Teacher 3 soniyada evidence va next actionni topa oladi.

---

### STEP 20 — Responsive, container queries, safe areas va input modality

#### Natija

Componentlar viewportga emas, real available space va device environmentga moslashadi.

#### Asosiy fayllar

```text
public/design/foundations/responsive.css
public/design/contexts/*.css
views/**/*.ejs
tests/visual/responsive.spec.js
```

#### Batafsil yo‘riqnoma

- [ ] **S20.01** Page-level layout uchun media query, reusable card/toolbar uchun container query, motion/theme/input uchun preference media features ishlating.
- [ ] **S20.02** Test card, metric card, mode card va action toolbar container breakpointsini component ichida belgilang.
- [ ] **S20.03** `100vh`ni mobile full-page flowlarda `100svh/100dvh`ga almashtiring; keyboard va address bar o‘zgarishini test qiling.
- [ ] **S20.04** Bottom participant controlsga `env(safe-area-inset-bottom)`, landscape top/sidega tegishli inset qo‘shing.
- [ ] **S20.05** Fine pointer uchungina hover enhancements qo‘shing; coarse pointerda target va spacingni kattalashtiring.
- [ ] **S20.06** 320px, 390px, 600px, 768px, 900px, 1024px, 1280px, 1440px va 1920px widthsni continuous test qiling.
- [ ] **S20.07** 1366×768, 1024×600 va 844×390 short-height/landscape holatlarini alohida test qiling.
- [ ] **S20.08** Ultra-wide’da contentni tiny center stripe qilmang; workspace max 1440–1600px, reading column 65ch qolsin.
- [ ] **S20.09** Table, nav, modal va sticky action mobile replacementlarini aniq belgilang; `display:none` bilan functionality yo‘qolmasin.
- [ ] **S20.10** Image/video uchun `srcset/sizes`, aspect ratio va explicit dimensions qo‘llang; mobile crop focal pointni saqlasin.
- [ ] **S20.11** Text spacing va 200/400% zoomda two-dimensional scroll critical pagesda paydo bo‘lmasligini test qiling.
- [ ] **S20.12** Container query support bo‘lmasa mobile-first default fully usable bo‘lsin; enhancement contentni hidden qoldirmasin.

#### Tekshiruv

```text
320px reflow
600–900px gap treated
Short height usable
Safe area pass
Hover dependency yo‘q
```

#### Tugallanish sharti

Har critical flow mobile, tablet, desktop va projector’da funksional va visual jihatdan coherent bo‘ladi.

---

## F3 — Landing va authentication

### STEP 21 — Landing information architecture va official content

#### Natija

Landing 5 soniyada Edikit nima, kim uchun va asosiy foydasini tushuntiradi.

#### Asosiy fayllar

```text
views/index.ejs
public/design/contexts/landing.css
routes/index.js
views/partials/public-nav.ejs
```

#### Batafsil yo‘riqnoma

- [ ] **S21.01** Current `Official Platform v2.0`, generic “Interaktiv Platforma”, demo stats va technology badgesni olib tashlash content inventory tuzing.
- [ ] **S21.02** Hero eyebrowni “Jonli baholash · Responsive teaching”, H1ni “Sinf nimani tushunganini shu zahoti ko‘ring” qilib yozing.
- [ ] **S21.03** Subtitle teacher task va outcome’ni bir jumlada tushuntirsin; “zamonaviy”, “premium”, “revolutionary” kabi vague so‘zlarni ishlatmang.
- [ ] **S21.04** Primary CTA’ni “Bepul boshlash”, secondary’ni “Demo Castni ko‘rish”, participant shortcutni “Kod bilan kirish” qilib standartlashtiring.
- [ ] **S21.05** Information architecture’ni Promise → Product Proof → Ask/See/Adapt → Three Views → Safety/Accessibility → Real Proof → CTA qilib qayta tuzing.
- [ ] **S21.06** Admin linkni hero/nav primary actiondan footer utilityga ko‘chiring.
- [ ] **S21.07** Fake logos, fake testimonials, unlabeled demo metrics va “24/7” trust claimlarini real proof bo‘lmaguncha ishlatmang.
- [ ] **S21.08** Accessibility, privacy, no-camera Cast va public-rank control trust statementlarini actual documentation linklari bilan bog‘lash slotini yarating.
- [ ] **S21.09** Footerga Product, Cast, Teachers, Accessibility, Security, Privacy, Status, Changelog, Contact va Language qo‘shing.
- [ ] **S21.10** Uzbek copy’ni professional editor/teacher bilan ko‘rib chiqing; English jargon va apostrophe consistency’ni tuzating.
- [ ] **S21.11** Heading hierarchy va landmarksni semantic qiling; bitta H1, logical H2 va skip link ishlating.
- [ ] **S21.12** Hero copy va IA’ni 5-second test uchun kamida 3 variantda prototip qiling, lekin productionda bitta coherent variant tanlang.

#### Tekshiruv

```text
What/who/value 5 secda tushunarli
One primary CTA
Admin secondary utility
Fake proof yo‘q
Semantic heading/landmarks
```

#### Tugallanish sharti

Landing productni quiz clone emas, official responsive-teaching platform sifatida ko‘rsatadi.

---

### STEP 22 — Landing product proof va distinctive visual composition

#### Natija

Hero real Edikit productini Evidence Mark, Response Mosaic va Three-view frame bilan yaqqol ko‘rsatadi.

#### Asosiy fayllar

```text
views/index.ejs
public/design/contexts/landing.css
public/images/product/*.avif
public/images/product/*.webp
public/js/landing-demo.js
```

#### Batafsil yo‘riqnoma

- [ ] **S22.01** Current particles va orbit ring DOM/CSS’ni olib tashlang; ambient backgroundni max ikki subtle source va static evidence grid bilan almashtiring.
- [ ] **S22.02** Hero’ni 5-column copy + 7-column product stage split layoutga o‘tkazing.
- [ ] **S22.03** Director wide frame, Projector landscape frame va Participant phone frame’ni locked Three-view grammar bo‘yicha joylashtiring.
- [ ] **S22.04** Response Mosaic va Signal Rail’ni product data contextida ishlating; random decoration sifatida tarqatmang.
- [ ] **S22.05** Demo data’ni “Demo sinf · 30 ishtirokchi” deb label qiling; impossible/fake live activity sifatida ko‘rsatmang.
- [ ] **S22.06** Product proofda answer coverage, distribution va “Muhokama tavsiya” teacher actionini ko‘rsating; points/avatars/confettini hero markazi qilmang.
- [ ] **S22.07** Static poster AVIF/WebP va optional real-component animation tayyorlang; reduced-motion/low-data static variantni default fallback qiling.
- [ ] **S22.08** Product visual text desktop/mobileda legible bo‘lsin; tiny fake dashboard screenshot ishlatmang.
- [ ] **S22.09** Image dimensions/aspect ratio/fetch priorityni belgilang; LCP visualni lazy load qilmang.
- [ ] **S22.10** Below-fold sectionsda split editorial, full product stage va asymmetric bento kabi kamida uch layout archetype ishlating.
- [ ] **S22.11** Every bento card generic icon+paragraph emas, actual product crop + outcome heading bo‘lsin.
- [ ] **S22.12** Logo/name hidden screenshot bilan brand asset recognition prototype oling; visual Edikit assetlari mavjudligini tekshiring.

#### Tekshiruv

```text
Particles/orbits yo‘q
Real product first viewportda
Three-view grammar
Demo clearly labeled
LCP image optimized
```

#### Tugallanish sharti

Hero’ni ko‘rgan user Edikitning teacher-private evidence va three-view architecture’sini darhol tushunadi.

---

### STEP 23 — Landing motion, trust, SEO va performance

#### Natija

Landing official, tez, accessible va honest trust evidence bilan ishlaydi.

#### Asosiy fayllar

```text
public/js/landing-demo.js
public/design/contexts/landing.css
views/partials/head.ejs
public/service-worker.js
```

#### Batafsil yo‘riqnoma

- [ ] **S23.01** Hero copy enter motionini 220ms, product frame’ni 280ms bilan bir marta ishlating; infinite movement qo‘shmang.
- [ ] **S23.02** Real product demo autoplay qilsa muted, max 8–12s, offscreen pause, visible play/pause va static reduced-motion story bo‘lsin.
- [ ] **S23.03** Scroll reveal default contentni visible qoldirsin; `@supports` va `prefers-reduced-motion:no-preference` ichida progressive enhancement qiling.
- [ ] **S23.04** Landing route’dan Socket.IO va XLSX global scriptlarini olib tashlang; faqat kerakli route entrypointni yuklang.
- [ ] **S23.05** Self-hosted fonts, critical preload va below-fold image lazy loadingni sozlang.
- [ ] **S23.06** Title, meta description, canonical, Open Graph va structured data’ni actual product positioning bilan yangilang.
- [ ] **S23.07** Trust links broken bo‘lmasin; privacy/accessibility/status/changelog mavjud bo‘lmasa claimni yashiring yoki “coming” emas, normal docs yarating.
- [ ] **S23.08** Service worker asset versioningni yangilang; stale style/landing JS eski designni qaytarmasin.
- [ ] **S23.09** Lighthouse mobile/desktopda LCP≤2.5s, CLS≤0.1, INP lab proxy va accessibility targetlarini gate qiling.
- [ ] **S23.10** Dark/light screenshots, no-JS fallback, slow 3G va font failure holatini tekshiring.
- [ ] **S23.11** Hero CTA first-click analyticsni privacy-safe event bilan o‘lchang; visual-only preference metricni conversion bilan adashtirmang.
- [ ] **S23.12** Five-second test, first-click test va trust semantic-differential natijasiga ko‘ra copy/layoutni iteratsiya qiling.

#### Tekshiruv

```text
No global Socket/XLSX landing load
Reduced-motion static
Core Web Vitals target
SEO metadata accurate
Trust links real
```

#### Tugallanish sharti

Landing visual jihatdan distinctive bo‘lib, performance/accessibility va official trustni buzmaydi.

---

### STEP 24 — Authentication redesign

#### Natija

Login/register sahifalari mature, clear, low-friction va theme-consistent bo‘ladi.

#### Asosiy fayllar

```text
views/user/login.ejs
views/admin/login.ejs
public/design/contexts/auth.css
public/js/auth.js
```

#### Batafsil yo‘riqnoma

- [ ] **S24.01** Auth sahifani centered endless void o‘rniga compact official shell yoki product proof + 440px form splitga o‘tkazing.
- [ ] **S24.02** Login/register segmented tabsni proper tab yoki radio-like mode semantics bilan qayta yarating.
- [ ] **S24.03** Visible labels, hint/error, autocomplete va correct input typesni reusable form components bilan almashtiring.
- [ ] **S24.04** Light theme input/card contrastini semantic surface/border tokens bilan tuzating; raw white alpha ishlatmang.
- [ ] **S24.05** Password show/hide va caps-lock status qo‘shing; accessible name va keyboard ishlashini tekshiring.
- [ ] **S24.06** Submit pending label/spinner va duplicate-submit lock qo‘shing; error bo‘lsa username saqlansin.
- [ ] **S24.07** User-not-found va wrong-password copy’ni security/privacy policyga mos generic/clear shaklda belgilang.
- [ ] **S24.08** Public user authdan Admin linkni low-emphasis footer utilityga ko‘chiring.
- [ ] **S24.09** Theme controlni 44px va accessible menu bilan yarating; floating 40px circle’ni olib tashlang.
- [ ] **S24.10** Mobile keyboard ochilganda submit ko‘rinishi va page scrollini test qiling; vertical center overflow bermasin.
- [ ] **S24.11** No-JS basic form submission, password manager, screen reader va 200% zoomni test qiling.
- [ ] **S24.12** User va admin auth visual hierarchy’sini bir familyda saqlang, adminni distinct badge/title bilan, neon/security theater’siz ko‘rsating.

#### Tekshiruv

```text
Labels visible
Password affordance
Light contrast pass
Keyboard/mobile pass
Admin link de-emphasized
```

#### Tugallanish sharti

Auth official va ishonchli ko‘rinadi, user nima kiritishi va xatoni qanday tuzatishni tushunadi.

## F4 — Teacher Workspace va authoring

### STEP 25 — Teacher Workspace shell va home dashboard

#### Natija

Teacher dashboard “Overview → Diagnose → Act” oqimida, calm va action-first bo‘ladi.

#### Asosiy fayllar

```text
views/user/panel.ejs
public/design/contexts/workspace.css
public/js/workspace.js
routes/user.js
```

#### Batafsil yo‘riqnoma

- [ ] **S25.01** Panel max-width 820px single columnni app shell + 1280px workspace gridga o‘tkazing.
- [ ] **S25.02** Headerga greeting/context, `Yangi test` primary va `Quick Prompt` secondary actionlarini joylashtiring.
- [ ] **S25.03** Active/recent Cast bo‘lsa resume/status cardni first foldga chiqaring; bo‘lmasa first-use actionni ko‘rsating.
- [ ] **S25.04** Generic stat-card rowni faqat actionable metriclar bilan almashtiring: needs attention, recent evidence, unfinished draft.
- [ ] **S25.05** Teacher primary navigationni STEP 17 shell orqali ulang; Characters va decorative controlsni olib tashlang.
- [ ] **S25.06** Evidence-bearing cardlarda Signal Railni cheklangan qo‘llang; har cardni brand motif bilan band qilmang.
- [ ] **S25.07** Initial data load uchun structured skeleton, error uchun inline retry va empty uchun contextual action yarating.
- [ ] **S25.08** Teacher customization: density, saved filters va theme preference’ni saqlang; critical widgetsni yashirishga ruxsat bermang.
- [ ] **S25.09** UI textni Source Sans 3/Manrope semantic rolesga o‘tkazing; `.62–.85rem` current labelsni minimum 14pxga olib chiqing.
- [ ] **S25.10** Destructive/logout actionsni primary workspace actionsdan ajrating.
- [ ] **S25.11** Screen reader landmarks va headingsni logical qiling; dynamic result counts live region bilan flood qilmasin.
- [ ] **S25.12** 1366×768, 1024×768, 390×844 va 200% zoomda first-fold primary actions reachable ekanini test qiling.

#### Tekshiruv

```text
Action-first dashboard
Characters primary nav’da yo‘q
Actionable metrics only
Loading/error/empty complete
14px+ metadata
```

#### Tugallanish sharti

Teacher 5 soniyada yangi test yaratish, existing testni Cast qilish yoki recent natijani topa oladi.

---

### STEP 26 — Test library, ready tests va action hierarchy

#### Natija

Teacher-owned va ready-made testlar clear list/filter modeli va bitta primary contextual action bilan ko‘rsatiladi.

#### Asosiy fayllar

```text
views/user/panel.ejs
public/js/workspace-library.js
public/design/contexts/workspace.css
routes/user.js
```

#### Batafsil yo‘riqnoma

- [ ] **S26.01** Teacher-owned operational testlar uchun list/table default, ready templates uchun media-rich grid variantini belgilang.
- [ ] **S26.02** Test row’da title, question count/type, subject/tag, updated date, visibility, last use/result va primary Cast actionni ko‘rsating.
- [ ] **S26.03** Editni secondary visible action, Preview/Duplicate/Share/Export/Archive/Delete’ni overflow menu qiling.
- [ ] **S26.04** Delete’ni red danger menu item va object-named confirmation bilan boshqaring; adjacent one-click delete’ni olib tashlang.
- [ ] **S26.05** Visibilityni eye icon-only emas, labeled status/menu bilan boshqaring.
- [ ] **S26.06** Search, source, subject, question type va sort filterlarini STEP 18 filter-bar bilan ulang.
- [ ] **S26.07** “Mock Fanlar” va “PRE Testlar”ni user-facing taxonomy va explanatory copy bilan qayta nomlang; internal keyni UI’dan yashiring.
- [ ] **S26.08** Ready test/entitlement mavjud bo‘lmaganda permission/upgrade state’ni honest copy bilan ko‘rsating; locked contentni confusing hidden accordion qilmang.
- [ ] **S26.09** Accordion ishlatilsa native button/ARIA pattern qo‘llang; hierarchy bo‘lmasa section/tab ishlating.
- [ ] **S26.10** Empty library, filtered none, API error va loading holatlarini alohida fixture qiling.
- [ ] **S26.11** Mobile’da row stacked listga reflow bo‘lsin; Cast action visible, overflow reachable bo‘lsin.
- [ ] **S26.12** Keyboard, screen reader, long title, 100+ item performance va saved filter return flowini test qiling.

#### Tekshiruv

```text
Cast primary contextual action
Delete overflow danger
Internal taxonomy explained
Mobile list usable
Search/filter state complete
```

#### Tugallanish sharti

Teacher testlarni tez scan qiladi va action overloadsiz kerakli ishni bajaradi.

---

### STEP 27 — Test Builder professional authoring workspace

#### Natija

Builder long inline form emas, sticky actions, outline, field validation va autosave’li authoring tool bo‘ladi.

#### Asosiy fayllar

```text
views/user/create-test.ejs
public/design/contexts/test-builder.css
public/js/test-builder.js
routes/user.js
```

#### Batafsil yo‘riqnoma

- [ ] **S27.01** Sticky top bar’da Back, editable title, save status, Preview va Save actionsni yarating.
- [ ] **S27.02** Desktopda question outline + editor + optional properties panel, first release’da outline drawer + 720px editor columnni implement qiling.
- [ ] **S27.03** Question type, stem, media, options, correct answer, explanation, tags va timing fieldlarini labeled componentsga ajrating.
- [ ] **S27.04** Correct answer controlni native radio/checkbox semantics bilan yarating; `div/button` color-only state ishlatmang.
- [ ] **S27.05** Question duplicate/delete’ni overflowga o‘tkazing; delete undo yoki confirmation bilan ishlasin.
- [ ] **S27.06** Reorder uchun drag handle bilan birga Move up/Move down/Move to position keyboard alternative bering.
- [ ] **S27.07** Autosave debounce, pending, saved, offline va failure statuslarini sticky bar’da ko‘rsating.
- [ ] **S27.08** Field-level validation va page error summary qo‘shing; invalid question outline’da marker bilan ko‘rinsin.
- [ ] **S27.09** Excel importni secondary modal flowga o‘tkazing: template, upload, parsing, row errors, preview, confirm.
- [ ] **S27.10** Emoji iconsni yagona SVG icon systemga almashtiring; red/green answer colorsga text/icon redundancy qo‘shing.
- [ ] **S27.11** Mobile’da single selected question, outline drawer va safe-area sticky save actionni yarating.
- [ ] **S27.12** Unsaved navigation, offline recovery, long Uzbek question, 5 options, 200% zoom va keyboard reorder testlarini yozing.

#### Tekshiruv

```text
Sticky save/status
Outline navigation
Semantic correct answer
Import modal
Autosave/offline states
```

#### Tugallanish sharti

Teacher katta testni xatosiz, data yo‘qotmasdan va scroll oxiridagi yagona Save tugmasiga qaram bo‘lmasdan tahrirlaydi.

---

## F5 — Cast experience

### STEP 28 — Cast Setup Studio visual implementation

#### Natija

Eski vaqt/type/auto modal professional mode, validation va privacy summary’li Studio bilan almashtiriladi.

#### Asosiy fayllar

```text
views/user/panel.ejs
views/partials/cast-studio.ejs
public/design/contexts/cast-studio.css
public/js/cast-studio.js
```

#### Batafsil yo‘riqnoma

- [ ] **S28.01** Studio desktopda 880–960px dialog, mobile’da full-screen sheet sifatida ishlasin.
- [ ] **S28.02** Responsive Accuracy, Classic Live, Team Challenge va Formative Check selectable radio cardsini yarating.
- [ ] **S28.03** Mode cardsni neutral surfacesda ko‘rsating; Accuracy cobalt, Team signal cyan accent olishi mumkin, lekin rainbow fill ishlatmang.
- [ ] **S28.04** Essentials’da pace, think time, timer, scoring, leaderboard va joinni ko‘rsating; Advanced’ni accordionga o‘tkazing.
- [ ] **S28.05** Selected preset summary, customized badge va Reset actionini persistent ko‘rsating.
- [ ] **S28.06** Preflight blocker, warning, duration, privacy va accessibility summarylarini sticky footer oldida ko‘rsating.
- [ ] **S28.07** Blocker danger, warning amber, info cobalt bo‘lsin; icon+title+action bilan, color-only emas.
- [ ] **S28.08** Governance-locked fieldga lock marker va policy explanation bering; hidden disable qilmang.
- [ ] **S28.09** Dirty state, Escape confirmation, focus trap, focus restore va initial focusni implement qiling.
- [ ] **S28.10** Submit pending’da one request ID bilan duplicate session creationni bloklang; button label saqlansin.
- [ ] **S28.11** Current inline Cast CSS/JSni external component/context fayllarga ko‘chiring; raw colors va `transition:all`ni olib tashlang.
- [ ] **S28.12** Mode/default/invalid config/mobile/keyboard/screen-reader visual/E2E testlarini yozing.

#### Tekshiruv

```text
Mode radio semantics
Essentials/Advanced hierarchy
Preflight visible
No rainbow cards
Focus/dirty/pending complete
```

#### Tugallanish sharti

Teacher 30 soniyada safe default bilan lobby ochadi va har setting nimani o‘zgartirishini tushunadi.

---

### STEP 29 — Cast Director private cockpit

#### Natija

Director current state, evidence va next actionni private, glanceable va official layoutda ko‘rsatadi.

#### Asosiy fayllar

```text
views/game/host.ejs yoki views/cast/director.ejs
public/design/contexts/director.css
public/js/cast-director.js
```

#### Batafsil yo‘riqnoma

- [ ] **S29.01** Projector va Director DOM/view’larini ajrating; Director private roster/evidence/public previewni bir sahifada boshqarsin.
- [ ] **S29.02** Top status bar’da session, phase, network/projector/co-host status va End overflowini joylashtiring.
- [ ] **S29.03** Main gridni question/projector preview 7 columns, teacher evidence 5 columns va bottom control railga ajrating.
- [ ] **S29.04** Primary evidence’ni answered/active, correct/accepted, dominant distractor va technical issue bilan cheklang.
- [ ] **S29.05** Primary actionsni current phase bo‘yicha Pause, Add Time, Close, Reveal, Discuss, Reteach, Nextdan max 3 dominant qilib ko‘rsating.
- [ ] **S29.06** Faqat bitta filled cobalt next action bo‘lsin; remaining actions secondary/quiet bo‘lsin.
- [ ] **S29.07** Evidence Railni current actionable insightda ishlating; cyan live, amber attention, danger actual errorga cheklansin.
- [ ] **S29.08** Command pending, ACK, stale revision, recovery va permission-disabled state’larini control ustida aniq ko‘rsating.
- [ ] **S29.09** Add Time menu, Close va Reveal’ni alohida action qiling; current auto progression ambiguity’ni yo‘qoting.
- [ ] **S29.10** Infinite glow/shimmer, trophy va rainbow option cardlarni Director’dan olib tashlang.
- [ ] **S29.11** Keyboard shortcuts optional va discoverable bo‘lsin; input focused paytida ishlamasin.
- [ ] **S29.12** 1024×768, tablet landscape, 200% zoom, reconnect va co-host permission matrix testlarini yozing.

#### Tekshiruv

```text
Director private view
One dominant next action
Four primary metrics max
Command states visible
No constant game-show motion
```

#### Tugallanish sharti

Teacher live darsda ekranni uzoq o‘qimasdan state va next actionni tushunadi.

---

### STEP 30 — Projector classroom display

#### Natija

Projector private data va host controlsiz, back-row readable Classroom Light/Dark/High Contrast display bo‘ladi.

#### Asosiy fayllar

```text
views/cast/projector.ejs
public/design/contexts/projector.css
public/js/cast-projector.js
```

#### Batafsil yo‘riqnoma

- [ ] **S30.01** Projector-only route/view yarating; host nav, controls, private roster va teacher evidence DOMga kirmasin.
- [ ] **S30.02** Lobby’da QR, join code, short link va participant countni large type bilan ko‘rsating; full roster default emas.
- [ ] **S30.03** Lobbydan keyin QR/code’ni hide/minimize qiling; teacher command bilan qayta ko‘rsatish imkonini bering.
- [ ] **S30.04** Questionni 36–64px, optionsni 28–40px, meta/timerni ≥22px, join code’ni 64–120px qiling.
- [ ] **S30.05** Optionlarni solid surface + shape + letter + text bilan ko‘rsating; shimmer/sweep/infinite glow ishlatmang.
- [ ] **S30.06** Timer number + label + ring/bar bilan, flashing va color-only critical state’siz ishlasin.
- [ ] **S30.07** Distribution max 5 stable bars, count+percent+shape bilan; public reveal teacher commandgacha ko‘rinmasin.
- [ ] **S30.08** Classroom Light bright room, Classroom Dark dim room va High Contrast profillarini alohida token/context qiling.
- [ ] **S30.09** 4vw/3vh safe area, 4:3/16:9 va overscan’ni qo‘llang; critical content edge’ga tegmasin.
- [ ] **S30.10** Long question overflow algoritmi font floor, line limit, media reflow va device fallback bilan ishlasin; ellipsis ishlatmang.
- [ ] **S30.11** Reduced motionda scene static/crossfade, chart instant, celebration static equivalent bo‘lsin.
- [ ] **S30.12** 3m, 8m, 15m; 720p/1080p; bright/dim; washed projector field testlarini signed checklist bilan bajaring.

#### Tekshiruv

```text
No private DOM/payload
Back-row readable
Bright/dark profiles
Safe area/4:3 pass
No ellipsis or infinite motion
```

#### Tugallanish sharti

Back-row user primary question, options va statusni assistance’siz o‘qiydi.

---

### STEP 31 — Participant join va answer experience

#### Natija

Participant bir taskga fokuslangan, touch-first, mature va explicit ACK/recovery states bilan ishlaydi.

#### Asosiy fayllar

```text
views/game/enter.ejs yoki views/cast/participant.ejs
public/design/contexts/participant.css
public/js/cast-participant.js
```

#### Batafsil yo‘riqnoma

- [ ] **S31.01** Join flow’ni code → name/safe alias → optional avatar → lobby qilib aniq progress bilan yarating.
- [ ] **S31.02** Code inputni tabular/monospace, unambiguous characters, paste/autofill va correct mobile keyboard bilan implement qiling.
- [ ] **S31.03** Avatar/character selectionni optional qiling; joinni bloklamasin va teacher disable qila olsin.
- [ ] **S31.04** Question va answer optionlarni full-width 48px+ touch targets, shape+letter+text bilan ko‘rsating.
- [ ] **S31.05** OPEN, SELECTED, SENDING, SAVED, RETRYING, LOCKED va REVEALED visual statesni STEP 24 grammariga mos implement qiling.
- [ ] **S31.06** Retry paytida selected answer ko‘rinishini saqlang; `Javob saqlandi`ni faqat server confirmationdan keyin ko‘rsating.
- [ ] **S31.07** Current option shimmer/sweep va bouncing/glowing waiting state’larni olib tashlang.
- [ ] **S31.08** Player badge, timer va bottom controls safe-area’da collision qilmasin; 320px/landscape test qiling.
- [ ] **S31.09** Personal mute, reduced motion, high contrast va question-on-device preferencesni saqlang.
- [ ] **S31.10** Correct/wrong revealni semantic green/red + icon + text bilan ko‘rsating; giant emoji sole feedback bo‘lmasin.
- [ ] **S31.11** Lobby/reconnect/network statusni calm persistent text bilan ko‘rsating; toast-only yoki animation-only bo‘lmasin.
- [ ] **S31.12** One-tap/select-submit, double tap, lost ACK, reconnect, screen reader, keyboard va low-end Android testlarini yozing.

#### Tekshiruv

```text
48px targets
Explicit ACK states
Selection retained on retry
Optional avatar
No constant shimmer/bounce
```

#### Tugallanish sharti

Participant noto‘g‘ri touchsiz answer beradi va javobi serverda saqlanganini aniq biladi.

---

### STEP 32 — Leaderboard, celebration va mature gamification

#### Natija

Competition optional, privacy-safe va mature bo‘ladi; learning evidence visual markazda qoladi.

#### Asosiy fayllar

```text
public/design/contexts/leaderboard.css
public/js/cast-leaderboard.js
views/cast/projector.ejs
views/cast/participant.ejs
```

#### Batafsil yo‘riqnoma

- [ ] **S32.01** Leaderboard mode’larini Off, Personal, Top N, Team va Host Private qilib distinct viewlar bilan implement qiling.
- [ ] **S32.02** Public Top N default max 5 bo‘lsin; bottom ranks va full absolute leaderboard public ko‘rinmasin.
- [ ] **S32.03** Rank row’ni safe alias, rank va score bilan neutral listda ko‘rsating; flames/crowns/full podiumni default olib tashlang.
- [ ] **S32.04** Top 3ga subtle medal tone ishlating; gold/silver/bronze text contrast va CVD testdan o‘tsin.
- [ ] **S32.05** Personal rankni participant-private ko‘rsating; personal best va progressni peer comparisondan ustun qo‘ying.
- [ ] **S32.06** Team leaderboard individual low performance’ni reveal qilmasin; class cooperative goal uchun alohida component yarating.
- [ ] **S32.07** Leaderboard row enter staggerini max 40ms×5, total 200ms qiling; falling/reorder animation ishlatmang.
- [ ] **S32.08** Ties, late join, no score va disconnected state’larni stable rank policy bilan ko‘rsating.
- [ ] **S32.09** Celebration budgetni ordinary success 0–2 subtle event, session complete max 1 expressive event qilib cheklang.
- [ ] **S32.10** Celebration 500–800ms one-shot, mute/reduced-motion aware va static equivalent bilan ishlasin.
- [ ] **S32.11** Points/badges/avatarsni teacher workspace/admin brandidan scope qiling; Cast ichida optional feature bo‘lsin.
- [ ] **S32.12** Competitive, noncompetitive va low-rank user groupsda anxiety/fairness feedback pilotini o‘tkazing.

#### Tekshiruv

```text
Public low ranks hidden
Personal progress private
Team/cooperative mode
No falling/reorder motion
Celebration optional/reduced
```

#### Tugallanish sharti

Gamification darsni qo‘llab-quvvatlaydi, productni bolalarcha yoki public-shaming platformaga aylantirmaydi.

---

## F6 — Admin, system va content

### STEP 33 — Admin dashboard redesign va security-sensitive UI cleanup

#### Natija

Admin neutral enterprise dashboard, responsive navigation va safe data presentation bilan ishlaydi.

#### Asosiy fayllar

```text
views/admin/dashboard.ejs
views/admin/vip.ejs
public/css/admin.css
public/design/contexts/admin.css
public/js/admin.js
```

#### Batafsil yo‘riqnoma

- [ ] **S33.01** Admin layoutni 64px top bar, 220px desktop sidebar va main max 1440pxga o‘tkazing.
- [ ] **S33.02** Mobile’da sidebar o‘rniga drawer/bottom navigation yarating; current `display:none` bilan functionality yo‘qolmasin.
- [ ] **S33.03** Password hash/plain password columnlari va password toast/result textlarini UI’dan butunlay olib tashlang.
- [ ] **S33.04** Users, ready tests, PRE, results, VIP va stats navigationini task-based sectionlarga guruhlang.
- [ ] **S33.05** Admin tablesni STEP 18 table, filters va density componentsga migratsiya qiling.
- [ ] **S33.06** Inline 79 style line va JS template literal stylesni classes/tokensga ko‘chiring.
- [ ] **S33.07** Stats cardlarni actionable/operational metriclarga cheklang; decorative gradient/emoji/trophy ishlatmang.
- [ ] **S33.08** Live system statusda Signal Cyan, warningda Insight Amber, actual error’da danger ishlating; brand accentsni status bilan aralashtirmang.
- [ ] **S33.09** VIP grant/revoke’ni searchable user picker, confirmation, pending va success/error inline state bilan qayta yarating.
- [ ] **S33.10** Upload/import flowsni reusable dropzone/progress/validation components bilan almashtiring; keyboard file input ishlasin.
- [ ] **S33.11** Admin light/dark/high-contrast, compact/comfortable, long data va 200% zoom screenshotlarini yozing.
- [ ] **S33.12** Permissions, audit trail visibility va destructive action hierarchy’ni security/product owner bilan review qiling.

#### Tekshiruv

```text
Password UI’da yo‘q
Mobile admin nav mavjud
Inline styles keskin kamaygan/0 target
Tables accessible
Sensitive actions confirmed/audited
```

#### Tugallanish sharti

Admin official enterprise toolga o‘xshaydi va sensitive credentialni vizual convenience uchun oshkor qilmaydi.

### STEP 34 — Error pages, system states, PWA va service worker visuals

#### Natija

404/500/offline/update states official brand, recovery action va stale-asset protection bilan ishlaydi.

#### Asosiy fayllar

```text
views/error.ejs
views/offline.ejs
public/manifest.json
public/service-worker.js
public/images/pwa-*.png
```

#### Batafsil yo‘riqnoma

- [ ] **S34.01** 404, 403, 500, maintenance va offline holatlarini bitta generic error’dan alohida copy/action bilan yarating.
- [ ] **S34.02** Error page’da status title, plain-language explanation, primary recovery va secondary home/support linkini ko‘rsating.
- [ ] **S34.03** Raw stack, file path va secret detailni productionda yashiring; opaque reference IDni support uchun ko‘rsating.
- [ ] **S34.04** Evidence Mark va restrained Response Mosaic empty illustrationini ishlating; giant warning emoji yoki playful error mascot ishlatmang.
- [ ] **S34.05** Error primary buttonni reusable button componentga o‘tkazing; current inline gradient/transition-allni olib tashlang.
- [ ] **S34.06** Offline page’da cached available actions, reconnect status va retry buttonini ko‘rsating.
- [ ] **S34.07** Service worker cache versionini design asset hash bilan boshqaring; old CSS/new HTML mismatchni oldini oling.
- [ ] **S34.08** New version available bo‘lsa nonblocking update banner va “Yangilash” actionini yarating; active Castda forced reload qilmang.
- [ ] **S34.09** Manifest theme/background colorsni final Ink/Paper tokens bilan moslang va light/dark iconsni tekshiring.
- [ ] **S34.10** PWA icons Evidence Markning optical variantidan generatsiya qilinsin; safe maskable area testdan o‘tsin.
- [ ] **S34.11** Offline, stale service worker, failed update va no-cache first visit testlarini yozing.
- [ ] **S34.12** Error/offline pagesni keyboard, screen reader, 320px va reduced motionda test qiling.

#### Tekshiruv

```text
State-specific error copy
No production stack leak
PWA colors/icons final brandga mos
Stale asset protection
Recovery actions accessible
```

#### Tugallanish sharti

Failure holati ham Edikit trustini saqlaydi va userga real recovery yo‘lini beradi.

---

### STEP 35 — Content system, localization va RTL readiness

#### Natija

UI copy consistent Uzbek, translation-key based va future Cyrillic/Russian/English/RTLga tayyor bo‘ladi.

#### Asosiy fayllar

```text
locales/uz-Latn/*.json
locales/uz-Cyrl/*.json
locales/ru/*.json
locales/en/*.json
public/js/i18n.js
views/**/*.ejs
```

#### Batafsil yo‘riqnoma

- [ ] **S35.01** Hardcoded Cast/workspace/admin stringsni translation key inventoryga ko‘chiring; sentence fragment concatenationni taqiqlang.
- [ ] **S35.02** UI locale va test/content locale’ni ajrating; teacher Uzbek UI’da Russian test yaratishi mumkin bo‘lsin.
- [ ] **S35.03** Termin registry yarating: Cast, jonli sessiya, tayyor test, sinov, ishtirokchi, o‘qituvchi, natija va settings nomlari consistent bo‘lsin.
- [ ] **S35.04** “Mock”, “PRE”, “Characters”, “Real-time Multiplayer” kabi jargonlarga approved Uzbek label/description bering.
- [ ] **S35.05** Uzbek apostrophe variants va Unicode normalization qoidalarini search/inputda qo‘llang; display original textni saqlang.
- [ ] **S35.06** Number, percent, date, duration va list formattingni `Intl` bilan locale-aware qiling.
- [ ] **S35.07** `lang` va `dir` documentda locale bo‘yicha o‘rnatilsin; user-generated textga `dir="auto"`, aliases/codega bidi isolation qo‘llang.
- [ ] **S35.08** Pseudo-locale va 30–50% text expansion bilan clipping/overflowni test qiling.
- [ ] **S35.09** Error, empty, status, CTA va destructive confirmation copylarini professional content reviewdan o‘tkazing.
- [ ] **S35.10** Translation fallback requested → base → uz-Latn bo‘lsin; missing key raw internal token sifatida userga chiqmasin.
- [ ] **S35.11** Source Sans/Manrope Cyrillic glyphlari barcha locale screenshotlarida bir xil metric bilan ko‘rinishini tekshiring.
- [ ] **S35.12** Uzbek teacher, Russian user va RTL smoke user bilan key flowsni usability test qiling.

#### Tekshiruv

```text
Hardcoded primary copy minimum/0 target
Termin registry
Intl formatting
Pseudo-locale pass
RTL foundation pass
```

#### Tugallanish sharti

UI professional bir tilda gapiradi va boshqa locale qo‘shilganda layout/design buzilmaydi.

---

## F7 — Accessibility, performance, research va launch

### STEP 36 — WCAG 2.2 AA va COGA accessibility gate

#### Natija

Critical flows automated va manual WCAG/COGA testlardan o‘tadi.

#### Asosiy fayllar

```text
scripts/a11y-audit.js
tests/a11y/*.spec.js
docs/accessibility.md
public/design/foundations/focus.css
```

#### Batafsil yo‘riqnoma

- [ ] **S36.01** Axe’ni landing, auth, panel, builder, Setup Studio, Director, Projector, Participant, admin va errorsga qo‘llang.
- [ ] **S36.02** Serious/critical axe violationni CI failure qiling; minor/moderate issue owner/deadline bilan triage qilinsin.
- [ ] **S36.03** Keyboard-only join→answer→saved→reveal va teacher create→Cast→pause→close flowsini manual/E2E test qiling.
- [ ] **S36.04** NVDA+Chrome va VoiceOver+Safari smoke testlarini release checklistga qo‘shing.
- [ ] **S36.05** Focus not obscured, visible focus, dialog trap/restore, tabs/accordion semanticsni manual tekshiring.
- [ ] **S36.06** 200% zoom va 320px/400% reflow critical pagesda content/function loss bermasligini tekshiring.
- [ ] **S36.07** WCAG text spacing override bilan fixed heights, overlap va clipped labelsni toping.
- [ ] **S36.08** Reduced motion, no sound, high contrast, forced colors va grayscale task parityni test qiling.
- [ ] **S36.09** Touch targetsni 44px preferred, participant 48px qilib audit qiling; documented exceptionsni review qiling.
- [ ] **S36.10** COGA bo‘yicha controls understandable, path predictable, memory dependency low, errors correctable va help available ekanini checklist qiling.
- [ ] **S36.11** Charts va projectorda text summary/table, color redundancy va back-row readabilityni verify qiling.
- [ ] **S36.12** Accessibility statementda tested scope, known limitations, contact va update date’ni honest yozing.

#### Tekshiruv

```text
Axe serious/critical = 0
Keyboard critical flows pass
Screen reader smoke pass
Zoom/reflow/text-spacing pass
Reduced/forced/high-contrast parity
```

#### Tugallanish sharti

Accessibility audit keyin qo‘shilgan patch emas, release-blocking product quality gate bo‘ladi.

---

### STEP 37 — Design lint va visual regression gate

#### Natija

Raw style drift, tiny text, broad transitions va unreviewed visual diff CI’da bloklanadi.

#### Asosiy fayllar

```text
stylelint.config.js
scripts/design-lint.js
tests/visual/*.spec.js
package.json
.github/workflows/design.yml
```

#### Batafsil yo‘riqnoma

- [ ] **S37.01** Component/context CSS’da raw hex va raw rgba’ni taqiqlang; token source/generated fayllarni allowlist qiling.
- [ ] **S37.02** `transition: all`ni hard error qiling.
- [ ] **S37.03** Infinite animationni loading/approved milestone allowlistidan tashqarida hard error qiling.
- [ ] **S37.04** Operational font-size `.75rem`dan past bo‘lsa error qiling; badge/legal exceptionlar documented bo‘lsin.
- [ ] **S37.05** Inline visual `style=`ni EJS/JS’da taqiqlang; data-driven CSS custom property istisnolarini limited allowlist qiling.
- [ ] **S37.06** `outline:none`, fixed-height text container, unauthorized z-index va arbitrary box-shadow qoidalarini lint qiling.
- [ ] **S37.07** Deprecated token aliases usage’ni warningdan boshlab migration deadline’da errorga aylantiring.
- [ ] **S37.08** STEP 03 visual matrixni PR CI’da ishga tushiring; changed page/component baselinelarini required reviewga yuboring.
- [ ] **S37.09** Visual baseline update commitida screenshot diff summary va approval link talab qiling.
- [ ] **S37.10** Light/dark/high-contrast/mobile/projector coverage yetishmasa CI failure qiling.
- [ ] **S37.11** Design metric trend reportda raw colors, inline styles, `!important`, tiny text va infinite motion sonini ko‘rsating.
- [ ] **S37.12** `npm run design:check`ni tokens, contrast, lint, EJS compile, visual va axe subcommandsiga birlashtiring.

#### Tekshiruv

```text
Raw component color = 0
transition:all = 0
Inline visual style = 0 target
Visual baselines reviewed
One design:check command
```

#### Tugallanish sharti

Design consistency individual developer xotirasiga emas, automated gate’ga tayanadi.

---

### STEP 38 — Performance va asset budget gate

#### Natija

Distinctive design low-end device va real networkda ham tez ishlaydi.

#### Asosiy fayllar

```text
scripts/performance-budget.js
public/design/
views/partials/head.ejs
public/service-worker.js
package.json
```

#### Batafsil yo‘riqnoma

- [ ] **S38.01** Landing LCP≤2.5s, INP≤200ms, CLS≤0.1 p75 product targetsini RUM va labda belgilang.
- [ ] **S38.02** Landing initial JS ≤150KB gzip, critical CSS ≤35KB gzip va route-specific asset budget yarating.
- [ ] **S38.03** Socket.IO’ni faqat realtime routes, XLSX’ni faqat import/admin routesda yuklang.
- [ ] **S38.04** Fontsni self-host/subset/cache qiling; unused weight/scriptni yuklamang.
- [ ] **S38.05** Hero LCP visualni preload/fetchpriority bilan, below-fold image’larni lazy load va explicit dimensions bilan bering.
- [ ] **S38.06** Large backdrop-filter, blur, box-shadow va gradient paint costini DevTools’da profil qiling; low-power fallback qo‘shing.
- [ ] **S38.07** Motionda transform/opacity compositor path ishlatilishini Lighthouse/DevTools bilan tekshiring.
- [ ] **S38.08** Long Animation Frame >50ms, interaction main-thread block va layout shift regionlarni test qiling.
- [ ] **S38.09** 100+ test row, 100 participant roster va live chart update performance fixturelarini yarating.
- [ ] **S38.10** Service worker cache stale issue, repeat visit va offline asset behaviorni o‘lchang.
- [ ] **S38.11** Low-end Android, Slow 4G/3G, CPU 4× throttle va memory-constrained contextda key flowsni test qiling.
- [ ] **S38.12** Budget regressionni CI failure qiling; exception owner, expiry va measured justification talab qiling.

#### Tekshiruv

```text
Route asset split
CWV targets
No long animation regressions
Low-end test pass
Budget CI gate
```

#### Tugallanish sharti

Visual polish perceived speedni pasaytirmaydi va interaction motion jank qilmaydi.

---

### STEP 39 — Scientific user research va brand recognition validation

#### Natija

“Official, mature, distinctive” qarori real teacher/participant behavior va validated scales bilan tekshiriladi.

#### Asosiy fayllar

```text
research/design-study-plan.md
research/consent.md
research/results/*.csv
research/report.md
```

#### Batafsil yo‘riqnoma

- [ ] **S39.01** Teacher, participant/student, institution/admin segmentlarini alohida recruit qiling; faqat designer/developer sample ishlatmang.
- [ ] **S39.02** Current Edikit, new Edikit, generic blue SaaS va playful quiz control variantlarini blind comparison uchun tayyorlang.
- [ ] **S39.03** 5-second testda what/who/value/CTA recallni o‘lchang.
- [ ] **S39.04** First-click tasksda create test, Cast existing test, find result va join code success/time/misclickni o‘lchang.
- [ ] **S39.05** Semantic differential’da childish–mature, unofficial–official, generic–distinctive, chaotic–clear, cold–warm, weak–competent, untrustworthy–trustworthy o‘lchang.
- [ ] **S39.06** VisAWI-S bilan simplicity/diversity/colorfulness/craftsmanship, SUS bilan usability va UEQ/AttrakDiff bilan pragmatic/hedonic sifatni o‘lchang.
- [ ] **S39.07** NASA-TLX yoki lightweight task-load measure bilan teacher Director va Builder cognitive loadni o‘lchang.
- [ ] **S39.08** Evidence Mark, Signal Rail, Response Mosaic, palette va Three-view frame’ni name/logo hidden fame/uniqueness test qiling.
- [ ] **S39.09** Full/reduced/no motion variantsda task success, perceived speed va discomfortni solishtiring.
- [ ] **S39.10** Bright classroom, dim room, projector va mobile outdoorsda theme readability/preferencesni tekshiring.
- [ ] **S39.11** Gamification study’da leaderboard on/off/personal/team variants uchun anxiety, fairness va motivation feedbackini segment bo‘yicha oling.
- [ ] **S39.12** Resultlarni “users liked it” bilan emas, task metrics + confidence + qualitative themes bilan report qiling; weak evidence’ni universal claim qilmang.

#### Targetlar

```text
Mature ≥5.8/7
Official ≥5.8/7
Distinctive ≥5.2/7
Clear ≥6.0/7
Competent ≥6.0/7
Trustworthy ≥5.8/7
5-second category recall ≥80%
Primary CTA first-click ≥80%
```

#### Tugallanish sharti

Final visual identity stakeholder taste emas, real user evidence bilan tasdiqlanadi.

---

### STEP 40 — Incremental migration, feature flags va rollout

#### Natija

Design system sahifama-sahifa migratsiya qilinadi; rollback va compatibility saqlanadi.

#### Asosiy fayllar

```text
server.js
views/partials/head.ejs
public/design/
public/css/style.css
public/css/admin.css
docs/design-migration.md
```

#### Batafsil yo‘riqnoma

- [ ] **S40.01** Migration orderni tokens/theme → components → landing/auth → workspace/builder → Cast → admin qilib lock qiling.
- [ ] **S40.02** Har contextni feature flag bilan eski/yangi variantga ajrating; active Cast session o‘rtasida visual shell almashtirmang.
- [ ] **S40.03** Legacy variable aliasesni F1’da qo‘shing, usage inventoryni har release kamaytiring, final major cleanupda olib tashlang.
- [ ] **S40.04** Bir PR’da foundation va barcha pagesni rewrite qilmang; component/page slice va visual baseline bilan kichik PRlar qiling.
- [ ] **S40.05** Har PR template compile, HTTP smoke, design lint, visual, axe va performance subset gate’dan o‘tsin.
- [ ] **S40.06** Internal dogfood → 5 teacher pilot → 3–5 class pilot → percentage rollout tartibini yozing.
- [ ] **S40.07** Theme, landing, workspace va Castni mustaqil rollout qiling; failure blast radiusni kamaytiring.
- [ ] **S40.08** Error rate, bounce, task success, support tickets, theme usage va CWV monitoring dashboard yarating.
- [ ] **S40.09** Rollback criterion: HTTP/render failure, answer-flow regression, a11y P0, performance threshold, severe teacher confusion.
- [ ] **S40.10** Screenshot/cache/service-worker compatibilityni old/new deployment orasida test qiling.
- [ ] **S40.11** Design deprecation changelog va migration docsni har release update qiling.
- [ ] **S40.12** Rollout tugagach legacy CSS/inline style va flaglarni alohida cleanup release’da olib tashlang.

#### Tekshiruv

```text
Incremental flags
Per-PR quality gates
Rollback tested
Pilot sequence
Legacy usage trend down
```

#### Tugallanish sharti

Redesign katta-bang riskisiz productionga kiradi va har bosqich rollback qilinadi.

---

### STEP 41 — Final launch, governance va masterpiece acceptance

#### Natija

Design official launch gate’dan o‘tadi va keyingi release’larda drift qilmaydi.

#### Asosiy fayllar

```text
style.md
STYLE_IMPLEMENTATION_MASTER_PLAN.md
docs/design-system/*.md
CODEOWNERS
CHANGELOG.md
```

#### Batafsil yo‘riqnoma

- [ ] **S41.01** Gate 0: barcha EJS compile, critical HTTP 200, app testlari green va working tree clean ekanini tekshiring.
- [ ] **S41.02** Token gate: schema, aliases, all themes, contrast va generated CSS deterministic ekanini tasdiqlang.
- [ ] **S41.03** Visual gate: 47-section style specificationdagi light/dark/high-contrast, mobile, projector va microstate matrix reviewed bo‘lsin.
- [ ] **S41.04** Accessibility gate: axe serious/critical 0, keyboard/screen-reader/zoom/reduced/forced-color tests pass bo‘lsin.
- [ ] **S41.05** Performance gate: CWV, bundle, image/font va long-frame budgetlar pass bo‘lsin.
- [ ] **S41.06** Content gate: no fake proof, no broken links, no mixed jargon, privacy/accessibility/status docs current bo‘lsin.
- [ ] **S41.07** Brand gate: Evidence Mark, Signal Rail, Response Mosaic va Three-view grammar approved asset docsga mos bo‘lsin.
- [ ] **S41.08** User evidence gate: official/mature/distinctive targetlar, first-click va critical task success acceptable bo‘lsin.
- [ ] **S41.09** Mature gamification gate: public low ranks hidden, optional leaderboard, reduced celebration va teacher controls ishlasin.
- [ ] **S41.10** Field gate: projector 3/8/15m, bright/dim, low-end mobile va real classroom pilot signed report bilan yopilsin.
- [ ] **S41.11** Governance gate: design-system owner, contribution process, deprecation policy, quarterly audit va exception expiry mavjud bo‘lsin.
- [ ] **S41.12** Launch sign-off product, design, frontend, accessibility, performance, security, content va teacher representative tomonidan yozma tasdiqlansin.

#### Final non-negotiables

```text
Light gray haze yo‘q
Generic blue-only identity yo‘q
Childish global gamification yo‘q
Raw component color yo‘q
transition: all yo‘q
Default decorative infinite motion yo‘q
Fake proof yo‘q
Public low-rank shame yo‘q
Director/Projector private boundary buzilmaydi
Compile/HTTP/a11y/performance failure bilan launch yo‘q
```

#### Tugallanish sharti

Name/logo olib tashlansa ham visual assetlar Edikitni tanitadi; product official, mature, distinctive, accessible va real classroomda ishlaydigan holatda productionga chiqadi.

---

## Yakuniy bajarish ketma-ketligi

```text
01 Baseline
02 Compile blockers
03 Visual harness
04 Tokens
05 Brand assets
06 Color/accessibility
07 Theme
08 Typography
09 Layout foundation
10 Motion
11 Base/focus
12 Buttons/icons
13 Forms
14 Selection/disclosure
15 Overlays/feedback
16 Loading/empty/error
17 Navigation
18 Tables/filters
19 Charts/evidence
20 Responsive
21 Landing IA
22 Landing visuals
23 Landing performance/trust
24 Authentication
25 Workspace home
26 Test library
27 Test builder
28 Cast Setup
29 Director
30 Projector
31 Participant
32 Mature gamification
33 Admin
34 Error/PWA
35 Content/i18n
36 Accessibility
37 Design lint/visual regression
38 Performance
39 User research
40 Rollout
41 Launch/governance
```

## Yakuniy deliverable checklist

- [ ] `style.md` final design authority sifatida saqlangan.
- [ ] 41 stepning har biri acceptance evidence bilan yopilgan.
- [ ] Har step uchun commit/PR va owner mavjud.
- [ ] All-view compile va HTTP smoke green.
- [ ] DTCG token source va generated CSS mavjud.
- [ ] Evidence-Led Institutional brand assets approved.
- [ ] Light/dark/high-contrast theme parity mavjud.
- [ ] Component state matrix to‘liq.
- [ ] Landing official va product-led.
- [ ] Teacher Workspace action-first.
- [ ] Cast Director/Projector/Participant alohida.
- [ ] Mature gamification privacy-safe.
- [ ] Admin credential-safe.
- [ ] WCAG 2.2 AA va COGA gates pass.
- [ ] Core Web Vitals va bundle budgets pass.
- [ ] Scientific user validation targetlari pass.
- [ ] Projector/real-class field tests pass.
- [ ] Legacy CSS va feature flags cleanup qilingan.
- [ ] Governance/quarterly audit process ishlaydi.
- [ ] Production launch sign-off mavjud.
