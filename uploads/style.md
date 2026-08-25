# Edikit Elite UI/UX — yakuniy visual design research va style specification

> **Holat:** final masterpiece research + repository audit + scientific/official redesign specification  
> **Sana:** 2026-07-29  
> **Fresh clone:** `https://github.com/jasur-ai/edikit.git`  
> **Audit commit:** `5447052` — `huh major ones`  
> **Scope:** distinctive official identity, landing, authentication, teacher workspace, test builder, Cast host/projector/participant, admin, light/dark/high-contrast theme, perceptual rang, mature gamification, typography, iconography, spacing, transition, motion, responsive, cognitive accessibility, projector va visual QA  
> **Research breadth:** 325 ta unique global official product, design-system, standards, peer-reviewed/academic, accessibility, HCI, brand-science va performance source  
> **Final authority:** qarama-qarshilik bo‘lsa 36–46-bo‘limlardagi scientific/official identity qarorlari oldingi draft qiymatlardan ustun  
> **Source code:** o‘zgartirilmagan; ushbu deliverable faqat `style.md`

---

## 0. Executive design qarori

Edikit uchun final yo‘nalish:

> **Evidence-Led Institutional — calm institutional precision + selective live-learning energy.**

Yaqqol tanituvchi assetlar:

```text
Evidence Mark
Signal Rail
Response Mosaic
Edikit Cobalt + Signal Cyan + Insight Amber
Ask → See → Adapt
Director + Projector + Participant three-view frame
```

Bu ikki qatlamga ajratiladi:

1. **Teacher Workspace:** sokin, aniq, professional, yuqori information density, neutral surfaces, minimal motion.
2. **Cast Experience:** fokuslangan, katta tipografiya, kuchli feedback, cheklangan energiya, accessibility-safe celebration.

Landing page teacherga quyidagi qiymatni ko‘rsatadi:

> **“Sinf nimani tushunganini shu zahoti ko‘ring.”**

Final style:

- default bootstrap ko‘rinishi emas;
- neon gaming clone emas;
- glassmorphism hamma joyda emas;
- ko‘k-kulrang xira light mode emas;
- har elementni animatsiya qiladigan “premium” motion emas;
- real product UI, real hierarchy va real pedagogik outcome markazda;
- dark va light alohida sifatli theme, bir-birining inversion’i emas;
- landing’da product-led storytelling;
- app’da task-led interface;
- Cast’da state-led interface.

### 0.1. Eng kuchli benchmarklardan olinadigan qismlar

| Benchmark | Olinadigan pattern | Edikitdagi joyi |
|---|---|---|
| Linear | restraint, scanability, consistent navigation | Teacher Workspace |
| Stripe | technical polish, product visualization | Landing hero/demo |
| Vercel Geist | neutral scale, disciplined light mode | Token system |
| GitHub Primer | functional color tokens, multi-theme contrast | Light/dark/high contrast |
| Atlassian | semantic motion tokens, short frequent motion | App transitions |
| Carbon | productive vs expressive motion, dense enterprise UI | Admin/analytics |
| GOV.UK | form clarity, errors, legibility | Auth/test builder |
| Material 3 | semantic color roles, state layers | Components |
| Apple HIG | clarity, safe-area, 44px targets | Mobile/participant |
| Framer | motion as product demonstration | Landing only |
| Kahoot | shape + color option identity | Cast answers |
| Mentimeter | clean public results and typography | Projector charts |
| Wayground | learner accommodations | Participant settings |
| Duolingo | state-driven celebration and feedback | Limited learning moments |
| Typeform | one-task focus and progressive disclosure | Setup/forms |

---

## 1. Fresh-clone repository audit

### 1.1. Audit qamrovi

Ko‘rilgan fayllar:

```text
public/css/style.css
public/css/admin.css
public/js/theme.js
public/js/main.js
views/index.ejs
views/user/login.ejs
views/user/panel.ejs
views/user/create-test.ejs
views/user/test-arena.ejs
views/game/host.ejs
views/game/enter.ejs
views/admin/login.ejs
views/admin/dashboard.ejs
views/admin/vip.ejs
views/error.ejs
views/partials/head.ejs
views/partials/nav.ejs
```

Browser audit:

- landing desktop dark;
- landing desktop light;
- landing mobile light, 390×844;
- user login desktop dark;
- user login desktop light;
- authenticated panel route;
- automated test output.

Static audit natijasi:

```text
UI files audited:            15
Unique hard-coded hex:       80
Hard-coded hex usage:       207
Unique rgba/rgb values:     156
rgba/rgb usage:             411
transition: all usage:       62
Infinite animation usage:    23
Inline-style lines:         165
!important usage:            31
```

### 1.2. P0 — sahifa render blocker

Fresh clone’da quyidagi ikkita authenticated sahifa EJS compile qilmaydi:

```text
views/user/panel.ejs:222
views/admin/dashboard.ejs:16
```

Noto‘g‘ri expression:

```ejs
<%- icon(.moon., 16) %>
```

To‘g‘ri expression:

```ejs
<%- icon('moon', 16) %>
```

Natija:

- `/user/panel` → HTTP 500;
- `/admin/dashboard` → HTTP 500;
- `npm test` → 5 ta failure;
- teacher workspace va admin UI’ni live browserda to‘liq tekshirib bo‘lmaydi.

Design release gate:

```text
Template compile
→ HTTP smoke
→ visual regression
→ accessibility
→ performance
```

Template compile’dan o‘tmagan build design reviewga kiritilmaydi.

### 1.3. Light mode’ning asosiy buzilishi

Current light palette:

```css
--bg-primary:    #C0C4D5;
--bg-surface:    #B4B8CB;
--bg-card:       #D0D4E3;
--bg-elevated:   #D8DCEA;
--text-primary:  #0E1326;
--text-secondary:#47516E;
--text-muted:    #8892B0;
--text-disabled: #B8BED4;
```

Bu palette oq emas, ammo butun ekran bo‘ylab bir xil yuqori-luminance blue-gray haze beradi. Surface hierarchy yo‘qoladi, uzoq qaralganda glare/washout hissi paydo bo‘ladi.

Measured contrast:

| Pair | Ratio | Status |
|---|---:|---|
| `text-primary` / `bg-primary` | 10.61:1 | pass |
| `text-secondary` / `bg-primary` | 4.53:1 | border pass |
| `text-secondary` / `bg-surface` | 3.99:1 | normal text fail |
| `text-muted` / `bg-primary` | 1.78:1 | severe fail |
| `text-muted` / `bg-surface` | 1.57:1 | severe fail |
| `text-muted` / `bg-card` | 2.09:1 | severe fail |
| `accent` / `bg-surface` | 2.62:1 | small text/control fail |
| `white` / `bg-card` | 1.48:1 | fail |

WCAG normal text uchun 4.5:1, meaningful control/graphic uchun 3:1 talab qiladi [S002][S003].

#### Light mode’dagi aniq muammolar

1. `--text-muted` deyarli barcha metadata, placeholder, hint va nav elementlarda ishlatilgan.
2. Light theme borderlar `rgba(15,22,48,.04–.10)` bo‘lib, input/card boundary ko‘rinmaydi.
3. Component CSS’da `rgba(255,255,255,.04)` ko‘p ishlatilgan; light mode’da state farqi yo‘qoladi.
4. Card va page background orasida aniq lightness hierarchy yo‘q.
5. Accent ko‘k small label sifatida ayrim light surfaces’da 3:1ga ham yetmaydi.
6. Disabled va placeholder holatlari normal metadata bilan aralashadi.
7. Login card light screenshotda fon bilan bir xil haze ichida qoladi.
8. Landing sectionlar oqim bo‘yicha ajralmaydi; butun sahifa bir rangli qatlamga aylanadi.
9. Theme-color meta `#DEE1ED`, real canvas `#C0C4D5`; browser chrome bilan page mos emas.
10. Projector/host uchun alohida calibrated light theme yo‘q.

### 1.4. Theme architecture drift

Hozir uchta parallel mechanism mavjud:

```text
html[data-theme="light"]
body.theme-light
body.light
```

Muammolar:

- global app ikki selectorni qo‘llaydi;
- host alohida `body.light` ishlatadi;
- game view’larda hard-coded dark colors qoladi;
- JS 20ms delay bilan `data-theme` va body classni alohida update qiladi;
- first-paint script defaultni doim dark qiladi, system preference ishlatilmaydi;
- theme transition barcha descendantlarga majburan tarqaladi.

Final source of truth:

```html
<html data-theme="system|light|dark" data-resolved-theme="light|dark">
```

Component hech qachon `body.light`, `theme-light` yoki raw hex asosida theme aniqlamaydi.

### 1.5. Theme transition muammosi

Current implementation:

```css
[data-theme-transition] * {
  transition:
    background-color 900ms,
    border-color 900ms,
    color 900ms,
    box-shadow 900ms !important;
}
```

Audit:

- 900ms utility transition theme’ni sekin his qildiradi;
- barcha DOM node’lar bir vaqtda style/paint update qiladi;
- `box-shadow` animatsiyasi katta repaint cost beradi;
- componentning normal hover timing’i `!important` bilan bosiladi;
- theme o‘tishida text va control 0.9 soniya “oraliq” xira holatda qoladi;
- reduced motion faqat shu global theme transitionga qisman qo‘llangan;
- landing’dagi 23 infinite animation reduced-motion’da o‘chirilmagan.

Final theme switch:

```text
Default: instant first paint
User toggle: 160–180ms root crossfade
Reduced motion: 0ms
No universal descendant transition
No box-shadow interpolation
```

### 1.6. Motion audit

Current:

- 62 ta `transition: all`;
- 23 ta infinite animation;
- hero particle drift;
- two orbit rings;
- pulsing badge;
- glowing join code;
- option shimmer;
- option sweep;
- leaderboard gleam;
- bouncing trophy/confetti;
- 900ms theme transition;
- hoverlarda `translateY(-5px) scale(1.03)`.

Motion hierarchy yo‘q. Frequent control, brand moment, loading, feedback va live state bir xil visual energiya bilan ishlatilgan.

Final motion classification:

```text
Productive motion  → frequent, 80–220ms
Spatial transition → modal/panel, 160–320ms
Expressive motion  → rare milestone, 400–900ms
Ambient motion     → default off
```

Atlassian frequent interactionlarni 50–150ms, modal/panelni 150–400ms oralig‘ida saqlaydi va reduced-motion’da motionni o‘chiradi [S053]. Carbon productive va expressive motionni ajratadi [S045].

### 1.7. Typography audit

Current typography:

```text
Body: Nunito 400–900
Display: Righteous
Small labels: .58–.76rem
Many controls: .7–.85rem
Most UI: weight 700–900
```

Muammolar:

1. Deyarli hamma element bold/extrabold; hierarchy weight orqali yo‘qoladi.
2. `.58rem` ≈ 9.3px, `.62rem` ≈ 9.9px, `.7rem` ≈ 11.2px.
3. Metadata va actions uzoq projector/desktop yoki low-density monitorlarda mayda.
4. Righteous question, title, code, leaderboard va headers’da ortiqcha ishlatilgan.
5. Uzbek apostrophe va Cyrillic glyph QA yo‘q.
6. Landing body copy desktopda juda kichik va product-value hierarchy past.
7. Full-page screenshotda UI “zoomed out” ko‘rinadi.
8. Font remote Google CSSga bog‘liq; offline/PWA’da fallback shift mumkin.
9. Variable font/optical sizing ishlatilmaydi.
10. Tabular numeric style yo‘q.

Final typography:

```text
Product UI: Inter Variable / system fallback
Marketing display: Manrope Variable
Code/numbers: IBM Plex Mono yoki ui-monospace
Righteous: faqat existing wordmark asset ichida
```

Body minimum 1rem, line-height 1.5–1.65. Normal body text 50–75ch. Text 200% zoom va custom spacingda kesilmaydi [S008][S137].

### 1.8. Landing page audit

Current landing:

```text
100vh centered hero
generic “Interaktiv Platforma”
3 equal CTAs: Boshlash / O‘yinga kirish / Admin
6 generic feature cards
4 text-only steps
demo statistics
technology badges
final CTA
```

#### P0/P1 content va trust muammolari

- `Official Platform v2.0` isbotsiz badge;
- `Edikit statistikasi` ichida demo stats real proof kabi ko‘rinadi;
- `5-xim` typo;
- `Node.js`, `Socket.io`, `Express`, `Local DB` teacher uchun product value emas;
- `Admin` CTA above-the-fold information architecture’ni buzadi;
- hero’da real product screenshot/demo yo‘q;
- teacher va participant journey birinchi ekranda aniq ajratilmagan;
- productning asosiy farqi — responsive teaching/Cast Director — ko‘rinmaydi;
- social proof, privacy/accessibility trust, case study yo‘q;
- hero max-width 600px va 100vh sabab katta bo‘shliq;
- mobile’da sectionlar bir xil card stackga aylangan;
- dark/light switch floating 40px target;
- footer public support/legal/product navigation bermaydi.

#### Visual muammolar

- particle/orbit dekoratsiyasi productni ko‘rsatmaydi;
- section cardlari bir-biriga juda o‘xshash;
- barcha feature bir xil visual weight;
- bento ichida real UI yo‘q;
- hover animation landing value propositiondan kuchliroq;
- dark screenshot professional, ammo juda qorong‘i va product proof’siz;
- light screenshot xira, low-contrast va washed out.

### 1.9. Authentication audit

Current login:

- centered 420px card;
- katta bo‘sh fon;
- all-caps micro labels;
- light mode’da input border va placeholder juda xira;
- login/register tab selected state yaxshi, ammo tab semantics yo‘q;
- inline CSS tokenlardan tashqari `rgba(255,255,255,...)` ishlatadi;
- theme button 40px;
- password affordance, show/hide, caps-lock, forgot/help yo‘q;
- public admin link login flowda keraksiz;
- error reserved space/state inconsistent;
- focus ring input box-shadow bilan mavjud, ammo border contrast theme bo‘yicha kafolatlanmagan.

### 1.10. Teacher panel audit

Live render P0 EJS xato sabab mavjud emas. Static audit:

- 820px max-width katta desktop uchun tor;
- Characters control navbar’da primary workspace actionlar bilan teng;
- nav actionlar ko‘p va label/icon consistency past;
- test cardda 4–5 action parallel ko‘rsatiladi;
- color semanticasi chalkash: edit blue, Cast green, mock purple, delete blue;
- destructive action red emas;
- accordion header `div onclick`, keyboard/ARIA yo‘q;
- modal optionlar `div onclick`, radio semantics yo‘q;
- search result CTA `Sinov`, source test actionlari bilan noaniq;
- typography juda mayda;
- multiple inline styles va hard-coded colors theme drift yaratadi;
- panel button/modal CSS global componentlardan ajralgan.

### 1.11. Test builder audit

- form page bir uzun column;
- emoji iconlar va text iconlar aralash;
- answer selection button semantik radio emas;
- question card hierarchy past;
- save action faqat page pastida;
- unsaved state ko‘rinmaydi;
- inline Excel upload primary authoring bilan bir xil weight;
- input labels placeholder ichiga yuklangan;
- hard-coded dark translucent surfaces light mode’da yo‘qoladi;
- validation field-level emas;
- question reorder affordance yo‘q;
- mobile option row siqiladi;
- correct state color + “✓” bor, lekin keyboard semantics yo‘q.

### 1.12. Cast host va participant audit

#### Host

- global token systemdan alohida `:root` palette;
- alohida `body.light`;
- hard-coded dark option cards;
- projector va Director bitta view;
- too many infinite glows/shimmers;
- question surface va options low information hierarchy;
- controls bottom fixed, status va action ajralmagan;
- manual/auto progression visual state yetarli emas;
- public screen’da host controls/private data boundary yo‘q;
- leaderboard animation always-on;
- display text uchun Righteous ortiqcha;
- light mode mixed dark/light.

#### Participant

- 4.5rem code mobile’da katta, lekin responsive global override bilan nomuvofiq;
- answer optionlarda constant shimmer/sweep;
- dark colors hard-coded;
- success/error feedback emoji-heavy;
- multiple screens `display:none/flex`, transition choreography yo‘q;
- muted texts light mode’da fail;
- player badge va timer screen corners’da collision qilishi mumkin;
- answer button semantics va focus states dynamic HTML’da audit qilinmagan;
- all animation reduced-motion’da to‘liq o‘chmaydi.

### 1.13. Admin audit

Live dashboard EJS compile qilmaydi. Static audit:

- 514-line admin CSS + 79 inline-style lines;
- cards, buttons, tables va statuslar ko‘p raw rgba ishlatadi;
- sidebar mobile’da shunchaki `display:none`, replacement navigation yo‘q;
- `.62rem`, `.68rem`, `.7rem` labels ko‘p;
- dashboard table’da password ko‘rsatish visual/security P0;
- VIP password toast orqali ko‘rsatish trust P0;
- light theme admin navbar’dan tashqari sistematik audit qilinmagan;
- data table density va hierarchy inconsistent;
- button style’lar JS template literal ichida takrorlangan;
- “premium glassmorphism” comment bor, ammo UI consistency yo‘q.

---

## 2. Final visual identity

### 2.1. Brand attributes

```text
Aniq
Ishonchli
Sokin
Zamonaviy
Pedagogik
Tezkor
Insoniy
```

### 2.2. Visual archetype

```text
Foundation: neutral institutional software
Accent: precise electric blue
Support: cyan only for realtime/connection
Celebration: amber, emerald, violet — rare and semantic
Shape: soft rectangular, not bubble arcade
Motion: restrained in app, expressive only in milestones
Density: comfortable default, compact admin option
```

### 2.3. Copy tone

- “premium”, “official”, “AI-powered” kabi o‘zini maqtovchi badge’larni ishlatmaslik;
- feature emas, teacher outcome bilan boshlash;
- action label verb bilan;
- English/Uzbek aralashmasini kamaytirish;
- “Shoxsupa”ni optional playful Cast copy’da saqlash, admin/report’da “Reyting” ishlatish;
- error blame qilmaydi;
- technical stack public landing’dan chiqariladi;
- fake metric ko‘rsatilmaydi.

### 2.4. Anti-style list

Taqiqlanadi:

- full-page gray-blue light canvas;
- 900ms global theme animation;
- `transition: all`;
- every-card lift;
- every-element glow;
- infinite ambient particles/orbits;
- glass card on glass background;
- 9–11px task-critical text;
- raw `#hex` component ichida;
- raw `rgba(255,255,255,...)` state color;
- emoji as primary iconography;
- three equal primary CTAs;
- Admin link as landing hero CTA;
- demo stats presented as live proof;
- technology badges as value proposition;
- public password display;
- color-only status;
- hover-only discoverability;
- decorative animation without reduced alternative.

---

## 3. Elite color system

### 3.1. Token architecture

Three layers:

```text
Primitive → Semantic → Component
```

Example:

```text
blue-600
→ action-primary-bg
→ button-primary-background
```

Component raw primitive ishlatmaydi. Primer base colorsni code’da to‘g‘ridan-to‘g‘ri ishlatmasdan functional token orqali ulaydi [S056].

### 3.2. Primitive neutral scale

#### Light-oriented neutral

```css
--neutral-0:   #FFFFFF;
--neutral-25:  #FAFBFD;
--neutral-50:  #F5F7FB;
--neutral-100: #EEF2F7;
--neutral-150: #E9EEF5;
--neutral-200: #DDE3EC;
--neutral-300: #CBD5E1;
--neutral-400: #AAB5C5;
--neutral-500: #7C8A9E;
--neutral-600: #657187;
--neutral-700: #465267;
--neutral-800: #293548;
--neutral-900: #172033;
--neutral-950: #0B1220;
```

#### Dark-oriented neutral

```css
--dark-0:   #080D18;
--dark-50:  #0B1220;
--dark-100: #111A2B;
--dark-150: #172237;
--dark-200: #1E2B42;
--dark-300: #2A3850;
--dark-400: #44546E;
--dark-500: #536580;
--dark-600: #6F7E96;
--dark-700: #8D99AE;
--dark-800: #A5B0C3;
--dark-900: #E5EAF2;
--dark-950: #F8FAFC;
```

### 3.3. Final light theme

Light mode pure-white canvas emas; soft neutral canvas va true-white elevated surfaces ishlatadi.

```css
[data-resolved-theme="light"] {
  color-scheme: light;

  --color-canvas:          #F5F7FB;
  --color-canvas-subtle:   #EEF2F7;
  --color-surface:         #FFFFFF;
  --color-surface-muted:   #F7F9FC;
  --color-surface-sunken:  #E9EEF5;
  --color-surface-raised:  #FFFFFF;
  --color-overlay:         rgba(17, 24, 39, .48);

  --color-text-strong:     #111827;
  --color-text:            #1F2937;
  --color-text-muted:      #566176;
  --color-text-subtle:     #657187;
  --color-text-disabled:   #8A95A8;
  --color-text-inverse:    #FFFFFF;

  --color-border-subtle:   #DDE3EC;
  --color-border:          #CBD5E1;
  --color-border-strong:   #7C8A9E;
  --color-divider:         #E3E8F0;

  --color-action:          #255EDB;
  --color-action-hover:    #1D4ED8;
  --color-action-active:   #173FAE;
  --color-action-soft:     #E8F0FF;
  --color-action-border:   #AFC7FA;

  --color-success:         #137A43;
  --color-success-soft:    #E8F7EF;
  --color-warning:         #9A5B00;
  --color-warning-soft:    #FFF4D6;
  --color-danger:          #C93434;
  --color-danger-soft:     #FDECEC;
  --color-info:            #255EDB;
  --color-info-soft:       #E8F0FF;

  --color-focus:           #0B63E5;
  --color-selection:       #D8E7FF;
}
```

#### Light hierarchy

```text
Canvas           #F5F7FB
Section alternate#EEF2F7
Card              #FFFFFF
Nested surface    #F7F9FC
Input             #FFFFFF
Control border    #7C8A9E when boundary is necessary
Divider           #E3E8F0 when grouping already exists
```

#### Light contrast targets

| Pair | Ratio target |
|---|---:|
| strong / canvas | 16.5:1 |
| normal / surface | 14.7:1 |
| muted / surface | 6.2:1 |
| subtle / surface | ≥4.9:1 |
| action / surface | 5.67:1 |
| white / action | 5.67:1 |
| danger / surface | 5.2:1 |
| success / surface | 5.4:1 |
| strong control border / white | 3.5:1 |

`--color-border-subtle` 3:1 talab qilinadigan input boundary uchun ishlatilmaydi. Input boundary kerak bo‘lsa `--color-border-strong` ishlatiladi [S003].

### 3.4. Final dark theme

```css
[data-resolved-theme="dark"] {
  color-scheme: dark;

  --color-canvas:          #080D18;
  --color-canvas-subtle:   #0B1220;
  --color-surface:         #111A2B;
  --color-surface-muted:   #0E1727;
  --color-surface-sunken:  #070B14;
  --color-surface-raised:  #172237;
  --color-overlay:         rgba(0, 0, 0, .68);

  --color-text-strong:     #F8FAFC;
  --color-text:            #E5EAF2;
  --color-text-muted:      #A5B0C3;
  --color-text-subtle:     #8D99AE;
  --color-text-disabled:   #6F7E96;
  --color-text-inverse:    #081323;

  --color-border-subtle:   #233149;
  --color-border:          #2A3850;
  --color-border-strong:   #536580;
  --color-divider:         #1E2B42;

  --color-action:          #4B83F3;
  --color-action-hover:    #6A9BFA;
  --color-action-active:   #2F6FEB;
  --color-action-soft:     #132B56;
  --color-action-border:   #315A9C;

  --color-success:         #3CCB7F;
  --color-success-soft:    #103523;
  --color-warning:         #F2B84B;
  --color-warning-soft:    #3D2A0B;
  --color-danger:          #FF6B6B;
  --color-danger-soft:     #421B22;
  --color-info:            #73A7FF;
  --color-info-soft:       #132B56;

  --color-focus:           #8BB7FF;
  --color-selection:       #1B417D;
}
```

#### Dark hierarchy

```text
Canvas       #080D18
Sidebar      #0B1220
Card         #111A2B
Raised       #172237
Overlay      rgba(0,0,0,.68)
Border       #2A3850
Control edge #536580
```

Dark mode’da depth faqat black shadow bilan emas, surface lightness + border orqali beriladi.

### 3.5. Projector theme

Projector theme global app theme’dan alohida:

```text
Focus Dark — default
Focus Light — bright classroom
High Contrast Dark
High Contrast Light
```

Projector uchun:

- decorative ambient gradients 0–3% opacity;
- text strong ratio ≥7:1 target;
- question and options solid surface;
- timer state color + number + label;
- correct/wrong color + icon + text;
- distant-view test: 3m, 8m, 15m;
- projector washout test.

### 3.6. Answer option palette

Option identity color-only bo‘lmaydi:

```text
A — triangle + red
B — circle + blue
C — diamond + amber
D — square + green
E — star + violet
```

Light:

```css
--option-a: #B4233A;
--option-b: #1F5FBF;
--option-c: #8A5A00;
--option-d: #137A43;
--option-e: #7047A8;
```

Dark:

```css
--option-a: #FF758A;
--option-b: #73A7FF;
--option-c: #F2B84B;
--option-d: #52D68B;
--option-e: #C3A1FF;
```

Full-color background o‘rniga:

```text
surface + 2px semantic border + icon chip + left accent rail
```

Selected:

```text
3px border + check marker + subtle tint
```

Correct:

```text
success border + check icon + “To‘g‘ri javob”
```

Incorrect:

```text
danger border + x icon + “Siz tanlagan javob”
```

### 3.7. Data visualization palette

Categorical:

```css
--chart-1: #255EDB;
--chart-2: #137A43;
--chart-3: #9A5B00;
--chart-4: #7047A8;
--chart-5: #B23B78;
--chart-6: #207A8A;
```

Rules:

- max 6 categorical series default;
- labels/tooltips/table alternative;
- line dash/marker shapes;
- no red/green-only comparison;
- 3:1 meaningful chart mark contrast target;
- distribution chart answer symbol bilan bog‘lanadi;
- exact data table accessible alternative;
- chart animation first renderda 180–240ms, updatesda 120ms yoki instant.

USWDS simple chart, limited concepts, text summary va accessible table talablarini qo‘llaydi [S074].

---

## 4. Typography system

### 4.1. Font stack

```css
--font-display: "Manrope Variable", "Manrope", system-ui, sans-serif;
--font-body: "Inter Variable", "Inter", ui-sans-serif, system-ui, sans-serif;
--font-mono: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace;
```

Self-hosted WOFF2:

```text
Inter Variable latin + cyrillic
Manrope Variable latin + cyrillic verification
IBM Plex Mono required subset
font-display: swap
```

If Manrope Cyrillic/Uzbek coverage QA’dan o‘tmasa display ham Inter ishlatadi.

### 4.2. Type scale

```css
--font-size-00: .75rem;   /* 12px — badge/noncritical only */
--font-size-0:  .875rem;  /* 14px — metadata */
--font-size-1:  1rem;     /* 16px — body/control */
--font-size-2:  1.125rem; /* 18px — emphasized body */
--font-size-3:  1.25rem;  /* 20px — small heading */
--font-size-4:  1.5rem;   /* 24px */
--font-size-5:  2rem;     /* 32px */
--font-size-6:  2.5rem;   /* 40px */
--font-size-7:  3.5rem;   /* 56px landing hero */
--font-size-8:  4.5rem;   /* 72px projector/code */
```

No task-critical text below 14px. No landing body below 16px.

### 4.3. Semantic roles

| Role | Desktop | Mobile | Weight | Line-height |
|---|---:|---:|---:|---:|
| Landing hero | 56–64px | 40–44px | 700 | 1.05 |
| Page title | 32–40px | 28–32px | 700 | 1.15 |
| Section title | 28–36px | 24–28px | 700 | 1.2 |
| Card title | 18–20px | 17–18px | 650 | 1.3 |
| Body large | 18px | 17px | 400–500 | 1.6 |
| Body | 16px | 16px | 400–500 | 1.55 |
| UI label | 14px | 14px | 550–600 | 1.4 |
| Metadata | 14px | 14px | 450–500 | 1.4 |
| Badge | 12px | 12px | 600 | 1.2 |
| Projector question | 36–64px | n/a | 650 | 1.2 |
| Projector option | 28–40px | n/a | 600 | 1.25 |

### 4.4. Typography rules

- body left-aligned;
- centered text faqat hero, empty state, projector celebration;
- body max 65ch;
- paragraph line-height 1.55–1.65;
- UI line-height 1.3–1.45;
- heading tracking `-0.02em` max;
- all-caps faqat 12px eyebrow, letter spacing `.08em`;
- badge max 2 words;
- numbers `font-variant-numeric: tabular-nums`;
- join code letter spacing responsive;
- underline links on hover/focus va long-form contentda default;
- 200% zoom;
- text spacing override QA;
- Uzbek `O‘`, `G‘`, apostrophe variants va Cyrillic QA.

---

## 5. Spacing, grid va density

### 5.1. Base scale

```css
--space-0: 0;
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
--space-10: 40px;
--space-12: 48px;
--space-16: 64px;
--space-20: 80px;
--space-24: 96px;
```

Current 2, 4, 6, 8, 10, 12, 14, 16, 18... scale o‘rniga 4px primitive va semantic spacing ishlatiladi.

### 5.2. Containerlar

```text
Landing max:       1200px
Product workspace: 1280px
Reading content:   720px / 65ch
Auth form:         420–460px
Modal small:       420px
Modal medium:      640px
Setup Studio:      880–960px
Projector:         viewport-based
```

### 5.3. Grid

```text
Desktop ≥1200: 12 columns, 24px gutter
Tablet 768–1199: 8 columns, 20px gutter
Mobile <768: 4 columns, 16px gutter
Small <390: 4 columns, 12px edge
```

### 5.4. App density

Default comfortable:

```text
Control height 40px desktop
Primary action 44px
Mobile action 48px
Table row 44px
Card padding 16–20px
Section gap 32px
```

Compact admin optional:

```text
Control 36px
Table row 36–40px
Card padding 12–16px
Typography minimum 13–14px
```

### 5.5. Radius

```css
--radius-xs:  6px;
--radius-sm:  8px;
--radius-md: 12px;
--radius-lg: 16px;
--radius-xl: 20px;
--radius-pill: 999px;
```

Rules:

- input/button: 8–10px;
- card: 12–16px;
- modal: 16–20px;
- pill faqat status/chip;
- hamma card 22–28px emas;
- nested radius parentdan 4px kichik.

### 5.6. Elevation

Light:

```css
--shadow-1: 0 1px 2px rgba(17,24,39,.05), 0 1px 3px rgba(17,24,39,.04);
--shadow-2: 0 8px 24px rgba(17,24,39,.08);
--shadow-3: 0 20px 50px rgba(17,24,39,.14);
```

Dark:

```text
surface contrast + border first
shadow only overlay/modal
no glow for standard card
```

Elevation levels:

```text
0 canvas
1 surface/card
2 sticky/dropdown
3 modal/popover
4 toast/critical overlay
```

---

## 6. Motion va transition system

### 6.1. Motion principles

```text
State’ni tushuntiradi
Darhol boshlanadi
Frequent actionda juda qisqa
Next actionni bloklamaydi
Bitta focal point
Reduced motionda to‘liq usable
```

### 6.2. Duration tokens

```css
--motion-instant: 0ms;
--motion-quick:   80ms;
--motion-fast:   120ms;
--motion-ui:     160ms;
--motion-panel:  220ms;
--motion-page:   320ms;
--motion-brand:  500ms;
```

Usage:

| Event | Enter | Exit |
|---|---:|---:|
| hover/focus color | 80–120ms | 80ms |
| button press | 80ms | 100ms |
| tooltip | 120ms | 80ms |
| dropdown/popover | 140–160ms | 100–120ms |
| toast | 180ms | 140ms |
| modal | 200–220ms | 160ms |
| side panel | 220–280ms | 180–220ms |
| page/major phase | 240–320ms | 180–240ms |
| celebration | 500–900ms once | n/a |
| theme | 160–180ms | same |

### 6.3. Easing

```css
--ease-standard: cubic-bezier(.2, 0, 0, 1);
--ease-enter:    cubic-bezier(.16, 1, .3, 1);
--ease-exit:     cubic-bezier(.4, 0, 1, 1);
--ease-emphasis: cubic-bezier(.2, .8, .2, 1);
```

No bounce/spring in productivity UI. Controlled spring only achievement badge/avatar once.

### 6.4. Property rules

Allowed default:

```text
transform
opacity
background-color
border-color
color
```

Avoid:

```text
width
height
margin
padding
left/top
filter blur on large areas
box-shadow animation
background gradient animation
```

Web performance uchun transform/opacity compositor path afzal [S017][S018].

### 6.5. Component motion recipes

#### Button

```css
transition:
  background-color 120ms var(--ease-standard),
  border-color 120ms var(--ease-standard),
  color 120ms var(--ease-standard),
  transform 80ms var(--ease-standard);
```

```text
hover: optional translateY(-1px), no scale
active: translateY(0) scale(.99)
keyboard focus: no transform
```

#### Card

- static card hover animation yo‘q;
- clickable card border/surface 120ms;
- lift max `translateY(-1px)`;
- no universal card shadow jump.

#### Modal

```text
overlay opacity 0→1, 160ms
panel opacity + translateY(8px) + scale(.985→1), 200ms
exit 140–160ms
focus after panel mounted
```

#### Accordion

```text
chevron rotate 160ms
content grid-template-rows 0fr→1fr, 180–220ms
reduced motion instant
```

#### Toast

```text
enter opacity + translateY(8px), 180ms
exit opacity, 140ms
auto-dismiss progress animation not required
```

#### Cast phase

```text
current content fade out 120ms
new content fade/translate in 200ms
no full-screen zoom
answer confirmation 160ms
leaderboard rows 40ms stagger, max 5 rows
```

### 6.6. Theme transition implementation

State:

```text
system
light
dark
```

First paint:

1. local preference read;
2. no local value bo‘lsa `prefers-color-scheme`;
3. `data-resolved-theme` head ichida paintdan oldin qo‘yiladi;
4. `meta[name=theme-color]` exact canvas token bilan update qilinadi;
5. `color-scheme` property native controlsga qo‘llanadi.

User toggle:

```text
View Transition API available + no reduced motion
→ 180ms crossfade
otherwise
→ root theme instant yoki 120ms canvas/text transition
```

Never:

```css
[data-theme-transition] * { transition: ... !important; }
```

### 6.7. Reduced motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
  }
}
```

Qo‘shimcha:

- particle/orbit DOM umuman render qilinmaydi;
- shimmer static surfacega aylanadi;
- countdown number qoladi, ring smooth animation yo‘q;
- confetti static success illustrationga aylanadi;
- parallax ishlatilmaydi;
- auto-start ambient motion default yo‘q.

---

## 7. Landing page — to‘liq redesign blueprint

### 7.1. Information architecture

```text
1. Utility navigation
2. Product-led hero
3. Real product proof
4. Teacher outcome strip
5. Responsive teaching story
6. Three-view architecture
7. Workflow
8. Accessibility + reliability
9. Ready-made tests/templates
10. Honest proof/testimonials
11. Final CTA
12. Product footer
```

### 7.2. Navigation

Desktop:

```text
Logo
Mahsulot
O‘qituvchilar uchun
Edikit Cast
Tayyor testlar
Resurslar
[Theme]
[Kirish]
[Bepul boshlash]
```

Mobile:

```text
Logo
[Kod bilan kirish]
[Menu]
```

Rules:

- admin link footer utility ichida yoki dedicated domain;
- participant code entry high-frequency path;
- sticky nav 64px;
- light: white/92% surface + subtle border;
- dark: canvas/88% + border;
- blur max 12px, low-power fallback opaque;
- skip link first focusable.

### 7.3. Hero copy

Eyebrow:

```text
O‘qituvchilar uchun jonli baholash
```

H1:

```text
Sinf nimani tushunganini shu zahoti ko‘ring.
```

Subtitle:

```text
Test yarating, Edikit Cast orqali javoblarni real vaqtda oling
va darsni natijaga qarab moslashtiring.
```

Primary CTA:

```text
Bepul boshlash
```

Secondary CTA:

```text
Jonli demoni ko‘rish
```

Participant shortcut:

```text
Kodingiz bormi? O‘yinga kiring →
```

Microcopy:

```text
Karta talab qilinmaydi · O‘quvchilar ilova o‘rnatmaydi
```

### 7.4. Hero layout

Desktop:

```text
6-column copy | 6-column real product composition
```

Product composition:

```text
Director View large base
Projector View offset behind
Participant phone front-right
small live signal: 24/30 javob berdi
small teacher action: Muhokama tavsiya etiladi
```

Rules:

- real UI component/screenshot;
- fake dashboard data emas, clearly labeled demo;
- screenshot text legible;
- no meaningless abstract orb;
- no floating 3D object;
- no six infinite particles;
- hero min-height `min(760px, calc(100svh - 64px))`, forced 100vh emas;
- content first viewportda product proof bilan ko‘rinadi.

### 7.5. Hero motion

```text
nav: no entrance
copy: opacity + 8px, 220ms
CTA: same group, 40ms stagger
product frame: opacity + 12px, 280ms
live signal: once after 350ms
no infinite movement
```

Reduced motion:

```text
all content final state immediately
```

### 7.6. Product proof section

Title:

```text
Bir savol. Butun sinf haqida aniq signal.
```

Interactive demo tabs:

```text
Savol berish
Javoblarni ko‘rish
Muhokama qilish
Qayta tekshirish
```

Tab content real Edikit UI snapshot. Tab auto-rotate qilmaydi. Keyboard arrow navigation va manual selection.

### 7.7. Outcome bento

Bento 3 dominant storyga ega:

1. **Live evidence** — katta 2×2 card, Director distribution.
2. **Responsive action** — discuss/reteach/move-on control.
3. **Student-safe competition** — private progress/Top 5 policy.

Secondary cards:

- confidence lens;
- misconception map;
- team challenge;
- quick prompt;
- post-Cast action pack.

Har card:

```text
outcome heading
one-sentence explanation
real product crop
no generic icon-only card
```

### 7.8. Three-view section

```text
Director — teacher private evidence and control
Projector — clean shared classroom view
Participant — fast accessible answering
```

Desktop sticky text + view switcher. Mobile stacked cards.

### 7.9. How it works

Current 4 identical cards o‘rniga connected workflow:

```text
1. Testni tanlang yoki yarating
2. Cast rejimini sozlang
3. Kod bilan sinfni ulang
4. Javobga qarab darsni boshqaring
```

Real mini UI va connector line. Mobile connector vertical.

### 7.10. Accessibility va reliability section

Visible trust items:

```text
Savol har qurilmada
Reduced motion
High contrast
Keyboard support
Low-bandwidth recovery
Private-by-default leaderboard
```

“100% secure” yoki “cheatingni to‘liq oldini oladi” claim ishlatilmaydi.

### 7.11. Social proof

Productionda real proof bo‘lmaguncha:

```text
fake logo wall yo‘q
fake testimonial yo‘q
fake user count yo‘q
```

Allowed:

- pilot teacher quote with consent;
- actual sessions/teachers count computed from production;
- dated institution case study;
- uptime/status link.

### 7.12. Final CTA

Heading:

```text
Keyingi darsni taxmin bilan emas, dalil bilan boshqaring.
```

Actions:

```text
Bepul boshlash
Demo Castni ochish
```

### 7.13. Footer

Columns:

```text
Mahsulot
O‘qituvchilar
Resurslar
Xavfsizlik va accessibility
Kompaniya
```

Utility:

```text
Privacy
Terms
Status
Accessibility
Til
Theme
Admin login — low-emphasis utility
```

`Node.js Edition`, `Local DB` va stack badges olib tashlanadi.

---

## 8. Product page redesign specifications

### 8.1. Authentication

Desktop option A:

```text
Left 5 columns: short value proposition + product crop
Right 7 columns: 440px auth card
```

Desktop option B for minimal release:

```text
single centered card + compact trust/footer
max vertical blank area 20vh
```

Auth card:

```text
Logo
Title
Short subtitle
Login/Register segmented control
Visible labels
Inputs
Password show/hide
Primary action
Help links
```

Rules:

- form label 14px/600;
- input 48px mobile, 44px desktop;
- input background semantic surface;
- control border ≥3:1 if boundary required;
- placeholder not label;
- error field ostida;
- error summary submitda;
- caps-lock hint;
- password reveal accessible name;
- selected tab `aria-selected`;
- form remains usable without motion;
- public admin link primary auth flowdan chiqariladi;
- theme button header/footerda 44px;
- no glass blur on low-power mobile.

### 8.2. Teacher Workspace

Final desktop layout:

```text
64px top bar
240px optional left navigation
main 12-column workspace
max 1280px
```

Navigation:

```text
Bosh sahifa
Mening testlarim
Tayyor testlar
Natijalar
Cast sessiyalar
Shablonlar
```

Header:

```text
Salom, {name}
Dars uchun nima tayyorlaymiz?
[Yangi test] primary
[Quick Prompt] secondary
```

Test library toolbar:

```text
Search
Owner/source filter
Subject filter
Sort
View density
```

Test row/card:

```text
Title
Question count
Updated date
Visibility/status
Last result
[Cast] primary contextual action
[More] menu: Edit, Duplicate, Share, Delete
```

Rules:

- delete overflow menu ichida danger;
- Characters workspace navbar’dan olib tashlanadi;
- VIP status icon/banner emas, account entitlement ichida;
- ready-made Mock/PRE nomlari user-friendly taxonomyga o‘tkaziladi;
- accordion only when true hierarchy exists;
- empty state title + explanation + primary next action;
- skeleton initial load;
- inline retry on fetch error;
- mobile list, not compressed desktop cards.

### 8.3. Test Builder

Desktop:

```text
Sticky top bar: back, title, save state, Preview, Save
Left outline: question list
Center: selected question editor
Right properties: timing, scoring, explanation, tags
```

First release simplified:

```text
sticky top action bar
720px editor column
question outline drawer
```

Question card/editor:

- visible question number;
- type selector;
- stem label + textarea;
- media slot;
- answer options as rows;
- radio/checkbox semantics;
- correct answer status icon + label;
- explanation field;
- duplicate/delete in overflow;
- drag handle + keyboard move controls;
- autosave status;
- field-level validation;
- error summary;
- preview.

Excel import:

```text
secondary “Import” action
modal with template/download/upload/validation preview
not full-width primary block
```

Mobile:

- single selected question;
- sticky bottom actions;
- option row wraps cleanly;
- no three-column layout;
- keyboard does not cover save action.

### 8.4. Cast Setup Studio

Layout:

```text
Header: test title + question count
Mode cards
Essentials
Advanced accordion
Preflight summary
Sticky footer
```

Mode card state:

```text
rest
hover
selected
focus
recommended
disabled + reason
```

Visual rules:

- selected = 2px action border + check + soft surface;
- not selected = neutral surface;
- no animated scale;
- warning amber, blocker danger;
- duration and privacy summary visible;
- mobile full-screen dialog;
- desktop 880–960px dialog;
- focus trap and restore;
- radio semantics.

### 8.5. Cast Director

Visual principle:

```text
Current state first
Next action second
Evidence third
Decorative content last
```

Desktop:

```text
Top status bar
Main question/projector preview: 7 cols
Teacher-private evidence: 5 cols
Bottom control rail
```

Evidence cards:

```text
24/30 javob berdi
79% to‘g‘ri
Dominant distractor B
2 technical issue
```

Primary actions:

```text
Pause
+15s
Close answers
Reveal
Discuss
Reteach
Next
```

Rules:

- destructive End separated top-right/overflow;
- button colors semantic, not rainbow;
- only one primary filled action per state;
- pending command spinner inside action;
- state revision/recovery banner;
- no tiny 12px labels;
- no infinite glow/shimmer;
- teacher/private data never Projector style layerga aralashmaydi.

### 8.6. Projector

Lobby:

```text
join URL + code
QR
participant count
teacher-controlled instructions
```

Question:

```text
question 36–64px
options 28–40px
meta 20–32px
code 48–120px
```

Rules:

- max 2 text hierarchy levels;
- safe area 5vw;
- no small muted copy;
- option surfaces solid;
- answer shapes visible;
- timer number + ring;
- public distribution only teacher command bilan;
- Top N only;
- projector bright-room Focus Light;
- 4:3/16:9/overscan;
- no host nav/control.

### 8.7. Participant

Join:

```text
code
name/safe alias
avatar optional
join
```

Question:

```text
question on device
large answer targets
selected state
submit/ACK state
network state
```

Rules:

- 48px target minimum preferred;
- answer full row, not tiny card;
- no hover dependency;
- no constant shimmer;
- answer color + symbol + letter + text;
- saved state explicit;
- timer accessible text;
- bottom safe-area padding;
- personal mute/reduced motion;
- result feedback once, 160–240ms;
- celebration optional;
- long option wraps, no fixed height;
- 320px reflow.

### 8.8. Admin

Style:

```text
Neutral enterprise dashboard
Compact density option
No brand-gradient overload
No glassmorphism dependency
```

Layout:

```text
64px top bar
220px sidebar desktop
bottom sheet/drawer navigation mobile
main max 1440px
```

Table:

- sticky header;
- 14px minimum body;
- 40–44px rows;
- right-aligned numbers;
- tabular numerals;
- status badge with text;
- row actions menu;
- responsive card fallback only when table cannot reflow;
- keyboard sort/filter;
- loading skeleton;
- empty/error state.

P0 UI/security removals:

```text
password column
plain password toast
password delivery in page text
```

### 8.9. Errors, empty states, loading

#### Error

Structure:

```text
What happened
What user can do
Primary recovery action
Secondary support/reference
```

No raw stack/error code in normal UI. Reference ID can be shown.

#### Empty state

Types:

```text
first use
filtered no-result
permission
system error
completed state
```

Each has different title/action. Carbon empty-state patterns are used [S143].

#### Loading

- skeleton for structured content;
- spinner only compact unknown-duration action;
- button pending retains label/width;
- no full-screen blocking loader after initial shell;
- `aria-busy` and status;
- skeleton motion reduced/none.

#### Toast

- success disappears after 3–5s;
- error persistent until read/action where needed;
- top-right desktop, bottom safe-area mobile;
- max 3 visible;
- no critical-only toast;
- live region;
- no inline JS CSS string.

---

## 9. Component system

### 9.1. Button variants

```text
Primary
Secondary
Quiet
Danger
Link
Icon
```

Sizes:

```text
S 32px — dense desktop only
M 40px — default
L 48px — mobile/primary
```

States:

```text
rest
hover
active
focus-visible
loading
disabled
selected where applicable
```

Rules:

- one primary per action group;
- icon + text for ambiguous action;
- icon-only has tooltip and accessible name;
- danger only destructive;
- disabled reason available nearby;
- no opacity-only disabled if state still must be understood.

### 9.2. Input

Anatomy:

```text
Label
Optional/required indicator
Input
Hint
Error
Character count
```

States:

```text
rest
hover
focus
filled
error
warning
disabled
read-only
loading
```

No placeholder-only labels. Error red + icon + text.

### 9.3. Card

Variants:

```text
Static surface
Interactive card
Metric card
Media card
Selectable card
```

Static card hover animation yo‘q. Selectable card radio/checkbox semantics bilan.

### 9.4. Navigation

- text label + icon;
- active state soft fill + text weight + indicator;
- hover is not active;
- keyboard order visual orderga mos;
- mobile replacement defined;
- no hidden desktop sidebar without mobile nav.

### 9.5. Modal/dialog

- native `<dialog>` yoki APG semantics;
- title mandatory;
- close button 44px;
- focus trap;
- initial focus chosen by task;
- Escape;
- focus restore;
- destructive confirmation names object/action;
- mobile full-screen when content long;
- nested modal taqiqlanadi.

### 9.6. Accordion

- header `<button>`;
- `aria-expanded`;
- `aria-controls`;
- keyboard native;
- chevron decorative;
- no `div onclick`.

### 9.7. Tabs

- `tablist`, `tab`, `tabpanel`;
- arrow-key navigation;
- selected underline/fill;
- deep link where relevant;
- content does not auto-rotate.

### 9.8. Status badges

Semantic:

```text
neutral
info
success
warning
danger
```

Badge text 1–2 words. Color + text. No badge rainbow for decorative categorization.

### 9.9. Tables

- `<table>` semantics;
- sticky header;
- sortable column button;
- active sort announcement;
- horizontal overflow with visible affordance;
- first column sticky only if necessary;
- row action menu;
- empty/loading/error row;
- mobile priority columns or alternate list;
- exact numbers right-aligned.

### 9.10. Charts

- visible title;
- text takeaway;
- accessible data table;
- direct labels preferred;
- legend keyboard accessible;
- tooltips not hover-only;
- color + shape/pattern;
- no 3D chart;
- no pie with many categories;
- no animation required to understand.

---

## 10. Responsive va device specification

### 10.1. Breakpoints

Content-driven starting points:

```css
--bp-sm:  480px;
--bp-md:  768px;
--bp-lg: 1024px;
--bp-xl: 1280px;
--bp-2xl:1536px;
```

Component container query afzal; page media query faqat major layout.

### 10.2. Mobile rules

- `100dvh`/`100svh`, forced `100vh` emas;
- safe-area env padding;
- sticky primary action keyboard bilan collision qilmaydi;
- 48px high-frequency controls;
- adjacent targets 8px;
- no horizontal scroll 320px;
- input font 16px iOS zoomni cheklash uchun;
- bottom controls thumb zone’da;
- desktop hover affordance mobileda visible;
- table alternate view;
- nav drawer focus trap;
- orientation change.

### 10.3. Tablet

- teacher Director landscape priority;
- 8-column grid;
- sidebar collapsible;
- split panes minimum 360px each;
- touch first, hover optional;
- projector external display preview.

### 10.4. Projector

- 720p/1080p;
- 4:3/16:9;
- browser zoom;
- overscan;
- bright/dim room;
- 3m/8m/15m;
- washout and low contrast;
- mirrored display;
- no small utility controls.

---

## 11. Accessibility specification

Target: WCAG 2.2 AA; selected AAA motion and focus practices [S001].

### 11.1. Contrast

```text
Normal text      ≥4.5:1
Large text       ≥3:1
Meaningful UI    ≥3:1
Focus indicator  ≥3:1 against adjacent
Body target      ≥7:1 where practical
```

Every semantic token pair automatically tested in light/dark/high contrast.

### 11.2. Focus

```css
:focus-visible {
  outline: 3px solid var(--color-focus);
  outline-offset: 3px;
}
```

- not obscured by sticky bars;
- dialog focus trap;
- skip link;
- no outline removal;
- selected and focus states distinct;
- forced-colors support.

### 11.3. Touch targets

```text
WCAG AA minimum 24×24 with spacing
Edikit preferred 44×44
Participant frequent target 48×48+
```

Theme floating current 40×40 → 44×44 minimum.

### 11.4. Motion

- system reduced motion honored;
- site-level motion setting optional;
- all infinite decorative motion removed/default off;
- no flashing;
- no large sweep/parallax;
- state understandable without motion;
- audio/haptic not sole feedback.

### 11.5. Forms

- visible labels;
- programmatic errors;
- required state;
- error summary;
- autocomplete;
- password manager support;
- accessible auth;
- no cognitive puzzle requirement;
- no placeholder as instruction.

### 11.6. Color vision

- no color-only correct/wrong;
- option shape + letter;
- chart marker/pattern;
- status icon + text;
- grayscale test;
- deuteranopia/protanopia/tritanopia simulation.

### 11.7. Screen reader

- semantic headings;
- landmark regions;
- button vs link correctness;
- live status throttling;
- timer threshold announcements;
- answer-saved message;
- chart summary/table;
- modal names;
- accordion/tabs patterns.

### 11.8. Zoom/reflow

- 200% zoom normal QA;
- 400%/320px reflow critical pages;
- no clipped text;
- no fixed-height text containers;
- custom text spacing test;
- landscape small-height test.

---

## 12. Performance specification

### 12.1. Targets

```text
LCP ≤2.5s p75
INP ≤200ms p75
CLS ≤0.1 p75
Landing JS initial ≤150KB gzip target
Critical CSS ≤35KB gzip target
No long animation frame >50ms during common interaction
```

### 12.2. Current risks

- 788-line landing with inline CSS;
- 753-line global CSS;
- 62 `transition: all`;
- 23 infinite animations;
- universal theme transition;
- multiple fixed radial gradient layers;
- backdrop filters;
- remote fonts;
- duplicated inline styles;
- third-party CDN scripts globally loaded;
- Socket.IO CDN loaded on every page through `head.ejs` even landing/auth;
- service worker stale CSS risk.

### 12.3. Final loading strategy

- Socket client only Cast pages;
- XLSX only import/admin page;
- self-host variable fonts;
- landing CSS external and minified;
- critical hero CSS small;
- offscreen sections `content-visibility:auto` after testing;
- real screenshots WebP/AVIF with dimensions;
- no lazy load hero LCP visual;
- lazy load below-fold product images;
- component CSS split by route;
- service worker versioned assets;
- RUM Web Vitals;
- Lighthouse CI.

### 12.4. Animation performance

- transform/opacity first;
- no large blur animation;
- no continuous box-shadow;
- no layout property animation;
- `will-change` only immediately before motion and removed after;
- no 60fps timer necessity;
- reduced-motion static;
- low-power mode disables brand motion.

---

## 13. Content design va localization

### 13.1. Language

Primary:

```text
uz-Latn
```

Supported architecture:

```text
uz-Cyrl
ru
en
future RTL
```

Rules:

- UI English/Uzbek aralashmasi yo‘q;
- “Real-time Multiplayer” → “Jonli sinf sessiyasi”;
- “Mock Fanlar” → user mental model bo‘yicha “Tayyor fan testlari”;
- “PRE Testlar” → institution termin tasdiqlamaguncha expansion/description;
- “Characters” → “Qahramonlar” va secondary settings;
- “Cast” product name sifatida saqlanishi mumkin;
- “Admin” public primary navda yo‘q;
- “5-xim” → “6 xonali” yoki real implementationga mos;
- locale text expansion 30–50%.

### 13.2. Error formula

```text
Nima bo‘ldi
+ qaysi qism affected
+ user nima qilishi mumkin
```

Example:

```text
Sessiyaga ulanib bo‘lmadi. Internet aloqangizni tekshirib, qayta urinib ko‘ring.
```

### 13.3. Button labels

Good:

```text
Test yaratish
Lobby ochish
Javoblarni yopish
15 soniya qo‘shish
Natijani yuklab olish
```

Avoid:

```text
Davom etish
OK
Ha
Start
Submit
```

Context yetarli bo‘lmasa object/action nomi ishlatiladi.

---

## 14. Visual QA va governance

### 14.1. Automated gates

```text
EJS compile all views
HTTP 200/expected status
axe critical pages
contrast token matrix
raw color linter
transition-all linter
infinite-animation linter
screenshot light/dark/mobile/projector
Lighthouse CI
bundle budget
```

### 14.2. Raw-style budget

Current baseline:

```text
207 hex uses
411 rgba/rgb uses
165 inline-style lines
62 transition:all
23 infinite animations
31 !important
```

Release target:

```text
Component raw hex: 0
Component raw rgba state: 0
Inline style for visual design: 0
transition: all: 0
Infinite decorative animation: 0 default
!important: only documented compatibility exception
```

### 14.3. Visual regression matrix

Pages:

```text
Landing
User login/register
Teacher panel
Test builder empty/filled/error
Cast setup
Host lobby/question/reveal/leaderboard
Participant join/question/saved/result
Projector
Admin dashboard/table/modal
404/500
```

Modes:

```text
Light
Dark
System
Reduced motion
High contrast
Forced colors
```

Viewport:

```text
320×568
390×844
768×1024
1024×768
1280×800
1440×900
1920×1080
4:3 projector
```

States:

```text
rest
hover
focus
active
selected
disabled
loading
empty
error
long text
RTL
```

### 14.4. Manual reviews

- 5-second landing comprehension;
- first-click teacher start;
- participant join timing;
- projector distance;
- bright-room light theme;
- low-end Android;
- keyboard-only;
- NVDA/VoiceOver;
- color vision simulation;
- teacher dense-workflow review;
- student motion/pressure review.

### 14.5. Design review scorecard

Har page 0–2:

```text
Hierarchy
Clarity
Consistency
Contrast
Typography
Spacing
Motion purpose
Responsive behavior
Accessibility
Performance
Content accuracy
Trust
```

Ship threshold:

```text
No 0
Total ≥21/24
P0 = 0
P1 accepted = 0
```

---

## 15. Prioritet roadmap

### Gate 0 — buildni ko‘rish mumkin qilish

1. `icon(.moon., 16)` EJS xatolarini tuzatish.
2. All-view compile test qo‘shish.
3. Authenticated screenshot auditni qayta ishlatish.
4. Password display UI’ni olib tashlash.

### Release D1 — Foundation

1. semantic color tokens;
2. new light/dark palettes;
3. one theme source of truth;
4. typography;
5. spacing/radius/elevation;
6. motion tokens;
7. focus/reduced motion;
8. component raw colors removal;
9. visual regression baseline.

### Release D2 — Landing + Auth

1. landing IA;
2. product-led hero;
3. real product composition;
4. outcome bento;
5. three-view section;
6. honest proof;
7. footer;
8. auth redesign;
9. mobile and Core Web Vitals.

### Release D3 — Teacher Workspace

1. workspace navigation;
2. test library;
3. search/filter/sort;
4. test action hierarchy;
5. empty/loading/error states;
6. builder layout;
7. import modal;
8. autosave/validation.

### Release D4 — Cast Experience

1. Director/Projector split;
2. lobby;
3. participant answer controls;
4. option palette/shapes;
5. projector themes;
6. leaderboard privacy visual;
7. phase motion;
8. audio/motion preferences;
9. bright-room tests.

### Release D5 — Admin + Governance

1. admin table/density;
2. mobile navigation;
3. charts/accessibility;
4. component extraction;
5. design lint;
6. Storybook-equivalent component gallery;
7. design token documentation;
8. design QA ownership.

---

## 16. Final acceptance criteria

### Light mode

- [ ] Canvas haze yo‘q.
- [ ] Surface hierarchy aniq.
- [ ] Muted text ≥4.5:1.
- [ ] Meaningful control edge ≥3:1.
- [ ] Input boundary ko‘rinadi.
- [ ] Accent small text contrastdan o‘tadi.
- [ ] Bright-room projector testdan o‘tadi.
- [ ] Dark hard-coded surface qolmagan.

### Dark mode

- [ ] Near-black canvas va raised surfaces ajraladi.
- [ ] Neon/glow faqat rare status.
- [ ] Muted text readable.
- [ ] Black shadow depthning yagona vositasi emas.
- [ ] Focus aniq.
- [ ] Option colorlar ko‘zni qamashtirmaydi.

### Motion

- [ ] `transition: all` yo‘q.
- [ ] 900ms global theme transition yo‘q.
- [ ] Infinite ambient animation default yo‘q.
- [ ] Frequent motion ≤160ms.
- [ ] Exit enter’dan tez.
- [ ] Reduced motionda critical flow to‘liq ishlaydi.
- [ ] Motion next actionni bloklamaydi.

### Landing

- [ ] H1 teacher outcome’ni aytadi.
- [ ] Product first viewportda ko‘rinadi.
- [ ] Bitta primary CTA.
- [ ] Participant join shortcut aniq.
- [ ] Admin primary CTA emas.
- [ ] Fake proof/stat yo‘q.
- [ ] Technology badges yo‘q.
- [ ] Real screenshots/demo mavjud.
- [ ] Mobile hero compact.

### Product UI

- [ ] Teacher panel HTTP 200.
- [ ] Admin dashboard HTTP 200.
- [ ] Body text ≥16px.
- [ ] Metadata ≥14px.
- [ ] Touch target ≥44px preferred.
- [ ] Keyboard patterns ishlaydi.
- [ ] Light/dark parity mavjud.
- [ ] Empty/loading/error states bor.
- [ ] Raw visual inline style yo‘q.
- [ ] Visual regressions approved.

---

## 17. Curated “eng zo‘r” benchmarklar

### 17.1. Final shortlist

| Rank | System/product | Eng kuchli qismi | Edikit oladi | Edikit olmaydi |
|---:|---|---|---|---|
| 1 | GitHub Primer | functional theme tokens | neutral/light/dark scales, contrast gates | GitHub brand look |
| 2 | Linear | restraint va scanability | workspace density, consistent headers | all-dark developer aesthetic |
| 3 | Atlassian Motion | semantic motion | 50–150ms frequent motion, reduced parity | broad brand expression |
| 4 | Vercel Geist | precise light mode | true-white surfaces, neutral hierarchy | monochrome-only identity |
| 5 | Carbon | enterprise structure | productive motion, dense admin/data | IBM visual identity |
| 6 | Stripe | product storytelling | real product visualization, polish | heavy WebGL gradient |
| 7 | GOV.UK | form clarity | labels, errors, task-first flow | government visual branding |
| 8 | Material 3 | semantic roles | primary/on-primary/surface/state model | generic Material component look |
| 9 | Apple HIG | clarity and touch | safe areas, 44px targets, restraint | platform-specific glass styling |
| 10 | Framer | motion demo | landing-only product demonstration | constant kinetic typography |
| 11 | Mentimeter | public presentation | clean projector results, simple charts | slide-builder scope |
| 12 | Kahoot | recognizable answers | shape + color + text identity | speed-first/shaming defaults |
| 13 | Wayground | accommodation layer | learner settings and focus support | visual clutter |
| 14 | Typeform | one-task focus | progressive form/setup | one-question flow everywhere |
| 15 | Duolingo | stateful feedback | rare milestone celebration | addictive/streak pressure |
| 16 | USWDS | accessibility | chart/table equivalents, color discipline | federal visual style |
| 17 | Radix Colors | theme scales | semantic palettes and alpha scales | library visual defaults |
| 18 | Spectrum | typography/color system | component state completeness | Adobe branding |
| 19 | Shopify Polaris | content/product discipline | admin patterns, semantic copy | commerce-specific flows |
| 20 | Slido | frictionless joining | code/QR public join simplicity | enterprise event branding |

### 17.2. Elite standard

Edikit redesign “premium” deb comment yozilgani bilan premium bo‘lmaydi. Elite standard:

```text
Visual restraint
+ exact hierarchy
+ honest product proof
+ semantic tokens
+ theme parity
+ motion purpose
+ accessibility by default
+ real-browser QA
+ performance budget
+ consistent content language
```

---

## 18. 150-source global research index

### A. Web standards, accessibility va performance — S001–S030

- **S001 — W3C WCAG 2.2:** https://www.w3.org/TR/WCAG22/
- **S002 — W3C Contrast Minimum:** https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- **S003 — W3C Non-text Contrast:** https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
- **S004 — W3C Focus Appearance:** https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html
- **S005 — W3C Target Size Minimum:** https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- **S006 — W3C Animation from Interactions:** https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html
- **S007 — W3C Pause, Stop, Hide:** https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html
- **S008 — W3C Text Spacing:** https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html
- **S009 — W3C Reflow:** https://www.w3.org/WAI/WCAG22/Understanding/reflow.html
- **S010 — W3C Use of Color:** https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html
- **S011 — MDN prefers-reduced-motion:** https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
- **S012 — MDN prefers-color-scheme:** https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-color-scheme
- **S013 — MDN forced-colors:** https://developer.mozilla.org/en-US/docs/Web/CSS/@media/forced-colors
- **S014 — MDN color-scheme:** https://developer.mozilla.org/en-US/docs/Web/CSS/color-scheme
- **S015 — MDN View Transition API:** https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API
- **S016 — web.dev View Transitions for SPAs:** https://web.dev/learn/css/view-transitions-spas
- **S017 — web.dev High-performance CSS animations:** https://web.dev/articles/animations-guide
- **S018 — web.dev CSS for Web Vitals:** https://web.dev/articles/css-web-vitals
- **S019 — web.dev Web Vitals:** https://web.dev/articles/vitals
- **S020 — web.dev LCP:** https://web.dev/articles/lcp
- **S021 — web.dev INP:** https://web.dev/articles/inp
- **S022 — web.dev CLS:** https://web.dev/articles/cls
- **S023 — web.dev Font best practices:** https://web.dev/articles/font-best-practices
- **S024 — web.dev Browser-level image lazy loading:** https://web.dev/articles/browser-level-image-lazy-loading
- **S025 — MDN content-visibility:** https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility
- **S026 — W3C Design Tokens Format:** https://www.designtokens.org/tr/drafts/format/
- **S027 — WAI-ARIA Authoring Practices:** https://www.w3.org/WAI/ARIA/apg/
- **S028 — WAI-ARIA Modal Dialog Pattern:** https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- **S029 — WAI-ARIA Accordion Pattern:** https://www.w3.org/WAI/ARIA/apg/patterns/accordion/
- **S030 — WAI Accessible Name Guidance:** https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions/

### B. Global design systems — S031–S085

- **S031 — Material Design 3:** https://m3.material.io/
- **S032 — Material 3 Color Overview:** https://m3.material.io/styles/color/overview
- **S033 — Material 3 Motion Overview:** https://m3.material.io/styles/motion/overview
- **S034 — Material Duration and Easing:** https://m1.material.io/motion/duration-easing.html
- **S035 — Apple Human Interface Guidelines:** https://developer.apple.com/design/human-interface-guidelines/
- **S036 — Apple HIG Color:** https://developer.apple.com/design/human-interface-guidelines/color
- **S037 — Apple HIG Layout:** https://developer.apple.com/design/human-interface-guidelines/layout
- **S038 — Apple HIG Motion:** https://developer.apple.com/design/human-interface-guidelines/motion
- **S039 — Fluent 2 Design System:** https://fluent2.microsoft.design/
- **S040 — Fluent 2 Color:** https://fluent2.microsoft.design/color
- **S041 — Fluent 2 Motion:** https://fluent2.microsoft.design/motion
- **S042 — Carbon Design System:** https://carbondesignsystem.com/
- **S043 — Carbon Color Overview:** https://carbondesignsystem.com/elements/color/overview/
- **S044 — Carbon Themes:** https://carbondesignsystem.com/elements/themes/overview/
- **S045 — Carbon Motion:** https://carbondesignsystem.com/elements/motion/overview/
- **S046 — Carbon 2x Grid:** https://carbondesignsystem.com/elements/2x-grid/overview/
- **S047 — Carbon Typography:** https://carbondesignsystem.com/elements/typography/overview/
- **S048 — Carbon Form:** https://carbondesignsystem.com/components/form/usage/
- **S049 — Atlassian Design System:** https://atlassian.design/
- **S050 — Atlassian Color:** https://atlassian.design/foundations/color
- **S051 — Atlassian Typography:** https://atlassian.design/foundations/typography
- **S052 — Atlassian Spacing:** https://atlassian.design/foundations/spacing
- **S053 — Atlassian Motion:** https://atlassian.design/foundations/motion
- **S054 — Atlassian Components:** https://atlassian.design/components
- **S055 — GitHub Primer:** https://primer.style/
- **S056 — Primer Color Usage:** https://primer.style/product/getting-started/foundations/color-usage/
- **S057 — Primer Color Primitives:** https://primer.style/product/primitives/color/
- **S058 — Primer Typography:** https://primer.style/product/getting-started/foundations/typography/
- **S059 — Primer Layout:** https://primer.style/product/getting-started/foundations/layout/
- **S060 — Shopify Polaris:** https://polaris.shopify.com/
- **S061 — Polaris Colors:** https://polaris.shopify.com/design/colors
- **S062 — Polaris Typography:** https://polaris.shopify.com/design/typography
- **S063 — Polaris Motion:** https://polaris.shopify.com/design/motion
- **S064 — Vercel Geist:** https://vercel.com/geist
- **S065 — Vercel Geist design.md:** https://vercel.com/design.md
- **S066 — Vercel Geist Colors:** https://vercel.com/geist/colors
- **S067 — Radix Colors:** https://www.radix-ui.com/colors
- **S068 — Adobe Spectrum:** https://spectrum.adobe.com/
- **S069 — Spectrum Color:** https://spectrum.adobe.com/page/color/
- **S070 — Spectrum Typography:** https://spectrum.adobe.com/page/typography/
- **S071 — U.S. Web Design System:** https://designsystem.digital.gov/
- **S072 — USWDS Color Tokens:** https://designsystem.digital.gov/design-tokens/color/overview/
- **S073 — USWDS Typesetting:** https://designsystem.digital.gov/design-tokens/typesetting/overview/
- **S074 — USWDS Data Visualizations:** https://designsystem.digital.gov/components/data-visualizations/
- **S075 — GOV.UK Design System:** https://design-system.service.gov.uk/
- **S076 — GOV.UK Layout:** https://design-system.service.gov.uk/styles/layout/
- **S077 — GOV.UK Type Scale:** https://design-system.service.gov.uk/styles/type-scale/
- **S078 — GOV.UK Error Message:** https://design-system.service.gov.uk/components/error-message/
- **S079 — NHS Design System:** https://service-manual.nhs.uk/design-system
- **S080 — AWS Cloudscape:** https://cloudscape.design/
- **S081 — Ant Design:** https://ant.design/docs/spec/introduce/
- **S082 — Material UI Palette:** https://mui.com/material-ui/customization/palette/
- **S083 — Salesforce Lightning Design System:** https://www.lightningdesignsystem.com/
- **S084 — Twilio Paste:** https://paste.twilio.design/
- **S085 — GitLab Pajamas:** https://design.gitlab.com/

### C. Best-in-class product va landing pages — S086–S110

- **S086 — Linear:** https://linear.app/
- **S087 — Linear UI Refresh:** https://linear.app/changelog/2026-03-12-ui-refresh
- **S088 — Stripe:** https://stripe.com/
- **S089 — Stripe Connect Front-end Experience:** https://stripe.com/blog/connect-front-end-experience
- **S090 — Vercel:** https://vercel.com/
- **S091 — Framer:** https://www.framer.com/
- **S092 — Framer Accessibility Settings:** https://www.framer.com/academy/lessons/framer-seo-site-settings
- **S093 — Webflow:** https://webflow.com/
- **S094 — Notion:** https://www.notion.so/product
- **S095 — Figma:** https://www.figma.com/
- **S096 — Miro:** https://miro.com/
- **S097 — Canva:** https://www.canva.com/
- **S098 — Pitch:** https://pitch.com/
- **S099 — Gamma:** https://gamma.app/
- **S100 — Slack:** https://slack.com/
- **S101 — Loom:** https://www.loom.com/
- **S102 — Asana:** https://asana.com/
- **S103 — Airtable:** https://www.airtable.com/
- **S104 — Typeform:** https://www.typeform.com/
- **S105 — Intercom:** https://www.intercom.com/
- **S106 — HubSpot:** https://www.hubspot.com/
- **S107 — Raycast:** https://www.raycast.com/
- **S108 — Attio:** https://attio.com/
- **S109 — Supabase:** https://supabase.com/
- **S110 — Resend:** https://resend.com/

### D. EdTech, live polling va learning products — S111–S135

- **S111 — Kahoot!:** https://kahoot.com/
- **S112 — Kahoot! Accessibility:** https://kahoot.com/accessibility-policy/
- **S113 — Wayground:** https://wayground.com/
- **S114 — Wayground Session Settings:** https://help.wayground.com/support/solutions/articles/158000404930-navigate-session-settings
- **S115 — Mentimeter:** https://www.mentimeter.com/
- **S116 — Mentimeter Accessibility:** https://www.mentimeter.com/accessibility
- **S117 — Slido:** https://www.slido.com/
- **S118 — Slido Accessibility:** https://community.slido.com/about-slido-32/accessibility-at-slido-533
- **S119 — Vevox:** https://www.vevox.com/
- **S120 — Wooclap:** https://www.wooclap.com/
- **S121 — Nearpod:** https://nearpod.com/
- **S122 — Pear Deck:** https://www.peardeck.com/
- **S123 — Socrative:** https://www.socrative.com/
- **S124 — iClicker:** https://www.iclicker.com/
- **S125 — Poll Everywhere:** https://www.polleverywhere.com/
- **S126 — AhaSlides:** https://ahaslides.com/
- **S127 — Quizlet:** https://quizlet.com/
- **S128 — Gimkit:** https://www.gimkit.com/
- **S129 — Blooket:** https://www.blooket.com/
- **S130 — Plickers:** https://www.plickers.com/
- **S131 — Duolingo Brand Guidelines:** https://design.duolingo.com/
- **S132 — Duolingo Character Animation:** https://blog.duolingo.com/world-character-visemes/
- **S133 — Brilliant:** https://brilliant.org/
- **S134 — Khan Academy:** https://www.khanacademy.org/
- **S135 — Moodle Accessibility:** https://docs.moodle.org/500/en/Accessibility

### E. UX, visual design va data presentation — S136–S150

- **S136 — Nielsen Norman: 10 Usability Heuristics:** https://www.nngroup.com/articles/ten-usability-heuristics/
- **S137 — Nielsen Norman: Visual Design Study Guide:** https://www.nngroup.com/articles/visual-design-in-ux-study-guide/
- **S138 — Nielsen Norman: 5 Visual Design Principles:** https://www.nngroup.com/articles/principles-visual-design/
- **S139 — Nielsen Norman: Aesthetic-Usability Effect:** https://www.nngroup.com/articles/aesthetic-usability-effect/
- **S140 — Nielsen Norman: Heuristics for Complex Applications:** https://www.nngroup.com/articles/usability-heuristics-complex-applications/
- **S141 — Nielsen Norman: Validate Visual Design:** https://www.nngroup.com/videos/validate-visual-design/
- **S142 — Baymard: Selection Buttons:** https://baymard.com/blog/use-buttons-for-size-selection
- **S143 — Carbon Empty States:** https://v10.carbondesignsystem.com/patterns/empty-states-pattern/
- **S144 — Atlassian Designing Messages:** https://atlassian.design/foundations/content/designing-messages
- **S145 — UK Government Dashboard Design and Accessibility:** https://analysisfunction.civilservice.gov.uk/policy-store/data-visualisation-testing-dashboards-for-design-and-accessibility/
- **S146 — Carnegie Mellon Data Visualization Guidelines:** https://www.cmu.edu/brand/brand-guidelines/data-viz.html
- **S147 — WebAIM Contrast Checker:** https://webaim.org/resources/contrastchecker/
- **S148 — Section 508 Accessible QR Codes:** https://www.section508.gov/blog/accessibility-bytes/qr-codes/
- **S149 — W3C Structural RTL Markup:** https://www.w3.org/International/questions/qa-html-dir
- **S150 — W3C Declaring Language in HTML:** https://www.w3.org/International/questions/qa-html-language-declarations

---

## 19. Kuchaytirilgan research — qolgan gaplar auditi

Birinchi 150-source pass design foundationni yopdi. Ikkinchi pass quyidagi nozik qatlamlarni qo‘shadi:

1. sRGB hex bilan cheklanmagan perceptual color authoring;
2. OKLCH → sRGB fallback → WCAG verification pipeline;
3. alpha compositing va gradientning eng yomon contrast nuqtasi;
4. light/dark’dan tashqari high-contrast va forced-colors;
5. color-vision-deficiency uchun semantic redundancy;
6. motionning interruptibility, continuity va event priority qoidalari;
7. modern View Transitions, `@starting-style` va discrete transition chegaralari;
8. variable font metrics, `size-adjust`, Cyrillic/Uzbek glyph QA;
9. teacher dashboardda “overview → diagnose → act” information architecture;
10. classroom projectorning bright-room va distance-specific talablari;
11. cognitive accessibility va working-memory cheklovlari;
12. landing’ning visitor-intent va honest-proof modeli;
13. componentning barcha microstate’lari;
14. mobile, short-height, foldable, safe-area va container-query behavior;
15. design token standard, governance va automated drift control;
16. motion/content/color uchun quantitative QA.

Fresh-clone auditdagi P0 render blockerlar o‘zgarmaydi: style implementationdan oldin EJS compile gate majburiy.

---

## 20. Perceptual color masterpiece

### 20.1. Color pipeline

Final color workflow:

```text
Brand intent
→ OKLCH primitive scale
→ gamut mapping
→ sRGB hex fallback
→ semantic aliases
→ component tokens
→ alpha-composited contrast test
→ light/dark/high-contrast/CVD screenshot test
→ projector field test
```

OKLCH palette yaratishni tartibli qiladi, lekin accessibility pass o‘rniga o‘tmaydi. Normative WCAG contrast productiondagi final composited sRGB/fallback qiymatlarda hisoblanadi. APCA faqat qo‘shimcha perceptual signal; WCAG 2.2 AA release gate sifatida qoladi [S151][S152][S157][S160].

### 20.2. Key palette’ning OKLCH master qiymatlari

Light:

```css
--master-light-canvas:  oklch(97.58% 0.0057 264.5); /* #F5F7FB */
--master-light-muted:   oklch(95.95% 0.0080 253.9); /* #EEF2F7 */
--master-light-surface: oklch(100% 0 0);            /* #FFFFFF */
--master-light-strong:  oklch(21.01% 0.0318 264.7); /* #111827 */
--master-light-text:    oklch(27.81% 0.0296 256.8); /* #1F2937 */
--master-light-muted-t: oklch(49.12% 0.0364 263.3); /* #566176 */
--master-light-border:  oklch(62.91% 0.0343 257.3); /* #7C8A9E */
--master-light-action:  oklch(52.32% 0.2007 262.9); /* #255EDB */
--master-light-success: oklch(51.10% 0.1237 153.4); /* #137A43 */
--master-light-warning: oklch(53.10% 0.1190 65.1);  /* #9A5B00 */
--master-light-danger:  oklch(55.52% 0.1861 25.7);  /* #C93434 */
```

Dark:

```css
--master-dark-canvas:   oklch(16.00% 0.0249 264.6); /* #080D18 */
--master-dark-subtle:   oklch(18.31% 0.0309 263.4); /* #0B1220 */
--master-dark-surface:  oklch(21.83% 0.0362 262.5); /* #111A2B */
--master-dark-raised:   oklch(25.28% 0.0430 262.6); /* #172237 */
--master-dark-strong:   oklch(98.42% 0.0034 247.9); /* #F8FAFC */
--master-dark-text:     oklch(93.56% 0.0121 259.8); /* #E5EAF2 */
--master-dark-muted:    oklch(75.47% 0.0300 261.5); /* #A5B0C3 */
--master-dark-subtle-t: oklch(68.04% 0.0340 261.7); /* #8D99AE */
--master-dark-control:  oklch(50.26% 0.0486 258.3); /* #536580 */
--master-dark-action:   oklch(62.91% 0.1783 262.5); /* #4B83F3 */
--master-dark-success:  oklch(74.87% 0.1632 155.3); /* #3CCB7F */
--master-dark-warning:  oklch(81.65% 0.1399 80.1);  /* #F2B84B */
--master-dark-danger:   oklch(71.16% 0.1812 22.8);  /* #FF6B6B */
```

Production output har token uchun ikkita qiymat beradi:

```css
--color-action: #255EDB;
--color-action: oklch(52.32% 0.2007 262.9);
```

### 20.3. Theme scale qoidalari

Light neutral scale:

```text
L 100–95: canvas/surface
L 94–88: nested/sunken surfaces
L 80–63: borders/disabled only
L 55–46: muted readable text
L 30–16: normal/strong text
```

Dark neutral scale:

```text
L 14–18: canvas
L 19–23: standard surface
L 24–29: raised/selected surface
L 45–55: control edge
L 65–78: muted text
L 90–99: normal/strong text
```

Light va dark bir scale’ning oddiy reversal’i emas. Semantic role ikkala theme’da alohida visual testdan o‘tadi.

### 20.4. Alpha compositing qoidasi

Current code’dagi `rgba(255,255,255,.04)` kabi tokenlar mustaqil rang emas. Final contrast composited rangda o‘lchanadi:

```text
result = foreground × alpha + background × (1 − alpha)
```

QA har alpha tokenni quyidagilarda test qiladi:

```text
canvas
surface
raised surface
selected surface
projector light
projector dark
```

Alpha state tokenlari:

```css
--state-hover-neutral:  color-mix(in oklch, currentColor 6%, transparent);
--state-pressed-neutral:color-mix(in oklch, currentColor 10%, transparent);
--state-selected-action:color-mix(in oklch, var(--color-action) 12%, transparent);
--state-focus-action:   color-mix(in oklch, var(--color-action) 18%, transparent);
```

Build sRGB fallbackni oldindan generatsiya qiladi. Dynamic `currentColor` state real browser screenshot bilan tekshiriladi.

### 20.5. Surface contrast budget

Light:

```text
canvas → surface delta: visible, calm
surface → raised: shadow + border, not brighter white
nested → parent: at least one of fill/border/spacing distinguishes
```

Dark:

```text
adjacent surfaces: minimum perceptual L delta ≈ 3–5 points
interactive selected: fill + border + marker
modal: overlay + raised surface + focus trap
```

Barcha qatlamlarni border bilan o‘rash taqiqlanadi. Common region spacing va background yetarli bo‘lsa divider ishlatilmaydi.

### 20.6. Gradient policy

Allowed:

- landing hero ambient, max 2 radial sources;
- brand CTA subtle 2-stop gradient;
- milestone illustration;
- projector background registry.

Forbidden:

- body text ostida moving gradient;
- input/card default background gradient;
- every button gradient;
- dark→dark muddy multi-stop;
- contrast tekshirilmagan text-over-gradient.

Text gradient ustida bo‘lsa gradientning eng past contrast nuqtasi test qilinadi. Scrim bilan ratio barqaror qilinadi.

### 20.7. High contrast va forced colors

Theme modes:

```text
system
light
dark
high-contrast-light
high-contrast-dark
forced-colors — OS authority
```

High contrast:

- decorative surface farqi kamayadi;
- borders kuchayadi;
- shadows dependency olib tashlanadi;
- focus 3px + offset;
- muted text normal textga yaqinlashadi;
- chart patterns va direct labels majburiy;
- transparent control boundary system colorsga map qilinadi.

Forced colors:

```css
@media (forced-colors: active) {
  .control { border: 1px solid ButtonText; }
  .control[aria-pressed="true"] { outline: 2px solid Highlight; }
  .focusable:focus-visible { outline-color: Highlight; }
}
```

`forced-color-adjust:none` faqat answer swatch yoki zarur brand preview kabi tor istisnoda.

### 20.8. Color vision deficiency

Har status ikki yoki undan ko‘p channel bilan:

```text
color + icon
color + text
color + shape
color + border style
```

Cast answer:

```text
A triangle
B circle
C diamond
D square
E star
```

Charts:

- 6 category default maximum;
- marker shape;
- line dash;
- direct label;
- grayscale screenshot;
- protanopia/deuteranopia/tritanopia simulation;
- no rainbow/jet scale;
- sequential data uchun perceptually monotonic palette;
- missing data uchun neutral pattern.

### 20.9. Theme adaptation

System preference live change:

- user explicit choice bo‘lmasa follow;
- explicit choice system eventni override qiladi;
- setting `System / Light / Dark` uchta option;
- projector theme session setting, OS theme emas;
- print always light print tokens;
- exported screenshots/report approved theme bilan;
- browser native controls `color-scheme` bilan.

---

## 21. Motion masterpiece — semantic choreography

### 21.1. Motion token architecture

```text
Primitive duration/easing
→ semantic intent
→ component recipe
```

Primitive:

```css
--duration-0: 0ms;
--duration-1: 80ms;
--duration-2: 120ms;
--duration-3: 160ms;
--duration-4: 220ms;
--duration-5: 320ms;
--duration-6: 500ms;
--duration-7: 800ms;
```

Semantic:

```css
--motion-feedback:  var(--duration-1);
--motion-hover:     var(--duration-2);
--motion-popup-in:  var(--duration-3);
--motion-popup-out: var(--duration-2);
--motion-modal-in:  var(--duration-4);
--motion-modal-out: var(--duration-3);
--motion-page:      var(--duration-5);
--motion-milestone: var(--duration-6);
```

NN/G 100–400msni ko‘p UI transitions uchun mos, 200–300msni substantial screen changes uchun mos va 500msni ko‘pincha drag sifatida belgilaydi [S171].

### 21.2. Motion intent taxonomy

| Intent | Misol | Duration | Motion |
|---|---|---:|---|
| feedback | press, saved | 80–120 | color/scale .99 |
| reveal | tooltip/dropdown | 120–160 | opacity + 4px |
| spatial | drawer/modal | 180–280 | opacity + axis move |
| continuity | card→detail | 220–320 | named element optional |
| status | reconnect | 160–220 | icon/state crossfade |
| attention | warning | 180 once | outline/tint, no shake default |
| milestone | session complete | 500–800 once | illustration/confetti optional |
| ambient | decoration | off | none |

### 21.3. Interruptibility

Har interactive animation interruptible:

- current computed state’dan yangi state’ga o‘tadi;
- user reverse qilsa finish kutmaydi;
- repeated command queue yig‘maydi;
- latest state wins;
- disabled/loading animation pointer state bilan mos;
- route/state mutation animation callback’iga bog‘lanmaydi;
- timeout duration tokenni source-of-truth qilmaydi.

CSS transition high-frequency toggle uchun keyframe’dan afzal. Keyframe milestone/controlled sequence uchun.

### 21.4. Enter/exit asymmetry

```text
Enter: contextni o‘qish uchun biroz uzun
Exit: tezroq, next taskni to‘smasin
```

Ratio:

```text
exit ≈ enter × 0.65–0.8
```

Examples:

```text
tooltip 120 / 80
popover 160 / 110
modal 220 / 160
drawer 280 / 210
toast 180 / 140
```

### 21.5. Distance va size

- 2–8px micro move: 120–180ms;
- 8–24px panel enter: 180–240ms;
- 25% viewport drawer: 220–280ms;
- full page: crossfade 220–320ms;
- diagonal movement default yo‘q;
- x va y bir vaqtning o‘zida competition qilmaydi;
- large text scale animation yo‘q.

### 21.6. Modern CSS enhancement

Allowed progressive enhancement:

```text
@starting-style — popover/toast enter
transition-behavior: allow-discrete — dialog/popover exit
View Transitions — route or theme crossfade
scroll-driven — rare nonessential landing demo
```

Baseline static-first:

```css
.reveal { opacity: 1; transform: none; }

@media (prefers-reduced-motion: no-preference) {
  @supports (animation-timeline: view()) {
    .reveal {
      animation: reveal linear both;
      animation-timeline: view();
      animation-range: entry 10% entry 35%;
    }
  }
}
```

No supported API contentni `opacity:0`da qoldirmaydi.

### 21.7. View Transition chegarasi

Use:

- teacher panel list→detail;
- landing product demo tab;
- theme root crossfade;
- Cast non-timed scene change only.

Do not use:

- every navigation;
- live answer counter;
- timer;
- high-frequency filters;
- screen reader focus mutationni kechiktirish;
- 10+ named GPU snapshot.

Focus/DOM state transitiondan oldin semantically correct bo‘ladi. Visual snapshot accessibility tree source-of-truth emas.

### 21.8. Cast state choreography

```text
LOBBY → READY
public: count/status crossfade 160ms
host: controls update instant + 120ms tint

THINK → QUESTION_OPEN
question stays; answer controls fade in 160ms
no full-screen cut

OPEN → SAVED
participant: selected border 80ms, saved chip 160ms
no bounce loop

LOCK → PRIVATE_EVIDENCE
Director panel reveal 220ms
Projector remains unchanged

EVIDENCE → DISCUSS
instruction panel 220ms
chart does not reshuffle theatrically

REVEAL
correct option emphasis 180ms
incorrect dims to .72, not .45
explanation 220ms

LEADERBOARD
Top 5 rows 40ms stagger
max total stagger 200ms

ENDED
one 500–800ms optional celebration
static equivalent
```

### 21.9. Loading motion

- <300ms expected: no loader;
- 300ms–2s action: inline spinner/status;
- structured page load: skeleton;
- measurable >2s: determinate progress;
- indeterminate long task: stage text + cancel/background;
- skeleton shimmer off in reduced motion;
- full-screen spinner only initial critical shell;
- spinner does not replace action label entirely.

### 21.10. Audio va haptic choreography

Motion, audio va haptic bir eventga uch marta attention talab qilmasin.

```text
answer saved → visual primary, haptic optional, no sound default
correct reveal → projector visual, SFX host-controlled
warning → visual + text, no alarming sound default
session complete → optional SFX + optional celebration
```

Mute va reduced motion mustaqil settings.

---

## 22. Landing masterpiece — visitor-intent architecture

### 22.1. Visitor segments

| Visitor | 5-second savol | Primary path |
|---|---|---|
| Teacher new | Bu nima va menga nima beradi? | Demo → signup |
| Teacher returning | Panelga qanday kiraman? | Kirish |
| Participant | Kodni qayerga yozaman? | Code entry |
| Institution | Ishonchli va boshqariladimi? | Security/accessibility/contact |
| Admin | Operational access | footer utility/dedicated route |

Hero teacher-first. Participant path top nav’da tez. Admin hero’da yo‘q.

### 22.2. Five-second test acceptance

5 soniyadan keyin respondent javob bera oladi:

```text
Nima? — jonli assessment/responsive teaching platform
Kim uchun? — o‘qituvchi va sinf
Asosiy foyda? — real-time understanding signal
Next action? — bepul boshlash yoki demo
```

Success threshold:

```text
≥80% correct category
≥70% primary outcome recall
≥80% primary CTA first-click
≤10% “generic quiz/game” only description
```

### 22.3. Above-the-fold composition

```text
64px nav
12-column hero
copy 5 columns
product proof 7 columns
one primary CTA
one secondary CTA
participant text shortcut
micro trust line
next section visible edge
```

Hero no forced 100vh. 720–820px desktop max visual stage; mobile 620–760px content-driven.

### 22.4. Product demo honesty

Demo data label:

```text
Demo sinf · 30 ishtirokchi
```

Never:

- fabricated institution logos;
- fake “10,000 teachers”;
- fake live counters;
- fake testimonials;
- unlabeled synthetic dashboard.

Allowed:

- real seeded demonstration clearly labeled;
- real pilot quote with consent/date;
- actual computed metric with definition;
- product animation captured from real components.

### 22.5. Narrative sequence

```text
Promise
→ proof
→ workflow
→ differentiation
→ safety/accessibility
→ evidence
→ action
```

Sections:

1. hero promise;
2. live product proof;
3. “ask → evidence → adapt” workflow;
4. Director/Projector/Participant;
5. private-safe competition;
6. ready tests + builder;
7. accessibility/reliability;
8. real proof;
9. final CTA.

### 22.6. Visual rhythm

Alternating section grammar:

```text
editorial white space
→ dense product demo
→ calm narrative
→ bento outcomes
→ full-width trust strip
→ compact CTA
```

Every section card grid bo‘lmaydi. At least three layout archetypes:

- split editorial;
- full product stage;
- asymmetric bento;
- sticky narrative;
- compact proof strip.

### 22.7. Hero product animation

No decorative orbit. Real workflow loop 8–12s max, paused by default if offscreen:

```text
question open
→ responses arrive
→ distribution
→ Discuss selected
```

Controls:

- play/pause;
- no autoplay with sound;
- reduced motion static 4-frame story;
- offscreen pause;
- low-data poster image;
- interaction does not steal focus.

### 22.8. CTA system

Primary label one across nav/hero/footer:

```text
Bepul boshlash
```

Secondary:

```text
Demo Castni ko‘rish
```

Participant:

```text
Kod bilan kirish
```

Institution:

```text
Tashkilot uchun bog‘lanish
```

No “Learn more”, “Explore”, “Boshlash” ambiguity where exact object can be named.

### 22.9. Trust architecture

Trust modules:

- privacy summary;
- accessibility statement;
- status/uptime;
- data-region/provider disclosure where approved;
- no-camera Cast default;
- public ranking privacy;
- support contact;
- release/changelog;
- real pilot methodology.

Security icon decoration emas; linked proof.

### 22.10. Landing accessibility/performance

- semantic H1/H2 hierarchy;
- skip link;
- nav mobile dialog semantics;
- product screenshots with alt or explanatory text;
- motion control;
- no text in image as only source;
- LCP product visual preload;
- no hero lazy loading;
- AVIF/WebP dimensions;
- below-fold content visibility only after accessibility test;
- remote Socket/XLSX scripts not loaded;
- system font fallback metrics matched.

---

## 23. Teacher Workspace — glanceable decision cockpit

### 23.1. Core model

Teacher dashboard flow:

```text
Overview
→ Diagnose
→ Act
→ Confirm
```

Dashboard birinchi ekranda barcha data bermaydi. Quick overview, then drill-down. Teacher-dashboard research teacher involvement, quick overview, actionable insight va pedagogik alignmentni qayta-qayta ustuvor ko‘rsatadi [S216][S217][S218][S219][S220].

### 23.2. Workspace home

Above fold:

```text
Greeting + date/context
Primary: Yangi test
Secondary: Quick Prompt
Resume active/recent work
Today/Recent Cast summary
```

Below:

```text
Mening testlarim
Tayyor testlar
Recent results
Needs attention
```

No generic stat card row unless each card actionga bog‘langan.

### 23.3. Glanceability hierarchy

Priority:

1. active/next teaching action;
2. blocker/warning;
3. recent session evidence;
4. library content;
5. account/entitlement.

Visual signal:

```text
size > position > weight > contrast > color
```

Color first hierarchy emas.

### 23.4. Test library density

Desktop list/table default:

```text
Name
Question count/type
Subject/tag
Updated
Visibility
Last used/result
Primary Cast action
Overflow
```

Card grid only template discovery/media-rich content. Teacher-owned operational content list/table bo‘ladi.

Density settings:

```text
comfortable 48px row
compact 40px row
```

State saved per user.

### 23.5. Progressive disclosure

Primary row:

```text
Cast
```

Secondary visible:

```text
Edit
```

Overflow:

```text
Preview
Duplicate
Share
Export
Archive
Delete
```

Delete no adjacent one-tap control. Visibility has label and menu, not icon-only eye toggle.

### 23.6. Filters

- search immediate 150–250ms debounce;
- active filters as removable chips;
- filter count;
- clear all;
- sort stable;
- URL state for return/share where safe;
- no results differentiates “no data” and “filter matched none”;
- keyboard and screen-reader status count.

### 23.7. Teacher-private live evidence

Evidence card answers:

```text
How many answered?
How many correct?
Which distractor dominates?
Is evidence reliable?
What can I do next?
```

Do not display simultaneously:

- every participant name;
- every latency value;
- full leaderboard;
- raw logs;
- AI prose.

Drill-down opens on demand.

### 23.8. Dashboard charts

Teacher-facing default:

- bar/distribution before pie;
- count + percent;
- denominator visible;
- labels direct;
- small multiples only when comparable;
- no animated count-up on every update;
- update preserves item order;
- network/technical missing separate;
- “insufficient evidence” state;
- action button beside finding.

### 23.9. Personalization

Allowed:

- density;
- default library view;
- saved filters;
- column visibility;
- theme;
- reduced motion;
- dashboard widget order within constraints.

Not allowed:

- remove critical status;
- place destructive action as primary;
- override institution privacy/accessibility tokens;
- arbitrary custom colors.

---

## 24. Cast visual grammar — state, focus va emotion

### 24.1. Four visual surfaces

```text
Setup Studio      — neutral professional
Director View     — dense private cockpit
Projector View    — minimal large public display
Participant View  — touch-first single task
```

Bir xil token family, turli density va typography. Director UI’ni projector kattalashtirib ishlatish taqiqlanadi.

### 24.2. State color map

| State | Primary visual | Secondary |
|---|---|---|
| lobby | calm action blue | neutral count |
| think | neutral/indigo | countdown number |
| open | action blue | option identities |
| submitted | selected + saved text | check icon |
| paused | amber neutral | pause label |
| locked | neutral strong | lock icon |
| private evidence | teacher-only blue/teal | charts |
| discuss | violet/neutral | conversation icon |
| reteach | amber | example icon |
| reveal correct | green | check + text |
| reveal incorrect | red | x + text |
| recovery | blue-gray | connection text |
| ended | neutral + selective celebration | summary |

State background full-screen dramatic color bilan almashtirilmaydi. Status localized component/card orqali.

### 24.3. Projector content budget

Bir frame:

```text
1 primary question/message
2–5 answer options OR 1 chart
1 timer/status
1 small session meta row
```

No simultaneous:

```text
question + full chart + full leaderboard + instructions + QR
```

Lobbydan keyin QR minimized/hidden. Join code teacher toggle bilan qayta ko‘rsatiladi.

### 24.4. Participant answer microstates

```text
READY
THINKING
OPEN
HOVER/FOCUS
SELECTED
SENDING
SAVED
RETRYING
LOCKED
REVEALED
```

Visual:

- `OPEN`: neutral option surfaces;
- `SELECTED`: 3px semantic border, marker, no color fill takeover;
- `SENDING`: selection retained + small inline progress;
- `SAVED`: static check + “Javob saqlandi”;
- `RETRYING`: selection retained + connection message;
- `LOCKED`: controls disabled, selected remains legible;
- `REVEALED`: correct/wrong labels.

Never reset selection visually during retry.

### 24.5. Timer

Timer has:

```text
number
label/accessible name
ring/bar optional
state color
server-synced status
```

Color bands:

```text
normal — neutral/action
attention — amber at configured threshold
critical — danger only final threshold
expired — locked text
```

No flashing. No ring color-only. Reduced motion: ring jumps discreetly, number updates.

### 24.6. Live distribution

Teacher private first:

- stable option order;
- bar baseline consistent;
- exact counts;
- percent label;
- answer symbol;
- correct state hidden until reveal;
- dominant distractor outlined, not animated pulse;
- transition bars 120–180ms, latest value interrupts;
- screen reader summary throttled.

### 24.7. Leaderboard emotion

Modes visibly distinct:

```text
Top N
Team
Personal
Off
```

Public Top N:

- max 5 default;
- tied rank treatment;
- no “last place” panel;
- no falling animation;
- rank change arrow optional/private;
- score exactness policy;
- class/team celebration secondary.

Personal:

- “Siz 8-o‘rindasiz” private;
- neighbors only when policy allows;
- personal best preferred over public low rank.

### 24.8. Celebration budget

Session per participant/projector:

```text
minor success animation: max 2–3
major celebration: max 1
ambient loop: 0
```

Milestone celebration:

- 500–800ms;
- no large viewport zoom;
- no repeated bounce;
- no flashing;
- can be muted/reduced;
- result remains without animation.

### 24.9. Host attention budget

Director at most:

```text
1 critical banner
1 recommended next action
3 primary metrics
```

Additional signals collapse into details. AI suggestion visual weight no higher than teacher state/action.

### 24.10. Network state

Participant:

```text
Connecting…
Connected
Sending…
Saved
Reconnecting…
Saved on server
Could not submit: question closed
```

Color alone emas. No optimistic “saved” before ACK. Projector connection warning public contentni bosmaydi. Director detailed healthni ko‘radi.

---

## 25. Component microstate matrix — exhaustive

### 25.1. Required state set

Har interactive component:

```text
rest
hover where pointer exists
focus-visible
active/pressed
selected/toggled
loading/pending
disabled
read-only where applicable
error/warning where applicable
high contrast
forced colors
reduced motion
```

Design file faqat rest screenshot bilan complete hisoblanmaydi.

### 25.2. Button

Primary:

- rest filled action;
- hover lightness delta, `translateY(-1px)` optional;
- active no lift, `.99` max scale;
- focus external ring;
- loading retains width/label;
- disabled neutral + noninteractive cursor;
- danger never gradient;
- icon position logical start/end;
- 40/44/48px size variants.

Loading label:

```text
“Saqlanmoqda…”
```

Not spinner-only.

### 25.3. Icon button

- visible 20–24px icon;
- hit target 44px;
- tooltip after 500–700ms first hover, immediate subsequent within group;
- accessible name;
- toggle uses `aria-pressed`;
- selected fill + marker;
- no icon color-only danger.

### 25.4. Text input

Rest:

```text
surface + strong control edge
```

Focus:

```text
focus ring + border, no layout shift
```

Error:

```text
danger border + icon + inline text
```

Read-only:

```text
normal readable text + distinct surface + copy affordance if useful
```

Disabled:

```text
not confused with read-only
```

Placeholder never instructional source.

### 25.5. Select/combobox

- native select for simple case;
- custom combobox follows APG;
- typeahead;
- selected option check;
- active descendant;
- clear action;
- no hover-only menu;
- mobile native picker considered;
- dropdown max height and scroll affordance;
- portal theme variables preserved.

### 25.6. Radio/checkbox/switch

Use:

```text
Radio — one of many
Checkbox — independent choices
Switch — immediate on/off setting
```

Cast mode card behaves as radio, not arbitrary div. Switch does not submit destructive/server action without status.

### 25.7. Selectable card

Anatomy:

```text
native input
label area
title
summary
status/recommended badge
check marker
optional preview
```

Entire card label clickable; nested links avoided. Focus visible around card. Disabled explanation attached.

### 25.8. Tooltip

Tooltip only supplemental. Required explanation inline/popover. No focusable content inside basic tooltip. Touch fallback. Escape dismiss where opened. Position collision safe.

### 25.9. Popover/menu

- trigger expanded state;
- focus enters expected item;
- arrow navigation;
- Escape closes and restores;
- outside click;
- short 120–160ms motion;
- no deep nested menu on mobile;
- dangerous action separated/divider.

### 25.10. Dialog

Dialog variants:

```text
confirmation small
form medium
setup large
mobile full-screen
```

Rules:

- title mandatory;
- close target 44px;
- initial focus not always first destructive action;
- scroll body, fixed header/footer;
- destructive action names object;
- pending blocks duplicate submission;
- no nested dialog;
- Escape policy explicit;
- focus restore.

### 25.11. Banner/inline/toast

Use matrix:

| Need | Pattern |
|---|---|
| whole-page critical | banner |
| section issue | inline/section message |
| field issue | inline error |
| action success | toast/flag |
| destructive consequence | dialog |
| ongoing network | persistent status chip/banner |

Toast critical informationning yagona joyi emas.

### 25.12. Skeleton/progress

Skeleton:

- only cards/lists/tables;
- 3–5 representative rows;
- structure final contentga yaqin;
- no modal skeleton shell;
- no form-control skeleton after interaction;
- max few seconds before error/long-wait state.

Progress:

- known duration → determinate;
- unknown short → spinner;
- unknown long → stage text + cancel/background;
- upload shows file name, bytes/progress, validation.

### 25.13. Empty state

First use:

```text
What can be created
Why useful in one sentence
Primary action
Optional example/template
```

No results:

```text
Search/filter summary
Clear filters
No “create” if data may exist outside filter
```

Permission/system empty states alohida.

### 25.14. Table

Microstates:

- row hover;
- row focus-within;
- selected;
- loading;
- empty;
- error;
- sorted ascending/descending;
- filter active;
- bulk selection;
- sticky header shadow only when scrolled.

Numbers tabular/right. Names left. Actions last. Mobile priority columns.

### 25.15. Drag and drop

Every drag has button/keyboard alternative:

```text
Move up
Move down
Move to position
```

Drag handle 44px target mobile. Live announcement. Drop preview. Reduced motion. No drag-only test reorder.

---

## 26. Cognitive accessibility va classroom focus

### 26.1. COGA objectives applied

```text
Understand controls
Find what is needed
Use clear content
Avoid and correct mistakes
Maintain focus
Do not rely on memory
Provide help
Support adaptation
```

COGA design patterns Edikit uchun WCAG minimumidan tashqari product gate bo‘ladi [S206][S207][S208].

### 26.2. Working-memory budget

Setup Studio:

- 4 primary modes max;
- essential settings first;
- selected preset summary persistent;
- advanced section collapsed;
- dependencies auto-reflected;
- final summary before launch;
- teacher old choicesni eslab yurmaydi.

Director:

- current phase visible;
- answer count visible;
- next recommended actions max 3;
- last command status visible;
- keyboard shortcut optional, label not replaced;
- no hidden “mode” memory.

Participant:

- one primary task;
- instruction near controls;
- saved status persistent;
- no leaderboard while answering;
- error includes next step.

### 26.3. Attention management

Visual attention priority:

```text
critical state
current question/task
primary action
supporting evidence
secondary navigation
```

No simultaneous:

- pulsing badge;
- blinking timer;
- moving background;
- shimmering options;
- animated avatar;
- toast.

At most one expressive motion at a time.

### 26.4. Error prevention

- destructive action separated;
- autosave + status;
- undo for reversible deletion/archive;
- validation before leaving;
- numeric bounds visible;
- selected answer confirmation;
- stale/reconnect state explicit;
- form preserves data after server error;
- no password/cognitive puzzle as default auth requirement;
- confirmation copy names impact.

### 26.5. Plain language

- sentence length short;
- front-load action;
- one term per concept;
- “Cast”, “Sinov”, “Sessiya” definitions stable;
- no “Mock/PRE” without user-facing explanation;
- English technical words hidden from normal UI;
- labels not clever.

### 26.6. Personalization

User-controlled:

```text
theme
contrast
motion
sound
question on device
text size where supported
density teacher/admin
```

Preference visible in settings, portable, reversible. Accessibility preference not gamified or publicly exposed.

---

## 27. Projector va classroom field design

### 27.1. Display profiles

```text
Classroom Dark
Classroom Light
Lecture Hall Dark
Lecture Hall Light
High Contrast
```

Profile controls typography min, surface contrast, chart thickness, safe area and ambient decoration.

### 27.2. Distance typography

Minimum starting targets:

```text
Question: 36px classroom, 48px lecture, fluid to 64px
Option: 28px classroom, 34px lecture, fluid to 40px
Meta/timer: 22px minimum
Join code: 64px minimum, fluid to 120px
Chart labels: 24px minimum
```

Current 20px meta targetning past chegarasi classroom uchun oshiriladi. 15m testda unreadable label olib tashlanadi yoki kattalashtiriladi.

### 27.3. Bright room

- Focus Light uses near-white surface, near-black text;
- faint borders replaced by strong edge/spacing;
- ambient gradient removed;
- shadow dependency removed;
- 7:1 body/question target where practical;
- color saturation secondary to luminance;
- real projector, not monitor screenshot only.

### 27.4. Dark room

- canvas not pure black by default;
- off-white text, no glowing thin font;
- accent chroma limited;
- bright areas <20% frame where possible;
- no huge pure-white QR after lobby;
- image/video brightness managed.

### 27.5. Projector safe area

```css
padding-inline: max(4vw, env(safe-area-inset-left));
padding-block: max(3vh, env(safe-area-inset-top));
```

Overscan and browser chrome. Critical content never edge 3% ichida.

### 27.6. Content overflow

Algorithm:

1. standard type;
2. wrap to max lines;
3. options reduce gap;
4. image reflow;
5. font size only defined floorgacha;
6. overflow preflight blocker;
7. teacher “show on device” fallback.

Text ellipsis question/answerda taqiqlanadi.

### 27.7. Charts on projector

- bars ≥16px thickness;
- labels outside/inside with contrast;
- direct option symbol;
- percent + count;
- max 5 categories;
- no tooltip dependency;
- correct answer hidden until reveal;
- animation optional 180ms;
- high contrast static alternative.

### 27.8. Field QA

```text
3m, 8m, 15m
720p, 1080p
4:3, 16:9
bright, dim
washed projector
mirrored screen
browser zoom 90–125%
```

Pass: back-row participant primary question/options/statusni assistance’siz o‘qiydi.

---

## 28. Responsive masterpiece

### 28.1. Three-level responsiveness

```text
Page: media queries
Component: container queries
Environment: preference/safe-area/input media features
```

Viewport breakpoint component internal layout uchun yagona source emas [S201][S202][S203].

### 28.2. Component container patterns

Test card:

```text
<360px container → stacked title/actions
360–640px → title + primary action, overflow below
>640px → row/table pattern
```

Metric card:

```text
<220px → value + short label
>220px → value + trend + helper
```

Setup mode cards:

```text
<560px → single column
560–840px → 2 columns
>840px → 4 columns if text passes
```

### 28.3. Viewport units

- `svh` initial stable viewport;
- `dvh` interactive full-height regions;
- no fixed `100vh` for mobile forms;
- keyboard open state scrollable;
- sticky footer safe-area padding;
- address bar changes do not hide CTA.

### 28.4. Short-height screens

Test separately:

```text
1366×768
1024×600
844×390 landscape
```

Auth not vertically centered if content overflows. Modal header/footer sticky. Director controls remain reachable.

### 28.5. Foldable and wide screens

- 600–900px explicitly tested;
- 1920+ content not tiny centered stripe;
- workspace max 1440/1600 where density benefits;
- landing text max width remains readable;
- split panes get min widths;
- hinge proposal progressive only;
- no critical control across fold/hinge.

### 28.6. Input modality

```css
@media (hover:hover) and (pointer:fine) { /* hover enhancements */ }
@media (pointer:coarse) { /* larger targets */ }
```

Hover never required. Coarse pointer increases row/action target and spacing.

### 28.7. Safe areas

Participant bottom control:

```css
padding-bottom: calc(16px + env(safe-area-inset-bottom));
```

Top banners/notch and landscape insets. Theme toggle no fixed collision with browser/OS gesture.

---

## 29. Typography, iconography va illustration refinement

### 29.1. Variable font loading

Recommended:

```text
Inter Variable Latin+Cyrillic — product
Manrope Variable verified subset — marketing
IBM Plex Mono subset — codes/numerics where needed
```

Rules:

- WOFF2;
- self-host;
- `font-display: swap` body;
- `optional` considered for decorative display;
- preload only critical body normal;
- unicode ranges Latin extended + Cyrillic;
- Uzbek apostrophe characters included;
- `size-adjust`, `ascent-override`, `descent-override`, `line-gap-override` fallback matching;
- font failure screenshot.

Variable font performance static files soni va ishlatiladigan weightlar bilan measured; “variable always smaller” deb faraz qilinmaydi [S191][S197].

### 29.2. Weight discipline

```text
400 normal body
500 UI/body emphasis
600 control/card heading
700 page/section heading
800 rare hero/number emphasis
900 prohibited except logo artwork
```

Current all-800/900 hierarchy olib tashlanadi.

### 29.3. Optical sizing

`font-optical-sizing:auto` supported variable fontda. Large hero tight tracking; small labels normal/positive tracking. Arbitrary `font-variation-settings` componentlarda ishlatilmaydi.

### 29.4. Numerics

```css
.metric,
.timer,
.join-code,
.table-number {
  font-variant-numeric: tabular-nums lining-nums;
}
```

Join code ambiguous characters removed. Score thousands separator locale-aware.

### 29.5. Icon system

One icon family:

```text
Lucide-like 2px stroke or custom Edikit set
24×24 viewBox
16/20/24 display sizes
round caps consistent
```

Rules:

- emoji not product icon;
- icon stroke matches weight/size;
- filled icon only selected/critical where defined;
- no mixed text glyph arrows and SVG;
- optical alignment;
- icon-only 44px target;
- `currentColor`;
- decorative `aria-hidden`;
- meaningful accessible name via button label.

### 29.6. Illustration

Landing illustration priority:

```text
real product UI
→ product-in-context diagram
→ abstract brand illustration
→ stock photo last
```

Characters:

- participant optional personalization;
- not teacher navigation primary;
- coherent rights/license registry;
- same art direction;
- static/reduced variants;
- no borrowed film characters without rights.

### 29.7. Logo

- SVG artwork optical crop/whitespace reviewed;
- dark/light logo variants;
- accessible alt “Edikit”;
- wordmark not CSS gradient text dependency;
- minimum size;
- clear space;
- no excessive glow;
- nav icon + text or sufficient recognizable wordmark.

---

## 30. Data visualization va responsive-teaching evidence

### 30.1. Chart selection matrix

| Question | Visual |
|---|---|
| option distribution | horizontal bar |
| before/after revote | paired bar/slope with labels |
| confidence × correctness | 2×2 matrix |
| progress over sessions | line only if comparable |
| team score | ranked bar/table |
| completion coverage | progress bar + count |
| misconception categories | ranked bar |
| tiny categorical counts | table/list, not chart |

Pie/donut default emas. Gauge taqiqlanadi. 3D chart taqiqlanadi.

### 30.2. Evidence anatomy

Har metric:

```text
Label
Value
Numerator/denominator
Context/time
Status/uncertainty
Action if applicable
```

Example:

```text
To‘g‘ri javob
19 / 24 · 79%
6 kishi javob bermadi
[Muhokama boshlash]
```

### 30.3. Live update stability

- category order fixed;
- axis range fixed per question;
- bar update interruptible;
- number update no rolling odometer;
- latest data wins;
- no reorder each response;
- screen reader announcement throttled;
- technical missing not zero.

### 30.4. Confidence matrix

Cells:

```text
Correct + High
Correct + Low/Medium
Wrong + Low/Medium
Wrong + High
```

Visual:

- count first;
- tinted surface, not saturated fill;
- direct label;
- high-confidence wrong emphasized teacher-only;
- tiny cell privacy suppression;
- no public individual drill-down.

### 30.5. First vote → revote

Default visual:

- paired option bars;
- wrong→correct count;
- unchanged count;
- no “learning gain” causal claim;
- explanation/transfer result separate;
- same color identity across both rounds;
- motion 180ms or static.

### 30.6. Accessible alternative

Every chart:

- text takeaway;
- table;
- keyboard access where interactive;
- no hover-only data;
- downloadable accessible CSV;
- chart `aria-hidden` if full equivalent table and summary;
- SVG title/description otherwise;
- color + label/shape.

---

## 31. Design-system architecture — masterpiece source of truth

### 31.1. Target file structure

```text
public/design/
  tokens/
    primitives.tokens.json
    semantic.light.tokens.json
    semantic.dark.tokens.json
    semantic.hc-light.tokens.json
    semantic.hc-dark.tokens.json
    motion.tokens.json
    typography.tokens.json
    spacing.tokens.json
    radius.tokens.json
    elevation.tokens.json
    data-viz.tokens.json
  generated/
    tokens.css
    tokens.light.css
    tokens.dark.css
    tokens.hc.css
  foundations/
    reset.css
    typography.css
    layout.css
    focus.css
    motion.css
  components/
    button.css
    input.css
    select.css
    card.css
    dialog.css
    tabs.css
    accordion.css
    table.css
    toast.css
    skeleton.css
  contexts/
    landing.css
    workspace.css
    director.css
    projector.css
    participant.css
    admin.css
```

This is specification, current source modification emas.

### 31.2. DTCG token format

```json
{
  "color": {
    "primitive": {
      "blue": {
        "600": {
          "$type": "color",
          "$value": {
            "colorSpace": "oklch",
            "components": [0.5232, 0.2007, 262.9],
            "alpha": 1
          }
        }
      }
    },
    "action": {
      "primary": {
        "$type": "color",
        "$value": "{color.primitive.blue.600}"
      }
    }
  }
}
```

DTCG 2025.10 stable format theming, aliases va modern color spacesni vendor-neutral shaklda standartlashtirdi [S244][S245].

### 31.3. Naming

Good:

```text
color.text.default
color.text.muted
color.surface.default
color.surface.raised
color.border.control
color.action.primary
color.status.danger
motion.popup.enter
size.control.medium
```

Avoid:

```text
blueText
gray2
niceShadow
cardBlue
button900
premiumGradient
```

### 31.4. Token ownership

```text
Primitive — brand/design owner
Semantic — design-system owner + accessibility
Component — component owner, limited
Context — product page owner, no raw value
```

Component token faqat semantic token insufficient bo‘lsa. One-off raw value forbidden.

### 31.5. Token CI

Checks:

- schema valid;
- aliases resolve;
- no cycles;
- no missing modes;
- contrast pairs;
- deprecated usage;
- raw color scan;
- raw duration scan;
- component token count regression;
- generated CSS diff;
- screenshot themes.

### 31.6. Component documentation

Har component page:

```text
Purpose
Anatomy
Variants
Sizes
States
Tokens
Content
Accessibility
Keyboard
Motion
Responsive
Examples
Do/Don’t
Tests
Change log
```

### 31.7. Deprecation

```text
Active
Deprecated with replacement
Soft error/warning
Removed next major
```

Token/component rename migration map va deadline. Silent delete yo‘q.

### 31.8. CSS architecture migration

Sequence:

1. new tokens coexist;
2. backward aliases old variablesga map;
3. core components extracted;
4. page inline styles removed;
5. hard-coded colors linted;
6. old aliases usage zero;
7. aliases removed major release.

Big-bang rewrite emas. Screenshot per migrated page.

---

## 32. Microcopy, content va trust masterpiece

### 32.1. Voice

```text
Direct
Calm
Respectful
Specific
Actionable
```

Avoid:

```text
Official Platform v2.0
Premium
Revolutionary
Magic
AI-powered without context
Xato!
Noto‘g‘ri!
```

### 32.2. Status copy

```text
Javob tanlandi.
Yuborilmoqda…
Javob saqlandi.
Ulanish tiklanmoqda.
Savol yopildi; javob qabul qilinmadi.
Sessiya pauza qilindi.
15 soniya qo‘shildi.
```

No blame, no uncertain success.

### 32.3. Empty states

Teacher no tests:

```text
Birinchi testingizni yarating
Savollarni qo‘lda kiriting yoki Excel’dan import qiling.
[Test yaratish]
```

Filtered none:

```text
Bu filtrlarga mos test topilmadi
Filtrlarni tozalang yoki boshqa so‘rov kiriting.
[Filtrlarni tozalash]
```

### 32.4. Error hierarchy

Field:

```text
Test nomini kiriting.
```

Section:

```text
2 ta savolda to‘g‘ri javob belgilanmagan.
```

Page:

```text
O‘zgarishlarni saqlab bo‘lmadi. Ma’lumotlaringiz shu sahifada saqlanib turibdi. Qayta urinib ko‘ring.
```

System:

```text
Sessiya bilan aloqa uzildi. Javoblar tiklanmoqda.
```

### 32.5. Trust language

Allowed:

```text
Camera ishlatilmaydi
O‘quvchilar ilova o‘rnatmaydi
Public reyting o‘qituvchi nazoratida
Accessibility statement
Data handling summary
```

Avoid:

```text
100% secure
Cheating impossible
AI always accurate
Completely anonymous without technical proof
```

### 32.6. Uzbek consistency

Preferred:

```text
O‘yin kodi
O‘qituvchi
O‘quvchi / Ishtirokchi contextga qarab
Jonli sessiya
Tayyor testlar
To‘g‘ri javob
Natijalar
Sozlamalar
```

English product names only proper noun/technical context. “Mock”, “PRE”, “Cast”ga onboarding explanation.

---

## 33. Masterpiece QA — evidence, not taste

### 33.1. Quantitative gates

```text
Light/dark contrast token pass: 100%
Raw component color: 0
transition: all: 0
Default infinite decorative motion: 0
Critical body text <14px: 0
Touch target <44px preferred exceptions: documented
EJS compile failure: 0
Critical HTTP failure: 0
Axe serious/critical: 0
Visual diff unreviewed: 0
LCP p75 ≤2.5s
INP p75 ≤200ms
CLS p75 ≤0.1
```

### 33.2. Five-second test

Variants:

- text-first hero;
- product-first split hero;
- teacher-action hero.

Questions:

1. What is Edikit?
2. Who is it for?
3. What is the main benefit?
4. What would you click first?
5. How trustworthy did it feel 1–5?

Do not ask only “qaysi chiroyli?”.

### 33.3. First-click tasks

```text
Teacher: create a test
Teacher: cast existing test
Teacher: find last result
Participant: join with code
Host: pause and add time
Host: hide leaderboard
Admin: find a user
```

Success, time, misclick, hesitation.

### 33.4. Motion usability

Test same tasks:

```text
full motion
reduced motion
no motion
low-end device
```

Measure:

- task completion;
- perceived speed;
- disorientation;
- missed state;
- animation wait;
- frame/long task.

### 33.5. Theme preference study

Not “light or dark better?”. Tasks in:

```text
bright classroom
normal office
dim room
projector
mobile outdoors
```

Measure readability, fatigue, preference, error. Projector profile chosen by environment, not personal OS only.

### 33.6. Contrast field tests

- calibrated monitor;
- low-quality laptop;
- low-end Android;
- washed projector;
- direct sunlight mobile;
- grayscale;
- CVD simulations;
- forced colors.

### 33.7. Visual regression

Every component state in:

```text
light
dark
hc-light
hc-dark
forced-colors where capturable
reduced-motion final state
```

Page fixture includes long Uzbek, Cyrillic, English and RTL sample.

### 33.8. Design lint

Block:

```text
transition: all
font-size < .75rem outside allowlist
raw hex in components
raw rgba in components
outline: none without replacement
animation infinite outside allowlist
z-index > scale
inline visual style
missing focus-visible
fixed height text card
```

### 33.9. Design review panel

Required reviewers:

```text
product designer
frontend
accessibility
teacher representative
student/participant where relevant
QA/performance
```

Designer-only approval masterpiece gate emas.

---

## 34. Final masterpiece constitution

### 34.1. 20 non-negotiables

1. Light mode gray haze bo‘lmaydi.
2. Dark mode neon wallpaper bo‘lmaydi.
3. Theme semantic token bilan.
4. Raw component colors bo‘lmaydi.
5. Normal text 4.5:1dan past bo‘lmaydi.
6. Meaningful control 3:1dan past bo‘lmaydi.
7. Critical body text 14pxdan kichik bo‘lmaydi; body default 16px.
8. `transition: all` bo‘lmaydi.
9. Theme 900ms bo‘lmaydi.
10. Ambient infinite animation default bo‘lmaydi.
11. Reduced motion fully functional bo‘ladi.
12. Landing first viewport real productni ko‘rsatadi.
13. Bitta primary CTA bo‘ladi.
14. Fake proof/stat bo‘lmaydi.
15. Teacher Workspace action-first bo‘ladi.
16. Projector va Director alohida surface bo‘ladi.
17. Participant saved status server confirmationga mos bo‘ladi.
18. Color sole meaning bo‘lmaydi.
19. Design QA real browser/device/projectorda bo‘ladi.
20. Compile/HTTP failure bilan visual release bo‘lmaydi.

### 34.2. Final style formula

```text
Calm canvas
+ precise hierarchy
+ honest proof
+ strong typography
+ perceptual color
+ semantic motion
+ classroom readability
+ cognitive clarity
+ accessible microstates
+ automated governance
```

### 34.3. Final theme summary

Light:

```text
soft neutral canvas
true white surface
dark readable text
strong but limited blue
visible controls
low glare hierarchy
```

Dark:

```text
near-black navy canvas
layered surfaces
off-white text
muted chroma
selective accent
no continuous glow
```

Cast:

```text
large text
solid options
shape + color
stable charts
teacher-private evidence
rare celebration
```

Landing:

```text
teacher outcome
real product UI
one primary CTA
honest trust
no decorative motion dependency
```

---

## 35. Qo‘shimcha 100-source research index — S151–S250

### F. Perceptual color, theming va inclusive visualization — S151–S170

- **S151 — W3C CSS Color Module Level 4:** https://www.w3.org/TR/css-color-4/
- **S152 — MDN `oklch()`:** https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/oklch
- **S153 — MDN `color-mix()`:** https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/color-mix
- **S154 — MDN `light-dark()`:** https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/light-dark
- **S155 — MDN `contrast-color()`:** https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/contrast-color
- **S156 — APCA Easy Introduction:** https://git.apcacontrast.com/documentation/APCAeasyIntro
- **S157 — W3C WCAG 3.0 Draft:** https://www.w3.org/TR/wcag-3.0/
- **S158 — W3C Visual Contrast Subgroup:** https://www.w3.org/WAI/GL/task-forces/silver/wiki/Visual_Contrast_of_Text_Subgroup
- **S159 — W3C Contrast Enhanced:** https://www.w3.org/WAI/WCAG22/Understanding/contrast-enhanced.html
- **S160 — Stripe Accessible Color Systems:** https://stripe.com/blog/accessible-color-systems
- **S161 — GitHub Primer Inclusive Color System:** https://github.blog/engineering/unlocking-inclusive-design-how-primers-color-system-is-making-github-com-more-inclusive/
- **S162 — GitHub Theme Color Tooling:** https://github.blog/news-insights/product-news/accelerating-github-theme-creation-with-color-tooling/
- **S163 — Carbon Data Visualization Color Palettes:** https://carbondesignsystem.com/data-visualization/color-palettes/
- **S164 — Adobe Color Accessibility Tools:** https://color.adobe.com/create/color-accessibility
- **S165 — ColorBrewer:** https://colorbrewer2.org/
- **S166 — Viridis Color Maps:** https://sjmgarnier.github.io/viridis/
- **S167 — W3C Visual Presentation:** https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html
- **S168 — Microsoft High Contrast Guidance:** https://learn.microsoft.com/en-us/fluent-ui/web-components/design-system/high-contrast
- **S169 — web.dev Color Scheme:** https://web.dev/articles/color-scheme
- **S170 — MDN Color Contrast Guide:** https://developer.mozilla.org/en-US/docs/Web/Accessibility/Guides/Understanding_WCAG/Perceivable/Color_contrast

### G. Motion, animation va modern CSS — S171–S190

- **S171 — Nielsen Norman Animation Duration:** https://www.nngroup.com/articles/animation-duration/
- **S172 — Uber Base Motion:** https://base.uber.com/6d2425e9f/v/0/p/116184-motion
- **S173 — IBM Design Language Animation:** https://www.ibm.com/design/language/animation/overview/
- **S174 — Material 3 Easing and Duration:** https://m3.material.io/styles/motion/easing-and-duration/applying-easing-and-duration
- **S175 — MDN `@starting-style`:** https://developer.mozilla.org/en-US/docs/Web/CSS/@starting-style
- **S176 — MDN `transition-behavior`:** https://developer.mozilla.org/en-US/docs/Web/CSS/transition-behavior
- **S177 — MDN `animation-timeline`:** https://developer.mozilla.org/en-US/docs/Web/CSS/animation-timeline
- **S178 — MDN `scroll-timeline`:** https://developer.mozilla.org/en-US/docs/Web/CSS/scroll-timeline
- **S179 — Chrome Scroll-Driven Animations:** https://developer.chrome.com/docs/css-ui/scroll-driven-animations
- **S180 — web.dev Building Chrometober with Scroll-Linked Animations:** https://web.dev/building-chrometober
- **S181 — web.dev Same-Document View Transitions Baseline:** https://web.dev/blog/same-document-view-transitions-are-now-baseline-newly-available
- **S182 — Chrome View Transitions:** https://developer.chrome.com/docs/web-platform/view-transitions
- **S183 — W3C Web Animations Level 1:** https://www.w3.org/TR/web-animations-1/
- **S184 — W3C CSS Easing Level 2:** https://www.w3.org/TR/css-easing-2/
- **S185 — W3C CSS Transitions Level 2:** https://www.w3.org/TR/css-transitions-2/
- **S186 — W3C Technique C39 Reduced Motion:** https://www.w3.org/WAI/WCAG22/Techniques/css/C39
- **S187 — web.dev Animating Modal Views:** https://web.dev/animating-modal-views/
- **S188 — Rive Duolingo Interactive Animation Case Study:** https://rive.app/blog/duolingo-s-ai-powered-video-call-brings-lily-to-life
- **S189 — Rive State Machines:** https://rive.app/docs/editor/state-machine
- **S190 — MDN Long Animation Frames API:** https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/Long_animation_frame_timing

### H. Typography, responsive va device adaptation — S191–S205

- **S191 — MDN Variable Fonts Guide:** https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_fonts/Variable_fonts_guide
- **S192 — MDN `font-display`:** https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/font-display
- **S193 — MDN `size-adjust`:** https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/size-adjust
- **S194 — MDN `unicode-range`:** https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/unicode-range
- **S195 — MDN `font-optical-sizing`:** https://developer.mozilla.org/en-US/docs/Web/CSS/font-optical-sizing
- **S196 — Google Fonts Variable Fonts Knowledge:** https://fonts.google.com/knowledge/introducing_type/introducing_variable_fonts
- **S197 — web.dev Variable Fonts:** https://web.dev/articles/variable-fonts
- **S198 — Atkinson Hyperlegible:** https://www.brailleinstitute.org/freefont/
- **S199 — Inter Typeface:** https://rsms.me/inter/
- **S200 — Manrope Typeface:** https://www.gent.media/manrope
- **S201 — web.dev The New Responsive:** https://web.dev/articles/new-responsive
- **S202 — web.dev Container Queries Stable:** https://web.dev/blog/cq-stable
- **S203 — MDN CSS Container Queries:** https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment/Container_queries
- **S204 — web.dev Screen Configurations:** https://web.dev/learn/design/screen-configurations
- **S205 — web.dev Viewport Units:** https://web.dev/blog/viewport-units

### I. Cognitive accessibility, classroom va teacher dashboards — S206–S220

- **S206 — W3C Making Content Usable for COGA:** https://www.w3.org/TR/coga-usable/
- **S207 — W3C COGA Task Force:** https://www.w3.org/WAI/GL/task-forces/coga/
- **S208 — Section 508 Cognitive Disabilities Design:** https://www.section508.gov/design/digital-content-users-with-cognitive-disabilities/
- **S209 — UK Education Cognitive Accessibility:** https://accessibility.education.gov.uk/guidelines/coga
- **S210 — Texas Tech Accessible PowerPoint Guide:** https://www.ttu.edu/accessibility/digital-accessibility/docs/accessible-powerpoint-guide.html
- **S211 — University of Colorado PowerPoint Accessibility:** https://www.colorado.edu/digital-accessibility/resources/understanding-powerpoint-accessibility
- **S212 — UC Merced Presentation Accessibility:** https://accessibility.ucmerced.edu/digital-accessibility/creating-content-checklists/presentation-accessibility-checklist
- **S213 — University at Buffalo Presentation Accessibility:** https://www.buffalo.edu/access/digital/content/documents/ppt.html
- **S214 — Microsoft Make PowerPoint Accessible:** https://support.microsoft.com/en-us/office/make-your-powerpoint-presentations-accessible-to-people-with-disabilities-6f7772b2-2f33-4bd2-8ca7-dae3b2b3ef25
- **S215 — Northwood Technical College PowerPoint Accessibility:** https://itlc.northwoodtech.edu/accessibility/powerpoint
- **S216 — CADA Teacher Dashboard Study:** https://pmc.ncbi.nlm.nih.gov/articles/PMC8982662/
- **S217 — Mathematics Teacher Dashboard Study:** https://link.springer.com/article/10.1007/s11858-021-01310-w
- **S218 — Classroom-Level Teacher Dashboard Study:** https://link.springer.com/article/10.1007/s10639-025-13389-9
- **S219 — Co-designed Learning Dashboards Study:** https://link.springer.com/article/10.1007/s11423-025-10577-9
- **S220 — TEADASH Study:** https://doi.org/10.3390/informatics11030061

### J. Component states, content va iconography — S221–S235

- **S221 — Carbon Loading Pattern:** https://carbondesignsystem.com/patterns/loading-pattern/
- **S222 — Carbon Empty States Pattern:** https://carbondesignsystem.com/patterns/empty-states-pattern/
- **S223 — Nielsen Norman Skeleton Screens:** https://www.nngroup.com/articles/skeleton-screens/
- **S224 — Nielsen Norman Visibility of System Status:** https://www.nngroup.com/articles/visibility-system-status/
- **S225 — GOV.UK Button:** https://design-system.service.gov.uk/components/button/
- **S226 — GOV.UK Text Input:** https://design-system.service.gov.uk/components/text-input/
- **S227 — GOV.UK Notification Banner:** https://design-system.service.gov.uk/components/notification-banner/
- **S228 — Atlassian Empty State:** https://atlassian.design/components/empty-state
- **S229 — Atlassian Flag:** https://atlassian.design/components/flag
- **S230 — Shopify Polaris Content:** https://polaris.shopify.com/content
- **S231 — Microsoft Writing Style Guide:** https://learn.microsoft.com/en-us/style-guide/welcome/
- **S232 — Mailchimp Content Style Guide:** https://styleguide.mailchimp.com/
- **S233 — Material Symbols Guide:** https://developers.google.com/fonts/docs/material_symbols
- **S234 — IBM Iconography:** https://www.ibm.com/design/language/iconography/ui-icons/design/
- **S235 — Lucide Guide:** https://lucide.dev/guide/

### K. Visual QA, tooling va governance — S236–S250

- **S236 — Playwright Visual Comparisons:** https://playwright.dev/docs/test-snapshots
- **S237 — axe-core:** https://github.com/dequelabs/axe-core
- **S238 — Lighthouse Performance Scoring:** https://developer.chrome.com/docs/lighthouse/performance/performance-scoring
- **S239 — Chrome DevTools Performance:** https://developer.chrome.com/docs/devtools/performance
- **S240 — web-vitals Library:** https://github.com/GoogleChrome/web-vitals
- **S241 — Storybook Accessibility Tests:** https://storybook.js.org/docs/writing-tests/accessibility-testing
- **S242 — Storybook Visual Tests:** https://storybook.js.org/docs/writing-tests/visual-testing
- **S243 — Stylelint Rules:** https://stylelint.io/user-guide/rules/
- **S244 — W3C DTCG Stable Specification Announcement:** https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/
- **S245 — Design Tokens Community Group FAQ:** https://www.designtokens.org/faq/
- **S246 — Style Dictionary:** https://styledictionary.com/
- **S247 — Tokens Studio Documentation:** https://docs.tokens.studio/
- **S248 — Figma Variables Guide:** https://help.figma.com/hc/en-us/articles/15339657135383-Guide-to-variables-in-Figma
- **S249 — Nielsen Norman Design Systems 101:** https://www.nngroup.com/articles/design-systems-101/
- **S250 — Nielsen Norman Design-System Maturity:** https://www.nngroup.com/articles/design-system-maturity/

## 36. “Yaqqol + official” design pozitsiyasi

Edikit category’da ikki xavf bor:

```text
1. Juda o‘yinchoq → bolalar ilovasi, past ishonch, teacher workspace uchun noo‘rin
2. Juda generic official → bank/gov dashboard, esda qolmaydi, product farqi ko‘rinmaydi
```

Final pozitsiya:

> **Evidence-led institutional technology.**

Brand impression target:

```text
Competent   9/10
Trustworthy 9/10
Clear       9/10
Modern      8/10
Distinctive 8/10
Warm        6/10
Playful     3/10 Teacher Workspace
Playful     5/10 optional Cast milestone
```

### 36.1. Classical va expressive balans

```text
Teacher Workspace: 85% classical / 15% expressive
Landing:           70% classical / 30% expressive
Projector:         80% classical / 20% expressive
Participant:       70% classical / 30% expressive
Admin:             95% classical /  5% expressive
```

Classical aesthetics:

- order;
- clarity;
- visual hierarchy;
- consistency;
- familiar controls;
- legibility;
- restraint.

Expressive aesthetics:

- unique Evidence Rail;
- Response Mosaic;
- signature cobalt/cyan signal;
- real-time data motion;
- rare milestone moment.

Science’da low visual complexity va high prototypicality first impressionda yuqori aesthetics bilan bog‘langan [S251][S252]. Educational platform research classical aesthetics, consistency, grid, typography va visual designning perceived usefulness/usability bilan aloqasini ko‘rsatadi [S267][S268][S269].

### 36.2. Official ko‘rinishning tarkibi

Official impression badge yoki gerbga taqlid emas. Tarkib:

```text
consistent navigation
legible typography
calm neutral surfaces
clear organization identity
real contact/support
accessible components
honest metrics
current dates/changelog
working links/pages
privacy/security evidence
predictable interaction
error-free copy
```

USWDS va 18F consistency, accessibility, responsiveness va mission-specific customizationni trust bilan bog‘laydi [S271][S272][S273].

### 36.3. Distinctivenessning tarkibi

Distinctive identity bitta rangga tayanmaydi. 2026-yilgi cross-category benchmarkda shape-based brand assets color-only assetlardan kuchliroq fame/uniqueness ko‘rsatgan [S276]. Edikit asset stack:

```text
1. Evidence Mark — owned shape
2. Signal Rail — recurring layout element
3. Response Mosaic — owned pattern
4. Cobalt/Cyan/Insight palette — color family
5. Three-view composition — product imagery grammar
6. “Ask → See → Adapt” — verbal pattern
7. Motion cadence — short signal pulse, no bounce
```

### 36.4. Category conventions saqlanadi

Familiar:

- top navigation;
- left app navigation;
- primary blue action;
- white/light neutral surface;
- dark projector option;
- standard form controls;
- product screenshot hero;
- QR/code join;
- bar distribution.

Distinctive:

- Edikit evidence motif;
- three-view product proof;
- teacher-decision visual narrative;
- private evidence styling;
- signature response mosaic.

Novelty familiar task architecture’ni buzmaydi.

---

## 37. Science synthesis — nimasi haqiqatan qabul qilinadi

### 37.1. First impression

Evidence:

- visual appeal judgments 50ms atrofida shakllanishi mumkin [S252];
- visual complexity/prototypicality 17–50ms oralig‘ida ham aesthetics ratingga ta’sir qiladi [S251];
- aesthetics same contentning perceived credibility’sini oshirishi mumkin [S253];
- colorfulness va complexity first impression variance’ning muhim qismini tushuntiradi [S254].

Edikit qarori:

```text
first viewport low-medium complexity
high category prototypicality
one focal product proof
one primary CTA
one owned shape motif
no ambient noise
```

### 37.2. Saturation va trust

High saturation trustworthiness va visual comfortga zarar yetkazishi mumkin; color effect context, brightness, culture va palette congruence’ga bog‘liq [S255][S256][S257].

Edikit qarori:

- 80–90% neutral area;
- 8–15% brand cobalt;
- 2–5% signal/insight accents;
- no rainbow teacher UI;
- no fully saturated page background;
- warm colors status/insight, not dominant canvas.

### 37.3. Blue — accepted, lekin generic bo‘lish xavfi

Multiple studies blue’ni redga nisbatan trust/positive attitude bilan ko‘proq bog‘laydi, ammo effect universal law emas [S256][S257][S258].

Edikit qarori:

```text
Use blue for trust/action foundation
Do not use “generic SaaS blue only”
Own the identity through shape + cyan signal + amber insight + composition
```

### 37.4. Shape — warmth va competence

Research rounded formsni warmth/approachability, angular formsni competence/processing fluency bilan bog‘laydi; effect contextga bog‘liq [S259][S260][S261].

Edikit qarori:

```text
Teacher/Admin: 8–12px radius, structured/angular layout
Participant:    12–16px radius, comfortable touch surfaces
Modal:          16px max
Pill:           status/chip only
No 24–32px bubble-card system
No razor-sharp 0px institutional harshness
```

### 37.5. Typography

Serif vs sans-serifning universal readability winner’i haqida evidence mixed; familiarity, glyph clarity, x-height, spacing va rendering ko‘proq amaliy ahamiyatga ega [S262][S263].

Edikit qarori:

- UI: humanist sans;
- display: mature geometric/humanist sans;
- no childish rounded display font;
- no thin high-contrast serif in projector;
- 16px body;
- distinct `I/l/1`, `O/0`, Cyrillic glyphs;
- real Uzbek teacher reading test.

### 37.6. Whitespace

Whitespace hierarchy va readabilityni kuchaytiradi, ammo haddan tashqari whitespace informationni tarqatib, usabilityni pasaytirishi mumkin [S264][S265].

Edikit qarori:

```text
Whitespace = grouping tool
Not luxury decoration
```

Landing generous; teacher dashboard compact/comfortable; projector intentional open space; admin density controlled.

### 37.7. Aesthetics va actual usability

Aesthetic-usability effect perceived ease/trustni oshirishi mumkin, lekin broken behaviorni uzoq muddat yashirmaydi [S253][S266].

Edikit qarori:

```text
Visual polish gate never precedes compile, HTTP, task success and accessibility gates
```

### 37.8. Education-specific aesthetics

Educational toolsda visual design, usefulness, consistency, typography, grid va layout learner perception/adoption bilan bog‘langan [S267][S268][S269][S270].

Edikit qarori:

- learning content UI’dan ustun;
- graphic only if instructional/identity function;
- teacher and participant styles differentiated;
- responsive teaching evidence actionga bog‘langan;
- childish visual reward default emas.

### 37.9. Gamification

Gamification outcome context va implementationga bog‘liq. Public absolute leaderboards, points/badges va overcompetition anxiety, social pressure, demotivation yoki weaker social engagement bilan bog‘lanishi mumkin [S286][S287][S288][S289].

Edikit qarori:

```text
learning first
private personal progress
team/cooperative goals
Top N optional
public low ranks hidden
game visuals Cast contextga scoped
teacher workspace non-game visual
```

---

## 38. Competitive visual territory

### 38.1. Category map

| Product family | Dominant visual territory | Edikit cheklovi |
|---|---|---|
| Kahoot | violet + multicolor shapes + game show | clone qilmaslik |
| Wayground/Quizizz | purple + bright gamified cards | clutter/rainbowdan qochish |
| Blooket | candy colors + collectibles | teacher core’da yo‘q |
| Gimkit | dark neon game economy | neon identity yo‘q |
| Duolingo | green + mascot + bubble UI | mascot-led product emas |
| Mentimeter | clean presentation + warm accents | projector clarity olinadi |
| Slido | green/black event professionalism | minimal join olinadi |
| Quizlet | periwinkle/blue study utility | generic blue’dan shape bilan ajralish |
| Nearpod | bright blue education | childlike illustrationdan qochish |
| Institutional LMS | gray/blue utility | cold legacy lookdan qochish |

### 38.2. Edikit-owned territory

```text
Institutional Ink
+ Cobalt Evidence
+ Signal Cyan
+ Insight Amber
+ Response Mosaic
+ Evidence Rail
```

Visual phrase:

> **A dark cobalt signal moving through a precise neutral evidence grid.**

### 38.3. Color ownership

Quyidagi signature palette 3- va 20-bo‘limlardagi oldingi action-color draftlarini final brand qiymat sifatida almashtiradi. Oldingi neutral, accessibility va semantic architecture saqlanadi; `--color-action` light mode’da `#1746D1`, dark mode’da `#7AA8FF`ga resolve bo‘ladi.

Primary brand:

```css
--edikit-cobalt-700: #1739B7;
--edikit-cobalt-600: #1746D1;
--edikit-cobalt-500: #2256D8;
--edikit-cobalt-200: #AFC5FF;
--edikit-cobalt-100: #E9EFFF;
--edikit-cobalt-dark-action:  #7AA8FF;
--edikit-cobalt-dark-pressed: #5B8DEF;
```

Signal:

```css
--edikit-signal-light: #007C91;
--edikit-signal-dark:  #52D0D8;
```

Insight:

```css
--edikit-insight-light: #9B5E00;
--edikit-insight-dark:  #F2B84B;
```

Foundation:

```css
--edikit-ink:   #0C1426;
--edikit-paper: #F6F8FC;
```

Ratios:

| Pair | Ratio |
|---|---:|
| white / cobalt-600 | 7.41:1 |
| cobalt-600 / paper | 6.97:1 |
| signal-light / paper | 4.60:1 |
| insight-light / paper | 4.94:1 |
| cobalt-200 / ink | ≥7:1 target |
| signal-dark / ink | ≥9:1 target |
| insight-dark / ink | ≥10:1 target |

Brand cyan/amber status colors emas. Success/danger alohida semantic family.

### 38.4. Palette usage ratio

Light product:

```text
Neutral/paper 86%
Cobalt        10%
Signal cyan    2%
Insight amber  2%
```

Dark product:

```text
Ink/surfaces 88%
Cobalt/blue   8%
Signal cyan   2%
Insight amber 2%
```

Cast option colors bu brand ratio hisobiga kirmaydi; ular question interaction contextida cheklangan.

---

## 39. Edikit distinctive asset system

### 39.1. Evidence Mark

Owned shape:

```text
vertical rail
+ three short horizontal evidence ticks
+ one active signal node
```

Meaning:

```text
question
responses
teacher decision
```

Usage:

- favicon/logo exploration;
- section eyebrow;
- loading static mark;
- report cover;
- empty-state diagrams;
- social preview.

No random shield/lightning as default brand icon.

### 39.2. Signal Rail

A 3px leading line or top line on evidence-bearing components:

```text
neutral rail — inactive
cobalt rail — current/actionable
cyan node — live/realtime
amber node — teacher attention
red node — actual error only
```

Usage max one rail per card/section. Every card rail olmaydi.

### 39.3. Response Mosaic

Pattern:

```text
5×5 or responsive grid of small rectangular cells
```

States:

- neutral unsubmitted;
- cobalt responded;
- cyan live update;
- grouped into bar/distribution;
- no individual identity in marketing visual.

Use:

- landing hero product context;
- section divider art;
- report cover;
- skeleton/empty state static;
- Cast lobby count visualization optional.

Not use:

- full-page wallpaper;
- constant looping particle field;
- participant answer background;
- dense admin table.

### 39.4. Three-view frame

Owned product composition:

```text
Director wide frame
Projector landscape frame
Participant narrow frame
```

Always same angle/order/label grammar. This makes Edikit’s product architecture recognizable without reading copy.

### 39.5. Evidence Gradient

Only approved brand gradient:

```css
linear-gradient(110deg, #1746D1 0%, #2256D8 52%, #007C91 100%)
```

Dark variant uses lowered luminance/chroma. No violet/pink stop. Usage:

- hero signal line;
- primary brand illustration;
- selected marketing emphasis.

Primary product buttons default solid cobalt, not gradient.

### 39.6. Shape grammar

```text
8px controls
12px cards
16px modal/hero frame
2px border focus/selected
3px Signal Rail
square evidence cells with 3–4px radius
pill only status
```

This balances competence and warmth.

### 39.7. Imagery

Priority:

1. real Edikit component;
2. real classroom/product context photography with consent;
3. evidence diagram;
4. owned abstract Response Mosaic;
5. character art only optional participant experience.

No generic 3D orb, floating glass sphere, cartoon school supplies, random AI mesh or stock handshake.

---

## 40. Mature gamification — fun without childishness

### 40.1. Context separation

```text
Landing: confident, 15% playful
Teacher Workspace: 5% playful
Setup Studio: 5% playful
Director: 10% playful
Projector question: 15% playful
Participant: 25% playful
Milestone celebration: temporary 40% playful
Admin/report: 0–3% playful
```

Playfulness is not global theme. It appears only where motivation/feedback supports the learning task.

### 40.2. Remove from professional core

- emoji as nav icon;
- cartoon character panel in teacher navbar;
- trophy on every leaderboard state;
- glowing code loop;
- shimmer on every answer;
- bouncing waiting icon;
- confetti after ordinary action;
- rainbow buttons;
- “game economy” language;
- public bottom-rank treatment;
- childish copy.

### 40.3. Keep selectively

- answer shapes;
- optional avatar;
- team identity;
- one session-complete celebration;
- personal-best acknowledgment;
- class cooperative goal;
- subtle sound/haptic optional;
- friendly, not babyish copy.

### 40.4. Motivation hierarchy

```text
1. Clear mastery feedback
2. Teacher response
3. Personal progress
4. Team/class goal
5. Optional competition
6. Decorative reward
```

Points/badges are not top-level visual identity. Challenge, meaningful feedback, autonomy and relatedness have stronger design priority [S288][S291][S293].

### 40.5. Leaderboard styling

Professional:

```text
rank + safe alias + score
neutral table/list
Top 3 subtle medal tone
Top N only
personal position private
```

Not:

```text
podium stage every question
flames/crowns
bottom rank red
fall animation
all-class full ranking
```

### 40.6. Character system

If retained:

- original/licensed art only;
- coherent illustration system;
- optional;
- no motion by default;
- teacher can disable;
- no film/brand imitation;
- participant identity enhancement, not pedagogy;
- small, not dominant on question screen.

---

## 41. Official landing masterpiece — revised final

### 41.1. First viewport

Visual hierarchy:

```text
1. Outcome headline
2. Real product three-view frame
3. Primary CTA
4. Supporting proof
5. Participant shortcut
6. Navigation
```

Final copy:

Eyebrow with Evidence Mark:

```text
JONLI BAHOLASH · RESPONSIVE TEACHING
```

H1:

```text
Sinf nimani tushunganini
shu zahoti ko‘ring.
```

Subtitle:

```text
Edikit o‘qituvchiga testni jonli o‘tkazish,
javoblarni ko‘rish va darsni dalil asosida boshqarishga yordam beradi.
```

CTA:

```text
[Bepul boshlash]
[Demo Castni ko‘rish]
```

Participant:

```text
Sessiya kodingiz bormi? Kod bilan kiring →
```

Trust microline:

```text
Ilova o‘rnatilmaydi · Public reyting o‘qituvchi nazoratida · Accessibility-first
```

### 41.2. Hero art direction

Background:

```text
Paper/Ink canvas
1 faint evidence grid region
1 cobalt→cyan signal line
no particles
no orbits
no blurred blobs competing with product
```

Product frame:

- actual component capture;
- real demo label;
- Director wide foreground;
- Projector background;
- Participant device;
- Response Mosaic; 
- teacher action card “Muhokama tavsiya”; 
- no impossible/fake numbers.

### 41.3. Official trust bar

Below hero only evidence available:

```text
WCAG 2.2 AA maqsadi
No-camera Cast core
Server-confirmed answers
Uzbek-first interface
```

These are links to actual statements/docs when implemented. No unverified certification logo.

### 41.4. Brand story section

Heading:

```text
Savoldan qarorgacha — bitta aniq oqim.
```

Three Evidence Mark steps:

```text
ASK — savolni oching
SEE — sinf signalini ko‘ring
ADAPT — davom eting, muhokama qiling yoki qayta tushuntiring
```

This is Edikit’s verbal distinctive asset:

```text
Ask → See → Adapt
So‘ra → Ko‘r → Moslashtir
```

### 41.5. Product proof

Show:

- teacher-private distribution;
- answer coverage;
- dominant distractor;
- Discuss/Reteach/Next;
- before/after revote;
- action pack.

Do not lead with:

- avatars;
- points;
- confetti;
- tech stack;
- abstract AI;
- public rank.

### 41.6. Social proof standard

Proof card requires:

```text
real name/role or approved anonymized role
institution with permission
specific use case
measured/qualitative outcome
date
consent
```

No generic “Amazing platform!” quote.

### 41.7. Official footer

```text
Mahsulot
Cast
O‘qituvchilar
Accessibility
Xavfsizlik
Privacy
Status
Changelog
Contact
Til
```

Admin utility small. Current Node.js/Local DB labels removed.

---

## 42. Typography — official but recognizable

### 42.1. Final recommendation

Product body/UI:

```text
Source Sans 3 Variable
```

Marketing/display:

```text
Manrope Variable
```

Data/code:

```text
IBM Plex Mono
```

Fallback:

```css
--font-ui: "Source Sans 3", "Inter", system-ui, sans-serif;
--font-display: "Manrope", "Source Sans 3", system-ui, sans-serif;
--font-mono: "IBM Plex Mono", ui-monospace, monospace;
```

Rationale:

- Source Sans 3: mature humanist tone, screen clarity, institution/product balance;
- Manrope: distinct but not decorative, large display identity;
- IBM Plex Mono: technical precision for code/timer/audit only;
- Cyrillic/Uzbek subset QA remains mandatory.

Typeface selection is field-tested; serif/sans category alone scientific guarantee emas [S262][S263].

### 42.2. Brand typography signature

Headings:

```text
Manrope 650–720
-0.025em tracking
compact line-height
sentence case
```

Body:

```text
Source Sans 3 400–500
normal tracking
1.55–1.65 line-height
```

Controls:

```text
Source Sans 3 600
no uppercase
```

Eyebrow:

```text
Source Sans 3 650
12–13px
0.08em
Cobalt/Muted
```

No Righteous except legacy wordmark until logo redesign.

### 42.3. Official hierarchy

```text
Hero 64/68 desktop, 42/46 mobile
Page 40/46, 32/38 mobile
Section 32/38, 26/32 mobile
Card 20/28
Body large 18/29
Body 16/25
Label 14/20
Metadata 14/20
Badge 12/16
```

No all-900 weights. No metadata below 14px in operational UI.

---

## 43. Official product surfaces — revised identity application

### 43.1. Teacher Workspace

Brand expression:

```text
Cobalt active navigation
Evidence Rail on actionable insight
Response Mosaic only in empty/recent session visualization
Manrope page headings
Source Sans UI
```

No:

- gradient avatar as primary brand;
- Characters nav item;
- rainbow action buttons;
- playful cards.

### 43.2. Test Builder

Professional authoring tool:

- paper surface;
- cobalt selected question;
- Signal Rail for validation status;
- amber only unresolved issue;
- correct answer semantic green, not cyan;
- toolbar/grid alignment;
- no emoji icons.

### 43.3. Cast Setup

Mode cards:

```text
Accuracy — cobalt
Classic — neutral + small cobalt
Team — signal cyan accent
Formative — ink/neutral
```

Not four saturated rainbow cards. Selected state uses marker + border + rail.

### 43.4. Director

Private cockpit:

- ink/light neutral theme;
- cobalt current action;
- cyan live connection;
- amber instructional attention;
- semantic green/red correctness/error;
- stable charts;
- one recommended action.

### 43.5. Projector

Brand appears through:

- Evidence Mark small;
- Signal Rail/status;
- option shape grammar;
- typography;
- cobalt/cyan join screen.

Brand does not overwhelm question.

### 43.6. Participant

Warmer radius and larger touch targets, but same formal typography. Optional avatar only lobby/profile. Question screen clean.

### 43.7. Admin

Almost monochrome institutional surface. Cobalt selection. Signal cyan live system status only. No character, trophy, gradient or glow.

---

## 44. Brand governance va recognition testing

### 44.1. Distinctive asset test

Test assets separately without Edikit name:

```text
Evidence Mark
Response Mosaic
Signal Rail
three-view frame
cobalt/cyan/amber palette
Ask → See → Adapt
```

Metrics:

```text
Fame — Edikit bilan bog‘lash foizi
Uniqueness — faqat Edikit bilan bog‘lash foizi
Recognition time
Confusion brands
```

Target after exposure campaign/product use:

```text
Evidence Mark highest priority
Response Mosaic second
Color palette supporting, not sole asset
```

### 44.2. Brand perception survey

Semantic differential 1–7:

```text
childish — mature
unofficial — official
generic — distinctive
chaotic — clear
cold — warm
weak — competent
untrustworthy — trustworthy
outdated — modern
```

Ship target:

```text
Mature ≥5.8
Official ≥5.8
Distinctive ≥5.2
Clear ≥6.0
Competent ≥6.0
Trustworthy ≥5.8
Warm 4.0–5.5
```

### 44.3. Comparative study

Blind comparison:

```text
current Edikit
new official-distinct Edikit
generic blue SaaS control
playful quiz control
```

Tasks:

- identify audience;
- identify function;
- choose most trustworthy;
- choose most memorable after delay;
- first-click CTA;
- complete teacher task.

### 44.4. Science-safe interpretation

- color effect modest/contextual;
- first impression does not equal task success;
- aesthetic preference not accessibility proof;
- survey claim not behavior;
- small pilot not universal acceptance;
- culture/age/role segments reported;
- teacher and participant results separate;
- novelty effect re-tested after repeated use.

### 44.5. Production consistency audit

Quarterly:

```text
asset usage
rogue colors
rogue radius
logo misuse
inline styles
unapproved icons
motion exceptions
contrast regressions
copy inconsistency
product screenshot freshness
```

Distinctiveness repetition orqali quriladi; one-off creative variation orqali emas.

---

## 45. Scientific va official source index — S251–S325

### L. First impression, trust, shape va educational aesthetics — S251–S270

- **S251 — Visual Complexity and Prototypicality in Website First Impressions:** https://www.sciencedirect.com/science/article/abs/pii/S1071581912001207
- **S252 — Attention Web Designers: 50 Milliseconds:** https://www.tandfonline.com/doi/abs/10.1080/01449290500330448
- **S253 — Aesthetics and Credibility in Website Design:** https://dl.acm.org/doi/10.1016/j.ipm.2007.02.003
- **S254 — Predicting First Impressions from Complexity and Colorfulness:** https://dl.acm.org/doi/10.1145/2470654.2481281
- **S255 — Negative Impact of Saturation on Website Trustworthiness:** https://www.sciencedirect.com/science/article/abs/pii/S0747563216302254
- **S256 — Website Color and Button Shape Neuroimaging Study:** https://www.sciencedirect.com/science/article/pii/S0747563224000359
- **S257 — Trustworthy Blue or Untrustworthy Red:** https://www.tandfonline.com/doi/abs/10.1080/10696679.2019.1616560
- **S258 — Role of Color in Influencing Trust:** https://aisel.aisnet.org/mwais2007/16/
- **S259 — User Perceptions of Rounded and Angular Dialog Shapes:** https://dl.acm.org/doi/full/10.1145/3544549.3573845
- **S260 — Rounding for Warmth, Angling for Fluency:** https://www.tandfonline.com/doi/full/10.1080/10447318.2024.2390755
- **S261 — Shape–Trait Consistency Study:** https://pmc.ncbi.nlm.nih.gov/articles/PMC8514985/
- **S262 — Serif vs Sans-serif Web Usability Study:** https://peerj.com/articles/cs-1139/
- **S263 — First Impressions Beyond Visual Appeal:** https://link.springer.com/chapter/10.1007/978-3-642-23774-4_40
- **S264 — Layout Aesthetics and Visual Cognition:** https://www.nature.com/articles/s41598-025-00633-y
- **S265 — Visual Usability vs Aesthetics Scale:** https://doi.org/10.1080/10447318.2026.2639826
- **S266 — Classical and Expressive Website Aesthetics:** https://www.sciencedirect.com/science/article/abs/pii/S1071581903000359
- **S267 — Visual Design and Web Educational Tool Usefulness:** https://www.sciencedirect.com/science/article/pii/S1877042813035854
- **S268 — Design and Aesthetics in E-Learning Review:** https://eric.ed.gov/?id=EJ1000879
- **S269 — Aesthetic Visual Design and E-learning Usability:** https://scholarworks.waldenu.edu/cgi/viewcontent.cgi?article=1325&context=hlrc
- **S270 — Aesthetics and Usability in Digital Repositories:** https://doi.org/10.3390/arts15010009

### M. Official design, trust va distinctive identity — S271–S285

- **S271 — USWDS Design Principles and Earn Trust:** https://designsystem.digital.gov/design-principles/
- **S272 — USWDS Incremental Adoption and Human-Centered Guidance:** https://designsystem.digital.gov/how-to-use-uswds/
- **S273 — Section 508 Accessible Design Using USWDS:** https://www.section508.gov/develop/accessible-design-using-uswds/
- **S274 — UK Government Design Principles:** https://www.gov.uk/guidance/government-design-principles
- **S275 — UK Government Service Standard:** https://www.gov.uk/service-manual/service-standard
- **S276 — Shape-Based Distinctive Brand Assets Benchmark:** https://www.tandfonline.com/doi/full/10.1080/02650487.2026.2637295
- **S277 — NSW Government Design System:** https://digitalnsw.github.io/nsw-design-system/
- **S278 — Canada Design System:** https://design.canada.ca/
- **S279 — New Zealand Government Design System:** https://design-system-alpha.digital.govt.nz/
- **S280 — Singapore Government Design System:** https://www.designsystem.tech.gov.sg/
- **S281 — Government of India UX4G:** https://www.ux4g.gov.in/
- **S282 — USWDS Identifier Component:** https://designsystem.digital.gov/components/identifier/
- **S283 — GOV.UK Header Component:** https://design-system.service.gov.uk/components/header/
- **S284 — NHS Header Component:** https://service-manual.nhs.uk/design-system/components/header
- **S285 — Digital.gov Introduction to Human-Centered Design:** https://digital.gov/guides/hcd/introduction

### N. Mature gamification va learning motivation — S286–S300

- **S286 — Negative Effects of Gamification in Education Software:** https://www.sciencedirect.com/science/article/abs/pii/S0950584922002518
- **S287 — Leaderboards Reduce Social Engagement Study:** https://link.springer.com/article/10.1007/s12528-025-09438-4
- **S288 — Gamification and Intrinsic Motivation Meta-analysis:** https://link.springer.com/article/10.1007/s11423-023-10337-7
- **S289 — Gamified Learning Strategies and Motivation Review:** https://pmc.ncbi.nlm.nih.gov/articles/PMC10448467/
- **S290 — Cognitive and Motivational Benefits of Gamification:** https://openpsychologyjournal.com/VOLUME/18/ELOCATOR/e18743501359379/FULLTEXT/
- **S291 — Personalized Leaderboard Rankings Study:** https://www.sciencedirect.com/science/article/abs/pii/S0360131524002100
- **S292 — Gamification in Adult Education:** https://www.sciencedirect.com/science/article/pii/S2666374025000317
- **S293 — Gamification in STEM Higher Education:** https://stemeducationjournal.springeropen.com/articles/10.1186/s40594-024-00521-3
- **S294 — Challenge-Based Gamification and Motivation:** https://pmc.ncbi.nlm.nih.gov/articles/PMC9850335/
- **S295 — Gamification Motivation and Academic Performance Review:** https://www.mdpi.com/2227-7102/14/6/639
- **S296 — Leaderboards in Education Systematic Review:** https://onlinelibrary.wiley.com/doi/10.1111/jcal.13077
- **S297 — The Gamification of Learning Meta-analysis:** https://link.springer.com/article/10.1007/s10648-019-09498-w
- **S298 — How Gamification Motivates: Experimental Study:** https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0202857
- **S299 — Gamification Effect in Higher Education Meta-analysis:** https://journals.sagepub.com/doi/10.1177/21582440261421375
- **S300 — Blooket Accessibility and Learning Review:** https://edtechbooks.org/onlinetools/blooket

### O. Institutional brand systems — S301–S315

- **S301 — IBM Design Language:** https://www.ibm.com/design/language/
- **S302 — NASA Brand Center:** https://www.nasa.gov/nasa-brand-center/
- **S303 — MIT Graphic Identity:** https://web.mit.edu/graphicidentity/
- **S304 — Stanford Identity Guide:** https://identity.stanford.edu/
- **S305 — Oxford Brand and Communications:** https://communications.web.ox.ac.uk/oxford-brand
- **S306 — GitHub Brand Toolkit:** https://brand.github.com/
- **S307 — Atlassian Brand and Design Resources:** https://atlassian.design/resources/
- **S308 — Shopify Brand Assets:** https://www.shopify.com/brand-assets
- **S309 — Slack Media Kit:** https://slack.com/intl/en-gb/media-kit
- **S310 — Zoom Brand Center:** https://brand.zoom.us/
- **S311 — HarvardSites Design System:** https://designsystem.harvardsites.harvard.edu/
- **S312 — Harvard Business School Identity System:** https://identity.hbs.edu/
- **S313 — UC Berkeley Brand:** https://brand.berkeley.edu/
- **S314 — University of Michigan Brand:** https://brand.umich.edu/
- **S315 — Coursera Brand Guide:** https://about.coursera.org/brand-guide/

### P. Evaluation, credibility va design-system maturity — S316–S325

- **S316 — Google HEART Framework:** https://research.google/pubs/measuring-the-user-experience-on-a-large-scale-user-centered-metrics-for-web-applications/
- **S317 — ISO 9241-210 Human-Centred Design:** https://www.iso.org/standard/77520.html
- **S318 — User Experience Questionnaire:** https://www.ueq-online.org/
- **S319 — Visual Aesthetics of Websites Inventory Short Scale:** https://www.tandfonline.com/doi/abs/10.1080/0144929X.2012.694910
- **S320 — Empirical Evaluation of the System Usability Scale:** https://www.tandfonline.com/doi/abs/10.1080/10447310802205776
- **S321 — Stanford Web Credibility Guidelines:** https://credibility.stanford.edu/guidelines/index.html
- **S322 — NASA Task Load Index:** https://humansystems.arc.nasa.gov/groups/TLX/
- **S323 — AttrakDiff:** https://www.attrakdiff.de/
- **S324 — How Do People Evaluate Website Credibility?:** https://dl.acm.org/doi/10.1145/997078.997097
- **S325 — Visual Brand Identity Consistency Review:** https://ojs.cahayamandalika.com/index.php/armada/article/view/5019

## 46. Yakuniy design statement

> **Edikit — bolalar o‘yini ko‘rinishidagi quiz clone ham, esda qolmaydigan generic blue dashboard ham emas. U dalilni ko‘rsatadigan, o‘qituvchi qarorini kuchaytiradigan va o‘zining Evidence Mark, Signal Rail hamda Response Mosaic’i bilan darhol taniladigan official responsive-teaching product bo‘ladi.**

Final visual formula:

```text
Scientific classical aesthetics
+ official institutional trust
+ owned shape assets
+ Edikit Cobalt / Signal Cyan / Insight Amber
+ Source Sans 3 clarity / Manrope identity
+ calm teacher workspace
+ mature optional gamification
+ classroom-tested projector readability
+ semantic accessible motion
+ honest product proof
= Edikit Evidence-Led Institutional Design System
```

Final visual test:

```text
Name va logo olib tashlansa ham:
Evidence Mark
+ Signal Rail
+ Response Mosaic
+ three-view product composition
orqali product Edikit deb tanilishi kerak.
```

Final emotional target:

```text
“Bu jiddiy va ishonchli ta’lim platformasi.”
+ “Bu boshqa quiz platformalariga o‘xshamaydi.”
+ “Buni darsda ishlatish oson va xavfsiz ko‘rinadi.”
```
