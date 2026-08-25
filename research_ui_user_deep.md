# Edikit USER (STUDENT) PANEL — DEEP RESEARCH (dashboard, progress, portfolio, test-arena)

> **Holat:** research bosqichi. `views/user/panel.ejs`, `portfolio.ejs`, `assignments.ejs`, `test-arena.ejs`, `security-profile.ejs` — student tarafi. Maqsad: task-led, glanceable, professional, lekin motivatsion (gamifikatsiya — dalilga asoslangan, "BPL" emas).
> **Evidence asos:** MyLA (Michigan) — student-facing analytics dashboard self-regulated learning uchun; LMS dashboard best practices; gamification meta-analizlar (SDT — Self-Determination Theory).

---

## 1. Student dashboard — evidence

### 1.1. Nima uchun student dashboard kerak (MyLA — Michigan, er.educause)

MyLA (My Learning Analytics) tamoyillari — student dashboard'ning maqsadi:
1. **Awareness** — talaba o'z ahvolini biladi (engagement, assignments, grades)
2. **Self-reflection** — o'z harakatini ko'radi
3. **Sense-making** — "qayerda yomon, nima qilish kerak" — actionable
4. **Transparency** — kursdagi o'rni ochiq

→ Student panel'da "talabaga o'z ma'lumotini ko'rsatish" = o'z-o'zini boshqarishni qo'llab-quvvatlash (self-regulated learning), faqat "ball ko'rsatish" emas.

### 1.2. Student dashboard struktura (multipurposethemes + gitnexa + datacamp)

```text
╔═ STUDENT PANEL ════════════════════════════════════
║ Sidebar (yoki top nav):
║   Bosh sahifa · Topshiriqlar · Testlar · Portfolio · Xavfsizlik
╠═ OVERVIEW (glanceable — 1 qarashda) ══════════════
║ • Keyingi topshiriq (due date + status)  ← eng muhim, tepada
║ • Bugungi testlar/jonli sessiyalar
║ • Umumiy progress (bar)
║ • So'nggi natija (ball/foiz)
╠═ PROGRESS (progressive disclosure) ══════════════
║ Fanlar bo'yicha progress bar; line chart trend (o'sish/pasayish)
║ (line chart — change over time; sparkline jadval ichida — datacamp)
╠═ TOPShIRIQLAR RO'YXATI ══════════════════════════
║ Status filter: Bajarilgan / Muddatli / Yangi
║ (Canvas shikoyati: "to-do faqat bugun" — kechagilari yo'qoladi →
║  aniq status + muddat ko'rinishi shart — thefinch)
╠═ NATIJALAR ══════════════════════════════════════
║ Har test: ball, foiz, fan, sana; trend
╚══════════════════════════════════════════════════
```

### 1.3. Dashboard qoidalari (evidence)

- **KPI minimal** — ko'p metric = shovqin (multipurposethemes, gitnexa: "many education dashboards fail due to poor UX, not data")
- **Top-down:** muhim metric tepada, drill-down keyin (cfder, gitnexa)
- **Konteks:** "75%" o'zi emas — trend/benchmark bilan ("oldingi haftaga nisbatan +5%") (multipurposethemes)
- **Color semantics barqaror** — xuddi shu rang bir xil ma'no (gitnexa: "Changing color semantics mid-dashboard is a common mistake")
- **Colorblind-safe palet** — WCAG (gitnexa)
- **Interaktiv:** clickable progress, hover tooltip, drill-down (multipurposethemes)
- **Real-time/near-real-time** — eskirgan data ishonchni buzadi (multipurposethemes)
- **Performance:** async widget, cache, agregate (multipurposethemes)
- **Customizable** — widget tanlash (P2) (multipurposethemes, zigpoll)

### 1.4. Chart tanlash (datacamp)

| Ma'lumot | Chart |
|---|---|
| Change over time | Line chart / sparkline |
| Ranking | Horizontal bar |
| Part-to-whole | Stacked bar (donut ≤2-3 slice) |
| Progress vs goal | Bullet chart |
| Distribution | Histogram/box plot |

---

## 2. Gamifikatsiya — dalil (nimani qilish/qilmaslik)

### 2.1. Asosiy topilmalar (studypulse, cogn-iq, SAGE, Springer)

- **BPL (Badges-Points-Leaderboards) shallow gamification** — "racing stripes on a bicycle": ko'rinishi tez, amalda o'zgarmaydi (studypulse)
- **Overjustification effect** — ichki motivatsiyali faoliyatga tashqi mukofot qo'shilsa, ichki motivatsiya pasayadi; mukofot olinsa, engagement aslidan pastga tushadi (studypulse, cogn-iq, SAGE)
- **SDT (Self-Determination Theory):** Autonomy + Competence + Relatedness — gamifikatsiya shu 3 ehtiyojni qondirsa ishlaydi (studypulse)
- **Meta-analiz (Gyedu 2026, SAGE):** gamifikatsiya diqqat bilan qo'llansa — ta'lim natijasini oshiradi; "success depends on course type, teacher design, student response" — yagona retsept yo'q
- **RCT (Springer 2025):** barcha elementlar (points+badges+challenges) — learning yuqori; **badges alone → cognitive load oshdi** — ehtiyot!
- **Leaderboard teskari ta'sir:** ko'pchilik past o'rinni ko'rsa — demotivatsiya (cogn-iq); team-based/class-wide goal yaxshiroq (studypulse: "Can we collectively answer 500 questions this week?")
- **Kyewski & Krämer:** badges — **private > public** (ko'pchilik ommaviy badge'ni yoqtirmaydi)
- **Jagušt et al.:** faqat adaptive (narrative + personalization) — sezilarli natija; oddiy elementlar yetmaydi
- **arxiv 2025 (BWS):** talabalar eng ko'p qadrlaydigan GDE: **progress bar, concept map, achievements, feedback** — points/badges/leaderboards emas! (progress visualization = motivatsiya)

### 2.2. Edikit uchun xulosa (mature gamification — style.md 40 bilan mos)

```text
ISHLAYDI (SDT'ga mos):
✅ Progress bar (ko'rinadigan o'sish) — eng kuchli
✅ Aniq maqsad + feedback (achievements = milestone, private)
✅ Competence: "o'tgan safar 60% edi, endi 75%" — o'sish ko'rsatish
✅ Autonomy: tanlash (mavzu, qiyinchilik)
✅ Relatedness: class-wide maqsad, jamoa (cast'da)
✅ Xatolar + yechim: "quyidagi mavzuni takrorlang" (multipurposethemes)

YO'Q / CHEKLANGAN (BPL — detskiy):
❌ Public leaderboard (cast'da ham ehtiyot — teacher nazorati, style.md 41)
❌ Badge to'plash (badge alone = cognitive load — Springer RCT)
❌ Ball/fireworks har testda
❌ "Detskiy" gamification (Emoji rush, confetti) — user talabi: universitar daraja
```

### 2.3. Test-arena (student test yechish) — spec

- Sokin, task-led; katta tipografiya faqat cast'da
- Timer aniq ko'rinadi (top-right, sokin)
- Progress: "5/20 savol" + bar
- Question navigation (barcha savollar, skip/qaytish)
- Natija ekrani: ball + foiz + to'g'ri/noto'g'ri tahlil + "qaysi mavzuni takrorlash" (constructive feedback — multipurposethemes)
- Cheating-signal (agar) — sokin, "dalil" sifatida (research.md 6)
- Portfolio: transkript/portfolio — dalil-based (A-12)

---

## 3. Student UX — rolga mos (wesoftyou + thefinch)

- **Student persona:** sodda, motivatsion, kam scroll, "keyingi nima?" aniq
- **Notification overload = eng katta shikoyat** (Canvas Capterra — thefinch): kam, priority, aniq bildirishnoma
- **Progressive disclosure** (digia): balance tepada, detail pastda
- **Mobile-first:** talabalar ko'pincha telefonda (wesoftyou/DataReportal UZ: 89% internet, mobile dominant)
- **Offline/low-bandwidth:** asosiy flow ishlashi (server-rendered EJS — yaxshi)

---

## 4. Student panel — qabul mezonlari

1. Overview: keyingi topshiriq + bugungi test + progress + so'nggi natija (1 qarashda)
2. Progress: bar + trend (line/sparkline), konteks bilan
3. Gamifikatsiya: progress/achievement (private)/feedback; public leaderboard yo'q (yoki teacher nazoratida)
4. Notification: kam, priority, no-overload
5. Test-arena: timer + progress + natija tahlili + takrorlash taklifi
6. Mobile to'liq; 44px; offline xato state
7. Color semantics barqaror; colorblind-safe
8. Portfolio/transkript — dalil-based, server-authoritative (qoida 8)
9. Style bilan bitta oila (tokenlar, motion minimal)

---

## 5. Manbalar

er.educause.edu (MyLA Michigan) · multipurposethemes.com (LMS dashboard) · gitnexa.com (education analytics) · datacamp.com (dashboard design) · uxpin.com (dashboard principles) · cfder.org (academic dashboard) · zigpoll.com (school dashboard) · studypulse.education (gamification research) · cogn-iq.org (gamification theory) · journals.sagepub.com (Gyedu 2026 meta-analysis) · link.springer.com (RCT gamification 2025) · arxiv.org 2512.08551 (learner GDE preferences) · link.springer.com (Beyond points and badges EDR) · malque.pub (gamification review) · axonpark.com (case studies) · wesoftyou.com (edtech principles) · thefinch.design (edtech UX) · digia.tech (progressive disclosure) · datareportal.com (Uzbekistan digital)
