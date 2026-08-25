# Edikit CAST — DEEP RESEARCH (host/projector/participant jonli dars tajribasi)

> **Holat:** research bosqichi. CAST = Edikit'ning jonli sinf rejimi: Host (o'qituvchi boshqaruvi), Projector (katta ekran), Participant (talaba telefoni). `views/role/board.ejs`, `views/role/student.ejs`, socket/cast-handler — mavjud. Bu hujjat Cast UX'ini maydalab o'rganadi: raqobatchilar (Kahoot/Quizizz/Mentimeter/Blooket/Gimkit), projector readability, participant UX, host controls, gamification balance.
> **Asosiy g'oya (style.md 24):** Cast = fokus, katta tipografiya, kuchli feedback, cheklangan energiya, accessibility-safe celebration. "No-camera Cast core", "Server-confirmed answers" — Edikit ajralib turadigan joylari.

---

## 1. Raqobatchi tahlil (2026 — 15 ta sinab ko'rilgan, mentimeter/triviamaker)

| Platforma | Kuchli tomoni | Zaif tomoni | Edikit uchun saboq |
|---|---|---|---|
| **Kahoot** | Katta ekranga savol, device'da javob; tez fire-round | 10-player free cap; primary colors; "arcade" | Sokin, professional ko'rinish bilan farqlanish |
| **Quizizz** | Player-paced (har talaba o'z tezligida); savol device'da; randomized order; 25+ a11y option | Discussion kam (o'z tezligi — umumiy pauza yo'q) | Edikit: instructor-paced (pauza + muhokama) — Kahoot usuli lekin professional |
| **Mentimeter** | Professional estetika; unlimited; presentation-native | Quiz bir slide turi — "not pure game sessions" | **Professional polish** — "corporate settings better than arcade" — Edikit uchun benchmark |
| **Blooket** | Power-ups, Mario Party vibe; gamification | K-12; detskiy | YO'Q — Edikit universitar daraja |
| **Gimkit** | Fast-paced, cash/power-ups | K-12 | YO'Q (detskiy) |
| **Wooclap** | Katta auditoriya | — | Katta sinf uchun skalalanadigan UX |
| **Genially** | 1500+ professional templates; branding | — | Professional template standardi |
| **Slides with Friends** | PPT + jackbox — discussion mode | — | Muhokama (Discuss/Reteach) pattern |

**Asosiy saboq:** Edikit Cast — Kahoot'ning **energiyasi** emas, balki Mentimeter/Genially **professionalizmi** + Kahoot'ning **classroom feedback** kuchini birlashtiradi. "Arcade-style themes" emas — "official but functional".

---

## 2. Projector (katta ekran) — spec (style.md 27 — classroom field design)

### 2.1. Readability (sinf sharoiti)

- **Katta tipografiya** — "students sitting in the back can read without straining" (Kahoot support: show questions on devices — large classrooms)
- Kontrast: **yuqori** — projector past kontrast (kunduzgi yorug'lik)
- **Minimal element** — bir savol, bir nechta javob; dekor yo'q
- **Timer** — katta, aniq (countdown progress bar/ring)
- **State-led** (style.md 0): "Savol ochildi" / "Vaqt tugadi" / "Natija" — har state aniq vizual
- **Response mosaic** (style.md 24) — sinf signali (ko'pchilik javobi), shaxsiy emas
- **Dominant distractor** — teacher-private, projector'da emas (style.md 41.5)

### 2.2. Projector state'lar (style.md 24 — state-led)

```text
LOBBY:   Sessiya kodi (katta) + qo'shilganlar soni + [Boshlash]
QUESTION: Savol (katta) + javob variantlari (A/B/C/D, katta tugmalar) + timer
          (option: savol device'da ham — Kahoot toggle, accessibility)
LOCK:    "Javoblar qabul qilindi" — qisqa
REVEAL:  To'g'ri javob + response mosaic (sinf signali) + discussion CTA
         [Muhokama] [Qayta o'qitish] [Keyingi] (style.md 41.5)
RESULTS: Ballar/jamoa (agar) + yakuniy
```

### 2.3. Motion (projector)

- State o'tishlari: 300-500ms (style.md motion-page/brand); semantic
- Celebration: 500-900ms **bir marta** (to'g'ri javob daqiqasi), reduced-motion'da yo'q
- "No bounce/spring in productivity UI. Controlled spring only achievement badge/avatar once" (style.md 6.3)

---

## 3. Participant (talaba telefoni) — spec

### 3.1. UX (Kahoot/Quizizz evidence + FIDO/accessibility)

- **Kod bilan kirish** — 6-8 belgi, katta keyboard, autofocus (Kahoot lobby pattern)
- Ism kiritish (short); kerak bo'lmasa — emoji/avatar (lekin professional)
- **Javob berish**: katta touch target (44px+, ustun); variant A/B/C/D + rang (rangga bog'liq emas — shape/label)
- **Feedback**: to'g'ri/noto'g'ri — sokin, aniq (check/x), ball sekin ko'tariladi
- **Savol device'da** (Kahoot toggle) — accessibility, katta sinf (Kahoot support: "Read Aloud feature" mumkin)
- **Pause/bezlash**: "Kutamiz..." state — aniq
- **Timer personal** (agar player-paced bo'lmasa — instructor-paced'da ko'rsatish shart emas, lekin device'da savol ko'rsatilsa — zarur)

### 3.2. Participant states

```text
JOIN: kod + ism → LOBBY (qo'shildi, kutamiz)
QUESTION: savol (agar device'da) + variantlar → tanlash
ANSWERED: "Javobingiz qabul qilindi" (sokin) → natija kutish
REVEAL: to'g'ri/noto'g'ri (shaxsiy, sokin)
RESULTS: shaxsiy ball/foiz; jamoa bo'lsa — jamoa o'rni
```

### 3.3. Accessibility (participant)

- Screen reader: variantlar aria-label, state'lar aria-live
- Read Aloud (Kahoot feature — matn o'qish)
- Colorblind-safe: variantlar rang + belgi (A/B/C/D + shape)
- Reduced motion: feedback statik
- Katta tugmalar, kam scroll (375px)
- Offline/low-bandwidth: WebSocket reconnect, state yig'iladi

---

## 4. Host (o'qituvchi) — spec

### 4.1. Host controls (style.md 24 — Director view)

```text
HOST PANEL:
├── Lobby: kod, qo'shilganlar, [Boshlash] [Sozlamalar]
├── Jonli: hozirgi savol, javoblar soni, timer nazorati
│          [Pauza] [Savolni yopish] [Muhokama] [Keyingi]
├── Natija: har savol stat (to'g'ri%, dominant distractor) — teacher-private
└── Yakuniy: class summary → saqlash (transkript/portfolio A-12)
```

### 4.2. Host UX qoidalari

- **Bitta asosiy harakat** har state'da (Kahoot: big green/yellow/red buttons — lekin Edikit professional ranglar)
- **Tekshirish paneli** — teacher-private (style.md 41.5: "teacher-private distribution")
- **Muhokama CTA** — "Discuss/Reteach/Next" (style.md 41.5) — pedagogical decision point
- **Before/after revote** — qayta ovoz (same question after discussion) — pedagogik kuch
- Keyboard: Space (boshlash/pauza), arrows — tez boshqaruv
- Error state: talaba uzilgan — reconnect; tarmoq — qayta ulanish
- **Rahbariyat/tyutor** (hemis_github: tyutor.hemis.uz 80/20 ijtimoiy faollik modeli) — teacher ball flow pattern → cast'da ham document→score (agar) — P3

### 4.3. Motion (host)

- Sokin; state o'zgarishida 160-220ms (panel)
- Alert (talaba soni, vaqt) — 100-160ms

---

## 5. Gamification balance (cast'da — evidence)

- **Ballar bor** — lekin: "public reyting o'qituvchi nazoratida" (style.md 41 trust microline; trust bar)
- **Leaderboard** — jamoa-based yaxshiroq (studypulse: "team-based leaderboards... shared purpose without individual shame")
- **Overjustification** — ball yagona motivator bo'lmasin; savol sifati/feedback asosiy (cogn-iq)
- **Badge celebration** — bir marta, 500-900ms, reduced-motion'da yo'q (style.md 6.2)
- **Xato qilish xavfsiz** — "smartest person always wins Kahoot; one mistake drops you" (reddit teaching — Blooket muammosi) → Edikit'da barqaror ball (speed penalty kam), sinf o'sishi ko'rsatiladi

---

## 6. Cast — qabul mezonlari

1. Projector: katta tip, yuqori kontrast, bitta savol, timer katta, dekor yo'q
2. Participant: kod kirish + katta tugmalar + shaxsiy sokin feedback + a11y (read-aloud, colorblind, reduced-motion)
3. Host: bitta asosiy action har state'da; teacher-private stats; Discuss/Reteach/Next; before/after revote
4. State-led motion: 300-500ms; celebration bir marta; reduced-motion qat'iy
5. Ballar professional (jamoa-based); public reyting teacher nazoratida
6. Response mosaic (sinf signali) — shaxsiy emas
7. WebSocket reconnect; offline state; device'da savol (toggle)
8. Server-authoritative: ball/timer/grade server'da (Global Master Prompt 8)
9. Style bitta oila; "arcade" emas — "official but functional"

---

## 7. Manbalar

support.kahoot.com (questions on device, read aloud) · triviamaker.com (15 alternatives) · mentimeter.com (kahoot alternatives) · genially.com · learninginhand.com (Quizizz vs Kahoot) · reddit r/instructionaldesign (live tools) · reddit r/teaching (Blooket/Kahoot tradeoffs) · questionpro.com · crowdparty.app · studypulse.education (gamification) · cogn-iq.org (overjustification) · style.md (24 — cast visual grammar, 27 — projector, 40 — mature gamification, 41.5 — product proof) · hemis_github.md (tyutor 80/20 social activity model)
